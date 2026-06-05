import type { RGB } from '../lib/daylight';

export interface StartButtonProps {
  visible: boolean;
  dayColor: RGB;
  onStart: () => void;
}

/**
 * Fixed-position Start button — full-width strip pinned to the bottom
 * of the viewport above the Android Chrome nav bar (~56 px).
 *
 * Layout (per Pixel 9 Pro XL field test):
 *   Viewport height (Chrome with bottom bar): ≈ 820 px
 *   Sheet (max-h: 50vh):                       ≈ 410 px  → occupies bottom 0–410
 *   Start container (bottom: 56, h ≈ 68):      → occupies bottom 56–124
 *   Sheet visible band above Start:            ≈ 286 px  → enough for handle +
 *                                                          filter pills + 1–2
 *                                                          route cards
 *   "?" legend (bottom: 50vh + 72):            → bottom 482 (above sheet)
 *
 * We HARD-CODE `bottom: 56 px` (no `env(safe-area-inset-bottom)`) because
 * Chrome Android does not report the home-gesture inset via env() — the
 * 56 px figure matches the persistent bottom nav bar height there.
 * iOS Safari has its own safe-area handling and lands the button slightly
 * higher (the inset reports ~34 px), but Chrome Android is the dominant
 * device target for this build per the user's report.
 */
export function StartButton({ visible, dayColor, onStart }: StartButtonProps) {
  if (!visible) return null;
  const accent = `rgb(${dayColor[0]}, ${dayColor[1]}, ${dayColor[2]})`;
  return (
    <div
      className="pointer-events-auto fixed"
      style={{
        bottom: '56px',
        left: 0,
        right: 0,
        zIndex: 200,
        padding: '12px 16px',
      }}
    >
      <button
        type="button"
        onClick={onStart}
        className="gma-press-soft flex h-14 w-full items-center justify-center gap-2 rounded-xl text-base font-medium uppercase tracking-wider"
        style={{
          backgroundImage: `linear-gradient(135deg, ${accent} 0%, color-mix(in srgb, ${accent} 80%, #b45309) 100%)`,
          backgroundColor: accent,
          color: 'var(--gma-text-on-accent)',
          boxShadow: 'var(--gma-shadow-lg), var(--gma-glow-amber)',
        }}
        aria-label="Start navigation"
      >
        <NavIcon />
        Start
      </button>
    </div>
  );
}

function NavIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2z" />
    </svg>
  );
}
