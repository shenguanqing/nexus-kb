<template>
  <main class="kb-state-page">
    <div class="kb-state-page__code">404</div>
    <div class="kb-state-page__title kb-heading" role="heading" aria-level="1">页面不存在</div>
    <div class="kb-state-page__description kb-text kb-text--md kb-text--secondary">
      地址可能有误，或者页面已经移动。
    </div>
    <RouterLink class="kb-state-page__action" to="/ask">
      <el-button type="primary">返回首页</el-button>
    </RouterLink>
  </main>
</template>
