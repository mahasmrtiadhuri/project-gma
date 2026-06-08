import { useEffect, useState } from 'react';

/**
 * Returns true if the URL query string contains `demo=true`. Listens
 * for `popstate` so a manual back/forward across `?demo=true` flips
 * the value reactively (useful if the user pastes a link with the
 * flag mid-session).
 *
 * Used by App.tsx to:
 *   - render the floating START DEMO button at the bottom of the
 *     viewport, and
 *   - render the subtle "DEMO MODE" watermark top-left.
 */
export function useDemoMode(): boolean {
  const [isDemoMode, setIsDemoMode] = useState(() => readFromUrl());

  useEffect(() => {
    const handler = () => setIsDemoMode(readFromUrl());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  return isDemoMode;
}

function readFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.search.includes('demo=true');
}
