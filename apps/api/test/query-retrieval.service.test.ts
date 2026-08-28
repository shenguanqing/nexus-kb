import { describe, expect, it, vi } from 'vitest';

import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import type { AppConfig } from '../src/config/app-config';
import type { PrismaService } from '../src/database/prisma.service';
import { QueryRetrievalService } from '../src/knowledge/query-retrieval.service';
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

function service(
  rerankProvider: 'none' | 'alibaba',
  documents: Array<{ id: string; sourceName: string }> = [],
) {
  const query = vi.fn().mockResolvedValue([]);
  const findMany = vi.fn().mockResolvedValue(documents);
  const config = {
    values: {
      RERANK_PROVIDER: rerankProvider,
      RERANK_TOP_K: 5,
      QUERY_RECALL_TOP_K: 20,
      QUERY_MAX_DISTANCE: 0.45,
      QUERY_NEIGHBOR_WINDOW: 1,
      QUERY_MAX_MERGED_CONTEXT_CHARS: 20_000,
      QUERY_MAX_RERANK_INPUT_CHARS: 120_000,
    },
  } as AppConfig;
  return {
    query,
    retrieval: new QueryRetrievalService(
      config,
      { query } as unknown as ChromaVectorStore,
      { document: { findMany } } as unknown as PrismaService,
      new AclPolicy(),
    ),
    findMany,
  };
}

