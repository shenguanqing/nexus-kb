import type { ConversationSummary } from '@nexus-kb/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryView from './HistoryView.vue';

const api = vi.hoisted(() => ({
  deleteConversation: vi.fn(),
  fetchConversation: vi.fn(),
  listConversations: vi.fn(),
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
const breakpoint = vi.hoisted(() => ({ isMobile: { __v_isRef: true, value: false } }));

vi.mock('@/api/history', () => api);
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => breakpoint,
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ fullPath: '/history', query: {} }),
  useRouter: () => router,
}));

const ElButtonStub = defineComponent({
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>',
});

function conversation(index: number): ConversationSummary {
  return {
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    title: `会话 ${index}`,
    messageCount: 1,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
}

describe('HistoryView infinite loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    breakpoint.isMobile.value = false;
    api.listConversations.mockImplementation(({ offset = 0 }: { offset?: number }) => {
      const conversations =
        offset === 0
          ? Array.from({ length: 20 }, (_, index) => conversation(index + 1))
          : [conversation(21)];
      return Promise.resolve({ conversations, total: 21, offset, limit: 20 });
    });
  });

  it('appends the next offset batch when the list scrolls near the bottom', async () => {
    const wrapper = mount(HistoryView, {
      global: {
        stubs: {
          ElButton: ElButtonStub,
          ElDatePicker: true,
          ElDrawer: true,
          ElEmpty: true,
          ElInput: true,
          HistoryAnswer: true,
          SourceDrawer: true,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    expect(api.listConversations).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 20 }),
    );
    expect(wrapper.findAll('.history-list-row')).toHaveLength(20);
    expect(wrapper.find('.el-pagination').exists()).toBe(false);
    expect(wrapper.find('el-date-picker-stub').exists()).toBe(false);

    const scroll = wrapper.get('.history-list-scroll');
    Object.defineProperties(scroll.element, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 650 },
    });
    await scroll.trigger('scroll');
    await flushPromises();

    expect(api.listConversations).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 20, limit: 20 }),
    );
    expect(wrapper.findAll('.history-list-row')).toHaveLength(21);
    expect(wrapper.text()).toContain('已加载全部');
  });

  it('ignores an old append response after a new filtered load starts', async () => {
    let zeroOffsetRequests = 0;
    let resolveAppend: ((value: unknown) => void) | undefined;
    api.listConversations.mockImplementation(({ offset = 0 }: { offset?: number }) => {
      if (offset === 20) {
        return new Promise((resolve) => {
          resolveAppend = resolve;
        });
      }
      zeroOffsetRequests += 1;
      const conversations =
        zeroOffsetRequests === 1
          ? Array.from({ length: 20 }, (_, index) => conversation(index + 1))
          : [conversation(99)];
      return Promise.resolve({
        conversations,
        total: zeroOffsetRequests === 1 ? 40 : 1,
        offset: 0,
        limit: 20,
      });
    });
    const wrapper = mount(HistoryView, {
      global: {
        stubs: {
          ElButton: ElButtonStub,
          ElDatePicker: true,
          ElDrawer: true,
          ElEmpty: true,
          ElInput: true,
          HistoryAnswer: true,
          SourceDrawer: true,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    const scroll = wrapper.get('.history-list-scroll');
    Object.defineProperties(scroll.element, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 650 },
    });
    await scroll.trigger('scroll');
    await scroll.trigger('scroll');
    expect(api.listConversations).toHaveBeenCalledTimes(2);

    await wrapper.get('.history-toolbar').trigger('submit');
    await flushPromises();
    expect(wrapper.findAll('.history-list-row')).toHaveLength(1);
    expect(wrapper.text()).toContain('会话 99');

    resolveAppend?.({ conversations: [conversation(21)], total: 40, offset: 20, limit: 20 });
    await flushPromises();
    expect(wrapper.findAll('.history-list-row')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('会话 21');
  });

  it('clears the PC/Pad detail selection whenever a new search starts', async () => {
    api.fetchConversation.mockResolvedValue({
      ...conversation(1),
      turns: [
        {
          id: '21111111-1111-4111-8111-000000000001',
          question: '旧会话问题',
          answer: '旧会话答案',
          noAnswer: false,
          reason: null,
          answerMode: 'general',
          traceId: '31111111-1111-4111-8111-000000000001',
          sources: [],
          sourceCount: 0,
          createdAt: '2026-08-19T00:00:00.000Z',
        },
      ],
    });
    const wrapper = mount(HistoryView, {
      global: {
        stubs: {
          ElButton: ElButtonStub,
          ElEmpty: true,
          ElInput: true,
          HistoryAnswer: true,
          SourceDrawer: true,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    await wrapper.get('.history-list-item').trigger('click');
    await flushPromises();
    expect(wrapper.find('.history-detail-body').exists()).toBe(true);

    await wrapper.get('.history-toolbar').trigger('submit');
    await flushPromises();
    expect(wrapper.find('.history-detail-body').exists()).toBe(false);
    expect(wrapper.get('.history-detail-empty').attributes('description')).toBe(
      '选择一个会话查看内容',
    );
  });

  it('keeps only search and reset in the Mobile toolbar without a filter button or drawer', async () => {
    breakpoint.isMobile.value = true;
    const wrapper = mount(HistoryView, {
      global: {
        stubs: {
          ElButton: ElButtonStub,
          ElEmpty: true,
          ElInput: true,
          HistoryAnswer: true,
          SourceDrawer: true,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    const toolbar = wrapper.get('.history-toolbar--mobile');
    expect(toolbar.text()).toContain('重置');
    expect(toolbar.text()).not.toContain('筛选');
    expect(toolbar.find('.filter-trigger').exists()).toBe(false);
    expect(wrapper.find('el-date-picker-stub').exists()).toBe(false);
    expect(wrapper.find('el-drawer-stub').exists()).toBe(false);
  });
});
