<template>
  <section class="page">
    <article v-if="isMobile && selected" class="history-detail history-detail--mobile kb-block">
      <header class="mobile-detail-header">
        <div class="mobile-detail-title" :title="selected.title">{{ selected.title }}</div>
      </header>
      <div class="history-detail-body">
        <div v-for="turn in selected.turns" :key="turn.id" class="history-turn">
          <div class="history-question"><strong>用户</strong>{{ turn.question }}</div>
          <HistoryAnswer :turn="turn" @select-source="openSource" />
        </div>
      </div>
    </article>
    <template v-else>
      <form
        v-if="!isMobile"
        class="history-toolbar"
        aria-label="历史记录筛选"
        @submit.prevent="search"
      >
        <el-input v-model="query" clearable maxlength="200" placeholder="搜索会话标题" />
        <div class="filter-actions">
          <el-button native-type="submit">筛选</el-button>
          <el-button native-type="button" @click="resetFilters"> 重置 </el-button>
        </div>
      </form>
      <form
        v-else
        class="history-toolbar history-toolbar--mobile"
        aria-label="搜索历史记录"
        @submit.prevent="search"
      >
        <el-input v-model="query" clearable maxlength="200" placeholder="搜索会话标题" />
        <div class="filter-actions">
          <el-button native-type="button" @click="resetFilters"> 重置 </el-button>
        </div>
      </form>
      <div v-if="errorMessage" class="kb-error-state" role="alert">
        <strong class="kb-text--danger">无法加载历史</strong><span>{{ errorMessage }}</span>
        <el-button @click="reload">重试</el-button>
      </div>
      <div v-else class="history-layout kb-split-layout" v-loading="loading">
        <section class="history-list-panel kb-block kb-block--flush">
          <div class="history-list-card">
            <div class="history-list" role="list" aria-label="问答会话列表">
              <div class="history-list-scroll" @scroll.passive="handleListScroll">
                <div
                  v-for="row in conversations"
                  :key="row.id"
                  class="history-list-row"
                  :class="{ 'is-active': selected?.id === row.id }"
                  role="listitem"
                >
                  <button
                    type="button"
                    class="history-list-item"
                    :aria-pressed="selected?.id === row.id"
                    @click="openFromList(row.id)"
                  >
                    <strong class="history-item-title">{{ row.title }}</strong>
                    <span class="history-item-subtitle">
                      {{ row.messageCount }} 条消息 · {{ formatUpdatedAt(row.updatedAt) }}
                    </span>
                  </button>
                  <el-button
                    class="history-delete"
                    :icon="Delete"
                    text
                    circle
                    :aria-label="`删除会话：${row.title}`"
                    @click.stop="remove(row)"
                  >
                  </el-button>
                </div>
                <el-empty
                  v-if="!loading && conversations.length === 0"
                  class="history-list-empty kb-empty-state"
                  description="暂无个人问答历史"
                />
                <div
                  v-else-if="loadingMore || loadMoreError || !hasMore"
                  class="history-load-state"
                  aria-live="polite"
                >
                  <span v-if="loadingMore">正在加载更多…</span>
                  <template v-else-if="loadMoreError">
                    <span>{{ loadMoreError }}</span>
                    <el-button text @click="loadMore">重试</el-button>
                  </template>
                  <span v-else-if="conversations.length > 0">已加载全部</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <article v-if="!isMobile" class="history-detail kb-block">
          <template v-if="selected">
            <div class="history-detail-body">
              <div v-for="turn in selected.turns" :key="turn.id" class="history-turn">
                <div class="history-question"><strong>用户</strong>{{ turn.question }}</div>
                <HistoryAnswer :turn="turn" @select-source="openSource" />
              </div>
            </div>
          </template>
          <el-empty v-else class="history-detail-empty" description="选择一个会话查看内容" />
        </article>
      </div>
    </template>
    <SourceDrawer v-model="isSourceOpen" :source="selectedSource" :return-to="sourceReturnTo" />
  </section>
</template>

<script setup lang="ts">
import type { ConversationDetail, ConversationSummary, KnowledgeSource } from '@nexus-kb/contracts';
import { Delete } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { deleteConversation, fetchConversation, listConversations } from '@/api/history';
import { ApiError } from '@/api/client';
import HistoryAnswer from '@/components/knowledge/HistoryAnswer.vue';
import SourceDrawer from '@/components/knowledge/SourceDrawer.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { buildHistoryRouteQuery, readHistoryRouteState } from './history-route-state';

