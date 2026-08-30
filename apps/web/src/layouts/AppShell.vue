<template>
  <div class="app-shell">
    <header class="app-header">
      <el-button
        class="mobile-menu-trigger"
        :icon="Expand"
        text
        circle
        aria-label="打开导航菜单"
        @click="mobileSidebarOpen = true"
      >
      </el-button>
      <RouterLink
        v-if="isMobile && returnNavigation"
        class="mobile-return-trigger"
        :to="returnNavigation.to"
        :aria-label="returnNavigation.label"
        :title="returnNavigation.label"
      >
        <el-icon><ArrowLeft /></el-icon>
      </RouterLink>
      <RouterLink to="/ask" class="brand" aria-label="知枢 NexusKB 首页">
        <span class="kb-brand-mark">N</span>
        <span class="brand-copy">
          <strong class="brand-name">知枢</strong>
          <small class="brand-product">NexusKB</small>
        </span>
      </RouterLink>
      <strong class="mobile-page-title">{{ pageTitle }}</strong>
      <div class="header-context"><span class="status-dot" aria-hidden="true"></span>知识服务</div>
      <el-breadcrumb class="top-breadcrumb" separator="/" aria-label="当前位置">
        <el-breadcrumb-item>{{ pageSection }}</el-breadcrumb-item>
        <el-breadcrumb-item>{{ pageTitle }}</el-breadcrumb-item>
      </el-breadcrumb>
      <div class="user-summary">
        <span class="avatar" aria-hidden="true">
          {{ auth.identity?.userId.slice(0, 1).toUpperCase() }}
        </span>
        <span class="user-details">
          <strong>{{ auth.identity?.userId }}</strong>
          <small class="user-context">
            {{ auth.identity?.department }} · {{ auth.identity?.tenantId }}</small
          >
        </span>
        <div v-if="!isMobile" class="user-summary__actions">
          <el-dropdown placement="bottom-end" trigger="click" @command="setThemeMode">
            <el-button
              class="theme-toggle"
              text
              circle
              :icon="isDark ? Sunny : Moon"
              :aria-label="`主题：${themeMode === 'system' ? '跟随系统' : isDark ? '深色模式' : '浅色模式'}`"
              title="主题设置"
            />
            <template #dropdown>
              <el-dropdown-menu aria-label="主题设置">
                <el-dropdown-item command="system" :disabled="themeMode === 'system'">
                  跟随系统
                </el-dropdown-item>
                <el-dropdown-item command="light" :disabled="themeMode === 'light'">
                  浅色模式
                </el-dropdown-item>
                <el-dropdown-item command="dark" :disabled="themeMode === 'dark'">
                  深色模式
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button
            v-if="auth.mode === 'password'"
            class="logout-button"
            text
            aria-label="退出登录"
            @click="signOut"
          >
            退出
          </el-button>
        </div>
      </div>
    </header>

    <aside class="app-sidebar">
      <nav v-if="isDesktop" class="sidebar-navigation" aria-label="主导航">
        <section
          v-for="group in visibleNavigationGroups"
          :key="group.id"
          class="navigation-group"
          :aria-label="group.label"
        >
          <div class="navigation-label">{{ group.label }}</div>
          <RouterLink
            v-for="item in group.items"
            :key="item.to"
            class="sidebar-navigation-link"
            :class="{ 'is-active': activeNavigation === item.to }"
            :to="item.to"
            :aria-current="activeNavigation === item.to ? 'page' : undefined"
          >
            <span class="sidebar-navigation-icon" aria-hidden="true">
              <AppNavIcon :name="item.icon" />
            </span>
            <span class="sidebar-navigation-label">{{ item.label }}</span>
          </RouterLink>
        </section>
      </nav>
      <nav
        v-else-if="isTablet"
        class="sidebar-navigation tablet-group-navigation"
        aria-label="主导航分组"
      >
        <section
          v-for="group in visibleNavigationGroups"
          :key="group.id"
          class="tablet-navigation-group"
        >
          <el-tooltip
            v-for="item in group.items"
            :key="item.to"
            :content="item.label"
            effect="light"
            placement="right"
            :show-after="0"
            :hide-after="0"
          >
            <RouterLink
              class="sidebar-navigation-link tablet-navigation-link"
              :class="{ 'is-active': activeNavigation === item.to }"
              :to="item.to"
              :aria-label="item.label"
              :aria-current="activeNavigation === item.to ? 'page' : undefined"
            >
              <AppNavIcon :name="item.icon" />
            </RouterLink>
          </el-tooltip>
        </section>
      </nav>
    </aside>

    <main class="app-main">
      <el-page-header v-if="route.path !== '/ask' && !isMobile" class="kb-page-header">
        <template #content>
          <div v-if="!isMobile" class="kb-title-group">
            <div class="kb-heading kb-heading--h1" role="heading" aria-level="1">
              {{ pageTitle }}
            </div>
            <div v-if="pageDescription" class="kb-text kb-text--secondary">
              {{ pageDescription }}
            </div>
          </div>
        </template>
        <template #extra>
          <div class="kb-action-group">
            <RouterLink v-if="returnNavigation" :to="returnNavigation.to" class="page-return-link">
              <el-button>{{ returnNavigation.label }}</el-button>
            </RouterLink>
          </div>
        </template>
      </el-page-header>
      <RouterView />
    </main>

    <el-drawer
      v-if="isMobile"
      v-model="mobileSidebarOpen"
      class="mobile-navigation-drawer"
      direction="ltr"
      size="min(84vw, 280px)"
      title="主导航"
      :show-close="false"
      append-to-body
    >
      <template #header="{ close, titleId, titleClass }">
        <div :id="titleId" :class="[titleClass, 'mobile-sidebar-header']">
          <div class="mobile-sidebar-header__top">
            <RouterLink
              to="/ask"
              class="mobile-sidebar-brand"
              aria-label="知枢 NexusKB 首页"
              @click="closeMobileSidebar"
            >
              <span class="kb-brand-mark">N</span>
              <span class="brand-copy">
                <strong class="brand-name">知枢</strong>
                <small class="brand-product">NexusKB</small>
              </span>
            </RouterLink>
            <div class="mobile-sidebar-header__actions">
              <el-dropdown placement="bottom-end" trigger="click" @command="setThemeMode">
                <el-button
                  class="theme-toggle"
                  text
                  circle
                  :icon="isDark ? Sunny : Moon"
                  :aria-label="`主题：${themeMode === 'system' ? '跟随系统' : isDark ? '深色模式' : '浅色模式'}`"
                  title="主题设置"
                />
                <template #dropdown>
                  <el-dropdown-menu aria-label="主题设置">
                    <el-dropdown-item command="system" :disabled="themeMode === 'system'">
                      跟随系统
                    </el-dropdown-item>
                    <el-dropdown-item command="light" :disabled="themeMode === 'light'">
                      浅色模式
                    </el-dropdown-item>
                    <el-dropdown-item command="dark" :disabled="themeMode === 'dark'">
                      深色模式
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button
                :icon="Close"
                circle
                aria-label="关闭导航菜单"
                @click="close"
              >
              </el-button>
            </div>
          </div>
          <div class="mobile-sidebar-identity">
            <span class="avatar mobile-sidebar-identity__avatar" aria-hidden="true">
              {{ auth.identity?.userId.slice(0, 1).toUpperCase() }}
            </span>
            <span class="mobile-sidebar-identity__copy">
              <strong class="mobile-sidebar-identity__user">{{ auth.identity?.userId }}</strong>
              <small class="mobile-sidebar-identity__context">
                {{ auth.identity?.department }}
              </small>
            </span>
          </div>
        </div>
      </template>
      <nav class="mobile-sidebar-navigation" aria-label="移动端主导航">
        <section
          v-for="group in visibleNavigationGroups"
          :key="group.id"
          class="navigation-group"
          :aria-label="group.label"
        >
          <div class="navigation-label">{{ group.label }}</div>
          <RouterLink
            v-for="item in group.items"
            :key="item.to"
            class="sidebar-navigation-link"
            :class="{ 'is-active': activeNavigation === item.to }"
            :to="item.to"
            :aria-current="activeNavigation === item.to ? 'page' : undefined"
            @click="closeMobileSidebar"
          >
            <span class="sidebar-navigation-icon" aria-hidden="true">
              <AppNavIcon :name="item.icon" />
            </span>
            <span class="sidebar-navigation-label">{{ item.label }}</span>
          </RouterLink>
        </section>
      </nav>
      <div v-if="auth.mode === 'password'" class="mobile-sidebar-footer">
        <el-button class="mobile-sidebar-logout" @click="signOut">退出登录 </el-button>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft, Close, Expand, Moon, Sunny } from '@element-plus/icons-vue';
