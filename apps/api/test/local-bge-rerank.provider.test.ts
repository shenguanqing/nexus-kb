import { describe, expect, it, vi } from 'vitest';

import type { RetrievedChunk } from '../src/knowledge/retrieved-chunk';
import { LocalBgeRerankProvider } from '../src/providers/rerank/local-bge-rerank.provider';

const chunks: RetrievedChunk[] = [
  {
    id: 'chunk-a',
    text: 'Vue 3 使用 Proxy 实现响应式。',
    distance: 0.2,
    metadata: {
      tenantId: 'tenant-a',
      documentId: 'document-a',
      documentVersion: 1,
      chunkId: 'chunk-a',
      sourceName: 'vue.md',
      department: 'engineering',
      sensitivity: 'internal',
      ownerId: 'owner-a',
    },
  },
  {
    id: 'chunk-b',
    text: 'React 使用组件和状态管理。',
    distance: 0.1,
    metadata: {
      tenantId: 'tenant-a',
      documentId: 'document-b',
      documentVersion: 1,
      chunkId: 'chunk-b',
      sourceName: 'react.md',
      department: 'engineering',
      sensitivity: 'internal',
      ownerId: 'owner-a',
    },
  },
];

function provider(overrides: Partial<ConstructorParameters<typeof LocalBgeRerankProvider>[0]> = {}) {
  return new LocalBgeRerankProvider({
    internalToken: 'internal-token',
    baseUrl: 'http://host.docker.internal:8100',
    model: 'BAAI/bge-reranker-v2-m3',
    requestTimeoutMs: 1_000,
    ...overrides,
  });
}

describe('LocalBgeRerankProvider', () => {
  it('sends only query and selected candidate texts to the internal reranker', async () => {
    const fetchFunction = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'BAAI/bge-reranker-v2-m3',
          results: [
            { index: 1, relevanceScore: 7.4 },
            { index: 0, relevanceScore: 3.2 },
          ],
        }),
      ),
    );

    const result = await provider({ fetchFunction }).rerank('Vue 和 React 的区别', chunks, 2);

    expect(result.map((chunk) => chunk.id)).toEqual(['chunk-b', 'chunk-a']);
    expect(result.map((chunk) => chunk.rerankScore)).toEqual([7.4, 3.2]);
    expect(fetchFunction).toHaveBeenCalledWith(
      'http://host.docker.internal:8100/internal/v1/rerank',
      expect.objectContaining({
        headers: {
          'content-type': 'application/json',
          'x-rerank-internal-token': 'internal-token',
        },
      }),
    );
  });

  it('rejects duplicate or out-of-range result indexes', async () => {
    const fetchFunction = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'BAAI/bge-reranker-v2-m3',
          results: [
            { index: 0, relevanceScore: 0.9 },
            { index: 0, relevanceScore: 0.8 },
          ],
        }),
      ),
    );

    await expect(
      provider({ fetchFunction }).rerank('问题', chunks, 2),
    ).rejects.toMatchObject({ kind: 'invalid_response', retryable: false });
  });

  it('classifies an aborted response body as a retryable timeout', async () => {
    const abortedResponse = {
      ok: true,
      headers: new Headers(),
      json: vi.fn().mockRejectedValue(new DOMException('This operation was aborted', 'AbortError')),
    } as unknown as Response;

    await expect(
      provider({
        fetchFunction: vi.fn<typeof fetch>().mockResolvedValue(abortedResponse),
      }).rerank('问题', chunks, 2),
    ).rejects.toMatchObject({ kind: 'timeout', retryable: true });
  });
});
