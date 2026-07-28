<script setup lang="ts">
import { useRoute } from 'vue-router';
const route = useRoute();
</script>
<template>
  <section class="coming-soon">
    <span>阶段 15 · 后续切片</span>
    <div class="heading heading--h2" role="heading" aria-level="2">{{ route.meta.title }}</div>
    <div class="text-block">
      基础导航和权限边界已就绪。该模块将在对应正式 API 契约补齐后实现，不使用假数据代替服务端结果。
    </div>
  </section>
</template>
