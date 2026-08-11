import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../database/prisma.service';
import { CloudPolicyService } from '../../ingestion/cloud-policy';
import { createEmbeddingCacheKey } from './embedding-cache-key';
import { EmbeddingProviderFactory } from './embedding-provider.factory';
import type { EmbeddingProvider } from './embedding-provider';
import { ProviderError } from './provider-error';

interface EmbeddingPolicyContext {
  sensitivity: 'public' | 'internal' | 'confidential';
  tenantId?: string;
  onBatchCompleted?: (progress: EmbeddingBatchProgress) => Promise<void>;
}

export interface EmbeddingBatchProgress {
  completedChunks: number;
  totalChunks: number;
  completedBatches: number;
  totalBatches: number;
  batchSize: number;
  cacheKeys: string[];
}

@Injectable()
export class EmbeddingService {
  constructor(
    private readonly factory: EmbeddingProviderFactory,
    private readonly cloudPolicy: CloudPolicyService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async embedDocuments(texts: string[], context: EmbeddingPolicyContext): Promise<number[][]> {
    const provider = this.factory.getProvider();
    this.assertPolicyAllowed(provider, context);
    if (!context.tenantId) return provider.embedDocuments(texts);
    return this.embedWithCache(texts, provider, 'documents', {
      ...context,
      tenantId: context.tenantId,
    });
  }

  async embedQuery(text: string, context: EmbeddingPolicyContext): Promise<number[]> {
    const provider = this.factory.getProvider();
    this.assertPolicyAllowed(provider, context);
    if (!context.tenantId) return provider.embedQuery(text);
    const [vector] = await this.embedWithCache([text], provider, 'query', {
      ...context,
      tenantId: context.tenantId,
    });
    if (!vector) throw new ProviderError('invalid_response', false);
    return vector;
  }

  private assertPolicyAllowed(provider: EmbeddingProvider, context: EmbeddingPolicyContext): void {
    const policy = this.cloudPolicy.evaluate({
      sensitivity: context.sensitivity,
      providerId: provider.id,
      region: provider.region,
    });
    if (policy.decision === 'blocked') throw new ProviderError('policy_denied', false);
  }

  private async embedWithCache(
    texts: string[],
    provider: EmbeddingProvider,
    operation: 'documents' | 'query',
    context: EmbeddingPolicyContext & { tenantId: string },
  ): Promise<number[][]> {
    if (texts.length === 0 || texts.some((text) => !text.trim())) {
      throw new ProviderError('invalid_request', false);
    }
    const prisma = this.prisma;
    const config = this.config;
    const fingerprint = this.factory.getFingerprint();
    const batchSize = operation === 'query' ? 1 : config.values.EMBEDDING_BATCH_SIZE;
    const totalBatches = Math.ceil(texts.length / batchSize);
    const expiresAt = () => new Date(Date.now() + config.values.EMBEDDING_CACHE_TTL_SECONDS * 1000);
    const vectors: number[][] = [];
    await prisma.embeddingCacheEntry.deleteMany({
      where: { tenantId: context.tenantId, expiresAt: { lte: new Date() } },
    });

    for (let offset = 0; offset < texts.length; offset += batchSize) {
      const batch = texts.slice(offset, offset + batchSize);
      const taskRule =
        operation === 'documents' ? provider.documentTaskRule : provider.queryTaskRule;
      const identities = batch.map((text) =>
        createEmbeddingCacheKey({ tenantId: context.tenantId, text, taskRule, fingerprint }),
      );
      const cached = await prisma.embeddingCacheEntry.findMany({
        where: {
          tenantId: context.tenantId,
          key: { in: [...new Set(identities.map((identity) => identity.key))] },
          expiresAt: { gt: new Date() },
        },
      });
      const cachedVectors = new Map(
        cached.flatMap((entry) => {
          const vector = this.validVector(entry.vector, provider.dimensions);
          const identity = identities.find((candidate) => candidate.key === entry.key);
          return vector && identity && this.cacheEntryMatches(entry, identity)
            ? ([[entry.key, vector]] as const)
            : [];
        }),
      );
      const missingByKey = new Map<string, { text: string; index: number }>();
      identities.forEach((identity, index) => {
        if (!cachedVectors.has(identity.key) && !missingByKey.has(identity.key)) {
          missingByKey.set(identity.key, { text: batch[index]!, index });
        }
      });
      if (missingByKey.size > 0) {
        const missing = [...missingByKey.values()];
        const generated =
          operation === 'documents'
            ? await provider.embedDocuments(missing.map((item) => item.text))
            : [await provider.embedQuery(missing[0]!.text)];
        if (generated.length !== missing.length) throw new ProviderError('invalid_response', false);
        await prisma.$transaction(
          missing.map((item, index) => {
            const identity = identities[item.index]!;
            const vector = generated[index];
            if (!vector || !this.validVector(vector, provider.dimensions)) {
              throw new ProviderError('invalid_response', false);
            }
            cachedVectors.set(identity.key, vector);
            return prisma.embeddingCacheEntry.upsert({
              where: { key: identity.key },
              create: {
                ...identity,
                tenantId: context.tenantId,
                vector,
                expiresAt: expiresAt(),
              },
              update: {
                vector,
                expiresAt: expiresAt(),
                lastUsedAt: new Date(),
              },
            });
          }),
        );
      }
      const batchVectors = identities.map((identity) => cachedVectors.get(identity.key));
      if (batchVectors.some((vector) => !vector))
        throw new ProviderError('invalid_response', false);
      await prisma.embeddingCacheEntry.updateMany({
        where: { key: { in: identities.map((identity) => identity.key) } },
        data: { lastUsedAt: new Date(), expiresAt: expiresAt() },
      });
      vectors.push(...(batchVectors as number[][]));
      await context.onBatchCompleted?.({
        completedChunks: offset + batch.length,
        totalChunks: texts.length,
        completedBatches: Math.floor(offset / batchSize) + 1,
        totalBatches,
        batchSize,
        cacheKeys: identities.map((identity) => identity.key),
      });
    }
    return vectors;
  }

  private validVector(value: Prisma.JsonValue | number[], dimensions: number): number[] | null {
    return Array.isArray(value) &&
      value.length === dimensions &&
      value.every((item) => typeof item === 'number' && Number.isFinite(item))
      ? (value as number[])
      : null;
  }

  private cacheEntryMatches(
    entry: {
      embeddingFingerprint: string;
      provider: string;
      model: string;
      dimensions: number;
      taskRule: string;
      chunkMaxTokens: number;
      chunkOverlapTokens: number;
      redactionPolicyVersion: string;
    },
    identity: ReturnType<typeof createEmbeddingCacheKey>,
  ): boolean {
    return (
      entry.embeddingFingerprint === identity.embeddingFingerprint &&
      entry.provider === identity.provider &&
      entry.model === identity.model &&
      entry.dimensions === identity.dimensions &&
      entry.taskRule === identity.taskRule &&
      entry.chunkMaxTokens === identity.chunkMaxTokens &&
      entry.chunkOverlapTokens === identity.chunkOverlapTokens &&
      entry.redactionPolicyVersion === identity.redactionPolicyVersion
    );
  }
}
