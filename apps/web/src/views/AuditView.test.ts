import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AuditView from './AuditView.vue';

const api = vi.hoisted(() => ({ listAuditEvents: vi.fn() }));
const screen = vi.hoisted(() => ({ isMobile: false }));

vi.mock('@/api/audit', () => api);
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: { __v_isRef: true, value: screen.isMobile } }),
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn() }),
}));

const PaginationStub = defineComponent({
  props: { pageCount: Number, total: Number },
  template: '<div data-test="pagination" :data-page-count="pageCount" :data-total="total" />',
});

const ButtonStub = defineComponent({
  template: '<button><slot /></button>',
});

describe('AuditView pagination', () => {
  beforeEach(() => {
    screen.isMobile = false;
    api.listAuditEvents.mockResolvedValue({
      events: [
        {
          id: 'audit-event-id',
          type: 'query',
          event: 'knowledge_query',
          outcome: 'answered',
          traceId: null,
          actorUserId: 'user-id',
          documentId: null,
          ingestionJobId: null,
          attributes: {},
          createdAt: '2026-08-17T00:00:00.000Z',
        },
      ],
      nextBefore: '2026-08-16T00:00:00.000Z',
      total: 73,
    });
  });

  it('uses the tenant-scoped total instead of deriving the record count from cursor pages', async () => {
    const wrapper = mount(AuditView, {
      global: {
        stubs: {
          ElButton: true,
          ElSelect: true,
          ElOption: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: true,
          ElEmpty: true,
          ElPagination: PaginationStub,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    expect(wrapper.get('[data-test="pagination"]').attributes()).toMatchObject({
      'data-page-count': '2',
      'data-total': '73',
    });
    const paginationParent = wrapper.get('.kb-pagination').element.parentElement?.classList;
    expect(paginationParent).toContain('kb-block-content');
    expect(paginationParent).not.toContain('kb-block');
  });

  it('keeps the type select and reset action in the Mobile toolbar without a filter drawer', async () => {
    screen.isMobile = true;
    const wrapper = mount(AuditView, {
      global: {
        stubs: {
          ElButton: ButtonStub,
          ElSelect: true,
          ElOption: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: true,
          ElEmpty: true,
          ElPagination: PaginationStub,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    const toolbar = wrapper.get('.audit-toolbar');
    const mobileFilter = toolbar.get('.audit-filter-form--mobile');
    expect(mobileFilter.find('el-select-stub').exists()).toBe(true);
    expect(mobileFilter.text()).toContain('重置');
    expect(wrapper.find('el-drawer-stub').exists()).toBe(false);
    expect(wrapper.find('.filter-trigger').exists()).toBe(false);
  });
});
