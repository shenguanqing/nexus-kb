import { createHash } from 'node:crypto';

import type { EmbeddingFingerprint } from './embedding-fingerprint';

export interface EmbeddingCacheKey {
  key: string;
  textSha256: string;
  embeddingFingerprint: string;
  provider: string;
  model: string;
  dimensions: number;
  taskRule: string;
  chunkMaxTokens: number;
  chunkOverlapTokens: number;
  redactionPolicyVersion: string;
}

export function createEmbeddingCacheKey(input: {
  tenantId: string;
  text: string;
  taskRule: string;
  fingerprint: EmbeddingFingerprint;
}): EmbeddingCacheKey {
  const textSha256 = createHash('sha256').update(input.text).digest('hex');
  const configuration = input.fingerprint.configuration;
  const cacheIdentity = {
    schemaVersion: 1,
    tenantId: input.tenantId,
    provider: configuration.provider,
    model: configuration.model,
    dimensions: configuration.dimensions,
    taskMode: configuration.taskMode,
    taskRule: input.taskRule,
    chunkMaxTokens: configuration.chunkMaxTokens,
    chunkOverlapTokens: configuration.chunkOverlapTokens,
    redactionPolicyVersion: configuration.redactionPolicyVersion,
    embeddingFingerprint: input.fingerprint.value,
    textSha256,
  };
  return {
    key: createHash('sha256').update(JSON.stringify(cacheIdentity)).digest('hex'),
    textSha256,
    embeddingFingerprint: input.fingerprint.value,
    provider: configuration.provider,
    model: configuration.model,
    dimensions: configuration.dimensions,
    taskRule: input.taskRule,
    chunkMaxTokens: configuration.chunkMaxTokens,
    chunkOverlapTokens: configuration.chunkOverlapTokens,
    redactionPolicyVersion: configuration.redactionPolicyVersion,
  };
}
