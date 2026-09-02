FROM python:3.11.16-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    HF_HOME=/models/cache

WORKDIR /app
COPY apps/reranker-worker/requirements.lock ./requirements.lock
RUN apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 upgrade --yes \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir --upgrade \
        pip==26.2.1 \
        setuptools==82.0.1 \
        wheel==0.48.0 \
    && pip install --no-cache-dir -r requirements.lock \
    && pip uninstall --yes pip setuptools wheel \
    && useradd --uid 10003 --create-home worker \
    && mkdir -p /models /tmp/reranker \
    && chown -R worker:worker /app /models /tmp/reranker
COPY --chown=worker:worker apps/reranker-worker/app ./app
COPY --chmod=0755 scripts/nexus-load-secrets /usr/local/bin/nexus-load-secrets
USER worker
EXPOSE 8100
ENV NEXUS_FILE_ENV_NAMES="RERANK_INTERNAL_TOKEN PARSER_INTERNAL_TOKEN"
ENTRYPOINT ["/usr/local/bin/nexus-load-secrets"]
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8100", "--workers", "1"]
