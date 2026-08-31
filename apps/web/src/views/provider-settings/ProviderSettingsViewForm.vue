<template>
  <div class="configuration-editor">
    <div ref="navigation" class="configuration-navigation">
      <slot name="heading" />
      <el-tabs
        v-model="activeSectionId"
        class="configuration-tabs"
        aria-label="运行配置分区"
        @tab-change="showConfigurationBlock"
      >
        <el-tab-pane
          v-for="section in sections"
          :key="section.id"
          :name="section.id"
          :label="isDesktop ? section.title : section.compactTitle"
        />
      </el-tabs>
    </div>

    <el-form label-position="top" class="configuration-form">
      <section
        :id="`configuration-${activeSection.id}`"
        :key="activeSection.id"
        class="configuration-section"
      >
        <div class="kb-heading kb-heading--h5" role="heading" aria-level="2">
          {{ activeSection.title }}
        </div>
        <div
          v-for="(group, groupIndex) in activeSection.groups"
          :key="groupIndex"
          class="configuration-fields"
        >
          <el-form-item v-for="field in group" :key="field.key" :label="field.label">
            <el-select v-if="field.kind === 'select'" v-model="form[field.key]">
              <el-option
                v-for="option in field.options"
                :key="option"
                :label="option"
                :value="option"
              />
            </el-select>
            <el-input
              v-else-if="field.kind === 'text'"
              v-model="form[field.key]"
              :maxlength="field.maxlength"
            />
            <el-input
              v-else-if="field.kind === 'secret'"
              v-model="secrets[field.key]"
              type="password"
              show-password
              autocomplete="new-password"
              :placeholder="secretPlaceholder(field.key)"
            />
            <el-switch
              v-else-if="field.kind === 'switch'"
              v-model="form[field.key]"
              active-value="true"
              inactive-value="false"
            />
            <el-input-number
              v-else
              v-model="numericForm[field.key]"
              :min="field.min"
              :max="field.max"
              :step="field.step"
            />
          </el-form-item>
        </div>
      </section>

      <div class="configuration-actions">
        <el-form-item label="变更原因" required>
          <el-input
            v-model="changeReason"
            maxlength="500"
            show-word-limit
            placeholder="说明为什么修改本次配置"
          />
        </el-form-item>
        <el-button
          class="configuration-submit"
          type="primary"
          :loading="saving"
          :disabled="
            !deploymentAgentAvailable || changeReason.trim().length < 3 || deploymentActive
          "
          @click="submit"
        >
          保存并发布
        </el-button>
      </div>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import type { ManagedConfigurationField, ManagedConfigurationSecret } from '@nexus-kb/contracts';
import { ElMessage } from 'element-plus';
import { computed, reactive, ref, watch } from 'vue';

type NumericField =
  | 'LLM_TEMPERATURE'
  | 'LLM_MAX_OUTPUT_TOKENS'
  | 'LLM_REQUEST_TIMEOUT_MS'
  | 'LLM_MAX_ATTEMPTS'
  | 'LLM_RETRY_BASE_DELAY_MS'
  | 'RERANK_TOP_K'
  | 'RERANK_REQUEST_TIMEOUT_MS'
  | 'QUERY_RECALL_TOP_K'
  | 'QUERY_MAX_DISTANCE'
  | 'PARSER_REQUEST_TIMEOUT_MS'
  | 'MAX_DWG_CONVERTED_BYTES'
  | 'MAX_PARSE_BYTES'
  | 'MAX_ELEMENTS'
  | 'MAX_SPREADSHEET_ROWS'
  | 'MAX_PDF_PAGES'
  | 'MAX_IMAGE_PIXELS'
  | 'OCR_CONFIDENCE_WARNING_THRESHOLD'
  | 'MAX_CAD_ENTITIES'
  | 'MAX_CAD_INSERT_DEPTH'
  | 'CAD_PREVIEW_TILE_COST_THRESHOLD'
  | 'CAD_PREVIEW_TILE_SOURCE_BYTES_THRESHOLD'
  | 'CAD_PREVIEW_TILE_SIZE'
  | 'CAD_PREVIEW_MAX_ZOOM'
  | 'CAD_PREVIEW_METATILE_RADIUS'
  | 'CAD_PREVIEW_TILE_CACHE_BYTES'
  | 'CAD_PREVIEW_RENDER_TIMEOUT_SECONDS'
  | 'CAD_PREVIEW_RENDER_MEMORY_BYTES'
  | 'DWG_CONVERSION_TIMEOUT_SECONDS'
  | 'TIKA_REQUEST_TIMEOUT_SECONDS'
  | 'MAX_TIKA_RESPONSE_BYTES'
  | 'MAX_ARCHIVE_ENTRIES'
  | 'MAX_ARCHIVE_UNCOMPRESSED_BYTES'
  | 'MAX_UPLOAD_BYTES'
  | 'INGESTION_CONCURRENCY'
  | 'INGESTION_MAX_ATTEMPTS'
  | 'INGESTION_RETRY_BASE_DELAY_MS'
  | 'QUERY_NEIGHBOR_WINDOW'
  | 'QUERY_MAX_MERGED_CONTEXT_CHARS'
  | 'QUERY_MAX_LLM_CONTEXT_CHARS'
  | 'QUERY_MAX_RERANK_INPUT_CHARS'
  | 'QUERY_USER_RATE_LIMIT_PER_MINUTE'
  | 'QUERY_TENANT_RATE_LIMIT_PER_MINUTE';

