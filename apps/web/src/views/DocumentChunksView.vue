<template>
  <section v-loading="loading" class="document-chunks-page">
    <header class="chunks-toolbar kb-block">
      <div>
        <div class="kb-block__title kb-heading kb-heading--h4" role="heading" aria-level="2">
          {{ chunks?.sourceName ?? detail?.sourceName ?? '文档分块' }}
        </div>
        <div class="kb-text kb-text--secondary">
          不展示向量值。每次读取都会按当前文档权限重新鉴权。
        </div>
      </div>
      <div v-if="detail && chunks" class="chunks-summary kb-text kb-text--secondary">
        <el-select
          class="chunks-version-select"
          v-model="selectedVersion"
          aria-label="选择文档版本"
          :disabled="loading"
          @change="changeVersion"
        >
          <el-option
            v-for="version in detail.versions"
            :key="version.version"
            :label="`v${version.version} · ${version.chunkCount} 个分块`"
            :value="version.version"
          />
        </el-select>
        <span>v{{ chunks.documentVersion }} · 共 {{ chunks.total }} 个分块</span>
        <span
          v-if="selectedDocumentVersion?.vectorCollection"
          class="chunk-fingerprint kb-text kb-text--sm"
        >
          {{ selectedDocumentVersion.vectorCollection }}
        </span>
      </div>
    </header>

    <div class="kb-block-content">
      <div class="kb-block-scroll">
        <div v-if="errorMessage" class="kb-error-state" role="alert">
          <strong class="kb-text kb-text--danger">无法加载文档分块</strong>
          <span>{{ errorMessage }}</span>
          <el-button @click="load">重试</el-button>
        </div>
        <template v-else-if="chunks">
          <div v-if="chunks.items.length" class="chunk-list">
            <article v-for="chunk in chunks.items" :key="chunk.id" class="chunk-card kb-block">
              <header class="chunk-card__header">
                <div class="chunk-card__identity">
                  <div class="kb-heading kb-heading--h3" role="heading" aria-level="3">
                    分块 {{ chunk.ordinal + 1 }}
                  </div>
                  <div class="kb-text kb-text--sm kb-text--secondary">
                    {{ chunkLocation(chunk) }} · {{ chunk.tokenCount }} tokens
                  </div>
                </div>
                <span class="chunk-card__id chunk-fingerprint kb-text kb-text--sm">
                  {{ chunk.id }}
                </span>
              </header>
              <div class="chunk-data-list kb-data-fields kb-data-fields--borderless">
                <div class="kb-data-field">
                  <span class="kb-data-field__label">章节路径</span>
                  <span class="kb-data-field__value">
                    {{ chunk.sectionPath.join(' / ') || '未标注' }}
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">元素类型</span>
                  <span class="kb-data-field__value">
                    {{ chunk.elementTypes.join('、') || '未标注' }}
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">相邻分块</span>
                  <span class="kb-data-field__value chunk-neighbor-list">
                    <span class="chunk-neighbor-item">
                      <span class="chunk-neighbor-label kb-text kb-text--sm kb-text--secondary">
                        上一个
                      </span>
                      <span class="chunk-neighbor-id chunk-fingerprint kb-text kb-text--sm">
                        {{ chunk.previousChunkId ?? '无' }}
                      </span>
                    </span>
                    <span class="chunk-neighbor-item">
                      <span class="chunk-neighbor-label kb-text kb-text--sm kb-text--secondary">
                        下一个
                      </span>
                      <span class="chunk-neighbor-id chunk-fingerprint kb-text kb-text--sm">
                        {{ chunk.nextChunkId ?? '无' }}
                      </span>
                    </span>
                  </span>
                </div>
                <div class="kb-data-field">
                  <span class="kb-data-field__label">脱敏策略</span>
                  <span class="kb-data-field__value">
                    {{ chunk.redactionPolicyVersion }}
                    <span v-if="redactionEntries(chunk).length">· </span>
                    <el-tag
                      v-for="[kind, count] in redactionEntries(chunk)"
                      :key="kind"
                      class="chunk-redaction-tag"
                      size="small"
                      effect="plain"
                    >
                      {{ kind }} × {{ count }}
                    </el-tag>
                  </span>
                </div>
              </div>
              <div class="chunk-text-grid">
                <template v-if="isMobile">
                  <el-tabs
                    class="chunk-text-tabs"
                    :model-value="mobileChunkTextMode(chunk.id)"
                    stretch
                    @update:model-value="updateMobileChunkTextMode(chunk.id, $event)"
                  >
                    <el-tab-pane label="原始内容" name="original" lazy>
                      <section
                        v-if="mobileChunkTextMode(chunk.id) === 'original'"
                        class="chunk-text-section chunk-text-section--mobile"
                      >
                        <pre class="chunk-text-content chunk-text-content--original">
                          {{ chunk.originalText }}
                        </pre>
                      </section>
                    </el-tab-pane>
                    <el-tab-pane label="脱敏后内容" name="redacted" lazy>
                      <section
                        v-if="mobileChunkTextMode(chunk.id) === 'redacted'"
                        class="chunk-text-section chunk-text-section--mobile"
                      >
                        <pre class="chunk-text-content chunk-text-content--redacted">
                          {{ chunk.redactedText }}
                        </pre>
                      </section>
                    </el-tab-pane>
                  </el-tabs>
                </template>
                <template v-else>
                  <section class="chunk-text-section">
                    <div
                      class="chunk-text-section__title kb-heading kb-heading--h6 kb-text--secondary"
                    >
                      原始内容
                    </div>
                    <pre class="chunk-text-content chunk-text-content--original">
                      {{ chunk.originalText }}
                    </pre>
                  </section>
                  <section class="chunk-text-section">
                    <div
                      class="chunk-text-section__title kb-heading kb-heading--h6 kb-text--secondary"
                    >
                      写入向量库的内容（脱敏后）
                    </div>
                    <pre class="chunk-text-content chunk-text-content--redacted">
                      {{ chunk.redactedText }}
                    </pre>
                  </section>
                </template>
              </div>
            </article>
          </div>
          <el-empty v-else description="该版本尚未产生分块" />
        </template>
      </div>
      <div v-if="chunks && chunks.total > pageSize" class="kb-pagination">
        <el-pagination
          :layout="isMobile ? 'prev, pager, next' : 'total, prev, pager, next'"
          :current-page="chunks.page"
          :page-size="chunks.pageSize"
          :total="chunks.total"
          @current-change="changePage"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DocumentChunk, DocumentChunkListResponse, DocumentDetail } from '@nexus-kb/contracts';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ApiError } from '@/api/client';
