<script setup lang="ts">
import type { DocumentDetail, IngestionJob, Sensitivity } from '@nexus-kb/contracts';
import { ElDialog, ElDrawer, ElMessage } from 'element-plus';
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
import { useAuthStore } from '@/stores/auth';
import { useBreakpoint } from '@/composables/useBreakpoint';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { isMobile, isPhone } = useBreakpoint();
const documentId = String(route.params.id);
const document = ref<DocumentDetail | null>(null);
const jobs = ref<IngestionJob[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const mutating = ref(false);
const metadataVisible = ref(false);
const metadataDepartment = ref('');
const metadataSensitivity = ref<Sensitivity>('internal');
const dangerAction = ref<'reindex' | 'delete' | null>(null);
const confirmationName = ref('');
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
const chunksTarget = computed(() => ({
  path: `/documents/${documentId}/chunks`,
  query: activeVersion.value ? { version: String(activeVersion.value.version) } : {},
}));

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

function requestReindex(): void {
  confirmationName.value = '';
  dangerAction.value = 'reindex';
}

function requestRemoval(): void {
  confirmationName.value = '';
  dangerAction.value = 'delete';
}

async function reindex(): Promise<void> {
  if (!document.value) return;
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

async function confirmDangerAction(): Promise<void> {
  if (
    !document.value ||
    confirmationName.value !== document.value.sourceName ||
    !dangerAction.value
  )
    return;
  const action = dangerAction.value;
  dangerAction.value = null;
  if (action === 'delete') await remove();
  else await reindex();
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
        <strong>无法加载文档详情</strong><span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>
      <template v-else-if="document">
        <header class="detail-actions">
          <div>
            <div class="heading heading--h2" role="heading" aria-level="2">
              {{ document.sourceName }}
            </div>
            <div class="text-block">{{ document.mimeType }}</div>
          </div>
          <div class="detail-action-buttons">
            <el-button
              v-if="canWrite"
              :disabled="document.status !== 'active'"
              @click="openMetadata"
            >
              修改权限 metadata
            </el-button>
            <el-button
              v-if="canWrite"
              :loading="mutating"
              :disabled="document.status !== 'active' && document.status !== 'prepared'"
              @click="requestReindex"
            >
              {{ document.status === 'prepared' ? '继续建立索引' : '重新索引' }}
            </el-button>
            <el-button
              v-if="canDelete"
              class="delete-document-button"
              type="danger"
              :loading="mutating"
              @click="requestRemoval"
            >
              删除文档
            </el-button>
          </div>
        </header>

        <div class="detail-grid">
          <article class="detail-card">
            <div class="heading heading--h3" role="heading" aria-level="3">基本信息</div>
            <div class="data-list">
              <div>
                <span>状态</span><strong>{{ documentStatusLabel(document.status) }}</strong>
              </div>
              <div>
                <span>部门</span><strong>{{ document.department }}</strong>
              </div>
              <div>
                <span>敏感度</span><strong>{{ document.sensitivity }}</strong>
              </div>
              <div>
                <span>所有者</span><strong>{{ document.ownerId }}</strong>
              </div>
              <div>
                <span>当前版本</span
                ><strong>{{
                  document.activeVersion ? `v${document.activeVersion}` : '尚未激活'
                }}</strong>
              </div>
              <div>
                <span>更新时间</span
                ><strong>{{ new Date(document.updatedAt).toLocaleString() }}</strong>
              </div>
            </div>
          </article>
          <article class="detail-card">
            <div class="card-title">
              <div class="heading heading--h3" role="heading" aria-level="3">当前向量索引</div>
              <RouterLink v-if="activeVersion?.chunkCount" :to="chunksTarget">
                查看全部分块
              </RouterLink>
            </div>
            <div class="data-list">
              <div>
                <span>向量库</span>
                <strong class="fingerprint">
                  {{ activeVersion?.vectorCollection ?? '尚未写入' }}
                </strong>
              </div>
              <div>
                <span>向量数（分块）</span><strong>{{ activeVersion?.chunkCount ?? 0 }}</strong>
              </div>
              <div>
                <span>解析器</span>
                <strong>
                  {{ activeVersion?.parser ?? '—' }}
                  {{ activeVersion?.parserVersion ?? '' }}
                </strong>
              </div>
              <div>
                <span>Embedding 指纹</span>
                <strong class="fingerprint">
                  {{ activeVersion?.embeddingFingerprint ?? '尚未生成' }}
                </strong>
              </div>
              <div>
                <span>写入时间</span>
                <strong>
                  {{
                    activeVersion?.indexedAt
                      ? new Date(activeVersion.indexedAt).toLocaleString()
                      : '—'
                  }}
                </strong>
              </div>
            </div>
            <div v-if="activeVersion?.warnings.length" class="list-block">
              <div v-for="warning in activeVersion.warnings" :key="warning" class="list-item">
                {{ warning }}
              </div>
            </div>
          </article>
        </div>

        <article class="detail-card">
          <div class="card-title">
            <div class="heading heading--h3" role="heading" aria-level="3">版本历史</div>
            <RouterLink :to="allTasksTarget">查看全部任务</RouterLink>
          </div>
          <el-table
            v-if="!isMobile"
            class="desktop-data-table"
            :data="document.versions"
            row-key="version"
          >
            <el-table-column label="版本" width="90">
              <template #default="scope">v{{ scope.row.version }}</template>
            </el-table-column>
            <el-table-column label="状态" width="140">
              <template #default="scope">
                {{ documentStatusLabel(scope.row.status) }}
              </template>
            </el-table-column>
            <el-table-column prop="chunkCount" label="分块" width="100" />
            <el-table-column label="向量库" min-width="220">
              <template #default="scope">
                <span class="fingerprint">{{ scope.row.vectorCollection ?? '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="parserVersion" label="解析器版本" />
            <el-table-column label="创建时间">
              <template #default="scope">
                {{ new Date(scope.row.createdAt).toLocaleString() }}
              </template>
            </el-table-column>
          </el-table>
          <div v-else-if="document.versions.length" class="mobile-data-list" aria-label="版本历史">
            <article
              v-for="version in document.versions"
              :key="version.version"
              class="mobile-data-card"
            >
              <header>
                <strong>版本 v{{ version.version }}</strong>
                <el-tag>{{ documentStatusLabel(version.status) }}</el-tag>
              </header>
              <div class="mobile-data-fields">
                <div>
                  <span>分块</span><strong>{{ version.chunkCount }}</strong>
                </div>
                <div>
                  <span>解析器</span><strong>{{ version.parserVersion }}</strong>
                </div>
                <div>
                  <span>向量库</span
                  ><strong class="fingerprint">{{ version.vectorCollection ?? '—' }}</strong>
                </div>
                <div>
                  <span>创建时间</span>
                  <strong>{{ new Date(version.createdAt).toLocaleString() }}</strong>
                </div>
              </div>
            </article>
          </div>
        </article>
        <el-dialog
          v-if="!isPhone"
          v-model="metadataVisible"
          class="metadata-dialog"
          title="修改权限 metadata"
          width="min(480px, calc(100vw - 28px))"
          append-to-body
        >
          <el-form label-position="top">
            <el-form-item label="部门">
              <el-input v-model="metadataDepartment" maxlength="128" />
            </el-form-item>
            <el-form-item label="敏感度">
              <el-select v-model="metadataSensitivity">
                <el-option label="公开" value="public" />
                <el-option label="内部" value="internal" />
                <el-option label="机密" value="confidential" />
              </el-select>
            </el-form-item>
          </el-form>
          <div class="upload-warning text-block">
            修改后会创建新版本并重建索引；旧向量在激活前仍受 PostgreSQL 最新 ACL 二次鉴权。
          </div>
          <template #footer>
            <el-button @click="metadataVisible = false">取消</el-button>
            <el-button type="primary" :loading="mutating" @click="saveMetadata">
              保存并重建
            </el-button>
          </template>
        </el-dialog>

        <el-drawer
          v-else
          v-model="metadataVisible"
          class="metadata-drawer"
          direction="rtl"
          size="100%"
          title="修改权限 metadata"
          append-to-body
        >
          <el-form label-position="top">
            <el-form-item label="部门">
              <el-input v-model="metadataDepartment" maxlength="128" />
            </el-form-item>
            <el-form-item label="敏感度">
              <el-select v-model="metadataSensitivity">
                <el-option label="公开" value="public" />
                <el-option label="内部" value="internal" />
                <el-option label="机密" value="confidential" />
              </el-select>
            </el-form-item>
          </el-form>
          <div class="upload-warning text-block">
            修改后会创建新版本并重建索引；旧向量在激活前仍受 PostgreSQL 最新 ACL 二次鉴权。
          </div>
          <template #footer>
            <el-button @click="metadataVisible = false">取消</el-button>
            <el-button type="primary" :loading="mutating" @click="saveMetadata">
              保存并重建
            </el-button>
          </template>
        </el-drawer>

        <component
          :is="isPhone ? ElDrawer : ElDialog"
          :model-value="dangerAction !== null"
          title="确认高风险操作"
          :width="isPhone ? undefined : 'min(520px, calc(100vw - 28px))'"
          :size="isPhone ? '90%' : undefined"
          :direction="isPhone ? 'btt' : undefined"
          append-to-body
          @update:model-value="
            (visible: boolean) => {
              if (!visible) dangerAction = null;
            }
          "
        >
          <template v-if="document && dangerAction">
            <div v-if="dangerAction === 'delete'" class="danger-confirmation-copy text-block">
              删除将永久移除原文件、全部版本向量和可识别缓存，且无法撤销。
            </div>
            <div v-else class="danger-confirmation-copy text-block">
              将创建新的索引版本；旧版本会持续服务，直至新版本通过验证并原子激活。
            </div>
            <div class="text-block">
              请输入文档名 <strong>{{ document.sourceName }}</strong> 以确认。
            </div>
            <el-input v-model="confirmationName" aria-label="输入文档名确认" />
          </template>
          <template #footer>
            <el-button @click="dangerAction = null">取消</el-button>
            <el-button
              :type="dangerAction === 'delete' ? 'danger' : 'primary'"
              :disabled="confirmationName !== document?.sourceName"
              :loading="mutating"
              @click="confirmDangerAction"
            >
              {{ dangerAction === 'delete' ? '永久删除' : '开始重建' }}
            </el-button>
          </template>
        </component>

        <article v-if="jobs.length" class="detail-card">
          <div class="heading heading--h3" role="heading" aria-level="3">最近任务</div>
          <div class="recent-jobs list-block">
            <div v-for="job in jobs.slice(0, 5)" :key="job.id" class="list-item">
              <RouterLink :to="allTasksTarget">
                v{{ job.version }} · {{ job.status }} · {{ job.step }}
              </RouterLink>
              <time>{{ new Date(job.updatedAt).toLocaleString() }}</time>
            </div>
          </div>
        </article>
      </template>
    </div>
  </section>
</template>
