<script setup lang="ts">
import type { ProviderStatusResponse } from '@nexus-kb/contracts';
import { onMounted, ref } from 'vue';

import { ApiError } from '@/api/client';
import { getProviderStatuses } from '@/api/system';
import { providerKindLabels, providerTitle } from './system-presentation';

const result = ref<ProviderStatusResponse | null>(null);
const loading = ref(false);
const errorMessage = ref('');

function credentialLabel(provider: string | null, configured: boolean): string {
  if (provider === 'ollama') return '本地无需凭据';
  return configured ? '已配置' : '未配置';
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    result.value = await getProviderStatuses();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : 'Provider 状态加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="system-page">
    <div class="provider-toolbar">
      <div>
        <strong>模型 Provider</strong>
        <div class="text-block">只展示服务端脱敏后的运行配置，不读取或回显任何密钥。</div>
      </div>
      <el-button :loading="loading" @click="load">刷新状态</el-button>
    </div>

    <div class="page-content">
      <div v-if="errorMessage && !result" class="document-error" role="alert">
        <strong>无法加载 Provider 状态</strong>
        <span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>

      <div v-else v-loading="loading" class="provider-grid" aria-live="polite">
        <article
          v-for="provider in result?.providers ?? []"
          :key="provider.kind"
          class="provider-card"
        >
          <div class="provider-card-heading">
            <span>{{ providerKindLabels[provider.kind] }}</span>
            <el-tag :type="provider.configurationStatus === 'configured' ? 'success' : 'info'">
              {{ provider.configurationStatus === 'configured' ? '已配置' : '未启用' }}
            </el-tag>
          </div>
          <div class="heading heading--h2" role="heading" aria-level="2">
            {{ providerTitle(provider) }}
          </div>
          <div class="data-list">
            <div>
              <span>服务域名</span><strong>{{ provider.endpointHost ?? '—' }}</strong>
            </div>
            <div>
              <span>区域</span><strong>{{ provider.region ?? '—' }}</strong>
            </div>
            <div>
              <span>凭据状态</span>
              <strong>
                {{ credentialLabel(provider.provider, provider.credentialConfigured) }}
              </strong>
            </div>
            <div v-if="provider.dimensions">
              <span>向量维度</span><strong>{{ provider.dimensions }}</strong>
            </div>
            <div v-if="provider.fingerprint" class="provider-fingerprint">
              <span>索引配置指纹</span>
              <strong>
                <code>{{ provider.fingerprint }}</code>
              </strong>
            </div>
          </div>
        </article>
        <el-empty v-if="result && result.providers.length === 0" description="暂无 Provider 配置" />
      </div>

      <div v-if="result" class="system-note">
        <strong>合成检查尚未配置</strong>
        <div class="text-block">当前页面只确认配置是否完整，不会通过刷新页面触发付费模型调用。</div>
      </div>
    </div>
  </section>
</template>
