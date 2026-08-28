import { describe, expect, it, vi } from 'vitest';

import type { EmbeddingTelemetryEvent } from '../src/providers/embedding/embedding-provider';
import { OllamaEmbeddingProvider } from '../src/providers/embedding/ollama-embedding.provider';

function provider(
  overrides: Partial<ConstructorParameters<typeof OllamaEmbeddingProvider>[0]> = {},
) {
  return new OllamaEmbeddingProvider({
    baseUrl: 'http://host.docker.internal:11434',
    model: 'bge-m3:latest',
    dimensions: 3,
    batchSize: 10,
    region: 'local',
    requestTimeoutMs: 1000,
    maxAttempts: 3,
    retryBaseDelayMs: 10,
    keepAlive: '30m',
    ...overrides,
  });
}

describe('OllamaEmbeddingProvider', () => {
  it('uses the native endpoint with bounded keep-alive and reports provider timings', async () => {
    const telemetry: EmbeddingTelemetryEvent[] = [];
    const fetchFunction = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'bge-m3:latest',
          embeddings: [[0, 1, 2]],
          total_duration: 200_000_000,
          load_duration: 50_000_000,
          prompt_eval_count: 8,
        }),
      ),
    );
    const instance = provider({
      fetchFunction,
      telemetryRecorder: (event) => telemetry.push(event),
    });

    await expect(instance.embedQuery('本地向量测试')).resolves.toEqual([0, 1, 2]);

    expect(fetchFunction).toHaveBeenCalledWith(
      'http://host.docker.internal:11434/api/embed',
      expect.objectContaining({
        headers: { 'content-type': 'application/json' },
      }),
    );
    const request = fetchFunction.mock.calls[0]?.[1];
    expect(request?.headers).not.toHaveProperty('authorization');
    expect(typeof request?.body).toBe('string');
    const requestBody: unknown =
      typeof request?.body === 'string' ? JSON.parse(request.body) : null;
    expect(requestBody).toEqual({
      model: 'bge-m3:latest',
      input: ['本地向量测试'],
      dimensions: 3,
      truncate: false,
      keep_alive: '30m',
    });
    expect(telemetry).toEqual([
      expect.objectContaining({
        provider: 'ollama',
        operation: 'query',
        promptTokens: 8,
        totalTokens: 8,
        providerDurationMs: 200,
        loadDurationMs: 50,
        status: 'success',
      }),
    ]);
  });

  it('fails closed when Ollama returns vectors in a different space', async () => {
    const instance = provider({
      fetchFunction: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ model: 'bge-m3:latest', embeddings: [[0, 1]] })),
        ),
    });

    await expect(instance.embedQuery('query')).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
