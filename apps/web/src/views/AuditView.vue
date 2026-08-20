<template>
  <section class="page">
    <div class="audit-toolbar">
      <div class="audit-toolbar__intro">
        <strong class="audit-toolbar__title">租户审计事件</strong>
        <div>
          <el-text>仅展示当前租户内经过最小披露处理的结构化记录。</el-text>
        </div>
      </div>
      <form
        v-if="!isMobile"
        class="audit-filter-form"
        aria-label="审计事件筛选"
        @submit.prevent="applyFilter"
      >
        <label>
          <span class="sr-only">事件类型</span>
          <el-select
            v-model="selectedType"
            class="audit-type-filter"
            clearable
            placeholder="全部事件类型"
          >
            <el-option
              v-for="[value, label] in typeOptions"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </label>
        <el-button native-type="submit">筛选</el-button>
        <el-button native-type="button" @click="resetFilter">重置</el-button>
      </form>
      <form
        v-else
        class="audit-filter-form audit-filter-form--mobile"
        aria-label="审计事件筛选"
        @submit.prevent
      >
        <el-select
          v-model="selectedType"
          class="audit-type-filter"
          clearable
          placeholder="全部事件类型"
          @change="applyFilter"
        >
          <el-option
            v-for="[value, label] in typeOptions"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <el-button native-type="button" @click="resetFilter">重置</el-button>
      </form>
    </div>

    <div class="kb-block-content kb-block-content--mobile-inset">
      <div v-if="errorMessage && !hasEvents" class="kb-error-state" role="alert">
        <strong class="kb-text--danger">无法加载审计事件</strong>
        <span>{{ errorMessage }}</span>
        <el-button @click="load()">重试</el-button>
      </div>

      <div
        v-else
        v-loading="loading"
        class="kb-block--flush kb-block-scroll"
        :class="!isMobile ? 'kb-block' : ''"
      >
        <template v-if="hasEvents">
          <el-table
            v-if="!isMobile"
            class="desktop-data-table"
            :data="events"
            row-key="id"
            height="100%"
          >
            <el-table-column type="expand">
              <template #default="scope">
                <div class="audit-details">
                  <div
                    v-for="attribute in visibleAuditAttributes(auditRow(scope.row))"
                    :key="attribute.label"
                    class="audit-detail-item"
                  >
                    <span class="audit-detail-label">{{ attribute.label }}</span>
                    <span class="audit-detail-value">{{ attribute.value }}</span>
                  </div>
                  <div class="audit-detail-item">
                    <span class="audit-detail-label">Trace ID</span>
                    <span class="audit-detail-value">
                      <code>{{ scope.row.traceId ?? '—' }}</code>
                    </span>
                  </div>
                  <div v-if="scope.row.ingestionJobId" class="audit-detail-item">
                    <span class="audit-detail-label">入库任务</span>
                    <span class="audit-detail-value">
                      <code>{{ scope.row.ingestionJobId }}</code>
                    </span>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="类型" min-width="110">
              <template #default="scope">{{ auditTypeLabels[auditRow(scope.row).type] }}</template>
            </el-table-column>
            <el-table-column label="操作" min-width="180">
              <template #default="scope">{{ auditEventLabel(auditRow(scope.row)) }}</template>
            </el-table-column>
            <el-table-column label="操作者" prop="actorUserId" min-width="100">
              <template #default="scope">{{ scope.row.actorUserId ?? '系统' }}</template>
            </el-table-column>
            <el-table-column label="资源" min-width="200" show-overflow-tooltip>
              <template #default="scope">{{ auditResource(auditRow(scope.row)) }}</template>
            </el-table-column>
            <el-table-column label="云端数据" min-width="82">
              <template #default="scope">{{ cloudEgressLabel(auditRow(scope.row)) }}</template>
            </el-table-column>
            <el-table-column label="Provider/模型" min-width="300" show-overflow-tooltip>
              <template #default="scope">{{ auditProvider(auditRow(scope.row)) }}</template>
            </el-table-column>
            <el-table-column label="结果" min-width="105">
              <template #default="scope">
                <el-tag
                  class="audit-outcome-tag"
                  :type="outcomeTagType(auditRow(scope.row).outcome)"
                >
                  {{ auditOutcomeLabel(auditRow(scope.row).outcome) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="时间" min-width="180">
              <template #default="scope">
                {{ new Date(scope.row.createdAt).toLocaleString() }}
              </template>
            </el-table-column>
          </el-table>
          <div v-else class="kb-block-list" aria-label="审计事件列表">
            <article v-for="event in events" :key="event.id" class="kb-block">
              <div class="kb-block-header">
                <strong class="kb-block-title">{{ auditEventLabel(event) }}</strong>
                <el-tag :type="outcomeTagType(event.outcome)">
                  {{ auditOutcomeLabel(event.outcome) }}
                </el-tag>
              </div>
              <div class="kb-data-fields">
                <div class="kb-data-field">
                  <span class="kb-data-field__label">时间</span>
                  <span class="kb-data-field__value">
                    {{ new Date(event.createdAt).toLocaleString() }}
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">操作者</span>
                  <span class="kb-data-field__value">
                    {{ event.actorUserId ?? '系统' }}
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">资源</span>
                  <span class="kb-data-field__value">{{ auditResource(event) }}</span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">云端数据</span>
                  <span class="kb-data-field__value">{{ cloudEgressLabel(event) }}</span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">Provider / 模型</span>
                  <span class="kb-data-field__value">{{ auditProvider(event) }}</span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">Trace ID</span>
                  <span class="kb-data-field__value">{{ event.traceId ?? '—' }}</span>
                </div>
              </div>
            </article>
          </div>
        </template>
        <el-empty
          v-else-if="!loading"
          class="kb-empty-state"
          description="当前筛选条件下暂无审计事件"
        />
      </div>

      <div v-if="errorMessage && hasEvents" class="kb-inline-error" role="alert">
        {{ errorMessage }}
      </div>
      <div v-if="pageCount > 1" class="kb-pagination">
        <el-pagination
          layout="total, prev, pager, next"
          :current-page="page"
          :page-count="pageCount"
          :total="total"
          @current-change="changePage"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { AuditEvent, AuditEventType, AuditQueryRequest } from '@nexus-kb/contracts';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useBreakpoint } from '@/composables/useBreakpoint';

import { listAuditEvents } from '@/api/audit';
import { ApiError } from '@/api/client';
import {
  auditEventLabel,
  auditOutcomeLabel,
  auditProvider,
  auditResource,
  auditTypeLabels,
  cloudEgressLabel,
  outcomeTagType,
  visibleAuditAttributes,
} from './audit-presentation';

const route = useRoute();
const router = useRouter();
const { isMobile } = useBreakpoint();
const events = ref<AuditEvent[]>([]);
const selectedType = ref<AuditEventType | ''>(
  typeof route.query.type === 'string' && route.query.type in auditTypeLabels
    ? (route.query.type as AuditEventType)
    : '',
);
const page = ref(1);
const pageCursors = ref<Array<string | undefined>>([undefined]);
const nextBefore = ref<string | null>(null);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const hasEvents = computed(() => events.value.length > 0);
const pageCount = computed(() => page.value + (nextBefore.value ? 1 : 0));
const typeOptions = Object.entries(auditTypeLabels) as Array<[AuditEventType, string]>;

function auditRow(row: unknown): AuditEvent {
  return row as AuditEvent;
}

function request(): Partial<AuditQueryRequest> {
  return {
    type: selectedType.value || undefined,
    before: pageCursors.value[page.value - 1],
    limit: 50,
  };
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await listAuditEvents(request());
    events.value = result.events;
    nextBefore.value = result.nextBefore;
    total.value = result.total;
    if (result.nextBefore) pageCursors.value[page.value] = result.nextBefore;
    else pageCursors.value.length = page.value;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '审计事件加载失败';
  } finally {
    loading.value = false;
  }
}

