import hmac
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status

from app.archive import validate_office_archive
from app.config import Settings
from app.parsers.docx import parse_docx
from app.parsers.dwg import (
    DwgConversionInvalidError,
    DwgConversionTimeoutError,
    DwgConversionUnavailableError,
    converter_is_ready,
    parse_dwg,
)
from app.parsers.dxf import parse_dxf
from app.parsers.text import parse_text
from app.parsers.xlsx import parse_xlsx
from app.schemas import ParseRequest, ParseResponse
from app.security import validate_storage_path

LOGGER = logging.getLogger("nexus_kb.parser_worker")
SUPPORTED_TYPES = {
    ".txt": {"text/plain"},
    ".md": {"text/markdown", "text/plain"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    ".dxf": {
        "image/vnd.dxf",
        "application/dxf",
        "application/x-dxf",
        "drawing/x-dxf",
    },
    ".dwg": {
        "image/vnd.dwg",
        "application/acad",
        "application/dwg",
        "application/x-dwg",
    },
}


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings()
    api = FastAPI(title="NexusKB Parser Worker", version="1.0.0", docs_url=None, redoc_url=None)
    api.state.settings = resolved_settings

    @api.middleware("http")
    async def trace_id(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        raw_trace_id = request.headers.get("x-trace-id", "")
        try:
            current_trace_id = str(UUID(raw_trace_id))
        except ValueError:
            current_trace_id = str(uuid4())
        response = await call_next(request)
        response.headers["x-trace-id"] = current_trace_id
        return response

    def require_internal_token(x_internal_token: str = Header(default="")) -> None:
        if not hmac.compare_digest(x_internal_token, resolved_settings.parser_internal_token):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="内部认证失败")

    @api.get("/health/live")
    def live() -> dict[str, str]:
        return {"status": "ok"}

    @api.get("/health/ready")
    def ready(response: Response) -> dict[str, object]:
        root = resolved_settings.raw_docs_path
        raw_docs_ready = root.exists() and root.is_dir()
        converter_ready = not resolved_settings.dwg_conversion_enabled or converter_is_ready(
            resolved_settings.dwg_converter_executable,
            resolved_settings.parser_temp_path,
        )
        converter_status = "disabled"
        if resolved_settings.dwg_conversion_enabled:
            converter_status = "up" if converter_ready else "down"
        is_ready = raw_docs_ready and converter_ready
        if not is_ready:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "ready" if is_ready else "not_ready",
            "checks": {
                "rawDocs": {"status": "up" if raw_docs_ready else "down"},
                "dwgConverter": {"status": converter_status},
            },
        }

    @api.post(
        "/internal/v1/parse",
        response_model=ParseResponse,
        dependencies=[Depends(require_internal_token)],
    )
    def parse(payload: ParseRequest, request: Request) -> ParseResponse:
        path = validate_storage_path(
            payload.storage_path,
            resolved_settings.raw_docs_path,
            resolved_settings.max_parse_bytes,
        )
        suffix = Path(path).suffix.lower()
        if payload.mime_type not in SUPPORTED_TYPES.get(suffix, set()):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="不支持此文件类型或 MIME",
            )
        try:
            warnings: list[str] = []
            parser_version = "1.1.0"
            if suffix in {".txt", ".md"}:
                elements = parse_text(path)
                parser = "markdown" if suffix == ".md" else "text"
            elif suffix == ".docx":
                validate_office_archive(
                    path,
                    resolved_settings.max_archive_entries,
                    resolved_settings.max_archive_uncompressed_bytes,
                )
                elements = parse_docx(path, resolved_settings.max_elements)
                parser = "python-docx"
            elif suffix == ".xlsx":
                validate_office_archive(
                    path,
                    resolved_settings.max_archive_entries,
                    resolved_settings.max_archive_uncompressed_bytes,
                )
                elements = parse_xlsx(
                    path,
                    resolved_settings.max_spreadsheet_rows,
                    resolved_settings.max_elements,
                )
                parser = "openpyxl"
            elif suffix == ".dxf":
                result = parse_dxf(
                    path,
                    resolved_settings.max_cad_entities,
                    resolved_settings.max_elements,
                    resolved_settings.max_cad_insert_depth,
                )
                elements = result.elements
                warnings = result.warnings
                parser = "ezdxf"
                parser_version = result.parser_version
            else:
                if not resolved_settings.dwg_conversion_enabled:
                    raise DwgConversionUnavailableError("DWG 格式转换未启用")
                result = parse_dwg(
                    path,
                    executable=resolved_settings.dwg_converter_executable,
                    converter_release=resolved_settings.dwg_converter_release,
                    output_version=resolved_settings.dwg_output_version,
                    temp_root=resolved_settings.parser_temp_path,
                    timeout_seconds=resolved_settings.dwg_conversion_timeout_seconds,
                    max_converted_bytes=resolved_settings.max_dwg_converted_bytes,
                    max_entities=resolved_settings.max_cad_entities,
                    max_elements=resolved_settings.max_elements,
                    max_insert_depth=resolved_settings.max_cad_insert_depth,
                )
                elements = result.elements
                warnings = result.warnings
                parser = "oda-file-converter+ezdxf"
                parser_version = result.parser_version
        except DwgConversionTimeoutError as error:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(error)
            ) from error
        except DwgConversionUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
            ) from error
        except DwgConversionInvalidError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)
            ) from error
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)
            ) from error
        except Exception as error:
            LOGGER.warning(
                "document parser rejected input",
                extra={
                    "traceId": request.headers.get("x-trace-id"),
                    "jobId": str(payload.job_id),
                    "errorType": type(error).__name__,
                },
            )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="文档解析失败",
            ) from None
        if not elements:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="解析结果为空",
            )
        LOGGER.info(
            "document parsed",
            extra={
                "traceId": request.headers.get("x-trace-id"),
                "jobId": str(payload.job_id),
                "documentId": str(payload.document_id),
                "parser": parser,
            },
        )
        return ParseResponse(
            parser=parser,
            parser_version=parser_version,
            elements=elements,
            warnings=warnings,
        )

    return api
