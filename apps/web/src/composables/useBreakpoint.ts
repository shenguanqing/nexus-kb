import { useMediaQuery } from '@vueuse/core';

/*
 * Web 应用运行时断点的唯一数据源。
 * Vue 模板中的结构分支应基于这些响应式引用，而不是通过 CSS 隐藏 DOM。
 */
export function useBreakpoint() {
  const isDesktop = useMediaQuery('(min-width: 1280px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1279px)');
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isCompact = useMediaQuery('(max-width: 1279px)');

  return { isDesktop, isTablet, isMobile, isCompact };
}
