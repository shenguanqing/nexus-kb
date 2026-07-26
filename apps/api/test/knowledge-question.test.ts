import { describe, expect, it } from 'vitest';

import { normalizeKnowledgeQuestion } from '../src/knowledge/knowledge-question';

describe('normalizeKnowledgeQuestion', () => {
  it('canonicalizes spacing around ASCII product versions', () => {
    expect(normalizeKnowledgeQuestion('vue2和vue3区别')).toBe('vue 2和vue 3区别');
    expect(normalizeKnowledgeQuestion('vue 2和vue 3区别')).toBe('vue 2和vue 3区别');
    expect(normalizeKnowledgeQuestion('Vue   2 和 Vue  3 区别')).toBe('Vue 2 和 Vue 3 区别');
  });

  it('normalizes compatibility characters and repeated whitespace', () => {
    expect(normalizeKnowledgeQuestion('Ｖｕｅ３\t新特性')).toBe('Vue 3 新特性');
  });
});
