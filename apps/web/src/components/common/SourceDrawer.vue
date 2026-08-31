<template>
  <el-drawer
    :model-value="modelValue"
    :class="['source-drawer', { 'source-drawer--mobile': isMobile }]"
    :direction="isMobile ? 'btt' : 'rtl'"
    :size="isMobile ? 'auto' : '420px'"
    :style="isMobile ? mobileDrawerStyle : undefined"
    with-header
    title="来源详情"
    append-to-body
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div v-if="source" class="source-detail">
      <header class="source-detail__header">
        <span class="source-index kb-text kb-text--sm kb-text--strong">
          来源 {{ source.index }}
        </span>
        <div
          class="source-detail__title kb-heading kb-heading--h2"
          role="heading"
          aria-level="2"
        >
          {{ source.sourceName }}
        </div>
      </header>

      <div
        v-if="sourceLocation || source.sectionPath.length"
        class="source-reference kb-block kb-block--flush"
      >
        <div v-if="sourceLocation" class="source-reference__item">
          <span
            class="source-reference__label kb-text kb-text--xs kb-text--secondary kb-text--strong"
          >
            位置
          </span>
          <strong class="source-reference__value kb-text kb-text--primary">
            {{ sourceLocation }}
          </strong>
        </div>
        <div v-if="source.sectionPath.length" class="source-reference__item">
          <span
            class="source-reference__label kb-text kb-text--xs kb-text--secondary kb-text--strong"
          >
            章节
          </span>
          <strong class="source-reference__value kb-text kb-text--primary">
            {{ source.sectionPath.join(' / ') }}
          </strong>
        </div>
      </div>

      <div class="source-detail__notice kb-text kb-text--sm kb-text--secondary">
        这里只显示本次回答中后端已授权返回的来源信息。查看内容时会重新验证权限。
      </div>
    </div>
    <template #footer>
      <RouterLink v-if="source" class="source-drawer__document-link" :to="previewTarget">
        <el-button class="source-preview-button" type="primary">预览文档</el-button>
      </RouterLink>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import type { KnowledgeSource } from '@nexus-kb/contracts';
import { computed } from 'vue';
import { useBreakpoint } from '@/composables/useBreakpoint';

const props = withDefaults(
  defineProps<{ modelValue: boolean; source: KnowledgeSource | null; returnTo?: string }>(),
  { returnTo: '/ask' },
);
defineEmits<{ 'update:modelValue': [value: boolean] }>();
const { isMobile } = useBreakpoint();
const mobileDrawerStyle = { maxHeight: 'calc(100dvh - var(--kb-space-6))' } as const;
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

<style scoped>
.source-index {
  color: var(--kb-color-primary);
}
.source-detail {
  display: grid;
  align-content: start;
  gap: var(--kb-layout-gap);
}
.source-detail__header {
  display: grid;
  gap: var(--kb-space-2);
}
.source-detail__title {
  overflow-wrap: anywhere;
}
.source-reference {
  display: grid;
  gap: var(--kb-layout-gap);
  background: var(--kb-color-canvas);
}
.source-reference__item {
  display: grid;
  gap: var(--kb-space-1);
  padding: var(--kb-block-padding);
}
.source-reference__value {
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.55;
}
.source-detail__notice {
  padding: var(--kb-block-padding);
  border-radius: var(--kb-radius-md);
  background: var(--kb-color-info-soft);
  line-height: 1.6;
}
.source-drawer__document-link {
  display: block;
  width: 100%;
}
.source-preview-button {
  display: block;
  width: 100%;
}
@media (max-width: 767px) {
  .source-index {
    font-size: 15px;
    font-weight: 500;
  }
  .source-detail__title {
    font-size: 18px;
    line-height: 1.45;
  }
  .source-reference__label {
    font-size: 12px;
  }
  .source-reference__value {
    font-size: 15px;
  }
  .source-detail__notice {
    padding: var(--kb-block-padding);
    font-size: 14px;
  }
}
</style>
