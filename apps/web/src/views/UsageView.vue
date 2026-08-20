<template>
  <section class="page" v-loading="loading">
    <form
      v-if="!isMobile"
      class="usage-toolbar usage-filter-form"
      aria-label="用量时间范围筛选"
      @submit.prevent="load"
    >
      <el-date-picker
        v-model="startAt"
        class="usage-start-filter"
        type="datetime"
        :clearable="false"
        placeholder="开始时间"
      />
      <el-date-picker
        v-model="endAt"
        class="usage-end-filter"
        type="datetime"
        :clearable="false"
        placeholder="结束时间"
      />
      <div class="filter-actions">
        <el-button native-type="submit">筛选</el-button>
        <el-button native-type="button" @click="resetFilters">重置</el-button>
      </div>
    </form>
    <div v-else class="usage-toolbar usage-toolbar--mobile">
      <el-button class="filter-trigger" @click="filtersVisible = true">筛选</el-button>
    </div>
    <el-drawer
      v-if="isMobile"
      v-model="filtersVisible"
      class="mobile-filter-drawer usage-filter-drawer"
      direction="btt"
      size="auto"
      title="筛选用量与成本"
      append-to-body
    >
      <form class="mobile-filter-form" aria-label="用量时间范围筛选" @submit.prevent="applyFilters">
        <el-date-picker
          v-model="startAt"
          type="datetime"
          :clearable="false"
          popper-class="usage-date-picker-popper"
          placeholder="开始时间"
        />
        <el-date-picker
          v-model="endAt"
          type="datetime"
          :clearable="false"
          popper-class="usage-date-picker-popper"
          placeholder="结束时间"
        />
        <div class="mobile-filter-actions">
          <el-button native-type="button" @click="resetFilters"> 重置 </el-button>
          <el-button type="primary" native-type="submit"> 筛选 </el-button>
        </div>
      </form>
    </el-drawer>
    <div class="page-content">
      <div v-if="errorMessage" class="kb-error-state" role="alert">
        <strong class="kb-text--danger">无法加载用量</strong><span>{{ errorMessage }}</span>
      </div>
      <template v-else-if="usage">
        <div class="usage-summary">
          <article class="usage-summary-card kb-block">
            <span class="usage-summary-card__label">查询次数</span>
            <strong class="usage-summary-card__value">{{ usage.totalQueries }}</strong>
          </article>
          <article class="usage-summary-card kb-block">
            <span class="usage-summary-card__label">查询 P95</span>
            <strong class="usage-summary-card__value">
              {{ usage.queryP95Ms === null ? emptyValueLabel : `${usage.queryP95Ms} ms` }}
            </strong>
          </article>
          <article class="usage-summary-card kb-block">
            <span class="usage-summary-card__label">失败率</span>
            <strong class="usage-summary-card__value">{{ percent(usage.failureRate) }}</strong>
          </article>
        </div>
        <article class="usage-table-card kb-block">
          <div class="kb-block-header">
            <div class="kb-block-title">Provider / 模型</div>
          </div>
          <div class="usage-table-note">
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
              <div class="kb-block-header">
                <span class="kb-block-title">{{ provider.provider }} / {{ provider.model }}</span>
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
          <div class="kb-block-header">
            <div class="kb-block-title">部门请求分布</div>
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
              <div class="kb-block-header">
                <div class="kb-block-title">{{ department.department }}</div>
              </div>
              <div class="kb-data-fields">
                <div class="kb-data-field">
                  <div class="kb-data-field__label">查询次数</div>
                  <div class="kb-data-field__value">{{ department.requests }}</div>
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
import { onMounted, ref } from 'vue';
import { fetchUsage } from '@/api/usage';
import { ApiError } from '@/api/client';
import { useBreakpoint } from '@/composables/useBreakpoint';

const usage = ref<UsageResponse | null>(null);
const { isMobile } = useBreakpoint();
const loading = ref(false);
const errorMessage = ref('');
const filtersVisible = ref(false);
const emptyValueLabel = '暂无数据';
const now = new Date();
const startAt = ref(new Date(now.getTime() - 30 * 86400000));
const endAt = ref(now);
async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    usage.value = await fetchUsage(startAt.value.toISOString(), endAt.value.toISOString());
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '用量加载失败';
  } finally {
    loading.value = false;
  }
}
async function applyFilters(): Promise<void> {
  await load();
  filtersVisible.value = false;
}
async function resetFilters(): Promise<void> {
  const current = new Date();
  startAt.value = new Date(current.getTime() - 30 * 86400000);
  endAt.value = current;
  await load();
  filtersVisible.value = false;
}
function percent(value: number | null): string {
  return value === null ? emptyValueLabel : `${(value * 100).toFixed(1)}%`;
}
onMounted(load);
</script>

<style scoped>
.usage-toolbar {
  display: grid;
  align-items: center;
  gap: var(--kb-space-2);
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
}
.usage-table-note {
  margin-bottom: var(--kb-space-element);
  color: var(--kb-color-text-secondary);
  line-height: 1.5;
}
.usage-summary {
  display: flex;
  gap: var(--kb-layout-gap);
}
.usage-summary-card {
  display: flex;
  flex-direction: column;
  gap: var(--kb-space-2);
  width: 100%;
}
.usage-summary-card__label {
  color: var(--kb-color-text-secondary);
}
.usage-summary-card__value {
  font-size: 20px;
}
/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .usage-toolbar--mobile {
    justify-items: end;
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
