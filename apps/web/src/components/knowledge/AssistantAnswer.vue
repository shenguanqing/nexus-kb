<template>
  <article class="answer-card" aria-live="polite">
    <div class="kb-brand-mark">N</div>
    <div class="answer-content">
      <div class="answer-label kb-text kb-text--strong">知枢助手</div>
      <div v-if="response.noAnswer" class="no-answer">
        <strong>暂时没有找到足够依据</strong>
        <div class="kb-text kb-text--warning">
          {{
            response.reason === 'authorization_changed'
              ? '可用来源已发生变化，请重试。'
              : '您可以换一种问法，或联系管理员补充资料。'
          }}
        </div>
      </div>
      <template v-else>
        <div v-if="response.answerMode === 'general'" class="kb-answer-notice">
          <strong>通用知识补充</strong>
          <span>以下内容来自模型通用知识，不是知识库资料，仅供参考。</span>
        </div>
        <SafeMarkdown
          class="kb-text kb-text--lg"
          :content="displayAnswer"
          interactive-citations
          @select-citation="selectCitation"
        />
      </template>
      <section v-if="displaySources.length" class="kb-answer-sources" aria-label="回答来源">
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
      <div class="kb-answer-meta">
        <span>Trace ID：{{ response.traceId }}</span>
        <span v-if="response.model">
          {{ response.model.provider }} / {{ response.model.model }}
        </span>
        <span v-if="response.rerankDegraded">Rerank 已安全降级</span>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import type { KnowledgeQueryResponse, KnowledgeSource } from '@nexus-kb/contracts';
import { computed } from 'vue';
import SafeMarkdown from '@/components/common/SafeMarkdown.vue';

const props = defineProps<{ response: KnowledgeQueryResponse }>();
const emit = defineEmits<{ selectSource: [source: KnowledgeSource] }>();

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

function selectCitation(sourceIndex: number): void {
  const source = displaySources.value.find((candidate) => candidate.index === sourceIndex);
  if (source) emit('selectSource', source);
}
</script>

<style scoped>
.answer-card {
  display: flex;
  gap: var(--kb-layout-gap);
  margin: var(--kb-block-padding) 0;
}
.answer-content {
  flex: 1;
  min-width: 0;
}
.answer-label {
  margin-bottom: var(--kb-space-2);
  font-size: 13px;
}
.no-answer {
  padding: var(--kb-block-padding);
  border: 1px solid color-mix(in srgb, var(--kb-color-warning) 30%, var(--kb-color-border));
  border-radius: var(--kb-radius-md);
  background: var(--kb-color-warning-soft);
}
</style>