type SelectField = {
  kind: 'select';
  key: ManagedConfigurationField;
  label: string;
  options: readonly string[];
};
type TextField = { kind: 'text'; key: ManagedConfigurationField; label: string; maxlength: number };
type SecretField = { kind: 'secret'; key: ManagedConfigurationSecret; label: string };
type SwitchField = { kind: 'switch'; key: ManagedConfigurationField; label: string };
type NumberField = {
  kind: 'number';
  key: NumericField;
  label: string;
  min: number;
  max: number;
  step?: number;
};
type Field = SelectField | TextField | SecretField | SwitchField | NumberField;

const numericFields = [
  'LLM_TEMPERATURE',
  'LLM_MAX_OUTPUT_TOKENS',
  'LLM_REQUEST_TIMEOUT_MS',
  'LLM_MAX_ATTEMPTS',
  'LLM_RETRY_BASE_DELAY_MS',
  'RERANK_TOP_K',
  'RERANK_REQUEST_TIMEOUT_MS',
  'QUERY_RECALL_TOP_K',
  'QUERY_MAX_DISTANCE',
  'PARSER_REQUEST_TIMEOUT_MS',
  'MAX_DWG_CONVERTED_BYTES',
  'MAX_PARSE_BYTES',
  'MAX_ELEMENTS',
  'MAX_SPREADSHEET_ROWS',
  'MAX_PDF_PAGES',
  'MAX_IMAGE_PIXELS',
  'OCR_CONFIDENCE_WARNING_THRESHOLD',
  'MAX_CAD_ENTITIES',
  'MAX_CAD_INSERT_DEPTH',
  'CAD_PREVIEW_TILE_COST_THRESHOLD',
  'CAD_PREVIEW_TILE_SOURCE_BYTES_THRESHOLD',
  'CAD_PREVIEW_TILE_SIZE',
  'CAD_PREVIEW_MAX_ZOOM',
  'CAD_PREVIEW_METATILE_RADIUS',
  'CAD_PREVIEW_TILE_CACHE_BYTES',
  'CAD_PREVIEW_RENDER_TIMEOUT_SECONDS',
  'CAD_PREVIEW_RENDER_MEMORY_BYTES',
  'DWG_CONVERSION_TIMEOUT_SECONDS',
  'TIKA_REQUEST_TIMEOUT_SECONDS',
  'MAX_TIKA_RESPONSE_BYTES',
  'MAX_ARCHIVE_ENTRIES',
  'MAX_ARCHIVE_UNCOMPRESSED_BYTES',
  'MAX_UPLOAD_BYTES',
  'INGESTION_CONCURRENCY',
  'INGESTION_MAX_ATTEMPTS',
  'INGESTION_RETRY_BASE_DELAY_MS',
  'QUERY_NEIGHBOR_WINDOW',
  'QUERY_MAX_MERGED_CONTEXT_CHARS',
  'QUERY_MAX_LLM_CONTEXT_CHARS',
  'QUERY_MAX_RERANK_INPUT_CHARS',
  'QUERY_USER_RATE_LIMIT_PER_MINUTE',
  'QUERY_TENANT_RATE_LIMIT_PER_MINUTE',
] as const satisfies ReadonlyArray<NumericField>;
const numericFieldSet = new Set<ManagedConfigurationField>(numericFields);

