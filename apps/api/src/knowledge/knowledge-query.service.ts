import { Injectable } from '@nestjs/common';
import type {
  KnowledgeQueryRequest,
  KnowledgeQueryResponse,
  KnowledgeSource,
} from '@nexus-kb/contracts';

import { AclPolicy } from '../auth/acl-policy';
import type { Identity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config/app-config';
import { EmbeddingService } from '../providers/embedding/embedding.service';
import { LlmService } from '../providers/llm/llm.service';
import { RerankService } from '../providers/rerank/rerank.service';
import type { RetrievedChunk } from './retrieved-chunk';
import { QueryAuditService } from './query-audit.service';
import { QueryRateLimiter } from './query-rate-limiter';
import { QueryRetrievalService } from './query-retrieval.service';
import { SourceAuthorizationService } from './source-authorization.service';

const NO_ANSWER_TEXT = '当前知识库中没有找到足够可靠且有权限访问的依据。';

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
  ) {}

  async query(
    request: KnowledgeQueryRequest,
    identity: Identity,
    traceId: string,
  ): Promise<KnowledgeQueryResponse> {
    this.acl.assertCapability(identity, 'documents:read');
    const startedAt = Date.now();
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
      const queryVector = await this.embedding.embedQuery(request.question, {
        sensitivity: identity.defaultSensitivity,
      });
      const candidates = await this.retrieval.retrieve(identity, queryVector);
      if (candidates.length === 0) {
        return await this.noAnswer(auditBase, traceId, 'insufficient_relevance', false, startedAt);
      }
      const reranked = await this.rerank.rerank({
        identity,
        query: request.question,
        chunks: candidates,
        topK: Math.min(this.config.values.RERANK_TOP_K, candidates.length),
        traceId,
      });
      const contexts = await this.sourceAuthorization.retainActiveAuthorizedSources(
        identity,
        reranked.chunks,
      );
      if (contexts.length === 0) {
        return await this.noAnswer(
          auditBase,
          traceId,
          'authorization_changed',
          reranked.degraded,
          startedAt,
        );
      }
      const answer = await this.llm.answer({
        identity,
        question: request.question,
        contexts,
        traceId,
      });
      const finalContexts = await this.sourceAuthorization.retainActiveAuthorizedSources(
        identity,
        contexts,
      );
      if (!this.sameContexts(contexts, finalContexts)) {
        return await this.noAnswer(
          auditBase,
          traceId,
          'authorization_changed',
          reranked.degraded,
          startedAt,
        );
      }
      const sources = finalContexts.map((context, index) => this.source(context, index + 1));
      await this.audit.record({
        ...auditBase,
        outcome: 'answered',
        resultCount: sources.length,
        sourceChunkIds: sources.flatMap((source) => source.chunkIds),
        rerankDegraded: reranked.degraded,
        llmProvider: answer.provider,
        llmModel: answer.model,
        fallbackUsed: answer.fallbackUsed,
        durationMs: Date.now() - startedAt,
      });
      return {
        answer: answer.text,
        noAnswer: false,
        reason: null,
        traceId,
        sources,
        model: {
          provider: answer.provider,
          model: answer.model,
          fallbackUsed: answer.fallbackUsed,
        },
        rerankDegraded: reranked.degraded,
      };
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
  ): Promise<KnowledgeQueryResponse> {
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
      traceId,
      sources: [],
      model: null,
      rerankDegraded,
    };
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
