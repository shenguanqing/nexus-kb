import { describe, expect, it } from 'vitest';

import { AnswerSourceValidator } from '../src/knowledge/answer-source-validator';

describe('AnswerSourceValidator', () => {
  const validator = new AnswerSourceValidator();

  it('accepts only citations that refer to supplied contexts', () => {
    expect(() => validator.validate('答案。[来源1][来源2]', 2)).not.toThrow();
    expect(() => validator.validate('答案。[来源3]', 2)).toThrow();
    expect(() => validator.validate('没有引用的答案。', 2)).toThrow();
  });
});
