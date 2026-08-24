<template>
  <section class="kb-page" v-loading="loading">
    <form
      class="kb-control-toolbar"
      :class="{ 'usage-filter-form': !isMobile, 'usage-mobile-controls': isMobile }"
      aria-label="用量日期范围筛选"
      @submit.prevent="load"
    >
      <div class="usage-date-range-field">
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          single-panel
          :clearable="false"
          :editable="false"
          format="YYYY-MM-DD"
          placement="bottom-start"
          popper-class="usage-date-picker-popper"
          :popper-options="dateRangePopperOptions"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          @change="handleDateRangeChange"
        />
      </div>
      <div v-if="!isMobile" class="kb-filter-actions">
        <el-button native-type="submit">筛选</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>
      <el-button v-else @click="resetFilters">重置</el-button>
    </form>
    <div class="kb-page__content">
      <div v-if="errorMessage" class="kb-error-state" role="alert">
        <strong class="kb-text kb-text--danger">无法加载用量</strong><span>{{ errorMessage }}</span>
      </div>
      <template v-else-if="usage">
        <div class="kb-data-grid kb-data-grid--three kb-data-grid--flush">
          <div class="kb-block kb-data-grid__item">
            <span class="kb-text kb-text--sm kb-text--secondary">查询次数</span>
            <span class="kb-data-grid__value">
              {{ usage.totalQueries }}
            </span>
          </div>
          <div class="kb-block kb-data-grid__item">
            <span class="kb-text kb-text--sm kb-text--secondary">查询 P95</span>
            <span class="kb-data-grid__value">
              {{ usage.queryP95Ms === null ? emptyValueLabel : `${usage.queryP95Ms} ms` }}
            </span>
          </div>
          <div class="kb-block kb-data-grid__item">
            <span class="kb-text kb-text--sm kb-text--secondary">失败率</span>
            <span class="kb-data-grid__value">
              {{ percent(usage.failureRate) }}
            </span>
          </div>
        </div>
        <article class="usage-table-card kb-block">
          <div class="kb-block__header">
            <div class="kb-block__title kb-heading kb-heading--h4">Provider / 模型</div>
          </div>
          <div class="usage-table-note kb-text kb-text--secondary">
            “涉及问答”按当前租户查询审计聚合，一次问答可同时计入 Query Embedding 和
            LLM；它不是供应商账单请求数。Token 或价格事实不完整时保持“暂无数据”。
          </div>
          <el-table
            v-if="!isMobile"
            class="desktop-data-table"
            :data="usage.providers"
            empty-text="暂无 Provider 用量"
          >
            <el-table-column prop="kind" label="类型" fixed="left" min-width="100" />
            <el-table-column prop="provider" label="Provider" min-width="100" />
            <el-table-column prop="model" label="模型" min-width="200" />
            <el-table-column prop="requests" label="涉及问答" />
            <el-table-column label="输入 Token" min-width="100">
              <template #default="scope">{{ scope.row.inputTokens ?? emptyValueLabel }}</template>
            </el-table-column>
            <el-table-column label="输出 Token" min-width="100">
              <template #default="scope">{{ scope.row.outputTokens ?? emptyValueLabel }}</template>
            </el-table-column>
            <el-table-column label="估算成本">
              <template #default="scope">
                {{
                  scope.row.estimatedCostUsd === null
                    ? emptyValueLabel
                    : `$${scope.row.estimatedCostUsd.toFixed(4)}`
                }}
              </template>
            </el-table-column>
          </el-table>
          <div v-else-if="usage.providers.length" class="kb-block-list" aria-label="Provider 用量">
            <article
              v-for="provider in usage.providers"
              :key="`${provider.kind}-${provider.provider}-${provider.model}`"
              class="kb-block"
            >
              <div class="kb-block__header">
                <div class="kb-block__title kb-heading kb-heading--h4">
                  {{ provider.provider }} / {{ provider.model }}
                </div>
                <el-tag>{{ provider.kind }}</el-tag>
              </div>
              <div class="kb-data-fields">
                <div class="kb-data-field">
                  <span class="kb-data-field__label">涉及问答</span>
                  <span class="kb-data-field__value">{{ provider.requests }}</span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">输入 Token</span>
                  <span class="kb-data-field__value">
                    {{ provider.inputTokens ?? emptyValueLabel }}
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">输出 Token</span>
                  <span class="kb-data-field__value">
                    {{ provider.outputTokens ?? emptyValueLabel }}
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">估算成本</span>
                  <span class="kb-data-field__value">
                    {{
                      provider.estimatedCostUsd === null
                        ? emptyValueLabel
                        : `$${provider.estimatedCostUsd.toFixed(4)}`
                    }}
                  </span>
                </div>
              </div>
            </article>
          </div>
        </article>
        <article class="usage-table-card kb-block">
          <div class="kb-block__header">
            <div class="kb-block__title kb-heading kb-heading--h4">部门请求分布</div>
          </div>
          <el-table
            v-if="!isMobile"
            class="desktop-data-table"
            :data="usage.departments"
            empty-text="暂无部门归属数据"
          >
            <el-table-column prop="department" label="部门" fixed="left" />
            <el-table-column prop="requests" label="查询次数" />
          </el-table>
          <div v-else-if="usage.departments.length" class="kb-block-list" aria-label="部门请求分布">
            <article
              v-for="department in usage.departments"
              :key="department.department"
              class="kb-block"
            >
              <div class="kb-block__header">
                <div class="kb-block__title kb-heading kb-heading--h4">
                  {{ department.department }}
                </div>
              </div>
              <div class="kb-data-fields">
                <div class="kb-data-field">
                  <div class="kb-data-field__label">查询次数</div>
                  <div class="kb-data-field__value">
                    {{ department.requests }}
                  </div>
                </div>
              </div>
            </article>
          </div>
        </article>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { UsageResponse } from '@nexus-kb/contracts';