import { computed, ref } from 'vue';
import AppNavIcon, { type NavIconName } from '@/components/common/AppNavIcon.vue';
import { useRoute, useRouter } from 'vue-router';
import { logout } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { useKnowledgeConversationStore } from '@/stores/knowledge-conversation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useTheme } from '@/composables/useTheme';
import type { NavigationTarget } from '@/router/navigation';
import {
  documentDetailReturn,
  documentPreviewReturn,
  historyDetailReturn,
  ingestionJobsReturn,
  type ReturnNavigation,
} from '@/router/return-navigation';

interface NavigationItem {
  to: NavigationTarget;
  label: string;
  icon: NavIconName;
  capability?: 'documents:read' | 'audit:read' | 'access:read' | 'system:read';
  adminOnly?: boolean;
}

interface NavigationGroup {
  id: 'ask' | 'knowledge' | 'security' | 'system';
  label: string;
  items: NavigationItem[];
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const conversation = useKnowledgeConversationStore();
const { isDesktop, isMobile, isTablet } = useBreakpoint();
const { isDark, setThemeMode, themeMode } = useTheme();
const mobileSidebarOpen = ref(false);
const activeNavigation = computed(() => route.meta.activeNavigation);
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
const navigationGroups: NavigationGroup[] = [
  {
    id: 'ask',
    label: '问答',
    items: [
      { to: '/ask', label: '知识问答', icon: 'ask' },
      { to: '/history', label: '问答历史', icon: 'history' },
    ],
  },
  {
    id: 'knowledge',
    label: '知识库',
    items: [
      {
        to: '/documents',
        label: '文档管理',
        icon: 'documents',
        capability: 'documents:read',
        adminOnly: true,
      },
      {
        to: '/ingestion-jobs',
        label: '入库任务',
        icon: 'ingestion',
        capability: 'documents:read',
        adminOnly: true,
      },
    ],
  },
  {
    id: 'security',
    label: '安全与权限',
    items: [
      {
        to: '/audit',
        label: '审计中心',
        icon: 'audit',
        capability: 'audit:read',
        adminOnly: true,
      },
      {
        to: '/access/users',
        label: '用户与角色',
        icon: 'users',
        capability: 'access:read',
        adminOnly: true,
      },
      {
        to: '/access/departments',
        label: '部门权限',
        icon: 'departments',
        capability: 'access:read',
        adminOnly: true,
      },
    ],
  },
  {
    id: 'system',
    label: '系统',
    items: [
      {
        to: '/settings/providers',
        label: '模型 Provider',
        icon: 'provider',
        capability: 'system:read',
        adminOnly: true,
      },
      {
        to: '/system/usage',
        label: '用量与成本',
        icon: 'usage',
        capability: 'system:read',
        adminOnly: true,
      },
      {
        to: '/system/status',
        label: '系统状态',
        icon: 'status',
        capability: 'system:read',
        adminOnly: true,
      },
    ],
  },
];
function canShow(item: NavigationItem): boolean {
  if (item.adminOnly && !auth.identity?.roles.includes('admin')) return false;
  return item.capability === undefined || auth.hasCapability(item.capability);
}
const visibleNavigationGroups = computed(() =>
  navigationGroups
    .map((group) => ({ ...group, items: group.items.filter(canShow) }))
    .filter((group) => group.items.length > 0),
);
function closeMobileSidebar(): void {
  mobileSidebarOpen.value = false;
}
const returnNavigation = computed<ReturnNavigation | null>(() => {
  if (route.path === '/history' && isMobile.value) return historyDetailReturn(route.fullPath);
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

<style scoped>
.app-shell {
  --app-sidebar-width: 248px;
  min-height: 100vh;
}
.app-header {
  position: fixed;
  inset: 0 0 auto;
  z-index: 10;
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 var(--kb-space-5);
  border-bottom: 1px solid var(--kb-color-border);
  color: var(--kb-color-text-primary);
  background: var(--kb-color-surface);
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--kb-space-2);
  width: 230px;
  min-width: 0;
}
.brand-copy {
  display: grid;
  line-height: 1.05;
}
.brand-name {
  font-size: 15px;
  letter-spacing: 0.02em;
}
.brand-product {
  color: var(--kb-color-text-secondary);
  font-size: 10px;
  letter-spacing: 0.08em;
}
.mobile-page-title {
  display: none;
}
.header-context {
  display: flex;
  align-items: center;
  gap: var(--kb-space-2);
  color: var(--kb-color-text-secondary);
  font-size: 13px;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--kb-color-success);
  box-shadow: 0 0 0 var(--kb-space-1) color-mix(in srgb, var(--kb-color-success) 10%, transparent);
}
.top-breadcrumb {
  margin-left: var(--kb-space-6);
  padding-left: var(--kb-space-6);
  border-left: 1px solid var(--kb-color-border);
  font-size: 12px;
}
:deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
  font-weight: 600;
}
.user-summary {
  display: flex;
  align-items: center;
  gap: var(--kb-space-2);
  margin-left: auto;
  font-size: 12px;
}
.user-details {
  display: grid;
}
.user-summary__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--kb-space-0);
}
.user-context {
  color: var(--kb-color-text-secondary);
}
.avatar {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--kb-color-primary);
  background: var(--kb-color-primary-soft);
  font-weight: 700;
}
.logout-button {
  padding: var(--kb-space-1) var(--kb-space-2);
  border-radius: var(--kb-radius-sm);
  color: var(--kb-color-text-secondary);
  background: transparent;
  cursor: pointer;
}
.theme-toggle {
  flex: 0 0 auto;
  color: var(--kb-color-text-secondary);
}
.theme-toggle:hover,
.theme-toggle:focus-visible {
  outline: none;
  color: var(--kb-color-primary);
  background: var(--kb-color-primary-soft);
}
.logout-button:hover,
.logout-button:focus-visible {
  outline: none;
  color: var(--kb-color-primary);
  background: var(--kb-color-primary-soft);
}
.app-sidebar {
  position: fixed;
  top: 56px;
  bottom: 0;
  left: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: var(--app-sidebar-width);
  padding: var(--kb-space-5) var(--kb-block-padding) var(--kb-space-4);
  border-right: 1px solid var(--kb-color-border);
  background: var(--kb-color-surface);
  transition:
    width 0.18s ease,
    padding 0.18s ease;
}
.sidebar-navigation {
  display: grid;
  flex: 1 1 auto;
  align-content: start;
  gap: var(--kb-layout-gap);
  overflow: auto;
  overscroll-behavior: contain;
  min-height: 0;
}
.navigation-group {
  display: grid;
  gap: var(--kb-space-1);
}
.navigation-group + .navigation-group {
  padding-top: var(--kb-block-padding);
}
.navigation-label {
  padding: 0 var(--kb-list-row-padding) var(--kb-space-1);
  color: var(--kb-color-text-secondary);
  font-size: 11px;
  font-weight: 650;
}
.sidebar-navigation-link {
  display: flex;
  align-items: center;
  gap: var(--kb-layout-gap);
  min-height: 44px;
  padding: 0 var(--kb-list-row-padding);
  border-radius: var(--kb-radius-md);
  color: var(--kb-color-text-secondary);
  white-space: nowrap;
}
.sidebar-navigation-link:hover {
  color: var(--kb-color-text-primary);
  background: var(--kb-color-canvas);
}
.sidebar-navigation-link.is-active {
  color: var(--kb-color-primary);
  background: var(--kb-color-nav-accent);
}
.sidebar-navigation-icon {
  width: 20px;
  color: currentColor;
  font-size: 19px;
  line-height: 1;
  text-align: center;
}
.sidebar-navigation-label {
  font-size: 14px;
  font-weight: 550;
}
.app-main {
  position: fixed;
  top: 56px;
  right: 0;
  bottom: 0;
  left: var(--app-sidebar-width);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  padding: var(--kb-space-page);
  background: var(--kb-color-surface);
  transition: left 0.18s ease;
}
.app-main > :not(.kb-page-header) {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 0;
}
.page-return-link {
  display: inline-flex;
  align-items: center;
  border-radius: var(--kb-radius-md);
}
.page-return-link:hover {
  border-color: color-mix(in srgb, var(--kb-color-primary) 40%, var(--kb-color-border));
  background: var(--kb-color-primary-soft);
}
.mobile-menu-trigger :deep(.el-icon) {
  font-size: var(--kb-font-size-title);
}
.mobile-menu-trigger,
.mobile-return-trigger,
.tablet-group-navigation {
  display: none;
}

