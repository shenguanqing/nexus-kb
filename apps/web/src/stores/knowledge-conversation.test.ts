import type { KnowledgeQueryResponse } from '@nexus-kb/contracts';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useKnowledgeConversationStore } from './knowledge-conversation';

const response: KnowledgeQueryResponse = {
  conversationId: '11111111-1111-4111-8111-111111111111',
  answer: '付款周期为 30 天。[来源1]',
  noAnswer: false,
  reason: null,
  answerMode: 'grounded',
  traceId: '21111111-1111-4111-8111-111111111111',
  sources: [
    {
      index: 1,
      documentId: '31111111-1111-4111-8111-111111111111',
      documentVersion: 1,
      chunkIds: ['a'.repeat(64)],
      sourceName: '付款制度.md',
      page: 2,
      sheet: null,
      sectionPath: ['付款'],
    },
  ],
  model: { provider: 'fixture', model: 'fixture-model', fallbackUsed: false },
  rerankDegraded: false,
};

describe('knowledge conversation store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('keeps completed turns until the user starts a new conversation', () => {
    const store = useKnowledgeConversationStore();
    const requestId = store.begin('付款周期是多少？');

    expect(store.complete(requestId, response)).toBe(true);
    expect(store.turns).toHaveLength(1);
    expect(store.conversationId).toBe(response.conversationId);

    store.reset();
    expect(store.turns).toEqual([]);
    expect(store.conversationId).toBeUndefined();
  });

  it('ignores a response that completes after the user starts a new conversation', () => {
    const store = useKnowledgeConversationStore();
    const requestId = store.begin('付款周期是多少？');
    store.reset();

    expect(store.complete(requestId, response)).toBe(false);
    expect(store.turns).toEqual([]);
    expect(store.conversationId).toBeUndefined();
  });
});
