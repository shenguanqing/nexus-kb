import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import { EmbeddingProviderFactory } from '../src/providers/embedding/embedding-provider.factory';
import type { EmbeddingTelemetry } from '../src/providers/embedding/embedding-telemetry';

describe('EmbeddingProviderFactory', () => {
  it('fails closed when no embedding provider is configured', () => {
    const factory = new EmbeddingProviderFactory(
      { values: { EMBEDDING_PROVIDER: 'none' } } as unknown as AppConfig,
      { record: vi.fn() } as unknown as EmbeddingTelemetry,
    );
    expect(() => factory.getProvider()).toThrow(
      expect.objectContaining({ kind: 'not_configured' }),
    );
  });

  it('constructs Alibaba once and exposes the matching configuration fingerprint', () => {
    const config = {
      values: {
        EMBEDDING_PROVIDER: 'alibaba',
        EMBEDDING_MODEL: 'text-embedding-v4',
        EMBEDDING_DIMENSIONS: 1024,
        EMBEDDING_BATCH_SIZE: 10,
        EMBEDDING_TASK_MODE: 'symmetric',
        EMBEDDING_REGION: 'cn-beijing',
        EMBEDDING_REQUEST_TIMEOUT_MS: 60_000,
        EMBEDDING_MAX_ATTEMPTS: 3,
        EMBEDDING_RETRY_BASE_DELAY_MS: 500,
        DASHSCOPE_API_KEY: 'test-key',
        ALIBABA_BASE_URL: 'https://example.test/compatible-mode/v1',
        CHUNK_MAX_TOKENS: 600,
        CHUNK_OVERLAP_TOKENS: 80,
        REDACTION_POLICY_VERSION: 'v1',
      },
    } as unknown as AppConfig;
    const factory = new EmbeddingProviderFactory(config, {
      record: vi.fn(),
    } as unknown as EmbeddingTelemetry);

    expect(factory.getProvider()).toBe(factory.getProvider());
    expect(factory.getProvider()).toMatchObject({
      id: 'alibaba',
      model: 'text-embedding-v4',
      dimensions: 1024,
      region: 'cn-beijing',
      taskMode: 'symmetric',
    });
    const fingerprint = factory.getFingerprint();
    expect(fingerprint.value).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint.configuration).toMatchObject({
      provider: 'alibaba',
      model: 'text-embedding-v4',
      dimensions: 1024,
    });
  });
});
