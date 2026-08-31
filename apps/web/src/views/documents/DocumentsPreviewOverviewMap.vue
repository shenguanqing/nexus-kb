<template>
  <aside class="documents-overview-map" :aria-label="`${sourceName} CAD 鸟瞰图`">
    <div class="documents-overview-map__title">
      <span class="documents-overview-map__identity">
        <span class="documents-overview-map__hint">拖动定位</span>
      </span>
      <span v-if="hasFocusOverview" class="documents-overview-map__modes" aria-label="鸟瞰图范围">
        <el-button
          text
          size="small"
          class="documents-overview-map__mode"
          :class="{ 'is-active': mode === 'focus' }"
          :aria-pressed="mode === 'focus'"
          @click="setMode('focus')"
        >
          主体
        </el-button>
        <el-button
          text
          size="small"
          class="documents-overview-map__mode"
          :class="{ 'is-active': mode === 'full' }"
          :aria-pressed="mode === 'full'"
          @click="setMode('full')"
        >
          全图
        </el-button>
      </span>
    </div>
    <button
      ref="surface"
      type="button"
      class="documents-overview-map__surface"
      :style="surfaceStyle"
      aria-label="在鸟瞰图中点击或拖动以定位当前视图"
      @click="handleClick"
      @pointerdown="startNavigation"
      @pointermove="moveNavigation"
      @pointerup="stopNavigation"
      @pointercancel="stopNavigation"
      @lostpointercapture="stopNavigation"
      @keydown="handleKeydown"
    >
      <img
        :key="displayedSource"
        :src="displayedSource"
        alt=""
        draggable="false"
        @load="handleImageLoad"
        @error="handleImageError"
      />
      <span
        v-if="mode === 'full' && focusMarkerStyle"
        class="documents-overview-map__focus"
        :style="focusMarkerStyle"
        aria-hidden="true"
      >
      </span>
      <span class="documents-overview-map__viewport" :style="viewportStyle" aria-hidden="true">
        <span class="documents-overview-map__center"></span>
      </span>
    </button>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import type { CadOverviewViewport } from '@/utils/cad-overview';

const props = withDefaults(
  defineProps<{
    source: string;
    focusSource?: string;
    sourceName: string;
    viewport: CadOverviewViewport;
    focusRegion?: CadOverviewViewport;
    aspectRatio?: number;
    focusAspectRatio?: number;
  }>(),
  { aspectRatio: 1.6, focusAspectRatio: 1.6 },
);
const emit = defineEmits<{
  navigate: [position: { x: number; y: number }];
}>();

const surface = ref<HTMLButtonElement | null>(null);
const loadedAspectRatio = ref<number | null>(null);
const mode = ref<'focus' | 'full'>(props.focusSource && props.focusRegion ? 'focus' : 'full');
let pointerId: number | null = null;
let ignoreNextClick = false;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

const hasFocusOverview = computed(() => Boolean(props.focusSource && props.focusRegion));
const displayedSource = computed(() =>
  mode.value === 'focus' && props.focusSource ? props.focusSource : props.source,
);
const displayedAspectRatio = computed(() =>
  mode.value === 'focus' ? props.focusAspectRatio : props.aspectRatio,
);
const surfaceStyle = computed(() => ({
  aspectRatio: String(loadedAspectRatio.value ?? displayedAspectRatio.value),
}));
const displayedViewport = computed<CadOverviewViewport>(() => {
  const focus = props.focusRegion;
  if (mode.value !== 'focus' || !focus) return props.viewport;
  const left = clamp((props.viewport.x - focus.x) / focus.width);
  const right = clamp((props.viewport.x + props.viewport.width - focus.x) / focus.width);
  const top = clamp((props.viewport.y - focus.y) / focus.height);
  const bottom = clamp((props.viewport.y + props.viewport.height - focus.y) / focus.height);
  if (right > left && bottom > top) {
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  return {
    x: clamp((props.viewport.x + props.viewport.width / 2 - focus.x) / focus.width),
    y: clamp((props.viewport.y + props.viewport.height / 2 - focus.y) / focus.height),
    width: 0,
    height: 0,
  };
});
const focusMarkerStyle = computed(() => {
  const focus = props.focusRegion;
  if (!focus) return null;
  const width = Math.max(focus.width, 0.04);
  const height = Math.max(focus.height, 0.04);
  const centerX = clamp(focus.x + focus.width / 2);
  const centerY = clamp(focus.y + focus.height / 2);
  const left = clamp(centerX - width / 2, 0, 1 - width);
  const top = clamp(centerY - height / 2, 0, 1 - height);
  return {
    width: `${width * 100}%`,
    height: `${height * 100}%`,
    transform: `translate(${(left * 100) / width}%, ${(top * 100) / height}%)`,
  };
});
const viewportStyle = computed(() => {
  const actualWidth = clamp(displayedViewport.value.width, 0, 1);
  const actualHeight = clamp(displayedViewport.value.height, 0, 1);
  const width = Math.max(actualWidth, 0.12);
  const height = Math.max(actualHeight, 0.16);
  const centerX = clamp(displayedViewport.value.x + actualWidth / 2);
  const centerY = clamp(displayedViewport.value.y + actualHeight / 2);
  const left = clamp(centerX - width / 2, 0, 1 - width);
  const top = clamp(centerY - height / 2, 0, 1 - height);
  return {
    width: `${width * 100}%`,
    height: `${height * 100}%`,
    transform: `translate(${(left * 100) / width}%, ${(top * 100) / height}%)`,
  };
});

function handleImageLoad(event: Event): void {
  const image = event.currentTarget as HTMLImageElement;
  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
    loadedAspectRatio.value = image.naturalWidth / image.naturalHeight;
  }
}

