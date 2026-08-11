<script setup lang="ts">
import type { DocumentChunkListResponse, DocumentPreview } from '@nexus-kb/contracts';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ApiError } from '@/api/client';
import {
  documentPreviewContentUrl,
  fetchDocumentPreview,
  fetchDocumentPreviewText,
  listDocumentChunks,
} from '@/api/documents';
import SafeMarkdown from '@/components/common/SafeMarkdown.vue';
import CadTileViewer from '@/components/documents/CadTileViewer.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';

const fallbackPageSize = 20;
const route = useRoute();
const router = useRouter();
const documentId = String(route.params.id);
const preview = ref<DocumentPreview | null>(null);
const previewPage = ref<HTMLElement | null>(null);
const cadViewport = ref<HTMLElement | null>(null);
const cadTileViewer = ref<InstanceType<typeof CadTileViewer> | null>(null);
const textContent = ref('');
const chunks = ref<DocumentChunkListResponse | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const interactionMessage = ref('');
const isFullscreen = ref(false);
const canFullscreen = ref(true);
const cadZoom = ref(1);
const isCadDragging = ref(false);
const fallbackPage = ref(readPositiveInteger(route.query.chunkPage) ?? 1);
const sourcePage = computed(() => readPositiveInteger(route.query.page));
const sourceSheet = computed(() =>
  typeof route.query.sheet === 'string' && route.query.sheet ? route.query.sheet : null,
);
const contentUrl = computed(() => documentPreviewContentUrl(documentId));
const pdfUrl = computed(() =>
  sourcePage.value ? `${contentUrl.value}#page=${sourcePage.value}` : contentUrl.value,
);
const isCadPreview = computed(
  () =>
    preview.value?.status === 'ready' &&
    (preview.value.kind === 'svg' || preview.value.kind === 'cad_tiles'),
);
const isTiledCadPreview = computed(
  () => preview.value?.status === 'ready' && preview.value.kind === 'cad_tiles',
);
const canPanCad = computed(
  () => preview.value?.status === 'ready' && preview.value.kind === 'svg' && cadZoom.value > 1,
);
const cadZoomPercent = computed(() => Math.round(cadZoom.value * 100));
const cadImageStyle = computed(() => ({ width: `${cadZoomPercent.value}%` }));
const { isPhone } = useBreakpoint();

const cadZoomMinimum = 0.5;
const cadZoomMaximum = 256;
const cadButtonZoomFactor = 1.5;
const cadWheelZoomFactor = 1.25;
const tiledCadCanZoomIn = ref(true);
const tiledCadCanZoomOut = ref(true);
const cadCanZoomIn = computed(() =>
  isTiledCadPreview.value ? tiledCadCanZoomIn.value : cadZoom.value < cadZoomMaximum,
);
const cadCanZoomOut = computed(() =>
  isTiledCadPreview.value ? tiledCadCanZoomOut.value : cadZoom.value > cadZoomMinimum,
);
let cadDragPointerId: number | null = null;
let cadDragStartX = 0;
let cadDragStartY = 0;
let cadDragStartScrollLeft = 0;
let cadDragStartScrollTop = 0;

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function chunkLocation(chunk: DocumentChunkListResponse['items'][number]): string {
  const parts = [chunk.page ? `第 ${chunk.page} 页` : null, chunk.sheet];
  return parts.filter((value): value is string => Boolean(value)).join(' · ') || '未标注位置';
}

function isReferencedChunk(chunk: DocumentChunkListResponse['items'][number]): boolean {
  return (
    (sourcePage.value !== null && chunk.page === sourcePage.value) ||
    (sourceSheet.value !== null && chunk.sheet === sourceSheet.value)
  );
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  interactionMessage.value = '';
  stopCadPan();
  cadZoom.value = 1;
  textContent.value = '';
  chunks.value = null;
  try {
    const manifest = await fetchDocumentPreview(documentId);
    preview.value = manifest;
    if (manifest.status === 'ready' && (manifest.kind === 'text' || manifest.kind === 'markdown')) {
      textContent.value = await fetchDocumentPreviewText(documentId);
    } else if (manifest.status === 'fallback' && manifest.fallbackVersion) {
      chunks.value = await listDocumentChunks(documentId, {
        version: manifest.fallbackVersion,
        page: fallbackPage.value,
        pageSize: fallbackPageSize,
      });
    }
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '文档预览加载失败';
  } finally {
    loading.value = false;
  }
}

function setSvgCadZoom(nextZoom: number): void {
  cadZoom.value = Math.min(cadZoomMaximum, Math.max(cadZoomMinimum, Number(nextZoom.toFixed(4))));
  if (cadZoom.value <= 1) stopCadPan();
}

