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
<template>
  <section class="department-page" v-loading="loading">
    <div v-if="errorMessage" class="document-error" role="alert">
      <strong>无法加载部门</strong><span>{{ errorMessage }}</span>
      <el-button @click="load">重试</el-button>
    </div>
    <div v-else class="department-layout">
      <nav v-if="!isMobile" class="department-list-panel" aria-label="部门列表">
        <div class="heading heading--h2 scroll-section-title" role="heading" aria-level="2">
          部门列表
        </div>
        <div class="department-list">
          <button
            v-for="item in departments"
            :key="item.department"
            type="button"
            :class="{ active: selected?.department === item.department }"
            @click="select(item)"
          >
            <strong>{{ item.department }}</strong>
            <span>{{ item.userCount }} 位用户 · {{ item.documentCount }} 份文档</span>
          </button>
        </div>
      </nav>
      <article v-if="selected && !isMobile" class="department-policy-card">
        <div class="heading heading--h2" role="heading" aria-level="2">
          {{ selected.department }}权限
        </div>
        <div class="department-policy-body">
          <div>该策略只能收紧身份源声明的敏感度，不能扩大用户权限。</div>
          <el-checkbox-group v-model="sensitivities" :disabled="!canWrite">
            <el-checkbox value="public">公开</el-checkbox>
            <el-checkbox value="internal">内部</el-checkbox>
            <el-checkbox value="confidential">机密</el-checkbox>
          </el-checkbox-group>
          <el-button
            v-if="canWrite"
            type="primary"
            :disabled="sensitivities.length === 0"
            :loading="saving"
            @click="save"
          >
            保存并生效
          </el-button>
        </div>
      </article>
      <div v-if="isMobile" class="department-mobile-list">
        <el-collapse v-model="expandedDepartment" accordion @change="selectMobileDepartment">
          <el-collapse-item
            v-for="item in departments"
            :key="item.department"
            :name="item.department"
          >
            <template #title>
              <div class="department-mobile-summary">
                <div>{{ item.department }}</div>
                <div>{{ item.userCount }} 位用户 · {{ item.documentCount }} 份文档</div>
              </div>
            </template>
            <div class="text-block">该策略只能收紧身份源声明的敏感度，不能扩大用户权限。</div>
            <div class="mobile-inline-editor">
              <el-checkbox-group v-model="sensitivities" :disabled="!canWrite || saving">
                <el-checkbox value="public">公开</el-checkbox>
                <el-checkbox value="internal">内部</el-checkbox>
                <el-checkbox value="confidential">机密</el-checkbox>
              </el-checkbox-group>
              <el-button
                v-if="canWrite"
                type="primary"
                :disabled="sensitivities.length === 0"
                :loading="saving"
                @click="save"
              >
                保存权限
              </el-button>
            </div>
          </el-collapse-item>
        </el-collapse>
      </div>
      <el-empty v-if="departments.length === 0" description="暂无部门数据" />
    </div>
  </section>
</template>
