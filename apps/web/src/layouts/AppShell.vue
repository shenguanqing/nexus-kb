<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const auth = useAuthStore();
const isCollapsed = ref(false);
const pageTitle = computed(() => String(route.meta.title ?? '知枢'));
</script>

<template>
  <div class="app-shell" :class="{ 'is-collapsed': isCollapsed }">
    <header class="app-header">
      <RouterLink to="/ask" class="brand" aria-label="知枢 NexusKB 首页">
        <span class="brand-mark">N</span
        ><span class="brand-copy"><strong>知枢</strong><small>NexusKB</small></span>
      </RouterLink>
      <div class="header-context">
        <span class="status-dot" aria-hidden="true"></span>企业知识服务
      </div>
      <div class="user-summary">
        <span class="avatar" aria-hidden="true">{{
          auth.identity?.userId.slice(0, 1).toUpperCase()
        }}</span>
        <span
          ><strong>{{ auth.identity?.userId }}</strong
          ><small>{{ auth.identity?.department }} · {{ auth.identity?.tenantId }}</small></span
        >
      </div>
    </header>

    <aside class="app-sidebar">
      <nav aria-label="主导航">
        <RouterLink to="/ask"><span aria-hidden="true">✦</span><b>知识问答</b></RouterLink>
        <RouterLink v-if="auth.hasCapability('documents:read')" to="/documents"
          ><span aria-hidden="true">▤</span><b>文档管理</b></RouterLink
        >
        <RouterLink v-if="auth.hasCapability('documents:read')" to="/ingestion-jobs"
          ><span aria-hidden="true">⇄</span><b>入库任务</b></RouterLink
        >
        <RouterLink v-if="auth.hasCapability('audit:read')" to="/audit"
          ><span aria-hidden="true">⌁</span><b>审计中心</b></RouterLink
        >
        <RouterLink
          v-if="auth.hasCapability('system:read')"
          class="desktop-only-nav"
          to="/settings/providers"
          ><span aria-hidden="true">◇</span><b>模型 Provider</b></RouterLink
        >
        <RouterLink
          v-if="auth.hasCapability('system:read')"
          class="desktop-only-nav"
          to="/system/status"
          ><span aria-hidden="true">●</span><b>系统状态</b></RouterLink
        >
      </nav>
      <button
        class="collapse-button"
        type="button"
        :aria-label="isCollapsed ? '展开侧栏' : '折叠侧栏'"
        @click="isCollapsed = !isCollapsed"
      >
        {{ isCollapsed ? '›' : '‹' }}<span>{{ isCollapsed ? '' : '收起导航' }}</span>
      </button>
    </aside>

    <main class="app-main">
      <div v-if="route.path !== '/ask'" class="page-heading">
        <p>知枢 NexusKB</p>
        <h1>{{ pageTitle }}</h1>
      </div>
      <RouterView />
    </main>
  </div>
</template>
