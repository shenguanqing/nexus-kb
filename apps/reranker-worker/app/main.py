import hmac
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Protocol
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status

from app.config import Settings
from app.reranker import BgeReranker
from app.schemas import RerankRequest, RerankResponse, RerankResult


class Reranker(Protocol):
    @property
    def model_name(self) -> str: ...

    def rank(self, query: str, documents: list[str], top_k: int) -> list[tuple[int, float]]: ...


def create_app(settings: Settings | None = None, reranker: Reranker | None = None) -> FastAPI:
    resolved_settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(api: FastAPI):
        if resolved_settings.local_rerank_enabled:
            api.state.reranker = reranker or BgeReranker(
                resolved_settings.rerank_model,
                resolved_settings.local_rerank_model_revision,
                resolved_settings.local_rerank_batch_size,
            )
        else:
            api.state.reranker = None
        yield

    api = FastAPI(
        title="NexusKB Local Reranker Worker",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
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

    def require_internal_token(x_rerank_internal_token: str = Header(default="")) -> None:
        if not hmac.compare_digest(x_rerank_internal_token, resolved_settings.internal_token):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="内部认证失败")

    @api.get("/health/live")
    def live() -> dict[str, str]:
        return {"status": "ok"}

    @api.get("/health/ready")
    def ready(response: Response) -> dict[str, str]:
        enabled = resolved_settings.local_rerank_enabled
        available = not enabled or api.state.reranker is not None
        if not available:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "ready" if available else "not_ready", "model": resolved_settings.rerank_model if enabled else "disabled"}

    @api.post(
        "/internal/v1/rerank",
        response_model=RerankResponse,
        dependencies=[Depends(require_internal_token)],
    )
    def rerank(payload: RerankRequest) -> RerankResponse:
        engine: Reranker | None = api.state.reranker
        if engine is None:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="本地重排未启用")
        results = engine.rank(payload.query, payload.documents, payload.top_k)
        if len(results) != payload.top_k or len({index for index, _ in results}) != len(results):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="重排结果无效")
        if any(index < 0 or index >= len(payload.documents) for index, _ in results):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="重排结果无效")
        return RerankResponse(
            model=engine.model_name,
            results=[RerankResult(index=index, relevanceScore=score) for index, score in results],
        )

    return api
