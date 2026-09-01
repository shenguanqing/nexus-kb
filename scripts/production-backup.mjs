import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  assertRuntimeConfigurationState,
  createBackupManifest,
  productionEnvironmentSha256,
  releaseImages,
  sha256File,
} from './backup-manifest.mjs';
import { runProductionPreflight } from './production-preflight.mjs';
import { applicationServices, runDocker, runDockerCapture } from './production-operations.mjs';

function outputRoot() {
  const index = process.argv.indexOf('--output');
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error('Usage: production-backup --output <absolute-directory>');
  }
  const value = path.resolve(process.argv[index + 1]);
  if (!path.isAbsolute(value) || value === '/') throw new Error('BACKUP_OUTPUT_INVALID');
  return value;
}

async function main() {
  const preflight = runProductionPreflight();
  const root = outputRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const createdAt = new Date().toISOString();
  const directory = path.join(root, `${createdAt.replace(/[:.]/g, '-')}-${randomUUID()}`);
  mkdirSync(directory, { mode: 0o700 });

  const previouslyRunning = (await runDockerCapture(['ps', '--services', '--status', 'running']))
    .split(/\r?\n/)
    .filter(Boolean);
  const applicationToStop = applicationServices().filter((service) =>
    previouslyRunning.includes(service),
  );
  const dataToStop = ['redis', 'chroma'].filter((service) => previouslyRunning.includes(service));
  let stoppedServices = false;
  try {
    if (applicationToStop.length > 0) await runDocker(['stop', ...applicationToStop]);
    stoppedServices = true;
    if (dataToStop.length > 0) await runDocker(['stop', ...dataToStop]);

    await runDocker(
      [
        'exec',
        '-T',
        'postgres',
        'sh',
        '-ec',
        'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges',
      ],
      { outputFile: path.join(directory, 'postgres.dump') },
    );
    await runDocker(
      [
        'run',
        '--rm',
        '--no-deps',
        '--entrypoint',
        'tar',
        'api',
        '-C',
        '/data',
        '-cf',
        '-',
        'raw-docs',
        'previews',
      ],
      { outputFile: path.join(directory, 'documents.tar') },
    );
    await runDocker(
      ['run', '--rm', '--no-deps', '--entrypoint', 'tar', 'chroma', '-C', '/data', '-cf', '-', '.'],
      { outputFile: path.join(directory, 'chroma.tar') },
    );
    await runDocker(
      ['run', '--rm', '--no-deps', '--entrypoint', 'tar', 'redis', '-C', '/data', '-cf', '-', '.'],
      { outputFile: path.join(directory, 'redis.tar') },
    );
    const runtimeMetadataFile = path.join(directory, 'runtime-config.metadata.json');
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
      { outputFile: runtimeMetadataFile },
    );
    const runtimeConfiguration = JSON.parse(readFileSync(runtimeMetadataFile, 'utf8'));
    const runtimeEnvironmentPath = 'config/runtime.env';
    const runtimeEnvironmentSha256 = existsSync(runtimeEnvironmentPath)
      ? await sha256File(runtimeEnvironmentPath)
      : null;
    assertRuntimeConfigurationState(runtimeConfiguration, runtimeEnvironmentSha256);

    const environment = preflight.environment;
    const manifest = await createBackupManifest(directory, {
      createdAt,
      releaseImages: releaseImages(environment),
      productionEnvironmentSha256: productionEnvironmentSha256(environment),
      runtimeConfiguration: {
        active: runtimeConfiguration.active,
        tenantId: runtimeConfiguration.tenantId,
        configVersionId: runtimeConfiguration.configVersionId,
        version: runtimeConfiguration.version,
        activatedAt: runtimeConfiguration.activatedAt,
        runtimeEnvSha256: runtimeConfiguration.runtimeEnvSha256,
        activeEmbeddingIndexes: runtimeConfiguration.activeEmbeddingIndexes,
      },
    });
    const manifestFile = path.join(directory, 'manifest.json');
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    process.stdout.write(`Backup completed: ${directory}\n`);
  } finally {
    if (stoppedServices && previouslyRunning.length > 0) {
      await runDocker(['up', '-d', ...previouslyRunning]);
    }
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Production backup failed'}\n`);
  process.exitCode = 1;
});
