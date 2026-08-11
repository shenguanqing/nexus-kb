<script setup lang="ts">
import type { KnowledgeSource } from '@nexus-kb/contracts';
import { computed } from 'vue';
import { useBreakpoint } from '@/composables/useBreakpoint';

const props = withDefaults(
  defineProps<{ modelValue: boolean; source: KnowledgeSource | null; returnTo?: string }>(),
  { returnTo: '/ask' },
);
defineEmits<{ 'update:modelValue': [value: boolean] }>();
const { isPhone } = useBreakpoint();
const sourceLocation = computed(() => {
  if (props.source?.page) return `第 ${props.source.page} 页`;
  if (props.source?.sheet) return `工作表 ${props.source.sheet}`;
  return null;
});
const previewTarget = computed(() => {
  if (!props.source) return '/ask';
  const query: Record<string, string> = {
    from: props.returnTo,
    version: String(props.source.documentVersion),
  };
  if (props.source.page) query.page = String(props.source.page);
  if (props.source.sheet) query.sheet = props.source.sheet;
  return { path: `/documents/${props.source.documentId}/preview`, query };
});
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :size="isPhone ? '100%' : '420px'"
    title="来源详情"
    class="source-drawer"
    append-to-body
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div v-if="source" class="source-detail">
      <header class="source-detail__header">
        <span class="source-index">来源 {{ source.index }}</span>
        <div class="heading heading--h2" role="heading" aria-level="2">{{ source.sourceName }}</div>
      </header>

      <div v-if="sourceLocation || source.sectionPath.length" class="source-reference">
        <div v-if="sourceLocation" class="source-reference__item">
          <span>位置</span>
          <strong>{{ sourceLocation }}</strong>
        </div>
        <div v-if="source.sectionPath.length" class="source-reference__item">
          <span>章节</span>
          <strong>{{ source.sectionPath.join(' / ') }}</strong>
        </div>
      </div>

      <div class="source-detail__notice text-block">
        这里只显示本次回答中后端已授权返回的来源信息。查看内容时会重新验证权限。
      </div>
    </div>
    <template #footer>
      <RouterLink v-if="source" class="source-drawer__document-link" :to="previewTarget">
        <el-button type="primary">预览文档</el-button>
      </RouterLink>
    </template>
  </el-drawer>
</template>
