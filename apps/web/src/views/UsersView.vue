<template>
  <section class="kb-page">
    <form
      v-if="!isMobile"
      class="access-toolbar"
      :class="{ 'has-create-action': canWrite }"
      aria-label="用户目录筛选"
      @submit.prevent="applyFilters"
    >
      <el-input v-model="search" clearable maxlength="128" placeholder="搜索用户 ID" />
      <el-select v-if="isAdmin" v-model="department" clearable filterable placeholder="筛选部门">
        <el-option v-for="item in departments" :key="item" :label="item" :value="item" />
      </el-select>
      <div class="kb-filter-actions">
        <el-button native-type="submit">筛选</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>
      <el-button v-if="canWrite" type="primary" @click="openCreateUser">新增账号</el-button>
    </form>
    <form v-else class="access-toolbar" aria-label="搜索用户目录" @submit.prevent="applyFilters">
      <el-input v-model="search" clearable maxlength="128" placeholder="搜索用户 ID" />
      <el-button v-if="canWrite" type="primary" @click="openCreateUser">新增账号</el-button>
      <el-button
        class="kb-filter-trigger"
        :class="{ 'kb-filter-trigger--active': hasDepartmentFilter }"
        aria-label="筛选"
        @click="filtersVisible = true"
      >
        筛选
      </el-button>
    </form>
    <el-drawer
      v-if="isMobile"
      v-model="filtersVisible"
      direction="btt"
      size="auto"
      title="筛选用户目录"
      append-to-body
    >
      <form class="kb-filter-form" aria-label="用户目录筛选" @submit.prevent="applyFilters">
        <el-select v-if="isAdmin" v-model="department" clearable filterable placeholder="筛选部门">
          <el-option v-for="item in departments" :key="item" :label="item" :value="item" />
        </el-select>
        <div class="kb-filter-form__actions">
          <el-button @click="resetFilters">重置</el-button>
          <el-button type="primary" native-type="submit">筛选</el-button>
        </div>
      </form>
    </el-drawer>

    <div class="kb-block-content kb-block-content--gap">
      <div v-if="errorMessage && users.length === 0" class="kb-error-state" role="alert">
        <strong class="kb-text kb-text--danger">无法加载用户目录</strong>
        <span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>

      <div
        v-else
        v-loading="loading"
        class="access-table-wrap kb-block kb-block--flush kb-block-scroll"
      >
        <template v-if="users.length > 0">
          <el-table
            v-if="!isMobile"
            class="desktop-data-table"
            :data="users"
            row-key="userId"
            height="100%"
          >
            <el-table-column label="账号 / 用户 ID" min-width="220">
              <template #default="scopeRow">
                <div class="kb-data-grid__item">
                  <span class="kb-text kb-text--md kb-text--strong">
                    {{ userRow(scopeRow.row).username ?? userRow(scopeRow.row).userId }}
                  </span>
                  <span
                    v-if="userRow(scopeRow.row).username"
                    class="kb-text kb-text--md kb-text--secondary"
                  >
                    {{ userRow(scopeRow.row).userId }}
                  </span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="部门" prop="department" min-width="160" />
            <el-table-column label="角色" min-width="160">
              <template #default="scopeRow">
                <div class="access-role-tags">
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
              <template #default="scopeRow">
                <el-tag :type="userRow(scopeRow.row).status === 'disabled' ? 'info' : 'success'">
                  {{
                    userRow(scopeRow.row).status === 'active'
                      ? '可登录'
                      : userRow(scopeRow.row).status === 'disabled'
                        ? '已禁用'
                        : '外部身份'
                  }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="最近认证" min-width="190">
              <template #default="scopeRow">
                {{ new Date(userRow(scopeRow.row).lastAuthenticatedAt).toLocaleString() }}
              </template>
            </el-table-column>
            <el-table-column v-if="canWrite" label="操作" width="230">
              <template #default="scopeRow">
                <div class="access-table-row-actions">
                  <el-button
                    v-if="!userRow(scopeRow.row).username"
                    link
                    type="primary"
                    @click="editRoles(userRow(scopeRow.row))"
                  >
                    编辑角色
                  </el-button>
                  <el-button
                    v-if="userRow(scopeRow.row).username"
                    link
                    type="primary"
                    @click="editAccount(userRow(scopeRow.row))"
                  >
                    编辑用户
                  </el-button>
                  <el-button
                    v-if="
                      userRow(scopeRow.row).username &&
                      userRow(scopeRow.row).userId !== auth.identity?.userId
                    "
                    link
                    type="danger"
                    @click="removeUser(userRow(scopeRow.row))"
                  >
                    删除
                  </el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <el-collapse v-else class="kb-collapse-list" accordion aria-label="用户目录">
            <el-collapse-item v-for="user in users" :key="user.userId" :name="user.userId">
              <template #title>
                <div class="kb-collapse-list__summary">
                  <span class="kb-collapse-list__label kb-text kb-text--md kb-text--secondary">
                    {{ user.username ?? user.userId }}
                  </span>
                  <el-tag
                    class="access-user-status"
                    :type="user.status === 'disabled' ? 'info' : 'success'"
                  >
                    {{
                      user.status === 'active'
                        ? '可登录'
                        : user.status === 'disabled'
                          ? '已禁用'
                          : '外部身份'
                    }}
                  </el-tag>
                </div>
              </template>
              <div class="kb-data-fields">
                <div class="kb-data-field">
                  <span class="kb-data-field__label">部门</span>
                  <span class="kb-data-field__value">
                    {{ user.department }}
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">最近认证</span>
                  <span class="kb-data-field__value">
                    {{ new Date(user.lastAuthenticatedAt).toLocaleString() }}
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">角色</span>
                  <span class="kb-data-field__value kb-text--strong">
                    {{ accessRoleSummary(user.roles).join('、') || '普通用户' }}
                  </span>
                </div>
              </div>
              <div class="access-mobile-user-actions">
                <el-button
                  v-if="canWrite && !user.username"
                  link
                  type="primary"
                  @click="editRoles(user)"
                >
                  编辑角色
                </el-button>
                <el-button
                  v-if="canWrite && user.username"
                  link
                  type="primary"
                  @click="editAccount(user)"
                >
                  编辑用户
                </el-button>
                <el-button
                  v-if="canWrite && user.username && user.userId !== auth.identity?.userId"
                  link
                  type="danger"
                  @click="removeUser(user)"
                >
                  删除账号
                </el-button>
              </div>
            </el-collapse-item>
          </el-collapse>
        </template>
        <el-empty v-else-if="!loading" description="当前范围内暂无已认证用户" />
      </div>

      <div v-if="errorMessage && users.length > 0" class="kb-inline-error" role="alert">
        {{ errorMessage }}
      </div>
      <div v-if="total > pageSize" class="kb-pagination">
        <el-pagination
          layout="total, prev, pager, next"
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          @current-change="changePage"
        />
      </div>

      <aside class="kb-block">
        <div
          class="access-boundary-note__title kb-heading kb-heading--h2"
          role="heading"
          aria-level="2"
        >
          权限边界
        </div>
        <div class="kb-text kb-text--secondary">
          管理员可创建和管理本地后台账号；外部身份账号仍由其身份源管理。管理员自动拥有当前租户的全部功能权限和敏感度访问范围，所有账号变更写入审计，并禁止移除、禁用或降级最后一个管理员。
        </div>
      </aside>
    </div>
    <component
      :is="isMobile ? ElDrawer : ElDialog"
      v-model="roleDialogVisible"
      :class="isMobile ? 'access-editor-drawer' : 'access-editor-dialog'"
      title="编辑托管角色"
      :width="isMobile ? undefined : 'min(480px, calc(100vw - 28px))'"
      align-center
      :size="isMobile ? 'auto' : undefined"
      :direction="isMobile ? 'btt' : undefined"
      append-to-body
      :z-index="4000"
      @closed="selectedUser = null"
    >
      <div v-if="selectedUser" class="access-editor-summary kb-text kb-text--secondary">
        {{ selectedUser.userId }} · {{ selectedUser.department }}
      </div>
      <el-radio-group v-model="selectedRole" class="access-role-editor">
        <el-radio value="user">普通用户</el-radio>
        <el-radio value="admin">管理员</el-radio>
      </el-radio-group>
      <template #footer>
        <el-button @click="roleDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="roleSaving" @click="saveRoles">保存角色</el-button>
      </template>
    </component>
    <component
      :is="isMobile ? ElDrawer : ElDialog"
      v-model="createDialogVisible"
      :class="isMobile ? 'access-editor-drawer' : 'access-editor-dialog'"
      title="新增账号"
      :width="isMobile ? undefined : 'min(520px, calc(100vw - 28px))'"
      align-center
      :size="isMobile ? 'auto' : undefined"
      :direction="isMobile ? 'btt' : undefined"
      append-to-body
      :z-index="4000"
      @closed="newPassword = ''"
    >
      <el-form class="access-editor-form" label-position="top">
        <el-form-item class="access-editor-field" label="登录账号">
          <el-input v-model="newUsername" maxlength="64" />
        </el-form-item>
        <el-form-item class="access-editor-field" label="用户 ID">
          <el-input v-model="newUserId" maxlength="256" />
        </el-form-item>
        <el-form-item class="access-editor-field" label="初始密码">
          <el-input v-model="newPassword" type="password" show-password maxlength="256" />
        </el-form-item>
        <el-form-item class="access-editor-field" label="部门">
          <el-input v-model="newDepartment" maxlength="128" />
        </el-form-item>
        <el-form-item class="access-editor-field access-editor-field--full" label="角色">
          <el-radio-group v-model="newRole">
            <el-radio value="user">普通用户</el-radio>
            <el-radio value="admin">管理员</el-radio></el-radio-group
          >
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="createSaving" @click="saveNewUser">创建账号</el-button>
      </template>
    </component>
    <component
      :is="isMobile ? ElDrawer : ElDialog"
      v-model="accountDialogVisible"
      :class="isMobile ? 'access-editor-drawer' : 'access-editor-dialog'"
      title="管理后台账号"
      :width="isMobile ? undefined : 'min(520px, calc(100vw - 28px))'"
      align-center
      :size="isMobile ? 'auto' : undefined"
      :direction="isMobile ? 'btt' : undefined"
      append-to-body
      :z-index="4000"
      @closed="replacementPassword = ''"
    >
      <div v-if="selectedUser" class="access-editor-summary kb-text kb-text--secondary">
        {{ selectedUser.username }} · {{ selectedUser.userId }}
      </div>
      <el-form class="access-editor-form" label-position="top">
        <el-form-item class="access-editor-field" label="部门">
          <el-input v-model="accountDepartment" maxlength="128" />
        </el-form-item>
        <el-form-item class="access-editor-field" label="重置密码（留空则不修改）">
          <el-input v-model="replacementPassword" type="password" show-password maxlength="256" />
        </el-form-item>
        <el-form-item class="access-editor-field" label="角色">
          <el-radio-group
            v-model="accountRole"
            :disabled="selectedUser?.userId === auth.identity?.userId"
          >
            <el-radio value="user">普通用户</el-radio>
            <el-radio value="admin">管理员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item class="access-editor-field" label="账号状态">
          <el-switch
            v-model="accountEnabled"
            active-text="启用"
            inactive-text="禁用"
            :disabled="selectedUser?.userId === auth.identity?.userId"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="accountDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="accountSaving" @click="saveAccount">保存账号</el-button>
      </template>
    </component>
  </section>
</template>

<script setup lang="ts">
import type { AppRole, UserDirectoryEntry, UserDirectoryQueryRequest } from '@nexus-kb/contracts';
import { ElDialog, ElDrawer, ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  createUser,
  deleteUser,
  listDepartments,
  listUsers,
  updateUser,
  updateUserRoles,
} from '@/api/access';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { accessRoleSummary } from './access-presentation';

const pageSize = 25;
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { isMobile } = useBreakpoint();
const users = ref<UserDirectoryEntry[]>([]);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const search = ref(typeof route.query.query === 'string' ? route.query.query : '');
const department = ref(typeof route.query.department === 'string' ? route.query.department : '');
const departments = ref<string[]>([]);
const page = ref(Math.max(1, Number(route.query.page) || 1));
const roleDialogVisible = ref(false);
const createDialogVisible = ref(false);
const accountDialogVisible = ref(false);
const filtersVisible = ref(false);
const roleSaving = ref(false);
const createSaving = ref(false);
const accountSaving = ref(false);
const selectedUser = ref<UserDirectoryEntry | null>(null);
const selectedRole = ref<AppRole>('user');
const newUserId = ref('');
const newUsername = ref('');
const newPassword = ref('');
const newDepartment = ref('general');
const newRole = ref<AppRole>('user');
const accountDepartment = ref('');
const accountRole = ref<AppRole>('user');
const accountEnabled = ref(true);
const replacementPassword = ref('');
const isAdmin = computed(() => auth.identity?.roles.includes('admin') ?? false);
const canWrite = computed(() => isAdmin.value && auth.hasCapability('access:write'));
const hasDepartmentFilter = computed(() => department.value.trim() !== '');

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
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '用户目录加载失败';
  } finally {
    loading.value = false;
  }
}

