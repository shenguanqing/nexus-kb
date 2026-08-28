import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import type { PrismaService } from '../src/database/prisma.service';
import { CloudPolicyService } from '../src/ingestion/cloud-policy';
import type { EmbeddingProvider } from '../src/providers/embedding/embedding-provider';
import type { EmbeddingProviderFactory } from '../src/providers/embedding/embedding-provider.factory';
import { EmbeddingService } from '../src/providers/embedding/embedding.service';
import { ProviderError } from '../src/providers/embedding/provider-error';
import type { MetricsService } from '../src/observability/metrics.service';

function policyConfig(): AppConfig {
  return {
    values: {
      ALLOW_CONFIDENTIAL_TO_CLOUD: false,
      CLOUD_EGRESS_RULES_JSON: [],
    },
  } as unknown as AppConfig;
}

function cacheConfig(): AppConfig {
  return {
    values: {
      ALLOW_CONFIDENTIAL_TO_CLOUD: false,
      CLOUD_EGRESS_RULES_JSON: [],
      EMBEDDING_BATCH_SIZE: 2,
      EMBEDDING_CACHE_TTL_SECONDS: 3600,
    },
  } as unknown as AppConfig;
}

interface CacheRow {
  key: string;
  tenantId: string;
  textSha256: string;
  embeddingFingerprint: string;
  provider: string;
  model: string;
  dimensions: number;
  taskRule: string;
  chunkMaxTokens: number;
  chunkOverlapTokens: number;
  redactionPolicyVersion: string;
  vector: number[];
  expiresAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
}

function cachePrisma() {
  const entries = new Map<string, CacheRow>();
  const embeddingCacheEntry = {
    deleteMany: vi.fn().mockImplementation(() => Promise.resolve({ count: 0 })),
    findMany: vi
      .fn()
      .mockImplementation((input: { where: { key: { in: string[] }; expiresAt: { gt: Date } } }) =>
        Promise.resolve(
          input.where.key.in.flatMap((key) => {
            const entry = entries.get(key);
            return entry && entry.expiresAt > input.where.expiresAt.gt ? [entry] : [];
          }),
        ),
      ),
    upsert: vi
      .fn()
      .mockImplementation(
        (input: {
          where: { key: string };
          create: Omit<CacheRow, 'lastUsedAt' | 'createdAt'>;
          update: Pick<CacheRow, 'vector' | 'expiresAt' | 'lastUsedAt'>;
        }) => {
          const existing = entries.get(input.where.key);
          const row: CacheRow = existing
            ? { ...existing, ...input.update }
            : { ...input.create, lastUsedAt: new Date(), createdAt: new Date() };
          entries.set(row.key, row);
          return Promise.resolve(row);
        },
      ),
    updateMany: vi
      .fn()
      .mockImplementation(
        (input: {
          where: { key: { in: string[] } };
          data: Pick<CacheRow, 'expiresAt' | 'lastUsedAt'>;
        }) => {
          for (const key of input.where.key.in) {
            const existing = entries.get(key);
            if (existing) entries.set(key, { ...existing, ...input.data });
          }
          return Promise.resolve({ count: input.where.key.in.length });
        },
      ),
  };
  return {
    entries,
    embeddingCacheEntry,
    prisma: {
      embeddingCacheEntry,
      $transaction: (operations: Array<Promise<unknown>>) => Promise.all(operations),
    } as unknown as PrismaService,
  };
}

function cacheFactory(embeddingProvider: EmbeddingProvider): EmbeddingProviderFactory {
  return {
    getProvider: () => embeddingProvider,
    getFingerprint: () => ({
      value: 'f'.repeat(64),
      configuration: {
        provider: embeddingProvider.id,
        model: embeddingProvider.model,
        dimensions: embeddingProvider.dimensions,
        taskMode: embeddingProvider.taskMode,
        chunkMaxTokens: 600,
        chunkOverlapTokens: 80,
        redactionPolicyVersion: 'v1',
      },
    }),
  } as EmbeddingProviderFactory;
}

function provider() {
  const embedDocuments = vi
    .fn<EmbeddingProvider['embedDocuments']>()
    .mockResolvedValue([[0, 1, 2]]);
  const embedQuery = vi.fn<EmbeddingProvider['embedQuery']>().mockResolvedValue([0, 1, 2]);
  return {
    embeddingProvider: {
      id: 'alibaba',
      model: 'text-embedding-v4',
      dimensions: 3,
      region: 'cn-beijing',
      taskMode: 'symmetric',
      documentTaskRule: 'SYMMETRIC',
      queryTaskRule: 'SYMMETRIC',
      embedDocuments,
      embedQuery,
    } satisfies EmbeddingProvider,
    embedDocuments,
    embedQuery,
  };
}

