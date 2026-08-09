FROM node:22.22.0-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @nexus-kb/contracts build && pnpm --filter @nexus-kb/api build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --gid 10001 app \
    && groupadd --gid 10010 previews \
    && useradd --uid 10001 --gid app --create-home app \
    && usermod --append --groups previews app \
    && mkdir -p /data/raw-docs /data/previews \
    && chown app:app /data/raw-docs \
    && chown app:previews /data/previews \
    && chmod 0755 /data/raw-docs \
    && chmod 2770 /data/previews
COPY --from=build --chown=app:app /app /app
USER app
EXPOSE 3000
CMD ["sh", "-c", "apps/api/node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/main.js"]
