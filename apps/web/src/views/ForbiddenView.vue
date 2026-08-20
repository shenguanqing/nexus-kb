<template>
  <main class="state-page">
    <div class="state-page-code">403</div>
    <div class="state-page-title">当前账号无权访问</div>
    <div class="state-page-desc">
      该页面可能需要额外权限。为保护受限信息，这里不会展示资源详情。
    </div>
    <RouterLink class="state-page-action" to="/ask">
      <el-button type="primary">返回知识问答</el-button>
    </RouterLink>
  </main>
</template>
