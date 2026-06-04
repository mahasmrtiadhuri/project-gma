export type MapView = '2d' | '3d' | 'satellite';

export interface MapViewSwitcherProps {
  value: MapView;
  onChange: (next: MapView) => void;
  /**
   * True when the bottom RouteSheet is open. On mobile (<sm) the sheet
   * is full-width and would overlap the switcher — hide in that case.
   */
  routeSheetOpen?: boolean;
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
}: MapViewSwitcherProps) {
  return (
    <div
      className={
        'gma-card pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom,0px)+2rem)] right-4 z-40 flex flex-col gap-1 rounded-xl p-1' +
        (routeSheetOpen ? ' max-sm:hidden' : '')
      }
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
