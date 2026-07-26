<script setup lang="ts">
import type { KnowledgeQueryResponse, KnowledgeSource } from '@nexus-kb/contracts';
import { computed } from 'vue';

const props = defineProps<{ response: KnowledgeQueryResponse }>();
defineEmits<{ selectSource: [source: KnowledgeSource] }>();

interface AnswerPart {
  text: string;
  citation: boolean;
}

const answerParts = computed<AnswerPart[]>(() => {
  const parts: AnswerPart[] = [];
  const pattern = /\[来源\d+\]/g;
  let offset = 0;
  for (const match of props.response.answer.matchAll(pattern)) {
    const index = match.index;
    if (index > offset) {
      parts.push({ text: props.response.answer.slice(offset, index), citation: false });
    }
    parts.push({ text: match[0], citation: true });
    offset = index + match[0].length;
  }
  if (offset < props.response.answer.length) {
    parts.push({ text: props.response.answer.slice(offset), citation: false });
  }
  return parts;
});
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
      <p v-else class="answer-text">
        <template v-for="(part, index) in answerParts" :key="index">
          <small v-if="part.citation" class="answer-citation">{{ part.text }}</small>
          <span v-else>{{ part.text }}</span>
        </template>
      </p>
      <div v-if="response.sources.length" class="source-list" aria-label="回答来源">
        <button
          v-for="source in response.sources"
          :key="source.index"
          type="button"
          class="source-card"
          @click="$emit('selectSource', source)"
        >
          <span>来源 {{ source.index }}</span>
          <strong :title="source.sourceName">{{ source.sourceName }}</strong>
          <small>
            {{ source.page ? `第 ${source.page} 页` : source.sheet ? source.sheet : '位置未标注' }}
            · v{{ source.documentVersion }}
          </small>
        </button>
      </div>
      <div class="answer-meta">
        <span>Trace ID：{{ response.traceId }}</span>
        <span v-if="response.model">
          {{ response.model.provider }} / {{ response.model.model }}
        </span>
        <span v-if="response.rerankDegraded">Rerank 已安全降级</span>
      </div>
    </div>
  </article>
</template>
