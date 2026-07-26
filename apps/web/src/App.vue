<template>
  <!-- Keep Select/Date poppers above explicit Drawer/Dialog layers (which start at 4000). -->
  <el-config-provider :z-index="5000">
    <RouterView />
  </el-config-provider>
</template>
