import { Injectable } from '@nestjs/common';

import type { Identity } from '../../auth/identity';
import {
  AnswerCitationError,
  AnswerSourceValidator,
} from '../../knowledge/answer-source-validator';
import { KnowledgeContextPolicy } from '../../knowledge/knowledge-context-policy';
import type { RetrievedChunk } from '../../knowledge/retrieved-chunk';
import { OperationalLogger } from '../../common/operational-logger';
import type { LlmAnswer } from './llm-provider';
import { LlmProviderError } from './llm-provider-error';
import { LlmProviderFactory } from './llm-provider.factory';

export interface SecuredLlmAnswer extends LlmAnswer {
  provider: string;
  model: string;
  fallbackUsed: boolean;
}

@Injectable()
export class LlmService {
  constructor(
    private readonly factory: LlmProviderFactory,
    private readonly contextPolicy: KnowledgeContextPolicy,
    private readonly sourceValidator: AnswerSourceValidator,
    private readonly logger: OperationalLogger,
  ) {}

  async answer(input: {
    identity: Identity;
    question: string;
    contexts: RetrievedChunk[];
    traceId: string;
  }): Promise<SecuredLlmAnswer> {
    const primary = this.factory.getPrimary();
    try {
      return await this.answerWith(primary, input, false);
    } catch (error) {
      if (!(error instanceof LlmProviderError) || !error.retryable) throw error;
      const fallback = this.factory.getFallback();
      if (!fallback) throw error;
      this.logger.warn('llm_fallback_activated', {
        traceId: input.traceId,
        tenantId: input.identity.tenantId,
        userId: input.identity.userId,
        provider: primary.id,
        model: primary.model,
        status: error.kind,
        errorCode: error.code,
      });
      return this.answerWith(fallback, input, true);
    }
  }

  private async answerWith(
    provider: ReturnType<LlmProviderFactory['getPrimary']>,
    input: {
      identity: Identity;
      question: string;
      contexts: RetrievedChunk[];
      traceId: string;
    },
    fallbackUsed: boolean,
  ): Promise<SecuredLlmAnswer> {
    if (
      !this.contextPolicy.allAllowed(input.identity, input.contexts, 'llm', {
        id: provider.id,
        region: provider.region,
      })
    ) {
      throw new LlmProviderError('policy_denied', false);
    }
    let answer = await provider.answer(input);
    try {
      this.sourceValidator.validate(answer.text, input.contexts.length);
    } catch (error) {
      if (!(error instanceof AnswerCitationError)) throw error;
      this.logger.warn('llm_citation_repair_retry', {
        traceId: input.traceId,
        tenantId: input.identity.tenantId,
        userId: input.identity.userId,
        provider: provider.id,
        model: provider.model,
        status: 'invalid_citation',
      });
      answer = await provider.answer({ ...input, citationRepair: true });
      this.sourceValidator.validate(answer.text, input.contexts.length);
    }
    return {
      ...answer,
      provider: provider.id,
      model: provider.model,
      fallbackUsed,
    };
  }
}
