<template>
  <component
    :is="mobile ? ElDrawer : ElDialog"
    :model-value="modelValue"
    class="documents-danger-confirm"
    :title="copy.title"
    :width="mobile ? undefined : 'min(520px, calc(100vw - 28px))'"
    align-center
    :size="mobile ? 'auto' : undefined"
    :direction="mobile ? 'btt' : undefined"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
    @closed="confirmationName = ''"
  >
    <div class="documents-danger-confirm__body">
      <div
        class="documents-danger-confirm__notice kb-text"
        :class="{ 'kb-text--danger': action === 'delete' || action === 'cleanup' }"
      >
        {{ copy.notice }}
      </div>
      <div class="documents-danger-confirm__instruction kb-text kb-text--md kb-text--secondary">
        请输入完整文档名以确认
      </div>
      <div class="documents-danger-confirm__filename kb-text kb-text--strong">
        {{ documentName }}
      </div>
      <el-input
        v-model="confirmationName"
        :aria-label="`输入完整文档名确认：${documentName}`"
        autocomplete="off"
      />
    </div>
    <template #footer>
      <el-button :disabled="loading" @click="emit('update:modelValue', false)">取消</el-button>
      <el-button
        :type="action === 'delete' || action === 'cleanup' ? 'danger' : 'primary'"
        :disabled="confirmationName !== documentName"
        :loading="loading"
        @click="confirm"
      >
        {{ copy.confirmButtonText }}
      </el-button>
    </template>
  </component>
</template>

<script setup lang="ts">
import { ElDialog, ElDrawer } from 'element-plus';
import { computed, ref, watch } from 'vue';

type DocumentDangerAction = 'cleanup' | 'delete' | 'reindex';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    documentName: string;
    action: DocumentDangerAction;
    prepared?: boolean;
    loading?: boolean;
    mobile?: boolean;
  }>(),
  {
    prepared: false,
    loading: false,
    mobile: false,
  },
);
const emit = defineEmits<{
  'update:modelValue': [visible: boolean];
  confirm: [];
}>();
const confirmationName = ref('');

const copy = computed(() => {
  if (props.action === 'cleanup') {
    return {
      title: '继续清理删除',
      notice:
        '该文档已进入删除流程，但清理尚未完成。继续后将永久清理残留的原文件、预览、向量和缓存，且无法撤销。',
      confirmButtonText: '继续清理',
    };
  }
  if (props.action === 'delete') {
    return {
      title: '确认高风险操作',
      notice: '删除将永久移除原文件、全部版本向量和可识别缓存，且无法撤销。',
      confirmButtonText: '永久删除',
    };
  }
  return {
    title: '确认高风险操作',
    notice: props.prepared
      ? '将复用已保存的解析、分块和脱敏结果，仅执行 Embedding 和向量入库，不会再次上传或解析原文件。'
      : '将创建新的索引版本；旧版本会持续服务，直至新版本通过验证并原子激活。',
    confirmButtonText: props.prepared ? '继续建立索引' : '开始重建',
  };
});

watch(
  () => [props.modelValue, props.documentName, props.action],
  () => {
    confirmationName.value = '';
  },
);

function confirm(): void {
  if (confirmationName.value === props.documentName) emit('confirm');
}
</script>

<style scoped>
.documents-danger-confirm__body {
  display: grid;
  gap: var(--kb-layout-gap);
}

.documents-danger-confirm__notice {
  padding: var(--kb-list-row-padding);
  border: 1px solid var(--kb-color-border-light);
  border-radius: var(--kb-radius-md);
  background: var(--kb-color-canvas);
}

.documents-danger-confirm__notice.kb-text--danger {
  border-color: color-mix(in srgb, var(--kb-color-danger) 28%, var(--kb-color-border));
  background: var(--kb-color-danger-soft);
}

.documents-danger-confirm__instruction {
  margin-top: var(--kb-space-1);
}

.documents-danger-confirm__filename {
  overflow-wrap: anywhere;
}
</style>