const props = defineProps<{
  pageContent: HTMLElement | null;
  isDesktop: boolean;
  effectiveValues: Partial<Record<ManagedConfigurationField, string | number | boolean>>;
  secretConfigured: Partial<Record<ManagedConfigurationSecret, boolean>>;
  deploymentAgentAvailable: boolean;
  deploymentActive: boolean;
  saving: boolean;
  resetToken: number;
}>();

const form = reactive<Partial<Record<ManagedConfigurationField, string>>>({});
const numericForm = reactive<Partial<Record<NumericField, number>>>({});
const secrets = reactive<Partial<Record<ManagedConfigurationSecret, string>>>({});
const changeReason = ref('');
const navigation = ref<HTMLElement | null>(null);
const activeSectionId = ref('llm');
const emit = defineEmits<{
  save: [
    input: {
      values: Partial<Record<ManagedConfigurationField, string | number | boolean>>;
      secrets: Partial<Record<ManagedConfigurationSecret, string>>;
      changeReason: string;
    },
  ];
}>();

watch(
  () => props.effectiveValues,
  (effectiveValues) => {
    for (const [key, value] of Object.entries(effectiveValues)) {
      const field = key as ManagedConfigurationField;
      if (numericFieldSet.has(field)) numericForm[field as NumericField] = Number(value);
      else form[field] = String(value);
    }
  },
  { immediate: true },
);
watch(
  () => props.resetToken,
  () => {
    for (const field of Object.keys(secrets) as ManagedConfigurationSecret[]) secrets[field] = '';
    changeReason.value = '';
  },
);

