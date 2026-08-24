<template>
  <section class="kb-page">
    <el-page-header class="kb-page-header">
      <template #content>
        <div class="kb-title-group">
          <div class="kb-heading kb-heading--h1" role="heading" aria-level="1">
            从资料中找到答案
          </div>
          <span class="kb-text kb-text--secondary">知识助手</span>
        </div>
      </template>
      <template #extra>
        <div class="kb-action-group">
          <el-button @click="startNewChat">新建问答</el-button>
        </div>
      </template>
    </el-page-header>
    <div ref="conversationPanel" class="conversation" :class="{ 'is-empty': !hasConversation }">
      <div v-if="!hasConversation" class="welcome-state">
        <span class="kb-brand-mark welcome-mark">N</span>
        <div class="welcome-state__title kb-heading kb-heading--h2" role="heading" aria-level="2">
          今天想从知识库了解什么？
        </div>
        <div class="kb-text kb-text--md kb-text--secondary">
          回答仅基于您有权访问的资料，并附带可核验来源。
        </div>
      </div>
      <template v-for="turn in conversation.turns" :key="turn.response.traceId">
        <div class="user-message">
          <!-- <span class="user-message-avatar">用户</span> -->
          <div class="user-message-value">
            <div class="kb-text kb-text--secondary">{{ turn.question }}</div>
          </div>
        </div>
        <AssistantAnswer :response="turn.response" @select-source="openSource" />
      </template>
      <div v-if="conversation.pendingQuestion" class="user-message">
        <!-- <span class="user-message-avatar">用户</span> -->
        <div class="user-message-value">
          <div class="kb-text kb-text--secondary">{{ conversation.pendingQuestion }}</div>
        </div>
      </div>
      <div v-if="conversation.isSubmitting" class="retrieving-state" aria-live="polite">
        <span class="pulse"></span>
        <div>
          <strong>正在检索资料</strong>
          <div>
            <span class="kb-text kb-text--secondary">正在从您有权访问的知识中查找依据…</span>
          </div>
        </div>
      </div>
      <div v-if="error" class="inline-error" role="alert">
        <div>
          <strong>{{ error.status === 429 ? '请求较多，请稍后重试' : error.message }}</strong>
          <div v-if="error.traceId">
            <span class="kb-text kb-text--md kb-text--secondary">
              Trace ID：{{ error.traceId }}
            </span>
          </div>
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
    <div class="composer-caption">
      <small class="kb-text kb-text--xs kb-text--secondary">
        问题与回答不会保存到浏览器持久化存储。
      </small>
    </div>
    <SourceDrawer v-model="isSourceOpen" :source="selectedSource" />
  </section>
</template>

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

<style scoped>
.kb-page-header {
  padding-bottom: 0;
}
.conversation {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.conversation.is-empty {
  display: grid;
  place-items: center;
}
.welcome-state {
  max-width: 700px;
  text-align: center;
}
.welcome-mark {
  width: 50px;
  height: 50px;
  margin: 0 auto var(--kb-space-4);
  border-radius: var(--kb-radius-lg);
  font-size: 22px;
}
.welcome-state__title {
  margin-bottom: var(--kb-space-2);
  font-size: 27px;
  font-weight: 400;
}
.user-message {
  display: flex;
  flex-direction: row-reverse;
  align-items: flex-start;
  gap: var(--kb-space-2);
  max-width: 72%;
  margin-left: auto;
}
.user-message-avatar {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--kb-color-surface-subtle);
  font-size: 12px;
}
.user-message-value {
  margin: 0;
  padding: var(--kb-block-padding) var(--kb-space-4);
  border-radius: var(--kb-radius-lg) var(--kb-radius-sm) var(--kb-radius-lg) var(--kb-radius-lg);
  background: var(--kb-color-primary-soft);
}
.retrieving-state,
.inline-error {
  display: flex;
  align-items: center;
  gap: var(--kb-layout-gap);
  margin-top: var(--kb-space-6);
  padding: var(--kb-space-4);
  border-radius: var(--kb-radius-lg);
}
.retrieving-state {
  background: var(--kb-color-info-soft);
}
.pulse {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--kb-color-primary);
  box-shadow: 0 0 0 var(--kb-space-2) color-mix(in srgb, var(--kb-color-primary) 10%, transparent);
  animation: pulse 1.4s infinite;
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--kb-color-primary) 18%, transparent);
    opacity: var(--kb-opacity-muted);
  }
}
.inline-error {
  justify-content: space-between;
  border: 1px solid color-mix(in srgb, var(--kb-color-danger) 24%, var(--kb-color-border));
  color: var(--kb-color-danger);
  background: var(--kb-color-danger-soft);
}
.composer-caption {
  margin-top: -8px;
  line-height: 1;
  text-align: center;
}
/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .welcome-state__title {
    font-size: 22px;
  }
  .user-message {
    max-width: 90%;
  }
}
</style>
