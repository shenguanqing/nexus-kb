import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, expect, it } from 'vitest';

import DocumentCardList from './DocumentCardList.vue';

const ElButtonStub = defineComponent({
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>',
});

describe('DocumentCardList', () => {
  it('shows a non-navigable cleanup action for deleting tombstones', async () => {
    const document = {
      id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      sourceName: 'stuck.dwg',
      mimeType: 'image/vnd.dwg',
      department: 'platform',
      sensitivity: 'internal' as const,
      ownerId: 'admin-001',
      activeVersion: null,
      status: 'deleting' as const,
      latestJob: null,
      createdAt: '2026-08-24T08:00:00.000Z',
      updatedAt: '2026-08-24T09:00:00.000Z',
    };
    const wrapper = mount(DocumentCardList, {
      props: {
        data: [document],
        loading: false,
        canDelete: true,
        cleanupDocumentId: null,
        statusLabel: () => '删除待清理',
        statusType: () => 'warning',
      },
      global: {
        stubs: {
          ElButton: ElButtonStub,
          ElEmpty: true,
          ElLink: true,
          ElTag: { template: '<span><slot /></span>' },
          RouterLink: true,
        },
      },
    });

    expect(wrapper.text()).toContain('stuck.dwg');
    expect(wrapper.text()).toContain('删除待清理');
    expect(wrapper.find('a').exists()).toBe(false);

    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('resume-delete')?.[0]).toEqual([document]);
  });
});
