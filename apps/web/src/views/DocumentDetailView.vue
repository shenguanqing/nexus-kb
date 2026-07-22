<script setup lang="ts">
import type { DocumentDetail, IngestionJob, Sensitivity } from '@nexus-kb/contracts';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/client';
import {
  deleteDocument,
  fetchDocument,
  reindexDocument,
  updateDocumentMetadata,
} from '@/api/documents';
import { listIngestionJobs } from '@/api/ingestion';
import { documentDetailReturn } from '@/router/return-navigation';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const documentId = String(route.params.id);
const document = ref<DocumentDetail | null>(null);
const jobs = ref<IngestionJob[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const mutating = ref(false);
const metadataVisible = ref(false);
const metadataDepartment = ref('');
const metadataSensitivity = ref<Sensitivity>('internal');
const documentStatusLabels: Record<string, string> = {
  uploaded: '已上传',
  processing: '处理中',
  prepared: '待建立索引',
  active: '已生效',
  policy_blocked: '策略阻止',
  failed: '失败',
  deleted: '已删除',
};
const canWrite = computed(() => auth.hasCapability('documents:write'));
const canDelete = computed(() => auth.hasCapability('documents:delete'));
const backNavigation = computed(() => documentDetailReturn(route.query.from));
const allTasksTarget = computed(() => ({
  path: '/ingestion-jobs',
  query: {
    documentId,
    returnTo: `/documents/${documentId}`,
  },
}));
const activeVersion = computed(() =>
  document.value?.versions.find((version) => version.version === document.value?.activeVersion),
);

function documentStatusLabel(status: string): string {
  return documentStatusLabels[status] ?? status;
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [detail, taskPage] = await Promise.all([
      fetchDocument(documentId),
      listIngestionJobs({ documentId, page: 1, pageSize: 20 }),
    ]);
    document.value = detail;
    jobs.value = taskPage.items;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '文档详情加载失败';
  } finally {
    loading.value = false;
  }
}

async function reindex(): Promise<void> {
  if (!document.value) return;
  const isPrepared = document.value.status === 'prepared';
  await ElMessageBox.confirm(
    isPrepared
      ? `将继续为“${document.value.sourceName}”生成本地向量并建立索引，不会重复解析或上传原文件。`
      : `将为“${document.value.sourceName}”创建新版本。旧版本会在新索引验证并原子激活前继续提供查询。`,
    isPrepared ? '激活待索引文档' : '确认重新索引',
    {
      confirmButtonText: isPrepared ? '继续入库' : '开始重建',
      cancelButtonText: '取消',
      type: 'warning',
    },
  );
  mutating.value = true;
  try {
    const accepted = await reindexDocument(document.value.id);
    ElMessage.success(`版本 v${accepted.documentVersion} 已进入队列`);
    await router.push(`/ingestion-jobs?documentId=${document.value.id}`);
  } catch (error) {
    if (error !== 'cancel')
      ElMessage.error(error instanceof ApiError ? error.message : '重新索引失败');
  } finally {
    mutating.value = false;
  }
}

async function remove(): Promise<void> {
  if (!document.value) return;
  await ElMessageBox.confirm(
    `删除“${document.value.sourceName}”将移除原文件、全部版本向量和可识别缓存，此操作不可撤销。`,
    '永久删除文档',
    {
      confirmButtonText: '永久删除',
      confirmButtonClass: 'el-button--danger',
      cancelButtonText: '取消',
      type: 'error',
    },
  );
  mutating.value = true;
  try {
    await deleteDocument(document.value.id);
    ElMessage.success('文档及其索引已删除');
    await router.replace('/documents');
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error instanceof ApiError ? error.message : '删除失败');
  } finally {
    mutating.value = false;
  }
}

function openMetadata(): void {
  if (!document.value) return;
  metadataDepartment.value = document.value.department;
  metadataSensitivity.value = document.value.sensitivity;
  metadataVisible.value = true;
}

