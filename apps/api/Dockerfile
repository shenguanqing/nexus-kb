FROM node:22.22.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @nexus-kb/contracts build && pnpm --filter @nexus-kb/api build

FROM node:22.22.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app \
    && mkdir -p /data/raw-docs \
    && chown app:app /data/raw-docs \
    && chmod 0755 /data/raw-docs
COPY --from=build --chown=app:app /app /app
USER app
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
