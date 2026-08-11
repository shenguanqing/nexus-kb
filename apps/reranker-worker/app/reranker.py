from collections.abc import Sequence

from huggingface_hub import snapshot_download
from sentence_transformers import CrossEncoder


class BgeReranker:
    def __init__(self, model_name: str, revision: str, batch_size: int, max_length: int) -> None:
        model_path = snapshot_download(
            repo_id=model_name,
            revision=revision,
            local_files_only=True,
        )
        self._model = CrossEncoder(
            model_path,
            max_length=max_length,
            trust_remote_code=False,
            local_files_only=True,
        )
        self._model_name = model_name
        self._batch_size = batch_size

    @property
    def model_name(self) -> str:
        return self._model_name

    def rank(self, query: str, documents: Sequence[str], top_k: int) -> list[tuple[int, float]]:
        pairs = [(query, document) for document in documents]
        scores = self._model.predict(pairs, batch_size=self._batch_size, show_progress_bar=False)
        ranked = sorted(enumerate(scores.tolist()), key=lambda item: item[1], reverse=True)
        return [(index, float(score)) for index, score in ranked[:top_k]]
