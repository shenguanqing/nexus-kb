<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { logout } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { useKnowledgeConversationStore } from '@/stores/knowledge-conversation';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const conversation = useKnowledgeConversationStore();
const isCollapsed = ref(false);
const pageTitle = computed(() => String(route.meta.title ?? '知枢'));

async function signOut(): Promise<void> {
  try {
    await logout();
  } finally {
    conversation.clear();
    auth.clear();
    await router.replace('/login');
  }
}
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
        <button
          v-if="auth.mode === 'password'"
          class="logout-button"
          type="button"
          aria-label="退出登录"
          @click="signOut"
        >
          退出
        </button>
      </div>
    </header>

    <aside class="app-sidebar">
      <nav aria-label="主导航">
        <RouterLink to="/ask"><span aria-hidden="true">✦</span><b>知识问答</b></RouterLink>
        <RouterLink to="/history"><span aria-hidden="true">◷</span><b>问答历史</b></RouterLink>
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
          v-if="auth.hasCapability('access:read')"
          class="desktop-only-nav access-nav"
          to="/access/users"
          ><span aria-hidden="true">♙</span><b>用户与角色</b></RouterLink
        >
        <RouterLink
          v-if="auth.hasCapability('access:read')"
          class="desktop-only-nav access-nav"
          to="/access/departments"
          ><span aria-hidden="true">⌘</span><b>部门权限</b></RouterLink
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
          to="/system/usage"
          ><span aria-hidden="true">▥</span><b>用量与成本</b></RouterLink
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

    <main class="app-main" :class="{ 'app-main--ask': route.path === '/ask' }">
      <div v-if="route.path !== '/ask'" class="page-heading">
        <p>知枢 NexusKB</p>
        <h1>{{ pageTitle }}</h1>
      </div>
      <RouterView />
    </main>
  </div>
</template>
