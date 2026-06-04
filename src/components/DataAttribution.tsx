export interface DataAttributionProps {
  /**
   * False hides the attribution chip entirely. We hide it whenever the
   * RouteSheet is open or during navigation, since the sheet/nav
   * chrome occupies the bottom band where this would render and the
   * chip would either get obscured (sheet) or compete with the
   * next-turn indicator (nav).
   */
  visible: boolean;
}

/**
 * Bottom-of-map attribution strip. Per spec, this is the proof statement
 * that grounds the app in real data: "Sun data: Google Solar API · Trees:
 * OpenStreetMap · Updated live". Sits centered above the safe-area inset,
 * does not block pointer events on the map below.
 */
export function DataAttribution({ visible }: DataAttributionProps) {
  if (!visible) return null;
  return (
    <div
      className="gma-glass pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom,0px)+4px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[10px]"
      style={{
        color: 'var(--gma-text-secondary)',
        boxShadow: 'var(--gma-shadow-sm)',
        fontFamily: 'var(--font-data)',
      }}
      aria-label="Data sources"
    >
      Sun data: Google Solar API · Trees: OpenStreetMap · Updated live
    </div>
  );
}
