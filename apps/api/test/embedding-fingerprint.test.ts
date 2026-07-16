import { describe, expect, it } from 'vitest';

import type { Environment } from '../src/config/app-config';
import { createEmbeddingFingerprint } from '../src/providers/embedding/embedding-fingerprint';

const environment = {
  EMBEDDING_PROVIDER: 'alibaba',
  EMBEDDING_MODEL: 'text-embedding-v4',
  EMBEDDING_DIMENSIONS: 1024,
  EMBEDDING_TASK_MODE: 'symmetric',
  CHUNK_MAX_TOKENS: 600,
  CHUNK_OVERLAP_TOKENS: 80,
  REDACTION_POLICY_VERSION: 'v1',
} as Environment;

describe('createEmbeddingFingerprint', () => {
  it('is stable for the same vector space configuration', () => {
    expect(createEmbeddingFingerprint(environment)).toEqual(
      createEmbeddingFingerprint({ ...environment }),
    );
  });

  it('changes when model, dimensions, chunking or redaction semantics change', () => {
    const original = createEmbeddingFingerprint(environment).value;
    const variants: Environment[] = [
      { ...environment, EMBEDDING_DIMENSIONS: 768 },
      { ...environment, CHUNK_MAX_TOKENS: 512 },
      { ...environment, CHUNK_OVERLAP_TOKENS: 64 },
      { ...environment, REDACTION_POLICY_VERSION: 'v2' },
    ];
    expect(
      variants.every((variant) => createEmbeddingFingerprint(variant).value !== original),
    ).toBe(true);
  });
});
