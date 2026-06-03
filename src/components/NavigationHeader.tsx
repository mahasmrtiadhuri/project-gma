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
        className="pointer-events-auto absolute left-1/2 top-[calc(env(safe-area-inset-top,0px)+1rem)] z-40 -translate-x-1/2 rounded-2xl bg-white px-5 py-3"
        style={{
          boxShadow:
            '0 14px 36px rgba(0, 0, 0, 0.10), 0 4px 12px rgba(0, 0, 0, 0.05)',
          border: '1px solid var(--gma-border)',
          maxWidth: 'calc(100vw - 7rem)', //  leave room for the Stop button
        }}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2.5 whitespace-nowrap">
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
        className="pointer-events-auto absolute right-4 top-[calc(env(safe-area-inset-top,0px)+1rem)] z-40 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-[var(--gma-text-primary)] transition-colors hover:bg-black/[0.04]"
        style={{
          boxShadow: 'var(--gma-shadow-md)',
          border: '1px solid var(--gma-border)',
        }}
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
