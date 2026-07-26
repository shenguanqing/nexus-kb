import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref, watch } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentsView from './DocumentsView.vue';

const api = vi.hoisted(() => ({
  fetchDocumentUploadOptions: vi.fn(),
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
}));

vi.mock('@/api/documents', () => api);
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ hasCapability: () => true }),
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn() }),
}));

const ElButtonStub = defineComponent({
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>',
});

const ElDialogStub = defineComponent({
  props: { modelValue: Boolean },
  template:
    '<div data-test="upload-dialog" :data-open="String(modelValue)"><slot /><slot name="footer" /></div>',
});

const ElUploadStub = defineComponent({
  props: {
    fileList: { type: Array, default: () => [] },
    onChange: { type: Function, default: undefined },
  },
  emits: ['update:fileList'],
  setup(props, { emit }) {
    const files = ref([...props.fileList]);
    let selection = 0;
    watch(
      () => props.fileList,
      (value) => {
        files.value = [...value];
      },
      { deep: true },
    );
    function selectFile(): void {
      selection += 1;
      const raw = new File(['safe'], `selected-${selection}.md`, {
        type: 'text/markdown',
        lastModified: selection,
      });
      const entry = { name: raw.name, raw, status: 'ready', uid: selection };
      files.value = [...files.value, entry];
      emit('update:fileList', files.value);
      props.onChange?.(entry, files.value);
    }
    return { selectFile };
  },
  template: '<button data-test="select-file" @click="selectFile"><slot /></button>',
});

function mountView() {
  return mount(DocumentsView, {
    global: {
      stubs: {
        ElButton: ElButtonStub,
        ElDialog: ElDialogStub,
        ElUpload: ElUploadStub,
        ElInput: true,
        ElSelect: true,
        ElOption: true,
        ElTable: true,
        ElTableColumn: true,
        ElTag: true,
        ElPagination: true,
        ElDescriptions: true,
        ElDescriptionsItem: true,
      },
      directives: { loading: () => undefined },
    },
  });
}

describe('DocumentsView upload dialog', () => {
  beforeEach(() => {
    api.fetchDocumentUploadOptions.mockResolvedValue({
      maxUploadBytes: 1024,
      acceptedExtensions: ['md'],
      department: 'platform',
      defaultSensitivity: 'internal',
      dwgConversionEnabled: false,
    });
    api.listDocuments.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    api.uploadDocument.mockResolvedValue({ documentId: 'document-id', jobId: 'job-id' });
  });

  it('does not reuse files from the previous dialog opening', async () => {
    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('button').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="select-file"]').trigger('click');
    expect(wrapper.text()).toContain('selected-1.md');

    const cancel = wrapper.findAll('button').find((button) => button.text() === '取消');
    await cancel?.trigger('click');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="select-file"]').trigger('click');

    expect(wrapper.text()).not.toContain('selected-1.md');
    expect(wrapper.text()).toContain('selected-2.md');
  });

  it('closes the dialog after every selected file enters the queue', async () => {
    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('button').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="select-file"]').trigger('click');
    const submit = wrapper.findAll('button').find((button) => button.text() === '开始上传');
    await submit?.trigger('click');
    await flushPromises();

    expect(api.uploadDocument).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-test="upload-dialog"]').attributes('data-open')).toBe('false');
  });

  it('keeps multiple selected files in a dedicated scroll region', async () => {
    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('button').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="select-file"]').trigger('click');
    await wrapper.get('[data-test="select-file"]').trigger('click');
    await wrapper.get('[data-test="select-file"]').trigger('click');

    const fileList = wrapper.get('.upload-file-list');
    expect(fileList.attributes('aria-label')).toBe('待上传文件');
    expect(fileList.attributes('tabindex')).toBe('0');
    expect(fileList.findAll('li')).toHaveLength(3);
  });
});