import { fetchDocument, listDocumentChunks } from '@/api/documents';
import { useBreakpoint } from '@/composables/useBreakpoint';

const pageSize = 20;
const route = useRoute();
const router = useRouter();
const documentId = String(route.params.id);
const detail = ref<DocumentDetail | null>(null);
const chunks = ref<DocumentChunkListResponse | null>(null);
const selectedVersion = ref<number | undefined>(readVersion(route.query.version));
const page = ref(Math.max(1, Number(route.query.page) || 1));
const loading = ref(false);
const errorMessage = ref('');
const { isMobile } = useBreakpoint();
type ChunkTextMode = 'original' | 'redacted';
const mobileChunkTextModes = ref<Record<string, ChunkTextMode>>({});
const selectedDocumentVersion = computed(() =>
  detail.value?.versions.find((version) => version.version === chunks.value?.documentVersion),
);

function readVersion(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : undefined;
}

function chunkLocation(chunk: DocumentChunk): string {
  const locations = [chunk.page === null ? null : `第 ${chunk.page} 页`, chunk.sheet];
  return locations.filter((value): value is string => value !== null).join(' · ') || '未标注位置';
}

function redactionEntries(chunk: DocumentChunk): Array<[string, number]> {
  return Object.entries(chunk.redactionSummary);
}

function mobileChunkTextMode(chunkId: string): ChunkTextMode {
  return mobileChunkTextModes.value[chunkId] ?? 'original';
}

function setMobileChunkTextMode(chunkId: string, mode: ChunkTextMode): void {
  mobileChunkTextModes.value[chunkId] = mode;
}

function updateMobileChunkTextMode(chunkId: string, mode: string | number): void {
  if (mode === 'original' || mode === 'redacted') setMobileChunkTextMode(chunkId, mode);
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const documentDetail = await fetchDocument(documentId);
    const result = await listDocumentChunks(documentId, {
      version: selectedVersion.value,
      page: page.value,
      pageSize,
    });
    detail.value = documentDetail;
    chunks.value = result;
    selectedVersion.value = result.documentVersion;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '文档分块加载失败';
  } finally {
    loading.value = false;
  }
}

async function syncRouteAndLoad(): Promise<void> {
  const query: Record<string, string> = {};
  if (selectedVersion.value) query.version = String(selectedVersion.value);
  if (page.value > 1) query.page = String(page.value);
  await router.replace({ query });
  await load();
}

async function changeVersion(version: number): Promise<void> {
  selectedVersion.value = version;
  page.value = 1;
  await syncRouteAndLoad();
}

async function changePage(nextPage: number): Promise<void> {
  page.value = nextPage;
  await syncRouteAndLoad();
}

onMounted(load);
</script>

