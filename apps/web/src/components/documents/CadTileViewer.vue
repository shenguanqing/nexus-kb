<template>
  <div class="cad-tile-viewer" :class="{ 'is-loading': loading }">
    <canvas
      ref="canvas"
      class="cad-tile-canvas"
      tabindex="0"
      role="img"
      :aria-label="`${sourceName} CAD 瓦片预览`"
      @wheel="handleWheel"
      @pointerdown="startPan"
      @pointermove="movePan"
      @pointerup="stopPan"
      @pointercancel="stopPan"
      @lostpointercapture="stopPan"
      @keydown="handleKeydown"
    >
    </canvas>
    <span v-if="statusMessage" class="cad-tile-status" role="status">{{ statusMessage }}</span>
  </div>
</template>

<script setup lang="ts">
import type { CadPreviewManifest } from '@nexus-kb/contracts';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import { documentPreviewOverviewUrl, documentPreviewTileUrl } from '@/api/documents';

const props = defineProps<{
  documentId: string;
  manifest: CadPreviewManifest;
  sourceName: string;
}>();
const emit = defineEmits<{
  zoomChange: [state: { percent: number; canZoomIn: boolean; canZoomOut: boolean }];
  error: [message: string];
}>();

type TileCoordinate = { zoom: number; x: number; y: number };
type CachedBitmap = { bitmap: ImageBitmap; lastUsed: number };

const canvas = ref<HTMLCanvasElement | null>(null);
const loading = ref(true);
const statusMessage = ref('正在加载 CAD 总览');
const maxConcurrentRequests = 2;
const maxCachedBitmaps = 96;
const tileRequestDebounceMs = 140;
const minimumZoomFactor = 0.5;
const maximumZoomFactor = 2 ** props.manifest.maxZoom;
const tileCache = new Map<string, CachedBitmap>();
const pendingTiles = new Map<string, TileCoordinate>();
const inFlight = new Map<string, AbortController>();
let overviewBitmap: ImageBitmap | null = null;
let overviewController: AbortController | null = null;
let resizeObserver: ResizeObserver | null = null;
let animationFrame: number | null = null;
let tileRequestTimer: ReturnType<typeof setTimeout> | null = null;
let viewportWidth = 1;
let viewportHeight = 1;
let centerX = (props.manifest.bounds.minX + props.manifest.bounds.maxX) / 2;
let centerY = (props.manifest.bounds.minY + props.manifest.bounds.maxY) / 2;
let zoomFactor = 1;
let pointerId: number | null = null;
let pointerX = 0;
let pointerY = 0;
let errorReported = false;

const worldWidth = props.manifest.bounds.maxX - props.manifest.bounds.minX;
const worldHeight = props.manifest.bounds.maxY - props.manifest.bounds.minY;
const baseScale = Math.max(props.manifest.worldToPixel[0] ?? 1, 1e-9);

function fitScale(): number {
  return Math.max(1e-9, Math.min(viewportWidth / worldWidth, viewportHeight / worldHeight) * 0.96);
}

function viewScale(): number {
  return fitScale() * zoomFactor;
}

function zoomState(): { percent: number; canZoomIn: boolean; canZoomOut: boolean } {
  return {
    percent: Math.round(zoomFactor * 100),
    canZoomIn: zoomFactor < maximumZoomFactor,
    canZoomOut: zoomFactor > minimumZoomFactor,
  };
}

function emitZoomState(): void {
  emit('zoomChange', zoomState());
}

function setZoom(
  nextZoom: number,
  anchorX = viewportWidth / 2,
  anchorY = viewportHeight / 2,
): void {
  const previousScale = viewScale();
  const worldAnchorX = centerX + (anchorX - viewportWidth / 2) / previousScale;
  const worldAnchorY = centerY - (anchorY - viewportHeight / 2) / previousScale;
  zoomFactor = Math.min(maximumZoomFactor, Math.max(minimumZoomFactor, nextZoom));
  const nextScale = viewScale();
  centerX = worldAnchorX - (anchorX - viewportWidth / 2) / nextScale;
  centerY = worldAnchorY + (anchorY - viewportHeight / 2) / nextScale;
  clampCenter();
  emitZoomState();
  refreshViewport();
}

function zoomIn(): void {
  setZoom(zoomFactor * 1.5);
}

function zoomOut(): void {
  setZoom(zoomFactor / 1.5);
}

