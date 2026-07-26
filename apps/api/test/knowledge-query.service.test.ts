import { describe, expect, it, vi } from 'vitest';

import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import type { AppConfig } from '../src/config/app-config';
import {
  AnswerCitationError,
  AnswerSourceValidator,
} from '../src/knowledge/answer-source-validator';
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
const secondContext: RetrievedChunk = {
  ...context,
  id: 'c'.repeat(64),
  text: '第二条可引用的付款依据',
  metadata: {
    ...context.metadata,
    chunkId: 'c'.repeat(64),
    chunkIds: ['c'.repeat(64)],
    ordinal: 3,
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
      LLM_PROVIDER: 'google',
      LLM_MODEL: 'gemini-3.5-flash-lite',
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
    new AnswerSourceValidator(),
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

  it('uses the same canonical question for equivalent product-version spacing', async () => {
    const compact = dependencies();
    const spaced = dependencies();

    await compact.service.query({ question: 'vue2和vue3区别' }, identity, traceId);
    await spaced.service.query({ question: 'vue 2和vue 3区别' }, identity, traceId);

    expect(compact.embedQuery).toHaveBeenCalledWith('vue 2和vue 3区别', {
      sensitivity: 'internal',
    });
    expect(spaced.embedQuery).toHaveBeenCalledWith('vue 2和vue 3区别', {
      sensitivity: 'internal',
    });
    expect(compact.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'vue 2和vue 3区别' }),
    );
    expect(compact.answer).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'vue 2和vue 3区别' }),
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

  it('returns and audits only the sources cited by the answer', async () => {
    const deps = dependencies({ candidates: [context, secondContext] });
    deps.answer.mockResolvedValue({
      text: '付款依据见第二条资料。[来源2]',
      provider: 'deepseek',
      model: 'deepseek-chat',
      fallbackUsed: false,
    });

    await expect(
      deps.service.query({ question: '付款周期是多少？' }, identity, traceId),
    ).resolves.toMatchObject({
      answer: '付款依据见第二条资料。[来源1]',
      sources: [{ index: 1, chunkIds: ['c'.repeat(64)] }],
    });
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'answered',
        resultCount: 1,
        sourceChunkIds: ['c'.repeat(64)],
      }),
    );
  });

  it('renumbers non-contiguous cited sources by first appearance', async () => {
    const candidates = ['a', 'c', 'd', 'e'].map((character, index) => ({
      ...context,
      id: character.repeat(64),
      text: `第 ${index + 1} 条资料`,
      metadata: {
        ...context.metadata,
        chunkId: character.repeat(64),
        chunkIds: [character.repeat(64)],
        ordinal: index,
      },
    }));
    const deps = dependencies({ candidates });
    deps.answer.mockResolvedValue({
      text: '规格由两条资料共同证明。[来源1][来源4]，并再次引用第四条。[来源4]',
      provider: 'deepseek',
      model: 'deepseek-chat',
      fallbackUsed: false,
    });

    await expect(
      deps.service.query({ question: '线缆规格是什么？' }, identity, traceId),
    ).resolves.toMatchObject({
      answer: '规格由两条资料共同证明。[来源1][来源2]，并再次引用第四条。[来源2]',
      sources: [
        { index: 1, chunkIds: ['a'.repeat(64)] },
        { index: 2, chunkIds: ['e'.repeat(64)] },
      ],
    });
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

  it('returns a safe no-answer response when the model omits valid source citations', async () => {
    const deps = dependencies();
    deps.answer.mockRejectedValue(new AnswerCitationError());

    await expect(
      deps.service.query({ question: 'CSS 是什么？' }, identity, traceId),
    ).resolves.toMatchObject({
      noAnswer: true,
      reason: 'insufficient_relevance',
      sources: [],
      model: null,
    });
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'no_answer',
        llmProvider: 'google',
        llmModel: 'gemini-3.5-flash-lite',
      }),
    );
    expect(deps.record).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
  });
});
