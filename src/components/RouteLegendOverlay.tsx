import { useEffect, useState } from 'react';

export interface RouteLegendOverlayProps {
  /**
   * True for the first 4 seconds after a route first appears. App.tsx
   * tracks "have we shown the legend for the current route yet" via
   * a ref and flips this on for one window.
   */
  autoShow: boolean;
  /** True when the user tapped the persistent "?" button. */
  manualShow: boolean;
  onDismiss: () => void;
}

const ENTRIES: ReadonlyArray<{
  emoji: string;
  label: string;
  swatch: string;
}> = [
  { emoji: '☀️', label: 'Direct sun', swatch: 'rgb(245, 158, 11)' },
  { emoji: '🏢', label: 'Building shade', swatch: 'rgb(59, 130, 246)' },
  { emoji: '🌳', label: 'Tree canopy', swatch: 'rgb(16, 185, 129)' },
  { emoji: '🔆', label: 'Glass glare', swatch: 'rgb(220, 38, 38)' },
];

/**
 * Briefly-visible legend explaining the route's segment colors.
 *
 * Two trigger paths share the same display:
 *   - `autoShow`: fires for 4 s the first time a route appears so the
 *     user sees what each color means before they have a chance to
 *     start hunting for it.
 *   - `manualShow`: stays visible until the user dismisses it,
 *     triggered by the persistent "?" button at bottom-left.
 */
export function RouteLegendOverlay({
  autoShow,
  manualShow,
  onDismiss,
}: RouteLegendOverlayProps) {
  const visible = autoShow || manualShow;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    // Wait for the exit transition to finish before unmounting.
    const t = window.setTimeout(() => setMounted(false), 250);
    return () => window.clearTimeout(t);
  }, [visible]);

  if (!mounted) return null;

  return (
    <>
      {manualShow && (
        // Backdrop only when the user manually opened the legend —
        // autoShow lets the user keep interacting with the map.
        <button
          type="button"
          aria-label="Close legend"
          onClick={onDismiss}
          className="pointer-events-auto fixed inset-0 cursor-default bg-transparent"
          style={{ zIndex: 369 }}
        />
      )}
      <div
        className="pointer-events-auto fixed left-1/2"
        style={{
          zIndex: 370,
          top: '12%',
          transform: visible
            ? 'translate(-50%, 0)'
            : 'translate(-50%, -12px)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 250ms ease, transform 250ms ease',
        }}
        role="dialog"
        aria-label="Route color legend"
      >
        <div
          className="rounded-2xl px-5 py-3"
          style={{
            background: '#ffffff',
            color: 'rgb(30, 41, 59)',
            boxShadow:
              '0 14px 36px rgba(15, 23, 42, 0.18), 0 4px 12px rgba(15, 23, 42, 0.08)',
            border: '1px solid rgba(15, 23, 42, 0.06)',
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          <div
            className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{
              color: 'rgb(71, 85, 105)',
              fontFamily: 'var(--font-data)',
            }}
          >
            Route colors
          </div>
          <ul className="flex flex-wrap items-center gap-4">
            {ENTRIES.map((entry) => (
              <li
                key={entry.label}
                className="flex items-center gap-1.5 text-sm"
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: entry.swatch }}
                  aria-hidden="true"
                />
                <span>
                  {entry.emoji} {entry.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

export interface RouteLegendButtonProps {
  visible: boolean;
  onToggle: () => void;
}

/**
 * Persistent circular "?" trigger pinned at bottom-left. Always
 * available when a route is showing so the user can recall the
 * legend on demand after the auto-show has faded.
 */
export function RouteLegendButton({
  visible,
  onToggle,
}: RouteLegendButtonProps) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Show route color legend"
      className="gma-card gma-press pointer-events-auto fixed flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-[var(--gma-text-primary)]"
      style={{
        left: '16px',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12rem)',
        zIndex: 50,
      }}
    >
      ?
    </button>
  );
}
