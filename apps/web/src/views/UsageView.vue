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
function resetFilters(): void {
  const current = new Date();
  startAt.value = new Date(current.getTime() - 30 * 86400000);
  endAt.value = current;
}
function percent(value: number | null): string {
  return value === null ? '暂无数据' : `${(value * 100).toFixed(1)}%`;
}
onMounted(load);
</script>
<template>
  <section class="usage-page" v-loading="loading">
    <div class="usage-toolbar">
      <div class="usage-toolbar-intro">
        <strong>近 30 天用量事实</strong>
        <div class="text-block">
          基于当前租户查询审计聚合。“涉及问答”表示该问答使用了对应阶段，一次问答可同时计入 Query
          Embedding 和 LLM；它不是供应商账单请求数。当前 Embedding 配置即使尚无查询也会以 0
          次展示，Provider 未回传 token 或未配置价格时保持“暂无数据”。
        </div>
      </div>
      <form
        v-if="!isMobile"
        class="usage-filter-form"
        aria-label="用量时间范围筛选"
        @submit.prevent="load"
      >
        <el-date-picker
          v-model="startAt"
          type="datetime"
          :clearable="false"
          placeholder="开始时间"
        />
        <el-date-picker v-model="endAt" type="datetime" :clearable="false" placeholder="结束时间" />
        <el-button native-type="submit">筛选</el-button>
      </form>
      <template v-else>
        <div class="mobile-filter-bar usage-filter-bar">
          <el-button class="filter-trigger" @click="filtersVisible = true">筛选</el-button>
        </div>
        <el-drawer
          v-model="filtersVisible"
          class="mobile-filter-drawer usage-filter-drawer"
          direction="btt"
          size="72%"
          title="筛选用量与成本"
          append-to-body
          :z-index="4000"
        >
          <form
            class="mobile-filter-form"
            aria-label="用量时间范围筛选"
            @submit.prevent="applyFilters"
          >
            <el-date-picker
              v-model="startAt"
              type="datetime"
              :clearable="false"
              :teleported="false"
              placeholder="开始时间"
            />
            <el-date-picker
              v-model="endAt"
              type="datetime"
              :clearable="false"
              :teleported="false"
              placeholder="结束时间"
            />
            <div class="mobile-filter-actions">
              <el-button native-type="button" @click="resetFilters">重置</el-button>
              <el-button type="primary" native-type="submit">筛选</el-button>
            </div>
          </form>
        </el-drawer>
      </template>
    </div>
    <div class="page-content">
      <div v-if="errorMessage" class="document-error" role="alert">
        <strong>无法加载用量</strong><span>{{ errorMessage }}</span>
      </div>
      <template v-else-if="usage">
        <div class="usage-summary">
          <article>
            <span>查询次数</span><strong>{{ usage.totalQueries }}</strong>
          </article>
          <article>
            <span>查询 P95</span>
            <strong>{{ usage.queryP95Ms === null ? '暂无数据' : `${usage.queryP95Ms} ms` }}</strong>
          </article>
          <article>
            <span>失败率</span><strong>{{ percent(usage.failureRate) }}</strong>
          </article>
        </div>
        <article class="usage-table-card">
          <div class="heading heading--h2" role="heading" aria-level="2">Provider / 模型</div>
          <el-table
            v-if="!isMobile"
            class="desktop-data-table"
            :data="usage.providers"
            empty-text="暂无 Provider 用量"
          >
            <el-table-column prop="kind" label="类型" fixed="left" />
            <el-table-column prop="provider" label="Provider" />
            <el-table-column prop="model" label="模型" />
            <el-table-column prop="requests" label="涉及问答" />
            <el-table-column label="Token">
              <template #default="scope">{{ scope.row.inputTokens ?? '暂无数据' }}</template>
            </el-table-column>
            <el-table-column label="估算成本">
              <template #default="scope">
                {{
                  scope.row.estimatedCostUsd === null
                    ? '暂无数据'
                    : `$${scope.row.estimatedCostUsd.toFixed(4)}`
                }}
              </template>
            </el-table-column>
          </el-table>
          <div
            v-else-if="usage.providers.length"
            class="mobile-data-list"
            aria-label="Provider 用量"
          >
            <article
              v-for="provider in usage.providers"
              :key="`${provider.kind}-${provider.provider}-${provider.model}`"
              class="mobile-data-card"
            >
              <header>
                <strong>{{ provider.provider }} / {{ provider.model }}</strong
                ><el-tag>{{ provider.kind }}</el-tag>
              </header>
              <div class="mobile-data-fields">
                <div>
                  <span>涉及问答</span><strong>{{ provider.requests }}</strong>
                </div>
                <div>
                  <span>Token</span><strong>{{ provider.inputTokens ?? '暂无数据' }}</strong>
                </div>
                <div>
                  <span>估算成本</span
                  ><strong>
                    {{
                      provider.estimatedCostUsd === null
                        ? '暂无数据'
                        : `$${provider.estimatedCostUsd.toFixed(4)}`
                    }}
                  </strong>
                </div>
              </div>
            </article>
          </div>
        </article>
        <article class="usage-table-card">
          <div class="heading heading--h2" role="heading" aria-level="2">部门请求分布</div>
          <el-table
            v-if="!isMobile"
            class="desktop-data-table"
            :data="usage.departments"
            empty-text="暂无部门归属数据"
          >
            <el-table-column prop="department" label="部门" fixed="left" />
            <el-table-column prop="requests" label="查询次数" />
          </el-table>
          <div
            v-else-if="usage.departments.length"
            class="mobile-data-list"
            aria-label="部门请求分布"
          >
            <article
              v-for="department in usage.departments"
              :key="department.department"
              class="mobile-data-card"
            >
              <header>
                <strong>{{ department.department }}</strong>
              </header>
              <div class="mobile-data-fields">
                <div>
                  <span>查询次数</span><strong>{{ department.requests }}</strong>
                </div>
              </div>
            </article>
          </div>
        </article>
      </template>
    </div>
  </section>
</template>
