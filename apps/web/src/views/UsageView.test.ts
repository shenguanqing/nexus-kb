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

describe('UsageView provider facts', () => {
  beforeEach(() => {
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
  });
});
