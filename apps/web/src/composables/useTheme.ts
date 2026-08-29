import { computed, ref, type ComputedRef } from 'vue';

type Theme = 'light' | 'dark';
type ThemeMode = Theme | 'system';

const storageKey = 'nexuskb-theme';
const preference = ref<Theme | null>(null);
const systemPrefersDark = ref(false);
let initialized = false;

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

function applyPreference(): void {
  if (typeof document === 'undefined') return;
  if (preference.value === null) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = preference.value;
}

function initializeTheme(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  let storedPreference: string | null = null;
  try {
    storedPreference = window.localStorage.getItem(storageKey);
  } catch {
    // 本地存储不可用时继续使用系统偏好。
  }
  preference.value = isTheme(storedPreference) ? storedPreference : null;
  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  systemPrefersDark.value = media?.matches ?? false;
  applyPreference();
  media?.addEventListener('change', (event) => {
    systemPrefersDark.value = event.matches;
  });
}

export function useTheme(): {
  isDark: ComputedRef<boolean>;
  themeMode: ComputedRef<ThemeMode>;
  setThemeMode: (mode: ThemeMode) => void;
} {
  initializeTheme();
  const isDark = computed(
    () => preference.value === 'dark' || (!preference.value && systemPrefersDark.value),
  );
  const themeMode = computed<ThemeMode>(() => preference.value ?? 'system');

  function setThemeMode(mode: ThemeMode): void {
    preference.value = mode === 'system' ? null : mode;
    try {
      if (preference.value === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, preference.value);
    } catch {
      // 当前会话仍可切换；刷新后回退为系统偏好。
    }
    applyPreference();
  }

  return { isDark, themeMode, setThemeMode };
}

export { initializeTheme };
