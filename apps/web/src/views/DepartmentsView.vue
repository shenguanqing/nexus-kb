<template>
  <section class="kb-page" v-loading="loading">
    <div v-if="errorMessage" class="kb-error-state" role="alert">
      <strong class="kb-text kb-text--danger">无法加载部门</strong><span>{{ errorMessage }}</span>
      <el-button @click="load">重试</el-button>
    </div>
    <div
      v-else
      class="department-layout kb-split-layout"
      :class="isMobile && ['kb-block', 'kb-block--flush', 'kb-block-scroll']"
    >
      <nav
        v-if="!isMobile"
        class="department-directory kb-block kb-block--flush"
        aria-label="部门列表"
      >
        <div class="department-panel__header">
          <span class="kb-heading kb-heading--h5" role="heading" aria-level="2">部门列表 </span>
          <span
            class="department-panel__count kb-text kb-text--sm kb-text--secondary kb-text--medium"
          >
            {{ departments.length }}
          </span>
        </div>
        <div class="kb-block-scroll kb-block-scroll--list">
          <div
            v-for="item in departments"
            :key="item.department"
            class="department-list-item"
            tabindex="0"
            :class="{ 'is-active': selected?.department === item.department }"
            @click="select(item)"
            @keydown.enter.prevent="select(item)"
            @keydown.space.prevent="select(item)"
          >
            <span class="kb-text kb-text--md kb-text--primary kb-text--strong">
              {{ item.department }}
            </span>
            <span class="kb-text kb-text--sm kb-text--secondary">
              {{ item.userCount }} 位用户 · {{ item.documentCount }} 份文档</span
            >
          </div>
        </div>
      </nav>
      <article v-if="selected && !isMobile" class="department-policy kb-block kb-block--flush">
        <div class="department-panel__header">
          <span class="kb-heading kb-heading--h5" role="heading" aria-level="2">
            {{ selected.department }} 权限
          </span>
        </div>
        <div class="department-policy-body">
          <div class="kb-text kb-text--secondary">
            该策略只能收紧身份源声明的敏感度，不能扩大用户权限。
          </div>
          <el-checkbox-group
            v-model="sensitivities"
            class="policy-sensitivity-group"
            :disabled="!canWrite"
          >
            <el-checkbox value="public">公开</el-checkbox>
            <el-checkbox value="internal">内部</el-checkbox>
            <el-checkbox value="confidential">机密</el-checkbox>
          </el-checkbox-group>
          <div v-if="canWrite" class="department-policy-actions">
            <el-button
              type="primary"
              :disabled="sensitivities.length === 0"
              :loading="saving"
              @click="save"
            >
              保存并生效
            </el-button>
          </div>
        </div>
      </article>
      <el-collapse
        v-if="isMobile"
        v-model="expandedDepartment"
        class="kb-collapse-list"
        accordion
        @change="selectMobileDepartment"
      >
        <el-collapse-item
          v-for="item in departments"
          :key="item.department"
          :name="item.department"
        >
          <template #title>
            <div class="kb-collapse-list__summary">
              <div>{{ item.department }}</div>
              <div>{{ item.userCount }} 位用户 · {{ item.documentCount }} 份文档</div>
            </div>
          </template>
          <div class="kb-text kb-text--secondary">
            该策略只能收紧身份源声明的敏感度，不能扩大用户权限。
          </div>
          <div class="mobile-inline-editor">
            <el-checkbox-group
              v-model="sensitivities"
              class="policy-sensitivity-group"
              :disabled="!canWrite || saving"
            >
              <el-checkbox value="public">公开</el-checkbox>
              <el-checkbox value="internal">内部</el-checkbox>
              <el-checkbox value="confidential">机密</el-checkbox>
            </el-checkbox-group>
            <el-button
              v-if="canWrite"
              type="primary"
              class="mobile-inline-editor__submit"
              :disabled="sensitivities.length === 0"
              :loading="saving"
              @click="save"
            >
              保存权限
            </el-button>
          </div>
        </el-collapse-item>
      </el-collapse>
      <el-empty v-if="departments.length === 0" description="暂无部门数据" />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DepartmentPolicy, Sensitivity } from '@nexus-kb/contracts';
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { listDepartments, updateDepartmentPolicy } from '@/api/access';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useBreakpoint } from '@/composables/useBreakpoint';

