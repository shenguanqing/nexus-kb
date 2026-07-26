<script setup lang="ts">
import type {
  DocumentListItem,
  DocumentListRequest,
  DocumentUploadOptions,
} from '@nexus-kb/contracts';
import { ElMessage, type UploadFile } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/client';
import { fetchDocumentUploadOptions, listDocuments, uploadDocument } from '@/api/documents';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const errorMessage = ref('');
const items = ref<DocumentListItem[]>([]);
const total = ref(0);
const uploadVisible = ref(false);
const uploadOptions = ref<DocumentUploadOptions | null>(null);
const uploadOptionsLoading = ref(false);
const uploadOptionsError = ref('');
interface UploadRow {
  file: File;
  status: 'pending' | 'uploading' | 'queued' | 'failed';
  error: string;
}
const uploadRows = ref<UploadRow[]>([]);
const uploading = ref(false);
const filters = reactive({
  search: typeof route.query.search === 'string' ? route.query.search : '',
  status: typeof route.query.status === 'string' ? route.query.status : '',
  sensitivity: typeof route.query.sensitivity === 'string' ? route.query.sensitivity : '',
  format: typeof route.query.format === 'string' ? route.query.format : '',
  page: Number(route.query.page) || 1,
  pageSize: Number(route.query.pageSize) || 20,
});

const canUpload = computed(() => auth.hasCapability('documents:write'));
const statusLabels: Record<string, string> = {
  uploaded: '已上传',
  processing: '处理中',
  prepared: '待建立索引',
  active: '已生效',
  policy_blocked: '策略阻止',
  failed: '失败',
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
}

async function openUpload(): Promise<void> {
  uploadVisible.value = true;
  uploadRows.value = [];
  await loadUploadOptions();
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
    entry.raw ? [{ file: entry.raw, status: 'pending' as const, error: '' }] : [],
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
  if (uploadRows.value.every((row) => row.status === 'queued'))
    ElMessage.success('全部文件已进入入库队列');
  await load();
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
  try {
    await uploadDocument(row.file);
    row.status = 'queued';
  } catch (error) {
    row.status = 'failed';
    row.error = error instanceof ApiError ? error.message : '上传失败';
  }
}

function statusType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'active') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'policy_blocked') return 'warning';
  return 'info';
}

onMounted(load);
</script>

