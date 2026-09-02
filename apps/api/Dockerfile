FROM node:22.23.2-bookworm-slim AS base
RUN apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 upgrade -y \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends openssl \
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
RUN --mount=type=cache,id=nexuskb-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm config set fetch-retries 10 \
    && pnpm config set fetch-retry-mintimeout 10000 \
    && pnpm config set fetch-retry-maxtimeout 60000 \
    && pnpm config set network-concurrency 4 \
    && pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @nexus-kb/contracts build \
    && pnpm --filter @nexus-kb/api build \
    && pnpm --filter @nexus-kb/api deploy --prod --legacy /prod/api

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
    && chmod 2770 /data/previews \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build --chown=app:app /prod/api/package.json /app/apps/api/package.json
COPY --from=build --chown=app:app /prod/api/node_modules /app/apps/api/node_modules
COPY --from=build --chown=app:app /app/apps/api/dist /app/apps/api/dist
COPY --from=build --chown=app:app /app/apps/api/prisma /app/apps/api/prisma
COPY --chmod=0755 scripts/nexus-load-secrets /usr/local/bin/nexus-load-secrets
USER app
EXPOSE 3000
ENV NEXUS_FILE_ENV_NAMES="DATABASE_URL REDIS_URL PARSER_INTERNAL_TOKEN RERANK_INTERNAL_TOKEN SYSTEM_CONFIG_ENCRYPTION_KEY DEPLOYMENT_AGENT_TOKEN PASSWORD_AUTH_USERS_JSON OPENAI_API_KEY GEMINI_API_KEY DEEPSEEK_API_KEY DASHSCOPE_API_KEY CUSTOM_API_KEY"
ENTRYPOINT ["/usr/local/bin/nexus-load-secrets"]
CMD ["sh", "-c", "apps/api/node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/main.js"]
