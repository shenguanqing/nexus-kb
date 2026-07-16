FROM python:3.11.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app
COPY apps/parser-worker/requirements.lock ./requirements.lock
RUN pip install --no-cache-dir -r requirements.lock \
    && useradd --uid 10002 --create-home worker \
    && mkdir -p /data/raw-docs /tmp/parser \
    && chown -R worker:worker /app /tmp/parser
COPY --chown=worker:worker apps/parser-worker/app ./app
USER worker
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

