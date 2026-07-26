import { useMediaQuery } from '@vueuse/core';

/**
 * The sole runtime breakpoint source for the web application.
 * Keep structural branches in Vue templates tied to these refs rather than CSS-hidden DOM.
 */
export function useBreakpoint() {
  const isDesktop = useMediaQuery('(min-width: 1280px)');
  const isTablet = useMediaQuery('(min-width: 901px) and (max-width: 1279px)');
  const isMobile = useMediaQuery('(max-width: 900px)');
  const isPhone = useMediaQuery('(max-width: 767px)');

  return { isDesktop, isTablet, isMobile, isPhone };
}
