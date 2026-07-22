import type { KnowledgeQueryResponse } from '@nexus-kb/contracts';
import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface KnowledgeConversationTurn {
  question: string;
  response: KnowledgeQueryResponse;
}

export const useKnowledgeConversationStore = defineStore('knowledge-conversation', () => {
  const conversationId = ref<string | undefined>();
  const turns = ref<KnowledgeConversationTurn[]>([]);
  const pendingQuestion = ref<string | null>(null);
  const isSubmitting = ref(false);
  let requestSequence = 0;

  function begin(question: string): number {
    requestSequence += 1;
    pendingQuestion.value = question;
    isSubmitting.value = true;
    return requestSequence;
  }

  function complete(requestId: number, response: KnowledgeQueryResponse): boolean {
    if (requestId !== requestSequence || !pendingQuestion.value) return false;
    turns.value.push({ question: pendingQuestion.value, response });
    conversationId.value = response.conversationId;
    pendingQuestion.value = null;
    isSubmitting.value = false;
    return true;
  }

  function fail(requestId: number): boolean {
    if (requestId !== requestSequence) return false;
    isSubmitting.value = false;
    return true;
  }

  function reset(): void {
    requestSequence += 1;
    conversationId.value = undefined;
    turns.value = [];
    pendingQuestion.value = null;
    isSubmitting.value = false;
  }

  function clear(): void {
    reset();
  }

  return {
    conversationId,
    turns,
    pendingQuestion,
    isSubmitting,
    begin,
    complete,
    fail,
    reset,
    clear,
  };
});
