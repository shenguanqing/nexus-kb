FROM docker:29.7.2-cli-alpine3.24 AS docker-cli

FROM node:22.23.2-alpine3.24
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
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
