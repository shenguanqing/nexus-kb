import { Injectable } from '@nestjs/common';

import { LlmProviderError } from '../providers/llm/llm-provider-error';

const SOURCE_PATTERN = /\[来源(\d+)\]/g;

/**
 * The model returned text, but it is not safe to present it as a knowledge-base
 * answer because it cannot be tied to one of the authorized contexts.
 */
export class AnswerCitationError extends LlmProviderError {
  constructor() {
    super('invalid_response', false);
    this.name = 'AnswerCitationError';
  }
}

@Injectable()
export class AnswerSourceValidator {
  validate(answer: string, contextCount: number): number[] {
    if (!answer.trim() || contextCount < 1) {
      throw new AnswerCitationError();
    }
    const citations = [...answer.matchAll(SOURCE_PATTERN)].map((match) => Number(match[1]));
    if (
      citations.length === 0 ||
      citations.some(
        (sourceNumber) =>
          !Number.isInteger(sourceNumber) || sourceNumber < 1 || sourceNumber > contextCount,
      )
    ) {
      throw new AnswerCitationError();
    }
    return [...new Set(citations)];
  }
}
