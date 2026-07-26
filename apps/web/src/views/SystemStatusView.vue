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

<template>
  <section class="system-page">
    <div class="system-page-intro">
      <div>
        <strong>系统运行状态</strong>
        <p>展示安全摘要，不包含内部地址、凭据或异常堆栈。</p>
      </div>
      <el-button :loading="loading" @click="load">重新检查</el-button>
    </div>

    <div class="page-content">
      <div v-if="errorMessage && !result" class="document-error" role="alert">
        <strong>无法加载系统状态</strong>
        <span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>

      <template v-else-if="result">
        <div class="system-overview" aria-live="polite">
          <div>
            <span>总体状态</span>
            <strong :class="`is-${result.status}`">
              {{ result.status === 'ready' ? '运行正常' : '需要关注' }}
            </strong>
          </div>
          <div>
            <span>原始文档磁盘使用率</span>
            <strong>{{ formatDiskUsage(result.rawDocsDiskUsageRatio) }}</strong>
          </div>
          <div>
            <span>检查时间</span>
            <strong>{{ new Date(result.checkedAt).toLocaleString() }}</strong>
          </div>
        </div>

        <div class="component-grid">
          <article
            v-for="component in result.components"
            :key="component.id"
            class="component-card"
          >
            <span class="component-status" :class="`is-${component.status}`" aria-hidden="true">
            </span>
            <div>
              <strong>{{ systemComponentLabels[component.id] }}</strong>
              <p>
                {{
                  component.status === 'up'
                    ? '正常'
                    : healthReasonLabels[component.reason ?? 'unavailable']
                }}
              </p>
            </div>
          </article>
        </div>

        <section class="queue-summary" aria-labelledby="queue-title">
          <div>
            <h2 id="queue-title">入库队列</h2>
            <el-tag :type="result.ingestionQueue.status === 'up' ? 'success' : 'danger'">
              {{ result.ingestionQueue.status === 'up' ? '可用' : '不可用' }}
            </el-tag>
          </div>
          <div class="data-list">
            <div>
              <span>等待</span><strong>{{ result.ingestionQueue.waiting ?? '—' }}</strong>
            </div>
            <div>
              <span>处理中</span><strong>{{ result.ingestionQueue.active ?? '—' }}</strong>
            </div>
            <div>
              <span>延迟</span><strong>{{ result.ingestionQueue.delayed ?? '—' }}</strong>
            </div>
            <div>
              <span>失败</span><strong>{{ result.ingestionQueue.failed ?? '—' }}</strong>
            </div>
            <div>
              <span>最老等待任务</span><strong>{{ formatDuration(result.ingestionQueue.oldestWaitSeconds) }}</strong>
            </div>
          </div>
        </section>
      </template>

      <div v-else v-loading="loading" class="system-loading" aria-label="正在加载系统状态"></div>
    </div>
  </section>
</template>
