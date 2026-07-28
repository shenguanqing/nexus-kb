<script setup lang="ts">
import type { AuthLoginOptions } from '@nexus-kb/contracts';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { fetchLoginOptions, loginWithPassword } from '@/api/auth';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const options = ref<AuthLoginOptions | null>(null);
const username = ref('');
const password = ref('');
const loading = ref(false);
const errorMessage = ref('');

onMounted(async () => {
  try {
    options.value = await fetchLoginOptions();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '登录服务暂时不可用';
  }
});

async function submit(): Promise<void> {
  if (!username.value.trim() || !password.value) {
    errorMessage.value = '请输入账号和密码';
    return;
  }
  loading.value = true;
  errorMessage.value = '';
  try {
    auth.setSession(
      await loginWithPassword({ username: username.value.trim(), password: password.value }),
    );
    password.value = '';
    const redirect =
      typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
        ? route.query.redirect
        : '/ask';
    await router.replace(redirect);
  } catch (error) {
    password.value = '';
    errorMessage.value = error instanceof ApiError ? error.message : '登录失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-brand">
      <span class="brand-mark large">N</span>
      <div class="text-block">知枢 NexusKB</div>
      <div class="heading heading--h1" role="heading" aria-level="1">
        让企业知识<br />可信、可查、可追溯
      </div>
      <div class="text-block">每个回答都有依据，每次访问都经过权限验证。</div>
    </section>
    <section class="login-panel">
      <div class="login-card">
        <span class="eyebrow">企业知识中心</span>
        <div class="heading heading--h2" role="heading" aria-level="2">登录知枢</div>
        <div class="text-block">使用组织批准的身份服务继续访问。</div>
        <form v-if="options?.passwordEnabled" class="login-form" @submit.prevent="submit">
          <label>
            账号
            <el-input
              v-model="username"
              autocomplete="username"
              maxlength="64"
              placeholder="输入账号"
            />
          </label>
          <label>
            密码
            <el-input
              v-model="password"
              type="password"
              show-password
              autocomplete="current-password"
              maxlength="256"
              placeholder="输入密码"
            />
          </label>
          <div v-if="errorMessage" class="login-error text-block" role="alert">
            {{ errorMessage }}
          </div>
          <el-button native-type="submit" type="primary" size="large" :loading="loading">
            登录
          </el-button>
        </form>
        <template v-else>
          <div v-if="errorMessage" class="login-error text-block" role="alert">
            {{ errorMessage }}
          </div>
          <el-button type="primary" size="large" disabled>企业 SSO 登录</el-button>
          <small v-if="options?.mode === 'development'">
            本地开发模式会由服务端自动建立受控身份。
          </small>
          <small v-else>请使用组织批准的身份服务获取访问权限。</small>
        </template>
      </div>
    </section>
  </main>
</template>
