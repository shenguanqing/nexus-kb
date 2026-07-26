<script setup lang="ts">
import type { IngestionJob, IngestionJobListRequest } from '@nexus-kb/contracts';
import { ElMessage } from 'element-plus';
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/client';
import { listIngestionJobs, retryIngestionJob } from '@/api/ingestion';
import { ingestionJobsReturn } from '@/router/return-navigation';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const items = ref<IngestionJob[]>([]);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const retryingId = ref<string | null>(null);
const filters = reactive({
  status: typeof route.query.status === 'string' ? route.query.status : '',
  documentId: typeof route.query.documentId === 'string' ? route.query.documentId : '',
  page: Number(route.query.page) || 1,
  pageSize: Number(route.query.pageSize) || 20,
});
const canRetry = computed(() => auth.hasCapability('documents:write'));
const returnNavigation = computed(() => ingestionJobsReturn(route.query.returnTo));
let timer: number | undefined;
const runningStatuses = new Set([
  'queued',
  'converting',
  'parsing',
  'chunking',
  'policy_check',
  'embedding',
  'indexing',
]);
const stepLabels: Record<string, string> = {
  queued: '排队',
  converting: 'CAD 格式转换与解析',
  parsing: '解析',
  chunking: '分块与脱敏',
  policy_check: '出网策略检查',
  prepared: '本地准备完成',
  embedding: 'Embedding',
  indexing: '建立索引',
  completed: '完成',
  failed: '失败',
  policy_blocked: '策略阻止',
};
const statusOptions: Array<{
  value: NonNullable<IngestionJobListRequest['status']>;
  label: string;
}> = [
  { value: 'queued', label: '排队' },
  { value: 'converting', label: 'CAD 格式转换与解析' },
  { value: 'parsing', label: '解析' },
  { value: 'chunking', label: '分块与脱敏' },
  { value: 'policy_check', label: '出网策略检查' },
  { value: 'embedding', label: 'Embedding' },
  { value: 'indexing', label: '建立索引' },
  { value: 'completed', label: '完成' },
  { value: 'failed', label: '失败' },
  { value: 'policy_blocked', label: '策略阻止' },
];

function request(): Partial<IngestionJobListRequest> {
  return {
    status: (filters.status || undefined) as IngestionJobListRequest['status'],
    documentId: filters.documentId || undefined,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

async function load(quiet = false): Promise<void> {
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
  filters.page = 1;
  await syncAndLoad();
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
  filters.page = 1;
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
  const start = job.startedAt ? Date.parse(job.startedAt) : Date.parse(job.createdAt);
  const end = job.completedAt ? Date.parse(job.completedAt) : Date.now();
  const milliseconds = Math.max(0, end - start);
  return milliseconds < 1000 ? '< 1 秒' : `${Math.round(milliseconds / 1000)} 秒`;
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

function activeStep(job: IngestionJob): number {
  if (job.status === 'completed') return stepOrder.length;
  if (job.status === 'converting') return 1;

  const current = stepOrder.indexOf(job.step as (typeof stepOrder)[number]);
  if (current >= 0) return current;

  const checkpoint = stepOrder.indexOf(job.checkpoint as (typeof stepOrder)[number]);
  return checkpoint >= 0 ? checkpoint : 0;
}

onMounted(async () => {
  await load();
  timer = window.setInterval(() => {
    if (items.value.some((job) => runningStatuses.has(job.status))) void load(true);
  }, 5000);
});
onUnmounted(() => {
  if (timer !== undefined) window.clearInterval(timer);
});
</script>

<template>
  <section class="ingestion-page">
    <div class="task-controls">
      <div class="task-toolbar">
        <p>共 {{ total }} 个可访问任务</p>
        <form class="task-filter-form" aria-label="入库任务查询" @submit.prevent="applyFilters">
          <el-select v-model="filters.status" clearable placeholder="全部状态">
            <el-option
              v-for="option in statusOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
          <el-button native-type="submit">查询</el-button>
          <el-button class="reset-button" native-type="button" @click="resetFilters">
            重置
          </el-button>
        </form>
      </div>
    </div>
    <div class="task-content">
      <div v-if="errorMessage" class="document-error" role="alert">
        <strong>无法加载入库任务</strong><span>{{ errorMessage }}</span>
        <el-button @click="load()">重试</el-button>
      </div>
      <div v-else v-loading="loading" class="task-list">
        <article v-for="job in items" :key="job.id" class="task-card">
          <header>
            <div>
              <RouterLink
                :to="{
                  path: `/documents/${job.documentId}`,
                  query: { from: route.fullPath },
                }"
              >
                {{ job.sourceName }}
              </RouterLink>
              <span>v{{ job.version }} · {{ job.kind }}</span>
            </div>
            <el-tag
              :type="
                job.status === 'completed'
                  ? 'success'
                  : job.status === 'failed'
                    ? 'danger'
                    : job.status === 'policy_blocked'
                      ? 'warning'
                      : 'info'
              "
            >
              {{ stepLabels[job.status] ?? job.status }}
            </el-tag>
          </header>
          <el-progress
            v-if="job.status === 'converting'"
            :percentage="50"
            :indeterminate="true"
            :show-text="false"
          />
          <el-steps
            v-else
            simple
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
          <div class="data-list">
            <div>
              <span>当前步骤</span><strong>{{ stepLabels[job.step] ?? job.step }}</strong>
            </div>
            <div>
              <span>耗时</span><strong>{{ elapsed(job) }}</strong>
            </div>
            <div>
              <span>尝试次数</span><strong>{{ job.attempts }}</strong>
            </div>
            <div>
              <span>更新时间</span><strong>{{ new Date(job.updatedAt).toLocaleString() }}</strong>
            </div>
          </div>
          <div v-if="job.warnings.length" class="task-warning">
            <strong>Warning</strong>
            <ul>
              <li v-for="warning in job.warnings" :key="warning">{{ warning }}</li>
            </ul>
          </div>
          <div v-if="job.errorCode" class="task-error">
            <p>
              {{
                job.errorCode === 'DWG_CONVERSION_DISABLED'
                  ? 'CAD 转换服务暂不可用，请联系管理员或稍后重试'
                  : job.errorCode === 'FILE_SIGNATURE_MISMATCH'
                    ? '文件无效或版本不受支持'
                    : '任务处理失败，请查看技术详情'
              }}
            </p>
            <details>
              <summary>技术详情</summary>
              <code>{{ job.errorCode }}</code>
              <span>Trace ID：{{ job.traceId }}</span>
            </details>
            <el-button
              v-if="canRetry && job.status === 'failed' && job.retryable"
              :loading="retryingId === job.id"
              @click="retry(job)"
            >
              重试任务
            </el-button>
          </div>
        </article>
        <el-empty v-if="!loading && items.length === 0" description="暂无符合条件的入库任务" />
      </div>
      <el-pagination
        v-if="total > filters.pageSize"
        v-model:current-page="filters.page"
        v-model:page-size="filters.pageSize"
        layout="total, sizes, prev, pager, next"
        :total="total"
        :page-sizes="[20, 50, 100]"
        @change="syncAndLoad"
      />
    </div>
  </section>
</template>
