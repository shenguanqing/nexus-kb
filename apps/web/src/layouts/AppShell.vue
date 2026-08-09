<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { logout } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { useKnowledgeConversationStore } from '@/stores/knowledge-conversation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import {
  documentDetailReturn,
  documentPreviewReturn,
  ingestionJobsReturn,
  type ReturnNavigation,
} from '@/router/return-navigation';

interface NavigationItem {
  to: string;
  label: string;
  icon: string;
  capability?: 'documents:read' | 'audit:read' | 'access:read' | 'system:read';
  adminOnly?: boolean;
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const conversation = useKnowledgeConversationStore();
const { isMobile } = useBreakpoint();
const isCollapsed = ref(false);
const mobileMenuOpen = ref(false);
watch(
  isMobile,
  (mobile) => {
    if (mobile) isCollapsed.value = false;
    else mobileMenuOpen.value = false;
  },
  { immediate: true },
);
const pageTitle = computed(() => String(route.meta.title ?? '知枢'));
const pageSection = computed(() => {
  if (route.path.startsWith('/documents') || route.path === '/ingestion-jobs') return '知识资产';
  if (route.path === '/audit') return '合规审计';
  if (route.path.startsWith('/access')) return '访问管理';
  if (route.path.startsWith('/system') || route.path.startsWith('/settings')) return '系统管理';
  return '知识工作台';
});
const pageDescription = computed(() => {
  if (route.path === '/history') return '查看与管理个人历史问答记录';
  if (route.path === '/documents') return '管理已授权文档、索引状态与上传入口';
  if (/^\/documents\/[^/]+\/preview$/.test(route.path)) return '预览当前权限允许访问的文档内容';
  if (route.path === '/ingestion-jobs') return '跟踪文档解析、脱敏与索引进度';
  if (route.path === '/audit') return '查看当前租户的最小披露审计事件';
  if (route.path.startsWith('/access')) return '在服务端权限边界内管理访问策略';
  if (route.path.startsWith('/system') || route.path.startsWith('/settings'))
    return '查看运行配置与服务健康摘要';
  if (route.path.startsWith('/documents/')) return '查看文档版本、索引与处理状态';
  return '';
});
const primaryNavigation: NavigationItem[] = [
  { to: '/ask', label: '知识问答', icon: '✦' },
  { to: '/history', label: '问答历史', icon: '◷' },
  {
    to: '/documents',
    label: '文档管理',
    icon: '▤',
    capability: 'documents:read',
    adminOnly: true,
  },
  {
    to: '/ingestion-jobs',
    label: '入库任务',
    icon: '⇄',
    capability: 'documents:read',
    adminOnly: true,
  },
];
const managementNavigation: NavigationItem[] = [
  { to: '/audit', label: '审计中心', icon: '⌁', capability: 'audit:read', adminOnly: true },
  {
    to: '/access/users',
    label: '用户与角色',
    icon: '♙',
    capability: 'access:read',
    adminOnly: true,
  },
  {
    to: '/access/departments',
    label: '部门权限',
    icon: '⌘',
    capability: 'access:read',
    adminOnly: true,
  },
  {
    to: '/settings/providers',
    label: '模型 Provider',
    icon: '◇',
    capability: 'system:read',
    adminOnly: true,
  },
  {
    to: '/system/usage',
    label: '用量与成本',
    icon: '▥',
    capability: 'system:read',
    adminOnly: true,
  },
  {
    to: '/system/status',
    label: '系统状态',
    icon: '●',
    capability: 'system:read',
    adminOnly: true,
  },
];
function canShow(item: NavigationItem): boolean {
  if (item.adminOnly && !auth.identity?.roles.includes('admin')) return false;
  return item.capability === undefined || auth.hasCapability(item.capability);
}
const visiblePrimaryNavigation = computed(() => primaryNavigation.filter(canShow));
const visibleManagementNavigation = computed(() => managementNavigation.filter(canShow));
function closeMobileMenu(): void {
  mobileMenuOpen.value = false;
}
const returnNavigation = computed<ReturnNavigation | null>(() => {
  if (/^\/documents\/[^/]+\/preview$/.test(route.path)) {
    return documentPreviewReturn(route.query.from);
  }
  if (/^\/documents\/[^/]+\/chunks$/.test(route.path)) {
    return { to: `/documents/${String(route.params.id)}`, label: '返回文档详情' };
  }
  if (/^\/documents\/[^/]+$/.test(route.path)) return documentDetailReturn(route.query.from);
  if (route.path === '/ingestion-jobs') return ingestionJobsReturn(route.query.returnTo);
  return null;
});

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
  <div class="app-shell" :class="{ 'is-collapsed': isCollapsed && !isMobile }">
    <header class="app-header">
      <button
        class="mobile-menu-button"
        type="button"
        aria-label="打开导航菜单"
        @click="mobileMenuOpen = true"
      >
        ☰
      </button>
      <RouterLink to="/ask" class="brand" aria-label="知枢 NexusKB 首页">
        <span class="brand-mark">N</span>
        <span class="brand-copy"><strong>知枢</strong><small>NexusKB</small></span>
      </RouterLink>
      <div class="header-context">
        <span class="status-dot" aria-hidden="true"></span>企业知识服务
      </div>
      <div class="top-breadcrumb" aria-label="当前位置">
        <span>{{ pageSection }}</span>
        <i aria-hidden="true">/</i><strong>{{ pageTitle }}</strong>
      </div>
      <div class="user-summary">
        <span class="avatar" aria-hidden="true">
          {{ auth.identity?.userId.slice(0, 1).toUpperCase() }}
        </span>
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
        <div class="navigation-label">工作台</div>
        <RouterLink v-for="item in visiblePrimaryNavigation" :key="item.to" :to="item.to">
          <span aria-hidden="true">{{ item.icon }}</span>
          <b>{{ item.label }}</b>
        </RouterLink>
        <div v-if="visibleManagementNavigation.length > 0" class="navigation-label">管理</div>
        <RouterLink v-for="item in visibleManagementNavigation" :key="item.to" :to="item.to">
          <span aria-hidden="true">{{ item.icon }}</span>
          <b>{{ item.label }}</b>
        </RouterLink>
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
        <div class="page-heading-copy">
          <!-- <span class="page-heading-eyebrow">{{ pageSection }}</span> -->
          <div class="heading heading--h1" role="heading" aria-level="1">{{ pageTitle }}</div>
          <div v-if="pageDescription" class="text-block">{{ pageDescription }}</div>
        </div>
        <div class="page-heading-actions">
          <RouterLink v-if="returnNavigation" :to="returnNavigation.to" class="page-return-link">
            ← {{ returnNavigation.label }}
          </RouterLink>
        </div>
      </div>
      <RouterView />
    </main>

