import type { ConversationTurn } from '@nexus-kb/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import HistoryAnswer from './HistoryAnswer.vue';

const turn: ConversationTurn = {
  id: 'a7305592-1682-478e-920f-23c4c3ec7d3e',
  question: 'Vue 3 有哪些特性？',
  answer: '### 主要特性\n\n- **Composition API**\n- Proxy [来源1]',
  noAnswer: false,
  reason: null,
  answerMode: 'grounded',
  traceId: '83fcad07-64b0-4d94-9fd4-42cb82038db9',
  sourceCount: 1,
  createdAt: '2026-07-26T04:00:00.000Z',
};

describe('HistoryAnswer', () => {
  it('renders a stored answer as safe Markdown', () => {
    const wrapper = mount(HistoryAnswer, { props: { turn } });

    expect(wrapper.get('.history-answer h3').text()).toBe('主要特性');
    expect(wrapper.get('.markdown-content strong').text()).toBe('Composition API');
    expect(wrapper.get('.answer-citation').text()).toBe('[来源1]');
    expect(wrapper.get('.history-answer-meta').text()).toContain('1 个历史来源');
  });

  it('labels a historical general-knowledge answer', () => {
    const wrapper = mount(HistoryAnswer, {
      props: {
        turn: {
          ...turn,
          answer: 'Vue 3 使用 Proxy 实现响应式。',
          answerMode: 'general',
          sourceCount: 0,
        },
      },
    });

    expect(wrapper.get('.general-answer-notice').text()).toContain('非企业知识库资料');
    expect(wrapper.get('.markdown-content').text()).toContain('Vue 3 使用 Proxy');
  });
});
