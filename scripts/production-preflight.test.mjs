import assert from 'node:assert/strict';
import test from 'node:test';

import { parseEnvironmentFile, validateProductionEnvironment } from './production-preflight.mjs';

const digest = `registry.example/nexus@sha256:${'a'.repeat(64)}`;
const environment = {
  NODE_ENV: 'production',
  AUTH_REQUIRED: 'true',
  PASSWORD_AUTH_ENABLED: 'false',
  ALLOW_CONFIDENTIAL_TO_CLOUD: 'false',
  NEXUS_KB_PUBLIC_HOST: 'kb.example.com',
  OIDC_ISSUER: 'https://id.example.com/realms/kb',
  OIDC_JWKS_URI: 'https://id.example.com/realms/kb/certs',
  OIDC_AUTHORIZATION_ENDPOINT: 'https://id.example.com/authorize',
  OIDC_TOKEN_ENDPOINT: 'https://id.example.com/token',
  OIDC_REDIRECT_URI: 'https://kb.example.com/auth/callback',
  OIDC_AUDIENCE: 'nexus-kb',
  OIDC_CLIENT_ID: 'nexus-kb-web',
  NEXUS_KB_DEPLOYMENT_UID: '10005',
  NEXUS_KB_DOCKER_GID: '998',
  ...Object.fromEntries(
    [
      'NEXUS_KB_API_IMAGE',
      'NEXUS_KB_WEB_IMAGE',
      'NEXUS_KB_PARSER_IMAGE',
      'NEXUS_KB_PARSER_DWG_IMAGE',
      'NEXUS_KB_RERANKER_IMAGE',
      'NEXUS_KB_DEPLOYMENT_AGENT_IMAGE',
      'NEXUS_KB_TIKA_IMAGE',
      'NEXUS_KB_POSTGRES_IMAGE',
      'NEXUS_KB_REDIS_IMAGE',
      'NEXUS_KB_CHROMA_IMAGE',
    ].map((name) => [name, digest]),
  ),
};

test('parses comments, JSON quotes and empty values without interpolation', () => {
  assert.deepEqual(parseEnvironmentFile('# comment\nNODE_ENV="production"\nTOKEN=\n'), {
    NODE_ENV: 'production',
    TOKEN: '',
  });
});

test('accepts a production OIDC environment with immutable image digests', () => {
  assert.doesNotThrow(() => validateProductionEnvironment(environment));
});

test('rejects inline secrets, mutable image tags and mismatched callbacks', () => {
  assert.throws(() =>
    validateProductionEnvironment({ ...environment, DATABASE_URL: 'postgresql://secret' }),
  );
  assert.throws(() =>
    validateProductionEnvironment({ ...environment, NEXUS_KB_API_IMAGE: 'nexus-kb-api:latest' }),
  );
  assert.throws(() =>
    validateProductionEnvironment({
      ...environment,
      OIDC_REDIRECT_URI: 'https://attacker.example/auth/callback',
    }),
  );
  assert.throws(() =>
    validateProductionEnvironment({
      ...environment,
      NEXUS_KB_COMPOSE_PROJECT_NAME: '../other-project',
    }),
  );
});
