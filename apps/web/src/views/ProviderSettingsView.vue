<template>
  <section class="kb-page">
    <div class="kb-status-toolbar">
      <div>
        <div class="kb-heading kb-heading--h2" role="heading" aria-level="1">模型与运行配置</div>
        <div class="provider-toolbar__description kb-text kb-text--secondary">
          密钥只写入、不回显；发布由内部白名单代理执行并验证 readiness。
        </div>
      </div>
      <el-button :loading="loading" @click="load">刷新状态</el-button>
    </div>

    <div
      ref="pageContent"
      v-loading="publishing"
      class="kb-page__content"
      :element-loading-text="publishingText"
      element-loading-background="var(--kb-color-overlay)"
    >
      <div v-if="errorMessage && !result" class="kb-error-state" role="alert">
        <strong class="kb-text kb-text--danger">无法加载 Provider 配置</strong>
        <span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>

      <template v-else>
        <div v-loading="loading" class="provider-card-list kb-block-list" aria-live="polite">
          <article
            v-for="provider in result?.providers ?? []"
            :key="provider.kind"
            class="kb-block"
          >
            <div class="kb-block__header">
              <div class="kb-block__title kb-heading kb-heading--h4">
                {{ providerKindLabels[provider.kind] }}
              </div>
              <el-tag :type="provider.configurationStatus === 'configured' ? 'success' : 'info'">
                {{ provider.configurationStatus === 'configured' ? '已配置' : '未启用' }}
              </el-tag>
            </div>
            <div class="kb-block__title kb-heading kb-heading--h4">
              {{ providerTitle(provider) }}
            </div>
            <div class="kb-data-fields">
              <div class="kb-data-field">
                <span class="kb-data-field__label">服务域名</span>
                <span class="kb-data-field__value">{{ provider.endpointHost ?? '—' }}</span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">区域</span>
                <span class="kb-data-field__value">{{ provider.region ?? '—' }}</span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">凭据状态</span>
                <span class="kb-data-field__value">
                  {{ credentialLabel(provider.provider, provider.credentialConfigured) }}
                </span>
              </div>
              <div v-if="provider.dimensions" class="kb-data-field">
                <span class="kb-data-field__label">向量维度</span>
                <span class="kb-data-field__value">{{ provider.dimensions }}</span>
              </div>
              <div v-if="provider.fingerprint" class="kb-data-field">
                <span class="kb-data-field__label">索引配置指纹</span>
                <span class="kb-data-field__value">{{ provider.fingerprint }}</span>
              </div>
            </div>
          </article>
        </div>

        <el-alert
          class="provider-embedding-migration-alert"
          title="Embedding 配置由索引迁移流程单独管理"
          description="更换 Embedding Provider、模型或维度会创建新的向量空间，本页不会直接覆盖或仅重启 API。"
          type="warning"
          :closable="false"
          show-icon
        />

        <div v-if="configuration" class="kb-block">
          <ProviderSettingsViewGuide v-model="showConfigurationGuide" :is-mobile="isMobile" />
          <ProviderSettingsViewForm
            :page-content="pageContent"
            :is-desktop="isDesktop"
            :effective-values="configuration.effectiveValues"
            :secret-configured="configuration.secretConfigured"
            :deployment-agent-available="configuration.deploymentAgentAvailable"
            :deployment-active="Boolean(activeDeployment)"
            :saving="saving"
            :reset-token="configurationResetToken"
            @save="saveAndDeploy"
          >
            <template #heading>
              <div class="kb-heading-group">
                <div class="kb-block__header">
                  <div class="provider-settings-title-row kb-heading kb-heading--h4">
                    <div>编辑运行配置</div>
                    <el-icon
                      class="provider-settings-guide-trigger"
                      role="button"
                      tabindex="0"
                      aria-label="查看运行配置字段说明"
                      title="查看运行配置字段说明"
                      @click="showConfigurationGuide = true"
                      @keydown.enter="showConfigurationGuide = true"
                      @keydown.space.prevent="showConfigurationGuide = true"
                    >
                      <InfoFilled />
                    </el-icon>
                  </div>
                  <el-tag :type="configuration.deploymentAgentAvailable ? 'success' : 'danger'">
                    {{ configuration.deploymentAgentAvailable ? '部署代理就绪' : '部署代理未启用' }}
                  </el-tag>
                </div>
                <span class="kb-text kb-text--secondary">
                  保存后会创建不可变版本，并仅重建受影响的白名单服务。
                </span>
              </div>
            </template>
          </ProviderSettingsViewForm>
        </div>

        <div class="kb-block">
          <div class="kb-heading-group">
            <div class="kb-heading kb-heading--h4">发布记录</div>
            <span class="kb-text kb-text--secondary">
              显示变更原因、受影响服务、readiness 结果与回滚入口。
            </span>
          </div>
          <el-table
            v-if="!isMobile"
            class="provider-deployment-table"
            :data="deployments"
            height="360"
            empty-text="暂无发布记录"
          >
            <el-table-column prop="configVersion" label="版本" width="90">
              <template #default="scope">v{{ scope.row.configVersion }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="scope">
                <el-tag :type="deploymentTag(deploymentRow(scope.row).status)">
                  {{ deploymentStatus(deploymentRow(scope.row).status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="服务" min-width="200">
              <template #default="scope">
                {{ scope.row.services.join('、') }}
              </template>
            </el-table-column>
            <el-table-column
              prop="changeReason"
              label="变更原因"
              min-width="250"
              show-overflow-tooltip
            />
            <el-table-column prop="errorCode" label="结果码" min-width="250">
              <template #default="scope">{{ scope.row.errorCode ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="110">
              <template #default="scope">
                <el-button
                  v-if="deploymentRow(scope.row).rollbackAvailable && !activeDeployment"
                  link
                  type="warning"
                  @click="rollback(deploymentRow(scope.row))"
                >
                  回滚
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-else class="provider-deployment-card-list kb-block-list">
            <article
              v-for="deployment in deployments"
              :key="deployment.id"
              class="provider-deployment-card kb-block"
            >
              <div class="kb-block__header">
                <strong>v{{ deployment.configVersion }}</strong>
                <el-tag :type="deploymentTag(deployment.status)">
                  {{ deploymentStatus(deployment.status) }}
                </el-tag>
              </div>
              <div class="kb-data-fields">
                <div class="kb-data-field">
                  <span class="kb-data-field__label">服务</span>
                  <span class="kb-data-field__value">{{ deployment.services.join('、') }}</span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">原因</span>
                  <span class="kb-data-field__value">{{ deployment.changeReason }}</span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">结果码</span>
                  <span class="kb-data-field__value">{{ deployment.errorCode ?? '—' }}</span>
                </div>
              </div>
              <el-button
                v-if="deployment.rollbackAvailable && !activeDeployment"
                text
                type="warning"
                @click="rollback(deployment)"
              >
                回滚
              </el-button>
            </article>
            <el-empty v-if="deployments.length === 0" description="暂无发布记录" />
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import type {
  ManagedConfigurationField,
  ManagedConfigurationSecret,
  ProviderStatusResponse,
  SystemConfigurationResponse,
  SystemDeployment,
} from '@nexus-kb/contracts';
import { InfoFilled } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, onUnmounted, ref } from 'vue';

import { ApiError } from '@/api/client';
import ProviderSettingsViewForm from './provider-settings/ProviderSettingsViewForm.vue';
import ProviderSettingsViewGuide from './provider-settings/ProviderSettingsViewGuide.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import {
  createSystemConfiguration,
  deploySystemConfiguration,
  getProviderStatuses,
  getSystemConfiguration,
  getSystemDeployment,
  getSystemDeployments,
  rollbackSystemDeployment,
} from '@/api/system';
import { credentialLabel, providerKindLabels, providerTitle } from './system-presentation';

const result = ref<ProviderStatusResponse | null>(null);
const { isDesktop, isMobile } = useBreakpoint();
const configuration = ref<SystemConfigurationResponse | null>(null);
const deployments = ref<SystemDeployment[]>([]);
const pageContent = ref<HTMLElement | null>(null);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const showConfigurationGuide = ref(false);
const configurationResetToken = ref(0);
let pollingTimer: number | null = null;

const terminalStatuses = new Set(['succeeded', 'rolled_back', 'failed']);
const activeDeployment = computed(() =>
  deployments.value.find((deployment) => !terminalStatuses.has(deployment.status)),
);
const publishing = computed(() => saving.value || Boolean(activeDeployment.value));
const publishingText = computed(() =>
  saving.value ? '正在创建并发布运行配置…' : '正在等待服务重建和 readiness 检查…',
);

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [providers, configurationResult, deploymentResult] = await Promise.all([
      getProviderStatuses(),
      getSystemConfiguration(),
      getSystemDeployments(),
    ]);
    result.value = providers;
    configuration.value = configurationResult;
    deployments.value = deploymentResult.deployments;
    startPollingIfNeeded();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : 'Provider 配置加载失败';
  } finally {
    loading.value = false;
  }
}

