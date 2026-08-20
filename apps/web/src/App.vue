<template>
  <!-- Keep Select/Date poppers above explicit Drawer/Dialog layers (which start at 4000). -->
  <el-config-provider :locale="zhCn" :z-index="5000">
    <RouterView />
  </el-config-provider>
</template>

<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn';
</script>
