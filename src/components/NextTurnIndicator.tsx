import type { NextTurn } from '../lib/navigation';

export interface NextTurnIndicatorProps {
  nextTurn: NextTurn | null;
}

/**
 * Single-line "next turn" pill at the bottom of the screen. Renders
 * nothing when there's no turn data yet (no live position, no steps).
 *
 * Example output:
 *     ←  Turn left on W 43rd St   in 200 m
 *     ↑  Continue straight        in 60 m
 *     ✓  Arriving at destination  in 80 m
 */
export function NextTurnIndicator({ nextTurn }: NextTurnIndicatorProps) {
  if (!nextTurn) return null;
  const arrow = pickArrow(nextTurn);
  const instructionText = stripHtml(nextTurn.instruction);
  const distLabel = formatDistance(nextTurn.distanceM);

  return (
    <div
      className="gma-card pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] left-1/2 z-30 flex h-14 w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 items-center rounded-full px-5"
      style={{ boxShadow: 'var(--gma-shadow-lg)' }}
      role="status"
      aria-live="polite"
    >
      <div className="flex w-full items-center gap-3">
        <span
          className="text-xl leading-none"
          style={{
            color: nextTurn.isArrival ? 'rgb(16, 185, 129)' : 'rgb(59, 130, 246)',
            minWidth: '20px',
            textAlign: 'center',
          }}
          aria-hidden="true"
        >
          {arrow}
        </span>
        <span className="flex-1 truncate text-base text-[var(--gma-text-primary)]">
          {instructionText}
        </span>
        <span
          className="shrink-0 text-sm text-[var(--gma-text-secondary)]"
          style={{ fontFamily: 'var(--font-data)' }}
        >
          in {distLabel}
        </span>
      </div>
    </div>
  );
}

/**
 * Pick a unicode arrow from the instruction text. The Routes API uses
 * verbs like "Turn left", "Slight right", "Continue straight", "Make
 * a U-turn" — we string-match the most common ones and fall back to ↑.
 */
function pickArrow(turn: NextTurn): string {
  if (turn.isArrival) return '✓';
  const text = turn.instruction.toLowerCase();
  if (/u[- ]?turn/.test(text)) return '⤴';
  if (/sharp left/.test(text)) return '↰';
  if (/sharp right/.test(text)) return '↱';
  if (/slight left/.test(text)) return '↖';
  if (/slight right/.test(text)) return '↗';
  if (/\bleft\b/.test(text)) return '←';
  if (/\bright\b/.test(text)) return '→';
  if (/\b(merge|continue|straight|head)\b/.test(text)) return '↑';
  return '↑';
}

function stripHtml(s: string): string {
  // Routes API sometimes wraps street names in <b>…</b> tags. Strip them.
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function formatDistance(meters: number): string {
  if (meters < 50) return `${Math.max(0, Math.round(meters))} m`;
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