async function saveAndDeploy(input: {
  values: Partial<Record<ManagedConfigurationField, string | number | boolean>>;
  secrets: Partial<Record<ManagedConfigurationSecret, string>>;
  changeReason: string;
}): Promise<void> {
  if (!configuration.value || saving.value) return;
  saving.value = true;
  try {
    const version = await createSystemConfiguration({
      values: input.values,
      secrets: input.secrets,
      changeReason: input.changeReason,
    });
    const accepted = await deploySystemConfiguration(version.id);
    deployments.value = [accepted.deployment, ...deployments.value];
    configurationResetToken.value += 1;
    ElMessage.success(`配置版本 v${version.version} 已进入发布队列`);
    startPollingIfNeeded();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '配置发布失败');
  } finally {
    saving.value = false;
  }
}

async function rollback(deployment: SystemDeployment): Promise<void> {
  await ElMessageBox.confirm(
    `确认将运行配置从 v${deployment.configVersion} 回滚到 v${deployment.previousVersion}？`,
    '回滚配置',
    {
      type: 'warning',
      confirmButtonText: '确认回滚',
      cancelButtonText: '取消',
    },
  );
  try {
    const accepted = await rollbackSystemDeployment(deployment.id);
    deployments.value = [accepted.deployment, ...deployments.value];
    ElMessage.success('回滚任务已进入队列');
    startPollingIfNeeded();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '回滚失败');
  }
}

