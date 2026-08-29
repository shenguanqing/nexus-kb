import { beforeEach, describe, expect, it, vi } from 'vitest';

function setSystemPreference(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
    }),
  });
}

describe('useTheme', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('uses the saved manual preference before the system preference', async () => {
    window.localStorage.setItem('nexuskb-theme', 'light');
    setSystemPreference(true);
    const { useTheme } = await import('./useTheme');

    const { isDark } = useTheme();

    expect(isDark.value).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('restores the system preference after a manual selection', async () => {
    setSystemPreference(true);
    const { useTheme } = await import('./useTheme');
    const { isDark, setThemeMode, themeMode } = useTheme();

    expect(isDark.value).toBe(true);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    setThemeMode('light');

    expect(isDark.value).toBe(false);
    expect(window.localStorage.getItem('nexuskb-theme')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    setThemeMode('system');

    expect(themeMode.value).toBe('system');
    expect(isDark.value).toBe(true);
    expect(window.localStorage.getItem('nexuskb-theme')).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
