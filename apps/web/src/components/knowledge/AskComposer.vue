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

<template>
  <div class="ask-composer">
    <label class="sr-only" for="knowledge-question">输入知识库问题</label>
    <el-input
      id="knowledge-question"
      ref="textarea"
      class="ask-composer-input"
      type="textarea"
      :model-value="modelValue"
      :autosize="{ minRows: 2, maxRows: 5 }"
      maxlength="2000"
      placeholder="输入问题，Enter 发送，Shift + Enter 换行"
      @update:model-value="emit('update:modelValue', $event)"
      @keydown="onKeydown"
    />
    <div class="composer-footer">
      <span class="scope-pill">全部可访问知识</span>
      <span class="character-count" :class="{ danger: modelValue.length > 2000 }">
        {{ modelValue.length }}/2000
      </span>
      <el-button type="primary" round :loading="isSubmitting" :disabled="isInvalid" @click="submit">
        发送
      </el-button>
    </div>
  </div>
</template>