function changeCadZoom(direction: -1 | 1): void {
  if (isTiledCadPreview.value) {
    if (direction > 0) cadTileViewer.value?.zoomIn();
    else cadTileViewer.value?.zoomOut();
    return;
  }
  setSvgCadZoom(cadZoom.value * (direction > 0 ? cadButtonZoomFactor : 1 / cadButtonZoomFactor));
}

function resetCadZoom(): void {
  if (isTiledCadPreview.value) {
    cadTileViewer.value?.reset();
    return;
  }
  stopCadPan();
  cadZoom.value = 1;
  if (cadViewport.value) {
    cadViewport.value.scrollLeft = 0;
    cadViewport.value.scrollTop = 0;
  }
}

function handleCadTileZoomChange(state: {
  percent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
}): void {
  cadZoom.value = state.percent / 100;
  tiledCadCanZoomIn.value = state.canZoomIn;
  tiledCadCanZoomOut.value = state.canZoomOut;
}

function handleCadTileError(message: string): void {
  interactionMessage.value = message;
}

function handleCadWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  setSvgCadZoom(cadZoom.value * (event.deltaY < 0 ? cadWheelZoomFactor : 1 / cadWheelZoomFactor));
}

function startCadPan(event: PointerEvent): void {
  const viewport = cadViewport.value;
  if (!viewport || !canPanCad.value || event.pointerType !== 'mouse' || event.button !== 0) {
    return;
  }
  cadDragPointerId = event.pointerId;
  cadDragStartX = event.clientX;
  cadDragStartY = event.clientY;
  cadDragStartScrollLeft = viewport.scrollLeft;
  cadDragStartScrollTop = viewport.scrollTop;
  isCadDragging.value = true;
  viewport.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function moveCadPan(event: PointerEvent): void {
  const viewport = cadViewport.value;
  if (!viewport || !isCadDragging.value || event.pointerId !== cadDragPointerId) return;
  viewport.scrollLeft = cadDragStartScrollLeft - (event.clientX - cadDragStartX);
  viewport.scrollTop = cadDragStartScrollTop - (event.clientY - cadDragStartY);
  event.preventDefault();
}

function stopCadPan(event?: PointerEvent): void {
  if (event && event.pointerId !== cadDragPointerId) return;
  const pointerId = cadDragPointerId;
  cadDragPointerId = null;
  isCadDragging.value = false;
  if (pointerId !== null && cadViewport.value?.hasPointerCapture?.(pointerId)) {
    cadViewport.value.releasePointerCapture(pointerId);
  }
}

function syncFullscreenState(): void {
  isFullscreen.value = document.fullscreenElement === previewPage.value;
}

async function toggleFullscreen(): Promise<void> {
  interactionMessage.value = '';
  try {
    if (document.fullscreenElement === previewPage.value) {
      await document.exitFullscreen();
      return;
    }
    if (!previewPage.value?.requestFullscreen) {
      interactionMessage.value = '当前浏览器不支持全屏预览';
      return;
    }
    await previewPage.value.requestFullscreen();
  } catch {
    interactionMessage.value = '浏览器未能进入全屏模式，请检查全屏权限后重试';
  }
}

async function changeFallbackPage(page: number): Promise<void> {
  fallbackPage.value = page;
  await router.replace({
    query: { ...route.query, chunkPage: page > 1 ? String(page) : undefined },
  });
  await load();
}

onMounted(() => {
  canFullscreen.value = document.fullscreenEnabled ?? 'requestFullscreen' in HTMLElement.prototype;
  document.addEventListener('fullscreenchange', syncFullscreenState);
  void load();
});

onBeforeUnmount(() => {
  stopCadPan();
  document.removeEventListener('fullscreenchange', syncFullscreenState);
});
</script>

<template>
  <section ref="previewPage" v-loading="loading" class="document-preview-page">
    <div v-if="errorMessage" class="document-error" role="alert">
      <strong>无法加载文档预览</strong><span>{{ errorMessage }}</span>
      <el-button @click="load">重试</el-button>
    </div>

    <template v-else-if="preview">
      <header class="preview-toolbar">
        <div class="preview-toolbar__identity">
          <div class="heading heading--h2" role="heading" aria-level="2">
            {{ preview.sourceName }}
          </div>
          <span
            class="preview-security-badge"
            title="每次读取都会重新校验租户、部门与敏感度权限。"
            aria-label="实时权限校验：每次读取都会重新校验租户、部门与敏感度权限。"
          >
            实时权限校验
          </span>
        </div>
        <div class="preview-toolbar__actions">
          <div v-if="sourcePage || sourceSheet" class="preview-location" aria-label="引用位置">
            <span>引用位置</span>
            <strong v-if="sourcePage">第 {{ sourcePage }} 页</strong>
            <strong v-if="sourceSheet">工作表 {{ sourceSheet }}</strong>
          </div>
          <div v-if="isCadPreview" class="preview-zoom-controls" aria-label="CAD 预览缩放">
            <el-button
              size="small"
              aria-label="缩小 CAD 预览"
              :disabled="!cadCanZoomOut"
              @click="changeCadZoom(-1)"
            >
              缩小
            </el-button>
            <el-button size="small" aria-label="重置 CAD 预览缩放" @click="resetCadZoom">
              {{ cadZoomPercent }}%
            </el-button>
            <el-button
              size="small"
              aria-label="放大 CAD 预览"
              :disabled="!cadCanZoomIn"
              @click="changeCadZoom(1)"
            >
              放大
            </el-button>
          </div>
          <el-button
            size="small"
            :disabled="!canFullscreen"
            :aria-label="isFullscreen ? '退出全屏预览' : '全屏预览'"
            @click="toggleFullscreen"
          >
            {{ isFullscreen ? '退出全屏' : '全屏' }}
          </el-button>
        </div>
        <span v-if="interactionMessage" class="preview-control-error" role="status">
          {{ interactionMessage }}
        </span>
      </header>

      <div v-if="preview.status === 'ready'" class="preview-surface">
        <iframe
          v-if="preview.kind === 'pdf'"
          class="preview-pdf"
          :src="pdfUrl"
          :title="`${preview.sourceName} PDF 预览`"
        >
        </iframe>
        <CadTileViewer
          v-if="preview.kind === 'cad_tiles' && preview.cad"
          ref="cadTileViewer"
          :document-id="documentId"
          :manifest="preview.cad"
          :source-name="preview.sourceName"
          @zoom-change="handleCadTileZoomChange"
          @error="handleCadTileError"
        />
        <div
          v-else-if="preview.kind === 'image' || preview.kind === 'svg'"
          ref="cadViewport"
          class="preview-image-viewport"
          :class="{
            'is-zoomable': preview.kind === 'svg',
            'is-pannable': canPanCad,
            'is-dragging': isCadDragging,
          }"
          :title="canPanCad ? '按住鼠标左键拖拽查看 CAD 细节' : undefined"
          @wheel="handleCadWheel"
          @pointerdown="startCadPan"
          @pointermove="moveCadPan"
          @pointerup="stopCadPan"
          @pointercancel="stopCadPan"
          @lostpointercapture="stopCadPan"
        >
          <img
            class="preview-image"
            draggable="false"
            :style="preview.kind === 'svg' ? cadImageStyle : undefined"
            :src="contentUrl"
            :alt="`${preview.sourceName} 预览`"
          />
        </div>
        <SafeMarkdown
          v-else-if="preview.kind === 'markdown'"
          class="preview-text preview-markdown"
          :content="textContent"
        />
        <pre v-else-if="preview.kind === 'text'" class="preview-text">{{ textContent }}</pre>
      </div>

      <div v-else-if="preview.status === 'fallback'" class="preview-fallback">
        <div class="preview-fallback__notice">
          <strong>原格式预览暂不可用</strong>
          <span>已降级显示经解析的原始文本，版式可能与源文件不同。</span>
        </div>
        <div v-if="chunks?.items.length" class="preview-chunk-list">
          <article
            v-for="chunk in chunks.items"
            :key="chunk.id"
            class="preview-chunk"
            :class="{ 'is-referenced': isReferencedChunk(chunk) }"
          >
            <header>
              <strong>{{ chunk.sectionPath.join(' / ') || `分块 ${chunk.ordinal + 1}` }}</strong>
              <span>{{ chunkLocation(chunk) }}</span>
            </header>
            <pre>{{ chunk.originalText }}</pre>
          </article>
        </div>
        <el-empty v-else description="当前版本没有可显示的解析文本" />
        <div v-if="chunks && chunks.total > fallbackPageSize" class="preview-pagination">
          <el-pagination
            :layout="isPhone ? 'prev, pager, next' : 'total, prev, pager, next'"
            :current-page="chunks.page"
            :page-size="chunks.pageSize"
            :total="chunks.total"
            @current-change="changeFallbackPage"
          />
        </div>
      </div>

      <el-empty v-else description="文档尚未完成解析，暂时无法预览" />
    </template>
  </section>
</template>