function reset(): void {
  centerX = (props.manifest.bounds.minX + props.manifest.bounds.maxX) / 2;
  centerY = (props.manifest.bounds.minY + props.manifest.bounds.maxY) / 2;
  zoomFactor = 1;
  emitZoomState();
  refreshViewport();
}

function handleWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const bounds = canvas.value?.getBoundingClientRect();
  const anchorX = bounds ? event.clientX - bounds.left : viewportWidth / 2;
  const anchorY = bounds ? event.clientY - bounds.top : viewportHeight / 2;
  setZoom(zoomFactor * (event.deltaY < 0 ? 1.25 : 0.8), anchorX, anchorY);
}

function startPan(event: PointerEvent): void {
  if (event.button !== 0 || pointerId !== null) return;
  pointerId = event.pointerId;
  pointerX = event.clientX;
  pointerY = event.clientY;
  canvas.value?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function movePan(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  const scale = viewScale();
  centerX -= (event.clientX - pointerX) / scale;
  centerY += (event.clientY - pointerY) / scale;
  pointerX = event.clientX;
  pointerY = event.clientY;
  clampCenter();
  refreshViewport();
  event.preventDefault();
}

function stopPan(event?: PointerEvent): void {
  if (event && event.pointerId !== pointerId) return;
  const currentPointer = pointerId;
  pointerId = null;
  if (currentPointer !== null && canvas.value?.hasPointerCapture?.(currentPointer)) {
    canvas.value.releasePointerCapture(currentPointer);
  }
  scheduleTileRequestSync(0);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === '+' || event.key === '=') zoomIn();
  else if (event.key === '-') zoomOut();
  else if (event.key === '0') reset();
  else return;
  event.preventDefault();
}

function clampCenter(): void {
  const scale = viewScale();
  const halfWidth = viewportWidth / (2 * scale);
  const halfHeight = viewportHeight / (2 * scale);
  const minimumX = props.manifest.bounds.minX - halfWidth * 0.5;
  const maximumX = props.manifest.bounds.maxX + halfWidth * 0.5;
  const minimumY = props.manifest.bounds.minY - halfHeight * 0.5;
  const maximumY = props.manifest.bounds.maxY + halfHeight * 0.5;
  centerX = Math.min(maximumX, Math.max(minimumX, centerX));
  centerY = Math.min(maximumY, Math.max(minimumY, centerY));
}

function refreshViewport(): void {
  scheduleDraw();
  scheduleTileRequestSync();
}

function scheduleTileRequestSync(delay = tileRequestDebounceMs): void {
  if (tileRequestTimer !== null) clearTimeout(tileRequestTimer);
  tileRequestTimer = setTimeout(() => {
    tileRequestTimer = null;
    syncTileRequests();
  }, delay);
}

function scheduleDraw(): void {
  if (animationFrame !== null) return;
  animationFrame = requestAnimationFrame(() => {
    animationFrame = null;
    drawViewport();
  });
}

function drawViewport(): void {
  const target = canvas.value;
  const context = target?.getContext('2d');
  if (!target || !context) return;
  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.max(1, Math.round(viewportWidth * deviceScale));
  const pixelHeight = Math.max(1, Math.round(viewportHeight * deviceScale));
  if (target.width !== pixelWidth || target.height !== pixelHeight) {
    target.width = pixelWidth;
    target.height = pixelHeight;
  }
  context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
  context.fillStyle = '#212830';
  context.fillRect(0, 0, viewportWidth, viewportHeight);
  if (overviewBitmap) {
    const topLeft = worldToScreen(props.manifest.bounds.minX, props.manifest.bounds.maxY);
    const bottomRight = worldToScreen(props.manifest.bounds.maxX, props.manifest.bounds.minY);
    context.drawImage(
      overviewBitmap,
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y,
    );
  }
  for (const coordinate of visibleTileCoordinates(false)) {
    const key = tileKey(coordinate);
    const cached = tileCache.get(key);
    if (!cached) continue;
    cached.lastUsed = performance.now();
    const tileWorldSize = props.manifest.tileSize / (baseScale * 2 ** coordinate.zoom);
    const worldLeft = props.manifest.bounds.minX + coordinate.x * tileWorldSize;
    const worldTop = props.manifest.bounds.maxY - coordinate.y * tileWorldSize;
    const topLeft = worldToScreen(worldLeft, worldTop);
    const displaySize = tileWorldSize * viewScale();
    context.drawImage(cached.bitmap, topLeft.x, topLeft.y, displaySize + 0.5, displaySize + 0.5);
  }
}

function worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
  const scale = viewScale();
  return {
    x: viewportWidth / 2 + (worldX - centerX) * scale,
    y: viewportHeight / 2 + (centerY - worldY) * scale,
  };
}

function currentTileZoom(): number | null {
  const overviewScale = Math.min(
    props.manifest.overviewWidth / worldWidth,
    props.manifest.overviewHeight / worldHeight,
  );
  if (viewScale() <= overviewScale) return null;
  const ratio = (viewScale() * Math.min(window.devicePixelRatio || 1, 2)) / baseScale;
  return Math.min(
    props.manifest.maxZoom,
    Math.max(props.manifest.minZoom, Math.ceil(Math.log2(Math.max(1, ratio)))),
  );
}

function visibleTileCoordinates(prefetch: boolean): TileCoordinate[] {
  const zoom = currentTileZoom();
  if (zoom === null) return [];
  const scale = viewScale();
  const halfWorldWidth = viewportWidth / (2 * scale);
  const halfWorldHeight = viewportHeight / (2 * scale);
  const worldLeft = centerX - halfWorldWidth;
  const worldRight = centerX + halfWorldWidth;
  const worldBottom = centerY - halfWorldHeight;
  const worldTop = centerY + halfWorldHeight;
  const tileWorldSize = props.manifest.tileSize / (baseScale * 2 ** zoom);
  const gridWidth = Math.max(
    1,
    Math.ceil((props.manifest.baseWidth * 2 ** zoom) / props.manifest.tileSize),
  );
  const gridHeight = Math.max(
    1,
    Math.ceil((props.manifest.baseHeight * 2 ** zoom) / props.manifest.tileSize),
  );
  const margin = prefetch ? 1 : 0;
  const minimumX = Math.max(
    0,
    Math.floor((worldLeft - props.manifest.bounds.minX) / tileWorldSize) - margin,
  );
  const maximumX = Math.min(
    gridWidth - 1,
    Math.floor((worldRight - props.manifest.bounds.minX) / tileWorldSize) + margin,
  );
  const minimumY = Math.max(
    0,
    Math.floor((props.manifest.bounds.maxY - worldTop) / tileWorldSize) - margin,
  );
  const maximumY = Math.min(
    gridHeight - 1,
    Math.floor((props.manifest.bounds.maxY - worldBottom) / tileWorldSize) + margin,
  );
  const coordinates: TileCoordinate[] = [];
  for (let x = minimumX; x <= maximumX; x += 1) {
    for (let y = minimumY; y <= maximumY; y += 1) coordinates.push({ zoom, x, y });
  }
  const centerTileX = (centerX - props.manifest.bounds.minX) / tileWorldSize;
  const centerTileY = (props.manifest.bounds.maxY - centerY) / tileWorldSize;
  return coordinates.sort((left, right) => {
    const leftDistance = (left.x + 0.5 - centerTileX) ** 2 + (left.y + 0.5 - centerTileY) ** 2;
    const rightDistance = (right.x + 0.5 - centerTileX) ** 2 + (right.y + 0.5 - centerTileY) ** 2;
    return leftDistance - rightDistance;
  });
}

function syncTileRequests(): void {
  const visible = visibleTileCoordinates(false);
  const wanted = new Map(visible.map((coordinate) => [tileKey(coordinate), coordinate]));
  for (const coordinate of visibleTileCoordinates(true)) {
    const key = tileKey(coordinate);
    if (!wanted.has(key)) wanted.set(key, coordinate);
  }
  for (const [key, controller] of inFlight) {
    if (!wanted.has(key)) {
      controller.abort();
      inFlight.delete(key);
    }
  }
  pendingTiles.clear();
  for (const [key, coordinate] of wanted) {
    if (!tileCache.has(key) && !inFlight.has(key)) pendingTiles.set(key, coordinate);
  }
  updateDetailStatus(visible);
  startPendingRequests();
}

function updateDetailStatus(visible = visibleTileCoordinates(false)): void {
  if (loading.value) return;
  if (visible.length === 0 || visible.every((coordinate) => tileCache.has(tileKey(coordinate)))) {
    statusMessage.value = '';
    return;
  }
  statusMessage.value = '正在加载 CAD 清晰细节';
}

