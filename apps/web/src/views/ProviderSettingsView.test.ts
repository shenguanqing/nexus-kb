import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, inject, nextTick, provide } from 'vue';
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

const TableStub = defineComponent({
  props: { height: [String, Number] },
  template: '<div data-test="deployment-table" :data-height="String(height)"><slot /></div>',
});

const FormStub = defineComponent({
  template: '<form><slot /></form>',
});

const DialogStub = defineComponent({
  props: { modelValue: Boolean, title: String },
  template:
    '<div v-if="modelValue" data-test="configuration-guide"><span class="el-dialog__title" role="heading" aria-level="2">{{ title }}</span><slot /></div>',
});

const DrawerStub = defineComponent({
  props: { modelValue: Boolean, title: String },
  template:
    '<div v-if="modelValue" data-test="configuration-guide-drawer"><span class="el-drawer__title">{{ title }}</span><slot /></div>',
});

const tabsStubKey = Symbol('tabs-stub');
const TabsStub = defineComponent({
  props: { modelValue: [String, Number] },
  emits: ['tabChange', 'update:modelValue'],
  setup(props, { emit }) {
    const current = computed(() => props.modelValue);
    const select = (name: string | number): void => {
      emit('update:modelValue', name);
      emit('tabChange', name);
    };
    provide(tabsStubKey, { current, select });
  },
  template: '<div data-test="configuration-guide-tabs" role="tablist"><slot /></div>',
});

const TabPaneStub = defineComponent({
  props: { label: String, name: [String, Number] },
  setup(props) {
    const tabs = inject<{
      current: Readonly<{ value: string | number | undefined }>;
      select: (name: string | number) => void;
    }>(tabsStubKey);
    const selected = computed(() => tabs?.current.value === props.name);
    const select = (): void => {
      if (props.name !== undefined) tabs?.select(props.name);
    };
    return { select, selected };
  },
  template:
    '<button type="button" role="tab" :data-name="String(name)" :aria-selected="String(selected)" @click="select">{{ label }}</button><section v-if="selected"><slot /></section>',
});

