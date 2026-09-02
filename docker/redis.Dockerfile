FROM redis:8.2.9-bookworm
USER root
RUN apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 upgrade --yes \
    && rm -rf /var/lib/apt/lists/*
USER redis
