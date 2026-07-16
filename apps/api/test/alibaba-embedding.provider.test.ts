import { describe, expect, it, vi } from 'vitest';

import { AlibabaEmbeddingProvider } from '../src/providers/embedding/alibaba-embedding.provider';
import type { EmbeddingTelemetryEvent } from '../src/providers/embedding/embedding-provider';

function response(vectors: number[][], status = 200, reverse = false): Response {
  const data = vectors.map((embedding, index) => ({ embedding, index }));
  return new Response(
    JSON.stringify({
      id: 'request-body-id',
      data: reverse ? data.reverse() : data,
      usage: { prompt_tokens: 12, total_tokens: 12 },
    }),
    {
      status,
      headers: { 'content-type': 'application/json', 'x-request-id': 'request-header-id' },
    },
  );
}

function provider(
  overrides: Partial<ConstructorParameters<typeof AlibabaEmbeddingProvider>[0]> = {},
) {
  return new AlibabaEmbeddingProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.test/compatible-mode/v1',
    model: 'text-embedding-v4',
    dimensions: 3,
    batchSize: 10,
    region: 'cn-beijing',
    requestTimeoutMs: 1000,
    maxAttempts: 3,
    retryBaseDelayMs: 10,
    ...overrides,
  });
}

function parseInput(body: BodyInit | null | undefined): string[] {
  if (typeof body !== 'string') throw new Error('Expected a JSON string body');
  const decoded: unknown = JSON.parse(body);
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    !('input' in decoded) ||
    !Array.isArray(decoded.input) ||
    !decoded.input.every((value) => typeof value === 'string')
  ) {
    throw new Error('Expected a string array input');
  }
  return decoded.input;
}

describe('AlibabaEmbeddingProvider', () => {
  it('batches documents, restores response index order and records bodyless telemetry', async () => {
    const calls: string[][] = [];
    const telemetry: EmbeddingTelemetryEvent[] = [];
    const fetchImplementation = (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const input = parseInput(init?.body);
      calls.push(input);
      return Promise.resolve(
        response(
          input.map((_, index) => [index, index + 1, index + 2]),
          200,
          true,
        ),
      );
    };
    const fetchFunction = vi.fn(fetchImplementation) as unknown as typeof fetch;
    const instance = provider({
      fetchFunction,
      telemetryRecorder: (event) => telemetry.push(event),
      nowFunction: vi.fn().mockReturnValueOnce(100).mockReturnValue(125),
    });

    const vectors = await instance.embedDocuments(
      Array.from({ length: 12 }, (_, index) => `document-${index}`),
    );

    expect(fetchFunction).toHaveBeenCalledTimes(2);
    expect(calls[0]).toHaveLength(10);
    expect(calls[1]).toHaveLength(2);
    expect(vectors).toHaveLength(12);
    expect(vectors[0]).toEqual([0, 1, 2]);
    expect(vectors[1]).toEqual([1, 2, 3]);
    expect(telemetry).toHaveLength(2);
    expect(telemetry[0]).toMatchObject({
      provider: 'alibaba',
      model: 'text-embedding-v4',
      region: 'cn-beijing',
      operation: 'documents',
      inputCount: 10,
      requestId: 'request-header-id',
      promptTokens: 12,
      status: 'success',
    });
    expect(JSON.stringify(telemetry)).not.toContain('document-0');
    expect(JSON.stringify(telemetry)).not.toContain('test-key');
  });

  it('retries 429 with exponential backoff and never changes provider', async () => {
    const sleepFunction = vi.fn().mockResolvedValue(undefined);
    const telemetry: EmbeddingTelemetryEvent[] = [];
    const fetchFunction = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(response([[0, 1, 2]]));
    const instance = provider({
      fetchFunction,
      sleepFunction,
      randomFunction: () => 0,
      telemetryRecorder: (event) => telemetry.push(event),
    });

    await expect(instance.embedQuery('query')).resolves.toEqual([0, 1, 2]);
    expect(fetchFunction).toHaveBeenCalledTimes(2);
    expect(sleepFunction).toHaveBeenCalledWith(10);
    expect(telemetry.at(-1)).toMatchObject({ attempts: 2, status: 'success' });
  });

  it('does not retry invalid requests or authentication failures', async () => {
    for (const status of [400, 401, 403]) {
      const fetchFunction = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }));
      const instance = provider({ fetchFunction });

      await expect(instance.embedQuery('query')).rejects.toMatchObject({
        retryable: false,
      });
      expect(fetchFunction).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects mismatched vector counts and dimensions', async () => {
    const wrongCount = provider({
      fetchFunction: vi.fn<typeof fetch>().mockResolvedValue(response([[0, 1, 2]])),
    });
    await expect(wrongCount.embedDocuments(['one', 'two'])).rejects.toMatchObject({
      kind: 'invalid_response',
    });

    const wrongDimension = provider({
      fetchFunction: vi.fn<typeof fetch>().mockResolvedValue(response([[0, 1]])),
    });
    await expect(wrongDimension.embedQuery('query')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});
