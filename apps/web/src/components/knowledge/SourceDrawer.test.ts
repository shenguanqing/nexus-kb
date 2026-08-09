import type { KnowledgeSource } from '@nexus-kb/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SourceDrawer from './SourceDrawer.vue';

const source: KnowledgeSource = {
  index: 1,
  documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
  documentVersion: 1,
  chunkIds: ['a'.repeat(64)],
  sourceName: 'vue.md',
  page: null,
  sheet: null,
  sectionPath: [],
};

function mountDrawer(overrides: Partial<KnowledgeSource> = {}) {
  return mount(SourceDrawer, {
    props: { modelValue: true, source: { ...source, ...overrides } },
    global: {
      stubs: {
        ElButton: { template: '<button><slot /></button>' },
        ElDrawer: {
          template: '<section><slot /><footer><slot name="footer" /></footer></section>',
        },
        RouterLink: {
          props: ['to'],
          template:
            '<a :data-path="to.path" :data-from="to.query.from" :data-version="to.query.version"><slot /></a>',
        },
      },
    },
  });
}

describe('SourceDrawer', () => {
  it('omits unavailable location and section metadata', () => {
    const wrapper = mountDrawer();

    expect(wrapper.get('.source-detail__header').text()).toContain('vue.md');
    expect(wrapper.find('.source-reference').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('未标注');
    expect(wrapper.get('.source-drawer__document-link').attributes('data-path')).toBe(
      `/documents/${source.documentId}/preview`,
    );
    expect(wrapper.get('.source-drawer__document-link').attributes('data-from')).toBe('/ask');
    expect(wrapper.get('.source-drawer__document-link').attributes('data-version')).toBe('1');
    expect(wrapper.text()).toContain('预览文档');
  });

  it('shows only the returned location and section metadata', () => {
    const wrapper = mountDrawer({ page: 7, sectionPath: ['第一章', '概览'] });

    expect(wrapper.get('.source-reference').text()).toContain('第 7 页');
    expect(wrapper.get('.source-reference').text()).toContain('第一章 / 概览');
  });
});
