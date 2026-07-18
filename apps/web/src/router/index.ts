import type { Capability } from '@nexus-kb/contracts';
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { decideRouteAccess } from './access';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    capabilities?: Capability[];
    title?: string;
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
          meta: { title: '知识问答' },
        },
        {
          path: 'documents',
          component: () => import('@/views/ComingSoonView.vue'),
          meta: { title: '文档管理', capabilities: ['documents:read'] },
        },
        {
          path: 'audit',
          component: () => import('@/views/ComingSoonView.vue'),
          meta: { title: '审计中心', capabilities: ['audit:read'] },
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
    auth.identity?.capabilities ?? [],
    to.meta.capabilities ?? [],
  );
  if (to.meta.requiresAuth && decision === 'login') {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (decision === 'forbidden') return '/403';
  return true;
});
