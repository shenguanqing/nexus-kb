import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import IngestionJobsView from './IngestionJobsView.vue';

const api = vi.hoisted(() => ({
  listIngestionJobs: vi.fn(),
  retryIngestionJob: vi.fn(),
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('@/api/ingestion', () => api);
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ hasCapability: () => false }),
}));
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: { __v_isRef: true, value: true } }),
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ fullPath: '/ingestion-jobs', query: {} }),
  useRouter: () => router,
}));

const InputStub = defineComponent({
  props: { modelValue: String, placeholder: String },
  emits: ['input', 'update:modelValue'],
  setup(_props, { emit }) {
    function update(event: Event): void {
      const value = (event.target as HTMLInputElement).value;
      emit('update:modelValue', value);
      emit('input', value);
    }
    return { update };
  },
  template: '<input :value="modelValue" :placeholder="placeholder" @input="update" />',
});

const SelectStub = defineComponent({
  props: { modelValue: String },
  emits: ['update:modelValue'],
  template:
    '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="">全部状态</option><option value="failed">失败</option></select>',
});

const ButtonStub = defineComponent({
  props: { nativeType: String },
  emits: ['click'],
  template: '<button :type="nativeType || \'button\'" @click="$emit(\'click\')"><slot /></button>',
});

function mountView() {
  return mount(IngestionJobsView, {
    global: {
      stubs: {
        ElButton: ButtonStub,
        ElDrawer: defineComponent({ template: '<div><slot /></div>' }),
        ElEmpty: true,
        ElIcon: true,
        ElInput: InputStub,
        ElOption: true,
        ElPagination: true,
        ElProgress: true,
        ElSelect: SelectStub,
        ElStep: true,
        ElSteps: true,
        ElTag: true,
      },
      directives: { loading: () => undefined },
    },
  });
}

describe('IngestionJobsView Mobile filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listIngestionJobs.mockResolvedValue({ items: [], total: 59, page: 1, pageSize: 20 });
  });

  it('validates document UUIDs locally, hides stale pagination, and resets every filter', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(api.listIngestionJobs).toHaveBeenCalledOnce();
    expect(wrapper.find('.kb-pagination').exists()).toBe(true);
    const paginationParent = wrapper.get('.kb-pagination').element.parentElement?.classList;
    expect(paginationParent).toContain('kb-block-content');
    expect(paginationParent).not.toContain('kb-block');

    const documentId = wrapper.get('input[placeholder="文档 ID"]');
    await documentId.setValue('213123');
    await wrapper.get('.task-toolbar--mobile').trigger('submit');
    await flushPromises();

    expect(wrapper.get('.task-filter-error').text()).toContain('完整的文档 ID');
    expect(wrapper.find('.kb-error-state').exists()).toBe(false);
    expect(wrapper.find('.kb-pagination').exists()).toBe(false);
    expect(api.listIngestionJobs).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();

    await wrapper.get('select').setValue('failed');
    const reset = wrapper.findAll('button').find((button) => button.text().trim() === '重置');
    await reset?.trigger('click');
    await flushPromises();

    expect((documentId.element as HTMLInputElement).value).toBe('');
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('');
    expect(wrapper.find('.task-filter-error').exists()).toBe(false);
    expect(api.listIngestionJobs).toHaveBeenCalledTimes(2);
  });
});
