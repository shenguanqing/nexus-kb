import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deploymentCommandConfiguration,
  deploymentComposeRecreateArguments,
  managedEnvironmentFixture,
  validatePayload,
} from '../src/policy.mjs';

const deploymentId = '00000000-0000-4000-8000-000000000001';
const environment = managedEnvironmentFixture({ LLM_PROVIDER: 'google' });

test('accepts only the fixed deployment callback and service allowlist', () => {
  const result = validatePayload({
    deploymentId,
    services: ['api', 'parser-worker', 'parser-worker-dwg'],
    environment,
    previousEnvironment: environment,
    callbackUrl: `http://api:3000/v1/internal/deployments/${deploymentId}/result`,
  });
  assert.deepEqual(result.services, ['api', 'parser-worker', 'parser-worker-dwg']);
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

test('accepts only fixed compose and environment files under the workspace', () => {
  assert.deepEqual(
    deploymentCommandConfiguration({
      DEPLOYMENT_WORKSPACE: '/srv/nexus-kb',
      DEPLOYMENT_COMPOSE_FILES:
        '/srv/nexus-kb/compose.yaml:/srv/nexus-kb/compose.dwg.yaml:/srv/nexus-kb/compose.production.yaml',
      DEPLOYMENT_ENV_FILE: '/srv/nexus-kb/.env.production',
    }),
    {
      workspace: '/srv/nexus-kb',
      composeFiles: [
        '/srv/nexus-kb/compose.yaml',
        '/srv/nexus-kb/compose.dwg.yaml',
        '/srv/nexus-kb/compose.production.yaml',
      ],
      environmentFile: '/srv/nexus-kb/.env.production',
      runtimeEnvironmentFile: '/srv/nexus-kb/config/runtime.env',
    },
  );

  assert.throws(() =>
    deploymentCommandConfiguration({
      DEPLOYMENT_WORKSPACE: '/srv/nexus-kb',
      DEPLOYMENT_COMPOSE_FILES: '/tmp/attacker.yaml',
    }),
  );
  assert.throws(() =>
    deploymentCommandConfiguration({
      DEPLOYMENT_WORKSPACE: '/srv/nexus-kb',
      DEPLOYMENT_ENV_FILE: '/srv/nexus-kb/.env.attacker',
    }),
  );
});

test('recreates runtime configuration without pulling or changing images', () => {
  const configuration = deploymentCommandConfiguration({
    DEPLOYMENT_WORKSPACE: '/srv/nexus-kb',
    DEPLOYMENT_COMPOSE_FILES:
      '/srv/nexus-kb/compose.yaml:/srv/nexus-kb/compose.dwg.yaml:/srv/nexus-kb/compose.production.yaml',
    DEPLOYMENT_ENV_FILE: '/srv/nexus-kb/.env.production',
  });
  const arguments_ = deploymentComposeRecreateArguments(configuration, ['api', 'parser-worker']);
  assert.deepEqual(arguments_.slice(-8), [
    'up',
    '-d',
    '--pull',
    'never',
    '--force-recreate',
    '--no-deps',
    'api',
    'parser-worker',
  ]);
  assert.throws(() => deploymentComposeRecreateArguments(configuration, ['postgres']));
});
