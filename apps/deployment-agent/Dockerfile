FROM docker:29.5.1-cli-alpine3.23 AS docker-cli

FROM node:22.23.1-alpine3.23
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
WORKDIR /app
COPY apps/deployment-agent/src /app
COPY --chmod=0755 scripts/nexus-load-secrets /usr/local/bin/nexus-load-secrets
EXPOSE 8200
ENV NEXUS_FILE_ENV_NAMES="DEPLOYMENT_AGENT_TOKEN"
ENTRYPOINT ["/usr/local/bin/nexus-load-secrets"]
CMD ["node", "/app/index.mjs"]
