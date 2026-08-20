<template>
  <article class="answer-card" aria-live="polite">
    <div class="brand-mark">N</div>
    <div class="answer-content">
      <div class="answer-label">知枢助手</div>
      <div v-if="response.noAnswer" class="no-answer">
        <strong>暂时没有找到足够依据</strong>
        <div>
          <el-text type="warning">
            {{
              response.reason === 'authorization_changed'
                ? '可用来源已发生变化，请重试。'
                : '您可以换一种问法，或联系管理员补充资料。'
            }}
          </el-text>
        </div>
      </div>
      <template v-else>
        <div v-if="response.answerMode === 'general'" class="answer-notice">
          <strong>通用知识补充</strong>
          <span>以下内容来自模型通用知识，不是知识库资料，仅供参考。</span>
        </div>
        <SafeMarkdown
          class="answer-text"
          :content="displayAnswer"
          interactive-citations
          @select-citation="selectCitation"
        />
      </template>
      <section v-if="displaySources.length" class="answer-sources" aria-label="回答来源">
        <div class="answer-sources-label">回答来源</div>
        <div class="answer-source-list">
          <button
            v-for="source in displaySources"
            :key="source.index"
            type="button"
            class="answer-source-card kb-block kb-block--compact kb-block--interactive"
            @click="$emit('selectSource', source)"
          >
            <span class="answer-source-card-index">来源 {{ source.index }}</span>
            <strong class="answer-source-card-name" :title="source.sourceName">{{
              source.sourceName
            }}</strong>
            <small class="answer-source-card-meta">
              <template v-if="source.page || source.sheet">
                {{ source.page ? `第 ${source.page} 页` : `工作表 ${source.sheet}` }} ·
              </template>
              v{{ source.documentVersion }}
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
  margin: var(--kb-space-4) 0;
}
.answer-content {
  flex: 1;
  min-width: 0;
}
.answer-label {
  margin-bottom: var(--kb-space-2);
  font-size: 13px;
  font-weight: 700;
}
.answer-text {
  font-size: 16px;
  line-height: 1.6;
}
.no-answer {
  padding: var(--kb-space-4);
  border: 1px solid color-mix(in srgb, var(--kb-color-warning) 30%, var(--kb-color-border));
  border-radius: var(--kb-radius-md);
  background: var(--kb-color-warning-soft);
}
</style>
