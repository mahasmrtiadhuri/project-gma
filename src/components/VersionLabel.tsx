/**
 * Tiny build-date chip in the very bottom-right corner of the screen.
 * The date is compile-time-injected by Vite (`define` in vite.config.ts
 * → `__GMA_BUILD_DATE__`) so it changes on every deploy. A quick visual
 * check against the deploy log tells the user immediately whether the
 * service worker has actually served them the new build.
 *
 * Positioned `fixed` so it never moves with the deck.gl camera, sits
 * underneath the MapViewSwitcher at the bottom-right, and stays out of
 * the way of taps via `pointer-events-none`.
 */
export function VersionLabel() {
  return (
    <div
      className="pointer-events-none fixed select-none text-[10px] uppercase tracking-[0.18em] text-[var(--gma-text-muted)]"
      style={{
        right: '8px',
        bottom: '4px',
        zIndex: 5,
        fontFamily: 'var(--font-data)',
        opacity: 0.55,
      }}
      aria-hidden="true"
    >
      v{__GMA_BUILD_DATE__}
    </div>
  );
}
