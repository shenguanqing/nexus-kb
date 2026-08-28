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
import { LlmProviderError } from '../src/providers/llm/llm-provider-error';
import type { RerankService } from '../src/providers/rerank/rerank.service';
import type { KnowledgeHistoryService } from '../src/history/knowledge-history.service';

const traceId = 'd26720b3-1f78-40df-868d-8ca8510dca26';
const documentId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: ['user'],
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

function dependencies(
  options: {
    candidates?: RetrievedChunk[];
    finalAuthorized?: boolean;
    queryAnswerMode?: 'strict' | 'hybrid';
    recentQuestions?: string[];
    maxLlmContextChars?: number;
    documentScoped?: boolean;
  } = {},
) {
  const candidates = options.candidates ?? [context];
  const assertAllowed = vi.fn().mockResolvedValue(undefined);
  const embedQuery = vi.fn().mockResolvedValue([1, 0, 0]);
  const retrieveDetailed = vi.fn().mockResolvedValue({
    contexts: candidates,
    matchedDocumentIds: options.documentScoped ? [documentId] : [],
  });
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
  const answerGeneral = vi.fn().mockResolvedValue({
    text: '这是模型通用知识回答。',
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
      QUERY_MAX_LLM_CONTEXT_CHARS: options.maxLlmContextChars ?? 32_000,
      QUERY_ANSWER_MODE: options.queryAnswerMode ?? 'hybrid',
    },
  } as AppConfig;
  const recentQuestions = vi.fn().mockResolvedValue(options.recentQuestions ?? []);
  const assertOwned = vi.fn().mockResolvedValue(undefined);
  const recordTurn = vi.fn().mockResolvedValue('11111111-1111-4111-8111-111111111111');
  const history =
    options.recentQuestions === undefined
      ? undefined
      : ({ assertOwned, recentQuestions, recordTurn } as unknown as KnowledgeHistoryService);
  const service = new KnowledgeQueryService(
    config,
    new AclPolicy(),
    { assertAllowed } as unknown as QueryRateLimiter,
    { embedQuery } as unknown as EmbeddingService,
    { retrieveDetailed } as unknown as QueryRetrievalService,
    { rerank } as unknown as RerankService,
    { answer, answerGeneral } as unknown as LlmService,
    { retainActiveAuthorizedSources } as unknown as SourceAuthorizationService,
    { record } as unknown as QueryAuditService,
    new AnswerSourceValidator(),
    history,
  );
  return {
    service,
    assertAllowed,
    embedQuery,
    retrieveDetailed,
    rerank,
    answer,
    answerGeneral,
    record,
    assertOwned,
    recentQuestions,
  };
}

