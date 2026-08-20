import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UsageView from './UsageView.vue';

const api = vi.hoisted(() => ({ fetchUsage: vi.fn() }));
const screen = vi.hoisted(() => ({ isMobile: false }));

vi.mock('@/api/usage', () => api);
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: { __v_isRef: true, value: screen.isMobile } }),
}));

const TableStub = defineComponent({
  template: '<div><slot /></div>',
});

const TableColumnStub = defineComponent({
  props: { label: String },
  template: '<span>{{ label }}</span>',
});

const DatePickerStub = defineComponent({
  props: {
    popperClass: String,
    teleported: { type: Boolean, default: true },
  },
  template:
    '<div data-test="date-picker" :data-popper-class="popperClass" :data-teleported="teleported" />',
});

const ButtonStub = defineComponent({
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>',
});

describe('UsageView provider facts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    screen.isMobile = false;
    api.fetchUsage.mockResolvedValue({
      from: '2026-07-12T00:00:00.000Z',
      to: '2026-08-11T00:00:00.000Z',
      totalQueries: 1,
      failureRate: 0,
      queryP95Ms: 120,
      providers: [
        {
          kind: 'embedding',
          provider: 'google',
          model: 'gemini-embedding-001',
          requests: 1,
          failures: 0,
          inputTokens: null,
          outputTokens: null,
          estimatedCostUsd: null,
        },
        {
          kind: 'llm',
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          requests: 1,
          failures: 0,
          inputTokens: null,
          outputTokens: null,
          estimatedCostUsd: null,
        },
      ],
      departments: [],
      usageCompleteness: 'request_only',
    });
  });

  it('labels query-audit aggregation as related questions rather than provider requests', async () => {
    const wrapper = mount(UsageView, {
      global: {
        stubs: {
          ElButton: true,
          ElDatePicker: true,
          ElTable: TableStub,
          ElTableColumn: TableColumnStub,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('一次问答可同时计入 Query Embedding 和 LLM');
    expect(wrapper.text()).toContain('它不是供应商账单请求数');
    expect(wrapper.text()).toContain('涉及问答');
  });

  it('uses one placeholder for every unavailable usage value', async () => {
    screen.isMobile = true;
    const wrapper = mount(UsageView, {
      global: {
        stubs: {
          ElButton: true,
          ElDrawer: true,
          ElTag: true,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('暂无数据');
    expect(wrapper.text()).not.toContain('—');
    expect(wrapper.findAll('.kb-data-field')).toHaveLength(8);
    expect(wrapper.find('.mobile-data-list').exists()).toBe(false);
  });

  it('teleports Mobile Drawer date panels into the shared high-level popper layer', async () => {
    screen.isMobile = true;
    const wrapper = mount(UsageView, {
      global: {
        stubs: {
          ElButton: true,
          ElDatePicker: DatePickerStub,
          ElDrawer: defineComponent({ template: '<div><slot /></div>' }),
          ElTag: true,
          ElTable: TableStub,
          ElTableColumn: TableColumnStub,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    const datePickers = wrapper.findAll('[data-test="date-picker"]');
    expect(datePickers).toHaveLength(2);
    for (const datePicker of datePickers) {
      expect(datePicker.attributes('data-popper-class')).toBe('usage-date-picker-popper');
      expect(datePicker.attributes('data-teleported')).toBe('true');
    }
  });

  it('reloads the default range immediately when the Mobile Drawer is reset', async () => {
    screen.isMobile = true;
    const wrapper = mount(UsageView, {
      global: {
        stubs: {
          ElButton: ButtonStub,
          ElDatePicker: DatePickerStub,
          ElDrawer: defineComponent({ template: '<div><slot /></div>' }),
          ElTag: true,
          ElTable: TableStub,
          ElTableColumn: TableColumnStub,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    const reset = wrapper.findAll('button').find((button) => button.text().trim() === '重置');
    await reset?.trigger('click');
    await flushPromises();

    expect(api.fetchUsage).toHaveBeenCalledTimes(2);
  });
});
