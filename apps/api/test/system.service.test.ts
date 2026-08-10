import { describe, expect, it, vi } from 'vitest';

import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import type { AppConfig } from '../src/config/app-config';
import type { HealthService } from '../src/health/health.service';
import type { IngestionQueue } from '../src/ingestion/ingestion.queue';
import { SystemService } from '../src/system/system.service';
import type { ChromaVectorStore } from '../src/vector-store/chroma-vector-store';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'admin-a',
  department: 'platform',
  roles: ['admin'],
  allowedSensitivities: ['public', 'internal', 'confidential'],
  capabilities: ['system:read'],
  defaultSensitivity: 'internal',
};

function fixture(environmentOverrides: Record<string, unknown> = {}) {
  const healthReadiness = vi.fn().mockResolvedValue({
    status: 'ready',
    checks: {
      postgres: { status: 'up' },
      redis: { status: 'up' },
      chroma: { status: 'up' },
      parserWorker: { status: 'up' },
      rawDocs: { status: 'up' },
    },
  });
  const health = {
    readiness: healthReadiness,
  } as unknown as HealthService;
  const queueMetricsSnapshot = vi.fn().mockResolvedValue({
    counts: { waiting: 2, active: 1, delayed: 0, failed: 0 },
    oldestWaitSeconds: 12,
  });
  const queue = {
    metricsSnapshot: queueMetricsSnapshot,
  } as unknown as IngestionQueue;
  const vectorStore = {
    info: vi.fn().mockReturnValue({
      enabled: true,
      collectionName: 'must-not-be-returned',
      fingerprint: 'a'.repeat(64),
    }),
  } as unknown as ChromaVectorStore;
  const config = {
    values: {
      RAW_DOCS_PATH: '/tmp',
      EMBEDDING_PROVIDER: 'alibaba',
      EMBEDDING_MODEL: 'text-embedding-v4',
      EMBEDDING_DIMENSIONS: 1024,
      EMBEDDING_REGION: 'cn-beijing',
      DASHSCOPE_API_KEY: 'embedding-secret',
      ALIBABA_BASE_URL: 'https://dashscope.example.test/compatible-mode/v1',
      LLM_PROVIDER: 'deepseek',
      LLM_MODEL: 'model-a',
      LLM_FALLBACK_PROVIDER: 'none',
      LLM_FALLBACK_MODEL: '',
      DEEPSEEK_API_KEY: 'llm-secret',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.example.test/v1',
      DEEPSEEK_REGION: 'global',
      OPENAI_API_KEY: '',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_REGION: 'global',
      GEMINI_API_KEY: '',
      GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
      GEMINI_REGION: 'global',
      ALIBABA_REGION: 'cn-beijing',
      CUSTOM_API_KEY: '',
      CUSTOM_BASE_URL: '',
      CUSTOM_REGION: '',
      RERANK_PROVIDER: 'none',
      RERANK_MODEL: 'qwen3-rerank',
      RERANK_BASE_URL: '',
      RERANK_REGION: 'cn-beijing',
      LOCAL_RERANK_BASE_URL: 'http://host.docker.internal:8100',
      RERANK_INTERNAL_TOKEN: '',
      ...environmentOverrides,
    },
  } as unknown as AppConfig;
  return {
    service: new SystemService(config, health, queue, vectorStore, new AclPolicy()),
    healthReadiness,
    queueMetricsSnapshot,
  };
}

describe('SystemService', () => {
  it('returns provider configuration summaries without secrets or collection names', () => {
    const { service } = fixture();
    const result = service.providers(identity);
    const serialized = JSON.stringify(result);

    expect(result.providers[0]).toMatchObject({
      kind: 'embedding',
      endpointHost: 'dashscope.example.test',
      credentialConfigured: true,
      fingerprint: 'a'.repeat(64),
    });
    expect(result.providers[1]).toMatchObject({
      kind: 'llm',
      provider: 'deepseek',
      endpointHost: 'api.deepseek.example.test',
    });
    expect(serialized).not.toContain('embedding-secret');
    expect(serialized).not.toContain('llm-secret');
    expect(serialized).not.toContain('must-not-be-returned');
  });

  it('reports Ollama as configured without an API key', () => {
    const { service } = fixture({
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3:latest',
      EMBEDDING_REGION: 'local',
      OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
      DASHSCOPE_API_KEY: '',
    });

    expect(service.providers(identity).providers[0]).toMatchObject({
      kind: 'embedding',
      provider: 'ollama',
      model: 'bge-m3:latest',
      endpointHost: 'host.docker.internal:11434',
      region: 'local',
      credentialConfigured: true,
    });
  });

  it('reports the local BGE reranker as configured without a cloud credential', () => {
    const { service } = fixture({
      RERANK_PROVIDER: 'local_bge',
      RERANK_MODEL: 'BAAI/bge-reranker-v2-m3',
      LOCAL_RERANK_BASE_URL: 'http://host.docker.internal:8100',
      PARSER_INTERNAL_TOKEN: 'reused-internal-service-token',
    });

    const rerank = service
      .providers(identity)
      .providers.find((provider) => provider.kind === 'rerank');
    expect(rerank).toMatchObject({
      provider: 'local_bge',
      model: 'BAAI/bge-reranker-v2-m3',
      endpointHost: 'host.docker.internal:8100',
      region: 'local',
      credentialConfigured: true,
    });
    expect(JSON.stringify(rerank)).not.toContain('reused-internal-service-token');
  });

  it('returns dependency, queue, and bounded disk summaries', async () => {
    const { service } = fixture();
    const result = await service.status(identity);

    expect(result.status).toBe('ready');
    expect(result.components).toContainEqual({ id: 'api', status: 'up', reason: null });
    expect(result.ingestionQueue).toMatchObject({ status: 'up', waiting: 2, active: 1 });
    expect(result.rawDocsDiskUsageRatio).toBeGreaterThanOrEqual(0);
    expect(result.rawDocsDiskUsageRatio).toBeLessThanOrEqual(1);
  });

  it('rejects missing capability before dependency checks', async () => {
    const { service, healthReadiness, queueMetricsSnapshot } = fixture();
    const unauthorized = { ...identity, capabilities: ['audit:read'] as const };

    expect(() => service.providers(unauthorized)).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_REQUIRED' }),
    );
    await expect(service.status(unauthorized)).rejects.toMatchObject({
      code: 'CAPABILITY_REQUIRED',
    });
    expect(healthReadiness).not.toHaveBeenCalled();
    expect(queueMetricsSnapshot).not.toHaveBeenCalled();
  });
});
