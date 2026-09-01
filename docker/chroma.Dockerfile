FROM chromadb/chroma:1.5.9
USER root
RUN groupadd --gid 10006 chroma-runtime \
    && useradd --uid 10006 --gid chroma-runtime --no-create-home chroma-runtime \
    && mkdir -p /data \
    && chown -R chroma-runtime:chroma-runtime /data
USER chroma-runtime