function startPendingRequests(): void {
  while (inFlight.size < maxConcurrentRequests && pendingTiles.size > 0) {
    const next = pendingTiles.entries().next().value;
    if (!next) break;
    const [key, coordinate] = next;
    pendingTiles.delete(key);
    void loadTile(key, coordinate);
  }
}

async function loadTile(key: string, coordinate: TileCoordinate): Promise<void> {
  const controller = new AbortController();
  inFlight.set(key, controller);
  try {
    const response = await fetch(
      documentPreviewTileUrl(props.documentId, coordinate.zoom, coordinate.x, coordinate.y),
      { credentials: 'include', cache: 'no-store', signal: controller.signal },
    );
    if (!response.ok) throw new Error(`tile request failed: ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    if (controller.signal.aborted) {
      bitmap.close();
      return;
    }
    tileCache.set(key, { bitmap, lastUsed: performance.now() });
    evictOldBitmaps();
    updateDetailStatus();
    scheduleDraw();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    statusMessage.value = '部分细节瓦片暂时不可用，仍可继续平移或缩放重试';
    if (!errorReported) {
      errorReported = true;
      emit('error', statusMessage.value);
    }
  } finally {
    inFlight.delete(key);
    startPendingRequests();
  }
}

function evictOldBitmaps(): void {
  if (tileCache.size <= maxCachedBitmaps) return;
  const protectedKeys = new Set(visibleTileCoordinates(true).map(tileKey));
  const candidates = [...tileCache.entries()]
    .filter(([key]) => !protectedKeys.has(key))
    .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
  while (tileCache.size > maxCachedBitmaps && candidates.length > 0) {
    const candidate = candidates.shift();
    if (!candidate) break;
    candidate[1].bitmap.close();
    tileCache.delete(candidate[0]);
  }
}

function tileKey(coordinate: TileCoordinate): string {
  return `${coordinate.zoom}/${coordinate.x}/${coordinate.y}`;
}

async function loadOverview(): Promise<void> {
  overviewController = new AbortController();
  try {
    const response = await fetch(documentPreviewOverviewUrl(props.documentId), {
      credentials: 'include',
      cache: 'no-store',
      signal: overviewController.signal,
    });
    if (!response.ok) throw new Error(`overview request failed: ${response.status}`);
    overviewBitmap = await createImageBitmap(await response.blob());
    loading.value = false;
    statusMessage.value = '';
    refreshViewport();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    loading.value = false;
    statusMessage.value =
      'CAD 总览加载失败；该图纸可能过于复杂，请重试或使用本地 CAD 软件查看源文件';
    emit('error', statusMessage.value);
  }
}

function updateSize(): void {
  const bounds = canvas.value?.getBoundingClientRect();
  viewportWidth = Math.max(1, Math.round(bounds?.width ?? 1));
  viewportHeight = Math.max(1, Math.round(bounds?.height ?? 1));
  clampCenter();
  refreshViewport();
}

onMounted(async () => {
  await nextTick();
  updateSize();
  if (typeof ResizeObserver !== 'undefined' && canvas.value) {
    resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(canvas.value);
  }
  emitZoomState();
  void loadOverview();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  overviewController?.abort();
  for (const controller of inFlight.values()) controller.abort();
  inFlight.clear();
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  if (tileRequestTimer !== null) clearTimeout(tileRequestTimer);
  overviewBitmap?.close();
  for (const cached of tileCache.values()) cached.bitmap.close();
  tileCache.clear();
});

defineExpose({ reset, zoomIn, zoomOut });
</script>

<style scoped>
.cad-tile-viewer {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: #212830;
}
.cad-tile-canvas {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  outline-offset: -2px;
  cursor: grab;
  touch-action: none;
}
.cad-tile-canvas:active {
  cursor: grabbing;
}
.cad-tile-status {
  position: absolute;
  bottom: var(--kb-space-element);
  left: 50%;
  max-width: calc(100% - var(--kb-space-6));
  padding: var(--kb-space-2) var(--kb-block-padding);
  border-radius: var(--kb-radius-sm);
  color: #fff;
  background: rgb(0 0 0 / 68%);
  font-size: 12px;
  transform: translateX(-50%);
  pointer-events: none;
}
</style>
