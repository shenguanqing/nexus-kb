import type { KnowledgeSource } from '@nexus-kb/contracts';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SourceDrawer from './SourceDrawer.vue';

const phoneViewport = vi.hoisted(() => ({ __v_isRef: true, value: false }));

vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: phoneViewport }),
}));

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

function mountDrawer(overrides: Partial<KnowledgeSource> = {}, returnTo = '/ask') {
  return mount(SourceDrawer, {
    props: { modelValue: true, source: { ...source, ...overrides }, returnTo },
    global: {
      stubs: {
        ElButton: { template: '<button><slot /></button>' },
        ElDrawer: {
          props: ['direction', 'size', 'title', 'withHeader'],
          template:
            '<section class="drawer-stub" :data-direction="direction" :data-size="size" :data-title="title" :data-with-header="withHeader"><slot /><footer><slot name="footer" /></footer></section>',
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
  beforeEach(() => {
    phoneViewport.value = false;
  });

  it('omits unavailable location and section metadata', () => {
    const wrapper = mountDrawer();

    expect(wrapper.get('.source-detail__header').text()).toContain('vue.md');
    expect(wrapper.get('.source-detail__title').attributes()).toMatchObject({
      role: 'heading',
      'aria-level': '2',
    });
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
    expect(wrapper.get('.source-reference').classes()).toEqual(
      expect.arrayContaining(['kb-block', 'kb-block--flush']),
    );
  });

  it('preserves the selected history conversation in the preview return target', () => {
    const conversationId = '5b9fd225-a565-42cd-8d63-1fc3f19b745d';
    const wrapper = mountDrawer({}, `/history?page=2&conversationId=${conversationId}`);

    expect(wrapper.get('.source-drawer__document-link').attributes('data-from')).toBe(
      `/history?page=2&conversationId=${conversationId}`,
    );
  });

  it('uses the shared titled bottom-sheet surface on phones', () => {
    phoneViewport.value = true;
    const wrapper = mountDrawer();

    expect(wrapper.get('.drawer-stub').attributes()).toMatchObject({
      'data-direction': 'btt',
      'data-size': 'auto',
      'data-title': '来源详情',
      'data-with-header': '',
    });
    expect(wrapper.find('.source-sheet__handle').exists()).toBe(false);
    expect(wrapper.find('.source-sheet__header').exists()).toBe(false);
  });
});
