import type { KnowledgeQueryResponse } from '@nexus-kb/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AssistantAnswer from './AssistantAnswer.vue';

const response: KnowledgeQueryResponse = {
  conversationId: '5b9fd225-a565-42cd-8d63-1fc3f19b745d',
  answer: '## Vue 3\n\n**Proxy** 驱动响应式。[来源1][来源2]\n\n- 支持 Composition API。[来源2]',
  noAnswer: false,
  reason: null,
  answerMode: 'grounded',
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

    expect(wrapper.findAll('.kb-answer-citation').map((citation) => citation.text())).toEqual([
      '[来源1]',
      '[来源2]',
      '[来源2]',
    ]);
    expect(wrapper.get('.markdown-content .markdown-heading--h2').text()).toBe('Vue 3');
    expect(wrapper.get('.markdown-content strong').text()).toBe('Proxy');
    expect(wrapper.get('.markdown-content .markdown-list-item').text()).toBe(
      '支持 Composition API。[来源2]',
    );
    expect(wrapper.get('.kb-answer-sources__label').text()).toBe('回答来源');
    expect(wrapper.findAll('.kb-answer-sources__card').map((source) => source.text())).toEqual([
      expect.stringContaining('来源 1'),
      expect.stringContaining('来源 2'),
    ]);
    expect(wrapper.get('.kb-answer-sources__card').text()).toContain('v1');
    expect(wrapper.get('.kb-answer-sources__card').text()).not.toContain('位置未标注');
    await wrapper.findAll('.kb-answer-citation--interactive')[1]!.trigger('click');
    expect(wrapper.emitted('selectSource')?.[0]?.[0]).toMatchObject({ index: 2 });
    await wrapper.findAll('.kb-answer-sources__card')[1]!.trigger('click');
    expect(wrapper.emitted('selectSource')?.[1]?.[0]).toMatchObject({ index: 2 });
  });

  it('labels a source-free general-knowledge answer', () => {
    const wrapper = mount(AssistantAnswer, {
      props: {
        response: {
          ...response,
          answer: 'Vue 3 使用 Proxy 实现响应式。',
          answerMode: 'general',
          sources: [],
        },
      },
    });

    expect(wrapper.get('.kb-answer-notice').text()).toContain('不是知识库资料');
    expect(wrapper.get('.markdown-content').text()).toContain('Vue 3 使用 Proxy');
    expect(wrapper.find('.kb-answer-sources').exists()).toBe(false);
  });
});