import type { Options } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { fetchUsage } from '@/api/usage';
import { ApiError } from '@/api/client';
import { useBreakpoint } from '@/composables/useBreakpoint';

const usage = ref<UsageResponse | null>(null);
const { isMobile } = useBreakpoint();
const loading = ref(false);
const errorMessage = ref('');
const emptyValueLabel = '暂无数据';
const now = new Date();
const startAt = ref(new Date(now.getTime() - 30 * 86400000));
const endAt = ref(now);
const dateRange = computed<[Date, Date]>({
  get: (): [Date, Date] => [startAt.value, endAt.value],
  set: (range: [Date, Date]) => {
    const [start, end] = range;
    startAt.value = start;
    endAt.value = end;
  },
});
const dateRangePopperOptions = {
  modifiers: [
    {
      name: 'matchReferenceWidth',
      enabled: true,
      phase: 'beforeWrite',
      requires: ['computeStyles'],
      fn: ({ state }) => {
        state.styles.popper = {
          ...state.styles.popper,
          width: `${state.rects.reference.width}px`,
        };
      },
      effect: ({ state }) => {
        state.elements.popper.style.width = `${state.elements.reference.getBoundingClientRect().width}px`;
        return () => {
          state.elements.popper.style.width = '';
        };
      },
    },
  ],
} satisfies Partial<Options>;
async function handleDateRangeChange(): Promise<void> {
  if (isMobile.value) {
    await load();
  }
}
async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    usage.value = await fetchUsage(
      startOfLocalDay(startAt.value).toISOString(),
      endOfLocalDay(endAt.value).toISOString(),
    );
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '用量加载失败';
  } finally {
    loading.value = false;
  }
}
async function resetFilters(): Promise<void> {
  const current = new Date();
  startAt.value = new Date(current.getTime() - 30 * 86400000);
  endAt.value = current;
  await load();
}
function percent(value: number | null): string {
  return value === null ? emptyValueLabel : `${(value * 100).toFixed(1)}%`;
}
function startOfLocalDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}
function endOfLocalDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(23, 59, 59, 999);
  return result;
}
onMounted(load);
</script>

<style scoped>
.usage-filter-form {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}
.usage-date-range-field {
  /* Element Plus daterange 上游标准宽度；内部 DatePicker 继续填满该受控容器。 */
  width: var(--el-date-editor-daterange-width, 350px);
}
.usage-table-note {
  margin-bottom: var(--kb-space-element);
}
/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .usage-mobile-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .usage-date-range-field {
    width: 100%;
    min-width: 0;
  }
}
</style>
