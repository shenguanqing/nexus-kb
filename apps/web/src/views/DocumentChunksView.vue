<script setup lang="ts">
import type { DocumentChunk, DocumentChunkListResponse, DocumentDetail } from '@nexus-kb/contracts';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ApiError } from '@/api/client';
import { fetchDocument, listDocumentChunks } from '@/api/documents';

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

<template>
  <section v-loading="loading" class="document-chunks-page">
    <header class="chunks-toolbar">
      <div>
        <RouterLink :to="`/documents/${documentId}`" class="back-link">← 返回文档详情</RouterLink>
        <h2>{{ chunks?.sourceName ?? detail?.sourceName ?? '文档分块' }}</h2>
        <p>
          显示原始分块和写入向量库的脱敏文本；不展示向量值。每次读取都会按当前文档权限重新鉴权。
        </p>
      </div>
      <div v-if="detail && chunks" class="chunks-summary">
        <el-select
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
        <span v-if="selectedDocumentVersion?.vectorCollection" class="fingerprint">
          {{ selectedDocumentVersion.vectorCollection }}
        </span>
      </div>
    </header>

    <div class="chunks-content">
      <div v-if="errorMessage" class="document-error" role="alert">
        <strong>无法加载文档分块</strong><span>{{ errorMessage }}</span
        ><el-button @click="load">重试</el-button>
      </div>
      <template v-else-if="chunks">
        <div v-if="chunks.items.length" class="chunk-list">
          <article v-for="chunk in chunks.items" :key="chunk.id" class="chunk-card">
            <header>
              <div>
                <h3>分块 {{ chunk.ordinal + 1 }}</h3>
                <p>{{ chunkLocation(chunk) }} · {{ chunk.tokenCount }} tokens</p>
              </div>
              <span class="fingerprint">{{ chunk.id }}</span>
            </header>
            <dl>
              <div>
                <dt>章节路径</dt>
                <dd>{{ chunk.sectionPath.join(' / ') || '未标注' }}</dd>
              </div>
              <div>
                <dt>元素类型</dt>
                <dd>{{ chunk.elementTypes.join('、') || '未标注' }}</dd>
              </div>
              <div>
                <dt>相邻分块</dt>
                <dd class="fingerprint">
                  上一个：{{ chunk.previousChunkId ?? '无' }}<br />下一个：{{
                    chunk.nextChunkId ?? '无'
                  }}
                </dd>
              </div>
              <div>
                <dt>脱敏策略</dt>
                <dd>
                  {{ chunk.redactionPolicyVersion }}
                  <span v-if="redactionEntries(chunk).length"> · </span>
                  <el-tag
                    v-for="[kind, count] in redactionEntries(chunk)"
                    :key="kind"
                    size="small"
                    effect="plain"
                  >
                    {{ kind }} × {{ count }}
                  </el-tag>
                </dd>
              </div>
            </dl>
            <div class="chunk-text-grid">
              <section>
                <h4>原始内容</h4>
                <pre>{{ chunk.originalText }}</pre>
              </section>
              <section>
                <h4>写入向量库的内容（脱敏后）</h4>
                <pre>{{ chunk.redactedText }}</pre>
              </section>
            </div>
          </article>
        </div>
        <el-empty v-else description="该版本尚未产生分块" />
        <div v-if="chunks.total > pageSize" class="document-pagination">
          <el-pagination
            background
            layout="total, prev, pager, next"
            :current-page="chunks.page"
            :page-size="chunks.pageSize"
            :total="chunks.total"
            @current-change="changePage"
          />
        </div>
      </template>
    </div>
  </section>
</template>
