<template>
  <section class="kb-page">
    <div class="kb-page__content">
      <div class="coming-soon kb-block">
        <span class="kb-text kb-text--sm kb-text--secondary">阶段 15 · 后续切片 </span>
        <div class="kb-heading kb-heading--h1" role="heading" aria-level="1">
          {{ route.meta.title }}
        </div>
        <div class="kb-text">
          基础导航和权限边界已就绪。该模块将在对应正式 API
          契约补齐后实现，不使用假数据代替服务端结果。
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<style scoped>
.coming-soon {
  display: grid;
  align-content: start;
  gap: var(--kb-layout-gap);
}
</style>
