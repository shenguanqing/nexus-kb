FROM docker:29.5.1-cli-alpine3.23 AS docker-cli

FROM node:22.23.1-alpine3.23
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
WORKDIR /app
COPY apps/deployment-agent/src /app
EXPOSE 8200
CMD ["node", "/app/index.mjs"]
