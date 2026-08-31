import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, expect, it } from 'vitest';

import DocumentsDangerConfirm from './DocumentsDangerConfirm.vue';

const ElDialogStub = defineComponent({
  props: { modelValue: Boolean, title: String },
  template:
    '<section :data-open="String(modelValue)"><header>{{ title }}</header><slot /><slot name="footer" /></section>',
});
const ElButtonStub = defineComponent({
  props: { disabled: Boolean, loading: Boolean },
  emits: ['click'],
  template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
});
const ElInputStub = defineComponent({
  props: { modelValue: String },
  emits: ['update:modelValue'],
  template:
    '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

function mountConfirmation(action: 'cleanup' | 'delete' | 'reindex', prepared = false) {
  return mount(DocumentsDangerConfirm, {
    props: {
      modelValue: true,
      documentName: '施工图.dwg',
      action,
      prepared,
    },
    global: {
      stubs: {
        ElDialog: ElDialogStub,
        ElDrawer: ElDialogStub,
        ElButton: ElButtonStub,
        ElInput: ElInputStub,
      },
    },
  });
}

describe('DocumentsDangerConfirm', () => {
  it('uses the same filename confirmation UI for cleanup', async () => {
    const wrapper = mountConfirmation('cleanup');

    expect(wrapper.text()).toContain('继续清理删除');
    expect(wrapper.text()).toContain('残留的原文件、预览、向量和缓存');
    expect(wrapper.text()).toContain('施工图.dwg');
    expect(wrapper.get('button:last-child').attributes('disabled')).toBeDefined();

    await wrapper.get('input').setValue('施工图.dwg');
    await wrapper.get('button:last-child').trigger('click');

    expect(wrapper.emitted('confirm')).toHaveLength(1);
  });

  it('keeps deletion and indexing confirmations visually and semantically aligned', () => {
    const deletion = mountConfirmation('delete');
    const preparedIndexing = mountConfirmation('reindex', true);

    expect(deletion.text()).toContain('确认高风险操作');
    expect(deletion.find('.documents-danger-confirm__notice.kb-text--danger').exists()).toBe(true);
    expect(deletion.text()).toContain('永久删除');
    expect(preparedIndexing.text()).toContain('确认高风险操作');
    expect(preparedIndexing.text()).toContain('不会再次上传或解析原文件');
    expect(preparedIndexing.text()).toContain('继续建立索引');
    expect(preparedIndexing.find('.documents-danger-confirm__filename').text()).toBe('施工图.dwg');
  });
});
