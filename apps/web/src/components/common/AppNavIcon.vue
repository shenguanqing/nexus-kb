<template>
  <svg
    class="nav-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    aria-hidden="true"
  >
    <template v-if="name === 'ask'">
      <path
        d="M20 11.5c0 4.1-3.6 7.5-8 7.5-1.3 0-2.5-.3-3.6-.8L4 19.5l1.3-3.6C4.5 14.6 4 13.1 4 11.5 4 7.4 7.6 4 12 4s8 3.4 8 7.5Z"
      />
    </template>
    <template v-else-if="name === 'history'">
      <path d="M4 5v5h5" />
      <path d="M4.8 10A8 8 0 1 1 4 13.5" />
      <path d="M12 8v4l2.8 1.8" />
    </template>
    <template v-else-if="name === 'documents'">
      <path
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2.5h6.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-10Z"
      />
    </template>
    <template v-else-if="name === 'ingestion'">
      <path d="M12 3v12" />
      <path d="m7.5 7.5 4.5-4.5 4.5 4.5" />
      <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </template>
    <template v-else-if="name === 'audit'">
      <path d="M12 3 20 6v5c0 4.7-3.1 8.5-8 10-4.9-1.5-8-5.3-8-10V6l8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </template>
    <template v-else-if="name === 'users'">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M3.5 20c.5-3.4 2.5-5.2 5.5-5.2s5 1.8 5.5 5.2" />
      <path d="M15 15.3c2.7 0 4.5 1.5 5 4.4" />
    </template>
    <template v-else-if="name === 'departments'">
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8.5 7h1M14.5 7h1M8.5 11h1M14.5 11h1M8.5 15h1M14.5 15h1M3 21h18" />
    </template>
    <template v-else-if="name === 'provider'">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4" />
      <path d="M10 10h4v4h-4z" />
    </template>
    <template v-else-if="name === 'usage'">
      <path d="M4 20V11h4v9M10 20V5h4v15M16 20v-7h4v7M3 20h18" />
    </template>
    <template v-else-if="name === 'status'">
      <path d="M3 13h4l2.2-6 4 12 2.2-6H21" />
    </template>
    <template v-else>
      <circle cx="5" cy="5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="19" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="19" r="1.2" fill="currentColor" stroke="none" />
    </template>
  </svg>
</template>

<script setup lang="ts">
export type NavIconName =
  | 'ask'
  | 'history'
  | 'documents'
  | 'ingestion'
  | 'audit'
  | 'users'
  | 'departments'
  | 'provider'
  | 'usage'
  | 'status'
  | 'more';

defineProps<{ name: NavIconName }>();
</script>

<style scoped>
.nav-icon {
  display: block;
  width: 1em;
  height: 1em;
}
</style>
