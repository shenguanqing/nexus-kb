<template>
  <div class="ask-composer" :class="{ 'is-disabled': isSubmitting }" :aria-busy="isSubmitting">
    <label class="kb-visually-hidden" for="knowledge-question">输入问题</label>
    <el-input
      id="knowledge-question"
      ref="textarea"
      type="textarea"
      class="composer-input"
      :model-value="modelValue"
      :autosize="{ minRows: 1, maxRows: 8 }"
      :disabled="isSubmitting"
      maxlength="2000"
      placeholder="随心输入"
      @update:model-value="emit('update:modelValue', $event)"
      @keydown="onKeydown"
    />
    <div class="composer-footer">
      <span class="scope-pill kb-text kb-text--xs kb-text--secondary">
        <el-icon class="scope-pill__icon"><Collection /></el-icon>
        全部可访问知识
      </span>
      <span class="composer-footer__meta">
        <span class="composer-hint kb-text kb-text--xs kb-text--tertiary">
          Enter 发送 · Shift + Enter 换行
        </span>
        <span v-if="isNearLimit" class="character-count kb-text kb-text--tertiary">
          <span
            class="kb-text"
            :class="modelValue.length >= 2000 ? ['kb-text--danger', 'kb-text--medium'] : undefined"
          >
            {{ modelValue.length }}
          </span>
          /2000
        </span>
        <el-button
          class="composer-send"
          type="primary"
          circle
          :disabled="isInvalid || isSubmitting"
          aria-label="发送问题"
          @click="submit"
        >
          <el-icon class="composer-send__icon" :class="{ 'is-spinning': isSubmitting }">
            <component :is="isSubmitting ? Loading : Top" />
          </el-icon>
        </el-button>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Top, Collection, Loading } from '@element-plus/icons-vue';
import { computed, ref, watch } from 'vue';

const props = defineProps<{ modelValue: string; isSubmitting: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; submit: [] }>();
const textarea = ref<{ focus: () => void } | null>(null);
const normalized = computed(() => props.modelValue.trim());
const isInvalid = computed(() => normalized.value.length < 2 || normalized.value.length > 2000);
const isNearLimit = computed(() => props.modelValue.length > 1800);

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
  display: flex;
  flex-direction: column;
  gap: var(--kb-space-1);
  padding: var(--kb-space-2);
  border: 1px solid var(--kb-color-border);
  border-radius: var(--kb-radius-sheet);
  background: var(--kb-color-surface);
  box-shadow: var(--kb-shadow-input);
  transition:
    border-color var(--kb-transition-fast),
    box-shadow var(--kb-transition-fast);
}
.ask-composer.is-disabled {
  opacity: var(--kb-opacity-muted);
}
.ask-composer:focus-within {
  border-color: var(--kb-color-primary);
}

.composer-input :deep(.el-textarea__inner) {
  width: 100%;
  min-height: var(--kb-control-height-textarea);
  resize: none;
  padding: var(--kb-space-2);
  border: 0;
  outline: 0;
  color: var(--kb-color-text-primary);
  line-height: var(--kb-line-height-body);
  box-shadow: none;
}

/* 底部信息行：作用域 + 提示 / 字数 + 发送按钮 */
.composer-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--kb-space-2);
}
.composer-footer__meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--kb-space-2);
  min-width: 0;
}
.scope-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--kb-space-1);
  padding: var(--kb-space-1) var(--kb-space-2);
  border-radius: var(--kb-radius-pill);
  background: var(--kb-color-canvas);
  line-height: 1;
}
.scope-pill__icon {
  font-size: 12px;
}
.composer-hint {
  line-height: 1;
  white-space: nowrap;
}
.character-count {
  min-width: 60px;
  font-size: 10px;
  text-align: right;
  white-space: nowrap;
}

/*
 * 发送按钮：不使用 el-button 的 loading 属性，因为 Element Plus 会在其内部
 * loading 图标上附加 margin-right（只要 default slot 存在，即使 v-if 渲染为空
 * 也会附加），导致图标视觉不居中。这里改为自行渲染唯一子元素（箭头或加载图标），
 * 并用 grid 强制居中，从根本上避免这个问题。
 */
.composer-send {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  gap: var(--kb-space-0);
  width: 30px;
  height: 30px;
  min-height: 30px;
  padding: var(--kb-space-0);
}
.composer-send__icon {
  display: block;
  font-size: 16px;
  line-height: 1;
}
.composer-send__icon.is-spinning {
  animation: composer-spin 0.9s linear infinite;
}
@keyframes composer-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .ask-composer {
    padding: var(--kb-space-2) var(--kb-space-2)
      calc(var(--kb-space-2) + env(safe-area-inset-bottom));
  }
  .composer-hint {
    display: none;
  }
}
</style>
