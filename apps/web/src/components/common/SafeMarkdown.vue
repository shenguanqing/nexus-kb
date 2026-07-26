<script setup lang="ts">
import { computed } from 'vue';
import { renderSafeMarkdown } from '@/utils/markdown';

const props = defineProps<{ content: string }>();
const renderedContent = computed(() => renderSafeMarkdown(props.content));
</script>

<template>
  <div class="markdown-content" v-html="renderedContent"></div>
</template>
