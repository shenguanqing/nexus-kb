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
  const citation = event.target.closest<HTMLElement>('.answer-citation[data-source-index]');
  if (!citation) return;
  const sourceIndex = Number(citation.dataset.sourceIndex);
  if (Number.isSafeInteger(sourceIndex) && sourceIndex > 0) emit('selectCitation', sourceIndex);
}
</script>

<template>
  <div class="markdown-content" @click="selectCitation" v-html="renderedContent"></div>
</template>