const llmProviders = ['none', 'openai', 'google', 'deepseek', 'alibaba', 'custom'] as const;
const sections: ReadonlyArray<{
  id: string;
  title: string;
  compactTitle: string;
  groups: ReadonlyArray<ReadonlyArray<Field>>;
}> = [
  {
    id: 'llm',
    title: 'LLM',
    compactTitle: 'LLM',
    groups: [
      [
        { kind: 'select', key: 'LLM_PROVIDER', label: '主 Provider', options: llmProviders },
        { kind: 'text', key: 'LLM_MODEL', label: '主模型', maxlength: 128 },
        {
          kind: 'select',
          key: 'LLM_FALLBACK_PROVIDER',
          label: '备用 Provider',
          options: llmProviders,
        },
        { kind: 'text', key: 'LLM_FALLBACK_MODEL', label: '备用模型', maxlength: 128 },
        { kind: 'number', key: 'LLM_TEMPERATURE', label: '温度', min: 0, max: 2, step: 0.1 },
        {
          kind: 'number',
          key: 'LLM_MAX_OUTPUT_TOKENS',
          label: '最大输出 Token',
          min: 1,
          max: 65536,
        },
        {
          kind: 'number',
          key: 'LLM_REQUEST_TIMEOUT_MS',
          label: '请求超时（ms）',
          min: 100,
          max: 300000,
        },
        { kind: 'number', key: 'LLM_MAX_ATTEMPTS', label: '最大重试次数', min: 1, max: 6 },
        {
          kind: 'number',
          key: 'LLM_RETRY_BASE_DELAY_MS',
          label: '重试初始延迟（ms）',
          min: 1,
          max: 10000,
        },
      ],
      [
        { kind: 'text', key: 'OPENAI_BASE_URL', label: 'OpenAI Base URL', maxlength: 2048 },
        { kind: 'text', key: 'OPENAI_REGION', label: 'OpenAI 区域', maxlength: 64 },
        { kind: 'text', key: 'GEMINI_BASE_URL', label: 'Gemini Base URL', maxlength: 2048 },
        { kind: 'text', key: 'GEMINI_REGION', label: 'Gemini 区域', maxlength: 64 },
        { kind: 'text', key: 'DEEPSEEK_BASE_URL', label: 'DeepSeek Base URL', maxlength: 2048 },
        { kind: 'text', key: 'DEEPSEEK_REGION', label: 'DeepSeek 区域', maxlength: 64 },
        { kind: 'text', key: 'ALIBABA_BASE_URL', label: '阿里云 Base URL', maxlength: 2048 },
        { kind: 'text', key: 'ALIBABA_REGION', label: '阿里云区域', maxlength: 64 },
        { kind: 'text', key: 'CUSTOM_BASE_URL', label: '自定义 Base URL', maxlength: 2048 },
        { kind: 'text', key: 'CUSTOM_REGION', label: '自定义区域', maxlength: 64 },
      ],
      [
        { kind: 'secret', key: 'OPENAI_API_KEY', label: 'OpenAI Key' },
        { kind: 'secret', key: 'GEMINI_API_KEY', label: 'Gemini Key' },
        { kind: 'secret', key: 'DEEPSEEK_API_KEY', label: 'DeepSeek Key' },
        { kind: 'secret', key: 'DASHSCOPE_API_KEY', label: '阿里云 Key' },
        { kind: 'secret', key: 'CUSTOM_API_KEY', label: '自定义 Provider Key' },
      ],
    ],
  },
  {
    id: 'rerank',
    title: 'Rerank 与问答',
    compactTitle: 'Rerank',
    groups: [
      [
        {
          kind: 'select',
          key: 'RERANK_PROVIDER',
          label: 'Rerank Provider',
          options: ['none', 'alibaba', 'local_bge'],
        },
        { kind: 'text', key: 'RERANK_MODEL', label: 'Rerank 模型', maxlength: 128 },
        { kind: 'text', key: 'RERANK_BASE_URL', label: 'Rerank Base URL', maxlength: 2048 },
        { kind: 'text', key: 'RERANK_REGION', label: 'Rerank 区域', maxlength: 64 },
        { kind: 'number', key: 'RERANK_TOP_K', label: '保留候选数', min: 1, max: 100 },
        {
          kind: 'number',
          key: 'RERANK_REQUEST_TIMEOUT_MS',
          label: 'Rerank 超时（ms）',
          min: 100,
          max: 300000,
        },
        {
          kind: 'select',
          key: 'QUERY_ANSWER_MODE',
          label: '回答模式',
          options: ['hybrid', 'strict'],
        },
        { kind: 'number', key: 'QUERY_RECALL_TOP_K', label: '召回数量', min: 1, max: 100 },
        {
          kind: 'number',
          key: 'QUERY_MAX_DISTANCE',
          label: '距离阈值',
          min: 0,
          max: 2,
          step: 0.01,
        },
        { kind: 'number', key: 'QUERY_NEIGHBOR_WINDOW', label: '相邻分块窗口', min: 0, max: 3 },
        {
          kind: 'number',
          key: 'QUERY_MAX_MERGED_CONTEXT_CHARS',
          label: '合并上下文最大字符数',
          min: 1000,
          max: 100000,
        },
        {
          kind: 'number',
          key: 'QUERY_MAX_LLM_CONTEXT_CHARS',
          label: 'LLM 上下文最大字符数',
          min: 1000,
          max: 1000000,
        },
        {
          kind: 'number',
          key: 'QUERY_MAX_RERANK_INPUT_CHARS',
          label: 'Rerank 输入最大字符数',
          min: 1000,
          max: 1000000,
        },
        {
          kind: 'number',
          key: 'QUERY_USER_RATE_LIMIT_PER_MINUTE',
          label: '单用户每分钟问答上限',
          min: 1,
          max: 1000,
        },
        {
          kind: 'number',
          key: 'QUERY_TENANT_RATE_LIMIT_PER_MINUTE',
          label: 'Tenant 每分钟问答上限',
          min: 1,
          max: 100000,
        },
      ],
    ],
  },
  {
    id: 'ingestion',
    title: '上传与入库',
    compactTitle: '入库',
    groups: [
      [
        {
          kind: 'number',
          key: 'MAX_UPLOAD_BYTES',
          label: '上传文件最大字节',
          min: 1,
          max: 1073741824,
        },
        { kind: 'number', key: 'INGESTION_CONCURRENCY', label: '入库并发数', min: 1, max: 32 },
        {
          kind: 'number',
          key: 'INGESTION_MAX_ATTEMPTS',
          label: '入库最大尝试次数',
          min: 1,
          max: 20,
        },
        {
          kind: 'number',
          key: 'INGESTION_RETRY_BASE_DELAY_MS',
          label: '入库重试初始延迟（ms）',
          min: 100,
          max: 60000,
        },
      ],
    ],
  },
  {
    id: 'parser',
    title: 'Parser',
    compactTitle: 'Parser',
    groups: [
      [
        {
          kind: 'number',
          key: 'PARSER_REQUEST_TIMEOUT_MS',
          label: 'API 等待超时（ms）',
          min: 100,
          max: 900000,
        },
        {
          kind: 'number',
          key: 'MAX_PARSE_BYTES',
          label: '单文件最大字节',
          min: 1,
          max: 1073741824,
        },
        { kind: 'number', key: 'MAX_ELEMENTS', label: '最大元素数', min: 1, max: 1000000 },
        {
          kind: 'number',
          key: 'MAX_SPREADSHEET_ROWS',
          label: '表格最大行数',
          min: 1,
          max: 1000000,
        },
        { kind: 'number', key: 'MAX_PDF_PAGES', label: 'PDF 最大页数', min: 1, max: 5000 },
        {
          kind: 'number',
          key: 'MAX_IMAGE_PIXELS',
          label: '图片最大像素数',
          min: 1,
          max: 250000000,
        },
        { kind: 'text', key: 'OCR_LANGUAGES', label: 'OCR 语言', maxlength: 128 },
        {
          kind: 'number',
          key: 'OCR_CONFIDENCE_WARNING_THRESHOLD',
          label: 'OCR 低置信度阈值',
          min: 0,
          max: 1,
          step: 0.05,
        },
        {
          kind: 'number',
          key: 'MAX_ARCHIVE_ENTRIES',
          label: '压缩包最大条目数',
          min: 1,
          max: 100000,
        },
        {
          kind: 'number',
          key: 'MAX_ARCHIVE_UNCOMPRESSED_BYTES',
          label: '压缩包解压后最大字节',
          min: 1,
          max: 1073741824,
        },
      ],
    ],
  },
  {
    id: 'cad',
    title: 'CAD / DWG',
    compactTitle: 'CAD',
    groups: [
      [
        { kind: 'number', key: 'MAX_CAD_ENTITIES', label: 'CAD 最大实体数', min: 1, max: 2000000 },
        { kind: 'number', key: 'MAX_CAD_INSERT_DEPTH', label: 'CAD 最大嵌套深度', min: 1, max: 32 },
        { kind: 'switch', key: 'CAD_TILED_PREVIEW_ENABLED', label: '启用 CAD 超大图纸瓦片预览' },
        {
          kind: 'number',
          key: 'CAD_PREVIEW_TILE_COST_THRESHOLD',
          label: 'CAD 瓦片渲染成本阈值',
          min: 1,
          max: 100000000,
        },
        {
          kind: 'number',
          key: 'CAD_PREVIEW_TILE_SOURCE_BYTES_THRESHOLD',
          label: 'CAD 瓦片源文件阈值（字节）',
          min: 1,
          max: 1073741824,
        },
        {
          kind: 'number',
          key: 'CAD_PREVIEW_TILE_SIZE',
          label: 'CAD 瓦片尺寸（像素）',
          min: 256,
          max: 1024,
          step: 256,
        },
        {
          kind: 'number',
          key: 'CAD_PREVIEW_MAX_ZOOM',
          label: 'CAD 最大瓦片缩放层级',
          min: 1,
          max: 12,
        },
        {
          kind: 'number',
          key: 'CAD_PREVIEW_METATILE_RADIUS',
          label: 'CAD 瓦片预取半径',
          min: 0,
          max: 2,
        },
        {
          kind: 'number',
          key: 'CAD_PREVIEW_TILE_CACHE_BYTES',
          label: 'CAD 瓦片缓存上限（字节）',
          min: 1048576,
          max: 2147483647,
        },
        {
          kind: 'number',
          key: 'CAD_PREVIEW_RENDER_TIMEOUT_SECONDS',
          label: 'CAD 单次渲染超时（秒）',
          min: 5,
          max: 600,
        },
        {
          kind: 'number',
          key: 'CAD_PREVIEW_RENDER_MEMORY_BYTES',
          label: 'CAD 渲染内存上限（字节）',
          min: 536870912,
          max: 8589934592,
        },
        {
          kind: 'number',
          key: 'DWG_CONVERSION_TIMEOUT_SECONDS',
          label: 'DWG 转换超时（秒）',
          min: 1,
          max: 1800,
        },
        {
          kind: 'number',
          key: 'MAX_DWG_CONVERTED_BYTES',
          label: 'DWG 转换产物最大字节',
          min: 1,
          max: 1073741824,
        },
        { kind: 'switch', key: 'DWG_CONVERSION_ENABLED', label: '启用 DWG 上传与转换' },
        {
          kind: 'select',
          key: 'DWG_OUTPUT_VERSION',
          label: 'DWG 输出版本',
          options: [
            'ACAD2018',
            'ACAD2013',
            'ACAD2010',
            'ACAD2007',
            'ACAD2004',
            'ACAD2000',
            'ACAD14',
            'ACAD13',
            'ACAD12',
          ],
        },
      ],
    ],
  },
  {
    id: 'tika',
    title: 'Tika',
    compactTitle: 'Tika',
    groups: [
      [
        { kind: 'switch', key: 'TIKA_ENABLED', label: '启用 Tika PDF 兜底' },
        {
          kind: 'number',
          key: 'TIKA_REQUEST_TIMEOUT_SECONDS',
          label: 'Tika 超时（秒）',
          min: 1,
          max: 600,
        },
        {
          kind: 'number',
          key: 'MAX_TIKA_RESPONSE_BYTES',
          label: 'Tika 响应最大字节',
          min: 1,
          max: 268435456,
        },
      ],
    ],
  },
];

