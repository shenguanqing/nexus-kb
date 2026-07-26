import { describe, expect, it, vi } from 'vitest';

import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import type { PrismaService } from '../src/database/prisma.service';
import type { AppConfig } from '../src/config/app-config';
import { QueryRetrievalService } from '../src/knowledge/query-retrieval.service';
import type { RetrievedChunk } from '../src/knowledge/retrieved-chunk';
import { SourceAuthorizationService } from '../src/knowledge/source-authorization.service';
import type { ChromaVectorStore } from '../src/vector-store/chroma-vector-store';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: ['user'],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};

function chunk(documentId: string, version: number, tenantId = 'tenant-a'): RetrievedChunk {
  return {
    id: `${documentId}-${version}`,
    text: 'text',
    distance: 0.1,
    metadata: {
      tenantId,
      documentId,
      documentVersion: version,
      chunkId: `${documentId}-${version}`,
      sourceName: 'source.md',
      department: 'finance',
      sensitivity: 'internal',
      ownerId: 'owner-a',
    },
  };
}

describe('SourceAuthorizationService', () => {
  it('retains only the current active version and rechecks tenant ACL', async () => {
    const findMany = vi
      .fn<
        (input: {
          where: { tenantId?: string; status?: string };
        }) => Promise<Array<{ id: string; activeVersion: number | null }>>
      >()
      .mockResolvedValue([{ id: 'document-a', activeVersion: 2 }]);
    const prisma = { document: { findMany } } as unknown as PrismaService;
    const service = new SourceAuthorizationService(prisma, new AclPolicy());
    const result = await service.retainActiveAuthorizedSources(identity, [
      chunk('document-a', 1),
      chunk('document-a', 2),
      chunk('document-b', 1, 'tenant-b'),
    ]);

    expect(result).toEqual([chunk('document-a', 2)]);
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      tenantId: 'tenant-a',
      status: 'active',
    });
  });

  it('expands only active adjacent chunks after ACL-filtered vector retrieval', async () => {
    const vectorQuery = vi.fn().mockResolvedValue([
      {
        id: 'b'.repeat(64),
        text: '命中正文',
        distance: 0.1,
        metadata: {
          tenantId: 'tenant-a',
          documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
          documentVersion: 1,
          chunkId: 'b'.repeat(64),
          ordinal: 2,
          sourceName: 'policy.md',
          department: 'finance',
          sensitivity: 'internal',
          ownerId: 'user-a',
          page: 2,
          sectionPath: JSON.stringify(['付款制度']),
        },
      },
    ]);
    const findChunks = vi.fn().mockResolvedValue(
      [1, 2, 3].map((ordinal) => ({
        id: `${ordinal}`.padStart(64, 'a'),
        documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        documentVersion: 1,
        ordinal,
        redactedText: `片段${ordinal}`,
        page: 2,
        sheet: null,
        sectionPath: ['付款制度'],
        document: {
          activeVersion: 1,
          sourceName: 'policy.md',
          tenantId: 'tenant-a',
          department: 'finance',
          sensitivity: 'internal',
          ownerId: 'user-a',
        },
      })),
    );
    const retrieval = new QueryRetrievalService(
      {
        values: {
          QUERY_RECALL_TOP_K: 20,
          QUERY_MAX_DISTANCE: 0.45,
          QUERY_NEIGHBOR_WINDOW: 1,
          QUERY_MAX_MERGED_CONTEXT_CHARS: 20_000,
          QUERY_MAX_RERANK_INPUT_CHARS: 120_000,
        },
      } as AppConfig,
      { query: vectorQuery } as unknown as ChromaVectorStore,
      { knowledgeChunk: { findMany: findChunks } } as unknown as PrismaService,
      new AclPolicy(),
      {
        retainActiveAuthorizedSources: vi.fn((_: Identity, chunks: RetrievedChunk[]) => chunks),
      } as unknown as SourceAuthorizationService,
    );

    const result = await retrieval.retrieve(identity, [1, 0, 0]);
    expect(result[0]?.text).toBe('片段1\n\n片段2\n\n片段3');
    expect(result[0]?.distance).toBe(0.1);
    expect(result[0]?.metadata.chunkIds).toHaveLength(3);
    type QueryInput = { topK: number; filter: { tenantId: string; userId: string } };
    const calls = vectorQuery.mock.calls as unknown as Array<[QueryInput]>;
    expect(calls[0]?.[0]).toMatchObject({
      topK: 20,
      filter: { tenantId: 'tenant-a', userId: 'user-a' },
    });
  });
});
