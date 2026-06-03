import type { TravelMode } from '../lib/hlciRouter';
import type { RGB } from '../lib/daylight';

export interface TransportModeSwitcherProps {
  value: TravelMode;
  onChange: (next: TravelMode) => void;
  dayColor: RGB;
}

const MODES: ReadonlyArray<{
  key: TravelMode;
  label: string;
  icon: () => React.ReactNode;
}> = [
  { key: 'WALK', label: 'Walk', icon: WalkIcon },
  { key: 'BICYCLE', label: 'Bike', icon: BikeIcon },
  { key: 'DRIVE', label: 'Drive', icon: CarIcon },
  { key: 'TRANSIT', label: 'Transit', icon: TransitIcon },
];

/**
 * Light icon-only pill row that sits under the SearchBar. Active pill fills
 * with the live time-of-day color; inactive pills are flat light grey on
 * the white glass background.
 */
export function TransportModeSwitcher({
  value,
  onChange,
  dayColor,
}: TransportModeSwitcherProps) {
  const accentRgb = `rgb(${dayColor[0]}, ${dayColor[1]}, ${dayColor[2]})`;

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-[calc(env(safe-area-inset-top,0px)+7.5rem)] z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white p-1"
      style={{
        boxShadow: 'var(--gma-shadow-md)',
        border: '1px solid var(--gma-border)',
      }}
      role="radiogroup"
      aria-label="Transport mode"
    >
      {MODES.map(({ key, label, icon: Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => onChange(key)}
            className="flex h-9 w-12 items-center justify-center rounded-full transition-colors"
            style={
              active
                ? {
                    background: accentRgb,
                    color: '#ffffff',
                  }
                : {
                    background: 'transparent',
                    color: 'var(--gma-text-secondary)',
                  }
            }
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}

function WalkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="13" cy="4" r="2" />
      <path d="M9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7" />
    </svg>
  );
}

function BikeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5.5" cy="17.5" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="18.5" cy="17.5" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M15 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm-3 11.5l-3.5-7L7 11l3 3 1-3 4 4-3 2.5z" stroke="currentColor" strokeWidth="0.5" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h12v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-8l-2.08-5.99zM6.5 16a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm11 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM5 11l1.5-4.5h11L19 11H5z" />
    </svg>
  );
}

function TransitIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h12v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3.5-7H6V6h5v4zm5.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm1.5-7h-5V6h5v4z" />
    </svg>
  );
}
