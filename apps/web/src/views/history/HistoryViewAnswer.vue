<template>
  <div class="history-answer">
    <strong>知枢</strong>
    <div class="history-answer-content kb-text">
      <div v-if="turn.answerMode === 'general'" class="kb-answer-notice">
        <strong>通用知识补充</strong>
        <span>非知识库资料，仅供参考。</span>
      </div>
      <SafeMarkdown
        :content="displayAnswer"
        interactive-citations
        @select-citation="selectCitation"
      />
    </div>
    <section v-if="displaySources.length" class="kb-answer-sources" aria-label="历史回答来源">
      <div class="kb-answer-sources__label">回答来源</div>
      <div class="kb-answer-sources__list">
        <div
          v-for="source in displaySources"
          :key="source.index"
          class="kb-answer-sources__card kb-block kb-block--compact kb-block--interactive"
          role="button"
          tabindex="0"
          @click="$emit('selectSource', source)"
          @keydown.enter="$emit('selectSource', source)"
          @keydown.space.prevent="$emit('selectSource', source)"
        >
          <span class="kb-answer-sources__card-index">来源 {{ source.index }}</span>
          <strong class="kb-answer-sources__card-name" :title="source.sourceName">
            {{ source.sourceName }}
          </strong>
          <small class="kb-answer-sources__card-meta">
            <template v-if="source.page || source.sheet">
              {{ source.page ? `第 ${source.page} 页` : `工作表 ${source.sheet}` }} ·
            </template>
            v{{ source.documentVersion }}
          </small>
        </div>
      </div>
    </section>
    <small class="history-answer-meta kb-text kb-text--sm kb-text--secondary">
      {{ turn.sourceCount }} 个历史来源 · Trace {{ turn.traceId }}
    </small>
  </div>
</template>

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

<style scoped>
.history-answer-content {
  grid-column: 2;
  min-width: 0;
  line-height: 1.6;
}
.history-answer-meta {
  grid-column: 2;
}
</style>
