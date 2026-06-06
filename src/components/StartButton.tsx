import type { RGB } from '../lib/daylight';

export interface StartButtonProps {
  visible: boolean;
  dayColor: RGB;
  onStart: () => void;
  /**
   * Render as a normal flex-column child (no fixed positioning) for
   * the desktop sidebar. The button still uses the same amber-pill
   * styling — it just stays in document flow at the bottom of the
   * sidebar instead of floating over the viewport.
   */
  embedded?: boolean;
}

const AMBER = '#F59E0B';

/**
 * Primary CTA — solid amber pill, white bold text, 56 px tall.
 *
 * Mobile / floating mode (`embedded` = false, the default):
 *   `position: fixed; bottom: 56px; left: 16; right: 16; z: 200`.
 *   Centered on desktop screens with `sm:max-w-[460px]`. This is the
 *   mode the demo runs on phone — always visible above the Chrome
 *   Android nav bar regardless of route-sheet height.
 *
 * Embedded mode (`embedded` = true):
 *   Renders as a normal flex item inside the desktop sidebar at its
 *   natural bottom edge. No fixed positioning.
 *
 * Despite the `dayColor` prop, the live time-of-day color is
 * intentionally NOT used — we want a stable amber across the whole
 * day so the Start affordance reads the same at noon as at dusk.
 */
export function StartButton({
  visible,
  dayColor,
  onStart,
  embedded = false,
}: StartButtonProps) {
  void dayColor; // kept on the API for symmetry; intentionally unused
  if (!visible) return null;

  const SHARED_BUTTON_STYLE: React.CSSProperties = {
    background: AMBER,
    color: '#ffffff',
    boxShadow:
      '0 6px 20px rgba(245, 158, 11, 0.40), 0 2px 8px rgba(0, 0, 0, 0.12)',
  };

  if (embedded) {
    return (
      <button
        type="button"
        onClick={onStart}
        aria-label="Start navigation"
        className="gma-press-soft flex h-14 w-full items-center justify-center gap-2 rounded-xl text-base font-bold uppercase tracking-wider"
        style={SHARED_BUTTON_STYLE}
      >
        <NavIcon />
        Start
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      aria-label="Start navigation"
      className="gma-press-soft pointer-events-auto fixed left-4 right-4 flex h-14 items-center justify-center gap-2 rounded-xl text-base font-bold uppercase tracking-wider sm:left-1/2 sm:right-auto sm:w-[460px] sm:-translate-x-1/2"
      style={{
        ...SHARED_BUTTON_STYLE,
        bottom: '56px',
        zIndex: 200,
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