function handleImageError(): void {
  if (mode.value === 'focus') setMode('full');
}

function setMode(nextMode: 'focus' | 'full'): void {
  if (nextMode === 'focus' && !hasFocusOverview.value) return;
  mode.value = nextMode;
  loadedAspectRatio.value = null;
}

function toFullPosition(position: { x: number; y: number }): { x: number; y: number } {
  const focus = props.focusRegion;
  if (mode.value !== 'focus' || !focus) return position;
  return {
    x: focus.x + position.x * focus.width,
    y: focus.y + position.y * focus.height,
  };
}

function navigateFromPointer(event: PointerEvent | MouseEvent): void {
  const bounds = surface.value?.getBoundingClientRect();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
  emit(
    'navigate',
    toFullPosition({
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    }),
  );
}

function startNavigation(event: PointerEvent): void {
  if (event.button !== 0 || pointerId !== null) return;
  pointerId = event.pointerId;
  ignoreNextClick = false;
  surface.value?.setPointerCapture?.(event.pointerId);
  navigateFromPointer(event);
  event.preventDefault();
}

function moveNavigation(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  ignoreNextClick = true;
  navigateFromPointer(event);
  event.preventDefault();
}

function stopNavigation(event?: PointerEvent): void {
  if (event && event.pointerId !== pointerId) return;
  const currentPointer = pointerId;
  pointerId = null;
  if (currentPointer !== null && surface.value?.hasPointerCapture?.(currentPointer)) {
    surface.value.releasePointerCapture(currentPointer);
  }
}

function handleClick(event: MouseEvent): void {
  if (ignoreNextClick) {
    ignoreNextClick = false;
    return;
  }
  if (event.detail > 0) navigateFromPointer(event);
}

function handleKeydown(event: KeyboardEvent): void {
  const horizontalStep = Math.max(0.02, props.viewport.width * 0.5);
  const verticalStep = Math.max(0.02, props.viewport.height * 0.5);
  const centerX = displayedViewport.value.x + displayedViewport.value.width / 2;
  const centerY = displayedViewport.value.y + displayedViewport.value.height / 2;
  if (event.key === 'ArrowLeft')
    emit('navigate', toFullPosition({ x: clamp(centerX - horizontalStep), y: centerY }));
  else if (event.key === 'ArrowRight') {
    emit('navigate', toFullPosition({ x: clamp(centerX + horizontalStep), y: centerY }));
  } else if (event.key === 'ArrowUp') {
    emit('navigate', toFullPosition({ x: centerX, y: clamp(centerY - verticalStep) }));
  } else if (event.key === 'ArrowDown') {
    emit('navigate', toFullPosition({ x: centerX, y: clamp(centerY + verticalStep) }));
  } else return;
  event.preventDefault();
}
</script>

<style scoped>
.documents-overview-map {
  position: absolute;
  top: var(--kb-space-element);
  right: var(--kb-space-element);
  z-index: 2;
  overflow: hidden;
  width: clamp(180px, 20vw, 220px);
  border: 1px solid rgb(255 255 255 / 45%);
  border-radius: var(--kb-radius-sm);
  background: rgb(20 25 31 / 92%);
  box-shadow: var(--kb-shadow-sm);
}
.documents-overview-map__title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--kb-space-2);
  padding: var(--kb-space-1) var(--kb-space-2);
  color: #fff;
  font-size: 12px;
  line-height: 20px;
}
.documents-overview-map__identity {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  line-height: 16px;
}
.documents-overview-map__hint {
  color: rgb(255 255 255 / 68%);
  font-size: 11px;
  white-space: nowrap;
}
.documents-overview-map__modes {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--kb-space-1);
}
.documents-overview-map__mode {
  --el-button-bg-color: transparent;
  --el-button-text-color: rgb(255 255 255 / 68%);
  --el-button-hover-bg-color: rgb(255 255 255 / 10%);
  --el-button-hover-text-color: #fff;
  --el-button-active-bg-color: rgb(255 255 255 / 16%);
  --el-button-active-text-color: #fff;
  --el-button-size: fit-content;
  padding-inline: var(--kb-space-2);
}
.documents-overview-map__mode.is-active {
  --el-button-bg-color: rgb(255 255 255 / 16%);
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: rgb(255 255 255 / 16%);
}
.documents-overview-map__modes .documents-overview-map__mode.el-button.is-text:not(.is-disabled) {
  color: rgb(255 255 255 / 68%);
  background-color: transparent;
}
.documents-overview-map__modes
  .documents-overview-map__mode.el-button.is-text:not(.is-disabled):hover,
.documents-overview-map__modes
  .documents-overview-map__mode.el-button.is-text:not(.is-disabled):focus,
.documents-overview-map__modes
  .documents-overview-map__mode.el-button.is-text:not(.is-disabled).is-active {
  color: #fff;
  background-color: rgb(255 255 255 / 16%);
}
.documents-overview-map__surface {
  position: relative;
  display: block;
  overflow: hidden;
  width: 100%;
  min-height: 76px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: #212830;
  cursor: crosshair;
  touch-action: none;
}
.documents-overview-map__surface img {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.documents-overview-map__viewport {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  border: 2px solid #ffb020;
  background: rgb(255 176 32 / 16%);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 55%);
  pointer-events: none;
}
.documents-overview-map__focus {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  border: 2px solid #48a7ff;
  background: rgb(72 167 255 / 18%);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 55%);
  pointer-events: none;
}
.documents-overview-map__center {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  border: 1px solid #fff;
  border-radius: 50%;
  background: #ff8a00;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 65%);
  transform: translate(-50%, -50%);
}

@media (max-width: 767px) {
  .documents-overview-map {
    width: 180px;
  }
  .documents-overview-map__surface {
    min-height: 64px;
  }
}
</style>
