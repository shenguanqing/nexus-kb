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
    <div class="system-page-intro">
      <div>
        <strong>模型 Provider</strong>
        <p>只展示服务端脱敏后的运行配置，不读取或回显任何密钥。</p>
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
          <h2>{{ providerTitle(provider) }}</h2>
          <dl>
            <div>
              <dt>服务域名</dt>
              <dd>{{ provider.endpointHost ?? '—' }}</dd>
            </div>
            <div>
              <dt>区域</dt>
              <dd>{{ provider.region ?? '—' }}</dd>
            </div>
            <div>
              <dt>凭据状态</dt>
              <dd>{{ credentialLabel(provider.provider, provider.credentialConfigured) }}</dd>
            </div>
            <div v-if="provider.dimensions">
              <dt>向量维度</dt>
              <dd>{{ provider.dimensions }}</dd>
            </div>
            <div v-if="provider.fingerprint" class="provider-fingerprint">
              <dt>索引配置指纹</dt>
              <dd>
                <code>{{ provider.fingerprint }}</code>
              </dd>
            </div>
          </dl>
        </article>
        <el-empty v-if="result && result.providers.length === 0" description="暂无 Provider 配置" />
      </div>

      <div v-if="result" class="system-note">
        <strong>合成检查尚未配置</strong>
        <p>当前页面只确认配置是否完整，不会通过刷新页面触发付费模型调用。</p>
      </div>
    </div>
  </section>
</template>
