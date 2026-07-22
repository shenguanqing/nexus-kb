import { describe, expect, it, vi } from 'vitest';

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
    ...overrides,
  });
}

describe('OllamaEmbeddingProvider', () => {
  it('uses the local OpenAI-compatible endpoint without an authorization header', async () => {
    const fetchFunction = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'bge-m3:latest',
          data: [{ index: 0, embedding: [0, 1, 2] }],
        }),
      ),
    );
    const instance = provider({ fetchFunction });

    await expect(instance.embedQuery('本地向量测试')).resolves.toEqual([0, 1, 2]);

    expect(fetchFunction).toHaveBeenCalledWith(
      'http://host.docker.internal:11434/v1/embeddings',
      expect.objectContaining({
        headers: { 'content-type': 'application/json' },
      }),
    );
    const request = fetchFunction.mock.calls[0]?.[1];
    expect(request?.headers).not.toHaveProperty('authorization');
  });

  it('fails closed when Ollama returns vectors in a different space', async () => {
    const instance = provider({
      fetchFunction: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ index: 0, embedding: [0, 1] }] })),
        ),
    });

    await expect(instance.embedQuery('query')).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
