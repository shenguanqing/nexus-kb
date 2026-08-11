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
const filtersVisible = ref(false);
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
  filtersVisible.value = false;
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

<template>
  <section class="audit-page">
    <div class="audit-toolbar">
      <div>
        <strong>租户审计事件</strong>
        <div class="text-block">仅展示当前租户内经过最小披露处理的结构化记录。</div>
      </div>
      <form
        v-if="!isMobile"
        class="audit-filter-form"
        aria-label="审计事件筛选"
        @submit.prevent="applyFilter"
      >
        <label>
          <span class="sr-only">事件类型</span>
          <el-select v-model="selectedType" clearable placeholder="全部事件类型">
            <el-option
              v-for="[value, label] in typeOptions"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </label>
        <el-button native-type="submit">筛选</el-button>
        <el-button class="reset-button" native-type="button" @click="resetFilter">重置</el-button>
      </form>
      <template v-else>
        <div class="mobile-filter-bar">
          <el-button class="filter-trigger" @click="filtersVisible = true">筛选</el-button>
        </div>
        <el-drawer
          v-model="filtersVisible"
          class="mobile-filter-drawer"
          direction="btt"
          size="72%"
          title="筛选审计事件"
          append-to-body
          :z-index="4000"
        >
          <form class="mobile-filter-form" aria-label="审计事件筛选" @submit.prevent="applyFilter">
            <el-select v-model="selectedType" clearable placeholder="全部事件类型">
              <el-option
                v-for="[value, label] in typeOptions"
                :key="value"
                :label="label"
                :value="value"
              />
            </el-select>
            <div class="mobile-filter-actions">
              <el-button native-type="button" @click="resetFilter">重置</el-button>
              <el-button type="primary" native-type="submit">筛选</el-button>
            </div>
          </form>
        </el-drawer>
      </template>
    </div>

    <div class="audit-content">
      <div v-if="errorMessage && !hasEvents" class="document-error" role="alert">
        <strong>无法加载审计事件</strong>
        <span>{{ errorMessage }}</span>
        <el-button @click="load()">重试</el-button>
      </div>

      <div v-else v-loading="loading" class="audit-table-wrap">
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
                  >
                    <span>{{ attribute.label }}</span>
                    <strong>{{ attribute.value }}</strong>
                  </div>
                  <div>
                    <span>Trace ID</span>
                    <strong>
                      <code>{{ scope.row.traceId ?? '—' }}</code>
                    </strong>
                  </div>
                  <div v-if="scope.row.ingestionJobId">
                    <span>入库任务</span>
                    <strong>
                      <code>{{ scope.row.ingestionJobId }}</code>
                    </strong>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="时间" min-width="150">
              <template #default="scope">
                {{ new Date(scope.row.createdAt).toLocaleString() }}
              </template>
            </el-table-column>
            <el-table-column label="类型" min-width="105">
              <template #default="scope">{{ auditTypeLabels[auditRow(scope.row).type] }}</template>
            </el-table-column>
            <el-table-column label="操作" min-width="140">
              <template #default="scope">{{ auditEventLabel(auditRow(scope.row)) }}</template>
            </el-table-column>
            <el-table-column label="操作者" prop="actorUserId" min-width="100">
              <template #default="scope">{{ scope.row.actorUserId ?? '系统' }}</template>
            </el-table-column>
            <el-table-column label="资源" min-width="115" show-overflow-tooltip>
              <template #default="scope">{{ auditResource(auditRow(scope.row)) }}</template>
            </el-table-column>
            <el-table-column label="云端数据" min-width="82">
              <template #default="scope">{{ cloudEgressLabel(auditRow(scope.row)) }}</template>
            </el-table-column>
            <el-table-column label="Provider/模型" min-width="240" show-overflow-tooltip>
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
          </el-table>
          <div v-else class="mobile-data-list" aria-label="审计事件列表">
            <article v-for="event in events" :key="event.id" class="mobile-data-card">
              <header>
                <strong>{{ auditEventLabel(event) }}</strong>
                <el-tag :type="outcomeTagType(event.outcome)">
                  {{ auditOutcomeLabel(event.outcome) }}
                </el-tag>
              </header>
              <div class="mobile-data-fields">
                <div>
                  <span>时间</span><strong>{{ new Date(event.createdAt).toLocaleString() }}</strong>
                </div>
                <div>
                  <span>操作者</span><strong>{{ event.actorUserId ?? '系统' }}</strong>
                </div>
                <div>
                  <span>资源</span><strong>{{ auditResource(event) }}</strong>
                </div>
                <div>
                  <span>云端数据</span><strong>{{ cloudEgressLabel(event) }}</strong>
                </div>
                <div>
                  <span>Provider / 模型</span><strong>{{ auditProvider(event) }}</strong>
                </div>
                <details class="audit-card-trace">
                  <summary>查看 Trace ID</summary>
                  <code>{{ event.traceId ?? '—' }}</code>
                </details>
              </div>
            </article>
          </div>
        </template>
        <el-empty v-else-if="!loading" description="当前筛选条件下暂无审计事件" />
      </div>

      <div v-if="errorMessage && hasEvents" class="audit-inline-error" role="alert">
        {{ errorMessage }}
      </div>
      <div v-if="pageCount > 1" class="list-pagination">
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
