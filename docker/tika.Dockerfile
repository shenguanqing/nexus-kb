FROM apache/tika:3.2.3.0 AS tika-release

FROM eclipse-temurin:21.0.12_8-jre-noble
ENV TIKA_VERSION=3.2.3
RUN groupadd --gid 35002 tika \
    && useradd --uid 35002 --gid tika --no-create-home tika \
    && mkdir -p /tika-extras \
    && chown -R tika:tika /tika-extras
COPY --from=tika-release --chown=tika:tika /tika-server-standard-3.2.3.jar /
USER 35002:35002
ENTRYPOINT ["/bin/sh", "-c", "exec java -cp \"/tika-server-standard-${TIKA_VERSION}.jar:/tika-extras/*\" org.apache.tika.server.core.TikaServerCli -h 0.0.0.0 $0 $@"]
