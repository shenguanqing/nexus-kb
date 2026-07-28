<script setup lang="ts">
import type { ConversationDetail, ConversationSummary } from '@nexus-kb/contracts';
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, ref } from 'vue';
import { deleteConversation, fetchConversation, listConversations } from '@/api/history';
import { ApiError } from '@/api/client';
import HistoryAnswer from '@/components/knowledge/HistoryAnswer.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';

const conversations = ref<ConversationSummary[]>([]);
const { isMobile } = useBreakpoint();
const selected = ref<ConversationDetail | null>(null);
const query = ref('');
const startAt = ref<Date | null>(null);
const endAt = ref<Date | null>(null);
const page = ref(1);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const filtersVisible = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await listConversations({
      query: query.value.trim() || undefined,
      from: startAt.value?.toISOString(),
      to: endAt.value?.toISOString(),
      offset: (page.value - 1) * 20,
      limit: 20,
    });
    conversations.value = result.conversations;
    total.value = result.total;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '历史记录加载失败';
  } finally {
    loading.value = false;
  }
}
async function open(id: string): Promise<void> {
  try {
    selected.value = await fetchConversation(id);
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '会话加载失败');
  }
}
async function remove(row: ConversationSummary): Promise<void> {
  await ElMessageBox.confirm(`确认删除“${row.title}”及其全部问答？`, '删除会话', {
    type: 'warning',
  });
  await deleteConversation(row.id);
  if (selected.value?.id === row.id) selected.value = null;
  await load();
}
onMounted(load);
async function search(): Promise<void> {
  page.value = 1;
  await load();
  filtersVisible.value = false;
}
async function resetFilters(): Promise<void> {
  query.value = '';
  startAt.value = null;
  endAt.value = null;
  await search();
}

async function changePage(nextPage: number): Promise<void> {
  page.value = nextPage;
  await load();
}
</script>

<template>
  <section class="history-page">
    <form
      v-if="!isMobile"
      class="history-toolbar"
      aria-label="历史记录筛选"
      @submit.prevent="search"
    >
      <el-input v-model="query" clearable maxlength="200" placeholder="搜索会话标题" />
      <el-date-picker v-model="startAt" type="datetime" placeholder="开始时间" />
      <el-date-picker v-model="endAt" type="datetime" placeholder="结束时间" />
      <el-button native-type="submit">筛选</el-button>
    </form>
    <div v-else class="history-toolbar">
      <div class="mobile-filter-bar">
        <el-button class="filter-trigger" @click="filtersVisible = true">筛选</el-button>
      </div>
      <el-drawer
        v-model="filtersVisible"
        class="mobile-filter-drawer"
        direction="btt"
        size="72%"
        title="筛选问答历史"
        append-to-body
        :z-index="4000"
      >
        <form class="mobile-filter-form" aria-label="历史记录筛选" @submit.prevent="search">
          <el-input v-model="query" clearable maxlength="200" placeholder="搜索会话标题" />
          <el-date-picker
            v-model="startAt"
            type="datetime"
            :placement="isMobile ? 'top-start' : 'bottom-start'"
            popper-class="mobile-date-picker-popper"
            placeholder="开始时间"
          />
          <el-date-picker
            v-model="endAt"
            type="datetime"
            :placement="isMobile ? 'top-start' : 'bottom-start'"
            popper-class="mobile-date-picker-popper"
            placeholder="结束时间"
          />
          <div class="mobile-filter-actions">
            <el-button native-type="button" @click="resetFilters">重置</el-button>
            <el-button type="primary" native-type="submit">筛选</el-button>
          </div>
        </form>
      </el-drawer>
    </div>
    <div v-if="errorMessage" class="document-error" role="alert">
      <strong>无法加载历史</strong><span>{{ errorMessage }}</span>
      <el-button @click="load">重试</el-button>
    </div>
    <div v-else class="history-layout" v-loading="loading">
      <section class="history-list-panel">
        <div class="heading heading--h2 scroll-section-title" role="heading" aria-level="2">
          会话列表
        </div>
        <div class="history-list" role="list" aria-label="问答会话列表">
          <div class="history-list-scroll">
            <div
              v-for="row in conversations"
              :key="row.id"
              class="history-list-row"
              :class="{ active: selected?.id === row.id }"
              role="listitem"
            >
              <div
                class="history-list-item"
                :class="{ active: selected?.id === row.id }"
                role="button"
                tabindex="0"
                :aria-pressed="selected?.id === row.id"
                @click="open(row.id)"
                @keydown.enter="open(row.id)"
                @keydown.space.prevent="open(row.id)"
              >
                <strong>{{ row.title }}</strong>
                <span>
                  {{ row.messageCount }} 条消息 · {{ new Date(row.updatedAt).toLocaleString() }}
                </span>
              </div>
              <el-button
                class="history-delete"
                text
                type="danger"
                :aria-label="`删除会话：${row.title}`"
                @click="remove(row)"
              >
                删除
              </el-button>
            </div>
            <el-empty
              v-if="!loading && conversations.length === 0"
              description="暂无个人问答历史"
            />
          </div>
          <el-pagination
            v-if="conversations.length > 0 && total > 20"
            class="list-pagination history-pagination"
            layout="total, prev, pager, next"
            :current-page="page"
            :page-size="20"
            :total="total"
            @current-change="changePage"
          />
        </div>
      </section>
      <article class="history-detail">
        <template v-if="selected">
          <div class="heading heading--h2" role="heading" aria-level="2">{{ selected.title }}</div>
          <div class="history-detail-body">
            <div v-for="turn in selected.turns" :key="turn.id" class="history-turn">
              <div class="history-question text-block"><strong>你</strong>{{ turn.question }}</div>
              <HistoryAnswer :turn="turn" />
            </div>
          </div>
        </template>
        <el-empty v-else description="选择一个会话查看内容" />
      </article>
    </div>
  </section>
</template>
