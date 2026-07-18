<script setup lang="ts">
import { useRoute } from 'vue-router';
const route = useRoute();
</script>
<template>
  <section class="coming-soon">
    <span>阶段 15 · 后续切片</span>
    <h2>{{ route.meta.title }}</h2>
    <p>
      基础导航和权限边界已就绪。该模块将在对应正式 API 契约补齐后实现，不使用假数据代替服务端结果。
    </p>
  </section>
</template>
