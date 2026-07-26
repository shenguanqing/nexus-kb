<script setup lang="ts">
import type { DocumentListItem } from '@nexus-kb/contracts';

defineProps<{
  data: DocumentListItem[];
  loading: boolean;
  statusLabel: (status: string) => string;
  statusType: (status: string) => 'success' | 'warning' | 'danger' | 'info';
}>();

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
</script>

<template>
  <el-empty v-if="!loading && data.length === 0" description="暂无符合条件的文档" />
  <div v-else class="document-card-list" aria-label="文档列表">
    <article v-for="document in data" :key="document.id" class="document-card">
      <header class="document-card__header">
        <RouterLink class="document-link document-card__name" :to="`/documents/${document.id}`">
          {{ document.sourceName }}
        </RouterLink>
        <el-tag :type="statusType(document.status)" size="small">
          {{ statusLabel(document.status) }}
        </el-tag>
      </header>
      <el-descriptions :column="1" size="small">
        <el-descriptions-item label="部门">{{ document.department }}</el-descriptions-item>
        <el-descriptions-item label="敏感度">{{ document.sensitivity }}</el-descriptions-item>
        <el-descriptions-item label="版本">
          {{ document.activeVersion ? `v${document.activeVersion}` : '—' }}
        </el-descriptions-item>
        <el-descriptions-item label="更新时间">
          {{ formatDate(document.updatedAt) }}
        </el-descriptions-item>
      </el-descriptions>
    </article>
  </div>
</template>
