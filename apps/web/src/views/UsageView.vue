<script setup lang="ts">
import type { UsageResponse } from '@nexus-kb/contracts';
import { onMounted, ref } from 'vue';
import { fetchUsage } from '@/api/usage';
import { ApiError } from '@/api/client';

const usage = ref<UsageResponse | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const now = new Date();
const dateRange = ref<[Date, Date]>([new Date(now.getTime() - 30 * 86400000), now]);
async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    usage.value = await fetchUsage(
      dateRange.value[0].toISOString(),
      dateRange.value[1].toISOString(),
    );
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '用量加载失败';
  } finally {
    loading.value = false;
  }
}
function percent(value: number | null): string {
  return value === null ? '暂无数据' : `${(value * 100).toFixed(1)}%`;
}
onMounted(load);
</script>
<template>
  <section class="usage-page" v-loading="loading">
    <div class="usage-intro">
      <div>
        <strong>近 30 天用量事实</strong>
        <p>基于当前租户查询审计聚合；Provider 未回传 token 或未配置价格时保持“暂无数据”。</p>
      </div>
      <div class="usage-actions">
        <el-date-picker
          v-model="dateRange"
          type="datetimerange"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
        />
        <el-button @click="load">查询</el-button>
      </div>
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
          <h2>Provider / 模型</h2>
          <el-table
            class="desktop-data-table"
            :data="usage.providers"
            empty-text="暂无 Provider 用量"
          >
            <el-table-column prop="kind" label="类型" fixed="left" />
            <el-table-column prop="provider" label="Provider" />
            <el-table-column prop="model" label="模型" />
            <el-table-column prop="requests" label="请求" />
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
          <div v-if="usage.providers.length" class="mobile-data-list" aria-label="Provider 用量">
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
                  <span>请求</span><strong>{{ provider.requests }}</strong>
                </div>
                <div>
                  <span>Token</span><strong>{{ provider.inputTokens ?? '暂无数据' }}</strong>
                </div>
                <div>
                  <span>估算成本</span><strong>
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
          <h2>部门请求分布</h2>
          <el-table
            class="desktop-data-table"
            :data="usage.departments"
            empty-text="暂无部门归属数据"
          >
            <el-table-column prop="department" label="部门" fixed="left" />
            <el-table-column prop="requests" label="查询次数" />
          </el-table>
          <div v-if="usage.departments.length" class="mobile-data-list" aria-label="部门请求分布">
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
