<script setup lang="ts">
import type { AppRole, UserDirectoryEntry, UserDirectoryQueryRequest } from '@nexus-kb/contracts';
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { listUsers, updateUserRoles } from '@/api/access';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { accessRoleSummary, accessScopeLabel } from './access-presentation';

const pageSize = 25;
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const users = ref<UserDirectoryEntry[]>([]);
const total = ref(0);
const scope = ref<'tenant' | 'department'>('department');
const loading = ref(false);
const errorMessage = ref('');
const search = ref(typeof route.query.query === 'string' ? route.query.query : '');
const department = ref(typeof route.query.department === 'string' ? route.query.department : '');
const page = ref(Math.max(1, Number(route.query.page) || 1));
const roleDialogVisible = ref(false);
const roleSaving = ref(false);
const selectedUser = ref<UserDirectoryEntry | null>(null);
const selectedRole = ref<AppRole>('user');
const isAdmin = computed(() => auth.identity?.roles.includes('admin') ?? false);
const canWrite = computed(() => isAdmin.value && auth.hasCapability('access:write'));
const scopeText = computed(() =>
  accessScopeLabel(scope.value, auth.identity?.department ?? '当前'),
);

function userRow(row: unknown): UserDirectoryEntry {
  return row as UserDirectoryEntry;
}

function request(): Partial<UserDirectoryQueryRequest> {
  return {
    query: search.value.trim() || undefined,
    department: isAdmin.value ? department.value.trim() || undefined : undefined,
    offset: (page.value - 1) * pageSize,
    limit: pageSize,
  };
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await listUsers(request());
    users.value = result.users;
    total.value = result.total;
    scope.value = result.scope;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '用户目录加载失败';
  } finally {
    loading.value = false;
  }
}

async function syncRouteAndLoad(): Promise<void> {
  const query: Record<string, string> = {};
  if (search.value.trim()) query.query = search.value.trim();
  if (isAdmin.value && department.value.trim()) query.department = department.value.trim();
  if (page.value > 1) query.page = String(page.value);
  await router.replace({ query });
  await load();
}

async function applyFilters(): Promise<void> {
  page.value = 1;
  await syncRouteAndLoad();
}

async function resetFilters(): Promise<void> {
  search.value = '';
  department.value = '';
  page.value = 1;
  await syncRouteAndLoad();
}

async function changePage(nextPage: number): Promise<void> {
  page.value = nextPage;
  await syncRouteAndLoad();
}

function editRoles(user: UserDirectoryEntry): void {
  selectedUser.value = user;
  selectedRole.value = user.roles[0] ?? 'user';
  roleDialogVisible.value = true;
}

async function saveRoles(): Promise<void> {
  if (!selectedUser.value) return;
  roleSaving.value = true;
  try {
    await updateUserRoles(selectedUser.value.userId, [selectedRole.value]);
    ElMessage.success('托管角色已更新并写入审计');
    roleDialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '角色更新失败');
  } finally {
    roleSaving.value = false;
  }
}

onMounted(() => load());
</script>

<template>
  <section class="access-page">
    <div class="access-intro">
      <div>
        <strong>已验证身份目录</strong>
        <p>展示 {{ scopeText }} 内已完成认证的用户摘要，角色来自受验证身份声明。</p>
      </div>
      <el-tag type="info" effect="plain">身份源 + 托管角色</el-tag>
    </div>

    <form class="access-toolbar" aria-label="用户目录查询" @submit.prevent="applyFilters">
      <el-input v-model="search" clearable maxlength="128" placeholder="搜索企业用户 ID" />
      <el-input
        v-if="isAdmin"
        v-model="department"
        clearable
        maxlength="128"
        placeholder="查询部门"
      />
      <el-button native-type="submit">查询</el-button>
      <el-button class="reset-button" native-type="button" @click="resetFilters">重置</el-button>
    </form>

    <div class="access-content">
      <div v-if="errorMessage && users.length === 0" class="document-error" role="alert">
        <strong>无法加载用户目录</strong>
        <span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>

      <div v-else v-loading="loading" class="access-table-wrap">
        <el-table v-if="users.length > 0" class="desktop-data-table" :data="users" row-key="userId">
          <el-table-column label="企业用户 ID" prop="userId" min-width="220" fixed="left" />
          <el-table-column label="部门" prop="department" min-width="160" />
          <el-table-column label="角色" min-width="240">
            <template #default="scopeRow">
              <div class="role-tags">
                <el-tag
                  v-for="role in accessRoleSummary(userRow(scopeRow.row).roles)"
                  :key="role"
                  effect="plain"
                >
                  {{ role }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" min-width="120">
            <el-tag type="success">已验证登录</el-tag>
          </el-table-column>
          <el-table-column label="最近认证" min-width="190">
            <template #default="scopeRow">
              {{ new Date(userRow(scopeRow.row).lastAuthenticatedAt).toLocaleString() }}
            </template>
          </el-table-column>
          <el-table-column v-if="canWrite" label="操作" width="110" fixed="right">
            <template #default="scopeRow">
              <el-button text type="primary" @click="editRoles(userRow(scopeRow.row))">
                编辑角色
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="users.length > 0" class="mobile-data-list" aria-label="用户目录">
          <article v-for="user in users" :key="user.userId" class="mobile-data-card">
            <header>
              <strong>{{ user.userId }}</strong>
              <el-tag type="success">已验证登录</el-tag>
            </header>
            <div class="mobile-data-fields">
              <div>
                <span>部门</span><strong>{{ user.department }}</strong>
              </div>
              <div>
                <span>最近认证</span
                ><strong>{{ new Date(user.lastAuthenticatedAt).toLocaleString() }}</strong>
              </div>
              <div>
                <span>角色</span
                ><strong>{{ accessRoleSummary(user.roles).join('、') || '普通用户' }}</strong>
              </div>
            </div>
            <el-button v-if="canWrite" text type="primary" @click="editRoles(user)">
              编辑角色
            </el-button>
          </article>
        </div>
        <el-empty v-else-if="!loading" description="当前范围内暂无已认证用户" />
      </div>

      <div v-if="errorMessage && users.length > 0" class="audit-inline-error" role="alert">
        {{ errorMessage }}
      </div>
      <div v-if="total > pageSize" class="access-pagination">
        <el-pagination
          background
          layout="prev, pager, next"
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          @current-change="changePage"
        />
      </div>

      <aside class="access-boundary-note">
        <strong>权限边界</strong>
        <p>
          已验证的认证身份源负责确认用户身份，主服务托管角色覆盖负责应用内授权范围。所有变更写入审计，并禁止移除
          租户内最后一个管理员。
        </p>
      </aside>
    </div>
    <el-dialog
      v-model="roleDialogVisible"
      title="编辑托管角色"
      width="min(480px, calc(100vw - 28px))"
      append-to-body
      :z-index="4000"
    >
      <p v-if="selectedUser">{{ selectedUser.userId }} · {{ selectedUser.department }}</p>
      <el-radio-group v-model="selectedRole" class="role-editor">
        <el-radio value="user">普通用户</el-radio>
        <el-radio value="admin">管理员</el-radio>
      </el-radio-group>
      <template #footer>
        <el-button @click="roleDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="roleSaving" @click="saveRoles"> 保存角色 </el-button>
      </template>
    </el-dialog>
  </section>
</template>
