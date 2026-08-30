import { flushPromises, mount } from '@vue/test-utils';
import type { IngestionJob } from '@nexus-kb/contracts';
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

function ingestionJob(overrides: Partial<IngestionJob> = {}): IngestionJob {
  return {
    id: '0be06fbb-f1aa-4688-9852-b587feb0212b',
    documentId: 'f5497cc7-5ee4-4e60-9ad8-46b031b3cab6',
    sourceName: 'drawing.dwg',
    mimeType: 'image/vnd.dwg',
    version: 1,
    kind: 'ingestion',
    status: 'failed',
    step: 'failed',
    checkpoint: 'parsing',
    attempts: 1,
    retryable: false,
    errorCode: 'PARSER_UNAVAILABLE',
    errorCategory: 'parser',
    warnings: ['DXF_REPEATED_BLOCK_DEFINITIONS_REUSED', 'CAD_PREVIEW_PROGRESSIVE_GEOMETRY'],
    parserVersion: 'oda-26.4+ezdxf-1.4.4',
    embeddingFingerprint: null,
    embeddingCompletedChunks: 0,
    embeddingTotalChunks: null,
    embeddingBatchSize: null,
    createdAt: '2026-08-30T03:00:00.000Z',
    startedAt: '2026-08-30T03:00:01.000Z',
    completedAt: '2026-08-30T03:00:05.000Z',
    updatedAt: '2026-08-30T03:00:05.000Z',
    traceId: '50d3104f-93da-4173-b42a-2f6bf87917c7',
    ...overrides,
  };
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

    expect(wrapper.get('.task-document-filter [role="alert"]').text()).toContain('完整的文档 ID');
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
    expect(wrapper.find('.task-document-filter [role="alert"]').exists()).toBe(false);
    expect(api.listIngestionJobs).toHaveBeenCalledTimes(2);
  });

  it('uses the same feedback layout for localized warnings and task errors', async () => {
    api.listIngestionJobs.mockResolvedValueOnce({
      items: [ingestionJob()],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const wrapper = mountView();
    await flushPromises();

    const warning = wrapper.get('.task-warning');
    const error = wrapper.get('.task-error');
    expect(warning.classes()).toContain('task-feedback');
    expect(error.classes()).toContain('task-feedback');
    expect(warning.get('.kb-block__header').text()).toBe('处理说明');
    expect(error.get('.kb-block__header').text()).toBe('失败说明');
    expect(warning.get('.kb-data-fields').classes()).toContain('kb-data-fields--borderless');
    expect(error.get('.kb-data-fields').classes()).toContain('kb-data-fields--borderless');
    expect(warning.findAll('.kb-data-field')).toHaveLength(2);
    expect(error.findAll('.kb-data-field')).toHaveLength(3);
    expect(warning.text()).toContain('重复块优化');
    expect(warning.text()).toContain('渐进式 CAD 预览');
    expect(warning.text()).not.toContain('DXF_REPEATED_BLOCK_DEFINITIONS_REUSED');
    expect(error.text()).toContain('失败原因');
    expect(error.text()).toContain('技术详情');
    expect(error.text()).toContain('Trace ID');
  });
});
