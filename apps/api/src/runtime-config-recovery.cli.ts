import { PrismaClient } from '@prisma/client';

import { AclPolicy } from './auth/acl-policy';
import type { OperationalLogger } from './common/operational-logger';
import { AppConfig } from './config/app-config';
import type { PrismaService } from './database/prisma.service';
import { serializeRuntimeEnvironment } from './system/runtime-environment';
import { SystemConfigurationService } from './system/system-configuration.service';

function outputFormat(): 'env' | 'metadata' {
  const [flag, value, ...rest] = process.argv.slice(2);
  if (flag !== '--format' || !['env', 'metadata'].includes(value ?? '') || rest.length > 0) {
    throw new Error('Usage: runtime-config-recovery --format <env|metadata>');
  }
  return value as 'env' | 'metadata';
}

async function main(): Promise<void> {
  const format = outputFormat();
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    const configurations = new SystemConfigurationService(
      new AppConfig(),
      prisma as unknown as PrismaService,
      new AclPolicy(),
      {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      } as unknown as OperationalLogger,
    );
    const recovered = await configurations.recoveryRuntimeConfiguration();
    if (format === 'env') {
      process.stdout.write(serializeRuntimeEnvironment(recovered.environment));
      return;
    }
    const activeVersions = await prisma.documentVersion.findMany({
      where: { status: 'active', embeddingFingerprint: { not: null } },
      select: { embeddingFingerprint: true, vectorCollection: true },
    });
    const indexCounts = new Map<
      string,
      { fingerprint: string; collection: string; count: number }
    >();
    for (const version of activeVersions) {
      if (!version.embeddingFingerprint || !version.vectorCollection) continue;
      const key = `${version.embeddingFingerprint}\0${version.vectorCollection}`;
      const current = indexCounts.get(key);
      if (current) current.count += 1;
      else {
        indexCounts.set(key, {
          fingerprint: version.embeddingFingerprint,
          collection: version.vectorCollection,
          count: 1,
        });
      }
    }
    process.stdout.write(
      `${JSON.stringify({
        ...recovered.metadata,
        activeEmbeddingIndexes: [...indexCounts.values()].sort((left, right) =>
          left.fingerprint.localeCompare(right.fingerprint),
        ),
      })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Runtime config recovery failed'}\n`,
  );
  process.exitCode = 1;
});
