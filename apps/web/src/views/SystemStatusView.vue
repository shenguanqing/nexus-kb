<template>
  <section class="kb-page">
    <div class="kb-status-toolbar">
      <div>
        <div class="kb-heading kb-heading--h1" role="heading" aria-level="1">系统运行状态</div>
        <div class="system-status-toolbar__description kb-text kb-text--secondary">
          展示安全摘要，不包含内部地址、凭据或异常堆栈。
        </div>
      </div>
      <el-button :loading="loading" @click="load">重新检查</el-button>
    </div>

    <div class="kb-page__content">
      <div v-if="errorMessage && !result" class="kb-error-state" role="alert">
        <strong class="kb-text kb-text--danger">无法加载系统状态</strong>
        <span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>

      <template v-else-if="result">
        <div class="kb-data-grid kb-data-grid--three kb-data-grid--flush" aria-live="polite">
          <div class="kb-block kb-data-grid__item">
            <span class="kb-text kb-text--sm kb-text--secondary">总体状态</span>
            <span
              class="kb-data-grid__value"
              :class="result.status === 'ready' ? 'kb-text--success' : 'kb-text--warning'"
            >
              {{ result.status === 'ready' ? '运行正常' : '需要关注' }}
            </span>
          </div>
          <div class="kb-block kb-data-grid__item">
            <span class="kb-text kb-text--sm kb-text--secondary">原始文档磁盘使用率</span>
            <span class="kb-data-grid__value">
              {{ formatDiskUsage(result.rawDocsDiskUsageRatio) }}
            </span>
          </div>
          <div class="kb-block kb-data-grid__item">
            <span class="kb-text kb-text--sm kb-text--secondary">检查时间</span>
            <span class="kb-data-grid__value">
              {{ new Date(result.checkedAt).toLocaleString() }}
            </span>
          </div>
        </div>

        <div class="kb-data-grid kb-data-grid--three kb-data-grid--flush">
          <article
            v-for="component in result.components"
            :key="component.id"
            class="system-component-card kb-block"
          >
            <span
              class="system-component-status"
              :class="`is-${component.status}`"
              aria-hidden="true"
            >
            </span>
            <div class="kb-data-grid__item">
              <div class="kb-heading kb-heading--h2" role="heading" aria-level="2">
                {{ systemComponentLabels[component.id] }}
              </div>
              <span class="kb-text kb-text--secondary">
                {{
                  component.status === 'up'
                    ? '正常'
                    : healthReasonLabels[component.reason ?? 'unavailable']
                }}
              </span>
            </div>
          </article>
        </div>

        <section class="kb-block">
          <div class="kb-block__header">
            <div class="kb-block__title kb-heading kb-heading--h4">入库队列</div>
            <el-tag :type="result.ingestionQueue.status === 'up' ? 'success' : 'danger'">
              {{ result.ingestionQueue.status === 'up' ? '可用' : '不可用' }}
            </el-tag>
          </div>
          <div class="kb-data-grid kb-data-grid--five kb-data-grid--flush">
            <div class="kb-data-grid__item">
              <span class="kb-text kb-text--sm kb-text--secondary">等待</span>
              <span class="kb-data-grid__value">{{ result.ingestionQueue.waiting ?? '—' }}</span>
            </div>
            <div class="kb-data-grid__item">
              <span class="kb-text kb-text--sm kb-text--secondary">处理中</span>
              <span class="kb-data-grid__value">{{ result.ingestionQueue.active ?? '—' }}</span>
            </div>
            <div class="kb-data-grid__item">
              <span class="kb-text kb-text--sm kb-text--secondary">延迟</span>
              <span class="kb-data-grid__value">{{ result.ingestionQueue.delayed ?? '—' }}</span>
            </div>
            <div class="kb-data-grid__item">
              <span class="kb-text kb-text--sm kb-text--secondary">失败</span>
              <span class="kb-data-grid__value">{{ result.ingestionQueue.failed ?? '—' }}</span>
            </div>
            <div class="kb-data-grid__item">
              <span class="kb-text kb-text--sm kb-text--secondary">最老等待任务</span>
              <span class="kb-data-grid__value">
                {{ formatDuration(result.ingestionQueue.oldestWaitSeconds) }}
              </span>
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
.system-component-card {
  display: grid;
  align-items: center;
  gap: var(--kb-layout-gap);
  grid-template-columns: auto minmax(0, 1fr);
}
.system-component-status {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--kb-color-danger);
  box-shadow: 0 0 0 var(--kb-space-1) color-mix(in srgb, var(--kb-color-danger) 10%, transparent);
}
.system-component-status.is-up {
  background: var(--kb-color-success);
  box-shadow: 0 0 0 var(--kb-space-1) color-mix(in srgb, var(--kb-color-success) 10%, transparent);
}
.system-loading {
  min-height: 260px;
}
/* 响应式：紧凑布局（<1280px） */
@media (max-width: 1279px) {
  .system-status-toolbar__description {
    display: none;
  }
}
</style>