const route = useRoute();
const router = useRouter();
const initialRouteState = readHistoryRouteState(route.query);
const conversations = ref<ConversationSummary[]>([]);
const { isMobile } = useBreakpoint();
const selected = ref<ConversationDetail | null>(null);
const query = ref(initialRouteState.query);
const total = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const reachedEnd = ref(false);
const errorMessage = ref('');
const loadMoreError = ref('');
const selectedSource = ref<KnowledgeSource | null>(null);
const isSourceOpen = ref(false);
const sourceReturnTo = computed(() => route.fullPath);
const hasMore = computed(() => !reachedEnd.value && conversations.value.length < total.value);
const PAGE_SIZE = 20;
const LOAD_MORE_THRESHOLD = 96;
let loadVersion = 0;

function openSource(source: KnowledgeSource): void {
  selectedSource.value = source;
  isSourceOpen.value = true;
}

async function load(append = false): Promise<void> {
  if (append && (loading.value || loadingMore.value || !hasMore.value)) return;
  if (!append) {
    loadVersion += 1;
    loading.value = true;
    loadingMore.value = false;
    errorMessage.value = '';
    loadMoreError.value = '';
    reachedEnd.value = false;
  } else {
    loadingMore.value = true;
    loadMoreError.value = '';
  }
  const currentVersion = loadVersion;
  const offset = append ? conversations.value.length : 0;
  try {
    const result = await listConversations({
      query: query.value.trim() || undefined,
      offset,
      limit: PAGE_SIZE,
    });
    if (currentVersion !== loadVersion) return;
    if (append) {
      const previousLength = conversations.value.length;
      const existingIds = new Set(conversations.value.map((conversation) => conversation.id));
      conversations.value = [
        ...conversations.value,
        ...result.conversations.filter((conversation) => !existingIds.has(conversation.id)),
      ];
      if (conversations.value.length === previousLength) reachedEnd.value = true;
    } else {
      conversations.value = result.conversations;
    }
    total.value = result.total;
    reachedEnd.value =
      reachedEnd.value ||
      result.conversations.length < PAGE_SIZE ||
      conversations.value.length >= result.total;
  } catch (error) {
    if (currentVersion !== loadVersion) return;
    const message = error instanceof ApiError ? error.message : '历史记录加载失败';
    if (append) loadMoreError.value = message;
    else errorMessage.value = message;
  } finally {
    if (append) loadingMore.value = false;
    else if (currentVersion === loadVersion) loading.value = false;
  }
}
async function syncRoute(conversationId: string | null): Promise<void> {
  await router.replace({
    query: buildHistoryRouteQuery({
      query: query.value,
      conversationId,
    }),
  });
}

