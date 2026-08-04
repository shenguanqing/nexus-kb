FROM python:3.11.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    DO_NOT_TRACK=true

WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      libglib2.0-0 \
      libgl1 \
      libxcb1 \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-chi-sim \
      tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*
COPY apps/parser-worker/requirements.lock ./requirements.lock
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install \
        --index-url https://download.pytorch.org/whl/cpu \
        torch==2.8.0 \
        torchvision==0.23.0 \
    && pip install -r requirements.lock \
    && mkdir -p /opt/easyocr-models \
    && python -c "import easyocr; easyocr.Reader(['ch_sim','en'], gpu=False, model_storage_directory='/opt/easyocr-models', download_enabled=True, verbose=False)" \
    && useradd --uid 10002 --create-home worker \
    && mkdir -p /data/raw-docs /tmp/parser \
    && chown -R worker:worker /app /tmp/parser /opt/easyocr-models
# Unstructured uses NLTK for PDF text classification. Keep runtime network-free
# by downloading the exact tokenizer/tagger resources into the image.
RUN mkdir -p /opt/nltk_data \
    && NLTK_DATA=/opt/nltk_data python -c "import nltk; [nltk.download(package, download_dir='/opt/nltk_data', quiet=True, raise_on_error=True) for package in ('punkt_tab', 'averaged_perceptron_tagger_eng')]" \
    && chmod -R a-w /opt/nltk_data
COPY --chmod=0755 apps/parser-worker/bin/nexus-parser-worker-entrypoint /usr/local/bin/nexus-parser-worker-entrypoint
COPY --chown=worker:worker apps/parser-worker/app ./app
USER worker
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/nexus-parser-worker-entrypoint"]
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
