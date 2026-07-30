FROM python:3.11.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    HF_HOME=/models/cache

WORKDIR /app
COPY apps/reranker-worker/requirements.lock ./requirements.lock
RUN pip install --no-cache-dir -r requirements.lock \
    && useradd --uid 10003 --create-home worker \
    && mkdir -p /models /tmp/reranker \
    && chown -R worker:worker /app /models /tmp/reranker
COPY --chown=worker:worker apps/reranker-worker/app ./app
USER worker
EXPOSE 8100
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8100", "--workers", "1"]