const auth = useAuthStore();
const { isMobile } = useBreakpoint();
const departments = ref<DepartmentPolicy[]>([]);
const selected = ref<DepartmentPolicy | null>(null);
const sensitivities = ref<Sensitivity[]>([]);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const expandedDepartment = ref('');
const canWrite = computed(
  () => auth.hasCapability('access:write') && auth.identity?.roles.includes('admin'),
);
async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    departments.value = (await listDepartments()).departments;
    if (selected.value)
      select(
        departments.value.find((item) => item.department === selected.value?.department) ??
          departments.value[0],
      );
    else select(departments.value[0]);
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '部门加载失败';
  } finally {
    loading.value = false;
  }
}
function select(item?: DepartmentPolicy): void {
  selected.value = item ?? null;
  sensitivities.value = item ? [...item.allowedSensitivities] : [];
}
function selectMobileDepartment(value: string | number | Array<string | number>): void {
  const department = String(Array.isArray(value) ? (value[0] ?? '') : value);
  select(departments.value.find((item) => item.department === department));
}
async function save(): Promise<void> {
  if (!selected.value) return;
  saving.value = true;
  try {
    await updateDepartmentPolicy(selected.value.department, sensitivities.value);
    ElMessage.success('部门策略已生效，后续请求将按收紧后的范围鉴权');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}
onMounted(load);
</script>

<style scoped>
.department-directory,
.department-policy {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
  min-height: 0;
}
.department-list-item {
  display: grid;
  align-items: center;
  gap: var(--kb-space-1) var(--kb-space-2);
  grid-template-columns: 1fr auto;
  width: 100%;
  padding: var(--kb-list-row-padding);
  border: 1px solid transparent;
  border-radius: var(--kb-radius-md);
  color: inherit;
  background: transparent;
  text-align: left;
  transition:
    background-color var(--kb-transition-fast),
    border-color var(--kb-transition-fast);
  cursor: pointer;
}
.department-list-item + .department-list-item {
  margin-top: var(--kb-space-1);
}
.department-list-item:hover {
  background: var(--kb-color-canvas);
}
.department-list-item:focus-visible {
  border-color: var(--kb-color-primary);
  outline: none;
}
.department-list-item.is-active {
  border-color: color-mix(in srgb, var(--kb-color-primary) 30%, var(--kb-color-border));
  background: var(--kb-color-primary-soft);
}
.department-policy-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: stretch;
  gap: var(--kb-space-4);
  overflow: auto;
  min-height: 0;
  padding: var(--kb-block-padding);
}
.department-panel__header {
  display: flex;
  flex: 0 0 auto;
  justify-content: space-between;
  align-items: center;
  gap: var(--kb-space-2);
  min-width: 0;
  padding: var(--kb-block-padding) var(--kb-space-4);
  border-bottom: 1px solid var(--kb-color-border);
}
.department-panel__count {
  padding: 0 var(--kb-space-2);
  border-radius: var(--kb-radius-pill);
  background: var(--kb-color-canvas);
}

/* 敏感度选择：普通 checkbox，横向排列 */
.policy-sensitivity-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--kb-space-2) var(--kb-space-4);
}
.department-policy-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--kb-block-padding);
}

.mobile-inline-editor {
  display: grid;
  gap: var(--kb-layout-gap);
  margin-top: var(--kb-space-element);
  padding-top: var(--kb-block-padding);
  border-top: 1px solid var(--kb-color-border-light);
}
.mobile-inline-editor__submit {
  width: 100%;
}

/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .department-layout {
    display: block;
  }
  .department-layout > .kb-collapse-list {
    border: 0;
  }
}
</style>
