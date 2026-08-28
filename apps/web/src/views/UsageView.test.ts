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
  emits: ['change'],
  props: {
    editable: Boolean,
    endPlaceholder: String,
    format: String,
    popperClass: String,
    popperOptions: Object,
    singlePanel: Boolean,
    startPlaceholder: String,
    teleported: { type: Boolean, default: true },
    type: String,
  },
  template:
    '<div data-test="date-picker" :data-editable="editable" :data-end-placeholder="endPlaceholder" :data-format="format" :data-has-popper-options="Boolean(popperOptions)" :data-popper-class="popperClass" :data-single-panel="singlePanel" :data-start-placeholder="startPlaceholder" :data-teleported="teleported" :data-type="type" @click="$emit(\'change\')" />',
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
      queryP50Ms: 100,
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
          ElDatePicker: true,
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

  it('uses one read-only single-panel date range on every viewport and applies it directly on Mobile', async () => {
    screen.isMobile = true;
    const wrapper = mount(UsageView, {
      global: {
        stubs: {
          ElButton: true,
          ElDatePicker: DatePickerStub,
          ElTag: true,
          ElTable: TableStub,
          ElTableColumn: TableColumnStub,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    const datePickers = wrapper.findAll('[data-test="date-picker"]');
    expect(datePickers).toHaveLength(1);
    const datePicker = datePickers[0]!;
    expect(datePicker.attributes('data-type')).toBe('daterange');
    expect(datePicker.attributes('data-single-panel')).toBe('true');
    expect(datePicker.attributes('data-editable')).toBe('false');
    expect(datePicker.attributes('data-format')).toBe('YYYY-MM-DD');
    expect(datePicker.attributes('data-start-placeholder')).toBe('开始日期');
    expect(datePicker.attributes('data-end-placeholder')).toBe('结束日期');
    expect(datePicker.attributes('data-popper-class')).toBe('usage-date-picker-popper');
    expect(datePicker.attributes('data-has-popper-options')).toBe('true');
    expect(datePicker.attributes('data-teleported')).toBe('true');

    await datePicker.trigger('click');
    await flushPromises();
    expect(api.fetchUsage).toHaveBeenCalledTimes(2);
  });

  it('queries complete local calendar days', async () => {
    mount(UsageView, {
      global: {
        stubs: {
          ElButton: true,
          ElDatePicker: DatePickerStub,
          ElTable: TableStub,
          ElTableColumn: TableColumnStub,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    const [from, to] = api.fetchUsage.mock.calls[0] as [string, string];
    const fromDate = new Date(from);
    const toDate = new Date(to);
    expect([
      fromDate.getHours(),
      fromDate.getMinutes(),
      fromDate.getSeconds(),
      fromDate.getMilliseconds(),
    ]).toEqual([0, 0, 0, 0]);
    expect([
      toDate.getHours(),
      toDate.getMinutes(),
      toDate.getSeconds(),
      toDate.getMilliseconds(),
    ]).toEqual([23, 59, 59, 999]);
  });

  it('reloads the default range immediately when the Mobile range is reset', async () => {
    screen.isMobile = true;
    const wrapper = mount(UsageView, {
      global: {
        stubs: {
          ElButton: ButtonStub,
          ElDatePicker: DatePickerStub,
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
