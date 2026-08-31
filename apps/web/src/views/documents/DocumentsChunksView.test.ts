import type { DocumentChunkListResponse } from '@nexus-kb/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { ElTabPane, ElTabs } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DocumentsChunksView from './DocumentsChunksView.vue';

const api = vi.hoisted(() => ({ fetchDocument: vi.fn(), listDocumentChunks: vi.fn() }));
const breakpoint = vi.hoisted(() => ({ isMobile: { __v_isRef: true, value: false } }));

vi.mock('@/api/documents', () => api);
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => breakpoint,
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'document-id' }, query: {} }),
  useRouter: () => ({ replace: vi.fn() }),
}));

function mountView() {
  return mount(DocumentsChunksView, {
    global: {
      components: { ElTabPane, ElTabs },
      stubs: {
        ElButton: true,
        ElEmpty: true,
        ElOption: true,
        ElPagination: true,
        ElSelect: true,
        ElTag: true,
      },
      directives: { loading: () => undefined },
    },
  });
}

describe('DocumentsChunksView responsive content comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    breakpoint.isMobile.value = false;
    api.fetchDocument.mockResolvedValue({
      id: 'document-id',
      sourceName: '规范.md',
      versions: [
        {
          version: 1,
          chunkCount: 1,
          vectorCollection: 'collection-id',
        },
      ],
    });
    api.listDocumentChunks.mockResolvedValue({
      documentId: 'document-id',
      sourceName: '规范.md',
      documentVersion: 1,
      items: [
        {
          id: 'chunk-id',
          documentVersion: 1,
          ordinal: 0,
          originalText: '原始正文',
          redactedText: '脱敏正文',
          tokenCount: 10,
          page: 1,
          sheet: null,
          sectionPath: ['第一章'],
          elementTypes: ['paragraph'],
          previousChunkId: null,
          nextChunkId: 'next-chunk-id',
          redactionPolicyVersion: 'v1',
          redactionSummary: {},
          createdAt: '2026-08-19T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  });

  it('uses shared borderless data fields and keeps both text columns outside Mobile', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('.documents-chunk-data-list').classes()).toEqual(
      expect.arrayContaining(['kb-data-fields', 'kb-data-fields--borderless']),
    );
    expect(wrapper.get('.documents-chunks-toolbar .kb-block__title').attributes()).toMatchObject({
      role: 'heading',
      'aria-level': '2',
    });
    expect(wrapper.findAll('.documents-chunk-data-list > .kb-data-field')).toHaveLength(4);
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('原始正文');
    expect(wrapper.text()).toContain('脱敏正文');
  });

  it('mounts only the selected text and switches it through accessible Mobile tabs', async () => {
    breakpoint.isMobile.value = true;
    const wrapper = mountView();
    await flushPromises();

    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.attributes('aria-selected')).toBe('true');
    expect(wrapper.text()).toContain('原始正文');
    expect(wrapper.text()).not.toContain('脱敏正文');

    await tabs[1]?.trigger('click');

    expect(tabs[1]?.attributes('aria-selected')).toBe('true');
    expect(wrapper.text()).toContain('脱敏正文');
    expect(wrapper.text()).not.toContain('原始正文');
    expect(wrapper.findAll('.documents-chunk-text-content')).toHaveLength(1);
  });

  it('keeps pagination inside the shared content shell without a redundant business class', async () => {
    const response = (await api.listDocumentChunks()) as DocumentChunkListResponse;
    api.listDocumentChunks.mockResolvedValue({ ...response, total: 21 });

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find('.documents-chunks-content').exists()).toBe(false);
    expect(
      wrapper.get('.documents-chunks-page > .kb-block-content > .kb-block-scroll'),
    ).toBeTruthy();
    const paginationParent = wrapper.get('.kb-pagination').element.parentElement?.classList;
    expect(paginationParent).toContain('kb-block-content');
    expect(paginationParent).not.toContain('kb-block');
  });
});
