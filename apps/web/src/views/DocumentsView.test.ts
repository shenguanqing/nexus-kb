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
        ElProgress: true,
        ElPagination: true,
        ElDescriptions: true,
        ElDescriptionsItem: true,
        ElEmpty: true,
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

    await wrapper.get('.documents-upload-action').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="select-file"]').trigger('click');
    expect(wrapper.text()).toContain('selected-1.md');

    const cancel = wrapper.findAll('button').find((button) => button.text() === '取消');
    await cancel?.trigger('click');
    await wrapper.get('.documents-upload-action').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="select-file"]').trigger('click');

    expect(wrapper.text()).not.toContain('selected-1.md');
    expect(wrapper.text()).toContain('selected-2.md');
  });

  it('keeps pagination inside the shared content shell', async () => {
    api.listDocuments.mockResolvedValueOnce({ items: [], total: 59, page: 1, pageSize: 20 });
    const wrapper = mountView();
    await flushPromises();

    const paginationParent = wrapper.get('.kb-pagination').element.parentElement?.classList;
    expect(paginationParent).toContain('kb-block-content');
    expect(paginationParent).not.toContain('kb-block');
  });

  it('closes the dialog after every selected file enters the queue', async () => {
    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('.documents-upload-action').trigger('click');
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

    await wrapper.get('.documents-upload-action').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="select-file"]').trigger('click');
    await wrapper.get('[data-test="select-file"]').trigger('click');
    await wrapper.get('[data-test="select-file"]').trigger('click');

    const fileList = wrapper.get('.upload-file-list');
    expect(fileList.attributes('aria-label')).toBe('待上传文件');
    expect(fileList.attributes('tabindex')).toBe('0');
    expect(fileList.findAll('.upload-file-item')).toHaveLength(3);
  });

  it('renders queued, uploading, and failed files as distinct queue cards', async () => {
    let rejectSecondUpload: ((reason?: unknown) => void) | undefined;
    api.uploadDocument.mockImplementation(
      (file: File, onProgress: (percentage: number) => void) => {
        if (file.name === 'selected-1.md') {
          return Promise.resolve({ documentId: 'document-1', jobId: 'job-1' });
        }
        onProgress(55);
        return new Promise((_resolve, reject) => {
          rejectSecondUpload = reject;
        });
      },
    );
    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('.documents-upload-action').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="select-file"]').trigger('click');
    await wrapper.get('[data-test="select-file"]').trigger('click');
    const submit = wrapper.findAll('button').find((button) => button.text() === '开始上传');
    await submit?.trigger('click');
    await flushPromises();

    expect(wrapper.get('.is-queued').text()).toContain('selected-1.md');
    expect(wrapper.get('.is-uploading').text()).toContain('上传中 55%');

    rejectSecondUpload?.(new Error('fixture failure'));
    await flushPromises();
    expect(wrapper.get('.is-failed').text()).toContain('上传失败');
    expect(wrapper.get('.is-failed').text()).toContain('重试');
    const remove = wrapper
      .get('.is-failed')
      .findAll('button')
      .find((button) => button.text() === '删除');
    expect(remove?.attributes('aria-label')).toBe('删除失败文件：selected-2.md');

    await remove?.trigger('click');

    expect(wrapper.find('.is-failed').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('selected-2.md');
  });

  it('does not render the document table or empty state when loading fails', async () => {
    api.listDocuments.mockRejectedValueOnce(new Error('fixture failure'));

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('无法加载文档');
    expect(wrapper.find('.kb-block-scroll').exists()).toBe(false);
  });

  it('uses ElEmpty instead of an empty desktop table when no documents match', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find('el-table-stub').exists()).toBe(false);
    expect(wrapper.get('el-empty-stub').attributes('description')).toBe('暂无符合条件的文档');
  });

});