describe('QueryRetrievalService', () => {
  it('overfetches a bounded recall set but still returns the final top K when rerank is disabled', async () => {
    const { query, retrieval } = service('none');

    const result = await retrieval.retrieve(identity, [1, 0, 0]);

    expect(query).toHaveBeenCalledWith(expect.objectContaining({ topK: 20 }));
    expect(result).toHaveLength(0);
  });

  it('keeps the wider recall set when rerank is enabled', async () => {
    const { query, retrieval } = service('alibaba');

    await retrieval.retrieve(identity, [1, 0, 0]);

    expect(query).toHaveBeenCalledWith(expect.objectContaining({ topK: 20 }));
  });

  it('adds an ACL-protected scoped query for the strongest document-name hint', async () => {
    const targetDocumentId = '8d782a66-ef4e-4c1b-84c1-b68cc3c97f76';
    const { query, retrieval, findMany } = service('none', [
      {
        id: targetDocumentId,
        sourceName: '9#泉生楼智能化平面图20201203.dwg',
      },
      {
        id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        sourceName: '其他楼栋智能化平面图.dwg',
      },
    ]);

    await retrieval.retrieve(identity, [1, 0, 0], '9#泉生楼 建设单位是哪家');

    const [documentQuery] = findMany.mock.calls[0] as [
      { where: { tenantId: string; status: string }; take: number },
    ];
    expect(documentQuery).toMatchObject({
      where: { tenantId: 'tenant-a', status: 'active' },
      take: 200,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toMatchObject({
      topK: 20,
      filter: {
        tenantId: 'tenant-a',
        documentIds: [targetDocumentId],
      },
    });
  });

  it('normalizes short Chinese CAD aliases before applying an ACL-protected document scope', async () => {
    const targetDocumentId = '8d782a66-ef4e-4c1b-84c1-b68cc3c97f76';
    const { query, retrieval } = service('none', [
      {
        id: targetDocumentId,
        sourceName: '5、消控室大样图20200529.dwg',
      },
      {
        id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        sourceName: 'PACK（搬迁后）平面布置示意图-V1.dwg',
      },
    ]);

    const result = await retrieval.retrieveDetailed(identity, [1, 0, 0], '消防室里有什么');

    expect(result.matchedDocumentIds).toEqual([targetDocumentId]);
    expect(query.mock.calls[1]?.[0]).toMatchObject({
      filter: { tenantId: 'tenant-a', documentIds: [targetDocumentId] },
    });
  });

  it('does not fill a high-confidence document scope with globally similar documents', async () => {
    const targetDocumentId = '8d782a66-ef4e-4c1b-84c1-b68cc3c97f76';
    const globalDocumentId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
    const vectorChunk = (documentId: string, text: string, distance: number) => ({
      id: documentId === targetDocumentId ? 'a'.repeat(64) : 'b'.repeat(64),
      text,
      distance,
      metadata: {
        tenantId: 'tenant-a',
        documentId,
        documentVersion: 1,
        chunkId: documentId === targetDocumentId ? 'a'.repeat(64) : 'b'.repeat(64),
        ordinal: 0,
        sourceName:
          documentId === targetDocumentId
            ? '5、消控室大样图20200529.dwg'
            : 'PACK（搬迁后）平面布置示意图-V1.dwg',
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'user-a',
      },
    });
    const targetChunk = vectorChunk(targetDocumentId, '机柜\n消防设备\n电池柜', 0.34);
    const globalChunk = vectorChunk(globalDocumentId, '消防槽\n消防瓶柜体', 0.3);
    const rows = [targetChunk, globalChunk].map((chunk) => ({
      id: chunk.id,
      documentId: chunk.metadata.documentId,
      documentVersion: 1,
      ordinal: 0,
      redactedText: chunk.text,
      page: null,
      sheet: null,
      sectionPath: [],
      document: {
        activeVersion: 1,
        sourceName: chunk.metadata.sourceName,
        tenantId: 'tenant-a',
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'user-a',
      },
    }));
    const query = vi.fn((input: { filter: { documentIds?: string[] } }) =>
      Promise.resolve(input.filter.documentIds ? [targetChunk] : [globalChunk]),
    );
    const findChunks = vi.fn((input: { where: { OR: Array<{ documentId: string }> } }) =>
      Promise.resolve(
        rows.filter((row) => input.where.OR.some((window) => window.documentId === row.documentId)),
      ),
    );
    const retrieval = new QueryRetrievalService(
      {
        values: {
          RERANK_PROVIDER: 'none',
          RERANK_TOP_K: 5,
          QUERY_RECALL_TOP_K: 20,
          QUERY_MAX_DISTANCE: 0.45,
          QUERY_NEIGHBOR_WINDOW: 0,
          QUERY_MAX_MERGED_CONTEXT_CHARS: 20_000,
          QUERY_MAX_RERANK_INPUT_CHARS: 120_000,
        },
      } as AppConfig,
      { query } as unknown as ChromaVectorStore,
      {
        document: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              { id: targetDocumentId, sourceName: '5、消控室大样图20200529.dwg' },
            ]),
        },
        knowledgeChunk: { findMany: findChunks },
      } as unknown as PrismaService,
      new AclPolicy(),
    );

    const result = await retrieval.retrieve(identity, [1, 0, 0], '消防室里有什么');

    expect(query).toHaveBeenCalledTimes(2);
    expect(result.map((context) => context.metadata.documentId)).toEqual([targetDocumentId]);
    expect(result[0]?.text).toContain('机柜');
  });

  it('accepts a three-character Chinese filename identity such as kindergarten', async () => {
    const targetDocumentId = '8d782a66-ef4e-4c1b-84c1-b68cc3c97f76';
    const { retrieval } = service('none', [
      {
        id: targetDocumentId,
        sourceName: '3、3#幼儿园弱电平面图20200530.dwg',
      },
    ]);

    const result = await retrieval.retrieveDetailed(identity, [1, 0, 0], '幼儿园图尺寸');

    expect(result.matchedDocumentIds).toEqual([targetDocumentId]);
  });

  it('collapses identical active CAD text before applying the final top K', async () => {
    const vectorChunks = Array.from({ length: 7 }, (_, index) => ({
      id: `${index}`.padStart(64, 'a'),
      text: index < 4 ? '消控室' : `独立片段${index}`,
      distance: 0.1 + index / 100,
      metadata: {
        tenantId: 'tenant-a',
        documentId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        documentVersion: 1,
        chunkId: `${index}`.padStart(64, 'a'),
        ordinal: 0,
        sourceName: `drawing-${index}.dwg`,
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'user-a',
      },
    }));
    const rows = vectorChunks.map((chunk) => ({
      id: chunk.id,
      documentId: chunk.metadata.documentId,
      documentVersion: 1,
      ordinal: 0,
      redactedText: chunk.text,
      page: null,
      sheet: null,
      sectionPath: [],
      document: {
        activeVersion: 1,
        sourceName: chunk.metadata.sourceName,
        tenantId: 'tenant-a',
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'user-a',
      },
    }));
    const retrieval = new QueryRetrievalService(
      {
        values: {
          RERANK_PROVIDER: 'none',
          RERANK_TOP_K: 5,
          QUERY_RECALL_TOP_K: 20,
          QUERY_MAX_DISTANCE: 0.45,
          QUERY_NEIGHBOR_WINDOW: 0,
          QUERY_MAX_MERGED_CONTEXT_CHARS: 20_000,
          QUERY_MAX_RERANK_INPUT_CHARS: 120_000,
        },
      } as AppConfig,
      { query: vi.fn().mockResolvedValue(vectorChunks) } as unknown as ChromaVectorStore,
      { knowledgeChunk: { findMany: vi.fn().mockResolvedValue(rows) } } as unknown as PrismaService,
      new AclPolicy(),
    );

    const result = await retrieval.retrieve(identity, [1, 0, 0]);

    expect(result).toHaveLength(4);
    expect(result.filter((context) => context.text === '消控室')).toHaveLength(1);
    expect(result.map((context) => context.text)).toContain('独立片段6');
  });

  it('does not add a document lookup for a question without a strong name hint', async () => {
    const { query, retrieval, findMany } = service('none');

    await retrieval.retrieve(identity, [1, 0, 0], '付款周期是多少');

    expect(findMany).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
  });
});
