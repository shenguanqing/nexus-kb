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

  it('constructs the configured local Ollama provider', () => {
    const config = {
      values: {
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'bge-m3:latest',
        EMBEDDING_DIMENSIONS: 1024,
        EMBEDDING_BATCH_SIZE: 10,
        EMBEDDING_TASK_MODE: 'symmetric',
        EMBEDDING_REGION: 'local',
        EMBEDDING_REQUEST_TIMEOUT_MS: 60_000,
        EMBEDDING_MAX_ATTEMPTS: 3,
        EMBEDDING_RETRY_BASE_DELAY_MS: 500,
        OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
        OLLAMA_KEEP_ALIVE: '30m',
        CHUNK_MAX_TOKENS: 600,
        CHUNK_OVERLAP_TOKENS: 80,
        REDACTION_POLICY_VERSION: 'v1',
      },
    } as unknown as AppConfig;
    const factory = new EmbeddingProviderFactory(config, {
      record: vi.fn(),
    } as unknown as EmbeddingTelemetry);

    expect(factory.getProvider()).toMatchObject({
      id: 'ollama',
      model: 'bge-m3:latest',
      dimensions: 1024,
      region: 'local',
    });
  });

  it('constructs the configured Google retrieval embedding provider', () => {
    const config = {
      values: {
        EMBEDDING_PROVIDER: 'google',
        EMBEDDING_MODEL: 'gemini-embedding-001',
        EMBEDDING_DIMENSIONS: 768,
        EMBEDDING_BATCH_SIZE: 10,
        EMBEDDING_TASK_MODE: 'retrieval_document_query',
        EMBEDDING_REGION: 'global',
        EMBEDDING_REQUEST_TIMEOUT_MS: 60_000,
        EMBEDDING_MAX_ATTEMPTS: 3,
        EMBEDDING_RETRY_BASE_DELAY_MS: 500,
        GEMINI_API_KEY: 'test-key',
        GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
        CHUNK_MAX_TOKENS: 600,
        CHUNK_OVERLAP_TOKENS: 80,
        REDACTION_POLICY_VERSION: 'v1',
      },
    } as unknown as AppConfig;
    const factory = new EmbeddingProviderFactory(config, {
      record: vi.fn(),
    } as unknown as EmbeddingTelemetry);

    expect(factory.getProvider()).toMatchObject({
      id: 'google',
      model: 'gemini-embedding-001',
      dimensions: 768,
      region: 'global',
      taskMode: 'retrieval_document_query',
      documentTaskRule: 'RETRIEVAL_DOCUMENT',
      queryTaskRule: 'RETRIEVAL_QUERY',
    });
  });
});