<style scoped>
.chunks-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: var(--kb-layout-gap);
}
.chunks-summary {
  display: grid;
  justify-items: end;
  gap: var(--kb-space-2);
  font-size: 13px;
}
.chunks-version-select {
  width: 220px;
}
.chunk-redaction-tag + .chunk-redaction-tag {
  margin-left: var(--kb-space-2);
}
.chunk-list {
  display: grid;
  gap: var(--kb-layout-gap);
}
.chunk-card {
  display: grid;
  gap: var(--kb-layout-gap);
  overflow: hidden;
}
.chunk-card__header {
  display: grid;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--kb-layout-gap);
  grid-template-columns: minmax(0, 1fr) minmax(180px, 0.55fr);
}
.chunk-card__identity {
  display: grid;
  gap: var(--kb-space-1);
  min-width: 0;
}
.chunk-card__id {
  justify-self: end;
  max-width: 100%;
  padding: var(--kb-space-1) var(--kb-space-2);
  border: 1px solid var(--kb-color-border-light);
  border-radius: var(--kb-radius-sm);
  color: var(--kb-color-text-secondary);
  background: var(--kb-color-surface-subtle);
}
.chunk-data-list {
  column-gap: var(--kb-space-6);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: var(--kb-block-padding);
  border: 1px solid var(--kb-color-border-light);
  border-radius: var(--kb-radius-md);
  background: var(--kb-color-surface-subtle);
}
.chunk-neighbor-list {
  display: grid;
  gap: var(--kb-space-1);
  text-align: left;
}
.chunk-neighbor-item {
  display: grid;
  align-items: start;
  gap: var(--kb-space-2);
  grid-template-columns: 48px minmax(0, 1fr);
  min-width: 0;
}
.chunk-neighbor-label {
  white-space: nowrap;
}
.chunk-neighbor-id {
  min-width: 0;
}
.chunk-text-grid {
  display: grid;
  gap: var(--kb-space-4);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.chunk-text-tabs :deep(.el-tabs__header) {
  overflow: hidden;
  margin: 0 0 var(--kb-space-element);
  border: 1px solid var(--kb-color-border);
  border-radius: var(--kb-radius-md);
  background: var(--kb-color-surface);
}
.chunk-text-tabs :deep(.el-tabs__nav-wrap::after),
.chunk-text-tabs :deep(.el-tabs__active-bar) {
  display: none;
}
.chunk-text-tabs :deep(.el-tabs__item) {
  padding: 0;
  color: var(--kb-color-text-secondary);
  transition:
    color var(--kb-transition-fast),
    background-color var(--kb-transition-fast);
}
.chunk-text-tabs :deep(.el-tabs__item + .el-tabs__item) {
  border-left: 1px solid var(--kb-color-border);
}
.chunk-text-tabs :deep(.el-tabs__item.is-active) {
  color: var(--kb-color-primary-dark);
  background: var(--kb-color-primary-soft);
}
.chunk-text-section {
  display: grid;
  align-content: start;
  grid-template-rows: auto minmax(120px, 1fr);
  min-width: 0;
}
.chunk-text-section--mobile {
  grid-template-rows: minmax(120px, 1fr);
}
.chunk-text-section__title {
  margin-bottom: var(--kb-space-2);
}
.chunk-text-content {
  overflow: auto;
  overflow-wrap: anywhere;
  min-height: 120px;
  max-height: 360px;
  margin: 0;
  padding: var(--kb-block-padding);
  border: 1px solid var(--kb-color-border-light);
  border-radius: var(--kb-radius-md);
  color: var(--kb-color-text-primary);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.65;
  white-space: pre-wrap;
}
.chunk-text-content--original {
  background: var(--kb-color-content-original);
}
.chunk-text-content--redacted {
  background: var(--kb-color-content-redacted);
}
.document-chunks-page {
  display: grid;
  gap: var(--kb-space-4);
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}
.chunk-fingerprint {
  overflow-wrap: anywhere;
  font-family: ui-monospace, monospace;
  text-align: right;
}
/* 响应式：紧凑布局（<1280px） */
@media (max-width: 1279px) {
  .chunks-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }
  .chunk-card__header {
    grid-template-columns: minmax(0, 1fr);
  }
  .chunk-card__id {
    justify-self: start;
  }
  .chunk-data-list {
    grid-template-columns: 1fr;
  }
}
/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .document-chunks-page {
    grid-template-rows: auto auto;
    overflow-y: auto;
  }
  .document-chunks-page > .kb-block-content {
    flex: none;
    overflow: visible;
    min-height: auto;
  }
  .document-chunks-page > .kb-block-content > .kb-block-scroll {
    flex: none;
    overflow: visible;
    min-height: auto;
  }
  .chunks-toolbar {
    display: grid;
  }
  .chunks-summary {
    justify-items: stretch;
    text-align: left;
  }
  .chunks-version-select {
    width: 100%;
  }
  .chunk-fingerprint {
    text-align: left;
  }
  .chunk-text-grid {
    grid-template-columns: 1fr;
  }
}
</style>
