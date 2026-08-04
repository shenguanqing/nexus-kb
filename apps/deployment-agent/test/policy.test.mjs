import assert from 'node:assert/strict';
import test from 'node:test';

import { managedEnvironmentFixture, validatePayload } from '../src/policy.mjs';

const deploymentId = '00000000-0000-4000-8000-000000000001';
const environment = managedEnvironmentFixture({ LLM_PROVIDER: 'google' });

test('accepts only the fixed deployment callback and service allowlist', () => {
  const result = validatePayload({
    deploymentId,
    services: ['api', 'parser-worker'],
    environment,
    previousEnvironment: environment,
    callbackUrl: `http://api:3000/v1/internal/deployments/${deploymentId}/result`,
  });
  assert.deepEqual(result.services, ['api', 'parser-worker']);
});

test('rejects infrastructure services and arbitrary callbacks', () => {
  assert.throws(() =>
    validatePayload({
      deploymentId,
      services: ['postgres'],
      environment,
      previousEnvironment: environment,
      callbackUrl: `http://api:3000/v1/internal/deployments/${deploymentId}/result`,
    }),
  );
  assert.throws(() =>
    validatePayload({
      deploymentId,
      services: ['api'],
      environment,
      previousEnvironment: environment,
      callbackUrl: 'http://attacker.invalid/callback',
    }),
  );
});

test('rejects unrecognized environment keys and newline injection', () => {
  assert.throws(() =>
    validatePayload({
      deploymentId,
      services: ['api'],
      environment: { ...environment, POSTGRES_PASSWORD: 'not-allowed' },
      previousEnvironment: environment,
      callbackUrl: `http://api:3000/v1/internal/deployments/${deploymentId}/result`,
    }),
  );
  assert.throws(() =>
    validatePayload({
      deploymentId,
      services: ['api'],
      environment: { ...environment, LLM_MODEL: 'safe\nINJECTED=true' },
      previousEnvironment: environment,
      callbackUrl: `http://api:3000/v1/internal/deployments/${deploymentId}/result`,
    }),
  );
});
