import { describe, expect, it } from 'vitest';

import { createEmbeddingCacheKey } from '../src/providers/embedding/embedding-cache-key';
import type { EmbeddingFingerprint } from '../src/providers/embedding/embedding-fingerprint';

function fingerprint(
  overrides: Partial<EmbeddingFingerprint['configuration']> = {},
): EmbeddingFingerprint {
  const configuration = {
    provider: 'google',
    model: 'gemini-embedding-001',
    dimensions: 768,
    taskMode: 'retrieval_document_query' as const,
    chunkMaxTokens: 600,
    chunkOverlapTokens: 80,
    redactionPolicyVersion: 'v1',
    ...overrides,
  };
  return {
    configuration,
    value:
      `${configuration.provider}:${configuration.model}:${configuration.dimensions}:${configuration.taskMode}:${configuration.chunkMaxTokens}:${configuration.chunkOverlapTokens}:${configuration.redactionPolicyVersion}`
        .padEnd(64, '0')
        .slice(0, 64),
  };
}

describe('createEmbeddingCacheKey', () => {
  it('is stable for the same tenant, text and complete embedding configuration', () => {
    const input = {
      tenantId: 'tenant-a',
      text: '同一段已脱敏文本',
      taskRule: 'RETRIEVAL_DOCUMENT',
      fingerprint: fingerprint(),
    };

    expect(createEmbeddingCacheKey(input)).toEqual(createEmbeddingCacheKey(input));
    expect(createEmbeddingCacheKey(input).textSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(createEmbeddingCacheKey(input).key).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['provider', { provider: 'alibaba' }],
    ['model', { model: 'text-embedding-v4' }],
    ['dimensions', { dimensions: 1536 }],
    ['task mode', { taskMode: 'symmetric' as const }],
    ['chunk size', { chunkMaxTokens: 800 }],
    ['chunk overlap', { chunkOverlapTokens: 120 }],
    ['redaction policy', { redactionPolicyVersion: 'v2' }],
  ])('changes when %s changes', (_label, override) => {
    const base = createEmbeddingCacheKey({
      tenantId: 'tenant-a',
      text: 'same text',
      taskRule: 'RETRIEVAL_DOCUMENT',
      fingerprint: fingerprint(),
    });
    const changed = createEmbeddingCacheKey({
      tenantId: 'tenant-a',
      text: 'same text',
      taskRule: 'RETRIEVAL_DOCUMENT',
      fingerprint: fingerprint(override),
    });

    expect(changed.key).not.toBe(base.key);
  });

  it('separates document/query task rules and tenant cache scopes', () => {
    const base = {
      tenantId: 'tenant-a',
      text: 'same text',
      taskRule: 'RETRIEVAL_DOCUMENT',
      fingerprint: fingerprint(),
    };
    const documentKey = createEmbeddingCacheKey(base).key;

    expect(createEmbeddingCacheKey({ ...base, taskRule: 'RETRIEVAL_QUERY' }).key).not.toBe(
      documentKey,
    );
    expect(createEmbeddingCacheKey({ ...base, tenantId: 'tenant-b' }).key).not.toBe(documentKey);
  });
});
