import type { AuthSession, Capability } from '@nexus-kb/contracts';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { ApiError } from '@/api/client';
import { fetchSession } from '@/api/auth';

export const useAuthStore = defineStore('auth', () => {
  const session = ref<AuthSession | null>(null);
  const isLoading = ref(false);
  const isLoaded = ref(false);

  const isAuthenticated = computed(() => session.value !== null);
  const identity = computed(() => session.value?.identity ?? null);
  const hasCapability = (capability: Capability): boolean =>
    session.value?.identity.capabilities.includes(capability) ?? false;

  async function loadSession(): Promise<void> {
    if (isLoading.value) return;
    isLoading.value = true;
    try {
      session.value = await fetchSession();
    } catch (error) {
      session.value = null;
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    } finally {
      isLoaded.value = true;
      isLoading.value = false;
    }
  }

  function clear(): void {
    session.value = null;
    isLoaded.value = true;
  }

  return {
    session,
    identity,
    isLoading,
    isLoaded,
    isAuthenticated,
    hasCapability,
    loadSession,
    clear,
  };
});
