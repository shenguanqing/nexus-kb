<template>
  <section class="kb-page">
    <form
      v-if="!isMobile"
      class="ingestion-toolbar"
      aria-label="入库任务筛选"
      @submit.prevent="applyFilters"
    >
      <label class="ingestion-document-filter">
        <span class="kb-visually-hidden">文档 ID</span>
        <el-input
          v-model="filters.documentId"
          clearable
          maxlength="36"
          placeholder="文档 ID"
          :aria-invalid="Boolean(documentIdError)"
          @input="documentIdError = ''"
        />
        <span v-if="documentIdError" class="kb-text kb-text--sm kb-text--danger" role="alert">
          {{ documentIdError }}
        </span>
      </label>
      <el-select v-model="filters.status" clearable placeholder="全部状态">
        <el-option
          v-for="option in INGESTION_STATUS_OPTIONS"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <div class="kb-filter-actions">
        <el-button native-type="submit">筛选</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>
    </form>
    <form
      v-else
      class="ingestion-toolbar ingestion-toolbar--mobile"
      aria-label="搜索入库任务"
      @submit.prevent="applyFilters"
    >
      <label class="ingestion-document-filter">
        <span class="kb-visually-hidden">文档 ID</span>
        <el-input
          v-model="filters.documentId"
          clearable
          maxlength="36"
          placeholder="文档 ID"
          :aria-invalid="Boolean(documentIdError)"
          @input="documentIdError = ''"
        />
        <span v-if="documentIdError" class="kb-text kb-text--sm kb-text--danger" role="alert">
          {{ documentIdError }}
        </span>
      </label>
      <el-button
        class="kb-filter-trigger"
        :class="{ 'kb-filter-trigger--active': hasStatusFilter }"
        aria-label="筛选"
        @click="filtersVisible = true"
      >
        筛选
      </el-button>
    </form>
    <el-drawer
      v-if="isMobile"
      v-model="filtersVisible"
      direction="btt"
      size="auto"
      title="筛选入库任务"
      append-to-body
    >
      <form class="kb-filter-form" aria-label="入库任务状态筛选" @submit.prevent="applyFilters">
        <el-select v-model="filters.status" clearable placeholder="全部状态">
          <el-option
            v-for="option in INGESTION_STATUS_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <div class="kb-filter-form__actions">
          <el-button @click="resetFilters">重置</el-button>
          <el-button type="primary" native-type="submit">筛选</el-button>
        </div>
      </form>
    </el-drawer>
    <div class="kb-block-content">
      <div v-if="errorMessage" class="kb-error-state" role="alert">
        <strong class="kb-text kb-text--danger">无法加载入库任务</strong>
        <span>{{ errorMessage }}</span>
        <el-button @click="load()">重试</el-button>
      </div>
      <div v-else v-loading="loading" class="kb-block kb-block--flush kb-block-scroll">
        <article
          v-for="job in items"
          :key="job.id"
          class="ingestion-card"
          :class="{ 'is-expanded': isExpanded(job) }"
        >
          <header
            class="ingestion-summary"
            role="button"
            tabindex="0"
            :aria-expanded="isExpanded(job)"
            :aria-controls="`ingestion-details-${job.id}`"
            @click="toggleExpanded(job)"
            @keydown.enter.prevent="toggleExpanded(job)"
            @keydown.space.prevent="toggleExpanded(job)"
          >
            <div class="ingestion-summary-title">
              <RouterLink
                v-slot="{ href, navigate }"
                :to="{
                  path: `/documents/${job.documentId}`,
                  query: { from: route.fullPath },
                }"
                custom
              >
                <el-link
                  class="kb-link kb-link--fill"
                  type="primary"
                  underline="never"
                  :href="href"
                  @click="navigate"
                >
                  <span class="kb-link__text kb-text kb-text--medium">
                    {{ job.sourceName }}
                  </span>
                </el-link>
              </RouterLink>
              <span class="kb-text kb-text--md kb-text--secondary">
                v{{ job.version }} · {{ ingestionKindLabel(job.kind) }}
              </span>
            </div>
            <div class="ingestion-summary-meta">
              <div
                class="ingestion-progress-dots"
                role="img"
                :aria-label="`任务进度：${Math.min(activeStep(job) + 1, stepOrder.length)} / ${stepOrder.length}`"
              >
                <span
                  v-for="index in progressDots"
                  :key="index"
                  class="ingestion-progress-dot"
                  :class="`is-${progressDotState(job, index)}`"
                >
                </span>
              </div>
              <el-tag :type="statusTagType(job)">
                {{ summaryStatusLabel(job) }}
              </el-tag>
              <el-icon
                class="ingestion-chevron"
                :class="{ 'is-expanded': isExpanded(job) }"
                aria-hidden="true"
              >
                <ArrowDown />
              </el-icon>
            </div>
          </header>
          <div v-if="isExpanded(job)" :id="`ingestion-details-${job.id}`" class="ingestion-details">
            <el-progress
              v-if="job.status === 'converting'"
              class="ingestion-progress"
              :percentage="50"
              :indeterminate="true"
              :show-text="false"
            />
            <div v-else class="ingestion-steps-scroll" tabindex="0" aria-label="入库步骤">
              <el-steps
                class="ingestion-steps"
                :simple="!isMobile"
                :direction="isMobile ? 'vertical' : 'horizontal'"
                :active="activeStep(job)"
                :process-status="job.status === 'failed' ? 'error' : 'process'"
                :finish-status="job.status === 'completed' ? 'success' : 'finish'"
              >
                <el-step title="排队" />
                <el-step title="解析" />
                <el-step title="分块/脱敏" />
                <el-step title="策略" />
                <el-step title="Embedding" />
                <el-step title="索引" />
                <el-step title="完成" />
              </el-steps>
            </div>
            <div class="kb-data-grid kb-data-grid--four kb-data-grid--flush">
              <div class="kb-data-grid__item">
                <span class="kb-text kb-text--sm kb-text--secondary">耗时</span>
                <span class="kb-data-grid__value">{{ elapsed(job) }}</span>
              </div>
              <div class="kb-data-grid__item">
                <span class="kb-text kb-text--sm kb-text--secondary">尝试次数</span>
                <span class="kb-data-grid__value">{{ job.attempts }}</span>
              </div>
              <div v-if="job.embeddingTotalChunks !== null" class="kb-data-grid__item">
                <span class="kb-text kb-text--sm kb-text--secondary">Embedding 进度</span>
                <span class="kb-data-grid__value">
                  {{ job.embeddingCompletedChunks }} / {{ job.embeddingTotalChunks }}
                </span>
              </div>
              <div class="kb-data-grid__item">
                <span class="kb-text kb-text--sm kb-text--secondary">更新时间</span>
                <span class="kb-data-grid__value">
                  {{ new Date(job.updatedAt).toLocaleString() }}
                </span>
              </div>
            </div>
            <div v-if="job.warnings.length" class="ingestion-feedback ingestion-warning">
              <div class="kb-block__header">
                <div class="kb-block__title kb-text kb-text--medium">处理说明</div>
              </div>
              <div class="kb-data-fields kb-data-fields--borderless">
                <div
                  v-for="warning in warningPresentations(job)"
                  :key="warning.code"
                  class="kb-data-field"
                >
                  <span class="kb-data-field__label">{{ warning.title }}</span>
                  <span class="kb-data-field__value">{{ warning.message }}</span>
                </div>
              </div>
            </div>
            <div v-if="job.errorCode" class="ingestion-feedback ingestion-error">
              <div class="kb-block__header">
                <div class="kb-block__title kb-text kb-text--medium">失败说明</div>
              </div>
              <div class="kb-data-fields kb-data-fields--borderless">
                <div class="kb-data-field">
                  <span class="kb-data-field__label">失败原因</span>
                  <span class="kb-data-field__value">
                    {{ ingestionErrorMessage(job.errorCode) }}
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">技术详情</span>
                  <span class="kb-data-field__value">{{ job.errorCode }}</span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">Trace ID</span>
                  <span class="kb-data-field__value">{{ job.traceId }}</span>
                </div>
              </div>
              <div
                v-if="canRetry && job.status === 'failed' && job.retryable"
                class="ingestion-feedback__actions"
              >
                <el-button type="danger" plain :loading="retryingId === job.id" @click="retry(job)">
                  重试任务
                </el-button>
              </div>
            </div>
          </div>
        </article>
        <el-empty v-if="!loading && items.length === 0" description="暂无符合条件的入库任务" />
      </div>
      <div
        v-if="!errorMessage && !documentIdError && total > filters.pageSize"
        class="kb-pagination"
      >
        <el-pagination
          layout="total, prev, pager, next"
          :current-page="filters.page"
          :page-size="filters.pageSize"
          :total="total"
          @current-change="changePage"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  ingestionJobListRequestSchema,
  type IngestionJob,
  type IngestionJobListRequest,
} from '@nexus-kb/contracts';
import { ArrowDown } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/client';
import { listIngestionJobs, retryIngestionJob } from '@/api/ingestion';
import { ingestionJobsReturn } from '@/router/return-navigation';
import { useAuthStore } from '@/stores/auth';
import { useBreakpoint } from '@/composables/useBreakpoint';
import {
  formatIngestionElapsed,
  ingestionErrorMessage,
  ingestionKindLabel,
  ingestionStatusLabel,
  ingestionWarningPresentation,
  INGESTION_STATUS_OPTIONS,
  isRunningIngestionStatus,
} from './ingestion-presentation';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { isMobile } = useBreakpoint();
const items = ref<IngestionJob[]>([]);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const documentIdError = ref('');
const retryingId = ref<string | null>(null);
const filtersVisible = ref(false);
const expansionOverrides = ref<Record<string, boolean>>({});
const filters = reactive({
  status: typeof route.query.status === 'string' ? route.query.status : '',
  documentId: typeof route.query.documentId === 'string' ? route.query.documentId : '',
  page: Number(route.query.page) || 1,
  pageSize: Number(route.query.pageSize) || 20,
});
const canRetry = computed(() => auth.hasCapability('documents:write'));
const hasStatusFilter = computed(() => filters.status !== '');
const returnNavigation = computed(() => ingestionJobsReturn(route.query.returnTo));
const nowMs = ref(Date.now());
let pollingTimer: number | undefined;
let elapsedTimer: number | undefined;
function request(): Partial<IngestionJobListRequest> {
  return {
    status: (filters.status || undefined) as IngestionJobListRequest['status'],
    documentId: filters.documentId.trim() || undefined,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

function validateDocumentId(): boolean {
  const documentId = filters.documentId.trim();
  if (!documentId) {
    documentIdError.value = '';
    return true;
  }
  const parsed = ingestionJobListRequestSchema.safeParse({ documentId });
  documentIdError.value = parsed.success ? '' : '请输入完整的文档 ID（UUID）';
  return parsed.success;
}

async function load(quiet = false): Promise<void> {
  if (!validateDocumentId()) {
    errorMessage.value = '';
    loading.value = false;
    return;
  }
  if (!quiet) loading.value = true;
  errorMessage.value = '';
  try {
    const result = await listIngestionJobs(request());
    items.value = result.items;
    total.value = result.total;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '入库任务加载失败';
  } finally {
    loading.value = false;
  }
}

async function applyFilters(): Promise<void> {
  if (!validateDocumentId()) return;
  filters.page = 1;
  await syncAndLoad();
  filtersVisible.value = false;
}
async function syncAndLoad(): Promise<void> {
  const query = Object.fromEntries(
    Object.entries(request()).filter(([, value]) => value !== undefined && value !== ''),
  );
  if (returnNavigation.value) query.returnTo = returnNavigation.value.to;
  await router.replace({ query });
  await load();
}
async function resetFilters(): Promise<void> {
  filters.status = '';
  filters.documentId = '';
  documentIdError.value = '';
  filters.page = 1;
  await syncAndLoad();
  filtersVisible.value = false;
}

async function changePage(nextPage: number): Promise<void> {
  filters.page = nextPage;
  await syncAndLoad();
}
async function retry(job: IngestionJob): Promise<void> {
  retryingId.value = job.id;
  try {
    await retryIngestionJob(job.id);
    ElMessage.success('任务已重新进入队列');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '重试失败');
  } finally {
    retryingId.value = null;
  }
}
function elapsed(job: IngestionJob): string {
  return formatIngestionElapsed(job, nowMs.value);
}

function warningPresentations(job: IngestionJob) {
  return job.warnings.map(ingestionWarningPresentation);
}

const stepOrder = [
  'queued',
  'parsing',
  'chunking',
  'policy_check',
  'embedding',
  'indexing',
  'completed',
] as const;
const progressDots = Array.from({ length: stepOrder.length }, (_, index) => index);

function activeStep(job: IngestionJob): number {
  if (job.status === 'completed') return stepOrder.length;
  if (job.status === 'converting') return 1;

  const current = stepOrder.indexOf(job.step as (typeof stepOrder)[number]);
  if (current >= 0) return current;

  const checkpoint = stepOrder.indexOf(job.checkpoint as (typeof stepOrder)[number]);
  return checkpoint >= 0 ? checkpoint : 0;
}

function isExpanded(job: IngestionJob): boolean {
  return (
    expansionOverrides.value[job.id] ??
    (isRunningIngestionStatus(job.status) || job.status === 'failed')
  );
}

function toggleExpanded(job: IngestionJob): void {
  expansionOverrides.value = {
    ...expansionOverrides.value,
    [job.id]: !isExpanded(job),
  };
}

function summaryStatusLabel(job: IngestionJob): string {
  if (isRunningIngestionStatus(job.status)) return '进行中';
  return ingestionStatusLabel(job.status);
}

function statusTagType(job: IngestionJob): 'success' | 'danger' | 'warning' | 'info' {
  if (job.status === 'completed') return 'success';
  if (job.status === 'failed') return 'danger';
  if (job.status === 'policy_blocked') return 'warning';
  return 'info';
}

function progressDotState(
  job: IngestionJob,
  index: number,
): 'complete' | 'current' | 'error' | 'pending' {
  if (job.status === 'completed') return 'complete';

  const current = Math.min(activeStep(job), stepOrder.length - 1);
  if (index < current) return 'complete';
  if (index > current) return 'pending';
  if (job.status === 'failed') return 'error';
  if (isRunningIngestionStatus(job.status)) return 'current';
  return 'pending';
}

onMounted(async () => {
  await load();
  elapsedTimer = window.setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
  pollingTimer = window.setInterval(() => {
    if (items.value.some((job) => isRunningIngestionStatus(job.status))) void load(true);
  }, 5000);
});
onUnmounted(() => {
  if (elapsedTimer !== undefined) window.clearInterval(elapsedTimer);
  if (pollingTimer !== undefined) window.clearInterval(pollingTimer);
});
</script>

<style scoped>
.ingestion-toolbar {
  display: grid;
  align-items: start;
  gap: var(--kb-space-2);
  grid-template-columns: minmax(0, 1fr) minmax(160px, 0.6fr) auto;
}
.ingestion-document-filter {
  display: grid;
  gap: var(--kb-space-1);
  min-width: 0;
}
.ingestion-progress {
  margin: var(--kb-space-4) 0 0;
  padding: var(--kb-block-padding);
}
.ingestion-card,
.ingestion-summary,
.ingestion-details {
  min-width: 0;
}
.ingestion-card + .ingestion-card {
  border-top: 1px solid var(--kb-color-border);
}
.ingestion-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--kb-space-4);
  min-height: var(--kb-space-16);
  padding: var(--kb-block-padding);
  cursor: pointer;
}
.ingestion-summary:hover {
  background: var(--kb-color-primary-soft);
}
.ingestion-summary:focus-visible {
  outline: 2px solid var(--kb-color-primary);
  outline-offset: -2px;
}
.ingestion-summary-title {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: flex-start;
  overflow: hidden;
  min-width: 0;
}
.ingestion-summary-meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--kb-layout-gap);
}
.ingestion-progress-dots {
  display: flex;
  align-items: center;
  gap: var(--kb-space-1);
}
.ingestion-progress-dot {
  width: var(--kb-space-2);
  height: var(--kb-space-2);
  border-radius: 50%;
  background: var(--kb-color-border);
}
.ingestion-progress-dot.is-complete {
  background: var(--kb-color-success);
}
.ingestion-progress-dot.is-current {
  background: var(--kb-color-primary);
}
.ingestion-progress-dot.is-error {
  background: var(--kb-color-danger);
}
.ingestion-chevron {
  color: var(--kb-color-text-secondary);
  transition: transform 0.18s ease;
}
.ingestion-chevron.is-expanded {
  transform: rotate(180deg);
}
.ingestion-details {
  display: grid;
  gap: var(--kb-layout-gap);
  padding: var(--kb-block-padding);
}
.ingestion-steps-scroll {
  overflow-x: auto;
  min-width: 0;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-color-canvas);
  overscroll-behavior-x: contain;
  scrollbar-gutter: stable;
}
.ingestion-steps {
  margin: 0;
  padding: var(--kb-block-padding);
  border-radius: var(--kb-radius-lg);
  background: transparent;
}
.ingestion-feedback {
  display: grid;
  gap: var(--kb-space-2);
  padding: var(--kb-block-padding);
  border-radius: var(--kb-radius-lg);
}
.ingestion-warning {
  color: var(--kb-color-warning);
  background: var(--kb-color-warning-soft);
}
.ingestion-feedback > .kb-block__header {
  margin-bottom: 0;
}
.ingestion-feedback .kb-block__title,
.ingestion-feedback .kb-data-field__label,
.ingestion-feedback .kb-data-field__value {
  color: inherit;
}
.ingestion-feedback__actions {
  display: flex;
  justify-content: flex-end;
}
.ingestion-error {
  color: var(--kb-color-danger);
  background: var(--kb-color-danger-soft);
}
/* 响应式：Pad（768px–1279px） */
@media (min-width: 768px) and (max-width: 1279px) {
  .ingestion-card .ingestion-steps {
    width: max-content;
    min-width: 100%;
  }
}
/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .ingestion-toolbar--mobile {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .ingestion-summary-meta {
    gap: var(--kb-space-2);
  }
  .ingestion-progress-dots {
    display: none;
  }
  .ingestion-steps-scroll {
    overflow: visible;
    margin: 0;
    background: transparent;
    scrollbar-gutter: auto;
  }
  .ingestion-steps {
    min-width: 0;
    padding: var(--kb-space-2) 0;
  }
}
</style>
