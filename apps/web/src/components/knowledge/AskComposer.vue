<template>
  <div class="ask-composer">
    <label class="sr-only" for="knowledge-question">输入问题</label>
    <el-input
      id="knowledge-question"
      ref="textarea"
      type="textarea"
      :model-value="modelValue"
      :autosize="{ minRows: 1, maxRows: 5 }"
      maxlength="2000"
      placeholder="输入问题，Enter 发送，Shift + Enter 换行"
      @update:model-value="emit('update:modelValue', $event)"
      @keydown="onKeydown"
    />
    <div class="composer-footer">
      <span class="scope-pill">全部可访问知识</span>
      <span class="character-count" :class="{ 'is-danger': modelValue.length > 2000 }">
        {{ modelValue.length }}/2000
      </span>
      <el-button type="primary" round :loading="isSubmitting" :disabled="isInvalid" @click="submit">
        发送
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = defineProps<{ modelValue: string; isSubmitting: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; submit: [] }>();
const textarea = ref<{ focus: () => void } | null>(null);
const normalized = computed(() => props.modelValue.trim());
const isInvalid = computed(() => normalized.value.length < 2 || normalized.value.length > 2000);

function submit(): void {
  if (!props.isSubmitting && !isInvalid.value) emit('submit');
}

function onKeydown(event: Event): void {
  if (!(event instanceof KeyboardEvent)) return;
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}

function focus(): void {
  textarea.value?.focus();
}

defineExpose({ focus });

watch(
  () => props.isSubmitting,
  (value, previous) => {
    if (previous && !value) textarea.value?.focus();
  },
);
</script>

<style scoped>
.ask-composer {
  padding: var(--kb-space-2);
  border: 1px solid var(--kb-color-border);
  border-radius: var(--kb-radius-lg);
  background: var(--kb-color-surface);
}
.ask-composer :deep(.el-textarea__inner) {
  width: 100%;
  min-height: var(--kb-control-height-textarea);
  resize: none;
  border: 0;
  outline: 0;
  color: var(--kb-color-text-primary);
  line-height: var(--kb-line-height-body);
  box-shadow: none;
}
.composer-footer {
  display: flex;
  align-items: center;
  gap: var(--kb-layout-gap);
}
.scope-pill {
  padding: var(--kb-space-1) var(--kb-space-2);
  border-radius: var(--kb-radius-pill);
  color: var(--kb-color-text-secondary);
  background: var(--kb-color-canvas);
  font-size: 11px;
}
.character-count {
  margin-left: auto;
  color: var(--kb-color-text-tertiary);
  font-size: 10px;
}
.character-count.is-danger {
  color: var(--kb-color-danger);
}
/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .ask-composer {
    padding-bottom: calc(var(--kb-block-padding) + env(safe-area-inset-bottom));
  }
}
</style>
