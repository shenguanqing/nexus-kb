from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


class StubReranker:
    model_name = "BAAI/bge-reranker-v2-m3"

    def rank(self, query: str, documents: list[str], top_k: int) -> list[tuple[int, float]]:
        assert query == "Vue 和 React 的区别"
        assert documents == ["Vue 文档", "React 文档"]
        assert top_k == 2
        return [(1, 0.9), (0, 0.4)]


def settings(enabled: bool = True) -> Settings:
    # Use the same public configuration keys as Compose.  Settings fields use
    # validation aliases so environment values cannot leak into this fixture.
    return Settings.model_validate(
        {
            "LOCAL_RERANK_ENABLED": enabled,
            "RERANK_INTERNAL_TOKEN": "reranker-test-token",
            "RERANK_MODEL": "BAAI/bge-reranker-v2-m3",
            "LOCAL_RERANK_MODEL_REVISION": "test-revision",
            "LOCAL_RERANK_MAX_LENGTH": 512,
        }
    )


def test_rerank_requires_internal_token() -> None:
    with TestClient(create_app(settings(), StubReranker())) as client:
        response = client.post(
            "/internal/v1/rerank",
            json={"query": "Vue 和 React 的区别", "documents": ["Vue 文档"], "topK": 1},
        )

    assert response.status_code == 401


def test_rerank_returns_only_ranked_indexes_and_scores() -> None:
    with TestClient(create_app(settings(), StubReranker())) as client:
        response = client.post(
            "/internal/v1/rerank",
            headers={"x-rerank-internal-token": "reranker-test-token"},
            json={
                "query": "Vue 和 React 的区别",
                "documents": ["Vue 文档", "React 文档"],
                "topK": 2,
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "model": "BAAI/bge-reranker-v2-m3",
        "results": [
            {"index": 1, "relevanceScore": 0.9},
            {"index": 0, "relevanceScore": 0.4},
        ],
    }


def test_disabled_reranker_does_not_load_model_or_accept_requests() -> None:
    with TestClient(create_app(settings(False))) as client:
        ready = client.get("/health/ready")
        response = client.post(
            "/internal/v1/rerank",
            headers={"x-rerank-internal-token": "reranker-test-token"},
            json={"query": "问题", "documents": ["文档"], "topK": 1},
        )

    assert ready.json() == {"status": "ready", "model": "disabled"}
    assert response.status_code == 503
