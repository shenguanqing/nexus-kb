import type { ConversationTurn } from '@nexus-kb/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import HistoryViewAnswer from './HistoryViewAnswer.vue';

const turn: ConversationTurn = {
  id: 'a7305592-1682-478e-920f-23c4c3ec7d3e',
  question: 'Vue 3 有哪些特性？',
  answer: '### 主要特性\n\n- **Composition API**\n- Proxy [来源1]',
  noAnswer: false,
  reason: null,
  answerMode: 'grounded',
  traceId: '83fcad07-64b0-4d94-9fd4-42cb82038db9',
  sources: [
    {
      index: 1,
      documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      documentVersion: 1,
      chunkIds: ['1'.repeat(64)],
      sourceName: 'vue.md',
      page: 2,
      sheet: null,
      sectionPath: ['响应式'],
    },
  ],
  sourceCount: 1,
  createdAt: '2026-07-26T04:00:00.000Z',
};

describe('HistoryViewAnswer', () => {
  it('renders interactive citations and matching historical source cards', async () => {
    const wrapper = mount(HistoryViewAnswer, { props: { turn } });

    expect(wrapper.get('.history-answer .markdown-heading--h3').text()).toBe('主要特性');
    expect(wrapper.get('.markdown-content strong').text()).toBe('Composition API');
    expect(wrapper.get('.kb-answer-citation').text()).toBe('[来源1]');
    expect(wrapper.get('.kb-answer-sources__card').text()).toContain('vue.md');
    expect(wrapper.get('.history-answer-meta').text()).toContain('1 个历史来源');
    await wrapper.get('button.kb-answer-citation').trigger('click');
    expect(wrapper.emitted('selectSource')?.[0]?.[0]).toMatchObject({ index: 1 });
    await wrapper.get('.kb-answer-sources__card').trigger('click');
    expect(wrapper.emitted('selectSource')?.[1]?.[0]).toMatchObject({ index: 1 });
  });

  it('labels a historical general-knowledge answer', () => {
    const wrapper = mount(HistoryViewAnswer, {
      props: {
        turn: {
          ...turn,
          answer: 'Vue 3 使用 Proxy 实现响应式。',
          answerMode: 'general',
          sources: [],
          sourceCount: 0,
        },
      },
    });

    expect(wrapper.get('.kb-answer-notice').text()).toContain('非知识库资料');
    expect(wrapper.get('.markdown-content').text()).toContain('Vue 3 使用 Proxy');
  });
});
