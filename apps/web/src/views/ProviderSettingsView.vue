<script setup lang="ts">
import type {
  ManagedConfigurationField,
  ManagedConfigurationSecret,
  ProviderStatusResponse,
  SystemConfigurationResponse,
  SystemDeployment,
} from '@nexus-kb/contracts';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';

import { ApiError } from '@/api/client';
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
const { isMobile } = useBreakpoint();
const configuration = ref<SystemConfigurationResponse | null>(null);
const deployments = ref<SystemDeployment[]>([]);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const changeReason = ref('');
const numericFields = [
  'LLM_TEMPERATURE',
  'LLM_MAX_OUTPUT_TOKENS',
  'LLM_REQUEST_TIMEOUT_MS',
  'RERANK_TOP_K',
  'RERANK_REQUEST_TIMEOUT_MS',
  'QUERY_RECALL_TOP_K',
  'QUERY_MAX_DISTANCE',
  'PARSER_REQUEST_TIMEOUT_MS',
  'MAX_PARSE_BYTES',
  'MAX_ELEMENTS',
  'MAX_SPREADSHEET_ROWS',
  'MAX_PDF_PAGES',
  'MAX_IMAGE_PIXELS',
  'OCR_CONFIDENCE_WARNING_THRESHOLD',
  'MAX_CAD_ENTITIES',
  'MAX_CAD_INSERT_DEPTH',
  'DWG_CONVERSION_TIMEOUT_SECONDS',
] as const;
type NumericField = (typeof numericFields)[number];
const numericFieldSet = new Set<ManagedConfigurationField>(numericFields);
const form = reactive<Partial<Record<ManagedConfigurationField, string>>>({});
const numericForm = reactive<Partial<Record<NumericField, number>>>({});
const secrets = reactive<Partial<Record<ManagedConfigurationSecret, string>>>({});
let pollingTimer: number | null = null;

const llmProviders = ['none', 'openai', 'google', 'deepseek', 'alibaba', 'custom'] as const;
const terminalStatuses = new Set(['succeeded', 'rolled_back', 'failed']);
const activeDeployment = computed(() =>
  deployments.value.find((deployment) => !terminalStatuses.has(deployment.status)),
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
    for (const [key, value] of Object.entries(configurationResult.effectiveValues)) {
      const field = key as ManagedConfigurationField;
      if (numericFieldSet.has(field)) numericForm[field as NumericField] = Number(value);
      else form[field] = String(value);
    }
    startPollingIfNeeded();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : 'Provider 配置加载失败';
  } finally {
    loading.value = false;
  }
}

