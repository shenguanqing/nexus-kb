import { describe, expect, it, vi } from 'vitest';

import type { Identity } from '../src/auth/identity';
import type { OperationalLogger } from '../src/common/operational-logger';
import type { KnowledgeContextPolicy } from '../src/knowledge/knowledge-context-policy';
import type { RetrievedChunk } from '../src/knowledge/retrieved-chunk';
import type { RerankProvider } from '../src/providers/rerank/rerank-provider';
import type { RerankProviderFactory } from '../src/providers/rerank/rerank-provider.factory';
import { RerankService } from '../src/providers/rerank/rerank.service';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: [],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};

const chunks: RetrievedChunk[] = ['a', 'b', 'c'].map((id, index) => ({
  id,
  text: id,
  distance: index,
  metadata: {
    tenantId: 'tenant-a',
    documentId: `document-${id}`,
    documentVersion: 1,
    chunkId: id,
    sourceName: `${id}.md`,
    department: 'finance',
    sensitivity: 'internal',
    ownerId: 'owner-a',
  },
}));

describe('RerankService', () => {
  it('degrades to original vector order when provider fails', async () => {
    const provider: RerankProvider = {
      id: 'alibaba',
      model: 'qwen3-rerank',
      region: 'cn-beijing',
      rerank: vi.fn().mockRejectedValue(new Error('upstream unavailable')),
    };
    const service = new RerankService(
      { getProvider: () => provider } as RerankProviderFactory,
      { allAllowed: vi.fn().mockReturnValue(true) } as unknown as KnowledgeContextPolicy,
      { warn: vi.fn() } as unknown as OperationalLogger,
    );

    await expect(
      service.rerank({ identity, query: 'query', chunks, topK: 2, traceId: 'trace-a' }),
    ).resolves.toEqual({ chunks: chunks.slice(0, 2), degraded: true });
  });

  it('does not call the cloud provider when secondary policy rejects a chunk', async () => {
    const rerank = vi.fn<RerankProvider['rerank']>();
    const service = new RerankService(
      {
        getProvider: () => ({
          id: 'alibaba',
          model: 'qwen3-rerank',
          region: 'cn-beijing',
          rerank,
        }),
      } as RerankProviderFactory,
      { allAllowed: vi.fn().mockReturnValue(false) } as unknown as KnowledgeContextPolicy,
      { warn: vi.fn() } as unknown as OperationalLogger,
    );

    await expect(
      service.rerank({ identity, query: 'query', chunks, topK: 2, traceId: 'trace-a' }),
    ).resolves.toMatchObject({ degraded: true });
    expect(rerank).not.toHaveBeenCalled();
  });
});
