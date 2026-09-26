import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';
export type ThemeOverride = ThemeMode | null;

const OVERRIDE_KEY = 'weathergpt-theme-override';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

function readOverride(): ThemeOverride {
  try {
    const v = sessionStorage.getItem(OVERRIDE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function persistOverride(override: ThemeOverride) {
  try {
    if (override) sessionStorage.setItem(OVERRIDE_KEY, override);
    else sessionStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* private mode */
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DARK_MEDIA_QUERY).matches;
}

function resolveTheme(override: ThemeOverride): ThemeMode {
  return override ?? (systemPrefersDark() ? 'dark' : 'light');
}

/**
 * Theme follows the OS setting (prefers-color-scheme) with a
 * session-persisted manual override. Re-resolves when the system
 * preference changes; the [data-theme] attribute on <html> selects the
 * matching token block in design-tokens.css.
 */
export function useTheme() {
  const [override, setOverrideState] = useState<ThemeOverride>(readOverride);
  const [theme, setTheme] = useState<ThemeMode>(() => resolveTheme(readOverride()));

  useEffect(() => {
    const apply = () => setTheme(resolveTheme(override));
    apply();
    const mq = window.matchMedia(DARK_MEDIA_QUERY);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [override]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setOverride = useCallback((next: ThemeOverride) => {
    persistOverride(next);
    setOverrideState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setOverride(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setOverride]);

  return { theme, override, setOverride, toggleTheme };
}