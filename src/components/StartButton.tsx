import type { RGB } from '../lib/daylight';

export interface StartButtonProps {
  visible: boolean;
  dayColor: RGB;
  onStart: () => void;
}

/**
 * Fixed-position Start button. Lives at the very bottom of the
 * viewport (left:16, right:16, bottom: safe-area-inset-bottom) at
 * z-100 so it's ALWAYS visible regardless of route-sheet height or
 * phone size. Previously baked into RouteSheet, which meant on
 * small phones (where the sheet's max-height clipped the button
 * out of view) the user couldn't see / tap Start.
 */
export function StartButton({ visible, dayColor, onStart }: StartButtonProps) {
  if (!visible) return null;
  const accent = `rgb(${dayColor[0]}, ${dayColor[1]}, ${dayColor[2]})`;
  return (
    <button
      type="button"
      onClick={onStart}
      className="gma-press-soft pointer-events-auto fixed flex h-14 items-center justify-center gap-2 rounded-xl text-base font-medium uppercase tracking-wider"
      style={{
        backgroundImage: `linear-gradient(135deg, ${accent} 0%, color-mix(in srgb, ${accent} 80%, #b45309) 100%)`,
        backgroundColor: accent,
        color: 'var(--gma-text-on-accent)',
        boxShadow: 'var(--gma-shadow-lg), var(--gma-glow-amber)',
        left: '16px',
        right: '16px',
        bottom: 'max(env(safe-area-inset-bottom, 0px), 16px)',
        zIndex: 100,
      }}
      aria-label="Start navigation"
    >
      <NavIcon />
      Start
    </button>
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
