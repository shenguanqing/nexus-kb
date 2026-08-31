<template>
  <section class="kb-page">
    <form
      v-if="!isMobile"
      class="documents-toolbar document-filters"
      aria-label="文档筛选"
      @submit.prevent="applyFilters"
    >
      <el-input
        class="documents-filter-search"
        v-model="filters.search"
        clearable
        placeholder="搜索文件名"
      />
      <el-select v-model="filters.status" clearable placeholder="状态">
        <el-option
          v-for="(label, value) in statusLabels"
          :key="value"
          :label="label"
          :value="value"
        />
      </el-select>
      <el-select v-model="filters.sensitivity" clearable placeholder="敏感度">
        <el-option label="公开" value="public" />
        <el-option label="内部" value="internal" />
        <el-option label="机密" value="confidential" />
      </el-select>
      <el-select v-model="filters.format" clearable placeholder="格式">
        <el-option
          v-for="format in [
            'txt',
            'md',
            'pdf',
            'doc',
            'docx',
            'xlsx',
            'png',
            'jpg',
            'jpeg',
            'dxf',
            'dwg',
          ]"
          :key="format"
          :label="format.toUpperCase()"
          :value="format"
        />
      </el-select>
      <div class="kb-filter-actions">
        <el-button native-type="submit">筛选</el-button>
        <el-button @click="resetFilters">重置 </el-button>
      </div>
      <el-button
        v-if="canUpload"
        class="documents-upload-action"
        type="primary"
        @click="openUpload"
      >
        上传文档
      </el-button>
    </form>
    <form
      v-else
      class="documents-toolbar documents-toolbar--mobile"
      aria-label="搜索文档"
      @submit.prevent="applyFilters"
    >
      <el-input v-model="filters.search" clearable maxlength="200" placeholder="搜索文件名" />
      <el-button
        v-if="canUpload"
        class="documents-upload-action"
        type="primary"
        @click="openUpload"
      >
        上传文档
      </el-button>
      <el-button
        class="kb-filter-trigger"
        :class="{ 'kb-filter-trigger--active': hasSecondaryFilters }"
        aria-label="筛选"
        @click="filtersVisible = true"
      >
        筛选
      </el-button>
    </form>
    <template v-if="isMobile">
      <el-drawer
        v-model="filtersVisible"
        direction="btt"
        size="auto"
        title="筛选文档"
        append-to-body
      >
        <form class="kb-filter-form" aria-label="文档筛选" @submit.prevent="applyFilters">
          <el-select v-model="filters.status" clearable placeholder="状态">
            <el-option
              v-for="(label, value) in statusLabels"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
          <el-select v-model="filters.sensitivity" clearable placeholder="敏感度">
            <el-option label="公开" value="public" />
            <el-option label="内部" value="internal" />
            <el-option label="机密" value="confidential" />
          </el-select>
          <el-select v-model="filters.format" clearable placeholder="格式">
            <el-option
              v-for="format in [
                'txt',
                'md',
                'pdf',
                'doc',
                'docx',
                'xlsx',
                'png',
                'jpg',
                'jpeg',
                'dxf',
                'dwg',
              ]"
              :key="format"
              :label="format.toUpperCase()"
              :value="format"
            />
          </el-select>
          <div class="kb-filter-form__actions">
            <el-button @click="resetFilters">重置</el-button>
            <el-button type="primary" native-type="submit">筛选</el-button>
          </div>
        </form>
      </el-drawer>
    </template>

    <div class="kb-block-content">
      <div v-if="errorMessage" class="kb-error-state" role="alert">
        <strong class="kb-text kb-text--danger">无法加载文档</strong><span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>
      <div
        v-else
        v-loading="loading"
        class="kb-block-scroll"
        :class="!isMobile ? 'kb-block kb-block--flush' : ''"
      >
        <el-table
          v-if="!isMobile && items.length > 0"
          class="desktop-data-table"
          :data="items"
          row-key="id"
          height="100%"
        >
          <el-table-column prop="sourceName" label="文件名" min-width="300" fixed="left">
            <template #default="scope">
              <span
                v-if="scope.row.status === 'deleting'"
                class="kb-text kb-text--md kb-text--primary"
              >
                {{ scope.row.sourceName }}
              </span>
              <RouterLink
                v-else
                v-slot="{ href, navigate }"
                :to="`/documents/${scope.row.id}`"
                custom
              >
                <el-link
                  class="kb-link"
                  type="primary"
                  underline="never"
                  :href="href"
                  @click="navigate"
                >
                  <span class="kb-link__text">{{ scope.row.sourceName }}</span>
                </el-link>
              </RouterLink>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="scope">
              <el-tag :type="statusType(scope.row.status)">
                {{ statusLabels[scope.row.status] ?? scope.row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="department" label="部门" width="120" />
          <el-table-column prop="sensitivity" label="敏感度" width="100" />
          <el-table-column label="版本" width="90">
            <template #default="scope">
              {{ scope.row.activeVersion ? `v${scope.row.activeVersion}` : '—' }}
            </template>
          </el-table-column>
          <el-table-column label="更新时间" width="180">
            <template #default="scope">
              {{ new Date(scope.row.updatedAt).toLocaleString() }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="scope">
              <el-button
                v-if="scope.row.status === 'deleting' && canDelete"
                link
                type="danger"
                :loading="cleanupDocumentId === scope.row.id"
                @click="resumeDeletionById(String(scope.row.id))"
              >
                继续清理
              </el-button>
              <span v-else class="kb-text kb-text--sm kb-text--tertiary">—</span>
            </template>
          </el-table-column>
        </el-table>
        <DocumentsCardList
          v-else-if="isMobile"
          :data="items"
          :loading="loading"
          :can-delete="canDelete"
          :cleanup-document-id="cleanupDocumentId"
          :status-label="(status) => statusLabels[status] ?? status"
          :status-type="statusType"
          @resume-delete="resumeDeletion"
        />
        <el-empty v-else-if="!loading" class="kb-empty-state" description="暂无符合条件的文档" />
      </div>
      <div v-if="total > filters.pageSize" class="kb-pagination">
        <el-pagination
          layout="total, prev, pager, next"
          :current-page="filters.page"
          :page-size="filters.pageSize"
          :total="total"
          @current-change="changePage"
        />
      </div>
    </div>

    <component
      :is="isMobile ? ElDrawer : ElDialog"
      v-model="uploadVisible"
      :class="isMobile ? 'documents-upload-drawer' : 'documents-upload-dialog'"
      title="上传文档"
      :width="
        isMobile
          ? undefined
          : isTablet
            ? 'min(400px, calc(100vw - 28px))'
            : 'min(460px, calc(100vw - 28px))'
      "
      align-center
      :size="isMobile ? '90%' : undefined"
      :direction="isMobile ? 'btt' : undefined"
      append-to-body
      :z-index="4000"
      @closed="resetUploadDialog"
    >
      <div
        v-if="uploadOptionsLoading"
        v-loading="true"
        class="documents-upload-options-state kb-text kb-text--secondary"
      >
        正在读取服务器上传限制…
      </div>
      <div v-else-if="uploadOptionsError" class="kb-error-state" role="alert">
        <strong class="kb-text kb-text--danger">上传配置加载失败</strong>
        <span>{{ uploadOptionsError }}</span>
        <el-button @click="loadUploadOptions">重试</el-button>
      </div>
      <div v-if="uploadOptions" class="documents-upload-form">
        <el-upload
          class="documents-upload-picker"
          v-model:file-list="selectedUploadFiles"
          :drag="!isMobile"
          multiple
          :auto-upload="false"
          :show-file-list="false"
          :accept="uploadOptions.acceptedExtensions.map((item) => `.${item}`).join(',')"
          :on-change="chooseFiles"
        >
          <span class="documents-upload-picker-content kb-text kb-text--secondary">
            <el-icon><UploadFilled /></el-icon>
            <span>{{ isMobile ? '选择文件' : '选择或拖入文件' }}</span>
          </span>
          <template #tip>
            <div v-if="!isMobile" class="el-upload__tip">
              文件只会在确认“开始上传”后发送到服务端。
            </div>
          </template>
        </el-upload>
        <small class="kb-text kb-text--xs kb-text--secondary">
          支持
          {{
            uploadOptions.acceptedExtensions.map((item) => item.toUpperCase()).join(' / ')
          }}，单文件最大 {{ Math.ceil(uploadOptions.maxUploadBytes / 1024 / 1024) }} MB。
        </small>
        <div class="documents-upload-metadata" aria-label="上传权限信息">
          <div class="documents-upload-metadata-row">
            <span class="documents-upload-metadata-label kb-text kb-text--secondary">部门</span>
            <strong class="documents-upload-metadata-value kb-text kb-text--medium">
              {{ uploadOptions.department }}
            </strong>
          </div>
          <div class="documents-upload-metadata-row">
            <span class="documents-upload-metadata-label kb-text kb-text--secondary">敏感度</span>
            <strong class="documents-upload-metadata-value kb-text kb-text--medium">
              {{ uploadOptions.defaultSensitivity }}
              <template v-if="!isMobile">（由服务端身份确定）</template>
            </strong>
          </div>
        </div>
        <div
          v-if="uploadOptions.defaultSensitivity === 'confidential'"
          class="documents-upload-warning kb-text kb-text--warning"
        >
          机密内容默认不会发送到云端 Embedding 服务。
        </div>
        <div
          v-if="uploadRows.length"
          class="documents-upload-file-list"
          aria-label="待上传文件"
          tabindex="0"
        >
          <div
            v-for="row in uploadRows"
            :key="`${row.file.name}-${row.file.lastModified}`"
            class="documents-upload-file-item"
            :class="`is-${row.status}`"
          >
            <div class="documents-upload-file-heading">
              <strong class="documents-upload-file-name">{{ row.file.name }}</strong>
              <small v-if="row.status === 'uploading'" class="documents-upload-file-size">
                {{ formatFileSize(row.file.size) }}
              </small>
              <el-tag v-else-if="row.status === 'failed'" type="danger" size="small">
                failed
              </el-tag>
              <el-tag v-else-if="row.status === 'queued'" type="success" size="small">
                queued
              </el-tag>
              <el-tag v-else type="info" size="small">待上传</el-tag>
            </div>
            <template v-if="row.status === 'uploading'">
              <el-progress
                class="documents-upload-file-progress"
                :percentage="row.progress ?? 0"
                :show-text="false"
                :stroke-width="5"
              />
              <small class="documents-upload-progress-label kb-text kb-text--sm kb-text--secondary">
                上传中 {{ row.progress ?? 0 }}%
              </small>
            </template>
            <div v-else-if="row.status === 'failed'" class="documents-upload-file-failure">
              <small
                class="documents-upload-file-error kb-text kb-text--sm kb-text--secondary"
                role="alert"
              >
                {{ row.error }}
              </small>
              <div class="documents-upload-file-actions">
                <el-button
                  class="documents-upload-file-retry"
                  link
                  type="primary"
                  @click="retryUpload(row)"
                >
                  重试
                </el-button>
                <el-button
                  class="documents-upload-file-remove"
                  link
                  type="danger"
                  :aria-label="`删除失败文件：${row.file.name}`"
                  @click="removeUpload(row)"
                >
                  删除
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="uploadVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="uploadRows.length === 0 || !uploadOptions"
          :loading="uploading"
          @click="submitUpload"
        >
          开始上传
        </el-button>
      </template>
    </component>

    <DocumentsDangerConfirm
      v-if="cleanupTarget"
      :model-value="true"
      :document-name="cleanupTarget.sourceName"
      action="cleanup"
      :loading="cleanupDocumentId === cleanupTarget.id"
      :mobile="isMobile"
      @update:model-value="
        (visible: boolean) => {
          if (!visible) cleanupTarget = null;
        }
      "
      @confirm="confirmResumeDeletion"
    />
  </section>
</template>

<script setup lang="ts">
import type {
  DocumentListItem,
  DocumentListRequest,
  DocumentUploadOptions,
} from '@nexus-kb/contracts';
import { UploadFilled } from '@element-plus/icons-vue';
import { ElDialog, ElDrawer, ElMessage, type UploadFile, type UploadUserFile } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/client';
import {
  deleteDocument as deleteDocumentRequest,
  fetchDocumentUploadOptions,
  listDocuments,
  uploadDocument,
} from '@/api/documents';
import { useAuthStore } from '@/stores/auth';
import { useBreakpoint } from '@/composables/useBreakpoint';
import DocumentsCardList from './documents/DocumentsCardList.vue';
import DocumentsDangerConfirm from './documents/DocumentsDangerConfirm.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { isMobile, isTablet } = useBreakpoint();
const loading = ref(false);
const errorMessage = ref('');
const items = ref<DocumentListItem[]>([]);
const total = ref(0);
const uploadVisible = ref(false);
const filtersVisible = ref(false);
const uploadOptions = ref<DocumentUploadOptions | null>(null);
const uploadOptionsLoading = ref(false);
const uploadOptionsError = ref('');
const selectedUploadFiles = ref<UploadUserFile[]>([]);
interface UploadRow {
  file: File;
  status: 'pending' | 'uploading' | 'queued' | 'failed';
  error: string;
  progress: number | null;
}
const uploadRows = ref<UploadRow[]>([]);
const uploading = ref(false);
const cleanupDocumentId = ref<string | null>(null);
const cleanupTarget = ref<DocumentListItem | null>(null);
const filters = reactive({
  search: typeof route.query.search === 'string' ? route.query.search : '',
  status: typeof route.query.status === 'string' ? route.query.status : '',
  sensitivity: typeof route.query.sensitivity === 'string' ? route.query.sensitivity : '',
  format: typeof route.query.format === 'string' ? route.query.format : '',
  page: Number(route.query.page) || 1,
  pageSize: Number(route.query.pageSize) || 20,
});

const canUpload = computed(() => auth.hasCapability('documents:write'));
const canDelete = computed(() => auth.hasCapability('documents:delete'));
const hasSecondaryFilters = computed(
  () => Boolean(filters.status) || Boolean(filters.sensitivity) || Boolean(filters.format),
);
const statusLabels: Record<string, string> = {
  uploaded: '已上传',
  processing: '处理中',
  prepared: '待建立索引',
  active: '已生效',
  policy_blocked: '策略阻止',
  failed: '失败',
  deleting: '删除待清理',
};

function queryRequest(): Partial<DocumentListRequest> {
  return {
    search: filters.search || undefined,
    status: (filters.status || undefined) as DocumentListRequest['status'],
    sensitivity: (filters.sensitivity || undefined) as DocumentListRequest['sensitivity'],
    format: (filters.format || undefined) as DocumentListRequest['format'],
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await listDocuments(queryRequest());
    items.value = result.items;
    total.value = result.total;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '文档列表加载失败';
  } finally {
    loading.value = false;
  }
}

async function applyFilters(): Promise<void> {
  filters.page = 1;
  await syncQueryAndLoad();
  filtersVisible.value = false;
}

async function syncQueryAndLoad(): Promise<void> {
  const query = Object.fromEntries(
    Object.entries(queryRequest()).filter(([, value]) => value !== undefined && value !== ''),
  );
  await router.replace({ query });
  await load();
}

async function resetFilters(): Promise<void> {
  Object.assign(filters, { search: '', status: '', sensitivity: '', format: '', page: 1 });
  await syncQueryAndLoad();
  filtersVisible.value = false;
}

async function changePage(nextPage: number): Promise<void> {
  filters.page = nextPage;
  await syncQueryAndLoad();
}

function resumeDeletion(document: DocumentListItem): void {
  cleanupTarget.value = document;
}

async function confirmResumeDeletion(): Promise<void> {
  const document = cleanupTarget.value;
  if (!document) return;
  cleanupTarget.value = null;
  cleanupDocumentId.value = document.id;
  try {
    await deleteDocumentRequest(document.id);
    ElMessage.success('文档残留已清理，可以重新上传');
    await load();
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error instanceof ApiError ? error.message : '继续清理失败');
    }
  } finally {
    cleanupDocumentId.value = null;
  }
}

function resumeDeletionById(documentId: string): void {
  const document = items.value.find((item) => item.id === documentId);
  if (document) resumeDeletion(document);
}

async function openUpload(): Promise<void> {
  resetUploadDialog();
  uploadVisible.value = true;
  await loadUploadOptions();
}

function resetUploadDialog(): void {
  selectedUploadFiles.value = [];
  uploadRows.value = [];
  uploading.value = false;
}

async function loadUploadOptions(): Promise<void> {
  uploadOptionsLoading.value = true;
  uploadOptionsError.value = '';
  try {
    uploadOptions.value = await fetchDocumentUploadOptions();
  } catch (error) {
    uploadOptions.value = null;
    uploadOptionsError.value = error instanceof ApiError ? error.message : '无法读取上传限制';
  } finally {
    uploadOptionsLoading.value = false;
  }
}

function chooseFiles(_file: UploadFile, files: UploadFile[]): void {
  uploadRows.value = files.flatMap((entry) =>
    entry.raw ? [{ file: entry.raw, status: 'pending' as const, error: '', progress: null }] : [],
  );
}

async function submitUpload(): Promise<void> {
  if (uploadRows.value.length === 0 || !uploadOptions.value) return;
  uploading.value = true;
  await Promise.all(
    uploadRows.value
      .filter((row) => row.status === 'pending' || row.status === 'failed')
      .map(uploadOne),
  );
  uploading.value = false;
  closeUploadWhenComplete();
  await load();
}

async function retryUpload(row: UploadRow): Promise<void> {
  await uploadOne(row);
  closeUploadWhenComplete();
  await load();
}

function removeUpload(row: UploadRow): void {
  uploadRows.value = uploadRows.value.filter((candidate) => candidate !== row);
  selectedUploadFiles.value = selectedUploadFiles.value.filter(
    (candidate) => candidate.raw !== row.file,
  );
}

function closeUploadWhenComplete(): void {
  if (!uploadRows.value.length || !uploadRows.value.every((row) => row.status === 'queued')) return;
  ElMessage.success('全部文件已进入入库队列');
  uploadVisible.value = false;
}

async function uploadOne(row: UploadRow): Promise<void> {
  if (!uploadOptions.value) return;
  if (row.file.size > uploadOptions.value.maxUploadBytes) {
    row.status = 'failed';
    row.error = '文件超过服务器允许的大小';
    return;
  }
  row.status = 'uploading';
  row.error = '';
  row.progress = 0;
  try {
    await uploadDocument(row.file, (percentage: number) => {
      row.progress = percentage;
    });
    row.status = 'queued';
    row.progress = 100;
  } catch (error) {
    row.status = 'failed';
    row.error = error instanceof ApiError ? error.message : '上传失败';
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'active') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'policy_blocked' || status === 'deleting') return 'warning';
  return 'info';
}

