import { describe, expect, it } from 'vitest';

import {
  buildRetrievalQuestion,
  needsConversationContext,
  selectConversationQuestions,
} from '../src/knowledge/conversation-context';

describe('conversation context', () => {
  it('adds recent user questions when the current question contains a reference', () => {
    expect(buildRetrievalQuestion('前者有哪些优势？', ['比较 Vue 2 和 Vue 3。'])).toBe(
      '对话中的前序问题：\n1. 比较 Vue 2 和 Vue 3。\n\n当前问题：前者有哪些优势？',
    );
  });

  it('keeps standalone questions unchanged to avoid diluting retrieval', () => {
    expect(buildRetrievalQuestion('解释 PostgreSQL 的 MVCC。', ['比较 Vue 2 和 Vue 3。'])).toBe(
      '解释 PostgreSQL 的 MVCC。',
    );
    expect(needsConversationContext('解释 PostgreSQL 的 MVCC。')).toBe(false);
    expect(needsConversationContext('前者有哪些优势？')).toBe(true);
  });

  it('keeps only the newest bounded conversation questions', () => {
    expect(selectConversationQuestions(['一', '二', '三', '四', '五'])).toEqual([
      '二',
      '三',
      '四',
      '五',
    ]);
  });
});