function startPollingIfNeeded(): void {
  if (pollingTimer !== null || !activeDeployment.value) return;
  pollingTimer = window.setInterval(() => void pollDeployment(), 2000);
}

async function pollDeployment(): Promise<void> {
  const current = activeDeployment.value;
  if (!current) {
    stopPolling();
    return;
  }
  try {
    const updated = await getSystemDeployment(current.id);
    deployments.value = deployments.value.map((item) => (item.id === updated.id ? updated : item));
    if (terminalStatuses.has(updated.status)) {
      stopPolling();
      await load();
      if (updated.status === 'succeeded') ElMessage.success('配置已生效，readiness 检查通过');
      else if (updated.status === 'rolled_back') ElMessage.warning('readiness 未通过，已自动回滚');
      else ElMessage.error('发布和自动回滚均未成功，请联系运维');
    }
  } catch {
    // API 容器重建期间短暂不可用，保留轮询等待其恢复。
  }
}

function stopPolling(): void {
  if (pollingTimer !== null) window.clearInterval(pollingTimer);
  pollingTimer = null;
}

function deploymentStatus(status: SystemDeployment['status']): string {
  return {
    queued: '排队中',
    running: '发布中',
    succeeded: '已生效',
    rolled_back: '已自动回滚',
    failed: '失败',
  }[status];
}

function deploymentTag(
  status: SystemDeployment['status'],
): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'succeeded') return 'success';
  if (status === 'rolled_back') return 'warning';
  if (status === 'failed') return 'danger';
  return 'info';
}

function deploymentRow(value: unknown): SystemDeployment {
  return value as SystemDeployment;
}

onMounted(load);
onUnmounted(stopPolling);
</script>

<style scoped>
.provider-settings-title-row {
  display: flex;
  align-items: center;
  gap: var(--kb-space-1);
}
.provider-settings-guide-trigger {
  flex: 0 0 auto;
  color: var(--kb-color-text-secondary);
  font-size: 14px;
  opacity: var(--kb-opacity-visible);
  transition: opacity var(--kb-transition-fast);
  cursor: pointer;
}
.provider-settings-guide-trigger:hover,
.provider-settings-guide-trigger:focus {
  opacity: var(--kb-opacity-muted);
}
.provider-deployment-card-list {
  overflow-y: auto;
  max-height: 360px;
}
.provider-deployment-table {
  width: 100%;
}
.provider-deployment-card {
  display: grid;
}
.provider-embedding-migration-alert {
  flex: 0 0 auto;
  min-height: 52px;
  border-radius: var(--kb-radius-md);
}
.provider-card-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
/* 响应式：紧凑布局（<1280px） */
@media (max-width: 1279px) {
  .provider-toolbar__description {
    display: none;
  }
}

/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .provider-card-list {
    grid-template-columns: 1fr;
  }
}
</style>
