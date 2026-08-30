<template>
  <main class="oidc-callback-page">
    <section class="oidc-callback-card kb-block kb-block--spacious" aria-live="polite">
      <template v-if="errorMessage">
        <div class="kb-heading kb-heading--h3" role="heading" aria-level="1">SSO 登录未完成</div>
        <div class="kb-text kb-text--secondary">{{ errorMessage }}</div>
        <el-button type="primary" @click="returnToLogin">返回登录页</el-button>
      </template>
      <template v-else>
        <div class="kb-heading kb-heading--h3" role="heading" aria-level="1">正在完成登录</div>
        <div class="kb-text kb-text--secondary">正在验证身份服务返回的信息，请稍候。</div>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { fetchLoginOptions } from '@/api/auth';
import {
  clearBearerAccessToken,
  completeOidcLogin,
  OidcLoginError,
  setBearerAccessToken,
} from '@/auth/oidc';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const errorMessage = ref('');

onMounted(async () => {
  try {
    const options = await fetchLoginOptions();
    if (options.mode !== 'oidc' || !options.oidc) {
      throw new OidcLoginError('当前环境未启用 SSO 登录');
    }
    const result = await completeOidcLogin(
      options.oidc,
      new URLSearchParams(window.location.search),
    );
    setBearerAccessToken(result.accessToken);
    await auth.loadSession();
    if (!auth.isAuthenticated) throw new OidcLoginError('身份服务返回的凭证无效或已过期');
    await router.replace(result.returnTo);
  } catch (error) {
    clearBearerAccessToken();
    auth.clear();
    errorMessage.value =
      error instanceof OidcLoginError ? error.message : 'SSO 登录暂时不可用，请稍后重试';
  }
});

async function returnToLogin(): Promise<void> {
  await router.replace('/login');
}
</script>

<style scoped>
.oidc-callback-page {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: var(--kb-space-8);
  background: var(--kb-color-canvas);
}
.oidc-callback-card {
  display: grid;
  gap: var(--kb-layout-gap);
  width: min(420px, 100%);
}
</style>
