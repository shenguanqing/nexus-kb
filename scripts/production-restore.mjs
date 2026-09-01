import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  assertRecoveredRuntimeMetadata,
  assertReleaseImagesMatch,
  productionEnvironmentSha256,
  releaseImages,
  sha256File,
  validateBackupManifest,
} from './backup-manifest.mjs';
import { runProductionPreflight } from './production-preflight.mjs';
import { applicationServices, operationServices, runDocker } from './production-operations.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function waitForReadiness() {
  const script =
    "fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await runDocker(['exec', '-T', 'api', 'node', '-e', script]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error('RESTORE_READINESS_FAILED');
}

async function main() {
  if (argument('--confirm') !== 'RESTORE_NEXUSKB_BACKUP') {
    throw new Error(
      'Restore is destructive; pass --confirm RESTORE_NEXUSKB_BACKUP with an approved backup',
    );
  }
  const backupArgument = argument('--backup');
  if (!backupArgument)
    throw new Error(
      'Usage: production-restore --backup <directory> --confirm RESTORE_NEXUSKB_BACKUP',
    );
  const directory = path.resolve(backupArgument);
  if (directory === '/') throw new Error('BACKUP_DIRECTORY_INVALID');
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  await validateBackupManifest(directory, manifest);
  const preflight = runProductionPreflight();
  assertReleaseImagesMatch(manifest.releaseImages, releaseImages(preflight.environment));
  if (productionEnvironmentSha256(preflight.environment) !== manifest.productionEnvironmentSha256) {
    throw new Error('PRODUCTION_ENVIRONMENT_MISMATCH');
  }
  const runtimeMetadata = JSON.parse(
    readFileSync(path.join(directory, 'runtime-config.metadata.json'), 'utf8'),
  );
  if (
    runtimeMetadata?.runtimeEnvSha256 !== manifest.runtimeConfiguration.runtimeEnvSha256 ||
    runtimeMetadata?.configVersionId !== manifest.runtimeConfiguration.configVersionId
  ) {
    throw new Error('RUNTIME_CONFIG_METADATA_MISMATCH');
  }
  const servicesToStart = operationServices();
  const runtimeEnvironmentPath = path.resolve('config/runtime.env');
  const previousRuntimeEnvironmentPath = path.resolve('config/runtime.env.pre-restore');
  const temporaryRuntimeEnvironmentPath = path.resolve('config/runtime.env.recovery.tmp');
  const temporaryRuntimeMetadataPath = path.resolve('config/runtime.env.recovery.metadata.tmp');
  if (
    existsSync(previousRuntimeEnvironmentPath) ||
    existsSync(temporaryRuntimeEnvironmentPath) ||
    existsSync(temporaryRuntimeMetadataPath)
  ) {
    throw new Error('RUNTIME_CONFIG_RECOVERY_FILE_EXISTS');
  }

  await runDocker(['stop', ...applicationServices(), 'redis', 'chroma']);
  await runDocker(['up', '-d', 'postgres']);
  await runDocker([
    'exec',
    '-T',
    'postgres',
    'sh',
    '-ec',
    'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DO \\$\\$ DECLARE table_row record; row_count bigint; BEGIN FOR table_row IN SELECT tablename FROM pg_tables WHERE schemaname = \'public\' LOOP EXECUTE format(\'SELECT count(*) FROM %I\', table_row.tablename) INTO row_count; IF row_count > 0 THEN RAISE EXCEPTION \'target_database_not_empty\'; END IF; END LOOP; END \\$\\$;"',
  ]);
  await runDocker([
    'run',
    '--rm',
    '--no-deps',
    '--entrypoint',
    'sh',
    'api',
    '-ec',
    '[ -z "$(find /data/raw-docs /data/previews -mindepth 1 -print -quit)" ] || { echo target_document_volumes_not_empty >&2; exit 42; }',
  ]);

  const hadRuntimeEnvironment = existsSync(runtimeEnvironmentPath);
  if (hadRuntimeEnvironment) {
    renameSync(runtimeEnvironmentPath, previousRuntimeEnvironmentPath);
  }
  writeFileSync(runtimeEnvironmentPath, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  chmodSync(runtimeEnvironmentPath, 0o600);

  try {
    await runDocker(
      [
        'exec',
        '-T',
        'postgres',
        'sh',
        '-ec',
        'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges',
      ],
      { inputFile: path.join(directory, 'postgres.dump') },
    );
    await runDocker(
      [
        'run',
        '--rm',
        '--no-deps',
        'api',
        'node',
        'apps/api/dist/runtime-config-recovery.cli.js',
        '--format',
        'metadata',
      ],
      { outputFile: temporaryRuntimeMetadataPath },
    );
    const recoveredRuntimeMetadata = JSON.parse(readFileSync(temporaryRuntimeMetadataPath, 'utf8'));
    assertRecoveredRuntimeMetadata(runtimeMetadata, recoveredRuntimeMetadata);
    unlinkSync(temporaryRuntimeMetadataPath);
    await runDocker(
      [
        'run',
        '--rm',
        '--no-deps',
        'api',
        'node',
        'apps/api/dist/runtime-config-recovery.cli.js',
        '--format',
        'env',
      ],
      { outputFile: temporaryRuntimeEnvironmentPath },
    );
    if (
      (await sha256File(temporaryRuntimeEnvironmentPath)) !==
      manifest.runtimeConfiguration.runtimeEnvSha256
    ) {
      throw new Error('RUNTIME_CONFIG_RECOVERY_MISMATCH');
    }
    chmodSync(temporaryRuntimeEnvironmentPath, 0o600);
    renameSync(temporaryRuntimeEnvironmentPath, runtimeEnvironmentPath);

    await runDocker(
      [
        'run',
        '--rm',
        '--no-deps',
        '--entrypoint',
        'tar',
        'api',
        '--no-same-owner',
        '-C',
        '/data',
        '-xf',
        '-',
      ],
      { inputFile: path.join(directory, 'documents.tar') },
    );
    await runDocker([
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'sh',
      'api',
      '-ec',
      'find /data/raw-docs -type d -exec chmod 0755 {} +; find /data/raw-docs -type f -exec chmod 0644 {} +; find /data/previews -type d -exec chmod 2770 {} +; find /data/previews -type f -exec chmod 0660 {} +',
    ]);
    await runDocker(
      ['run', '--rm', '--no-deps', '--entrypoint', 'tar', 'chroma', '-C', '/data', '-xf', '-'],
      { inputFile: path.join(directory, 'chroma.tar') },
    );
    await runDocker(
      ['run', '--rm', '--no-deps', '--entrypoint', 'tar', 'redis', '-C', '/data', '-xf', '-'],
      { inputFile: path.join(directory, 'redis.tar') },
    );

    await runDocker(['up', '-d', ...servicesToStart]);
    await waitForReadiness();
    await runDocker([
      'exec',
      '-T',
      'postgres',
      'sh',
      '-ec',
      'invalid=$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM \"Document\" d WHERE d.status = \'active\' AND NOT EXISTS (SELECT 1 FROM \"DocumentVersion\" v WHERE v.\"documentId\" = d.id AND v.version = d.\"activeVersion\" AND v.status = \'active\')"); [ "$invalid" = 0 ] || { echo active_version_integrity_failed >&2; exit 43; }',
    ]);
    if (hadRuntimeEnvironment) unlinkSync(previousRuntimeEnvironmentPath);
    process.stdout.write('Restore completed and readiness/integrity checks passed.\n');
  } catch (error) {
    if (existsSync(temporaryRuntimeEnvironmentPath)) unlinkSync(temporaryRuntimeEnvironmentPath);
    if (existsSync(temporaryRuntimeMetadataPath)) unlinkSync(temporaryRuntimeMetadataPath);
    throw error;
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Production restore failed'}\n`);
  process.exitCode = 1;
});
