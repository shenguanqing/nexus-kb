import assert from 'node:assert/strict';
import test from 'node:test';

import { composeArguments } from './compose-arguments.mjs';

test('loads the managed runtime environment after .env when it exists', () => {
  assert.deepEqual(composeArguments('full', ['--', 'config'], true), [
    '-f',
    'compose.yaml',
    '-f',
    'compose.dwg.yaml',
    '--profile',
    'configuration',
    '--env-file',
    '.env',
    '--env-file',
    'config/runtime.env',
    'config',
  ]);
});

test('keeps first-run compose commands usable before runtime.env exists', () => {
  assert.deepEqual(composeArguments('dev', ['up', '-d'], false), [
    '--profile',
    'configuration',
    '--env-file',
    '.env',
    'up',
    '-d',
  ]);
});

test('loads the isolated local Keycloak overlay only in OIDC test mode', () => {
  assert.deepEqual(composeArguments('oidc', ['ps'], false), [
    '-f',
    'compose.yaml',
    '-f',
    'compose.oidc.yaml',
    '--profile',
    'configuration',
    '--env-file',
    '.env',
    'ps',
  ]);
});

test('uses the hardened production overlay and separate environment file', () => {
  assert.deepEqual(composeArguments('production', ['config'], true, '.env.production'), [
    '-f',
    'compose.yaml',
    '-f',
    'compose.dwg.yaml',
    '-f',
    'compose.production.yaml',
    '--profile',
    'configuration',
    '--env-file',
    '.env.production',
    '--env-file',
    'config/runtime.env',
    'config',
  ]);
});

test('rejects unknown compose modes', () => {
  assert.equal(composeArguments('unknown', [], true), null);
});
