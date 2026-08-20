<template>
  <section class="page">
    <div class="system-status-toolbar kb-status-toolbar">
      <div>
        <strong class="system-status-toolbar__title">系统运行状态</strong>
        <div>
          <el-text>展示安全摘要，不包含内部地址、凭据或异常堆栈。</el-text>
        </div>
      </div>
      <el-button :loading="loading" @click="load">重新检查</el-button>
    </div>

    <div class="page-content">
      <div v-if="errorMessage && !result" class="kb-error-state" role="alert">
        <strong class="kb-text--danger">无法加载系统状态</strong>
        <span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>

      <template v-else-if="result">
        <div class="system-overview kb-block" aria-live="polite">
          <div class="system-overview__item">
            <span class="system-overview__label">总体状态</span>
            <strong class="system-overview__value" :class="`is-${result.status}`">
              {{ result.status === 'ready' ? '运行正常' : '需要关注' }}
            </strong>
          </div>
          <div class="system-overview__item">
            <span class="system-overview__label">原始文档磁盘使用率</span>
            <strong class="system-overview__value">
              {{ formatDiskUsage(result.rawDocsDiskUsageRatio) }}
            </strong>
          </div>
          <div class="system-overview__item">
            <span class="system-overview__label">检查时间</span>
            <strong class="system-overview__value">
              {{ new Date(result.checkedAt).toLocaleString() }}
            </strong>
          </div>
        </div>

        <div class="component-grid">
          <article
            v-for="component in result.components"
            :key="component.id"
            class="component-card kb-block"
          >
            <span class="component-status" :class="`is-${component.status}`" aria-hidden="true">
            </span>
            <div>
              <strong>{{ systemComponentLabels[component.id] }}</strong>
              <div>
                <el-text>
                  {{
                    component.status === 'up'
                      ? '正常'
                      : healthReasonLabels[component.reason ?? 'unavailable']
                  }}
                </el-text>
              </div>
            </div>
          </article>
        </div>

        <section class="queue-summary kb-block">
          <div class="kb-block-header">
            <div class="kb-block-title">入库队列</div>
            <el-tag :type="result.ingestionQueue.status === 'up' ? 'success' : 'danger'">
              {{ result.ingestionQueue.status === 'up' ? '可用' : '不可用' }}
            </el-tag>
          </div>
          <div class="queue-data-list">
            <div class="queue-data-item">
              <span class="queue-data-label">等待</span>
              <strong class="queue-data-value">{{ result.ingestionQueue.waiting ?? '—' }}</strong>
            </div>
            <div class="queue-data-item">
              <span class="queue-data-label">处理中</span>
              <strong class="queue-data-value">{{ result.ingestionQueue.active ?? '—' }}</strong>
            </div>
            <div class="queue-data-item">
              <span class="queue-data-label">延迟</span>
              <strong class="queue-data-value">{{ result.ingestionQueue.delayed ?? '—' }}</strong>
            </div>
            <div class="queue-data-item">
              <span class="queue-data-label">失败</span>
              <strong class="queue-data-value">{{ result.ingestionQueue.failed ?? '—' }}</strong>
            </div>
            <div class="queue-data-item">
              <span class="queue-data-label">最老等待任务</span>
              <strong class="queue-data-value">
                {{ formatDuration(result.ingestionQueue.oldestWaitSeconds) }}
              </strong>
            </div>
          </div>
        </section>
      </template>

      <div v-else v-loading="loading" class="system-loading" aria-label="正在加载系统状态"></div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { SystemStatusResponse } from '@nexus-kb/contracts';
import { onMounted, ref } from 'vue';

import { ApiError } from '@/api/client';
import { getSystemStatus } from '@/api/system';
import {
  formatDiskUsage,
  formatDuration,
  healthReasonLabels,
  systemComponentLabels,
} from './system-presentation';

const result = ref<SystemStatusResponse | null>(null);
const loading = ref(false);
const errorMessage = ref('');

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    result.value = await getSystemStatus();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '系统状态加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.system-status-toolbar__title {
  font-size: 17px;
}
.system-overview {
  display: grid;
  gap: var(--kb-space-5);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.system-overview__item {
  display: grid;
  gap: var(--kb-space-2);
}
.system-overview__label {
  color: var(--kb-color-text-secondary);
  font-size: 13px;
}
.system-overview__value.is-ready {
  color: var(--kb-color-success);
}
.system-overview__value.is-degraded {
  color: var(--kb-color-warning);
}
.component-grid {
  display: grid;
  gap: var(--kb-space-4);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.component-card {
  display: flex;
  align-items: center;
  gap: var(--kb-layout-gap);
}
.component-status {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--kb-color-danger);
  box-shadow: 0 0 0 var(--kb-space-1) color-mix(in srgb, var(--kb-color-danger) 10%, transparent);
}
.component-status.is-up {
  background: var(--kb-color-success);
  box-shadow: 0 0 0 var(--kb-space-1) color-mix(in srgb, var(--kb-color-success) 10%, transparent);
}
.queue-data-list {
  display: grid;
  gap: var(--kb-space-4);
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0;
}
.queue-data-item {
  display: flex;
  justify-content: space-between;
  gap: var(--kb-space-1);
}
.queue-data-label {
  color: var(--kb-color-text-secondary);
}
.queue-data-value {
  overflow-wrap: anywhere;
  min-width: 0;
  text-align: center;
}
.system-loading {
  min-height: 260px;
}
/* 响应式：紧凑布局（<1280px） */
@media (max-width: 1279px) {
  .system-status-toolbar .el-text {
    display: none;
  }
  .component-grid {
    gap: var(--kb-layout-gap);
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .queue-data-list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