async function saveAndDeploy(): Promise<void> {
  if (!configuration.value || saving.value) return;
  const values: Partial<Record<ManagedConfigurationField, string | number | boolean>> = {};
  for (const field of Object.keys(form) as ManagedConfigurationField[]) {
    const value = form[field];
    if (
      value !== undefined &&
      String(configuration.value.effectiveValues[field] ?? '') !== String(value)
    ) {
      values[field] = value;
    }
  }
  for (const field of numericFields) {
    const value = numericForm[field];
    if (
      value !== undefined &&
      String(configuration.value.effectiveValues[field] ?? '') !== String(value)
    ) {
      values[field] = value;
    }
  }
  const changedSecrets: Partial<Record<ManagedConfigurationSecret, string>> = {};
  for (const field of Object.keys(secrets) as ManagedConfigurationSecret[]) {
    const value = secrets[field];
    if (value) changedSecrets[field] = value;
  }
  if (Object.keys(values).length + Object.keys(changedSecrets).length === 0) {
    ElMessage.warning('没有检测到配置变更');
    return;
  }
  saving.value = true;
  try {
    const version = await createSystemConfiguration({
      values,
      secrets: changedSecrets,
      changeReason: changeReason.value,
    });
    const accepted = await deploySystemConfiguration(version.id);
    deployments.value = [accepted.deployment, ...deployments.value];
    for (const key of Object.keys(secrets) as ManagedConfigurationSecret[]) secrets[key] = '';
    changeReason.value = '';
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
    { type: 'warning', confirmButtonText: '确认回滚', cancelButtonText: '取消' },
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

function secretPlaceholder(field: ManagedConfigurationSecret): string {
  return configuration.value?.secretConfigured[field] ? '已配置；留空保持不变' : '尚未配置';
}

onMounted(load);
onUnmounted(stopPolling);
</script>

<template>
  <section class="system-page provider-settings-page">
    <div class="provider-toolbar">
      <div>
        <strong>模型与运行配置</strong>
        <div class="text-block">密钥只写入、不回显；发布由内部白名单代理执行并验证 readiness。</div>
      </div>
      <el-button :loading="loading" @click="load">刷新状态</el-button>
    </div>

    <div class="page-content">
      <div v-if="errorMessage && !result" class="document-error" role="alert">
        <strong>无法加载 Provider 配置</strong><span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>

      <template v-else>
        <div v-loading="loading" class="provider-grid" aria-live="polite">
          <article
            v-for="provider in result?.providers ?? []"
            :key="provider.kind"
            class="provider-card"
          >
            <div class="provider-card-heading">
              <span>{{ providerKindLabels[provider.kind] }}</span>
              <el-tag :type="provider.configurationStatus === 'configured' ? 'success' : 'info'">
                {{ provider.configurationStatus === 'configured' ? '已配置' : '未启用' }}
              </el-tag>
            </div>
            <div class="heading heading--h2" role="heading" aria-level="2">
              {{ providerTitle(provider) }}
            </div>
            <div class="data-list">
              <div>
                <span>服务域名</span><strong>{{ provider.endpointHost ?? '—' }}</strong>
              </div>
              <div>
                <span>区域</span><strong>{{ provider.region ?? '—' }}</strong>
              </div>
              <div>
                <span>凭据状态</span
                ><strong>{{
                  credentialLabel(provider.provider, provider.credentialConfigured)
                }}</strong>
              </div>
              <div v-if="provider.dimensions">
                <span>向量维度</span><strong>{{ provider.dimensions }}</strong>
              </div>
              <div v-if="provider.fingerprint" class="provider-fingerprint">
                <span>索引配置指纹</span
                ><strong
                  ><code>{{ provider.fingerprint }}</code></strong
                >
              </div>
            </div>
          </article>
        </div>

        <el-alert
          class="embedding-migration-alert"
          title="Embedding 配置由索引迁移流程单独管理"
          description="更换 Embedding Provider、模型或维度会创建新的向量空间，本页不会直接覆盖或仅重启 API。"
          type="warning"
          :closable="false"
          show-icon
        />

        <div v-if="configuration" class="configuration-panel">
          <div class="configuration-heading">
            <div>
              <strong>编辑运行配置</strong
              ><span>保存后会创建不可变版本，并仅重建受影响的白名单服务。</span>
            </div>
            <el-tag :type="configuration.deploymentAgentAvailable ? 'success' : 'danger'">
              {{ configuration.deploymentAgentAvailable ? '部署代理就绪' : '部署代理未启用' }}
            </el-tag>
          </div>

          <el-form label-position="top" class="configuration-form">
            <div class="configuration-section">
              <div class="heading heading--h3" role="heading" aria-level="3">LLM</div>
              <div class="configuration-fields">
                <el-form-item label="主 Provider"
                  ><el-select v-model="form.LLM_PROVIDER"
                    ><el-option
                      v-for="provider in llmProviders"
                      :key="provider"
                      :label="provider"
                      :value="provider" /></el-select
                ></el-form-item>
                <el-form-item label="主模型"
                  ><el-input v-model="form.LLM_MODEL" maxlength="128"
                /></el-form-item>
                <el-form-item label="备用 Provider"
                  ><el-select v-model="form.LLM_FALLBACK_PROVIDER"
                    ><el-option
                      v-for="provider in llmProviders"
                      :key="provider"
                      :label="provider"
                      :value="provider" /></el-select
                ></el-form-item>
                <el-form-item label="备用模型"
                  ><el-input v-model="form.LLM_FALLBACK_MODEL" maxlength="128"
                /></el-form-item>
                <el-form-item label="温度"
                  ><el-input-number
                    v-model="numericForm.LLM_TEMPERATURE"
                    :min="0"
                    :max="2"
                    :step="0.1"
                /></el-form-item>
                <el-form-item label="最大输出 Token"
                  ><el-input-number
                    v-model="numericForm.LLM_MAX_OUTPUT_TOKENS"
                    :min="1"
                    :max="65536"
                /></el-form-item>
                <el-form-item label="请求超时（ms）"
                  ><el-input-number
                    v-model="numericForm.LLM_REQUEST_TIMEOUT_MS"
                    :min="100"
                    :max="300000"
                /></el-form-item>
              </div>
              <div class="configuration-fields">
                <el-form-item label="OpenAI Base URL"
                  ><el-input v-model="form.OPENAI_BASE_URL" maxlength="2048"
                /></el-form-item>
                <el-form-item label="OpenAI 区域"
                  ><el-input v-model="form.OPENAI_REGION" maxlength="64"
                /></el-form-item>
                <el-form-item label="Gemini Base URL"
                  ><el-input v-model="form.GEMINI_BASE_URL" maxlength="2048"
                /></el-form-item>
                <el-form-item label="Gemini 区域"
                  ><el-input v-model="form.GEMINI_REGION" maxlength="64"
                /></el-form-item>
                <el-form-item label="DeepSeek Base URL"
                  ><el-input v-model="form.DEEPSEEK_BASE_URL" maxlength="2048"
                /></el-form-item>
                <el-form-item label="DeepSeek 区域"
                  ><el-input v-model="form.DEEPSEEK_REGION" maxlength="64"
                /></el-form-item>
                <el-form-item label="阿里云 Base URL"
                  ><el-input v-model="form.ALIBABA_BASE_URL" maxlength="2048"
                /></el-form-item>
                <el-form-item label="阿里云区域"
                  ><el-input v-model="form.ALIBABA_REGION" maxlength="64"
                /></el-form-item>
                <el-form-item label="自定义 Base URL"
                  ><el-input v-model="form.CUSTOM_BASE_URL" maxlength="2048"
                /></el-form-item>
                <el-form-item label="自定义区域"
                  ><el-input v-model="form.CUSTOM_REGION" maxlength="64"
                /></el-form-item>
              </div>
              <div class="configuration-fields">
                <el-form-item label="OpenAI Key"
                  ><el-input
                    v-model="secrets.OPENAI_API_KEY"
                    type="password"
                    show-password
                    autocomplete="new-password"
                    :placeholder="secretPlaceholder('OPENAI_API_KEY')"
                /></el-form-item>
                <el-form-item label="Gemini Key"
                  ><el-input
                    v-model="secrets.GEMINI_API_KEY"
                    type="password"
                    show-password
                    autocomplete="new-password"
                    :placeholder="secretPlaceholder('GEMINI_API_KEY')"
                /></el-form-item>
                <el-form-item label="DeepSeek Key"
                  ><el-input
                    v-model="secrets.DEEPSEEK_API_KEY"
                    type="password"
                    show-password
                    autocomplete="new-password"
                    :placeholder="secretPlaceholder('DEEPSEEK_API_KEY')"
                /></el-form-item>
                <el-form-item label="阿里云 Key"
                  ><el-input
                    v-model="secrets.DASHSCOPE_API_KEY"
                    type="password"
                    show-password
                    autocomplete="new-password"
                    :placeholder="secretPlaceholder('DASHSCOPE_API_KEY')"
                /></el-form-item>
                <el-form-item label="自定义 Provider Key"
                  ><el-input
                    v-model="secrets.CUSTOM_API_KEY"
                    type="password"
                    show-password
                    autocomplete="new-password"
                    :placeholder="secretPlaceholder('CUSTOM_API_KEY')"
                /></el-form-item>
              </div>
            </div>

            <div class="configuration-section">
              <div class="heading heading--h3" role="heading" aria-level="3">Rerank 与问答</div>
              <div class="configuration-fields">
                <el-form-item label="Rerank Provider"
                  ><el-select v-model="form.RERANK_PROVIDER"
                    ><el-option label="none" value="none" /><el-option
                      label="alibaba"
                      value="alibaba" /><el-option label="local_bge" value="local_bge" /></el-select
                ></el-form-item>
                <el-form-item label="Rerank 模型"
                  ><el-input v-model="form.RERANK_MODEL" maxlength="128"
                /></el-form-item>
                <el-form-item label="Rerank Base URL"
                  ><el-input v-model="form.RERANK_BASE_URL" maxlength="2048"
                /></el-form-item>
                <el-form-item label="Rerank 区域"
                  ><el-input v-model="form.RERANK_REGION" maxlength="64"
                /></el-form-item>
                <el-form-item label="保留候选数"
                  ><el-input-number v-model="numericForm.RERANK_TOP_K" :min="1" :max="100"
                /></el-form-item>
                <el-form-item label="Rerank 超时（ms）"
                  ><el-input-number
                    v-model="numericForm.RERANK_REQUEST_TIMEOUT_MS"
                    :min="100"
                    :max="300000"
                /></el-form-item>
                <el-form-item label="回答模式"
                  ><el-select v-model="form.QUERY_ANSWER_MODE"
                    ><el-option label="hybrid" value="hybrid" /><el-option
                      label="strict"
                      value="strict" /></el-select
                ></el-form-item>
                <el-form-item label="召回数量"
                  ><el-input-number v-model="numericForm.QUERY_RECALL_TOP_K" :min="1" :max="100"
                /></el-form-item>
                <el-form-item label="距离阈值"
                  ><el-input-number
                    v-model="numericForm.QUERY_MAX_DISTANCE"
                    :min="0"
                    :max="2"
                    :step="0.01"
                /></el-form-item>
              </div>
            </div>

            <div class="configuration-section">
              <div class="heading heading--h3" role="heading" aria-level="3">Parser 资源限制</div>
              <div class="configuration-fields">
                <el-form-item label="API 等待超时（ms）"
                  ><el-input-number
                    v-model="numericForm.PARSER_REQUEST_TIMEOUT_MS"
                    :min="100"
                    :max="900000"
                /></el-form-item>
                <el-form-item label="单文件最大字节"
                  ><el-input-number
                    v-model="numericForm.MAX_PARSE_BYTES"
                    :min="1"
                    :max="1073741824"
                /></el-form-item>
                <el-form-item label="最大元素数"
                  ><el-input-number v-model="numericForm.MAX_ELEMENTS" :min="1" :max="1000000"
                /></el-form-item>
                <el-form-item label="表格最大行数"
                  ><el-input-number
                    v-model="numericForm.MAX_SPREADSHEET_ROWS"
                    :min="1"
                    :max="1000000"
                /></el-form-item>
                <el-form-item label="PDF 最大页数"
                  ><el-input-number v-model="numericForm.MAX_PDF_PAGES" :min="1" :max="5000"
                /></el-form-item>
                <el-form-item label="图片最大像素数"
                  ><el-input-number
                    v-model="numericForm.MAX_IMAGE_PIXELS"
                    :min="1"
                    :max="250000000"
                /></el-form-item>
                <el-form-item label="OCR 语言"
                  ><el-input v-model="form.OCR_LANGUAGES" maxlength="128"
                /></el-form-item>
                <el-form-item label="OCR 低置信度阈值"
                  ><el-input-number
                    v-model="numericForm.OCR_CONFIDENCE_WARNING_THRESHOLD"
                    :min="0"
                    :max="1"
                    :step="0.05"
                /></el-form-item>
                <el-form-item label="CAD 最大实体数"
                  ><el-input-number v-model="numericForm.MAX_CAD_ENTITIES" :min="1" :max="2000000"
                /></el-form-item>
                <el-form-item label="CAD 最大嵌套深度"
                  ><el-input-number v-model="numericForm.MAX_CAD_INSERT_DEPTH" :min="1" :max="32"
                /></el-form-item>
                <el-form-item label="DWG 转换超时（秒）"
                  ><el-input-number
                    v-model="numericForm.DWG_CONVERSION_TIMEOUT_SECONDS"
                    :min="1"
                    :max="1800"
                /></el-form-item>
              </div>
            </div>

            <div class="configuration-actions">
              <el-form-item label="变更原因" required
                ><el-input
                  v-model="changeReason"
                  maxlength="500"
                  show-word-limit
                  placeholder="说明为什么修改本次配置"
              /></el-form-item>
              <el-button
                type="primary"
                :loading="saving"
                :disabled="
                  !configuration.deploymentAgentAvailable ||
                  changeReason.trim().length < 3 ||
                  Boolean(activeDeployment)
                "
                @click="saveAndDeploy"
                >保存并发布</el-button
              >
            </div>
          </el-form>
        </div>

        <div class="deployment-panel">
          <div class="configuration-heading">
            <div>
              <strong>发布记录</strong><span>显示受影响服务、readiness 结果与回滚入口。</span>
            </div>
          </div>
          <el-table v-if="!isMobile" :data="deployments" empty-text="暂无发布记录">
            <el-table-column prop="configVersion" label="版本" width="90"
              ><template #default="scope">v{{ scope.row.configVersion }}</template></el-table-column
            >
            <el-table-column label="状态" width="130"
              ><template #default="scope"
                ><el-tag :type="deploymentTag(deploymentRow(scope.row).status)">{{
                  deploymentStatus(deploymentRow(scope.row).status)
                }}</el-tag></template
              ></el-table-column
            >
            <el-table-column label="服务" min-width="180"
              ><template #default="scope">{{
                scope.row.services.join('、')
              }}</template></el-table-column
            >
            <el-table-column prop="errorCode" label="结果码" min-width="160"
              ><template #default="scope">{{
                scope.row.errorCode ?? '—'
              }}</template></el-table-column
            >
            <el-table-column label="操作" width="110"
              ><template #default="scope"
                ><el-button
                  v-if="deploymentRow(scope.row).rollbackAvailable && !activeDeployment"
                  text
                  type="warning"
                  @click="rollback(deploymentRow(scope.row))"
                  >回滚</el-button
                ></template
              ></el-table-column
            >
          </el-table>
          <div v-else class="deployment-card-list">
            <article v-for="deployment in deployments" :key="deployment.id" class="deployment-card">
              <div>
                <strong>v{{ deployment.configVersion }}</strong
                ><el-tag :type="deploymentTag(deployment.status)">{{
                  deploymentStatus(deployment.status)
                }}</el-tag>
              </div>
              <span>服务：{{ deployment.services.join('、') }}</span>
              <span>结果码：{{ deployment.errorCode ?? '—' }}</span>
              <el-button
                v-if="deployment.rollbackAvailable && !activeDeployment"
                text
                type="warning"
                @click="rollback(deployment)"
                >回滚</el-button
              >
            </article>
            <el-empty v-if="deployments.length === 0" description="暂无发布记录" />
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
