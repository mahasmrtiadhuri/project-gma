import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'gma:theme';

function readStored(): Theme {
  if (typeof window === 'undefined') return 'light';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === 'dark' ? 'dark' : 'light';
}

/**
 * Single source of truth for the light/dark theme. Persists to
 * localStorage so the choice survives reload. The flip is implemented
 * by adding `class="dark"` to <html>; every component reads
 * var(--gma-*) tokens that swap under that class, and a global 300 ms
 * transition rule in globals.css crossfades the entire UI.
 */
export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  setTheme: (next: Theme) => void;
} {
  const [theme, setThemeState] = useState<Theme>(readStored);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return {
    theme,
    toggle: () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')),
    setTheme: setThemeState,
  };
}
