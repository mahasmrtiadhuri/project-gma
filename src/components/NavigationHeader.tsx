export interface NavigationHeaderProps {
  destinationLabel: string;
  remainingDistanceM: number;
  remainingDurationS: number;
  onStop: () => void;
}

/**
 * Top-of-screen navigation bar — a single full-width row that contains
 * the destination + remaining distance/time on the left and the Stop
 * button on the right. Replaces the previous two-element layout (a
 * centered pill + a separately-floated Stop button) which was
 * overlapping the theme toggle on mobile.
 *
 * Layout: left column truncates if the destination label is long, so
 * the Stop button on the right never collides with the text.
 */
export function NavigationHeader({
  destinationLabel,
  remainingDistanceM,
  remainingDurationS,
  onStop,
}: NavigationHeaderProps) {
  const km = formatKm(remainingDistanceM);
  const min = Math.max(1, Math.round(remainingDurationS / 60));

  return (
    <div
      className="gma-card pointer-events-auto absolute left-4 right-4 top-[calc(env(safe-area-inset-top,0px)+1rem)] z-40 flex h-14 items-center gap-3 rounded-2xl px-4 sm:left-1/2 sm:right-auto sm:w-[min(520px,calc(100vw-2rem))] sm:-translate-x-1/2"
      style={{ boxShadow: 'var(--gma-shadow-lg)' }}
      role="status"
      aria-live="polite"
    >
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm font-medium text-[var(--gma-text-primary)]"
          title={destinationLabel}
        >
          {destinationLabel}
        </div>
        <div
          className="mt-0.5 flex items-center gap-2 text-xs text-[var(--gma-text-secondary)]"
          style={{ fontFamily: 'var(--font-data)' }}
        >
          <span>{km}</span>
          <span className="text-[var(--gma-text-muted)]">·</span>
          <span>{min} min</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onStop}
        className="gma-press flex h-10 shrink-0 items-center justify-center rounded-full px-4 text-sm font-medium"
        style={{
          background: 'rgb(220, 38, 38)',
          color: 'var(--gma-text-on-accent)',
          minWidth: '64px',
        }}
        aria-label="Stop navigation"
      >
        Stop
      </button>
    </div>
  );
}

function formatKm(meters: number): string {
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
