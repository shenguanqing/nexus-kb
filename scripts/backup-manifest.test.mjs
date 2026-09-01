import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertRecoveredRuntimeMetadata,
  assertReleaseImagesMatch,
  assertRuntimeConfigurationState,
  backupFileNames,
  createBackupManifest,
  productionEnvironmentSha256,
  releaseImages,
  validateBackupManifest,
} from './backup-manifest.mjs';

test('creates and verifies a checksum-protected backup manifest', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nexuskb-backup-'));
  for (const name of backupFileNames) writeFileSync(path.join(directory, name), `fixture-${name}`);
  const manifest = await createBackupManifest(directory, {
    createdAt: '2026-08-31T00:00:00.000Z',
    releaseImages: { NEXUS_KB_API_IMAGE: `registry/api@sha256:${'c'.repeat(64)}` },
    productionEnvironmentSha256: 'a'.repeat(64),
    runtimeConfiguration: {
      active: false,
      runtimeEnvSha256: 'b'.repeat(64),
      activeEmbeddingIndexes: [],
    },
  });
  await assert.doesNotReject(() => validateBackupManifest(directory, manifest));
  writeFileSync(path.join(directory, backupFileNames[0]), 'tampered');
  await assert.rejects(
    () => validateBackupManifest(directory, manifest),
    /BACKUP_CHECKSUM_MISMATCH/,
  );
});

test('rejects a backup manifest without pinned release images', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nexuskb-backup-'));
  for (const name of backupFileNames) writeFileSync(path.join(directory, name), `fixture-${name}`);
  const manifest = await createBackupManifest(directory, {
    createdAt: '2026-08-31T00:00:00.000Z',
    releaseImages: {},
    productionEnvironmentSha256: 'a'.repeat(64),
    runtimeConfiguration: {
      active: false,
      runtimeEnvSha256: 'b'.repeat(64),
      activeEmbeddingIndexes: [],
    },
  });
  await assert.rejects(
    () => validateBackupManifest(directory, manifest),
    /BACKUP_MANIFEST_INVALID/,
  );
});

test('requires restore to use the exact backed-up image digests', () => {
  const environment = {
    NEXUS_KB_WEB_IMAGE: `registry/web@sha256:${'a'.repeat(64)}`,
    NEXUS_KB_API_IMAGE: `registry/api@sha256:${'b'.repeat(64)}`,
  };
  const images = releaseImages(environment);
  assert.doesNotThrow(() => assertReleaseImagesMatch(images, structuredClone(images)));
  assert.throws(
    () =>
      assertReleaseImagesMatch(images, {
        ...images,
        NEXUS_KB_API_IMAGE: `registry/api@sha256:${'c'.repeat(64)}`,
      }),
    /RELEASE_IMAGE_MISMATCH/,
  );
});

test('fingerprints functional production config but ignores host-local deployment values', () => {
  const first = {
    NODE_ENV: 'production',
    OIDC_ISSUER: 'https://id.example.test',
    NEXUS_KB_DEPLOYMENT_UID: '1000',
    NEXUS_KB_API_IMAGE: `registry/api@sha256:${'a'.repeat(64)}`,
    OPENAI_API_KEY: 'must-not-affect-fingerprint',
  };
  const second = {
    ...first,
    NEXUS_KB_DEPLOYMENT_UID: '2000',
    NEXUS_KB_API_IMAGE: `registry/api@sha256:${'b'.repeat(64)}`,
    OPENAI_API_KEY: 'different-secret',
  };
  assert.equal(productionEnvironmentSha256(first), productionEnvironmentSha256(second));
  assert.notEqual(
    productionEnvironmentSha256(first),
    productionEnvironmentSha256({ ...first, OIDC_ISSUER: 'https://other.example.test' }),
  );
});

test('compares recovered config and embedding metadata exactly', () => {
  const metadata = {
    schemaVersion: 1,
    active: true,
    tenantId: 'tenant-a',
    configVersionId: 'version-a',
    version: 2,
    activatedAt: '2026-09-01T00:00:00.000Z',
    runtimeEnvSha256: 'a'.repeat(64),
    valuesSha256: 'b'.repeat(64),
    secretConfigured: { OPENAI_API_KEY: false },
    activeEmbeddingIndexes: [{ fingerprint: 'c'.repeat(64), collection: 'collection', count: 1 }],
  };
  assert.doesNotThrow(() => assertRecoveredRuntimeMetadata(metadata, structuredClone(metadata)));
  assert.throws(
    () =>
      assertRecoveredRuntimeMetadata(metadata, {
        ...metadata,
        activeEmbeddingIndexes: [{ ...metadata.activeEmbeddingIndexes[0], count: 2 }],
      }),
    /RUNTIME_CONFIG_METADATA_MISMATCH/,
  );
});

test('fails closed when an active database config drifts from runtime.env', () => {
  const metadata = {
    schemaVersion: 1,
    active: true,
    runtimeEnvSha256: 'a'.repeat(64),
    activeEmbeddingIndexes: [],
  };
  assert.doesNotThrow(() => assertRuntimeConfigurationState(metadata, 'a'.repeat(64)));
  assert.throws(
    () => assertRuntimeConfigurationState(metadata, 'b'.repeat(64)),
    /ACTIVE_RUNTIME_CONFIG_DRIFT/,
  );
  assert.doesNotThrow(() => assertRuntimeConfigurationState({ ...metadata, active: false }, null));
});
