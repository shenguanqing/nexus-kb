FROM docker:29.7.2-cli-alpine3.24 AS docker-cli

FROM --platform=$BUILDPLATFORM golang:1.26.6-alpine3.24 AS compose-build
ARG TARGETOS
ARG TARGETARCH
ARG DOCKER_COMPOSE_SOURCE_SHA256=504ed1541f4bc5c301dc9cf7b86ae8e2d26b57a558a248d9b832af188b298bba
RUN apk add --no-cache ca-certificates curl \
    && curl --fail --location --silent --show-error \
        --output /tmp/compose.tar.gz \
        https://github.com/docker/compose/archive/refs/tags/v5.5.0.tar.gz \
    && printf '%s  %s\n' "$DOCKER_COMPOSE_SOURCE_SHA256" /tmp/compose.tar.gz | sha256sum -c - \
    && mkdir -p /src \
    && tar -xzf /tmp/compose.tar.gz --strip-components=1 -C /src \
    && rm /tmp/compose.tar.gz
WORKDIR /src
RUN go get \
        golang.org/x/crypto@v0.55.0 \
        golang.org/x/mod@v0.40.0 \
        google.golang.org/grpc@v1.83.1 \
    && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -tags=e2e \
        -ldflags='-s -w -X github.com/docker/compose/v5/internal.Version=v5.5.0+nexuskb.1' \
        -o /out/docker-compose ./cmd

FROM node:22.23.2-alpine3.24
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=compose-build /out/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY apps/deployment-agent/src /app
COPY --chmod=0755 scripts/nexus-load-secrets /usr/local/bin/nexus-load-secrets
EXPOSE 8200
ENV NEXUS_FILE_ENV_NAMES="DEPLOYMENT_AGENT_TOKEN"
ENTRYPOINT ["/usr/local/bin/nexus-load-secrets"]
CMD ["node", "/app/index.mjs"]
