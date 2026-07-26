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
  sources: [1, 4].map((index) => ({
    index,
    documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
    documentVersion: 1,
    chunkIds: [String(index).repeat(64)],
    sourceName: `vue-${index}.md`,
    page: null,
    sheet: null,
    sectionPath: [],
  })),
  model: {
    provider: 'google',
    model: 'gemini-3.5-flash-lite',
    fallbackUsed: false,
  },
  rerankDegraded: false,
};

describe('AssistantAnswer', () => {
  it('renders compact inline citations and matching source details', async () => {
    const wrapper = mount(AssistantAnswer, { props: { response } });

    expect(wrapper.findAll('.answer-citation').map((citation) => citation.text())).toEqual([
      '[来源1]',
      '[来源2]',
      '[来源2]',
    ]);
    expect(wrapper.get('.answer-text').text()).toBe(
      'Vue 3 使用 Proxy。[来源1][来源2]\n并支持 Composition API。[来源2]',
    );
    expect(wrapper.get('.answer-sources-label').text()).toBe('回答来源');
    expect(wrapper.findAll('.source-card').map((source) => source.text())).toEqual([
      expect.stringContaining('来源 1'),
      expect.stringContaining('来源 2'),
    ]);
    await wrapper.findAll('.source-card')[1]!.trigger('click');
    expect(wrapper.emitted('selectSource')?.[0]?.[0]).toMatchObject({ index: 2 });
  });
});
