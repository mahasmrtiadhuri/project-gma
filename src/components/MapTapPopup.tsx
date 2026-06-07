export interface MapTapPopupProps {
  /** Screen pixel coordinates of the tap inside the map container. */
  pixelX: number;
  pixelY: number;
  /** Click handler — App.tsx calls reverseGeocode + setDestination here. */
  onSetDestination: () => void;
  /** Tap-outside dismiss. */
  onDismiss: () => void;
  /** Disables the button + flips it to a spinner while the reverse geocode is in flight. */
  busy: boolean;
}

/**
 * Small floating card anchored to a tap on the map. Matches Google
 * Maps' tap-to-place behavior: a "Set as destination" button + a
 * tap-outside backdrop that dismisses without committing.
 *
 * Positioned in pixel space so the popup sits at the tap point even
 * during a map flight (the parent-coordinate space stays stable while
 * the GPU re-renders deck.gl underneath).
 */
export function MapTapPopup({
  pixelX,
  pixelY,
  onSetDestination,
  onDismiss,
  busy,
}: MapTapPopupProps) {
  return (
    <>
      {/* Backdrop — single-tap dismiss without committing. z-49 so it
       * sits just below the popup card (z-50) but above the deck.gl
       * canvas. */}
      <button
        type="button"
        aria-label="Cancel"
        onClick={onDismiss}
        className="absolute inset-0 z-[49] cursor-default bg-transparent"
      />
      <div
        role="dialog"
        aria-label="Set as destination"
        className="gma-card gma-pop-in pointer-events-auto absolute z-[50] flex items-center gap-2 rounded-full p-1.5"
        style={{
          // Anchor the BOTTOM-CENTER of the popup at the tap point so
          // the visible bubble sits above the user's finger. translate
          // brings the bubble's bottom to `pixelY` and centers the
          // bubble horizontally on `pixelX`.
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          transform: 'translate(-50%, calc(-100% - 12px))',
          boxShadow: 'var(--gma-shadow-lg)',
        }}
      >
        {/* Tap-anchor pin sticking out the bottom of the bubble.
         * Decorative — points at the tapped coord. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 -translate-x-1/2"
          style={{
            top: '100%',
            width: 0,
            height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: '8px solid var(--gma-surface)',
            filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.12))',
          }}
        />
        <button
          type="button"
          onClick={onSetDestination}
          disabled={busy}
          className="gma-press flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium"
          style={{
            background: 'var(--gma-accent-sun)',
            color: 'var(--gma-text-on-accent)',
          }}
        >
          <PinIcon />
          {busy ? 'Setting…' : 'Set as destination'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="gma-press flex h-10 w-10 items-center justify-center rounded-full text-[var(--gma-text-secondary)] hover:bg-[var(--gma-hover-bg)]"
        >
          <CloseIcon />
        </button>
      </div>
    </>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
