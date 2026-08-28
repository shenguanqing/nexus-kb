import { Injectable } from '@nestjs/common';

import { LlmProviderError } from '../providers/llm/llm-provider-error';

const SOURCE_PATTERN = /\[来源(\d+)\]/g;
const INSUFFICIENT_ANSWER_PATTERN = /^资料不足[。！]?$/u;

export type AnswerCitationErrorReason = 'empty' | 'insufficient' | 'missing' | 'out_of_range';

/**
 * The model returned text, but it is not safe to present it as a knowledge-base
 * answer because it cannot be tied to one of the authorized contexts.
 */
export class AnswerCitationError extends LlmProviderError {
  constructor(readonly reason: AnswerCitationErrorReason = 'missing') {
    super('invalid_response', false);
    this.name = 'AnswerCitationError';
  }
}

@Injectable()
export class AnswerSourceValidator {
  validate(answer: string, contextCount: number): number[] {
    const normalizedAnswer = answer.trim();
    if (!normalizedAnswer || contextCount < 1) throw new AnswerCitationError('empty');
    const citations = [...answer.matchAll(SOURCE_PATTERN)].map((match) => Number(match[1]));
    if (citations.length === 0) {
      throw new AnswerCitationError(
        INSUFFICIENT_ANSWER_PATTERN.test(normalizedAnswer) ? 'insufficient' : 'missing',
      );
    }
    if (
      citations.some(
        (sourceNumber) =>
          !Number.isInteger(sourceNumber) || sourceNumber < 1 || sourceNumber > contextCount,
      )
    ) {
      throw new AnswerCitationError('out_of_range');
    }
    return [...new Set(citations)];
  }
}
