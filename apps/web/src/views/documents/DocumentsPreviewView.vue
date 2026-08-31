<template>
  <section ref="previewPage" v-loading="loading" class="documents-preview-page kb-page">
    <div v-if="errorMessage" class="kb-error-state" role="alert">
      <strong class="kb-text kb-text--danger">无法加载文档预览</strong>
      <span>{{ errorMessage }}</span>
      <el-button @click="load">重试</el-button>
    </div>

    <template v-else-if="preview">
      <header class="documents-preview-toolbar kb-block kb-status-toolbar">
        <div class="documents-preview-toolbar__identity kb-title-group">
          <div class="kb-block__title kb-heading kb-heading--h4">{{ preview.sourceName }}</div>
          <span
            class="documents-preview-security-badge kb-text kb-text--xs kb-text--success"
            title="每次读取都会重新校验租户、部门与敏感度权限。"
            aria-label="实时权限校验：每次读取都会重新校验租户、部门与敏感度权限。"
          >
            实时权限校验
          </span>
        </div>
        <div
          class="documents-preview-toolbar__actions kb-action-group"
          :class="{ 'is-cad': isCadPreview, 'has-location': sourcePage || sourceSheet }"
        >
          <div
            v-if="sourcePage || sourceSheet"
            class="documents-preview-location kb-text"
            aria-label="引用位置"
          >
            <span class="kb-text kb-text--xs kb-text--secondary">引用位置 </span>
            <strong v-if="sourcePage">第 {{ sourcePage }} 页 </strong>
            <strong v-if="sourceSheet">工作表 {{ sourceSheet }} </strong>
          </div>
          <div
            v-if="isCadPreview"
            class="documents-preview-zoom-controls"
            aria-label="CAD 预览缩放"
          >
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
            class="documents-preview-fullscreen-action"
            size="small"
            :disabled="!canFullscreen"
            :aria-label="isFullscreen ? '退出全屏预览' : '全屏预览'"
            @click="toggleFullscreen"
          >
            {{ isFullscreen ? '退出全屏' : '全屏' }}
          </el-button>
        </div>
        <span
          v-if="interactionMessage"
          class="documents-preview-control-error kb-text kb-text--sm kb-text--danger"
          role="status"
        >
          {{ interactionMessage }}
        </span>
      </header>

      <div v-if="preview.status === 'ready'" class="kb-page__content kb-block kb-block--flush">
        <iframe
          v-if="preview.kind === 'pdf'"
          class="documents-preview-pdf"
          :src="pdfUrl"
          :title="`${preview.sourceName} PDF 预览`"
        >
        </iframe>
        <DocumentsPreviewTileViewer
          v-if="preview.kind === 'cad_tiles' && preview.cad"
          ref="cadTileViewer"
          :document-id="documentId"
          :manifest="preview.cad"
          :source-name="preview.sourceName"
          :refresh-overview-on-detail="preview.renderer === 'ezdxf-cad-tiles-progressive'"
          @zoom-change="handleCadTileZoomChange"
          @error="handleCadTileError"
        />
        <div
          v-else-if="preview.kind === 'image' || preview.kind === 'svg'"
          class="documents-preview-image-stage"
        >
          <div
            ref="cadViewport"
            class="documents-preview-image-viewport"
            :class="{
              'is-zoomable': preview.kind === 'svg',
              'is-pannable': canPanCad,
              'is-dragging': isCadDragging,
            }"
            :title="canPanCad ? '按住鼠标左键拖拽查看 CAD 细节' : undefined"
            @scroll="syncSvgOverviewViewport"
            @wheel="handleCadWheel"
            @pointerdown="startCadPan"
            @pointermove="moveCadPan"
            @pointerup="stopCadPan"
            @pointercancel="stopCadPan"
            @lostpointercapture="stopCadPan"
          >
            <img
              ref="cadImage"
              class="documents-preview-image"
              draggable="false"
              :style="preview.kind === 'svg' ? cadImageStyle : undefined"
              :src="contentUrl"
              :alt="`${preview.sourceName} 预览`"
              @load="syncSvgOverviewViewport"
            />
          </div>
          <DocumentsPreviewOverviewMap
            v-if="preview.kind === 'svg'"
            :source="contentUrl"
            :source-name="preview.sourceName"
            :viewport="svgOverviewViewport"
            :aspect-ratio="svgOverviewAspectRatio"
            @navigate="navigateSvgFromOverview"
          />
        </div>
        <SafeMarkdown
          v-else-if="preview.kind === 'markdown'"
          class="documents-preview-text documents-preview-markdown"
          :content="textContent"
        />
        <pre v-else-if="preview.kind === 'text'" class="documents-preview-text">{{
          textContent
        }}</pre>
      </div>

      <div v-else-if="preview.status === 'fallback'" class="kb-block-content kb-block-content--gap">
        <div class="kb-block kb-block-content kb-block-content--gap kb-block-scroll">
          <div class="documents-preview-fallback__notice kb-block kb-text kb-text--warning">
            <strong>原格式预览暂不可用</strong>
            <div class="kb-text kb-text--secondary">
              已降级显示经解析的原始文本，版式可能与源文件不同。
            </div>
          </div>
          <div v-if="chunks?.items.length" class="kb-block-list">
            <article v-for="chunk in chunks.items" :key="chunk.id" class="kb-block">
              <header class="kb-block__header">
                <strong>
                  {{ chunk.sectionPath.join(' / ') || `分块 ${chunk.ordinal + 1}` }}
                </strong>
                <span
                  class="documents-preview-chunk__location kb-text kb-text--sm kb-text--secondary"
                >
                  {{ chunkLocation(chunk) }}
                </span>
              </header>
              <pre class="documents-preview-chunk__content">{{ chunk.originalText }}</pre>
            </article>
          </div>
          <el-empty v-else description="当前版本没有可显示的解析文本" />
        </div>
        <div v-if="chunks && chunks.total > fallbackPageSize" class="kb-pagination">
          <el-pagination
            :layout="isMobile ? 'prev, pager, next' : 'total, prev, pager, next'"
            :current-page="chunks.page"
            :page-size="chunks.pageSize"
            :total="chunks.total"
            @current-change="changeFallbackPage"
          />
        </div>
      </div>

      <el-empty v-else class="kb-empty-state" description="文档尚未完成解析，暂时无法预览" />
    </template>
  </section>
