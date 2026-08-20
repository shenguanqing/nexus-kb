import type { Capability } from '@nexus-kb/contracts';
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { decideRouteAccess } from './access';
import type { NavigationTarget } from './navigation';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    capabilities?: Capability[];
    adminOnly?: boolean;
    title?: string;
    activeNavigation?: NavigationTarget;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录' } },
    {
      path: '/',
      component: () => import('@/layouts/AppShell.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/ask' },
        {
          path: 'ask',
          component: () => import('@/views/KnowledgeAskView.vue'),
          meta: { title: '知识问答', activeNavigation: '/ask' },
        },
        {
          path: 'history',
          component: () => import('@/views/HistoryView.vue'),
          meta: { title: '问答历史', activeNavigation: '/history' },
        },
        {
          path: 'documents',
          component: () => import('@/views/DocumentsView.vue'),
          meta: {
            title: '文档管理',
            capabilities: ['documents:read'],
            adminOnly: true,
            activeNavigation: '/documents',
          },
        },
        {
          path: 'documents/:id/preview',
          component: () => import('@/views/DocumentPreviewView.vue'),
          meta: {
            title: '文档预览',
            capabilities: ['documents:read'],
            activeNavigation: '/documents',
          },
        },
        {
          path: 'documents/:id',
          component: () => import('@/views/DocumentDetailView.vue'),
          meta: {
            title: '文档详情',
            capabilities: ['documents:read'],
            adminOnly: true,
            activeNavigation: '/documents',
          },
        },
        {
          path: 'documents/:id/chunks',
          component: () => import('@/views/DocumentChunksView.vue'),
          meta: {
            title: '文档分块',
            capabilities: ['documents:read'],
            adminOnly: true,
            activeNavigation: '/documents',
          },
        },
        {
          path: 'ingestion-jobs',
          component: () => import('@/views/IngestionJobsView.vue'),
          meta: {
            title: '入库任务',
            capabilities: ['documents:read'],
            adminOnly: true,
            activeNavigation: '/ingestion-jobs',
          },
        },
        {
          path: 'audit',
          component: () => import('@/views/AuditView.vue'),
          meta: {
            title: '审计中心',
            capabilities: ['audit:read'],
            adminOnly: true,
            activeNavigation: '/audit',
          },
        },
        {
          path: 'access/users',
          component: () => import('@/views/UsersView.vue'),
          meta: {
            title: '用户与角色',
            capabilities: ['access:read'],
            adminOnly: true,
            activeNavigation: '/access/users',
          },
        },
        {
          path: 'access/departments',
          component: () => import('@/views/DepartmentsView.vue'),
          meta: {
            title: '部门权限',
            capabilities: ['access:read'],
            adminOnly: true,
            activeNavigation: '/access/departments',
          },
        },
        {
          path: 'settings/providers',
          component: () => import('@/views/ProviderSettingsView.vue'),
          meta: {
            title: '模型 Provider',
            capabilities: ['system:read'],
            adminOnly: true,
            activeNavigation: '/settings/providers',
          },
        },
        {
          path: 'system/status',
          component: () => import('@/views/SystemStatusView.vue'),
          meta: {
            title: '系统状态',
            capabilities: ['system:read'],
            adminOnly: true,
            activeNavigation: '/system/status',
          },
        },
        {
          path: 'system/usage',
          component: () => import('@/views/UsageView.vue'),
          meta: {
            title: '用量与成本',
            capabilities: ['system:read'],
            adminOnly: true,
            activeNavigation: '/system/usage',
          },
        },
      ],
    },
    {
      path: '/403',
      component: () => import('@/views/ForbiddenView.vue'),
      meta: { title: '无权限' },
    },
    {
      path: '/:pathMatch(.*)*',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { title: '页面不存在' },
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.isLoaded) await auth.loadSession();
  document.title = `${String(to.meta.title ?? '知枢')} · NexusKB`;
  if (to.path === '/login' && auth.isAuthenticated) return '/ask';
  const decision = decideRouteAccess(
    auth.isAuthenticated,
    auth.identity?.roles.includes('admin') ?? false,
    auth.identity?.capabilities ?? [],
    to.meta.capabilities ?? [],
    to.meta.adminOnly ?? false,
  );
  if (to.meta.requiresAuth && decision === 'login') {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (decision === 'forbidden') return '/403';
  return true;
});