describe('KnowledgeQueryService', () => {
  it('answers with reauthorized real sources and writes no question plaintext to audit', async () => {
    const deps = dependencies();

    await expect(
      deps.service.query({ question: '付款周期是多少？' }, identity, traceId),
    ).resolves.toMatchObject({
      answer: '付款周期为 30 天。[来源1]',
      noAnswer: false,
      answerMode: 'grounded',
      traceId,
      sources: [{ index: 1, chunkIds: ['a'.repeat(64), 'b'.repeat(64)] }],
      model: { provider: 'deepseek', model: 'deepseek-chat', fallbackUsed: false },
    });
    expect(deps.embedQuery).toHaveBeenCalledWith('付款周期是多少？', {
      sensitivity: 'internal',
      tenantId: 'tenant-a',
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
      tenantId: 'tenant-a',
    });
    expect(spaced.embedQuery).toHaveBeenCalledWith('vue 2和vue 3区别', {
      sensitivity: 'internal',
      tenantId: 'tenant-a',
    });
    expect(compact.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'vue 2和vue 3区别' }),
    );
    expect(compact.answer).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'vue 2和vue 3区别' }),
    );
  });

  it('uses owned recent questions to resolve references without sending prior answers', async () => {
    const deps = dependencies({ recentQuestions: ['比较 Vue 2 和 Vue 3。'] });
    const conversationId = '11111111-1111-4111-8111-111111111111';

    await deps.service.query({ conversationId, question: '前者有什么优势？' }, identity, traceId);

    const contextualQuestion =
      '对话中的前序问题：\n1. 比较 Vue 2 和 Vue 3。\n\n当前问题：前者有什么优势？';
    expect(deps.recentQuestions).toHaveBeenCalledWith(conversationId, identity);
    expect(deps.embedQuery).toHaveBeenCalledWith(contextualQuestion, {
      sensitivity: 'internal',
      tenantId: 'tenant-a',
    });
    expect(deps.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ query: contextualQuestion }),
    );
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        question: '前者有什么优势？',
        conversationQuestions: ['比较 Vue 2 和 Vue 3。'],
      }),
    );
  });

  it('uses the previous question for an action-only follow-up with an omitted subject', async () => {
    const deps = dependencies({ recentQuestions: ['西班牙的 NIE 申请条件'] });
    const conversationId = '11111111-1111-4111-8111-111111111111';

    await deps.service.query({ conversationId, question: '列个需要的材料表格' }, identity, traceId);

    const contextualQuestion =
      '对话中的前序问题：\n1. 西班牙的 NIE 申请条件\n\n当前问题：列个需要的材料表格';
    expect(deps.recentQuestions).toHaveBeenCalledWith(conversationId, identity);
    expect(deps.assertOwned).not.toHaveBeenCalled();
    expect(deps.embedQuery).toHaveBeenCalledWith(contextualQuestion, {
      sensitivity: 'internal',
      tenantId: 'tenant-a',
    });
    expect(deps.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ query: contextualQuestion }),
    );
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        question: '列个需要的材料表格',
        conversationQuestions: ['西班牙的 NIE 申请条件'],
      }),
    );
  });

  it('uses the previous question when the generic object appears before the follow-up action', async () => {
    const deps = dependencies({ recentQuestions: ['西班牙NIE申请条件'] });
    const conversationId = '11111111-1111-4111-8111-111111111111';

    await deps.service.query({ conversationId, question: '材料列个表格' }, identity, traceId);

    const contextualQuestion = '对话中的前序问题：\n1. 西班牙NIE申请条件\n\n当前问题：材料列个表格';
    expect(deps.recentQuestions).toHaveBeenCalledWith(conversationId, identity);
    expect(deps.embedQuery).toHaveBeenCalledWith(contextualQuestion, {
      sensitivity: 'internal',
      tenantId: 'tenant-a',
    });
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        question: '材料列个表格',
        conversationQuestions: ['西班牙NIE申请条件'],
      }),
    );
  });

  it('does not send conversation history for a standalone question', async () => {
    const deps = dependencies({ recentQuestions: ['比较 Vue 2 和 Vue 3。'] });
    const conversationId = '11111111-1111-4111-8111-111111111111';

    await deps.service.query(
      { conversationId, question: '解释 PostgreSQL 的 MVCC。' },
      identity,
      traceId,
    );

    expect(deps.embedQuery).toHaveBeenCalledWith('解释 PostgreSQL 的 MVCC。', {
      sensitivity: 'internal',
      tenantId: 'tenant-a',
    });
    expect(deps.assertOwned).toHaveBeenCalledWith(conversationId, identity);
    expect(deps.recentQuestions).not.toHaveBeenCalled();
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        question: '解释 PostgreSQL 的 MVCC。',
        conversationQuestions: [],
      }),
    );
  });

  it('limits the post-rerank LLM context while preserving relevance order', async () => {
    const first = { ...context, text: 'a'.repeat(20) };
    const second = { ...secondContext, text: 'b'.repeat(20) };
    const deps = dependencies({
      candidates: [first, second],
      maxLlmContextChars: 20,
    });

    await deps.service.query({ question: '付款依据是什么？' }, identity, traceId);

    expect(deps.answer).toHaveBeenCalledWith(expect.objectContaining({ contexts: [first] }));
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

  it('returns a labeled general answer without Rerank when relevance is insufficient', async () => {
    const deps = dependencies({ candidates: [] });

    await expect(
      deps.service.query({ question: '不存在的问题' }, identity, traceId),
    ).resolves.toMatchObject({
      noAnswer: false,
      reason: null,
      answerMode: 'general',
      sources: [],
      model: { provider: 'deepseek', model: 'deepseek-chat' },
    });
    expect(deps.rerank).not.toHaveBeenCalled();
    expect(deps.answer).not.toHaveBeenCalled();
    expect(deps.answerGeneral).toHaveBeenCalledWith(
      expect.objectContaining({ question: '不存在的问题' }),
    );
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'answered', answerMode: 'general', resultCount: 0 }),
    );
  });

  it('does not replace an explicit document-scoped miss with general knowledge', async () => {
    const deps = dependencies({ candidates: [], documentScoped: true });

    await expect(
      deps.service.query({ question: '消控室里有几个机柜' }, identity, traceId),
    ).resolves.toMatchObject({
      noAnswer: true,
      reason: 'insufficient_relevance',
      answerMode: null,
      sources: [],
      model: null,
    });
    expect(deps.answerGeneral).not.toHaveBeenCalled();
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'no_answer', resultCount: 0 }),
    );
  });

  it('keeps the original no-answer behavior when strict mode is configured', async () => {
    const deps = dependencies({ candidates: [], queryAnswerMode: 'strict' });

    await expect(
      deps.service.query({ question: '不存在的问题' }, identity, traceId),
    ).resolves.toMatchObject({
      noAnswer: true,
      reason: 'insufficient_relevance',
      answerMode: null,
      sources: [],
      model: null,
    });
    expect(deps.answerGeneral).not.toHaveBeenCalled();
  });

  it('discards an answer if source authorization changes before return', async () => {
    const deps = dependencies({ finalAuthorized: false });

    await expect(
      deps.service.query({ question: '付款周期是多少？' }, identity, traceId),
    ).resolves.toMatchObject({
      noAnswer: true,
      reason: 'authorization_changed',
      answerMode: null,
      sources: [],
    });
    expect(deps.answer).toHaveBeenCalledOnce();
  });

  it('falls back to a general answer when a grounded answer remains unverifiable', async () => {
    const deps = dependencies();
    deps.answer.mockRejectedValue(new AnswerCitationError());

    await expect(
      deps.service.query({ question: 'CSS 是什么？' }, identity, traceId),
    ).resolves.toMatchObject({
      noAnswer: false,
      reason: null,
      answerMode: 'general',
      sources: [],
      model: { provider: 'deepseek', model: 'deepseek-chat' },
    });
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'answered',
        answerMode: 'general',
        llmProvider: 'deepseek',
        llmModel: 'deepseek-chat',
      }),
    );
    expect(deps.record).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
  });

  it('records an explicit grounded refusal separately and returns a general answer without repair', async () => {
    const deps = dependencies();
    deps.answer.mockRejectedValue(new AnswerCitationError('insufficient'));

    await expect(
      deps.service.query({ question: 'NIE 需要哪些材料？' }, identity, traceId),
    ).resolves.toMatchObject({
      noAnswer: false,
      answerMode: 'general',
      sources: [],
    });
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'answered',
        answerMode: 'general',
        errorCode: 'LLM_CONTEXT_INSUFFICIENT',
      }),
    );
  });

  it('keeps a document-scoped grounded refusal as no-answer instead of general knowledge', async () => {
    const deps = dependencies({ documentScoped: true });
    deps.answer.mockRejectedValue(new AnswerCitationError('insufficient'));

    await expect(
      deps.service.query({ question: '幼儿园弱电平面尺寸' }, identity, traceId),
    ).resolves.toMatchObject({
      noAnswer: true,
      reason: 'insufficient_relevance',
      answerMode: null,
      sources: [],
      model: null,
    });
    expect(deps.answerGeneral).not.toHaveBeenCalled();
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'no_answer',
        errorCode: 'LLM_CONTEXT_INSUFFICIENT',
      }),
    );
  });

  it('keeps a safe no-answer when general question egress is policy-blocked', async () => {
    const deps = dependencies({ candidates: [] });
    deps.answerGeneral.mockRejectedValue(new LlmProviderError('policy_denied', false));

    await expect(
      deps.service.query({ question: '机密问题' }, identity, traceId),
    ).resolves.toMatchObject({
      noAnswer: true,
      answerMode: null,
      sources: [],
      model: null,
    });
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'no_answer',
        errorCode: 'GENERAL_ANSWER_POLICY_BLOCKED',
      }),
    );
  });
});
