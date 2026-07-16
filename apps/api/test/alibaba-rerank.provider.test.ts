import { describe, expect, it, vi } from 'vitest';

import type { RetrievedChunk } from '../src/knowledge/retrieved-chunk';
import { AlibabaRerankProvider } from '../src/providers/rerank/alibaba-rerank.provider';

const chunks: RetrievedChunk[] = ['a', 'b', 'c'].map((id, index) => ({
  id,
  text: `text-${id}`,
  distance: index / 10,
  metadata: {
    tenantId: 'tenant-a',
    documentId: `00000000-0000-0000-0000-00000000000${index}`,
    documentVersion: 1,
    chunkId: id,
    sourceName: `${id}.md`,
    department: 'finance',
    sensitivity: 'internal',
    ownerId: 'owner-a',
  },
}));

function provider(fetchFunction: typeof fetch) {
  return new AlibabaRerankProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.test/compatible-api/v1',
    model: 'qwen3-rerank',
    region: 'cn-beijing',
    requestTimeoutMs: 1000,
    fetchFunction,
  });
}

describe('AlibabaRerankProvider', () => {
  it('maps returned indexes to chunks without trusting returned documents', async () => {
    const fetchFunction = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'request-a',
          model: 'qwen3-rerank',
          results: [
            { index: 2, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.7 },
          ],
          usage: { total_tokens: 30 },
        }),
      ),
    );
    await expect(provider(fetchFunction).rerank('query', chunks, 2)).resolves.toMatchObject([
      { id: 'c', rerankScore: 0.9 },
      { id: 'a', rerankScore: 0.7 },
    ]);
    const body = fetchFunction.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    expect(body).toContain('"top_n":2');
  });

  it('rejects duplicate or out-of-range indexes', async () => {
    const fetchFunction = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 1, relevance_score: 0.8 },
          ],
        }),
      ),
    );
    await expect(provider(fetchFunction).rerank('query', chunks, 2)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});