async function loadDepartments(): Promise<void> {
  if (!isAdmin.value) return;
  try {
    departments.value = (await listDepartments()).departments.map((item) => item.department);
  } catch {
    // 部门条件仍可由 URL 保留；选项列表失败不影响用户目录与权限筛选。
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
  filtersVisible.value = false;
}

async function resetFilters(): Promise<void> {
  search.value = '';
  department.value = '';
  page.value = 1;
  await syncRouteAndLoad();
  filtersVisible.value = false;
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
    selectedUser.value = null;
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '角色更新失败');
  } finally {
    roleSaving.value = false;
  }
}

function openCreateUser(): void {
  newUserId.value = '';
  newUsername.value = '';
  newPassword.value = '';
  newDepartment.value = auth.identity?.department ?? 'general';
  newRole.value = 'user';
  createDialogVisible.value = true;
}

async function saveNewUser(): Promise<void> {
  createSaving.value = true;
  try {
    await createUser({
      userId: newUserId.value.trim(),
      username: newUsername.value.trim(),
      password: newPassword.value,
      department: newDepartment.value.trim(),
      roles: [newRole.value],
      allowedSensitivities: ['public', 'internal', 'confidential'],
      defaultSensitivity: 'internal',
    });
    ElMessage.success('后台账号已创建');
    createDialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '创建账号失败');
  } finally {
    newPassword.value = '';
    createSaving.value = false;
  }
}

