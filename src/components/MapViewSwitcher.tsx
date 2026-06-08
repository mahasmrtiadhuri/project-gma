export type MapView = '2d' | '3d' | 'satellite';

export interface MapViewSwitcherProps {
  value: MapView;
  onChange: (next: MapView) => void;
  /**
   * True when the bottom RouteSheet is open. On mobile the switcher
   * moves UP to sit above the sheet (which is 52 % of the viewport).
   * On desktop the sheet is a 440 px centered overlay, so the switcher
   * can stay in the bottom-right corner unchanged.
   */
  routeSheetOpen?: boolean;
  /**
   * True when in navigation mode. The switcher lifts above the bottom
   * NextTurnIndicator pill (14 rem at bottom of viewport, plus safe
   * area) so the two never overlap.
   */
  navigating?: boolean;
  /**
   * Desktop sidebar layout: stack the switcher at the top-right of
   * the map area, just below the ThemeToggle, so the two form a
   * single vertical toolbar. When false the prior bottom-right
   * dynamic positioning takes over.
   */
  stackedTopRight?: boolean;
}

const OPTIONS: ReadonlyArray<{ key: MapView; label: string }> = [
  { key: '2d', label: '2D' },
  { key: '3d', label: '3D' },
  { key: 'satellite', label: 'Sat' },
];

/**
 * Light map-view switcher (bottom-right). 2D → CartoDB Positron tiles;
 * 3D → Google Photorealistic 3D Tiles; satellite → ESRI World Imagery.
 */
export function MapViewSwitcher({
  value,
  onChange,
  routeSheetOpen = false,
  navigating = false,
  stackedTopRight = false,
}: MapViewSwitcherProps) {
  // Desktop sidebar mode: pin to top-right just below the ThemeToggle.
  // ThemeToggle is at top: env+1rem, h-11 (44 px), so we sit at
  // env+1rem + 44 + 8 ≈ env+4rem.
  if (stackedTopRight) {
    return (
      <div
        className="gma-card pointer-events-auto absolute right-4 z-40 flex flex-col gap-1 rounded-xl p-1"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 4rem)',
        }}
        role="radiogroup"
        aria-label="Map view"
      >
        {OPTIONS.map((opt) => {
          const active = value === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.key)}
              className="gma-press flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-3 text-xs uppercase tracking-wider"
              style={
                active
                  ? {
                      background: 'var(--gma-press-bg)',
                      color: 'var(--gma-text-primary)',
                    }
                  : {
                      background: 'transparent',
                      color: 'var(--gma-text-secondary)',
                    }
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  // Dynamic bottom offset so the switcher never collides with the
  // bottom sheet or the navigation next-turn pill. Order matters —
  // nav takes precedence over sheet-open since they don't co-occur.
  let bottomStyle: string;
  if (navigating) {
    // Above NextTurnIndicator: pill is h-14 (56 px) + bottom env+1rem
    // = ~88 px from bottom, plus 16 px gap → ~104 px (≈ 6.5 rem)
    // above the safe-area inset.
    bottomStyle = 'calc(env(safe-area-inset-bottom, 0px) + 6.5rem)';
  } else if (routeSheetOpen) {
    // Above BOTH the route sheet (50vh) AND the "?" color-legend
    // button which sits at `bottom: calc(50vh + 72px)`. The "?" is
    // 40 px tall; we stack the switcher 16 px above it.
    bottomStyle = 'calc(50vh + 72px + 40px + 1rem)';
  } else {
    bottomStyle = 'calc(env(safe-area-inset-bottom, 0px) + 2rem)';
  }

  return (
    <div
      className="gma-card pointer-events-auto absolute right-4 z-40 flex flex-col gap-1 rounded-xl p-1"
      style={{ bottom: bottomStyle }}
      role="radiogroup"
      aria-label="Map view"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.key)}
            className="gma-press flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-3 text-xs uppercase tracking-wider"
            style={
              active
                ? {
                    background: 'var(--gma-press-bg)',
                    color: 'var(--gma-text-primary)',
                  }
                : {
                    background: 'transparent',
                    color: 'var(--gma-text-secondary)',
                  }
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