</template>

<script setup lang="ts">
import type { DocumentChunkListResponse, DocumentPreview } from '@nexus-kb/contracts';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ApiError } from '@/api/client';
import {
  documentPreviewContentUrl,
  fetchDocumentPreview,
  fetchDocumentPreviewText,
  listDocumentChunks,
} from '@/api/documents';
import SafeMarkdown from '@/components/common/SafeMarkdown.vue';
import type { CadOverviewViewport } from '@/utils/cad-overview';
import DocumentsPreviewOverviewMap from './DocumentsPreviewOverviewMap.vue';
import DocumentsPreviewTileViewer from './DocumentsPreviewTileViewer.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';

const fallbackPageSize = 20;
const route = useRoute();
const router = useRouter();
const documentId = String(route.params.id);
const preview = ref<DocumentPreview | null>(null);
const previewPage = ref<HTMLElement | null>(null);
const cadViewport = ref<HTMLElement | null>(null);
const cadImage = ref<HTMLImageElement | null>(null);
const cadTileViewer = ref<InstanceType<typeof DocumentsPreviewTileViewer> | null>(null);
const textContent = ref('');
const chunks = ref<DocumentChunkListResponse | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const interactionMessage = ref('');
const isFullscreen = ref(false);
const canFullscreen = ref(true);
const cadZoom = ref(1);
const svgOverviewViewport = ref<CadOverviewViewport>({ x: 0, y: 0, width: 1, height: 1 });
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
const svgOverviewAspectRatio = computed(() => {
  const image = cadImage.value;
  return image?.naturalWidth && image.naturalHeight
    ? image.naturalWidth / image.naturalHeight
    : 1.6;
});
const { isMobile } = useBreakpoint();

