/**
 * Bottom-of-map attribution strip. Per spec, this is the proof statement
 * that grounds the app in real data: "Sun data: Google Solar API · Trees:
 * OpenStreetMap · Updated live". Sits centered above the safe-area inset,
 * does not block pointer events on the map below.
 */
export function DataAttribution() {
  return (
    <div
      className="pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom,0px)+4px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[10px]"
      style={{
        background: 'rgba(255, 255, 255, 0.82)',
        color: 'var(--gma-text-secondary)',
        border: '1px solid var(--gma-border)',
        boxShadow: 'var(--gma-shadow-sm)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        fontFamily: 'var(--font-data)',
      }}
      aria-label="Data sources"
    >
      Sun data: Google Solar API · Trees: OpenStreetMap · Updated live
    </div>
  );
}