async function applyFilter(): Promise<void> {
  page.value = 1;
  pageCursors.value = [undefined];
  await router.replace({ query: selectedType.value ? { type: selectedType.value } : {} });
  await load();
}

async function resetFilter(): Promise<void> {
  selectedType.value = '';
  await applyFilter();
}

async function changePage(nextPage: number): Promise<void> {
  if (nextPage === page.value) return;
  page.value = nextPage;
  await load();
}

onMounted(() => load());
</script>

<style scoped>
.audit-toolbar {
  display: grid;
  align-items: center;
  gap: var(--kb-space-2);
  grid-template-columns: minmax(0, 1fr) auto;
}
.audit-toolbar__title {
  font-size: 17px;
}
.audit-filter-form {
  display: flex;
  align-items: center;
  gap: var(--kb-space-2);
}
.audit-type-filter {
  width: 220px;
}
.audit-outcome-tag {
  overflow-wrap: anywhere;
  height: auto;
  max-width: 100%;
  min-height: 24px;
  white-space: normal;
}
.audit-details {
  display: grid;
  gap: var(--kb-layout-gap);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: var(--kb-space-2) var(--kb-space-12);
  font-size: 14px;
}
.audit-detail-item {
  display: grid;
  gap: var(--kb-space-1);
}
.audit-detail-label {
  font-weight: bold;
}
.audit-detail-value {
  overflow-wrap: anywhere;
}
/* 响应式：紧凑布局（<1280px） */
@media (max-width: 1279px) {
  .audit-toolbar .el-text {
    display: none;
  }
}
/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .audit-toolbar__intro {
    display: none;
  }
  .audit-filter-form--mobile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-column: 1 / -1;
    width: 100%;
  }
  .audit-type-filter {
    width: 100%;
  }
}
</style>