const cadZoomMinimum = 0.5;
const cadZoomMaximum = 4096;
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

function setSvgCadZoom(nextZoom: number, anchor?: { viewportX: number; viewportY: number }): void {
  const viewport = cadViewport.value;
  const viewportX = anchor?.viewportX ?? (viewport?.clientWidth ?? 0) / 2;
  const viewportY = anchor?.viewportY ?? (viewport?.clientHeight ?? 0) / 2;
  const contentAnchorX = viewport
    ? (viewport.scrollLeft + viewportX) / Math.max(1, viewport.scrollWidth)
    : 0.5;
  const contentAnchorY = viewport
    ? (viewport.scrollTop + viewportY) / Math.max(1, viewport.scrollHeight)
    : 0.5;
  cadZoom.value = Math.min(cadZoomMaximum, Math.max(cadZoomMinimum, Number(nextZoom.toFixed(4))));
  if (cadZoom.value <= 1) stopCadPan();
  void nextTick(() => {
    const updatedViewport = cadViewport.value;
    if (!updatedViewport) return;
    updatedViewport.scrollLeft = contentAnchorX * updatedViewport.scrollWidth - viewportX;
    updatedViewport.scrollTop = contentAnchorY * updatedViewport.scrollHeight - viewportY;
    syncSvgOverviewViewport();
  });
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
  void nextTick(syncSvgOverviewViewport);
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
  const bounds = cadViewport.value?.getBoundingClientRect();
  setSvgCadZoom(
    cadZoom.value * (event.deltaY < 0 ? cadWheelZoomFactor : 1 / cadWheelZoomFactor),
    bounds
      ? {
          viewportX: event.clientX - bounds.left,
          viewportY: event.clientY - bounds.top,
        }
      : undefined,
  );
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
  syncSvgOverviewViewport();
  event.preventDefault();
}

function syncSvgOverviewViewport(): void {
  const viewport = cadViewport.value;
  if (!viewport) return;
  const contentWidth = Math.max(1, viewport.scrollWidth, viewport.clientWidth);
  const contentHeight = Math.max(1, viewport.scrollHeight, viewport.clientHeight);
  svgOverviewViewport.value = {
    x: Math.min(1, Math.max(0, viewport.scrollLeft / contentWidth)),
    y: Math.min(1, Math.max(0, viewport.scrollTop / contentHeight)),
    width: Math.min(1, viewport.clientWidth / contentWidth || 1),
    height: Math.min(1, viewport.clientHeight / contentHeight || 1),
  };
}

function navigateSvgFromOverview(position: { x: number; y: number }): void {
  const viewport = cadViewport.value;
  if (!viewport) return;
  viewport.scrollLeft = position.x * viewport.scrollWidth - viewport.clientWidth / 2;
  viewport.scrollTop = position.y * viewport.scrollHeight - viewport.clientHeight / 2;
  syncSvgOverviewViewport();
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
  window.addEventListener('resize', syncSvgOverviewViewport);
  void load();
});

onBeforeUnmount(() => {
  stopCadPan();
  document.removeEventListener('fullscreenchange', syncFullscreenState);
  window.removeEventListener('resize', syncSvgOverviewViewport);
});
</script>