onMounted(load);
</script>

<style scoped>
.documents-toolbar {
  display: grid;
  align-items: center;
  gap: var(--kb-space-2);
  grid-template-columns:
    minmax(190px, 1fr) repeat(3, minmax(92px, 0.7fr))
    auto auto;
}
.documents-upload-dialog {
  width: 460px;
}
.documents-upload-form {
  display: flex;
  flex-direction: column;
  gap: var(--kb-space-2);
  min-height: 0;
}
.documents-upload-picker-content {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--kb-space-2);
  height: 44px;
}
.documents-upload-metadata {
  overflow: hidden;
  border: 1px solid var(--kb-color-border);
  border-radius: var(--kb-radius-md);
}
.documents-upload-metadata-row {
  display: grid;
  align-items: center;
  gap: var(--kb-layout-gap);
  grid-template-columns: 76px minmax(0, 1fr);
  min-height: var(--kb-space-10);
  padding: var(--kb-space-2) var(--kb-space-4);
}
.documents-upload-metadata-row + .documents-upload-metadata-row {
  border-top: 1px solid var(--kb-color-border);
}
.documents-upload-metadata-value {
  overflow-wrap: anywhere;
}
.documents-upload-warning {
  padding: var(--kb-space-2) var(--kb-block-padding);
  border-radius: var(--kb-radius-sm);
  background: var(--kb-color-warning-soft);
}
.documents-upload-options-state {
  display: grid;
  place-items: center;
  min-height: 180px;
}
.documents-upload-file-list {
  display: grid;
  gap: var(--kb-space-2);
  overflow-y: auto;
  overscroll-behavior: contain;
  max-height: min(280px, 30dvh);
  margin-bottom: 0;
  padding: 0;
  list-style: none;
  scrollbar-gutter: stable both-edges;
}
.documents-upload-file-item {
  display: flex;
  flex-direction: column;
  gap: var(--kb-space-2);
  padding: var(--kb-block-padding) var(--kb-space-4);
  border: 1px solid var(--kb-color-border);
  border-radius: var(--kb-radius-md);
  background: var(--kb-color-surface);
}
.documents-upload-file-heading {
  display: flex;
  align-items: center;
}
.documents-upload-file-name {
  flex: 1 1 auto;
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
}
.documents-upload-file-size {
  flex: 0 0 auto;
}
.documents-upload-file-progress {
  width: 100%;
}
.documents-upload-progress-label,
.documents-upload-file-error {
  overflow-wrap: anywhere;
}
.documents-upload-file-error {
  flex: 1 1 auto;
  min-width: 0;
}
.documents-upload-file-failure {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--kb-space-2);
}
.documents-upload-file-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--kb-space-2);
}
/* 响应式：Pad（768px–1279px） */
@media (min-width: 768px) and (max-width: 1279px) {
  .documents-upload-dialog {
    width: 400px;
  }
  .documents-toolbar {
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  }
  .document-filters .documents-filter-search {
    grid-column: 1 / 4;
  }
  .documents-upload-action {
    grid-row: 1;
    grid-column: 4;
  }
}
/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .documents-upload-drawer .documents-upload-picker {
    margin: 0 auto;
  }
  .documents-upload-drawer .documents-upload-picker-content {
    color: inherit;
  }
  .documents-upload-drawer .documents-upload-metadata-row {
    display: flex;
    justify-content: space-between;
  }
  .documents-upload-drawer .documents-upload-file-list {
    overflow: visible;
    max-height: none;
    scrollbar-gutter: auto;
  }
  .documents-upload-drawer .documents-upload-file-name {
    white-space: normal;
  }
  .documents-toolbar--mobile {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
}
</style>
