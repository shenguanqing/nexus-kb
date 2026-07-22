<script setup lang="ts">
import type { DepartmentPolicy, Sensitivity } from '@nexus-kb/contracts';
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { listDepartments, updateDepartmentPolicy } from '@/api/access';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const departments = ref<DepartmentPolicy[]>([]);
const selected = ref<DepartmentPolicy | null>(null);
const sensitivities = ref<Sensitivity[]>([]);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const canWrite = computed(
  () => auth.hasCapability('access:write') && auth.identity?.roles.includes('platform_admin'),
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
      <strong>无法加载部门</strong><span>{{ errorMessage }}</span
      ><el-button @click="load">重试</el-button>
    </div>
    <div v-else class="department-layout">
      <nav class="department-list" aria-label="部门列表">
        <button
          v-for="item in departments"
          :key="item.department"
          type="button"
          :class="{ active: selected?.department === item.department }"
          @click="select(item)"
        >
          <strong>{{ item.department }}</strong
          ><span>{{ item.userCount }} 位用户 · {{ item.documentCount }} 份文档</span>
        </button>
      </nav>
      <article v-if="selected" class="department-policy-card">
        <h2>{{ selected.department }}权限</h2>
        <p>该策略只能收紧身份源声明的敏感度，不能扩大用户权限。</p>
        <el-checkbox-group v-model="sensitivities" :disabled="!canWrite"
          ><el-checkbox value="public">公开</el-checkbox
          ><el-checkbox value="internal">内部</el-checkbox
          ><el-checkbox value="confidential">机密</el-checkbox></el-checkbox-group
        ><el-button
          v-if="canWrite"
          type="primary"
          :disabled="sensitivities.length === 0"
          :loading="saving"
          @click="save"
          >保存并生效</el-button
        >
      </article>
      <el-empty v-else description="暂无部门数据" />
    </div>
  </section>
</template>