<template>
  <section class="documents-page">
    <div class="documents-toolbar">
      <div class="documents-toolbar-heading">
        <p>共 {{ total }} 份可访问文档</p>
        <el-button v-if="canUpload" type="primary" @click="openUpload">上传文档</el-button>
      </div>

      <form class="document-filters" aria-label="文档筛选" @submit.prevent="applyFilters">
        <el-input
          class="document-filter-search"
          v-model="filters.search"
          clearable
          placeholder="搜索文件名"
        />
        <el-select class="document-filter-status" v-model="filters.status" clearable placeholder="状态">
          <el-option
            v-for="(label, value) in statusLabels"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <el-select
          class="document-filter-sensitivity"
          v-model="filters.sensitivity"
          clearable
          placeholder="敏感度"
        >
          <el-option label="公开" value="public" />
          <el-option label="内部" value="internal" />
          <el-option label="机密" value="confidential" />
        </el-select>
        <el-select class="document-filter-format" v-model="filters.format" clearable placeholder="格式">
          <el-option
            v-for="format in ['txt', 'md', 'docx', 'xlsx', 'dxf', 'dwg']"
            :key="format"
            :label="format.toUpperCase()"
            :value="format"
          />
        </el-select>
        <div class="toolbar-actions">
          <el-button native-type="submit">查询</el-button>
          <el-button class="reset-button" native-type="button" @click="resetFilters">重置</el-button>
        </div>
      </form>
    </div>

    <div class="documents-content">
      <div v-if="errorMessage" class="document-error" role="alert">
        <strong>无法加载文档</strong><span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>
      <el-table
        v-else
        class="desktop-data-table"
        v-loading="loading"
        :data="items"
        row-key="id"
        empty-text="暂无符合条件的文档"
      >
        <el-table-column prop="sourceName" label="文件名" min-width="240" fixed="left">
          <template #default="scope">
            <RouterLink class="document-link" :to="`/documents/${scope.row.id}`">
              {{ scope.row.sourceName }}
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
        <el-table-column prop="department" label="部门" width="140" />
        <el-table-column prop="sensitivity" label="敏感度" width="110" />
        <el-table-column label="版本" width="90">
          <template #default="scope">
            {{ scope.row.activeVersion ? `v${scope.row.activeVersion}` : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="更新时间" min-width="180">
          <template #default="scope">
            {{ new Date(scope.row.updatedAt).toLocaleString() }}
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!loading && items.length" class="mobile-data-list" aria-label="文档列表">
        <article v-for="item in items" :key="item.id" class="mobile-data-card">
          <header>
            <RouterLink class="document-link" :to="`/documents/${item.id}`">
              {{ item.sourceName }}
            </RouterLink>
            <el-tag :type="statusType(item.status)">
              {{ statusLabels[item.status] ?? item.status }}
            </el-tag>
          </header>
          <div class="mobile-data-fields">
            <div>
              <span>部门</span>
              <strong>{{ item.department }}</strong>
            </div>
            <div>
              <span>敏感度</span>
              <strong>{{ item.sensitivity }}</strong>
            </div>
            <div>
              <span>版本</span>
              <strong>{{ item.activeVersion ? `v${item.activeVersion}` : '—' }}</strong>
            </div>
            <div>
              <span>更新时间</span>
              <strong>{{ new Date(item.updatedAt).toLocaleString() }}</strong>
            </div>
          </div>
        </article>
      </div>

      <el-pagination
        v-if="total > filters.pageSize"
        v-model:current-page="filters.page"
        v-model:page-size="filters.pageSize"
        class="document-pagination"
        layout="total, sizes, prev, pager, next"
        :total="total"
        :page-sizes="[20, 50, 100]"
        @change="syncQueryAndLoad"
      />
    </div>

    <el-dialog
      v-model="uploadVisible"
      title="上传文档"
      width="min(520px, calc(100vw - 28px))"
      append-to-body
      :z-index="4000"
    >
      <div v-if="uploadOptionsLoading" v-loading="true" class="upload-options-state">
        正在读取服务器上传限制…
      </div>
      <div v-else-if="uploadOptionsError" class="document-error" role="alert">
        <strong>上传配置加载失败</strong><span>{{ uploadOptionsError }}</span>
        <el-button @click="loadUploadOptions">重试</el-button>
      </div>
      <div v-if="uploadOptions" class="upload-form">
        <el-upload
          drag
          multiple
          :auto-upload="false"
          :show-file-list="false"
          :accept="uploadOptions.acceptedExtensions.map((item) => `.${item}`).join(',')"
          :on-change="chooseFiles"
        >
          <span>选择或拖入文件</span>
          <template #tip>文件只会在确认“开始上传”后发送到服务端。</template>
        </el-upload>
        <p>
          支持
          {{
            uploadOptions.acceptedExtensions.map((item) => item.toUpperCase()).join(' / ')
          }}，单文件最大 {{ Math.ceil(uploadOptions.maxUploadBytes / 1024 / 1024) }} MB。
        </p>
        <el-descriptions class="upload-options" :column="1" border size="small">
          <el-descriptions-item label="部门">{{ uploadOptions.department }}</el-descriptions-item>
          <el-descriptions-item label="敏感度">
            {{ uploadOptions.defaultSensitivity }}（由服务端身份确定）
          </el-descriptions-item>
        </el-descriptions>
        <p v-if="uploadOptions.defaultSensitivity === 'confidential'" class="upload-warning">
          机密内容默认不会发送到云端 Embedding 服务。
        </p>
        <ul v-if="uploadRows.length" class="upload-file-list">
          <li v-for="row in uploadRows" :key="`${row.file.name}-${row.file.lastModified}`">
            <span>
              <strong>{{ row.file.name }}</strong>
              <small>{{ Math.ceil(row.file.size / 1024) }} KB</small>
            </span>
            <el-tag
              :type="
                row.status === 'queued' ? 'success' : row.status === 'failed' ? 'danger' : 'info'
              "
            >
              {{ row.status }}
            </el-tag>
            <small v-if="row.error" role="alert">{{ row.error }}</small>
            <el-button v-if="row.status === 'failed'" text @click="uploadOne(row)">重试</el-button>
          </li>
        </ul>
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
    </el-dialog>
  </section>
</template>
