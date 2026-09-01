import assert from 'node:assert/strict';
import test from 'node:test';

import { operationServices, productionComposeArguments } from './production-operations.mjs';

test('uses a stable production project name and fixed Compose files', () => {
  const arguments_ = productionComposeArguments();
  assert.ok(arguments_.includes('--project-name'));
  assert.ok(arguments_.includes('compose.yaml'));
  assert.ok(arguments_.includes('compose.dwg.yaml'));
  assert.ok(arguments_.includes('compose.production.yaml'));
  assert.ok(arguments_.includes('.env.production'));
});

test('allows only a complete, fixed recovery service subset', () => {
  const previous = process.env.NEXUS_KB_OPERATION_SERVICES;
  try {
    process.env.NEXUS_KB_OPERATION_SERVICES = 'api,parser-worker,tika,postgres,redis,chroma';
    assert.deepEqual(operationServices(), [
      'api',
      'parser-worker',
      'tika',
      'postgres',
      'redis',
      'chroma',
    ]);
    process.env.NEXUS_KB_OPERATION_SERVICES = 'api,parser-worker,tika,postgres,redis';
    assert.throws(() => operationServices(), /OPERATION_SERVICE_REQUIRED:chroma/);
    process.env.NEXUS_KB_OPERATION_SERVICES = 'api,parser-worker,tika,postgres,redis,chroma,shell';
    assert.throws(() => operationServices(), /NEXUS_KB_OPERATION_SERVICES_INVALID/);
  } finally {
    if (previous === undefined) delete process.env.NEXUS_KB_OPERATION_SERVICES;
    else process.env.NEXUS_KB_OPERATION_SERVICES = previous;
  }
});
