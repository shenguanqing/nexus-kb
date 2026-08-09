import hmac
import logging
import os
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
from app.parsers.image import parse_image
from app.parsers.pdf import parse_pdf
from app.parsers.text import parse_text
from app.parsers.tika import TikaUnavailableError, parse_with_tika, tika_is_ready
from app.parsers.xlsx import parse_xlsx
from app.preview import generate_cad_svg, generate_office_pdf
from app.schemas import ParseRequest, ParseResponse, PreviewArtifact
from app.security import validate_storage_path

LOGGER = logging.getLogger("nexus_kb.parser_worker")
SUPPORTED_TYPES = {
    ".txt": {"text/plain"},
    ".md": {"text/markdown", "text/plain"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    ".pdf": {"application/pdf"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
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
PARSER_ERROR_CODE_HEADER = "x-parser-error-code"
VALUE_ERROR_CODES = {
    "CAD 实体数量超过限制": "CAD_ENTITY_LIMIT_EXCEEDED",
    "解析结果元素数量超过限制": "PARSER_ELEMENT_LIMIT_EXCEEDED",
    "DXF 文件损坏或格式不受支持": "DXF_INVALID_OR_UNSUPPORTED",
    "PDF 文件已加密": "PDF_ENCRYPTED",
    "PDF 页数超过限制": "PDF_PAGE_LIMIT_EXCEEDED",
    "图片像素数量超过限制": "IMAGE_PIXEL_LIMIT_EXCEEDED",
    "OCR 返回格式无效": "OCR_INVALID_RESPONSE",
    "Tika 返回内容超过限制": "TIKA_RESPONSE_LIMIT_EXCEEDED",
}
DWG_INVALID_ERROR_CODES = {
    "DWG 版本不受支持或文件签名无效": "DWG_VERSION_UNSUPPORTED",
    "DWG 转换结果为空或超过大小限制": "DWG_CONVERTED_SIZE_LIMIT_EXCEEDED",
}


def parser_error_headers(code: str) -> dict[str, str]:
    return {PARSER_ERROR_CODE_HEADER: code}


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
        preview_root = resolved_settings.preview_artifacts_path
        preview_artifacts_ready = (
            preview_root.exists()
            and preview_root.is_dir()
            and os.access(preview_root, os.W_OK | os.X_OK)
        )
        office_preview_ready = resolved_settings.dwg_conversion_enabled
        if not office_preview_ready:
            office_executable = resolved_settings.libreoffice_executable
            try:
                resolved_office_executable = office_executable.resolve(strict=True)
            except OSError:
                office_preview_ready = False
            else:
                office_preview_ready = (
                    office_executable.is_absolute()
                    and not office_executable.is_symlink()
                    and resolved_office_executable.is_file()
                    and os.access(resolved_office_executable, os.X_OK)
                )
        converter_ready = not resolved_settings.dwg_conversion_enabled or converter_is_ready(
            resolved_settings.dwg_converter_executable,
            resolved_settings.parser_temp_path,
        )
        converter_status = "disabled"
        if resolved_settings.dwg_conversion_enabled:
            converter_status = "up" if converter_ready else "down"
        tika_ready = not resolved_settings.tika_enabled or tika_is_ready(
            resolved_settings.tika_base_url,
            min(resolved_settings.tika_request_timeout_seconds, 3),
        )
        tika_status = "disabled"
        if resolved_settings.tika_enabled:
            tika_status = "up" if tika_ready else "down"
        is_ready = (
            raw_docs_ready
            and preview_artifacts_ready
            and office_preview_ready
            and converter_ready
            and tika_ready
        )
        if not is_ready:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "ready" if is_ready else "not_ready",
            "checks": {
                "rawDocs": {"status": "up" if raw_docs_ready else "down"},
                "previewArtifacts": {
                    "status": "up" if preview_artifacts_ready else "down"
                },
                "officePreview": {
                    "status": "up" if office_preview_ready else "down"
                },
                "dwgConverter": {"status": converter_status},
                "tika": {"status": tika_status},
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
            preview: PreviewArtifact | None = None
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
                try:
                    preview = generate_office_pdf(
                        path,
                        payload.document_id,
                        executable=resolved_settings.libreoffice_executable,
                        preview_root=resolved_settings.preview_artifacts_path,
                        temp_root=resolved_settings.parser_temp_path,
                        timeout_seconds=resolved_settings.preview_conversion_timeout_seconds,
                        max_bytes=resolved_settings.max_preview_bytes,
                    )
                except Exception:
                    warnings.append("PREVIEW_GENERATION_FAILED")
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
                try:
                    preview = generate_office_pdf(
                        path,
                        payload.document_id,
                        executable=resolved_settings.libreoffice_executable,
                        preview_root=resolved_settings.preview_artifacts_path,
                        temp_root=resolved_settings.parser_temp_path,
                        timeout_seconds=resolved_settings.preview_conversion_timeout_seconds,
                        max_bytes=resolved_settings.max_preview_bytes,
                    )
                except Exception:
                    warnings.append("PREVIEW_GENERATION_FAILED")
            elif suffix == ".pdf":
                try:
                    elements, warnings, parser_version = parse_pdf(
                        path,
                        resolved_settings.ocr_languages.split(","),
                        resolved_settings.max_pdf_pages,
                        resolved_settings.max_elements,
                    )
                except ValueError:
                    raise
                except Exception:
                    if not resolved_settings.tika_enabled:
                        raise
                    elements, warnings, parser_version = parse_with_tika(
                        path,
                        payload.mime_type,
                        resolved_settings.tika_base_url,
                        resolved_settings.tika_request_timeout_seconds,
                        resolved_settings.max_tika_response_bytes,
                        resolved_settings.max_elements,
                        resolved_settings.tika_version,
                    )
                    parser = "apache-tika"
                else:
                    parser = "unstructured-pdf"
                    if not elements and resolved_settings.tika_enabled:
                        elements, warnings, parser_version = parse_with_tika(
                            path,
                            payload.mime_type,
                            resolved_settings.tika_base_url,
                            resolved_settings.tika_request_timeout_seconds,
                            resolved_settings.max_tika_response_bytes,
                            resolved_settings.max_elements,
                            resolved_settings.tika_version,
                        )
                        parser = "apache-tika"
            elif suffix in {".png", ".jpg", ".jpeg"}:
                elements, warnings, parser_version = parse_image(
                    path,
                    resolved_settings.ocr_model_storage_path,
                    resolved_settings.parser_temp_path / "easyocr-user-network",
                    resolved_settings.ocr_languages.split(","),
                    resolved_settings.max_image_pixels,
                    resolved_settings.max_elements,
                    resolved_settings.ocr_confidence_warning_threshold,
                )
                parser = "easyocr"
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
                try:
                    preview = generate_cad_svg(
                        path,
                        payload.document_id,
                        preview_root=resolved_settings.preview_artifacts_path,
                        max_bytes=resolved_settings.max_preview_bytes,
                    )
                    if preview.renderer == "ezdxf-svg-gzip":
                        warnings.append("CAD_PREVIEW_GZIP_COMPRESSED")
                except Exception:
                    warnings.append("PREVIEW_GENERATION_FAILED")
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
                    document_id=payload.document_id,
                    preview_root=resolved_settings.preview_artifacts_path,
                    max_preview_bytes=resolved_settings.max_preview_bytes,
                )
                elements = result.elements
                warnings = result.warnings
                parser = "oda-file-converter+ezdxf"
                parser_version = result.parser_version
                preview = result.preview
        except DwgConversionTimeoutError as error:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(error)
            ) from error
        except DwgConversionUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
            ) from error
        except TikaUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
                headers=parser_error_headers("TIKA_UNAVAILABLE"),
            ) from error
        except DwgConversionInvalidError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(error),
                headers=parser_error_headers(
                    DWG_INVALID_ERROR_CODES.get(str(error), "DWG_CONVERSION_FAILED")
                ),
            ) from error
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(error),
                headers=parser_error_headers(
                    VALUE_ERROR_CODES.get(str(error), "PARSER_INVALID_REQUEST")
                ),
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
                headers=parser_error_headers("PARSER_EMPTY_RESULT"),
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
            preview=preview,
        )

    return api
