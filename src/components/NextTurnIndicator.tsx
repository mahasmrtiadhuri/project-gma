import type { NextTurn } from '../lib/navigation';

export interface NextTurnIndicatorProps {
  nextTurn: NextTurn | null;
  /**
   * Color (RGBA tuple) of the upcoming route segment, used to paint a
   * thin top bar on the pill so the user can read at a glance what
   * the section ahead feels like — orange = direct sun, blue = shade,
   * green = tree canopy, red = glass glare. Null hides the bar.
   */
  upcomingColor?: [number, number, number, number] | null;
}

/**
 * Bottom-of-screen "next turn" pill — larger Google-Maps-style card
 * showing the upcoming maneuver in bold, the distance to it below,
 * and a colored stripe at the top of the pill matching the comfort
 * color of the segment the user is about to walk through.
 *
 * Example output:
 *   ┌─────────────────────────────────────────┐
 *   │█████ amber stripe (upcoming = sunny) █████│
 *   │  ←   Turn left on W 43rd St            │
 *   │      in 200 m                          │
 *   └─────────────────────────────────────────┘
 */
export function NextTurnIndicator({
  nextTurn,
  upcomingColor,
}: NextTurnIndicatorProps) {
  if (!nextTurn) return null;
  const arrow = pickArrow(nextTurn);
  const instructionText = stripHtml(nextTurn.instruction);
  const distLabel = formatDistance(nextTurn.distanceM);
  const stripeColor = upcomingColor
    ? `rgba(${upcomingColor[0]}, ${upcomingColor[1]}, ${upcomingColor[2]}, ${(upcomingColor[3] ?? 245) / 255})`
    : null;

  return (
    <div
      className="gma-card pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] left-1/2 z-30 w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl"
      style={{ boxShadow: 'var(--gma-shadow-lg)' }}
      role="status"
      aria-live="polite"
    >
      {/* Colored top bar — comfort signal for the upcoming segment.
       * Same Tailwind-500 palette the route polyline uses, so visually
       * "the bar matches the road ahead". */}
      {stripeColor && (
        <div
          className="h-1.5 w-full"
          style={{ background: stripeColor }}
          aria-hidden="true"
        />
      )}

      <div className="flex items-center gap-3 px-5 py-3">
        <span
          className="text-2xl leading-none"
          style={{
            color: nextTurn.isArrival
              ? 'rgb(16, 185, 129)'
              : 'rgb(59, 130, 246)',
            minWidth: '28px',
            textAlign: 'center',
          }}
          aria-hidden="true"
        >
          {arrow}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold text-[var(--gma-text-primary)]">
            {instructionText}
          </div>
          <div
            className="mt-0.5 text-sm text-[var(--gma-text-secondary)]"
            style={{ fontFamily: 'var(--font-data)' }}
          >
            in {distLabel}
          </div>
        </div>
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
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function formatDistance(meters: number): string {
  if (meters < 50) return `${Math.max(0, Math.round(meters))} m`;
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
