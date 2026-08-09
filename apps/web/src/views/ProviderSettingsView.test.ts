import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProviderSettingsView from './ProviderSettingsView.vue';

const api = vi.hoisted(() => ({
  createSystemConfiguration: vi.fn(),
  deploySystemConfiguration: vi.fn(),
  getProviderStatuses: vi.fn(),
  getSystemConfiguration: vi.fn(),
  getSystemDeployment: vi.fn(),
  getSystemDeployments: vi.fn(),
  rollbackSystemDeployment: vi.fn(),
}));
const breakpoints = vi.hoisted(() => ({
  isDesktop: { __v_isRef: true, value: true },
  isMobile: { __v_isRef: true, value: false },
}));

vi.mock('@/api/system', () => api);
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({
    isDesktop: breakpoints.isDesktop,
    isMobile: breakpoints.isMobile,
  }),
}));

const AnchorStub = defineComponent({
  props: { direction: String, offset: Number },
  template:
    '<nav data-test="configuration-anchor" :data-direction="direction" :data-offset="String(offset)"><slot /></nav>',
});

const AnchorLinkStub = defineComponent({
  props: { href: String, title: String },
  template: '<a :href="href">{{ title }}</a>',
});

const TableStub = defineComponent({
  props: { height: [String, Number] },
  template: '<div data-test="deployment-table" :data-height="String(height)"><slot /></div>',
});

const FormStub = defineComponent({
  template: '<form><slot /></form>',
});

function mountView(options: { desktop?: boolean; mobile?: boolean } = {}) {
  breakpoints.isDesktop.value = options.desktop ?? true;
  breakpoints.isMobile.value = options.mobile ?? false;
  return mount(ProviderSettingsView, {
    global: {
      stubs: {
        ElAlert: true,
        ElAnchor: AnchorStub,
        ElAnchorLink: AnchorLinkStub,
        ElButton: true,
        ElEmpty: true,
        ElForm: FormStub,
        ElFormItem: true,
        ElInput: true,
        ElInputNumber: true,
        ElOption: true,
        ElSelect: true,
        ElSwitch: true,
        ElTable: TableStub,
        ElTableColumn: true,
        ElTag: true,
      },
      directives: { loading: () => undefined },
    },
  });
}

describe('ProviderSettingsView configuration layout', () => {
  beforeEach(() => {
    api.getProviderStatuses.mockResolvedValue({
      providers: [],
      syntheticCheck: { status: 'not_configured', checkedAt: null },
    });
    api.getSystemConfiguration.mockResolvedValue({
      deploymentAgentAvailable: true,
      embeddingManagedSeparately: true,
      effectiveValues: {
        DWG_CONVERSION_ENABLED: 'true',
        TIKA_ENABLED: 'true',
        CAD_TILED_PREVIEW_ENABLED: 'true',
      },
      secretConfigured: {},
      current: null,
      versions: [],
    });
    api.getSystemDeployments.mockResolvedValue({
      deployments: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          configVersion: 1,
          previousVersion: null,
          status: 'succeeded',
          services: ['api'],
          changeReason: '初始化配置',
          errorCode: null,
          rollbackAvailable: false,
          createdAt: '2026-08-09T00:00:00.000Z',
          completedAt: '2026-08-09T00:01:00.000Z',
        },
      ],
    });
  });

  it('separates Parser, CAD/DWG and Tika behind anchor navigation', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('[data-test="configuration-anchor"]').attributes('data-direction')).toBe(
      'vertical',
    );
    expect(wrapper.get('[data-test="configuration-anchor"]').attributes('data-offset')).toBe('112');
    expect(wrapper.get('a[href="#configuration-parser"]').text()).toBe('Parser');
    expect(wrapper.get('a[href="#configuration-cad"]').text()).toBe('CAD / DWG');
    expect(wrapper.get('a[href="#configuration-tika"]').text()).toBe('Tika');
    expect(wrapper.get('#configuration-parser').text()).toContain('Parser');
    expect(wrapper.get('#configuration-cad').text()).toContain('CAD / DWG');
    expect(wrapper.get('#configuration-tika').text()).toContain('Tika');
  });

  it('gives the deployment table a fixed scroll height', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('[data-test="deployment-table"]').attributes('data-height')).toBe('360');
  });

  it('uses compact horizontal labels outside the desktop breakpoint', async () => {
    const wrapper = mountView({ desktop: false, mobile: true });
    await flushPromises();

    expect(wrapper.get('[data-test="configuration-anchor"]').attributes('data-direction')).toBe(
      'horizontal',
    );
    expect(wrapper.get('[data-test="configuration-anchor"]').attributes('data-offset')).toBe('64');
    expect(wrapper.get('a[href="#configuration-rerank"]').text()).toBe('Rerank');
    expect(wrapper.get('a[href="#configuration-ingestion"]').text()).toBe('入库');
    expect(wrapper.get('a[href="#configuration-cad"]').text()).toBe('CAD');
  });
});
