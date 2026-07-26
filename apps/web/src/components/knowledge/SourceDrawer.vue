<script setup lang="ts">
import type { KnowledgeSource } from '@nexus-kb/contracts';

defineProps<{ modelValue: boolean; source: KnowledgeSource | null }>();
defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    size="300px"
    title="来源详情"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div v-if="source" class="source-detail">
      <span class="source-index">来源 {{ source.index }}</span>
      <h2>{{ source.sourceName }}</h2>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="版本">v{{ source.documentVersion }}</el-descriptions-item>
        <el-descriptions-item label="位置">
            {{
              source.page
                ? `第 ${source.page} 页`
                : source.sheet
                  ? `工作表 ${source.sheet}`
                  : '未标注位置'
            }}
        </el-descriptions-item>
        <el-descriptions-item label="章节">
          {{ source.sectionPath.join(' / ') || '未标注章节' }}
        </el-descriptions-item>
      </el-descriptions>
      <p class="security-note">
        这里只显示本次回答中后端已授权返回的来源信息。查看内容时会重新验证权限。
      </p>
      <RouterLink :to="`/documents/${source.documentId}`">
        <el-button disabled>文档详情将在 F3 开放</el-button>
      </RouterLink>
    </div>
  </el-drawer>
</template>
