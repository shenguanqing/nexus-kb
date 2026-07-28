<script setup lang="ts">
import type { KnowledgeSource } from '@nexus-kb/contracts';
import { computed, nextTick, ref } from 'vue';
import { queryKnowledge } from '@/api/knowledge';
import { ApiError } from '@/api/client';
import AskComposer from '@/components/knowledge/AskComposer.vue';
import AssistantAnswer from '@/components/knowledge/AssistantAnswer.vue';
import SourceDrawer from '@/components/knowledge/SourceDrawer.vue';
import { useKnowledgeConversationStore } from '@/stores/knowledge-conversation';

const conversation = useKnowledgeConversationStore();
const question = ref(conversation.pendingQuestion ?? '');
const error = ref<ApiError | null>(null);
const selectedSource = ref<KnowledgeSource | null>(null);
const isSourceOpen = ref(false);
const composer = ref<InstanceType<typeof AskComposer> | null>(null);
const conversationPanel = ref<HTMLElement | null>(null);
const hasConversation = computed(
  () =>
    conversation.turns.length > 0 ||
    conversation.pendingQuestion !== null ||
    conversation.isSubmitting,
);
// const examples = [
//   '报销需要准备哪些材料？',
//   '项目验收后的付款周期是多久？',
//   '公司的年假制度如何计算？',
// ];

async function submit(): Promise<void> {
  if (conversation.isSubmitting) return;
  const current = question.value.trim();
  if (!current) return;
  const requestId = conversation.begin(current);
  error.value = null;
  await scrollToLatest();
  try {
    const response = await queryKnowledge(current, conversation.conversationId);
    if (conversation.complete(requestId, response)) {
      question.value = '';
      await scrollToLatest();
    }
  } catch (caught) {
    if (conversation.fail(requestId)) {
      error.value =
        caught instanceof ApiError ? caught : new ApiError(0, 'UNKNOWN', '请求失败，请重试', null);
    }
  }
}

async function scrollToLatest(): Promise<void> {
  await nextTick();
  conversationPanel.value?.scrollTo({
    top: conversationPanel.value.scrollHeight,
    behavior: 'smooth',
  });
}

function openSource(source: KnowledgeSource): void {
  selectedSource.value = source;
  isSourceOpen.value = true;
}

async function startNewChat(): Promise<void> {
  question.value = '';
  conversation.reset();
  error.value = null;
  selectedSource.value = null;
  isSourceOpen.value = false;
  await nextTick();
  composer.value?.focus();
}
</script>

<template>
  <section class="ask-page">
    <header class="ask-header">
      <div>
        <span class="eyebrow">企业知识助手</span>
        <div class="heading heading--h1" role="heading" aria-level="1">从资料中找到答案</div>
      </div>
      <button type="button" class="new-chat" @click="startNewChat">＋ 新建问答</button>
    </header>
    <div ref="conversationPanel" class="conversation" :class="{ empty: !hasConversation }">
      <div v-if="!hasConversation" class="welcome-state">
        <span class="welcome-mark">N</span>
        <div class="heading heading--h2" role="heading" aria-level="2">今天想从知识库了解什么？</div>
        <div class="text-block">回答仅基于您有权访问的资料，并附带可核验来源。</div>
        <!-- <div class="example-grid">
          <button
            v-for="example in examples"
            :key="example"
            type="button"
            @click="question = example"
          >
            {{ example }}<span>↗</span>
          </button>
        </div> -->
      </div>
      <template v-for="turn in conversation.turns" :key="turn.response.traceId">
        <div class="user-message">
          <span>用户</span>
          <div class="text-block">{{ turn.question }}</div>
        </div>
        <AssistantAnswer :response="turn.response" @select-source="openSource" />
      </template>
      <div v-if="conversation.pendingQuestion" class="user-message">
        <span>用户</span>
        <div class="text-block">{{ conversation.pendingQuestion }}</div>
      </div>
      <div v-if="conversation.isSubmitting" class="retrieving-state" aria-live="polite">
        <span class="pulse"></span>
        <div>
          <strong>正在检索资料</strong>
          <div class="text-block">正在从您有权访问的知识中查找依据…</div>
        </div>
      </div>
      <div v-if="error" class="inline-error" role="alert">
        <div>
          <strong>{{ error.status === 429 ? '请求较多，请稍后重试' : error.message }}</strong>
          <div v-if="error.traceId" class="text-block">Trace ID：{{ error.traceId }}</div>
        </div>
        <el-button @click="submit">重试</el-button>
      </div>
    </div>
    <AskComposer
      ref="composer"
      v-model="question"
      :is-submitting="conversation.isSubmitting"
      @submit="submit"
    />
    <div class="composer-caption text-block">
      当前会话会连续显示；历史会话可在“问答历史”中查看。问题与回答不会保存到浏览器持久化存储。
    </div>
    <SourceDrawer v-model="isSourceOpen" :source="selectedSource" />
  </section>
</template>
