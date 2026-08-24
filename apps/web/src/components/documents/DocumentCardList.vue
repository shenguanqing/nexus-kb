<template>
  <el-empty
    v-if="!loading && data.length === 0"
    class="kb-empty-state"
    description="暂无符合条件的文档"
  />
  <div v-else class="kb-block-list" aria-label="文档列表">
    <article v-for="document in data" :key="document.id" class="kb-block">
      <div class="kb-block__header">
        <div class="kb-block__title kb-heading kb-heading--h4">
          <RouterLink v-slot="{ href, navigate }" :to="`/documents/${document.id}`" custom>
            <el-link
              class="kb-link"
              type="primary"
              underline="never"
              :href="href"
              @click="navigate"
            >
              <span class="kb-link__text">{{ document.sourceName }}</span>
            </el-link>
          </RouterLink>
        </div>
        <el-tag :type="statusType(document.status)" size="small">
          {{ statusLabel(document.status) }}
        </el-tag>
      </div>
      <div class="kb-data-fields">
        <div class="kb-data-field">
          <span class="kb-data-field__label">部门</span>
          <span class="kb-data-field__value">{{ document.department }}</span>
        </div>
        <div class="kb-data-field">
          <span class="kb-data-field__label">敏感度</span>
          <span class="kb-data-field__value">{{ document.sensitivity }}</span>
        </div>
        <div class="kb-data-field">
          <span class="kb-data-field__label">版本</span>
          <span class="kb-data-field__value">
            {{ document.activeVersion ? `v${document.activeVersion}` : '—' }}
          </span>
        </div>
        <div class="kb-data-field">
          <span class="kb-data-field__label">更新时间</span>
          <span class="kb-data-field__value">{{ formatDate(document.updatedAt) }}</span>
        </div>
      </div>
    </article>
  </div>
</template>

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