<style scoped>
.documents-preview-page:fullscreen {
  max-width: none;
  padding: var(--kb-block-padding);
  background: var(--kb-color-surface);
}
.documents-preview-toolbar {
  position: relative;
}
.documents-preview-toolbar__identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--kb-space-2);
}
.documents-preview-security-badge {
  flex: 0 0 auto;
  padding: var(--kb-space-1) var(--kb-space-2);
  border-radius: var(--kb-radius-pill);
  background: var(--kb-color-success-soft);
  white-space: nowrap;
}
.documents-preview-toolbar__actions {
  gap: var(--kb-space-2);
}
.documents-preview-zoom-controls {
  display: flex;
  align-items: center;
  gap: var(--kb-space-2);
}
.documents-preview-control-error {
  position: absolute;
  right: var(--kb-block-padding);
  bottom: -18px;
  z-index: 1;
}
.documents-preview-location {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--kb-space-2);
  padding: var(--kb-space-1) var(--kb-space-2);
  border-radius: var(--kb-radius-sm);
  color: var(--kb-color-primary-dark);
  background: var(--kb-color-primary-soft);
  font-size: 13px;
}
.documents-preview-pdf {
  width: 100%;
  height: 100%;
  min-height: 640px;
  border: 0;
  background: var(--kb-color-canvas);
}
.documents-preview-image-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.documents-preview-image-viewport {
  display: grid;
  place-items: center;
  overflow: auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.documents-preview-image-viewport.is-zoomable {
  display: block;
}
.documents-preview-image-viewport.is-pannable {
  cursor: grab;
}
.documents-preview-image-viewport.is-dragging {
  cursor: grabbing;
  user-select: none;
}
.documents-preview-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  margin: auto;
  object-fit: contain;
}
.documents-preview-image-viewport.is-zoomable .documents-preview-image {
  max-width: none;
  max-height: none;
  margin: 0 auto;
  object-fit: initial;
}
.documents-preview-text {
  overflow: auto;
  overflow-wrap: anywhere;
  min-height: 100%;
  margin: 0;
  padding: clamp(var(--kb-space-4), 3vw, var(--kb-space-10));
  color: var(--kb-color-text-primary);
  background: var(--kb-color-surface);
  font:
    14px/1.75 ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  white-space: pre-wrap;
}
.documents-preview-markdown {
  font-family: inherit;
  white-space: normal;
}
.documents-preview-fallback__notice {
  display: grid;
  gap: var(--kb-space-1);
  background: var(--kb-color-warning-soft);
}
.documents-preview-chunk__location {
  flex: 0 0 auto;
}
.documents-preview-chunk__content {
  overflow-wrap: anywhere;
  margin: 0;
  color: var(--kb-color-text-primary);
  font:
    13px/1.7 ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  white-space: pre-wrap;
}
/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .documents-preview-toolbar {
    display: block;
  }
  .documents-preview-toolbar__identity {
    width: 100%;
    padding-right: calc(var(--kb-control-height) + var(--kb-space-8));
  }
  .documents-preview-toolbar__identity .kb-block__title {
    width: 100%;
    line-height: var(--kb-line-height-body);
  }
  .documents-preview-toolbar__actions {
    display: grid;
    gap: var(--kb-space-2);
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
  }
  .documents-preview-toolbar__actions.is-cad,
  .documents-preview-toolbar__actions.has-location {
    margin-top: var(--kb-block-padding);
  }
  .documents-preview-toolbar__actions .documents-preview-location {
    width: 100%;
  }
  .documents-preview-toolbar__actions.is-cad .documents-preview-zoom-controls {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
  }
  .documents-preview-toolbar__actions.is-cad .documents-preview-zoom-controls .el-button {
    overflow: hidden;
    width: 100%;
    min-width: 0;
    padding-inline: var(--kb-space-2);
  }
  .documents-preview-fullscreen-action {
    position: absolute;
    top: var(--kb-block-padding);
    right: var(--kb-block-padding);
    width: auto;
  }
  .documents-preview-control-error {
    position: static;
    grid-column: 1 / -1;
  }
  .documents-preview-location {
    flex-wrap: wrap;
  }
  .documents-preview-pdf {
    min-height: 65vh;
  }
}
</style>
