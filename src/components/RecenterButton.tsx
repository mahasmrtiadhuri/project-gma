export interface RecenterButtonProps {
  visible: boolean;
  onRecenter: () => void;
}

/**
 * Circular crosshair button shown during navigation when the user has
 * panned the map away from the live GPS dot. Tapping it re-engages the
 * follow-cam and snaps the viewport back to the user's location.
 *
 * Position: bottom-right, above the MapViewSwitcher (which itself sits
 * above the NextTurnIndicator). Specifically `bottom: calc(env+11rem)`
 * so it stacks cleanly:
 *
 *   NextTurnIndicator  →  env+1rem
 *   MapViewSwitcher    →  env+6.5rem
 *   RecenterButton     →  env+11rem
 */
export function RecenterButton({ visible, onRecenter }: RecenterButtonProps) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onRecenter}
      aria-label="Re-center map on your location"
      className="gma-card gma-press pointer-events-auto fixed flex h-12 w-12 items-center justify-center rounded-full"
      style={{
        right: '16px',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 11rem)',
        zIndex: 60,
        color: 'rgb(59, 130, 246)',
      }}
    >
      <CrosshairIcon />
    </button>
  );
}

function CrosshairIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <circle
        cx="12"
        cy="12"
        r="8"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <line
        x1="12"
        y1="1.5"
        x2="12"
        y2="5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="19"
        x2="12"
        y2="22.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="1.5"
        y1="12"
        x2="5"
        y2="12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="19"
        y1="12"
        x2="22.5"
        y2="12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
