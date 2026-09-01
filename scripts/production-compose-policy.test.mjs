import assert from 'node:assert/strict';
import test from 'node:test';

import { assertProductionComposePolicy } from './production-compose-policy.mjs';

const digest = `registry.example/image@sha256:${'a'.repeat(64)}`;
const service = {
  read_only: true,
  cap_drop: ['ALL'],
  pids_limit: 64,
  image: digest,
  user: '10001:10001',
};
const configuration = {
  services: {
    api: { ...service, ports: [] },
    'api-migrate': service,
    web: { ...service, ports: [{ target: 8080 }, { target: 8443 }] },
    'parser-worker': { ...service, environment: { PARSER_INTERNAL_TOKEN_FILE: '/run/secrets/x' } },
    'parser-worker-dwg': {
      ...service,
      environment: { PARSER_INTERNAL_TOKEN_FILE: '/run/secrets/x' },
    },
    'reranker-worker': {
      ...service,
      environment: { PARSER_INTERNAL_TOKEN_FILE: '/run/secrets/x' },
    },
    'deployment-agent': { ...service, user: '10005:998' },
    postgres: service,
    redis: service,
    chroma: service,
    tika: service,
  },
  secrets: Object.fromEntries(
    [
      'database_url',
      'deployment_agent_token',
      'parser_internal_token',
      'postgres_password',
      'redis_password',
      'redis_url',
      'system_config_encryption_key',
      'tls_certificate',
      'tls_key',
    ].map((name) => [name, { file: `/run/config/${name}` }]),
  ),
};

test('accepts the hardened production service and secret boundary', () => {
  assert.doesNotThrow(() => assertProductionComposePolicy(configuration));
});

test('rejects provider keys in parser containers and API host ports', () => {
  assert.throws(() =>
    assertProductionComposePolicy({
      ...configuration,
      services: {
        ...configuration.services,
        'parser-worker': {
          ...configuration.services['parser-worker'],
          environment: { DEEPSEEK_API_KEY: 'must-not-exist' },
        },
      },
    }),
  );
  assert.throws(() =>
    assertProductionComposePolicy({
      ...configuration,
      services: {
        ...configuration.services,
        api: { ...configuration.services.api, ports: [{ target: 3000 }] },
      },
    }),
  );
});
