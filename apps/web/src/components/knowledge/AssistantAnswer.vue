<script setup lang="ts">
import type { KnowledgeQueryResponse, KnowledgeSource } from '@nexus-kb/contracts';

defineProps<{ response: KnowledgeQueryResponse }>();
defineEmits<{ selectSource: [source: KnowledgeSource] }>();
</script>

<template>
  <article class="answer-card" aria-live="polite">
    <div class="answer-avatar" aria-hidden="true">N</div>
    <div class="answer-content">
      <div class="answer-label">知枢助手</div>
      <div v-if="response.noAnswer" class="no-answer">
        <strong>暂时没有找到足够依据</strong>
        <p>
          {{
            response.reason === 'authorization_changed'
              ? '可用来源已发生变化，请重试。'
              : '您可以换一种问法，或联系文档管理员补充资料。'
          }}
        </p>
      </div>
      <p v-else class="answer-text">{{ response.answer }}</p>
      <div v-if="response.sources.length" class="source-list" aria-label="回答来源">
        <button
          v-for="source in response.sources"
          :key="source.index"
          type="button"
          class="source-card"
          @click="$emit('selectSource', source)"
        >
          <span>来源 {{ source.index }}</span
          ><strong>{{ source.sourceName }}</strong>
          <small
            >{{
              source.page ? `第 ${source.page} 页` : source.sheet ? source.sheet : '位置未标注'
            }}
            · v{{ source.documentVersion }}</small
          >
        </button>
      </div>
      <div class="answer-meta">
        <span>Trace ID：{{ response.traceId }}</span
        ><span v-if="response.model"
          >{{ response.model.provider }} / {{ response.model.model }}</span
        ><span v-if="response.rerankDegraded">Rerank 已安全降级</span>
      </div>
    </div>
  </article>
</template>
