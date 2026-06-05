import { useState } from 'react';

export interface ColorLegendButtonProps {
  visible: boolean;
}

interface LegendEntry {
  swatch: string;
  emoji: string;
  label: string;
  caption: string;
}

const LEGEND_ENTRIES: ReadonlyArray<LegendEntry> = [
  {
    swatch: 'rgb(255, 160, 0)',
    emoji: '🟠',
    label: 'Orange',
    caption: 'Direct sunlight',
  },
  {
    swatch: 'rgb(40, 60, 140)',
    emoji: '🔵',
    label: 'Blue',
    caption: 'Building shade',
  },
  {
    swatch: 'rgb(30, 120, 60)',
    emoji: '🟢',
    label: 'Green',
    caption: 'Tree canopy',
  },
  {
    swatch: 'rgb(220, 38, 38)',
    emoji: '🔴',
    label: 'Red',
    caption: 'Glass glare (+15°F)',
  },
];

/**
 * Small floating "?" button bottom-left that opens a small tooltip card
 * explaining what the route polyline's segment colors mean. Visible
 * only when a route is on the map (parent gates via `visible`). Tap
 * the button to toggle; tap anywhere off the tooltip (the dimmed
 * backdrop) to close.
 *
 * Position: bottom-left, above the bottom sheet — `bottom: min(55vh,
 * 400px) + 16px` matches the sheet's exact top edge on every screen
 * size so the button always sits just above the sheet, never under it.
 */
export function ColorLegendButton({ visible }: ColorLegendButtonProps) {
  const [open, setOpen] = useState(false);

  if (!visible) return null;

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close color legend"
          onClick={() => setOpen(false)}
          className="pointer-events-auto fixed inset-0 z-[44] cursor-default bg-transparent"
        />
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Route color legend"
          className="gma-card gma-pop-in pointer-events-auto absolute z-[46] w-[min(240px,calc(100vw-2rem))] rounded-2xl p-3"
          style={{
            left: '16px',
            bottom: 'calc(min(55vh, 400px) + 4rem)',
            boxShadow: 'var(--gma-shadow-lg)',
          }}
        >
          <div
            className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--gma-text-secondary)]"
            style={{ fontFamily: 'var(--font-data)' }}
          >
            Route colors
          </div>
          <ul className="flex flex-col gap-1.5">
            {LEGEND_ENTRIES.map((entry) => (
              <li key={entry.label} className="flex items-center gap-2 text-sm">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ background: entry.swatch }}
                  aria-hidden="true"
                />
                <span className="text-[var(--gma-text-primary)]">
                  {entry.emoji} {entry.label}
                </span>
                <span className="ml-auto text-[11px] text-[var(--gma-text-secondary)]">
                  {entry.caption}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Show route color legend"
        aria-expanded={open}
        className="gma-card gma-press pointer-events-auto absolute z-[45] flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-[var(--gma-text-primary)]"
        style={{
          left: '16px',
          // Sit just above the bottom sheet on every screen size — the
          // sheet is `min(55vh, 400px)` tall, so this offset clears it
          // by 1 rem on small phones AND on tall desktops.
          bottom: 'calc(min(55vh, 400px) + 1rem)',
        }}
      >
        ?
      </button>
    </>
  );
}
