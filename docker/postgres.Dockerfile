FROM postgres:17.11-bookworm
USER root
RUN apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 upgrade --yes \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /usr/local/bin/gosu
USER postgres