async function saveMetadata(): Promise<void> {
  if (!document.value) return;
  mutating.value = true;
  try {
    const accepted = await updateDocumentMetadata(
      document.value.id,
      metadataDepartment.value,
      metadataSensitivity.value,
    );
    ElMessage.success(`权限 metadata 已更新，v${accepted.documentVersion} 正在安全重建`);
    metadataVisible.value = false;
    await router.push(`/ingestion-jobs?documentId=${document.value.id}`);
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : 'metadata 更新失败');
  } finally {
    mutating.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section v-loading="loading" class="document-detail-page">
    <div class="page-content">
      <div v-if="errorMessage" class="document-error" role="alert">
        <strong>无法加载文档详情</strong><span>{{ errorMessage }}</span
        ><el-button @click="load">重试</el-button>
      </div>
      <template v-else-if="document">
        <header class="detail-actions">
          <div>
            <RouterLink :to="backNavigation.to" class="back-link"
              >← {{ backNavigation.label }}</RouterLink
            >
            <h2>{{ document.sourceName }}</h2>
            <p>{{ document.mimeType }}</p>
          </div>
          <div class="detail-action-buttons">
            <el-button
              v-if="canWrite"
              :disabled="document.status !== 'active'"
              @click="openMetadata"
              >修改权限 metadata</el-button
            >
            <el-button
              v-if="canWrite"
              :loading="mutating"
              :disabled="document.status !== 'active' && document.status !== 'prepared'"
              @click="reindex"
              >{{ document.status === 'prepared' ? '继续建立索引' : '重新索引' }}</el-button
            ><el-button
              v-if="canDelete"
              class="delete-document-button"
              type="danger"
              :loading="mutating"
              @click="remove"
              >删除文档</el-button
            >
          </div>
        </header>

        <div class="detail-grid">
          <article class="detail-card">
            <h3>基本信息</h3>
            <dl>
              <div>
                <dt>状态</dt>
                <dd>{{ documentStatusLabel(document.status) }}</dd>
              </div>
              <div>
                <dt>部门</dt>
                <dd>{{ document.department }}</dd>
              </div>
              <div>
                <dt>敏感度</dt>
                <dd>{{ document.sensitivity }}</dd>
              </div>
              <div>
                <dt>所有者</dt>
                <dd>{{ document.ownerId }}</dd>
              </div>
              <div>
                <dt>当前版本</dt>
                <dd>{{ document.activeVersion ? `v${document.activeVersion}` : '尚未激活' }}</dd>
              </div>
              <div>
                <dt>更新时间</dt>
                <dd>{{ new Date(document.updatedAt).toLocaleString() }}</dd>
              </div>
            </dl>
          </article>
          <article class="detail-card">
            <h3>当前索引</h3>
            <dl>
              <div>
                <dt>分块数</dt>
                <dd>{{ activeVersion?.chunkCount ?? 0 }}</dd>
              </div>
              <div>
                <dt>解析器</dt>
                <dd>{{ activeVersion?.parser ?? '—' }} {{ activeVersion?.parserVersion ?? '' }}</dd>
              </div>
              <div>
                <dt>Embedding 指纹</dt>
                <dd class="fingerprint">{{ activeVersion?.embeddingFingerprint ?? '尚未生成' }}</dd>
              </div>
            </dl>
            <ul v-if="activeVersion?.warnings.length">
              <li v-for="warning in activeVersion.warnings" :key="warning">{{ warning }}</li>
            </ul>
          </article>
        </div>

        <article class="detail-card">
          <div class="card-title">
            <h3>版本历史</h3>
            <RouterLink :to="allTasksTarget">查看全部任务</RouterLink>
          </div>
          <el-table :data="document.versions" row-key="version"
            ><el-table-column label="版本" width="90"
              ><template #default="scope">v{{ scope.row.version }}</template></el-table-column
            ><el-table-column label="状态" width="140"
              ><template #default="scope">{{
                documentStatusLabel(scope.row.status)
              }}</template></el-table-column
            ><el-table-column prop="chunkCount" label="分块" width="100" /><el-table-column
              prop="parserVersion"
              label="解析器版本"
            /><el-table-column label="创建时间"
              ><template #default="scope">{{
                new Date(scope.row.createdAt).toLocaleString()
              }}</template></el-table-column
            ></el-table
          >
        </article>
        <el-dialog v-model="metadataVisible" title="修改权限 metadata" width="480px">
          <el-form label-position="top"
            ><el-form-item label="部门"
              ><el-input v-model="metadataDepartment" maxlength="128" /></el-form-item
            ><el-form-item label="敏感度"
              ><el-select v-model="metadataSensitivity"
                ><el-option label="公开" value="public" /><el-option
                  label="内部"
                  value="internal" /><el-option
                  label="机密"
                  value="confidential" /></el-select></el-form-item
          ></el-form>
          <p class="upload-warning">
            修改后会创建新版本并重建索引；旧向量在激活前仍受 PostgreSQL 最新 ACL 二次鉴权。
          </p>
          <template #footer
            ><el-button @click="metadataVisible = false">取消</el-button
            ><el-button type="primary" :loading="mutating" @click="saveMetadata"
              >保存并重建</el-button
            ></template
          >
        </el-dialog>

        <article v-if="jobs.length" class="detail-card">
          <h3>最近任务</h3>
          <ul class="recent-jobs">
            <li v-for="job in jobs.slice(0, 5)" :key="job.id">
              <RouterLink :to="allTasksTarget"
                >v{{ job.version }} · {{ job.status }} · {{ job.step }}</RouterLink
              ><time>{{ new Date(job.updatedAt).toLocaleString() }}</time>
            </li>
          </ul>
        </article>
      </template>
    </div>
  </section>
</template>
