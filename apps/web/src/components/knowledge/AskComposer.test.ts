import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AskComposer from './AskComposer.vue';

describe('AskComposer', () => {
  it('submits with Enter but keeps Shift+Enter for a newline', async () => {
    const wrapper = mount(AskComposer, {
      props: { modelValue: '付款周期？', isSubmitting: false },
      global: {
        stubs: { ElButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' } },
      },
    });
    const textarea = wrapper.get('textarea');
    await textarea.trigger('keydown', { key: 'Enter' });
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(wrapper.emitted('submit')).toHaveLength(1);
  });

  it('does not submit empty or one-character questions', async () => {
    const wrapper = mount(AskComposer, {
      props: { modelValue: '问', isSubmitting: false },
      global: { stubs: { ElButton: true } },
    });
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('submit')).toBeUndefined();
  });
});
