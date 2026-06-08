export interface TimeScrubberProps {
  /** Visible flag — caller should pass `isDemoMode`. */
  visible: boolean;
  /** Hour of day in 24 h, integer 6 – 22. */
  hour: number;
  /** Live updates as the user drags the slider. */
  onChange: (hour: number) => void;
}

const MIN_HOUR = 6; //   6 AM
const MAX_HOUR = 22; //  10 PM

/**
 * Demo-only horizontal time slider. Drags from 6 AM → 10 PM and the
 * caller (App.tsx) routes the value into `effectiveTime`, which
 * re-runs the entire solar / coloring chain. Watching the route
 * polyline swap between vibrant amber midday and deep-blue dusk in
 * real time is the single most "wait, this is live data" moment of
 * the demo, so the scrubber is the centerpiece of the recorded
 * walkthrough.
 *
 * Positioned bottom-center, above the SunCompass (which sits at
 * `bottom: env+2.5rem`). z-40 so it stays above the deck.gl canvas
 * but under the desktop sidebar (z-30 sheet, but sidebar lives
 * outside the map area entirely).
 */
export function TimeScrubber({ visible, hour, onChange }: TimeScrubberProps) {
  if (!visible) return null;
  const label = formatHour(hour);
  return (
    <div
      className="gma-card pointer-events-auto absolute left-1/2 z-40 -translate-x-1/2 rounded-2xl px-4 py-3"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12rem)',
        width: 'min(420px, calc(100vw - 2rem))',
        boxShadow: 'var(--gma-shadow-md)',
      }}
      aria-label="Simulate time of day"
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{
            color: 'rgb(71, 85, 105)', // slate-600
            fontFamily: 'var(--font-data)',
          }}
        >
          Simulate time of day
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{
            background: '#F59E0B',
            color: '#ffffff',
            fontFamily: 'var(--font-data)',
          }}
        >
          {label}
        </span>
      </div>
      <input
        type="range"
        min={MIN_HOUR}
        max={MAX_HOUR}
        step={1}
        value={hour}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={`Time of day: ${label}`}
        className="block h-2 w-full cursor-pointer appearance-none rounded-full outline-none"
        style={{
          // Gradient mirrors the sun's day arc: deep blue dawn →
          // amber midday → deep blue dusk. Gives the user a visual
          // cue for where on the slider the most-sunny hours sit.
          background:
            'linear-gradient(to right, rgb(59, 130, 246) 0%, rgb(245, 158, 11) 50%, rgb(59, 130, 246) 100%)',
        }}
      />
      <div
        className="mt-1 flex justify-between text-[10px]"
        style={{
          color: 'rgb(100, 116, 139)', // slate-500
          fontFamily: 'var(--font-data)',
        }}
      >
        <span>6 AM</span>
        <span>12 PM</span>
        <span>10 PM</span>
      </div>
    </div>
  );
}

function formatHour(hour24: number): string {
  if (hour24 === 0) return '12 AM';
  if (hour24 === 12) return '12 PM';
  if (hour24 < 12) return `${hour24} AM`;
  return `${hour24 - 12} PM`;
}
