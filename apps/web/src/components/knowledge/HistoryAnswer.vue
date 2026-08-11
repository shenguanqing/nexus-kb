<script setup lang="ts">
import type { ConversationTurn, KnowledgeSource } from '@nexus-kb/contracts';
import { computed } from 'vue';
import SafeMarkdown from '@/components/common/SafeMarkdown.vue';

const props = defineProps<{ turn: ConversationTurn }>();
const emit = defineEmits<{ selectSource: [source: KnowledgeSource] }>();
const displaySources = computed(() =>
  props.turn.sources.map((source, index) => ({ ...source, index: index + 1 })),
);
const compactSourceIndexes = computed(
  () => new Map(props.turn.sources.map((source, index) => [source.index, index + 1])),
);
const displayAnswer = computed(() =>
  props.turn.answer.replace(/\[来源(\d+)\]/g, (citation, sourceIndex: string) => {
    const compactIndex = compactSourceIndexes.value.get(Number(sourceIndex));
    return compactIndex === undefined ? citation : `[来源${compactIndex}]`;
  }),
);

function selectCitation(sourceIndex: number): void {
  const source = displaySources.value.find((candidate) => candidate.index === sourceIndex);
  if (source) emit('selectSource', source);
}
</script>

<template>
  <div class="history-answer">
    <strong>知枢</strong>
    <div class="history-answer-content">
      <div v-if="turn.answerMode === 'general'" class="general-answer-notice">
        <strong>通用知识补充</strong>
        <span>非知识库资料，仅供参考。</span>
      </div>
      <SafeMarkdown
        :content="displayAnswer"
        interactive-citations
        @select-citation="selectCitation"
      />
    </div>
    <section v-if="displaySources.length" class="answer-sources" aria-label="历史回答来源">
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
            <template v-if="source.page || source.sheet">
              {{ source.page ? `第 ${source.page} 页` : `工作表 ${source.sheet}` }} ·
            </template>
            v{{ source.documentVersion }}
          </small>
        </button>
      </div>
    </section>
    <small class="history-answer-meta">
      {{ turn.sourceCount }} 个历史来源 · Trace {{ turn.traceId }}
    </small>
  </div>
</template>
