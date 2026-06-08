export interface PersistentMapLegendProps {
  /** Caller passes `useSidebar && !navigating && hasRoute` so the
   *  legend only shows when there's actual data to interpret. */
  visible: boolean;
}

/**
 * Always-visible, non-collapsible legend card pinned bottom-left on
 * desktop. Spec'd as a small white card with slate-700 text listing
 * the four map-layer color codes the user is looking at:
 *
 *   🔴  Large orange-red dot  — Glass glare hotspot (+15°F)
 *   🟢  Small green dot       — Tree canopy
 *   🟠  Orange line           — Sunny street segment
 *   🔵  Blue line             — Shaded street segment
 *
 * Sits at z-49 — just below the persistent "?" button (z-50) so the
 * button stays tappable when both are mounted, and just above the
 * DataAttribution chip behind it.
 */
export function PersistentMapLegend({ visible }: PersistentMapLegendProps) {
  if (!visible) return null;
  return (
    <div
      className="pointer-events-auto fixed rounded-xl px-3 py-2.5"
      style={{
        // Anchored to the bottom-left of the MAP area (not the
        // sidebar). The sidebar is 380 px wide; setting `left: 380px`
        // pins the card right at the sidebar/map boundary. `bottom:
        // 16px` keeps it clear of the viewport edge.
        left: '380px',
        bottom: '16px',
        zIndex: 49,
        background: '#ffffff',
        border: '1px solid rgba(15, 23, 42, 0.08)',
        boxShadow:
          '0 6px 18px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.05)',
        color: 'rgb(51, 65, 85)', // slate-700
        fontFamily: "'Inter', system-ui, sans-serif",
        minWidth: '232px',
      }}
      role="region"
      aria-label="Map color legend"
    >
      <div
        className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
        style={{
          color: 'rgb(100, 116, 139)', // slate-500
          fontFamily: 'var(--font-data)',
        }}
      >
        Legend
      </div>
      <ul className="flex flex-col gap-1.5 text-[12px] leading-tight">
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block shrink-0 rounded-full"
            style={{
              width: '12px',
              height: '12px',
              background: 'rgb(255, 107, 53)',
              border: '1.5px solid rgba(255, 255, 255, 0.9)',
              boxShadow: '0 0 0 1px rgba(180, 50, 0, 0.35)',
            }}
          />
          <span>
            Glass glare hotspot
            <span style={{ color: 'rgb(100, 116, 139)' }}> (+15°F)</span>
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block shrink-0 rounded-full"
            style={{
              width: '7px',
              height: '7px',
              background: 'rgb(30, 100, 50)',
              marginLeft: '2.5px',
              marginRight: '2.5px',
            }}
          />
          <span>Tree canopy</span>
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block shrink-0 rounded-full"
            style={{
              width: '22px',
              height: '4px',
              background: 'rgb(245, 158, 11)',
            }}
          />
          <span>Sunny street segment</span>
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block shrink-0 rounded-full"
            style={{
              width: '22px',
              height: '4px',
              background: 'rgb(59, 130, 246)',
            }}
          />
          <span>Shaded street segment</span>
        </li>
      </ul>
    </div>
  );
}
