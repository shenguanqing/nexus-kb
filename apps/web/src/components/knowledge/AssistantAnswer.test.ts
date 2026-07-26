import type { KnowledgeQueryResponse } from '@nexus-kb/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AssistantAnswer from './AssistantAnswer.vue';

const response: KnowledgeQueryResponse = {
  conversationId: '5b9fd225-a565-42cd-8d63-1fc3f19b745d',
  answer: 'Vue 3 使用 Proxy。[来源1][来源2]\n并支持 Composition API。[来源2]',
  noAnswer: false,
  reason: null,
  traceId: '83fcad07-64b0-4d94-9fd4-42cb82038db9',
  sources: [],
  model: {
    provider: 'google',
    model: 'gemini-3.5-flash-lite',
    fallbackUsed: false,
  },
  rerankDegraded: false,
};

describe('AssistantAnswer', () => {
  it('renders inline source citations as small secondary markers', () => {
    const wrapper = mount(AssistantAnswer, { props: { response } });
    const citations = wrapper.findAll('.answer-citation');

    expect(citations.map((citation) => citation.element.tagName)).toEqual([
      'SMALL',
      'SMALL',
      'SMALL',
    ]);
    expect(citations.map((citation) => citation.text())).toEqual(['[来源1]', '[来源2]', '[来源2]']);
    expect(wrapper.get('.answer-text').text()).toContain('Vue 3 使用 Proxy。');
    expect(wrapper.get('.answer-text').text()).toContain('并支持 Composition API。');
  });
});
