import { Injectable } from '@nestjs/common';

import { LlmProviderError } from '../providers/llm/llm-provider-error';

const SOURCE_PATTERN = /\[来源(\d+)\]/g;

@Injectable()
export class AnswerSourceValidator {
  validate(answer: string, contextCount: number): void {
    if (!answer.trim() || contextCount < 1) {
      throw new LlmProviderError('invalid_response', false);
    }
    const citations = [...answer.matchAll(SOURCE_PATTERN)].map((match) => Number(match[1]));
    if (
      citations.length === 0 ||
      citations.some(
        (sourceNumber) =>
          !Number.isInteger(sourceNumber) || sourceNumber < 1 || sourceNumber > contextCount,
      )
    ) {
      throw new LlmProviderError('invalid_response', false);
    }
  }
}
