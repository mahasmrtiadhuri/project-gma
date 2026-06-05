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
 * Small floating "?" button bottom-right that opens a tooltip card
 * explaining what the route polyline's segment colors mean.
 *
 * Position (Android Chrome / Pixel 9 Pro XL field-tested):
 *   - Button: `position: fixed; right: 16px; bottom: calc(50vh + 72px); z-index: 150`
 *     Sits 72 px above the sheet's top edge so it never overlaps the
 *     sheet's drag handle or filter pills.
 *   - Tooltip: opens immediately above the button.
 *
 * Visible only when a route is on the map. Tap the button to toggle;
 * tap anywhere off the tooltip (the dimmed backdrop) to close.
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
          className="pointer-events-auto fixed inset-0 z-[149] cursor-default bg-transparent"
        />
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Route color legend"
          className="gma-card gma-pop-in pointer-events-auto fixed w-[min(260px,calc(100vw-2rem))] rounded-2xl p-3"
          style={{
            right: '16px',
            bottom: 'calc(50vh + 72px + 3rem)',
            zIndex: 151,
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
        className="gma-card gma-press pointer-events-auto fixed flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-[var(--gma-text-primary)]"
        style={{
          right: '16px',
          bottom: 'calc(50vh + 72px)',
          zIndex: 150,
        }}
      >
        ?
      </button>
    </>
  );
}
