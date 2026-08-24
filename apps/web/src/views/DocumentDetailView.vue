<template>
  <section v-loading="loading" class="document-detail-page kb-page">
    <div v-if="errorMessage" class="kb-error-state" role="alert">
      <strong class="kb-text kb-text--danger">无法加载文档详情</strong>
      <span>{{ errorMessage }}</span>
      <el-button @click="load">重试</el-button>
    </div>
    <template v-else-if="document">
      <header class="detail-actions kb-block kb-status-toolbar">
        <div class="detail-title kb-title-group">
          <div class="kb-heading kb-heading--h4 kb-block__title" role="heading" aria-level="2">
            {{ document.sourceName }}
          </div>
          <span class="kb-text kb-text--secondary">{{ document.mimeType }}</span>
        </div>
        <el-button
          v-if="isMobile"
          class="mobile-actions-trigger"
          text
          circle
          aria-label="打开文档操作面板"
          @click="mobileActionsVisible = true"
        >
          <el-icon><MoreFilled /></el-icon>
        </el-button>
        <div v-else class="detail-action-buttons kb-action-group">
          <RouterLink
            :to="{ path: `/documents/${document.id}/preview`, query: { from: route.fullPath } }"
          >
            <el-button>预览文档</el-button>
          </RouterLink>
          <el-button v-if="canWrite" :disabled="document.status !== 'active'" @click="openMetadata">
            修改权限
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

      <div class="detail-content kb-page__content">
        <div class="kb-block-list detail-grid">
          <article class="kb-block">
            <div class="kb-block__header">
              <div class="kb-block__title kb-heading kb-heading--h4">基本信息</div>
            </div>
            <div class="kb-data-fields">
              <div class="kb-data-field">
                <span class="kb-data-field__label">文档 ID</span>
                <span
                  class="kb-data-field__value"
                  :aria-label="`复制文档 ID ${document.id}`"
                  title="点击复制文档 ID"
                  @click="copyDocumentId"
                >
                  {{ document.id }}
                </span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">状态 </span>
                <span class="kb-data-field__value">
                  {{ documentStatusLabel(document.status) }}
                </span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">部门 </span>
                <span class="kb-data-field__value">
                  {{ document.department }}
                </span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">敏感度 </span>
                <span class="kb-data-field__value">
                  {{ document.sensitivity }}
                </span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">所有者 </span>
                <span class="kb-data-field__value">
                  {{ document.ownerId }}
                </span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">当前版本 </span>
                <span class="kb-data-field__value">
                  {{ document.activeVersion ? `v${document.activeVersion}` : '尚未激活' }}
                </span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">更新时间 </span>
                <span class="kb-data-field__value">
                  {{ new Date(document.updatedAt).toLocaleString() }}
                </span>
              </div>
            </div>
          </article>
          <article class="kb-block">
            <div class="kb-block__header">
              <div class="kb-block__title kb-heading kb-heading--h4">当前向量索引</div>
              <RouterLink
                v-if="activeVersion?.chunkCount"
                v-slot="{ href, navigate }"
                :to="chunksTarget"
                custom
              >
                <el-link
                  class="kb-link"
                  type="primary"
                  underline="never"
                  :href="href"
                  @click="navigate"
                >
                  <span class="kb-link__text">查看全部分块</span>
                </el-link>
              </RouterLink>
            </div>
            <div class="kb-data-fields">
              <div class="kb-data-field">
                <span class="kb-data-field__label">向量库 </span>
                <span class="kb-data-field__value">
                  {{ activeVersion?.vectorCollection ?? '尚未写入' }}
                </span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">向量数（分块） </span>
                <span class="kb-data-field__value">
                  {{ activeVersion?.chunkCount ?? 0 }}
                </span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">解析器 </span>
                <span class="kb-data-field__value">
                  {{ activeVersion?.parser ?? '—' }}
                  {{ activeVersion?.parserVersion ?? '' }}
                </span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">Embedding 指纹 </span>
                <span class="kb-data-field__value">
                  {{ activeVersion?.embeddingFingerprint ?? '尚未生成' }}
                </span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">写入时间 </span>
                <span class="kb-data-field__value">
                  {{
                    activeVersion?.indexedAt
                      ? new Date(activeVersion.indexedAt).toLocaleString()
                      : '—'
                  }}
                </span>
              </div>
            </div>
            <div v-if="hasDwgConversion" class="conversion-note">
              <div class="conversion-label">格式转换说明</div>
              <div class="conversion-value">
                原始 DWG<span v-if="dwgSourceVersion">（版本 {{ dwgSourceVersion }}）</span>
                已自动转换为 DXF 后解析入库
              </div>
            </div>
            <div v-if="visibleIndexWarnings.length" class="index-warning-list">
              <div
                v-for="warning in visibleIndexWarnings"
                :key="warning"
                class="recent-jobs-item kb-text kb-text--warning"
              >
                {{ warning }}
              </div>
            </div>
          </article>
        </div>

        <article class="kb-block">
          <div class="kb-block__header">
            <div class="kb-block__title kb-heading kb-heading--h4">版本历史</div>
            <RouterLink v-slot="{ href, navigate }" :to="allTasksTarget" custom>
              <el-link
                class="kb-link"
                type="primary"
                underline="never"
                :href="href"
                @click="navigate"
              >
                <span class="kb-link__text">查看全部任务</span>
              </el-link>
            </RouterLink>
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
            <el-table-column label="状态" width="100">
              <template #default="scope">
                <el-tag :type="documentStatusType(scope.row.status)" effect="plain">
                  {{ documentStatusLabel(scope.row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="chunkCount" label="分块" width="100" />
            <el-table-column label="向量库" min-width="400">
              <template #default="scope">
                <span>{{ scope.row.vectorCollection ?? '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="parserVersion" label="解析器版本" min-width="200" />
            <el-table-column label="创建时间" min-width="180">
              <template #default="scope">
                {{ new Date(scope.row.createdAt).toLocaleString() }}
              </template>
            </el-table-column>
          </el-table>
          <div v-else-if="document.versions.length" class="kb-block-list" aria-label="版本历史">
            <article v-for="version in document.versions" :key="version.version" class="kb-block">
              <div class="kb-block__header">
                <div class="kb-block__title kb-heading kb-heading--h4">
                  版本 v{{ version.version }}
                </div>
                <el-tag :type="documentStatusType(version.status)" effect="plain">
                  {{ documentStatusLabel(version.status) }}
                </el-tag>
              </div>
              <div class="kb-data-fields">
                <div class="kb-data-field">
                  <span class="kb-data-field__label">分块 </span>
                  <span class="kb-data-field__value">{{ version.chunkCount }} </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">解析器 </span>
                  <span class="kb-data-field__value">
                    {{ version.parserVersion }}
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">向量库 </span>
                  <span class="kb-data-field__value">
                    {{ version.vectorCollection ?? '—' }}
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">创建时间 </span>
                  <span class="kb-data-field__value">
                    {{ new Date(version.createdAt).toLocaleString() }}
                  </span>
                </div>
              </div>
            </article>
          </div>
        </article>
        <el-dialog
          v-if="!isMobile"
          v-model="metadataVisible"
          class="metadata-dialog"
          title="修改权限"
          width="min(480px, calc(100vw - 28px))"
          align-center
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
          <div class="upload-warning kb-text">
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
          direction="btt"
          size="auto"
          title="修改权限"
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
          <div class="upload-warning kb-text">
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
          :is="isMobile ? ElDrawer : ElDialog"
          :model-value="dangerAction !== null"
          title="确认高风险操作"
          :width="isMobile ? undefined : 'min(520px, calc(100vw - 28px))'"
          align-center
          :size="isMobile ? 'auto' : undefined"
          :direction="isMobile ? 'btt' : undefined"
          append-to-body
          @update:model-value="
            (visible: boolean) => {
              if (!visible) dangerAction = null;
            }
          "
        >
          <template v-if="document && dangerAction">
            <div class="document-dialog-body">
              <div v-if="dangerAction === 'delete'" class="kb-text kb-text--danger">
                删除将永久移除原文件、全部版本向量和可识别缓存，且无法撤销。
              </div>
              <div v-else class="kb-text">
                将创建新的索引版本；旧版本会持续服务，直至新版本通过验证并原子激活。
              </div>
              <div class="kb-text kb-text--md kb-text--secondary">
                请输入文档名 <strong>{{ document.sourceName }}</strong> 以确认。
              </div>
              <el-input v-model="confirmationName" aria-label="输入文档名确认" />
            </div>
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

        <article v-if="jobs.length" class="kb-block">
          <div class="kb-block__header">
            <div class="kb-block__title kb-heading kb-heading--h4">最近任务</div>
          </div>
          <div class="recent-jobs kb-data-fields">
            <div
              v-for="job in jobs.slice(0, 5)"
              :key="job.id"
              class="recent-jobs-item kb-data-field"
            >
              <RouterLink v-slot="{ href, navigate }" :to="allTasksTarget" custom>
                <el-link
                  class="kb-link"
                  type="primary"
                  underline="never"
                  :href="href"
                  @click="navigate"
                >
                  <span class="kb-link__text">
                    v{{ job.version }} · {{ job.status }} · {{ job.step }}
                  </span>
                </el-link>
              </RouterLink>
              <time class="recent-job-time kb-text kb-text--secondary">
                {{ new Date(job.updatedAt).toLocaleString() }}
              </time>
            </div>
          </div>
        </article>

        <el-drawer
          v-if="isMobile"
          v-model="mobileActionsVisible"
          class="mobile-action-drawer"
          direction="btt"
          size="auto"
          title="文档操作"
          append-to-body
        >
          <div class="mobile-action-list">
            <RouterLink
              class="mobile-action-item"
              :to="{ path: `/documents/${document.id}/preview`, query: { from: route.fullPath } }"
              @click="closeMobileActions"
            >
              <el-icon class="mobile-action-icon"><View /></el-icon>
              <span>预览文档</span>
              <span class="mobile-action-chevron" aria-hidden="true">›</span>
            </RouterLink>
            <el-button
              v-if="canWrite"
              class="mobile-action-item"
              :disabled="document.status !== 'active'"
              @click="openMetadataFromMobile"
            >
              <el-icon class="mobile-action-icon"><Lock /></el-icon>
              <span>修改权限</span>
              <span class="mobile-action-chevron" aria-hidden="true">›</span>
            </el-button>
            <el-button
              v-if="canWrite"
              class="mobile-action-item"
              :disabled="document.status !== 'active' && document.status !== 'prepared'"
              @click="requestReindexFromMobile"
            >
              <el-icon class="mobile-action-icon"><Refresh /></el-icon>
              <span>{{ document.status === 'prepared' ? '继续建立索引' : '重新索引' }}</span>
              <span class="mobile-action-chevron" aria-hidden="true">›</span>
            </el-button>
            <el-button
              v-if="canDelete"
              class="mobile-action-item mobile-action-item--danger"
              @click="requestRemovalFromMobile"
            >
              <el-icon class="mobile-action-icon"><Delete /></el-icon>
              <span>删除文档</span>
              <span class="mobile-action-chevron" aria-hidden="true">›</span>
            </el-button>
          </div>
        </el-drawer>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import type { DocumentDetail, IngestionJob, Sensitivity } from '@nexus-kb/contracts';
import { Delete, Lock, MoreFilled, Refresh, View } from '@element-plus/icons-vue';
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
const { isMobile } = useBreakpoint();
const documentId = String(route.params.id);
const document = ref<DocumentDetail | null>(null);
const jobs = ref<IngestionJob[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const mutating = ref(false);
const metadataVisible = ref(false);
const mobileActionsVisible = ref(false);
const metadataDepartment = ref('');
const metadataSensitivity = ref<Sensitivity>('internal');
const dangerAction = ref<'reindex' | 'delete' | null>(null);
const confirmationName = ref('');
const documentStatusLabels: Record<string, string> = {
  uploaded: '已上传',
  processing: '处理中',
  prepared: '待建立索引',
  active: '已生效',
  superseded: '已被替代',
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
const dwgSourceVersion = computed(() => {
  const warning = activeVersion.value?.warnings.find((item) =>
    item.startsWith('DWG_SOURCE_VERSION:'),
  );
  return warning?.slice('DWG_SOURCE_VERSION:'.length) ?? null;
});
const hasDwgConversion = computed(
  () => activeVersion.value?.warnings.includes('DWG_CONVERTED_TO_DXF') ?? false,
);
const visibleIndexWarnings = computed(
  () =>
    activeVersion.value?.warnings.filter(
      (warning) => warning !== 'DWG_CONVERTED_TO_DXF' && !warning.startsWith('DWG_SOURCE_VERSION:'),
    ) ?? [],
);

function documentStatusLabel(status: string): string {
  return documentStatusLabels[status] ?? status;
}

async function copyDocumentId(): Promise<void> {
  if (!document.value) return;
  try {
    await navigator.clipboard.writeText(document.value.id);
    ElMessage.success('文档 ID 已复制');
  } catch {
    ElMessage.error('复制失败，请手动选择文档 ID');
  }
}

function documentStatusType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'active') return 'success';
  if (status === 'prepared' || status === 'processing') return 'warning';
  if (status === 'failed' || status === 'policy_blocked' || status === 'deleted') return 'danger';
  return 'info';
}

function closeMobileActions(): void {
  mobileActionsVisible.value = false;
}

function openMetadataFromMobile(): void {
  closeMobileActions();
  openMetadata();
}

function requestReindexFromMobile(): void {
  closeMobileActions();
  requestReindex();
}

function requestRemovalFromMobile(): void {
  closeMobileActions();
  requestRemoval();
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

<style scoped>
/* 顶部操作栏（标题 + 桌面按钮 / 移动端触发器） */
.detail-actions {
  flex: 0 0 auto;
}
.detail-title {
  overflow: hidden;
}
.mobile-actions-trigger {
  width: var(--kb-space-12);
  height: var(--kb-space-12);
  min-width: var(--kb-space-12);
  color: var(--kb-color-text-primary);
}
.detail-action-buttons {
  justify-content: flex-end;
  gap: var(--kb-space-2);
  width: fit-content;
}
.delete-document-button {
  min-width: 96px;
}

/* 基本信息 / 索引信息 */
.detail-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.conversion-note {
  display: flex;
  justify-content: space-between;
  gap: var(--kb-block-padding);
  padding: var(--kb-list-row-padding);
  border-radius: var(--kb-radius-md);
  color: var(--kb-color-primary-dark);
  background: var(--kb-color-nav-accent);
}
.conversion-label {
  font-weight: bold;
}
.conversion-value {
  text-align: right;
}
.index-warning-list {
  display: grid;
  gap: var(--kb-space-2);
  margin-top: var(--kb-list-row-padding);
}
.index-warning-list .recent-jobs-item {
  padding: var(--kb-list-row-padding);
  border-radius: var(--kb-radius-md);
  background: color-mix(in srgb, var(--kb-color-warning) 10%, var(--kb-color-surface));
}

/* 最近任务 */
.recent-jobs .recent-jobs-item {
  align-items: center;
}
.recent-job-time {
  font-size: 13px;
  text-align: right;
}

/* 移动端底部操作面板 */
.document-dialog-body,
.mobile-action-list {
  display: grid;
  gap: var(--kb-layout-gap);
}
.mobile-action-item {
  display: grid;
  align-items: center;
  gap: var(--kb-layout-gap);
  grid-template-columns: 28px minmax(0, 1fr) auto;
  width: 100%;
  min-height: 48px;
  padding: 0 var(--kb-list-row-padding);
  border: 1px solid var(--kb-color-border-light);
  border-radius: var(--kb-radius-md);
  color: var(--kb-color-text-primary);
  background: var(--kb-color-canvas);
  font: inherit;
  font-weight: 600;
  text-align: left;
  /* 触屏上按下要有即时反馈，用 transform+transition 而非依赖 hover */
  transition:
    background-color 0.12s ease,
    transform 0.06s ease;
}
.el-button.mobile-action-item :deep(> span) {
  display: contents;
}
.mobile-action-item:active {
  background: var(--kb-color-primary-soft);
  transform: scale(0.98);
}
.mobile-action-item:disabled {
  opacity: var(--kb-opacity-disabled);
  cursor: not-allowed;
}
.mobile-action-item--danger {
  border-color: color-mix(in srgb, var(--kb-color-danger) 28%, var(--kb-color-border));
  color: var(--kb-color-danger);
  background: var(--kb-color-danger-soft);
}
.mobile-action-item--danger:active {
  background: color-mix(in srgb, var(--kb-color-danger) 14%, var(--kb-color-surface));
}
.mobile-action-icon {
  flex: 0 0 auto;
  font-size: 18px;
}
.mobile-action-chevron {
  color: var(--kb-color-text-secondary);
  font-size: 21px;
  font-style: normal;
}

/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .document-detail-page {
    overflow-y: auto;
  }
  .detail-content {
    flex: none;
    overflow: visible;
    min-height: auto;
  }
  .detail-actions {
    align-items: flex-start;
  }
  .detail-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
