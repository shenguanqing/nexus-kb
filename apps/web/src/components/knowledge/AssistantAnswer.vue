<script setup lang="ts">
import type { KnowledgeQueryResponse, KnowledgeSource } from '@nexus-kb/contracts';
import { computed } from 'vue';
import SafeMarkdown from '@/components/common/SafeMarkdown.vue';

const props = defineProps<{ response: KnowledgeQueryResponse }>();
defineEmits<{ selectSource: [source: KnowledgeSource] }>();

const displaySources = computed(() =>
  props.response.sources.map((source, index) => ({ ...source, index: index + 1 })),
);
const compactSourceIndexes = computed(
  () => new Map(props.response.sources.map((source, index) => [source.index, index + 1])),
);
const displayAnswer = computed(() =>
  props.response.answer.replace(/\[来源(\d+)\]/g, (citation, sourceIndex: string) => {
    const compactIndex = compactSourceIndexes.value.get(Number(sourceIndex));
    return compactIndex === undefined ? citation : `[来源${compactIndex}]`;
  }),
);
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
              : '您可以换一种问法，或联系管理员补充资料。'
          }}
        </p>
      </div>
      <template v-else>
        <div v-if="response.answerMode === 'general'" class="general-answer-notice">
          <strong>通用知识补充</strong>
          <span>以下内容来自模型通用知识，不是企业知识库资料，仅供参考。</span>
        </div>
        <SafeMarkdown class="answer-text" :content="displayAnswer" />
      </template>
      <section v-if="displaySources.length" class="answer-sources" aria-label="回答来源">
        <div class="answer-sources-label">回答来源</div>
        <div class="source-list">
          <button
            v-for="source in displaySources"
            :key="source.index"
            type="button"
            class="source-card"
            @click="$emit('selectSource', source)"
          >
            <span>来源 {{ source.index }}</span>
            <strong :title="source.sourceName">{{ source.sourceName }}</strong>
            <small>
              {{
                source.page ? `第 ${source.page} 页` : source.sheet ? source.sheet : '位置未标注'
              }}
              · v{{ source.documentVersion }}
            </small>
          </button>
        </div>
      </section>
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
