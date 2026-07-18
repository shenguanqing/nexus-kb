<script setup lang="ts">
import type { KnowledgeQueryResponse, KnowledgeSource } from '@nexus-kb/contracts';
import { ref } from 'vue';
import { queryKnowledge } from '@/api/knowledge';
import { ApiError } from '@/api/client';
import AskComposer from '@/components/knowledge/AskComposer.vue';
import AssistantAnswer from '@/components/knowledge/AssistantAnswer.vue';
import SourceDrawer from '@/components/knowledge/SourceDrawer.vue';

const question = ref('');
const submittedQuestion = ref<string | null>(null);
const response = ref<KnowledgeQueryResponse | null>(null);
const error = ref<ApiError | null>(null);
const isSubmitting = ref(false);
const selectedSource = ref<KnowledgeSource | null>(null);
const isSourceOpen = ref(false);
const examples = [
  '报销需要准备哪些材料？',
  '项目验收后的付款周期是多久？',
  '公司的年假制度如何计算？',
];

async function submit(): Promise<void> {
  if (isSubmitting.value) return;
  const current = question.value.trim();
  submittedQuestion.value = current;
  error.value = null;
  response.value = null;
  isSubmitting.value = true;
  try {
    response.value = await queryKnowledge(current);
    question.value = '';
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught : new ApiError(0, 'UNKNOWN', '请求失败，请重试', null);
  } finally {
    isSubmitting.value = false;
  }
}

function openSource(source: KnowledgeSource): void {
  selectedSource.value = source;
  isSourceOpen.value = true;
}
</script>

<template>
  <section class="ask-page">
    <header class="ask-header">
      <div>
        <span class="eyebrow">企业知识助手</span>
        <h1>从可信资料中找到答案</h1>
      </div>
      <button
        type="button"
        class="new-chat"
        @click="
          response = null;
          submittedQuestion = null;
          error = null;
        "
      >
        ＋ 新建问答
      </button>
    </header>
    <div class="conversation" :class="{ empty: !submittedQuestion && !isSubmitting }">
      <div v-if="!submittedQuestion && !isSubmitting" class="welcome-state">
        <span class="welcome-mark">N</span>
        <h2>今天想从企业知识库了解什么？</h2>
        <p>回答仅基于您有权访问的资料，并附带可核验来源。</p>
        <div class="example-grid">
          <button
            v-for="example in examples"
            :key="example"
            type="button"
            @click="question = example"
          >
            {{ example }}<span>↗</span>
          </button>
        </div>
      </div>
      <div v-if="submittedQuestion" class="user-message">
        <span>你</span>
        <p>{{ submittedQuestion }}</p>
      </div>
      <div v-if="isSubmitting" class="retrieving-state" aria-live="polite">
        <span class="pulse"></span>
        <div>
          <strong>正在检索资料</strong>
          <p>正在从您有权访问的知识中查找依据…</p>
        </div>
      </div>
      <div v-if="error" class="inline-error" role="alert">
        <div>
          <strong>{{ error.status === 429 ? '请求较多，请稍后重试' : error.message }}</strong>
          <p v-if="error.traceId">Trace ID：{{ error.traceId }}</p>
        </div>
        <el-button @click="submit">重试</el-button>
      </div>
      <AssistantAnswer v-if="response" :response="response" @select-source="openSource" />
    </div>
    <AskComposer v-model="question" :is-submitting="isSubmitting" @submit="submit" />
    <p class="composer-caption">
      知枢可能出错，请通过来源核验重要信息。问题与回答不会保存到浏览器持久化存储。
    </p>
    <SourceDrawer v-model="isSourceOpen" :source="selectedSource" />
  </section>
</template>
