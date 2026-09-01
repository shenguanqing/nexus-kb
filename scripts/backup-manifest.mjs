import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

export const backupFileNames = [
  'postgres.dump',
  'documents.tar',
  'chroma.tar',
  'redis.tar',
  'runtime-config.metadata.json',
];

export async function sha256File(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

const hostSpecificProductionFields = new Set([
  'NEXUS_KB_SECRETS_DIR',
  'NEXUS_KB_COMPOSE_PROJECT_NAME',
  'NEXUS_KB_OPERATION_SERVICES',
  'NEXUS_KB_HTTP_BIND',
  'NEXUS_KB_HTTPS_BIND',
  'NEXUS_KB_DEPLOYMENT_UID',
  'NEXUS_KB_DOCKER_GID',
]);

export function releaseImages(environment) {
  return Object.fromEntries(
    Object.entries(environment)
      .filter(([name]) => name.endsWith('_IMAGE'))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function assertReleaseImagesMatch(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('RELEASE_IMAGE_MISMATCH');
  }
}

export function productionEnvironmentSha256(environment) {
  const normalized = Object.entries(environment)
    .filter(([name]) => {
      if (hostSpecificProductionFields.has(name) || name.endsWith('_IMAGE')) return false;
      if (name.startsWith('DEV_') || name.startsWith('KEYCLOAK_TEST_')) return false;
      if (name.endsWith('_FILE') || name.endsWith('_API_KEY') || name.endsWith('_TOKEN'))
        return false;
      return ![
        'POSTGRES_PASSWORD',
        'DATABASE_URL',
        'REDIS_URL',
        'PASSWORD_AUTH_USERS_JSON',
        'SYSTEM_CONFIG_ENCRYPTION_KEY',
      ].includes(name);
    })
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(normalized)))
    .digest('hex');
}

export async function createBackupManifest(directory, metadata) {
  const files = [];
  for (const name of backupFileNames) {
    const filename = path.join(directory, name);
    const stats = statSync(filename);
    if (!stats.isFile() || stats.size < 1) throw new Error(`BACKUP_FILE_INVALID:${name}`);
    files.push({ name, sizeBytes: stats.size, sha256: await sha256File(filename) });
  }
  return {
    schemaVersion: 1,
    createdAt: metadata.createdAt,
    project: 'nexus-kb',
    releaseImages: metadata.releaseImages,
    productionEnvironmentSha256: metadata.productionEnvironmentSha256,
    runtimeConfiguration: metadata.runtimeConfiguration,
    consistency: 'application_writes_stopped',
    includes: ['postgresql', 'raw_documents', 'preview_artifacts', 'chroma', 'redis'],
    files,
  };
}

export function assertRuntimeConfigurationState(metadata, actualRuntimeEnvSha256) {
  if (
    !metadata ||
    metadata.schemaVersion !== 1 ||
    typeof metadata.active !== 'boolean' ||
    !/^[0-9a-f]{64}$/.test(metadata.runtimeEnvSha256 ?? '') ||
    !Array.isArray(metadata.activeEmbeddingIndexes) ||
    'environment' in metadata
  ) {
    throw new Error('RUNTIME_CONFIG_METADATA_INVALID');
  }
  if (
    (metadata.active && actualRuntimeEnvSha256 !== metadata.runtimeEnvSha256) ||
    (!metadata.active &&
      actualRuntimeEnvSha256 !== null &&
      actualRuntimeEnvSha256 !== metadata.runtimeEnvSha256)
  ) {
    throw new Error('ACTIVE_RUNTIME_CONFIG_DRIFT');
  }
}

export function assertRecoveredRuntimeMetadata(expected, actual) {
  const scalarKeys = [
    'schemaVersion',
    'active',
    'tenantId',
    'configVersionId',
    'version',
    'activatedAt',
    'runtimeEnvSha256',
    'valuesSha256',
  ];
  const scalarMismatch = scalarKeys.some((key) => expected?.[key] !== actual?.[key]);
  const structuredMismatch =
    JSON.stringify(expected?.secretConfigured) !== JSON.stringify(actual?.secretConfigured) ||
    JSON.stringify(expected?.activeEmbeddingIndexes) !==
      JSON.stringify(actual?.activeEmbeddingIndexes);
  if (scalarMismatch || structuredMismatch) {
    throw new Error('RUNTIME_CONFIG_METADATA_MISMATCH');
  }
}

export async function validateBackupManifest(directory, manifest) {
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    manifest.schemaVersion !== 1 ||
    manifest.project !== 'nexus-kb' ||
    !manifest.releaseImages ||
    Object.keys(manifest.releaseImages).length === 0 ||
    Object.values(manifest.releaseImages).some(
      (value) => !/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(value),
    ) ||
    !/^[0-9a-f]{64}$/.test(manifest.productionEnvironmentSha256 ?? '') ||
    !/^[0-9a-f]{64}$/.test(manifest.runtimeConfiguration?.runtimeEnvSha256 ?? '') ||
    !Array.isArray(manifest.runtimeConfiguration?.activeEmbeddingIndexes) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }
  const files = new Map(manifest.files.map((file) => [file.name, file]));
  for (const name of backupFileNames) {
    const expected = files.get(name);
    if (
      !expected ||
      !Number.isSafeInteger(expected.sizeBytes) ||
      expected.sizeBytes < 1 ||
      !/^[0-9a-f]{64}$/.test(expected.sha256)
    ) {
      throw new Error(`BACKUP_MANIFEST_FILE_INVALID:${name}`);
    }
    const filename = path.join(directory, name);
    const stats = statSync(filename);
    if (stats.size !== expected.sizeBytes || (await sha256File(filename)) !== expected.sha256) {
      throw new Error(`BACKUP_CHECKSUM_MISMATCH:${name}`);
    }
  }
}
