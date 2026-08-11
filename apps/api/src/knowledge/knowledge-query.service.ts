import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import type {
  KnowledgeQueryRequest,
  KnowledgeQueryResponse,
  KnowledgeSource,
  QualitySource,
} from '@nexus-kb/contracts';

import { AclPolicy } from '../auth/acl-policy';
import type { Identity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config/app-config';
import { EmbeddingService } from '../providers/embedding/embedding.service';
import { LlmService } from '../providers/llm/llm.service';
import { LlmProviderError } from '../providers/llm/llm-provider-error';
import { RerankService } from '../providers/rerank/rerank.service';
import type { RetrievedChunk } from './retrieved-chunk';
import { QueryAuditService } from './query-audit.service';
import { QueryRateLimiter } from './query-rate-limiter';
import { QueryRetrievalService } from './query-retrieval.service';
import { SourceAuthorizationService } from './source-authorization.service';
import { KnowledgeHistoryService } from '../history/knowledge-history.service';
import { AnswerCitationError, AnswerSourceValidator } from './answer-source-validator';
import { normalizeKnowledgeQuestion } from './knowledge-question';
import {
  buildRetrievalQuestion,
  needsConversationContext,
  selectConversationQuestions,
} from './conversation-context';

const NO_ANSWER_TEXT = '当前知识库中没有找到足够可靠且有权限访问的依据。';
type QueryResult = Omit<KnowledgeQueryResponse, 'conversationId'>;

export interface QualityQueryObserver {
  recordVectorSources(sources: QualitySource[]): void;
  recordFinalSources(sources: QualitySource[]): void;
}

@Injectable()
export class KnowledgeQueryService {
  constructor(
    private readonly config: AppConfig,
    private readonly acl: AclPolicy,
    private readonly rateLimiter: QueryRateLimiter,
    private readonly embedding: EmbeddingService,
    private readonly retrieval: QueryRetrievalService,
    private readonly rerank: RerankService,
    private readonly llm: LlmService,
    private readonly sourceAuthorization: SourceAuthorizationService,
    private readonly audit: QueryAuditService,
    private readonly sourceValidator: AnswerSourceValidator,
    @Optional() private readonly history?: KnowledgeHistoryService,
  ) {}

  async query(
    request: KnowledgeQueryRequest,
    identity: Identity,
    traceId: string,
    observer?: QualityQueryObserver,
  ): Promise<KnowledgeQueryResponse> {
    this.acl.assertCapability(identity, 'documents:read');
    const startedAt = Date.now();
    const normalizedQuestion = normalizeKnowledgeQuestion(request.question);
    const auditBase = {
      traceId,
      identity,
      queryLength: [...request.question].length,
      embeddingProvider: this.config.values.EMBEDDING_PROVIDER,
      embeddingModel: this.config.values.EMBEDDING_MODEL,
      rerankProvider:
        this.config.values.RERANK_PROVIDER === 'none'
          ? undefined
          : this.config.values.RERANK_PROVIDER,
      rerankModel:
        this.config.values.RERANK_PROVIDER === 'none' ? undefined : this.config.values.RERANK_MODEL,
    };
    try {
      await this.rateLimiter.assertAllowed(identity);
      const recentQuestions = request.conversationId
        ? selectConversationQuestions(
            (await this.history?.recentQuestions(request.conversationId, identity)) ?? [],
          ).map((question) => normalizeKnowledgeQuestion(question))
        : [];
      const conversationQuestions = needsConversationContext(normalizedQuestion)
        ? recentQuestions
        : [];
      const retrievalQuestion = buildRetrievalQuestion(normalizedQuestion, conversationQuestions);
      const queryVector = await this.embedding.embedQuery(retrievalQuestion, {
        sensitivity: identity.defaultSensitivity,
      });
      const candidates = await this.retrieval.retrieve(identity, queryVector);
      observer?.recordVectorSources(candidates.map((candidate) => this.qualitySource(candidate)));
      if (candidates.length === 0) {
        observer?.recordFinalSources([]);
        return await this.withHistory(
          request,
          identity,
          await this.generalAnswerOrNoAnswer(
            auditBase,
            identity,
            normalizedQuestion,
            conversationQuestions,
            traceId,
            false,
            startedAt,
          ),
        );
      }
      const reranked = await this.rerank.rerank({
        identity,
        query: retrievalQuestion,
        chunks: candidates,
        topK: Math.min(this.config.values.RERANK_TOP_K, candidates.length),
        traceId,
      });
      const contexts = await this.sourceAuthorization.retainActiveAuthorizedSources(
        identity,
        this.limitLlmContexts(reranked.chunks),
      );
      if (contexts.length === 0) {
        observer?.recordFinalSources([]);
        return await this.withHistory(
          request,
          identity,
          await this.noAnswer(
            auditBase,
            traceId,
            'authorization_changed',
            reranked.degraded,
            startedAt,
          ),
        );
      }
      let answer: Awaited<ReturnType<LlmService['answer']>>;
      let citedSourceIndexes: number[] = [];
      try {
        answer = await this.llm.answer({
          identity,
          question: normalizedQuestion,
          conversationQuestions,
          contexts,
          traceId,
        });
        citedSourceIndexes = this.sourceValidator.validate(answer.text, contexts.length);
      } catch (error) {
        if (error instanceof AnswerCitationError) {
          observer?.recordFinalSources([]);
          return await this.withHistory(
            request,
            identity,
            await this.generalAnswerOrNoAnswer(
              {
                ...auditBase,
                ...this.configuredLlmAuditFields(),
                errorCode: 'LLM_ANSWER_UNVERIFIABLE',
              },
              identity,
              normalizedQuestion,
              conversationQuestions,
              traceId,
              reranked.degraded,
              startedAt,
            ),
          );
        }
        throw error;
      }
      const finalContexts = await this.sourceAuthorization.retainActiveAuthorizedSources(
        identity,
        contexts,
      );
      observer?.recordFinalSources(finalContexts.map((context) => this.qualitySource(context)));
      if (!this.sameContexts(contexts, finalContexts)) {
        return await this.withHistory(
          request,
          identity,
          await this.noAnswer(
            {
              ...auditBase,
              llmProvider: answer.provider,
              llmModel: answer.model,
            },
            traceId,
            'authorization_changed',
            reranked.degraded,
            startedAt,
          ),
        );
      }
      const compactSourceIndexes = new Map(
        citedSourceIndexes.map((sourceIndex, index) => [sourceIndex, index + 1]),
      );
      const compactAnswer = answer.text.replace(
        /\[来源(\d+)\]/g,
        (citation, sourceIndex: string) => {
          const compactIndex = compactSourceIndexes.get(Number(sourceIndex));
          return compactIndex === undefined ? citation : `[来源${compactIndex}]`;
        },
      );
      const sources = citedSourceIndexes.map((sourceIndex, index) =>
        this.source(finalContexts[sourceIndex - 1]!, index + 1),
      );
      await this.audit.record({
        ...auditBase,
        outcome: 'answered',
        answerMode: 'grounded',
        resultCount: sources.length,
        sourceChunkIds: sources.flatMap((source) => source.chunkIds),
        rerankDegraded: reranked.degraded,
        llmProvider: answer.provider,
        llmModel: answer.model,
        fallbackUsed: answer.fallbackUsed,
        durationMs: Date.now() - startedAt,
      });
      return await this.withHistory(request, identity, {
        answer: compactAnswer,
        noAnswer: false,
        reason: null,
        answerMode: 'grounded',
        traceId,
        sources,
        model: {
          provider: answer.provider,
          model: answer.model,
          fallbackUsed: answer.fallbackUsed,
        },
        rerankDegraded: reranked.degraded,
      });
    } catch (error) {
      await this.audit.record({
        ...auditBase,
        outcome: 'failed',
        resultCount: 0,
        sourceChunkIds: [],
        errorCode: this.errorCode(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  private async noAnswer(
    auditBase: Omit<
      Parameters<QueryAuditService['record']>[0],
      'outcome' | 'resultCount' | 'sourceChunkIds' | 'durationMs'
    >,
    traceId: string,
    reason: 'insufficient_relevance' | 'authorization_changed',
    rerankDegraded: boolean,
    startedAt: number,
  ): Promise<QueryResult> {
    await this.audit.record({
      ...auditBase,
      outcome: 'no_answer',
      resultCount: 0,
      sourceChunkIds: [],
      rerankDegraded,
      durationMs: Date.now() - startedAt,
    });
    return {
      answer: NO_ANSWER_TEXT,
      noAnswer: true,
      reason,
      answerMode: null,
      traceId,
      sources: [],
      model: null,
      rerankDegraded,
    };
  }

  private async generalAnswerOrNoAnswer(
    auditBase: Omit<
      Parameters<QueryAuditService['record']>[0],
      'outcome' | 'resultCount' | 'sourceChunkIds' | 'durationMs'
    >,
    identity: Identity,
    question: string,
    conversationQuestions: string[],
    traceId: string,
    rerankDegraded: boolean,
    startedAt: number,
  ): Promise<QueryResult> {
    if (
      this.config.values.QUERY_ANSWER_MODE !== 'hybrid' ||
      this.config.values.LLM_PROVIDER === 'none'
    ) {
      return this.noAnswer(auditBase, traceId, 'insufficient_relevance', rerankDegraded, startedAt);
    }
    let answer: Awaited<ReturnType<LlmService['answerGeneral']>>;
    try {
      answer = await this.llm.answerGeneral({
        identity,
        question,
        conversationQuestions,
        traceId,
      });
    } catch (error) {
      if (error instanceof LlmProviderError && error.kind === 'policy_denied') {
        return this.noAnswer(
          { ...auditBase, errorCode: 'GENERAL_ANSWER_POLICY_BLOCKED' },
          traceId,
          'insufficient_relevance',
          rerankDegraded,
          startedAt,
        );
      }
      throw error;
    }
    await this.audit.record({
      ...auditBase,
      outcome: 'answered',
      answerMode: 'general',
      resultCount: 0,
      sourceChunkIds: [],
      rerankDegraded,
      llmProvider: answer.provider,
      llmModel: answer.model,
      fallbackUsed: answer.fallbackUsed,
      durationMs: Date.now() - startedAt,
    });
    return {
      answer: answer.text,
      noAnswer: false,
      reason: null,
      answerMode: 'general',
      traceId,
      sources: [],
      model: {
        provider: answer.provider,
        model: answer.model,
        fallbackUsed: answer.fallbackUsed,
      },
      rerankDegraded,
    };
  }

  private configuredLlmAuditFields(): { llmProvider?: string; llmModel?: string } {
    if (this.config.values.LLM_PROVIDER === 'none') return {};
    return {
      llmProvider: this.config.values.LLM_PROVIDER,
      ...(this.config.values.LLM_MODEL ? { llmModel: this.config.values.LLM_MODEL } : {}),
    };
  }

  private limitLlmContexts(contexts: RetrievedChunk[]): RetrievedChunk[] {
    let characters = 0;
    return contexts.filter((context) => {
      if (characters + context.text.length > this.config.values.QUERY_MAX_LLM_CONTEXT_CHARS) {
        return false;
      }
      characters += context.text.length;
      return true;
    });
  }

  private async withHistory(
    request: KnowledgeQueryRequest,
    identity: Identity,
    response: QueryResult,
  ): Promise<KnowledgeQueryResponse> {
    const conversationId = this.history
      ? await this.history.recordTurn(request.conversationId, request.question, response, identity)
      : (request.conversationId ?? randomUUID());
    return { conversationId, ...response };
  }

  private source(context: RetrievedChunk, index: number): KnowledgeSource {
    return {
      index,
      documentId: context.metadata.documentId,
      documentVersion: context.metadata.documentVersion,
      chunkIds: context.metadata.chunkIds ?? [context.metadata.chunkId],
      sourceName: context.metadata.sourceName,
      page: context.metadata.page ?? null,
      sheet: context.metadata.sheet ?? null,
      sectionPath: context.metadata.sectionPath ?? [],
    };
  }

  private qualitySource(context: RetrievedChunk): QualitySource {
    return {
      documentId: context.metadata.documentId,
      page: context.metadata.page ?? null,
      sheet: context.metadata.sheet ?? null,
      chunkIds: context.metadata.chunkIds ?? [context.metadata.chunkId],
    };
  }

  private sameContexts(before: RetrievedChunk[], after: RetrievedChunk[]): boolean {
    return (
      before.length === after.length &&
      before.every((chunk, index) => chunk.id === after[index]?.id)
    );
  }

  private errorCode(error: unknown): string {
    if (error instanceof ApiException) return error.code;
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = error.code;
      if (typeof code === 'string') return code.slice(0, 128);
    }
    return 'QUERY_FAILED';
  }
}
