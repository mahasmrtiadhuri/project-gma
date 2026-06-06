import type { RGB } from '../lib/daylight';

export interface StartButtonProps {
  visible: boolean;
  dayColor: RGB;
  onStart: () => void;
}

const AMBER = '#F59E0B';

/**
 * Primary CTA — solid amber pill, white bold text, fixed at the bottom
 * of the viewport above the Android Chrome nav bar (56 px).
 *
 * Reads as a real button rather than a faded strip: no surrounding
 * surface band, just the pill itself, full-width on mobile (16 px
 * gutters) and capped at 460 px centered on desktop.
 *
 * Despite the prop name `dayColor`, the live time-of-day color is
 * intentionally NOT used here — we want a stable, recognizable amber
 * across the whole day so the Start affordance reads the same at noon
 * as at dusk. The prop stays in the API for symmetry with other
 * accented components and to leave the door open for re-tinting later.
 */
export function StartButton({ visible, dayColor, onStart }: StartButtonProps) {
  // Reference `dayColor` so the param isn't flagged as unused under
  // `noUnusedParameters` while we keep the API stable.
  void dayColor;
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onStart}
      aria-label="Start navigation"
      className="gma-press-soft pointer-events-auto fixed left-4 right-4 flex h-14 items-center justify-center gap-2 rounded-xl text-base font-bold uppercase tracking-wider sm:left-1/2 sm:right-auto sm:w-[460px] sm:-translate-x-1/2"
      style={{
        background: AMBER,
        color: '#ffffff',
        bottom: '56px',
        zIndex: 200,
        boxShadow:
          '0 6px 20px rgba(245, 158, 11, 0.40), 0 2px 8px rgba(0, 0, 0, 0.12)',
      }}
    >
      <NavIcon />
      Start
    </button>
  );
}

function NavIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2z" />
    </svg>
  );
}
