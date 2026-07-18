import { describe, expect, it, vi } from 'vitest';

import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import type { AppConfig } from '../src/config/app-config';
import type { QualityQueryObserver } from '../src/knowledge/knowledge-query.service';
import { KnowledgeQueryService } from '../src/knowledge/knowledge-query.service';
import type { QueryAuditService } from '../src/knowledge/query-audit.service';
import type { QueryRateLimiter } from '../src/knowledge/query-rate-limiter';
import type { QueryRetrievalService } from '../src/knowledge/query-retrieval.service';
import type { RetrievedChunk } from '../src/knowledge/retrieved-chunk';
import type { SourceAuthorizationService } from '../src/knowledge/source-authorization.service';
import type { EmbeddingService } from '../src/providers/embedding/embedding.service';
import type { LlmService } from '../src/providers/llm/llm.service';
import type { RerankService } from '../src/providers/rerank/rerank.service';

const traceId = 'd26720b3-1f78-40df-868d-8ca8510dca26';
const documentId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: [],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};
const context: RetrievedChunk = {
  id: 'a'.repeat(64),
  text: '付款周期为 30 天',
  distance: 0.1,
  metadata: {
    tenantId: 'tenant-a',
    documentId,
    documentVersion: 1,
    chunkId: 'a'.repeat(64),
    chunkIds: ['a'.repeat(64), 'b'.repeat(64)],
    ordinal: 2,
    sourceName: 'policy.md',
    department: 'finance',
    sensitivity: 'internal',
    ownerId: 'user-a',
    page: 2,
    sectionPath: ['付款制度'],
  },
};

function dependencies(options: { candidates?: RetrievedChunk[]; finalAuthorized?: boolean } = {}) {
  const candidates = options.candidates ?? [context];
  const assertAllowed = vi.fn().mockResolvedValue(undefined);
  const embedQuery = vi.fn().mockResolvedValue([1, 0, 0]);
  const retrieve = vi.fn().mockResolvedValue(candidates);
  const rerank = vi.fn().mockResolvedValue({ chunks: candidates, degraded: false });
  let authorizationCall = 0;
  const retainActiveAuthorizedSources = vi.fn((_: Identity, chunks: RetrievedChunk[]) => {
    authorizationCall += 1;
    return Promise.resolve(
      options.finalAuthorized === false && authorizationCall === 2 ? [] : chunks,
    );
  });
  const answer = vi.fn().mockResolvedValue({
    text: '付款周期为 30 天。[来源1]',
    provider: 'deepseek',
    model: 'deepseek-chat',
    fallbackUsed: false,
  });
  const record = vi.fn().mockResolvedValue(undefined);
  const config = {
    values: {
      EMBEDDING_PROVIDER: 'alibaba',
      EMBEDDING_MODEL: 'text-embedding-v4',
      RERANK_PROVIDER: 'none',
      RERANK_MODEL: 'qwen3-rerank',
      RERANK_TOP_K: 5,
    },
  } as AppConfig;
  const service = new KnowledgeQueryService(
    config,
    new AclPolicy(),
    { assertAllowed } as unknown as QueryRateLimiter,
    { embedQuery } as unknown as EmbeddingService,
    { retrieve } as unknown as QueryRetrievalService,
    { rerank } as unknown as RerankService,
    { answer } as unknown as LlmService,
    { retainActiveAuthorizedSources } as unknown as SourceAuthorizationService,
    { record } as unknown as QueryAuditService,
  );
  return { service, assertAllowed, embedQuery, retrieve, rerank, answer, record };
}

describe('KnowledgeQueryService', () => {
  it('answers with reauthorized real sources and writes no question plaintext to audit', async () => {
    const deps = dependencies();

    await expect(
      deps.service.query({ question: '付款周期是多少？' }, identity, traceId),
    ).resolves.toMatchObject({
      answer: '付款周期为 30 天。[来源1]',
      noAnswer: false,
      traceId,
      sources: [{ index: 1, chunkIds: ['a'.repeat(64), 'b'.repeat(64)] }],
      model: { provider: 'deepseek', model: 'deepseek-chat', fallbackUsed: false },
    });
    expect(deps.embedQuery).toHaveBeenCalledWith('付款周期是多少？', {
      sensitivity: 'internal',
    });
    expect(JSON.stringify(deps.record.mock.calls)).not.toContain('付款周期是多少');
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'answered', resultCount: 1 }),
    );
  });

  it('exposes only source references to the quality observer', async () => {
    const deps = dependencies();
    const recordVectorSources = vi.fn();
    const recordFinalSources = vi.fn();
    const observer: QualityQueryObserver = {
      recordVectorSources,
      recordFinalSources,
    };

    await deps.service.query({ question: '付款周期是多少？' }, identity, traceId, observer);

    expect(recordVectorSources).toHaveBeenCalledWith([
      {
        documentId,
        page: 2,
        sheet: null,
        chunkIds: ['a'.repeat(64), 'b'.repeat(64)],
      },
    ]);
    expect(recordFinalSources).toHaveBeenCalledWith([
      {
        documentId,
        page: 2,
        sheet: null,
        chunkIds: ['a'.repeat(64), 'b'.repeat(64)],
      },
    ]);
    expect(JSON.stringify(recordVectorSources.mock.calls)).not.toContain(context.text);
  });

  it('rejects without calling Rerank or LLM when relevance is insufficient', async () => {
    const deps = dependencies({ candidates: [] });

    await expect(
      deps.service.query({ question: '不存在的问题' }, identity, traceId),
    ).resolves.toMatchObject({
      noAnswer: true,
      reason: 'insufficient_relevance',
      sources: [],
      model: null,
    });
    expect(deps.rerank).not.toHaveBeenCalled();
    expect(deps.answer).not.toHaveBeenCalled();
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'no_answer' }));
  });

  it('discards an answer if source authorization changes before return', async () => {
    const deps = dependencies({ finalAuthorized: false });

    await expect(
      deps.service.query({ question: '付款周期是多少？' }, identity, traceId),
    ).resolves.toMatchObject({
      noAnswer: true,
      reason: 'authorization_changed',
      sources: [],
    });
    expect(deps.answer).toHaveBeenCalledOnce();
  });
});
