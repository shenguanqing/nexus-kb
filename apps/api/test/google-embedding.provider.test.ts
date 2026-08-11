import { ApiError } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';

import { GoogleEmbeddingProvider } from '../src/providers/embedding/google-embedding.provider';

function fixture(
  embedContent: (parameters: unknown) => Promise<unknown>,
  overrides: Partial<ConstructorParameters<typeof GoogleEmbeddingProvider>[0]> = {},
) {
  const telemetry = vi.fn();
  const provider = new GoogleEmbeddingProvider({
    apiKey: 'test-key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-embedding-001',
    dimensions: 3,
    batchSize: 2,
    region: 'global',
    requestTimeoutMs: 1000,
    maxAttempts: 2,
    retryBaseDelayMs: 1,
    client: { models: { embedContent } } as never,
    sleepFunction: () => Promise.resolve(),
    randomFunction: () => 0,
    telemetryRecorder: telemetry,
    ...overrides,
  });
  return { provider, telemetry };
}

describe('GoogleEmbeddingProvider', () => {
  it('uses distinct retrieval task rules, preserves batch order and normalizes reduced vectors', async () => {
    const embedContent = vi.fn().mockImplementation((parameters: unknown) => {
      const input = parameters as { contents: string[] };
      return Promise.resolve({
        embeddings: input.contents.map(() => ({ values: [3, 4, 0] })),
        sdkHttpResponse: { headers: { 'x-request-id': 'google-request' } },
      });
    });
    const { provider, telemetry } = fixture(embedContent);

    await expect(provider.embedDocuments(['one', 'two', 'three'])).resolves.toEqual([
      [0.6, 0.8, 0],
      [0.6, 0.8, 0],
      [0.6, 0.8, 0],
    ]);
    await expect(provider.embedQuery('question')).resolves.toEqual([0.6, 0.8, 0]);

    expect(embedContent).toHaveBeenNthCalledWith(1, {
      model: 'gemini-embedding-001',
      contents: ['one', 'two'],
      config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 3 },
    });
    expect(embedContent).toHaveBeenLastCalledWith({
      model: 'gemini-embedding-001',
      contents: ['question'],
      config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: 3 },
    });
    expect(telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', requestId: 'google-request' }),
    );
  });

  it('retries 429 but does not retry authentication failures', async () => {
    const rateLimited = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 429, message: 'limited' }))
      .mockResolvedValueOnce({ embeddings: [{ values: [1, 0, 0] }] });
    const { provider } = fixture(rateLimited);
    await expect(provider.embedQuery('question')).resolves.toEqual([1, 0, 0]);
    expect(rateLimited).toHaveBeenCalledTimes(2);

    const unauthorized = vi
      .fn()
      .mockRejectedValue(new ApiError({ status: 401, message: 'unauthorized' }));
    const second = fixture(unauthorized).provider;
    await expect(second.embedQuery('question')).rejects.toMatchObject({
      kind: 'authentication',
      retryable: false,
    });
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it('rejects missing, non-finite or wrong-dimensional vectors', async () => {
    const { provider } = fixture(() => Promise.resolve({ embeddings: [{ values: [1, 2] }] }));
    await expect(provider.embedQuery('question')).rejects.toMatchObject({
      kind: 'invalid_response',
      retryable: false,
    });
  });
});