async function removeUser(user: UserDirectoryEntry): Promise<void> {
  if (!user.username) {
    ElMessage.warning('此账号来自外部身份源，请在身份源中管理');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `删除账号“${user.username}”后无法登录，且会立即撤销其会话。此操作不会删除其已创建的业务数据。`,
      '确认删除后台账号',
      {
        confirmButtonText: '删除账号',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        type: 'warning',
      },
    );
    await deleteUser(user.userId);
    ElMessage.success('后台账号已删除');
    await load();
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error instanceof ApiError ? error.message : '删除账号失败');
  }
}

function editAccount(user: UserDirectoryEntry): void {
  selectedUser.value = user;
  accountDepartment.value = user.department;
  accountRole.value = user.roles[0] ?? 'user';
  accountEnabled.value = user.status === 'active';
  replacementPassword.value = '';
  accountDialogVisible.value = true;
}

async function saveAccount(): Promise<void> {
  if (!selectedUser.value) return;
  accountSaving.value = true;
  try {
    await updateUser(selectedUser.value.userId, {
      department: accountDepartment.value.trim(),
      roles: [accountRole.value],
      enabled: accountEnabled.value,
      password: replacementPassword.value || undefined,
    });
    ElMessage.success('后台账号已更新');
    accountDialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '账号更新失败');
  } finally {
    replacementPassword.value = '';
    accountSaving.value = false;
  }
}

onMounted(() => {
  void load();
  void loadDepartments();
});
</script>

<style scoped>
.access-toolbar {
  display: grid;
  align-items: center;
  gap: var(--kb-space-2);
  grid-template-columns: minmax(180px, 1fr) minmax(160px, 0.8fr) auto auto;
}
.access-role-editor {
  display: grid;
  gap: var(--kb-space-2);
}
.access-editor-form {
  display: grid;
  align-items: start;
  gap: var(--kb-layout-gap);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.access-editor-field {
  min-width: 0;
  margin-bottom: 0;
}
.access-editor-field--full {
  grid-column: 1 / -1;
}
.access-editor-summary {
  margin-bottom: var(--kb-layout-gap);
}
.access-table-wrap .desktop-data-table {
  min-height: 0;
}
.access-table-wrap > .kb-collapse-list {
  border: 0;
}
.access-table-row-actions,
.access-mobile-user-actions,
.access-role-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--kb-space-2);
}
.access-user-status {
  flex: 0 0 auto;
}
/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .access-toolbar {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
  .access-editor-form {
    grid-template-columns: minmax(0, 1fr);
  }
  .access-editor-field--full {
    grid-column: auto;
  }
}
</style>