const activeSection = computed(
  () => sections.find((section) => section.id === activeSectionId.value) ?? sections[0]!,
);

function showConfigurationBlock(): void {
  const pageContent = props.pageContent;
  const configurationBlock = navigation.value?.closest<HTMLElement>('.kb-block');
  if (!pageContent || !configurationBlock) return;
  const top =
    pageContent.scrollTop +
    configurationBlock.getBoundingClientRect().top -
    pageContent.getBoundingClientRect().top;
  if (typeof pageContent.scrollTo === 'function') pageContent.scrollTo({ top, behavior: 'smooth' });
  else pageContent.scrollTop = top;
}

function secretPlaceholder(field: ManagedConfigurationSecret): string {
  return props.secretConfigured[field] ? '已配置；留空保持不变' : '尚未配置';
}

function submit(): void {
  const values: Partial<Record<ManagedConfigurationField, string | number | boolean>> = {};
  for (const field of Object.keys(form) as ManagedConfigurationField[]) {
    const value = form[field];
    if (value !== undefined && String(props.effectiveValues[field] ?? '') !== String(value)) {
      values[field] = value;
    }
  }
  for (const field of numericFields) {
    const value = numericForm[field];
    if (value !== undefined && String(props.effectiveValues[field] ?? '') !== String(value)) {
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
  emit('save', { values, secrets: changedSecrets, changeReason: changeReason.value });
}
</script>

<style scoped>
.configuration-form,
.configuration-section {
  display: grid;
  gap: var(--kb-space-4);
}
.configuration-form :deep(.el-form-item) {
  margin: 0;
}
.configuration-form :deep(.el-input-number),
.configuration-form :deep(.el-select) {
  width: 100%;
}
.configuration-editor {
  display: grid;
  align-items: start;
  gap: var(--kb-layout-gap);
  grid-template-columns: minmax(0, 1fr);
}
.configuration-navigation {
  position: sticky;
  top: 0;
  z-index: 3;
  display: grid;
  min-width: 0;
  background: var(--kb-color-surface);
}
.configuration-tabs {
  min-width: 0;
  max-width: 100%;
}
.configuration-tabs :deep(.el-tabs__header) {
  margin: 0;
}
.configuration-fields {
  display: grid;
  gap: var(--kb-layout-gap);
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.configuration-actions {
  display: grid;
  align-items: end;
  gap: var(--kb-space-4);
  grid-template-columns: minmax(0, 1fr) auto;
}
@media (max-width: 1279px) {
  .configuration-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 767px) {
  .configuration-actions,
  .configuration-fields {
    grid-template-columns: 1fr;
  }
  .configuration-submit {
    width: 100%;
  }
}
</style>
