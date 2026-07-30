# NexusKB Local Reranker Worker

This internal-only service runs `BAAI/bge-reranker-v2-m3` and returns only ranked input indexes and relevance scores. It has no document volume, database, vector-store, model-provider key, or public port. The NestJS API performs ACL and cloud-policy checks before it sends bounded candidate text to this Worker.

Ollama is not used: its documented local API provides generation, chat, and embeddings, but no stable rerank endpoint. The Worker uses `sentence-transformers` with the BGE cross-encoder directly.

The service remains disabled by default. To enable it locally, set the following in the Git-ignored `.env` and recreate `api reranker-worker`:

```dotenv
RERANK_PROVIDER=local_bge
RERANK_MODEL=BAAI/bge-reranker-v2-m3
LOCAL_RERANK_ENABLED=true
LOCAL_RERANK_BASE_URL=http://reranker-worker:8100
# Optional; when blank, local development reuses PARSER_INTERNAL_TOKEN.
RERANK_INTERNAL_TOKEN=
```

Before starting the enabled Worker, pre-download the public model into the named `reranker_models` volume:

```bash
docker compose --profile model-init run --rm reranker-model-init
docker compose up -d --build api reranker-worker
```

The one-off `reranker-model-init` job has access to a dedicated download network; the long-running Worker is forced to load only this local cache and does not. Pin `LOCAL_RERANK_MODEL_REVISION` to an approved Hugging Face revision before a production deployment. Docker Desktop runs this Linux Worker on CPU; evaluate latency before enabling it for routine use.
