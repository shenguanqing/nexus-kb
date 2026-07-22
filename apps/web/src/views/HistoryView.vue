<script setup lang="ts">
import type { ConversationDetail, ConversationSummary } from '@nexus-kb/contracts';
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, ref } from 'vue';
import { deleteConversation, fetchConversation, listConversations } from '@/api/history';
import { ApiError } from '@/api/client';

const conversations = ref<ConversationSummary[]>([]);
const selected = ref<ConversationDetail | null>(null);
const query = ref('');
const dateRange = ref<[Date, Date] | null>(null);
const page = ref(1);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await listConversations({
      query: query.value.trim() || undefined,
      from: dateRange.value?.[0].toISOString(),
      to: dateRange.value?.[1].toISOString(),
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
}
</script>

<template>
  <section class="history-page">
    <form class="history-toolbar" aria-label="历史记录筛选" @submit.prevent="search">
      <el-input v-model="query" clearable maxlength="200" placeholder="搜索会话标题" />
      <el-date-picker
        v-model="dateRange"
        type="datetimerange"
        start-placeholder="开始时间"
        end-placeholder="结束时间"
      />
      <el-button native-type="submit">搜索</el-button>
    </form>
    <div v-if="errorMessage" class="document-error" role="alert">
      <strong>无法加载历史</strong><span>{{ errorMessage }}</span
      ><el-button @click="load">重试</el-button>
    </div>
    <div v-else class="history-layout" v-loading="loading">
      <div class="history-list">
        <button
          v-for="row in conversations"
          :key="row.id"
          type="button"
          :class="{ active: selected?.id === row.id }"
          @click="open(row.id)"
        >
          <strong>{{ row.title }}</strong
          ><span
            >{{ row.messageCount }} 条消息 · {{ new Date(row.updatedAt).toLocaleString() }}</span
          >
          <el-button text type="danger" @click.stop="remove(row)">删除</el-button>
        </button>
        <el-empty v-if="!loading && conversations.length === 0" description="暂无个人问答历史" />
        <el-pagination
          v-if="total > 20"
          v-model:current-page="page"
          layout="prev, pager, next"
          :page-size="20"
          :total="total"
          @change="load"
        />
      </div>
      <article class="history-detail">
        <template v-if="selected">
          <h2>{{ selected.title }}</h2>
          <div v-for="turn in selected.turns" :key="turn.id" class="history-turn">
            <p class="history-question"><strong>你</strong>{{ turn.question }}</p>
            <div class="history-answer">
              <strong>知枢</strong>
              <p>{{ turn.answer }}</p>
              <small>{{ turn.sourceCount }} 个历史来源 · Trace {{ turn.traceId }}</small>
            </div>
          </div>
        </template>
        <el-empty v-else description="选择一个会话查看内容" />
      </article>
    </div>
  </section>
</template>