    <el-drawer
      v-if="isMobile"
      v-model="mobileMenuOpen"
      class="mobile-navigation-drawer"
      direction="ltr"
      size="min(86vw, 280px)"
      :with-header="false"
    >
      <div class="mobile-drawer-header">
        <RouterLink to="/ask" class="brand" aria-label="知枢 NexusKB 首页" @click="closeMobileMenu">
          <span class="brand-mark">N</span>
          <span class="brand-copy"><strong>知枢</strong><small>NexusKB</small></span>
        </RouterLink>
        <button
          type="button"
          class="mobile-drawer-close"
          aria-label="关闭导航菜单"
          @click="closeMobileMenu"
        >
          ×
        </button>
      </div>
      <nav class="mobile-drawer-nav" aria-label="移动端主导航">
        <div>工作台</div>
        <RouterLink
          v-for="item in visiblePrimaryNavigation"
          :key="item.to"
          :to="item.to"
          @click="closeMobileMenu"
        >
          <span aria-hidden="true">{{ item.icon }}</span>
          <b>{{ item.label }}</b>
        </RouterLink>
        <div v-if="visibleManagementNavigation.length > 0">管理</div>
        <RouterLink
          v-for="item in visibleManagementNavigation"
          :key="item.to"
          :to="item.to"
          @click="closeMobileMenu"
        >
          <span aria-hidden="true">{{ item.icon }}</span>
          <b>{{ item.label }}</b>
        </RouterLink>
      </nav>
    </el-drawer>
  </div>
</template>
