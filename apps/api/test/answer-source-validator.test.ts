import { describe, expect, it } from 'vitest';

import { AnswerSourceValidator } from '../src/knowledge/answer-source-validator';

describe('AnswerSourceValidator', () => {
  const validator = new AnswerSourceValidator();

  it('accepts only citations that refer to supplied contexts', () => {
    expect(validator.validate('答案。[来源2][来源1][来源2]', 2)).toEqual([2, 1]);
    expect(() => validator.validate('答案。[来源3]', 2)).toThrow(
      expect.objectContaining({ reason: 'out_of_range' }),
    );
    expect(() => validator.validate('没有引用的答案。', 2)).toThrow(
      expect.objectContaining({ reason: 'missing' }),
    );
  });

  it('distinguishes an explicit evidence refusal from a citation formatting failure', () => {
    expect(() => validator.validate('资料不足。', 2)).toThrow(
      expect.objectContaining({ reason: 'insufficient' }),
    );
    expect(() => validator.validate('', 2)).toThrow(expect.objectContaining({ reason: 'empty' }));
  });
});
