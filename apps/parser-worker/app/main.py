import hmac
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status

from app.config import Settings
from app.parsers.text import parse_text
from app.schemas import ParseRequest, ParseResponse
from app.security import validate_storage_path

LOGGER = logging.getLogger("nexus_kb.parser_worker")
SUPPORTED_TEXT_TYPES = {
    ".txt": {"text/plain"},
    ".md": {"text/markdown", "text/plain"},
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
        is_ready = root.exists() and root.is_dir()
        if not is_ready:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "ready" if is_ready else "not_ready",
            "checks": {"rawDocs": {"status": "up" if is_ready else "down"}},
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
        if payload.mime_type not in SUPPORTED_TEXT_TYPES.get(suffix, set()):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="当前解析存根不支持此文件类型或 MIME",
            )
        elements = parse_text(path)
        LOGGER.info(
            "document parsed",
            extra={
                "traceId": request.headers.get("x-trace-id"),
                "jobId": str(payload.job_id),
                "documentId": str(payload.document_id),
                "parser": "text",
            },
        )
        return ParseResponse(parser="text", parser_version="1.0.0", elements=elements)

    return api
