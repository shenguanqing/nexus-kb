<template>
  <main class="kb-state-page">
    <div class="kb-state-page__code">403</div>
    <div class="kb-state-page__title kb-heading" role="heading" aria-level="1">
      当前账号无权访问
    </div>
    <div class="kb-state-page__description kb-text kb-text--md kb-text--secondary">
      该页面可能需要额外权限。为保护受限信息，这里不会展示资源详情。
    </div>
    <RouterLink class="kb-state-page__action" to="/ask">
      <el-button type="primary">返回知识问答</el-button>
    </RouterLink>
  </main>
</template>
