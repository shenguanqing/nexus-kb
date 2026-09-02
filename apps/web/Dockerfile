FROM golang:1.26.6-alpine3.24 AS caddy-build
ARG CADDY_SOURCE_SHA256=2c3d02078286a6282cdb4d1d8744077788d556659dac0b64d8ed5886a7e5aeb9
RUN apk add --no-cache ca-certificates curl \
    && curl --fail --location --silent --show-error \
        --output /tmp/caddy.tar.gz \
        https://github.com/caddyserver/caddy/archive/refs/tags/v2.11.4.tar.gz \
    && printf '%s  %s\n' "$CADDY_SOURCE_SHA256" /tmp/caddy.tar.gz | sha256sum -c - \
    && mkdir -p /src \
    && tar -xzf /tmp/caddy.tar.gz --strip-components=1 -C /src \
    && rm /tmp/caddy.tar.gz
WORKDIR /src
RUN go get \
        golang.org/x/crypto@v0.55.0 \
        google.golang.org/grpc@v1.82.1 \
    && CGO_ENABLED=0 go build -trimpath \
        -ldflags='-s -w -X github.com/caddyserver/caddy/v2.CustomVersion=v2.11.4' \
        -o /out/caddy ./cmd/caddy

FROM node:22.23.2-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN --mount=type=cache,id=nexuskb-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm config set fetch-retries 10 \
    && pnpm config set fetch-retry-mintimeout 10000 \
    && pnpm config set fetch-retry-maxtimeout 60000 \
    && pnpm config set network-concurrency 4 \
    && pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN pnpm --filter @nexus-kb/contracts build && pnpm --filter @nexus-kb/web build

FROM caddy:2.11.4-alpine
COPY --from=caddy-build /out/caddy /usr/bin/caddy
RUN apk upgrade --no-cache \
    && addgroup -S -g 10004 web && adduser -S -D -H -u 10004 -G web web \
    && mkdir -p /srv /config/caddy /data/caddy \
    && chown -R web:web /srv /config /data
COPY --from=build --chown=web:web /app/apps/web/dist /srv
COPY --chown=web:web apps/web/Caddyfile.production /etc/caddy/Caddyfile
USER web
EXPOSE 8080 8443