async function open(id: string, updateRoute = true): Promise<void> {
  try {
    selected.value = await fetchConversation(id);
    if (updateRoute) await syncRoute(id);
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '会话加载失败');
    if (!updateRoute) await syncRoute(null);
  }
}
async function remove(row: ConversationSummary): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除“${row.title}”及其全部问答？`, '删除会话', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    });
  } catch {
    return;
  }
  try {
    await deleteConversation(row.id);
    const removedSelectedConversation = selected.value?.id === row.id;
    if (removedSelectedConversation) {
      selected.value = null;
      selectedSource.value = null;
      isSourceOpen.value = false;
    }
    const loadPromise = load();
    if (removedSelectedConversation) await syncRoute(null);
    await loadPromise;
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '会话删除失败');
  }
}
onMounted(async () => {
  await load();
  if (initialRouteState.conversationId) {
    await open(initialRouteState.conversationId, false);
  }
  if (
    route.query.page !== undefined ||
    route.query.from !== undefined ||
    route.query.to !== undefined ||
    (route.query.conversationId !== undefined && !initialRouteState.conversationId)
  ) {
    await syncRoute(selected.value?.id ?? null);
  }
});
async function search(): Promise<void> {
  clearSelectedConversation();
  const loadPromise = load();
  await syncRoute(null);
  await loadPromise;
}
async function resetFilters(): Promise<void> {
  query.value = '';
  await search();
}

function clearSelectedConversation(): void {
  selected.value = null;
  selectedSource.value = null;
  isSourceOpen.value = false;
}

watch(
  () => readHistoryRouteState(route.query).conversationId,
  async (conversationId) => {
    if (!conversationId) {
      clearSelectedConversation();
      return;
    }
    if (selected.value?.id !== conversationId) await open(conversationId, false);
  },
);

function formatUpdatedAt(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

async function openFromList(id: string): Promise<void> {
  await open(id);
}

function loadMore(): void {
  void load(true);
}

function reload(): void {
  void load();
}

function handleListScroll(event: Event): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
  if (distanceToBottom <= LOAD_MORE_THRESHOLD) loadMore();
}
</script>

<style scoped>
/*
 * 布局：筛选栏（Toolbar / Filter Bar） + 会话列表 + 会话详情。
 * 移动端选中会话后整页切换为详情视图（history-detail--mobile）。
 */
.history-toolbar {
  display: grid;
  align-items: center;
  gap: var(--kb-space-2);
  grid-template-columns: minmax(0, 1fr) auto;
}
/* 列表 + 详情两栏布局 */
.history-list-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}
.history-list-card {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.history-list {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.history-list-scroll {
  flex: 1 1 auto;
  align-content: start;
  overflow: auto;
  overscroll-behavior: contain;
  min-height: 0;
  padding: var(--kb-list-row-padding);
  scrollbar-gutter: stable;
}
.history-load-state {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--kb-space-2);
  min-height: 44px;
  color: var(--kb-color-text-tertiary);
  font-size: 12px;
}

/* 会话行：标题/摘要 + 常驻删除按钮，不再依赖滑动手势 */
.history-list-row {
  display: flex;
  align-items: stretch;
  gap: var(--kb-space-1);
  min-width: 0;
}
.history-list-row + .history-list-row {
  margin-top: var(--kb-space-1);
}
.history-list-row.is-active {
  border-radius: var(--kb-radius-md);
  background: var(--kb-color-primary-soft);
}
.history-list-item {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  padding: var(--kb-list-row-padding);
  border-radius: var(--kb-radius-md);
  color: inherit;
  background: transparent;
  text-align: left;
  transition: background-color var(--kb-transition-fast);
  cursor: pointer;
}
.history-list-item:hover {
  background: var(--kb-color-canvas);
}
.history-list-row.is-active .history-list-item:hover {
  background: transparent;
}
.history-list-item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--kb-color-primary);
}
.history-item-title,
.history-item-subtitle {
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-item-subtitle {
  color: var(--kb-color-text-secondary);
  font-size: 12px;
}

/*
 * 删除按钮显示策略按输入方式区分，而不是按断点区分：
 * - 支持真实 hover 的设备（PC 鼠标）：默认完全隐藏，鼠标悬浮该行或键盘聚焦该行时才
 *   显示为红色，符合桌面端“悬浮 / 选中才出现”的操作习惯。
 * - 不支持 hover 的设备（Pad / Mobile 触屏）：常驻显示，但默认弱化为不起眼的灰色小图标，
 *   按下时才变红加深，避免整屏都是醒目的红色删除按钮。
 */
.history-delete {
  flex: 0 0 auto;
  align-self: center;
  width: var(--kb-space-8);
  height: var(--kb-space-8);
  margin-right: var(--kb-space-1);
  border-radius: var(--kb-radius-sm);
  color: var(--kb-color-text-tertiary);
  background: transparent;
  font-size: 15px;
  opacity: var(--kb-opacity-muted);
  transition:
    color var(--kb-transition-fast),
    background-color var(--kb-transition-fast),
    opacity var(--kb-transition-fast);
}
.history-delete:hover,
.history-delete:focus-visible,
.history-delete:active {
  color: var(--kb-color-danger);
  background: var(--kb-color-danger-soft);
  opacity: var(--kb-opacity-visible);
}
/* 详情区（桌面右侧栏 / 移动端整页） */
.history-detail {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  padding: 0;
}
.history-detail-empty {
  flex: 1 1 auto;
  min-height: 0;
}
.history-detail-body {
  flex: 1 1 auto;
  overflow: auto;
  min-height: 0;
  padding: var(--kb-block-padding);
}
.history-turn {
  display: flex;
  flex-direction: column;
  gap: var(--kb-layout-gap);
  padding: var(--kb-space-2) 0;
}
.history-turn + .history-turn {
  border-top: 1px solid var(--kb-color-border);
}
.history-question,
.history-answer {
  display: grid;
  gap: var(--kb-layout-gap);
  grid-template-columns: 50px minmax(0, 1fr);
}

/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .history-toolbar--mobile {
    display: grid;
    align-items: center;
    gap: var(--kb-space-2);
    grid-template-columns: minmax(0, 1fr) auto;
    border-radius: var(--kb-radius-lg);
  }
  .history-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .history-delete {
    width: var(--kb-space-10);
    height: var(--kb-space-10);
    font-size: 17px;
  }
  .history-detail--mobile {
    height: 100%;
  }
  .mobile-detail-header {
    display: flex;
    flex: 0 0 auto;
    justify-content: center;
    align-items: center;
    min-height: 48px;
    padding: 0 var(--kb-list-row-padding);
    border-bottom: 1px solid var(--kb-color-border);
  }
  .mobile-detail-title {
    overflow: hidden;
    min-width: 0;
    font-size: 15px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* 交互能力：仅在精确指针设备悬停时隐藏会话删除入口。 */
@media (hover: hover) and (pointer: fine) {
  .history-delete {
    opacity: var(--kb-opacity-hidden);
  }
  .history-list-row:hover .history-delete,
  .history-list-row:focus-within .history-delete,
  .history-delete:focus-visible {
    color: var(--kb-color-danger);
    opacity: var(--kb-opacity-visible);
  }
}
</style>
