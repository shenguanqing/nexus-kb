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
    && pip install \
        --index-url https://pypi.org/simple \
        --retries 10 \
        --timeout 60 \
        -r requirements.lock
# Keep Office conversion in a separate layer so changing the renderer does not
# invalidate the much larger Python parsing dependency layer.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get -o Acquire::Retries=5 update \
    && attempt=1 \
    && until apt-get -o Acquire::Retries=5 install --yes --no-install-recommends \
        libreoffice-calc \
        libreoffice-writer; do \
      if [ "$attempt" -ge 5 ]; then exit 1; fi; \
      attempt=$((attempt + 1)); \
      sleep 2; \
      apt-get -o Acquire::Retries=5 update; \
    done
COPY --chmod=0755 apps/parser-worker/bin/nexus-download-easyocr-models /usr/local/bin/nexus-download-easyocr-models
RUN mkdir -p /opt/easyocr-models \
    && nexus-download-easyocr-models \
    && groupadd --gid 10010 previews \
    && useradd --uid 10002 --create-home worker \
    && usermod --append --groups previews worker \
    && mkdir -p /data/raw-docs /data/previews /tmp/parser \
    && chown -R worker:worker /app /tmp/parser /opt/easyocr-models \
    && chown worker:previews /data/previews \
    && chmod 2770 /data/previews
# Unstructured uses NLTK for PDF text classification. Keep runtime network-free
# by downloading the exact tokenizer/tagger resources into the image.
RUN mkdir -p /opt/nltk_data \
    && NLTK_DATA=/opt/nltk_data python -c "import nltk; [nltk.download(package, download_dir='/opt/nltk_data', quiet=True, raise_on_error=True) for package in ('punkt_tab', 'averaged_perceptron_tagger_eng')]" \
    && chmod -R a-w /opt/nltk_data
# Keep CJK fonts after the large OCR/NLTK layers so font package changes do not
# trigger another model download. LibreOffice embeds the glyphs into generated
# PDFs and ezdxf uses the same font when converting CAD text to SVG paths.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install --yes --no-install-recommends \
        fonts-noto-cjk \
    && fc-cache --force
COPY --chmod=0755 apps/parser-worker/bin/nexus-parser-worker-entrypoint /usr/local/bin/nexus-parser-worker-entrypoint
COPY --chmod=0755 scripts/nexus-load-secrets /usr/local/bin/nexus-load-secrets
COPY --chown=worker:worker apps/parser-worker/app ./app
USER worker
EXPOSE 8000
ENV NEXUS_FILE_ENV_NAMES="PARSER_INTERNAL_TOKEN"
ENTRYPOINT ["/usr/local/bin/nexus-parser-worker-entrypoint"]
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
