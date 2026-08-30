<template>
  <main class="login-page">
    <section class="login-brand">
      <span class="kb-brand-mark">N</span>
      <div class="brand-text">知枢 NexusKB</div>
      <div class="login-text1">让知识<br />可信、可查、可追溯</div>
      <div class="login-text2">每个回答都有依据，每次访问都经过权限验证。</div>
    </section>
    <section class="login-panel">
      <div class="login-card kb-block kb-block--spacious">
        <div class="login-card__title kb-heading" role="heading" aria-level="1">登录知枢</div>
        <div>
          <div class="kb-text kb-text--secondary">使用已配置的身份方式继续访问。</div>
        </div>
        <form v-if="options?.passwordEnabled" class="login-form" @submit.prevent="submit">
          <label class="login-form-field kb-text kb-text--primary kb-text--strong">
            账号
            <el-input
              v-model="username"
              autocomplete="username"
              maxlength="64"
              placeholder="输入账号"
            />
          </label>
          <label class="login-form-field kb-text kb-text--primary kb-text--strong">
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
          <div v-if="errorMessage" class="login-error kb-text kb-text--danger" role="alert">
            {{ errorMessage }}
          </div>
          <el-button
            class="login-submit"
            native-type="submit"
            type="primary"
            size="large"
            :loading="loading"
          >
            登录
          </el-button>
        </form>
        <template v-else>
          <div v-if="errorMessage" class="login-error kb-text kb-text--danger" role="alert">
            {{ errorMessage }}
          </div>
          <el-button
            class="login-submit"
            type="primary"
            size="large"
            :disabled="!options?.oidc"
            :loading="loading"
            @click="startSsoLogin"
          >
            SSO 登录
          </el-button>
          <small
            v-if="options?.mode === 'development'"
            class="kb-text kb-text--sm kb-text--secondary"
          >
            本地开发模式会由服务端自动建立受控身份。
          </small>
          <small v-else class="kb-text kb-text--sm kb-text--secondary">
            请使用已配置的身份服务获取访问权限。
          </small>
        </template>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import type { AuthLoginOptions } from '@nexus-kb/contracts';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { fetchLoginOptions, loginWithPassword } from '@/api/auth';
import { ApiError } from '@/api/client';
import { beginOidcLogin, OidcLoginError } from '@/auth/oidc';
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

async function startSsoLogin(): Promise<void> {
  if (!options.value?.oidc) {
    errorMessage.value = '身份服务尚未完成配置';
    return;
  }
  loading.value = true;
  errorMessage.value = '';
  try {
    await beginOidcLogin(options.value.oidc, redirectTarget());
  } catch (error) {
    errorMessage.value = error instanceof OidcLoginError ? error.message : 'SSO 登录暂时不可用';
    loading.value = false;
  }
}

function redirectTarget(): string {
  return typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
    ? route.query.redirect
    : '/ask';
}
</script>

<style scoped>
.login-page {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  min-height: 100vh;
}
.login-brand {
  padding: clamp(var(--kb-space-8), 12vh, var(--kb-space-16))
    clamp(var(--kb-space-8), 10vw, var(--kb-space-20));
  color: var(--kb-color-on-brand);
  background: var(--kb-color-brand-surface);
}
.brand-text {
  margin-top: var(--kb-space-1);
  color: var(--kb-color-on-brand);
  font-weight: 700;
}
.login-text1 {
  margin-top: clamp(var(--kb-space-8), 14vh, var(--kb-space-20));
  font-size: clamp(40px, 5vw, 68px);
  line-height: 1.08;
}
.login-text2 {
  margin-top: var(--kb-space-2);
  color: var(--kb-color-brand-secondary);
}
.login-panel {
  display: grid;
  place-items: center;
  padding: var(--kb-space-8);
  background: var(--kb-color-canvas);
}
.login-card {
  display: flex;
  flex-direction: column;
  gap: var(--kb-space-4);
  width: min(390px, 100%);
}
.login-card__title {
  margin: 0;
  font-size: 30px;
}
.login-form {
  display: grid;
  gap: var(--kb-space-4);
}
.login-submit {
  width: 100%;
}
.login-form-field {
  display: grid;
  gap: var(--kb-space-2);
  font-size: 13px;
}
.login-error {
  margin: 0;
  font-size: 13px;
}
/* 响应式：紧凑布局（<1280px） */
@media (max-width: 1279px) {
  .login-page {
    grid-template-columns: 1fr;
  }
  .login-brand {
    display: none;
  }
}
</style>
