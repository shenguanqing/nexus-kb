<template>
  <div class="markdown-content" @click="selectCitation" v-html="renderedContent"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { renderSafeMarkdown } from '@/utils/markdown';

const props = withDefaults(defineProps<{ content: string; interactiveCitations?: boolean }>(), {
  interactiveCitations: false,
});
const emit = defineEmits<{ selectCitation: [sourceIndex: number] }>();
const renderedContent = computed(() =>
  renderSafeMarkdown(props.content, { interactiveCitations: props.interactiveCitations }),
);

function selectCitation(event: MouseEvent): void {
  if (!props.interactiveCitations || !(event.target instanceof Element)) return;
  const citation = event.target.closest<HTMLElement>('.kb-answer-citation[data-source-index]');
  if (!citation) return;
  const sourceIndex = Number(citation.dataset.sourceIndex);
  if (Number.isSafeInteger(sourceIndex) && sourceIndex > 0) emit('selectCitation', sourceIndex);
}
</script>

<style scoped>
.markdown-content {
  overflow-wrap: anywhere;
  min-width: 0;
}
.markdown-content > :deep(:first-child) {
  margin-top: 0;
}
.markdown-content > :deep(:last-child) {
  margin-bottom: 0;
}
.markdown-content :deep(.markdown-paragraph),
.markdown-content :deep(.markdown-list),
.markdown-content :deep(.markdown-quote),
.markdown-content :deep(.markdown-code-block),
.markdown-content :deep(.markdown-table-scroll),
.markdown-content :deep(.markdown-divider) {
  margin: 0 0 var(--kb-space-text-xl);
}
.markdown-content :deep(.markdown-heading) {
  margin: var(--kb-space-text-2xl) 0 var(--kb-space-text-md);
  color: var(--kb-color-text-primary);
  font-weight: 700;
  line-height: 1.28;
}
.markdown-content :deep(.markdown-heading--h1) {
  font-size: 1.45em;
}
.markdown-content :deep(.markdown-heading--h2) {
  font-size: 1.3em;
}
.markdown-content :deep(.markdown-heading--h3) {
  font-size: 1.16em;
}
.markdown-content :deep(.markdown-heading--h4) {
  font-size: 1.08em;
}
.markdown-content :deep(.markdown-heading--h5),
.markdown-content :deep(.markdown-heading--h6) {
  font-size: 1em;
}
.markdown-content :deep(.markdown-list) {
  display: grid;
  gap: var(--kb-space-text-sm);
  padding-left: var(--kb-space-text-list-indent);
}
.markdown-content :deep(.markdown-list-item) {
  position: relative;
}
.markdown-content :deep(.markdown-list-item--bullet::before) {
  position: absolute;
  left: -1em;
  content: '•';
}
.markdown-content :deep(.markdown-list-item--ordered::before) {
  position: absolute;
  left: -1.5em;
  content: attr(data-list-marker);
}
.markdown-content :deep(.markdown-quote) {
  padding: var(--kb-space-text-xs) 0 var(--kb-space-text-xs) var(--kb-space-text-quote-indent);
  border-left: 3px solid var(--kb-color-border);
  color: var(--kb-color-text-secondary);
}
.markdown-content :deep(.markdown-quote > :last-child) {
  margin-bottom: 0;
}
.markdown-content :deep(.markdown-code) {
  padding: var(--kb-space-text-2xs) var(--kb-space-text-lg);
  border-radius: 4px;
  background: #f3f5f9;
  font-size: 0.88em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.markdown-content :deep(.markdown-code-block) {
  overflow: auto;
  max-width: 100%;
  padding: var(--kb-space-2) var(--kb-block-padding);
  border: 1px solid var(--kb-color-border);
  border-radius: 8px;
  background: #f7f8fa;
}
.markdown-content :deep(.markdown-code-block .markdown-code--block) {
  padding: 0;
  background: transparent;
}
.markdown-content :deep(.markdown-link) {
  color: var(--kb-color-primary);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.markdown-content :deep(.markdown-divider) {
  height: 1px;
  border: 0;
  background: var(--kb-color-border);
}
.markdown-content :deep(.markdown-table-scroll) {
  overflow-x: auto;
  max-width: 100%;
  border: 1px solid var(--kb-color-border);
  border-radius: var(--kb-radius-sm);
}
.markdown-content :deep(.markdown-table-scroll:focus-visible) {
  outline: 2px solid var(--kb-color-primary);
  outline-offset: 2px;
}
.markdown-content :deep(.markdown-table) {
  width: 100%;
  border-collapse: collapse;
}
.markdown-content :deep(.markdown-table-heading),
.markdown-content :deep(.markdown-table-cell) {
  padding: var(--kb-space-2) var(--kb-space-2);
  border-right: 1px solid var(--kb-color-border);
  border-bottom: 1px solid var(--kb-color-border);
  text-align: left;
  vertical-align: top;
}
.markdown-content :deep(.markdown-table-heading) {
  color: var(--kb-color-text-primary);
  background: var(--kb-color-primary-soft);
  font-weight: 700;
}
.markdown-content :deep(.markdown-table-row:last-child .markdown-table-cell) {
  border-bottom: 0;
}
.markdown-content :deep(.markdown-table-heading:last-child),
.markdown-content :deep(.markdown-table-cell:last-child) {
  border-right: 0;
}
.markdown-content :deep(.markdown-table-align--center) {
  text-align: center;
}
.markdown-content :deep(.markdown-table-align--right) {
  text-align: right;
}
</style>
