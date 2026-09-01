FROM node:22.22.0-bookworm-slim AS build
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

FROM caddy:2.11.3-alpine
RUN addgroup -S -g 10004 web && adduser -S -D -H -u 10004 -G web web \
    && setcap -r /usr/bin/caddy \
    && mkdir -p /srv /config/caddy /data/caddy \
    && chown -R web:web /srv /config /data
COPY --from=build --chown=web:web /app/apps/web/dist /srv
COPY --chown=web:web apps/web/Caddyfile.production /etc/caddy/Caddyfile
USER web
EXPOSE 8080 8443