/* 响应式：Pad（768px–1279px） */
@media (min-width: 768px) and (max-width: 1279px) {
  .app-shell {
    --app-sidebar-width: 68px;
  }
  .brand {
    width: 140px;
  }
  .app-sidebar {
    overflow-x: hidden;
    overflow-y: auto;
    padding-inline: var(--kb-space-2);
    overscroll-behavior-y: contain;
  }
  .app-sidebar .tablet-group-navigation {
    display: grid;
    flex: 0 0 auto;
    gap: var(--kb-space-0);
    overflow: visible;
    width: 100%;
  }
  .tablet-navigation-group {
    display: grid;
    place-items: center;
    gap: var(--kb-space-1);
    padding-block: var(--kb-space-2);
  }
  .tablet-navigation-group + .tablet-navigation-group {
    border-top: 1px solid var(--kb-color-border);
  }
  .app-sidebar .tablet-navigation-link {
    display: grid;
    place-items: center;
    width: 100%;
    height: 52px;
    max-width: 52px;
    min-height: 52px;
    padding: 0;
    border: 0;
    border-radius: var(--kb-radius-md);
    color: var(--kb-color-text-secondary);
    background: transparent;
    cursor: pointer;
  }
  .app-sidebar .tablet-navigation-link :deep(.nav-icon) {
    width: 22px;
    height: 22px;
  }
  .app-sidebar .tablet-navigation-link:hover,
  .app-sidebar .tablet-navigation-link:focus-visible,
  .app-sidebar .tablet-navigation-link.is-active {
    color: var(--kb-color-primary);
    background: var(--kb-color-nav-accent);
  }
}
/* 响应式：Pad 横屏（768px–1279px） */
/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .app-header {
    padding: 0 var(--kb-space-2);
  }
  .brand {
    display: none;
  }
  .header-context,
  .top-breadcrumb,
  .user-details,
  .logout-button {
    display: none;
  }
  .mobile-page-title {
    display: block;
    flex: 1 1 auto;
    overflow: hidden;
    min-width: 0;
    margin-left: var(--kb-space-element);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mobile-menu-trigger {
    display: grid;
    place-content: center;
    gap: var(--kb-space-1);
    width: 32px;
    height: 44px;
    color: var(--kb-color-text-primary);
    background: transparent;
    cursor: pointer;
  }
  .mobile-return-trigger {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 32px;
    height: 44px;
    border-radius: var(--kb-radius-md);
    color: var(--kb-color-text-secondary);
    font-size: 20px;
  }
  .mobile-return-trigger:hover,
  .mobile-return-trigger:focus-visible {
    outline: none;
    color: var(--kb-color-primary);
    background: var(--kb-color-primary-soft);
  }
  .user-summary {
    margin-left: auto;
  }
  .app-sidebar {
    display: none;
  }
  .app-main {
    left: 0;
  }
  .mobile-sidebar-header {
    display: grid;
    gap: var(--kb-layout-gap);
    width: 100%;
    min-width: 0;
  }
  .mobile-sidebar-header__top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--kb-space-2);
  }
  .mobile-sidebar-header__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--kb-space-1);
  }
  .mobile-sidebar-brand {
    display: flex;
    align-items: center;
    gap: var(--kb-space-2);
    width: fit-content;
    min-width: 0;
  }
  .mobile-sidebar-identity {
    display: flex;
    align-items: center;
    gap: var(--kb-space-2);
    min-width: 0;
    padding: var(--kb-space-2) var(--kb-block-padding);
    border: 1px solid var(--kb-color-border);
    border-radius: var(--kb-radius-md);
    background: var(--kb-color-canvas);
  }
  .mobile-sidebar-identity__avatar {
    flex: 0 0 auto;
  }
  .mobile-sidebar-identity__copy {
    display: grid;
    min-width: 0;
    line-height: 1.3;
  }
  .mobile-sidebar-identity__user,
  .mobile-sidebar-identity__context {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mobile-sidebar-identity__user {
    color: var(--kb-color-text-primary);
    font-size: 13px;
  }
  .mobile-sidebar-identity__context {
    color: var(--kb-color-text-secondary);
    font-size: 11px;
  }
  .mobile-sidebar-navigation {
    display: grid;
    flex: 1 1 auto;
    align-content: start;
    gap: var(--kb-layout-gap);
    overflow: auto;
    overscroll-behavior: contain;
    min-height: 0;
  }
  .mobile-sidebar-footer {
    flex: 0 0 auto;
    padding: var(--kb-space-2) 0 max(var(--kb-space-2), env(safe-area-inset-bottom));
  }
  .mobile-sidebar-logout {
    width: 100%;
    min-height: 48px;
    border: 1px solid var(--kb-color-border);
    border-radius: var(--kb-radius-md);
    color: var(--kb-color-text-secondary);
    background: var(--kb-color-surface);
    font: inherit;
    cursor: pointer;
  }
}
</style>
