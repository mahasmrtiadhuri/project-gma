export interface NavigationHeaderProps {
  destinationLabel: string;
  remainingDistanceM: number;
  remainingDurationS: number;
  onStop: () => void;
}

/**
 * Top-of-screen navigation pill — replaces the previous turn-by-turn
 * text panel. Shows only what matters for following the route in the
 * moment: where you're going, how far is left, how long it'll take.
 *
 * Layout: a centered pill above the map. The small Stop button sits in
 * the top-right corner as a separate sibling so it stays accessible
 * when the header text gets long.
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
    <>
      <div
        className="gma-card pointer-events-auto absolute left-4 right-[calc(4.5rem+1rem)] top-[calc(env(safe-area-inset-top,0px)+1rem)] z-40 mx-auto flex h-12 items-center justify-center rounded-2xl px-4 sm:left-1/2 sm:right-auto sm:h-auto sm:w-[min(460px,calc(100vw-7rem))] sm:-translate-x-1/2 sm:px-5 sm:py-3"
        style={{ boxShadow: 'var(--gma-shadow-lg)' }}
        role="status"
        aria-live="polite"
      >
        <div className="flex w-full items-center justify-center gap-2.5 whitespace-nowrap">
          <span
            className="truncate text-sm font-medium text-[var(--gma-text-primary)]"
            style={{ maxWidth: '180px' }}
            title={destinationLabel}
          >
            {destinationLabel}
          </span>
          <span className="text-[var(--gma-text-muted)]">·</span>
          <span
            className="text-sm text-[var(--gma-text-secondary)]"
            style={{ fontFamily: 'var(--font-data)' }}
          >
            {km}
          </span>
          <span className="text-[var(--gma-text-muted)]">·</span>
          <span
            className="text-sm text-[var(--gma-text-secondary)]"
            style={{ fontFamily: 'var(--font-data)' }}
          >
            {min} min
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onStop}
        className="gma-card gma-press pointer-events-auto absolute right-4 top-[calc(env(safe-area-inset-top,0px)+1rem)] z-40 flex h-12 min-w-[64px] items-center justify-center rounded-full px-4 text-sm font-medium text-[var(--gma-text-primary)] hover:bg-[var(--gma-hover-bg)]"
        aria-label="Stop navigation"
      >
        Stop
      </button>
    </>
  );
}

function formatKm(meters: number): string {
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