describe('EmbeddingService', () => {
  it('blocks confidential content before invoking the configured provider', async () => {
    const { embeddingProvider, embedDocuments } = provider();
    const factory = {
      getProvider: () => embeddingProvider,
    } as EmbeddingProviderFactory;
    const service = new EmbeddingService(
      factory,
      new CloudPolicyService(policyConfig()),
      {} as PrismaService,
      cacheConfig(),
    );

    await expect(
      service.embedDocuments(['confidential text'], { sensitivity: 'confidential' }),
    ).rejects.toMatchObject({
      kind: 'policy_denied',
    });
    expect(embedDocuments).not.toHaveBeenCalled();
  });

  it('uses separate document and query operations for allowed content', async () => {
    const { embeddingProvider, embedDocuments, embedQuery } = provider();
    const factory = {
      getProvider: () => embeddingProvider,
    } as EmbeddingProviderFactory;
    const service = new EmbeddingService(
      factory,
      new CloudPolicyService(policyConfig()),
      {} as PrismaService,
      cacheConfig(),
    );

    await expect(
      service.embedDocuments(['internal text'], { sensitivity: 'internal' }),
    ).resolves.toEqual([[0, 1, 2]]);
    await expect(service.embedQuery('question', { sensitivity: 'internal' })).resolves.toEqual([
      0, 1, 2,
    ]);
    expect(embedDocuments).toHaveBeenCalledOnce();
    expect(embedQuery).toHaveBeenCalledOnce();
  });

  it('reuses duplicate text within the same fingerprint and tenant cache scope', async () => {
    const { embeddingProvider, embedDocuments } = provider();
    const { prisma, entries, embeddingCacheEntry } = cachePrisma();
    const observeEmbeddingCache = vi.fn();
    const service = new EmbeddingService(
      cacheFactory(embeddingProvider),
      new CloudPolicyService(cacheConfig()),
      prisma,
      cacheConfig(),
      { observeEmbeddingCache } as unknown as MetricsService,
    );

    await expect(
      service.embedDocuments(['same text', 'same text'], {
        sensitivity: 'internal',
        tenantId: 'tenant-a',
      }),
    ).resolves.toEqual([
      [0, 1, 2],
      [0, 1, 2],
    ]);
    await service.embedDocuments(['same text'], {
      sensitivity: 'internal',
      tenantId: 'tenant-a',
    });

    expect(embedDocuments).toHaveBeenCalledTimes(1);
    expect(embedDocuments).toHaveBeenCalledWith(['same text']);
    expect(entries.size).toBe(1);
    expect(embeddingCacheEntry.deleteMany).toHaveBeenCalledOnce();
    expect(embeddingCacheEntry.updateMany).not.toHaveBeenCalled();
    expect(observeEmbeddingCache.mock.calls).toEqual([
      ['documents', 'miss'],
      ['documents', 'hit'],
    ]);
  });

  it('resumes provider work at the first uncached batch after a batch failure', async () => {
    const { embeddingProvider, embedDocuments } = provider();
    embedDocuments
      .mockResolvedValueOnce([
        [1, 0, 0],
        [0, 1, 0],
      ])
      .mockRejectedValueOnce(new ProviderError('unavailable', true));
    const { prisma } = cachePrisma();
    const service = new EmbeddingService(
      cacheFactory(embeddingProvider),
      new CloudPolicyService(cacheConfig()),
      prisma,
      cacheConfig(),
    );
    const texts = ['one', 'two', 'three', 'four', 'five'];
    const firstProgress: number[] = [];

    await expect(
      service.embedDocuments(texts, {
        sensitivity: 'internal',
        tenantId: 'tenant-a',
        onBatchCompleted: (progress) => {
          firstProgress.push(progress.completedChunks);
          return Promise.resolve();
        },
      }),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect(firstProgress).toEqual([2]);

    embedDocuments.mockImplementation((batch) =>
      Promise.resolve(batch.map((_text, index) => (index === 0 ? [0, 0, 1] : [1, 1, 0]))),
    );
    const callsBeforeRetry = embedDocuments.mock.calls.length;
    const retryProgress: number[] = [];
    await service.embedDocuments(texts, {
      sensitivity: 'internal',
      tenantId: 'tenant-a',
      onBatchCompleted: (progress) => {
        retryProgress.push(progress.completedChunks);
        return Promise.resolve();
      },
    });

    expect(embedDocuments.mock.calls.slice(callsBeforeRetry)).toEqual([
      [['three', 'four']],
      [['five']],
    ]);
    expect(retryProgress).toEqual([2, 4, 5]);
  });
});
