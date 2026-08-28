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

  it('recognizes short action-only follow-ups with an omitted subject', () => {
    expect(needsConversationContext('列个需要的材料表格')).toBe(true);
    expect(needsConversationContext('整理成表格')).toBe(true);
    expect(needsConversationContext('详细说说申请步骤')).toBe(true);
    expect(needsConversationContext('需要哪些材料？')).toBe(true);
    expect(needsConversationContext('材料列个表格')).toBe(true);
    expect(needsConversationContext('所需材料列个表格')).toBe(true);
    expect(needsConversationContext('申请材料整理一下')).toBe(true);
    expect(buildRetrievalQuestion('列个需要的材料表格', ['西班牙的 NIE 申请条件'])).toBe(
      '对话中的前序问题：\n1. 西班牙的 NIE 申请条件\n\n当前问题：列个需要的材料表格',
    );
  });

  it('does not treat an action with an explicit subject as an implicit follow-up', () => {
    expect(needsConversationContext('列出 PostgreSQL 锁类型表格')).toBe(false);
    expect(needsConversationContext('总结西班牙 NIE 申请条件')).toBe(false);
    expect(needsConversationContext('西班牙 NIE 申请材料列个表格')).toBe(false);
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
