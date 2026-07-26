<script setup lang="ts">
import type { ConversationTurn } from '@nexus-kb/contracts';
import SafeMarkdown from '@/components/common/SafeMarkdown.vue';

defineProps<{ turn: ConversationTurn }>();
</script>

<template>
  <div class="history-answer">
    <strong>知枢</strong>
    <div class="history-answer-content">
      <div v-if="turn.answerMode === 'general'" class="general-answer-notice">
        <strong>通用知识补充</strong>
        <span>非企业知识库资料，仅供参考。</span>
      </div>
      <SafeMarkdown :content="turn.answer" />
    </div>
    <small class="history-answer-meta">
      {{ turn.sourceCount }} 个历史来源 · Trace {{ turn.traceId }}
    </small>
  </div>
</template>