const InputStub = defineComponent({
  props: { modelValue: String, placeholder: String },
  emits: ['update:modelValue'],
  template:
    '<input :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

function mountView(options: { desktop?: boolean; mobile?: boolean } = {}) {
  breakpoints.isDesktop.value = options.desktop ?? true;
  breakpoints.isMobile.value = options.mobile ?? false;
  return mount(ProviderSettingsView, {
    global: {
      stubs: {
        ElAlert: true,
        ElButton: true,
        ElDialog: DialogStub,
        ElDrawer: DrawerStub,
        ElEmpty: true,
        ElForm: FormStub,
        ElFormItem: true,
        ElIcon: { template: '<span><slot /></span>' },
        ElInput: InputStub,
        ElInputNumber: true,
        ElOption: true,
        ElSelect: true,
        ElSwitch: true,
        ElTable: TableStub,
        ElTableColumn: true,
        ElTag: true,
        ElTabs: TabsStub,
        ElTabPane: TabPaneStub,
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

  it('switches Parser, CAD/DWG and Tika as real tab panels', async () => {
    const wrapper = mountView();
    await flushPromises();

    const navigation = wrapper.get('.configuration-navigation');
    expect(navigation.find('.kb-heading-group').exists()).toBe(true);
    expect(navigation.get('[role="tab"][data-name="parser"]').text()).toBe('Parser');
    expect(navigation.get('[role="tab"][data-name="cad"]').text()).toBe('CAD / DWG');
    expect(navigation.get('[role="tab"][data-name="tika"]').text()).toBe('Tika');
    expect(wrapper.get('#configuration-llm').text()).toContain('LLM');
    const sectionHeading = wrapper.get('#configuration-llm [role="heading"]');
    expect(sectionHeading.attributes('aria-level')).toBe('2');
    expect(sectionHeading.classes()).toContain('kb-heading');
    expect(sectionHeading.classes()).toContain('kb-heading--h5');
    expect(wrapper.find('#configuration-parser').exists()).toBe(false);

    await navigation.get('[role="tab"][data-name="parser"]').trigger('click');
    await nextTick();
    expect(wrapper.get('#configuration-parser').text()).toContain('Parser');
    expect(wrapper.find('#configuration-llm').exists()).toBe(false);

    await navigation.get('[role="tab"][data-name="cad"]').trigger('click');
    await nextTick();
    expect(wrapper.get('#configuration-cad').text()).toContain('CAD / DWG');

    await navigation.get('[role="tab"][data-name="tika"]').trigger('click');
    await nextTick();
    expect(wrapper.get('#configuration-tika').text()).toContain('Tika');
  });

  it('gives the deployment table a fixed scroll height', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('[data-test="deployment-table"]').attributes('data-height')).toBe('360');
  });

  it('uses the shared card and field classes for provider facts', async () => {
    api.getProviderStatuses.mockResolvedValue({
      providers: [
        {
          kind: 'llm',
          provider: 'deepseek',
          model: 'deepseek-chat',
          configurationStatus: 'configured',
          endpointHost: 'api.deepseek.com',
          region: 'cn',
          dimensions: null,
          credentialConfigured: true,
          fingerprint: null,
        },
      ],
      syntheticCheck: { status: 'not_configured', checkedAt: null },
    });
    const wrapper = mountView();
    await flushPromises();

    const providerCard = wrapper.get('.provider-card-list > .kb-block');
    expect(providerCard.text()).toContain('deepseek / deepseek-chat');
    expect(providerCard.findAll('.kb-data-field')).toHaveLength(3);
    expect(wrapper.find('.provider-card-heading').exists()).toBe(false);
    expect(wrapper.find('.provider-data-item').exists()).toBe(false);
  });

  it('uses compact tab labels outside the desktop breakpoint', async () => {
    const wrapper = mountView({ desktop: false, mobile: true });
    await flushPromises();

    expect(wrapper.get('[role="tab"][data-name="rerank"]').text()).toBe('Rerank');
    expect(wrapper.get('[role="tab"][data-name="ingestion"]').text()).toBe('入库');
    expect(wrapper.get('[role="tab"][data-name="cad"]').text()).toBe('CAD');
  });

  it('repositions the real configuration block when switching tabs', async () => {
    const wrapper = mountView();
    await flushPromises();

    const pageContent = wrapper.get('.kb-page__content').element as HTMLElement;
    const configurationBlock = wrapper
      .get('.configuration-navigation')
      .element.closest<HTMLElement>('.kb-block');
    if (!configurationBlock) throw new Error('configuration block not found');
    Object.defineProperty(pageContent, 'scrollTop', { configurable: true, value: 200 });
    vi.spyOn(pageContent, 'getBoundingClientRect').mockReturnValue({
      bottom: 800,
      height: 700,
      left: 0,
      right: 1000,
      top: 100,
      width: 1000,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(configurationBlock, 'getBoundingClientRect').mockReturnValue({
      bottom: 960,
      height: 700,
      left: 0,
      right: 1000,
      top: 260,
      width: 1000,
      x: 0,
      y: 260,
      toJSON: () => ({}),
    });
    const scrollTo = vi.fn();
    Object.defineProperty(pageContent, 'scrollTo', { configurable: true, value: scrollTo });

    await wrapper.get('[role="tab"][data-name="cad"]').trigger('click');

    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 360 });
    expect(wrapper.find('.configuration-form-scroll').exists()).toBe(false);
  });

  it('documents every editable configuration field, including installed OCR languages', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find('[data-test="configuration-guide"]').exists()).toBe(false);
    const guideTrigger = wrapper.get('[aria-label="查看运行配置字段说明"]');
    expect(guideTrigger.element.tagName).not.toBe('BUTTON');
    expect(guideTrigger.attributes()).toMatchObject({ role: 'button', tabindex: '0' });
    await guideTrigger.trigger('click');
    await nextTick();
    const guide = wrapper.get('[data-test="configuration-guide"]');
    expect(guide.classes()).toContain('configuration-guide-dialog');
    expect(guide.attributes('style')).toContain('height: 640px');
    expect(guide.get('.el-dialog__title').attributes()).toMatchObject({
      role: 'heading',
      'aria-level': '2',
    });
    expect(guide.get('.el-dialog__title').text()).toBe('运行配置字段说明');
    expect(guide.text()).toContain('LLM');
    expect(wrapper.find('[data-test="configuration-guide-tabs"]').exists()).toBe(true);

    await wrapper.get('input[placeholder="搜索字段名或说明，例如 OCR、超时、CAD"]').setValue('OCR');
    await nextTick();
    expect(guide.text()).toContain('OCR 语言');
    expect(guide.text()).toContain('当前镜像只安装 ch_sim,en');
    expect(guide.text()).toContain('OCR 低置信度阈值');
    expect(guide.text()).not.toContain('主 Provider');

    await wrapper
      .get('input[placeholder="搜索字段名或说明，例如 OCR、超时、CAD"]')
      .setValue('原因');
    await nextTick();
    expect(guide.text()).toContain('变更原因');
  });

  it('uses the bottom drawer for the guide on mobile', async () => {
    const wrapper = mountView({ desktop: false, mobile: true });
    await flushPromises();

    await wrapper.get('[aria-label="查看运行配置字段说明"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-test="configuration-guide-drawer"]').exists()).toBe(true);
  });
});
