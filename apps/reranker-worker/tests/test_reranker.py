from unittest.mock import patch

from app.reranker import BgeReranker


def test_bge_reranker_loads_from_local_cache_only() -> None:
    with (
        patch("app.reranker.snapshot_download", return_value="/models/cache/snapshot") as snapshot,
        patch("app.reranker.CrossEncoder") as cross_encoder,
    ):
        BgeReranker("BAAI/bge-reranker-v2-m3", "test-revision", 8, 512)

    snapshot.assert_called_once_with(
        repo_id="BAAI/bge-reranker-v2-m3",
        revision="test-revision",
        local_files_only=True,
    )
    cross_encoder.assert_called_once_with(
        "/models/cache/snapshot",
        max_length=512,
        trust_remote_code=False,
        local_files_only=True,
    )
