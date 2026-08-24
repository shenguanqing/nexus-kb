import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AskComposer from './AskComposer.vue';

const composerStubs = {
  ElButton: {
    props: ['disabled'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  ElInput: {
    props: ['disabled'],
    emits: ['keydown'],
    template: '<textarea :disabled="disabled" @keydown="$emit(\'keydown\', $event)"></textarea>',
  },
};

describe('AskComposer', () => {
  it('submits with Enter or the send button but keeps Shift+Enter for a newline', async () => {
    const wrapper = mount(AskComposer, {
      props: { modelValue: '付款周期？', isSubmitting: false },
      global: { stubs: composerStubs },
    });
    const textarea = wrapper.get('textarea');
    await textarea.trigger('keydown', { key: 'Enter' });
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('submit')).toHaveLength(2);
  });

  it('does not submit empty or one-character questions', async () => {
    const wrapper = mount(AskComposer, {
      props: { modelValue: '问', isSubmitting: false },
      global: { stubs: composerStubs },
    });
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('shows the counter near the limit and disables all controls while submitting', async () => {
    const wrapper = mount(AskComposer, {
      props: { modelValue: '问'.repeat(1801), isSubmitting: false },
      global: { stubs: composerStubs },
    });

    expect(wrapper.get('.character-count').text()).toContain('1801');
    expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined();

    await wrapper.setProps({ isSubmitting: true });

    expect(wrapper.get('.ask-composer').classes()).toContain('is-disabled');
    expect(wrapper.get('.ask-composer').attributes('aria-busy')).toBe('true');
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });
});
