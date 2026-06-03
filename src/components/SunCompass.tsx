import type { RGB } from '../lib/daylight';
import type { SolarStatus } from '../hooks/useSolarAPI';
import type { OverpassHookStatus } from '../hooks/useOverpassData';
import type { PrecipitationType } from '../hooks/useWeatherData';

export interface SunCompassProps {
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  dayColor: RGB;
  now: Date;
  phaseName: string;
  /** Solar API + Overpass status lines rendered as a compact footer. */
  solarStatus: SolarStatus;
  overpassStatus: OverpassHookStatus;
  /**
   * Live wind data — drives the small violet wind-direction arrow
   * overlaid on the sun disc. Null when the Weather API hasn't
   * responded yet; the arrow + speed text are then hidden.
   */
  windDirectionDeg: number | null;
  windSpeedMph: number | null;
  /**
   * Live precipitation — renders a raindrop or snowflake icon + probability
   * percent in the footer when type !== 'none'. Hidden when the API
   * hasn't reported it yet or type is 'none' / probability is 0.
   */
  precipitationType: PrecipitationType | null;
  precipitationProbability: number | null;
}

/**
 * Refined bottom-left sun card — smaller disc (88 px vs the previous
 * 110), tighter padding, and a thin data-source footer so we don't need
 * a separate floating indicator above the card.
 */
export function SunCompass({
  sunAzimuthDeg,
  sunElevationDeg,
  dayColor,
  now,
  phaseName,
  solarStatus,
  overpassStatus,
  windDirectionDeg,
  windSpeedMph,
  precipitationType,
  precipitationProbability,
}: SunCompassProps) {
  const [r, g, b] = dayColor;
  const accent = `rgb(${r}, ${g}, ${b})`;
  const accentSoft = `rgba(${r}, ${g}, ${b}, 0.35)`;

  const elevFraction = Math.max(0, Math.min(1, sunElevationDeg / 90));
  const arcPath = elevationArcPath(elevFraction);

  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <div
      className="pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom,0px)+2.5rem)] left-4 z-30 flex flex-col items-stretch gap-2 rounded-2xl bg-white px-3 py-2.5"
      style={{
        boxShadow: 'var(--gma-shadow-md)',
        border: '1px solid var(--gma-border)',
        minWidth: '128px',
      }}
      aria-label="Sun position and data sources"
    >
      <div className="mx-auto h-[88px] w-[88px]">
        <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
          {/* Outer disc */}
          <circle
            cx="60"
            cy="60"
            r="56"
            fill="rgba(0, 0, 0, 0.025)"
            stroke="rgba(0, 0, 0, 0.10)"
            strokeWidth="1"
          />
          {/* Cardinal tick marks */}
          {[0, 90, 180, 270].map((angle) => (
            <line
              key={angle}
              x1="60"
              y1="6"
              x2="60"
              y2="14"
              stroke="rgba(0, 0, 0, 0.30)"
              strokeWidth="1"
              transform={`rotate(${angle} 60 60)`}
            />
          ))}
          <text
            x="60"
            y="22"
            textAnchor="middle"
            fontSize="9"
            fill="var(--gma-text-secondary)"
            fontFamily="var(--font-data)"
          >
            N
          </text>

          {/* Elevation arc */}
          {elevFraction > 0.01 && (
            <path
              d={arcPath}
              fill="none"
              stroke={accentSoft}
              strokeWidth="3"
              strokeLinecap="round"
            />
          )}

          {/* Sun arrow + amber dot */}
          <g transform={`rotate(${sunAzimuthDeg} 60 60)`}>
            <defs>
              <filter id="sun-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <line
              x1="60"
              y1="60"
              x2="60"
              y2="14"
              stroke={accent}
              strokeWidth="2.5"
              strokeLinecap="round"
              filter="url(#sun-glow)"
            />
            <circle cx="60" cy="14" r="6" fill={accent} filter="url(#sun-glow)" />
          </g>

          {/*
            Wind arrow — violet, points in the direction the wind is
            GOING (windFromDeg + 180), so a "from north" wind shows an
            arrow pointing south. Rendered shorter than the sun arrow
            so the two don't compete visually.
          */}
          {windDirectionDeg != null && (
            <g
              transform={`rotate(${(windDirectionDeg + 180) % 360} 60 60)`}
            >
              <line
                x1="60"
                y1="60"
                x2="60"
                y2="26"
                stroke="rgb(168, 85, 247)"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.85"
              />
              {/* Arrowhead */}
              <polygon
                points="60,18 56,28 64,28"
                fill="rgb(168, 85, 247)"
                opacity="0.85"
              />
            </g>
          )}

          <circle cx="60" cy="60" r="2.5" fill="rgba(0, 0, 0, 0.5)" />
        </svg>
      </div>

      <div className="flex flex-col items-center leading-none">
        <div
          className="text-sm tracking-wider text-[var(--gma-text-primary)]"
          style={{ fontFamily: 'var(--font-data)' }}
        >
          {timeStr}
        </div>
        <div
          className="mt-1 text-[9px] uppercase tracking-[0.18em] text-[var(--gma-text-secondary)]"
          style={{ fontFamily: 'var(--font-data)' }}
        >
          {phaseName} · {sunElevationDeg.toFixed(0)}°
        </div>
        {windSpeedMph != null && windDirectionDeg != null && (
          <div
            className="mt-1 text-[9px] uppercase tracking-[0.18em]"
            style={{
              fontFamily: 'var(--font-data)',
              color: 'rgb(168, 85, 247)',
            }}
          >
            Wind · {Math.round(windSpeedMph)} mph ·{' '}
            {compassCardinal(windDirectionDeg)}
          </div>
        )}
        {precipitationType != null &&
          precipitationType !== 'none' &&
          precipitationProbability != null &&
          precipitationProbability > 0 && (
            <div
              className="mt-1 flex items-center gap-1 text-[9px] uppercase tracking-[0.18em]"
              style={{
                fontFamily: 'var(--font-data)',
                color:
                  precipitationType === 'snow'
                    ? 'rgb(30, 58, 138)' //   blue-900
                    : 'rgb(6, 182, 212)', // cyan-500
              }}
            >
              {precipitationType === 'snow' ? <SnowflakeIcon /> : <RaindropIcon />}
              <span>
                {precipitationType === 'snow' ? 'Snow' : 'Rain'} ·{' '}
                {Math.round(precipitationProbability)}%
              </span>
            </div>
          )}
      </div>

      <div
        className="mt-1 border-t pt-2"
        style={{ borderColor: 'var(--gma-border)' }}
      >
        <DataSourceLine label="Solar" status={renderSolar(solarStatus)} />
        <DataSourceLine label="Overpass" status={renderOverpass(overpassStatus)} />
      </div>
    </div>
  );
}

interface DataSourceLineProps {
  label: string;
  status: { text: string; ok: boolean; loading?: boolean };
}

function DataSourceLine({ label, status }: DataSourceLineProps) {
  const color = status.loading
    ? 'var(--gma-text-secondary)'
    : status.ok
      ? 'rgb(16, 185, 129)' // emerald-500
      : 'rgb(234, 88, 12)'; //  orange-600
  return (
    <div
      className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.12em]"
      style={{ fontFamily: 'var(--font-data)' }}
    >
      <span style={{ color: 'var(--gma-text-secondary)' }}>{label}</span>
      <span style={{ color }}>{status.text}</span>
    </div>
  );
}

function renderSolar(status: SolarStatus): {
  text: string;
  ok: boolean;
  loading?: boolean;
} {
  switch (status) {
    case 'active':
      return { text: '✓', ok: true };
    case 'loading':
      return { text: '…', ok: false, loading: true };
    case 'unavailable':
      return { text: 'fallback', ok: false };
    case 'idle':
      return { text: 'idle', ok: false, loading: true };
  }
}

function renderOverpass(status: OverpassHookStatus): {
  text: string;
  ok: boolean;
  loading?: boolean;
} {
  switch (status) {
    case 'success':
      return { text: '✓', ok: true };
    case 'rate-limited':
      return { text: 'rate-limited', ok: false };
    case 'error':
      return { text: 'unavailable', ok: false };
    case 'loading':
      return { text: '…', ok: false, loading: true };
    case 'idle':
      return { text: 'idle', ok: false, loading: true };
  }
}

function RaindropIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c-3.5 4.7-6 8.3-6 11.7 0 3.4 2.7 6.1 6 6.1s6-2.7 6-6.1c0-3.4-2.5-7-6-11.7z" />
    </svg>
  );
}

function SnowflakeIcon() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="4.2" y1="6.5" x2="19.8" y2="17.5" />
      <line x1="4.2" y1="17.5" x2="19.8" y2="6.5" />
      <polyline points="9.5,3 12,5 14.5,3" />
      <polyline points="9.5,21 12,19 14.5,21" />
    </svg>
  );
}

function compassCardinal(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  const points = [
    'N',
    'NE',
    'E',
    'SE',
    'S',
    'SW',
    'W',
    'NW',
    'N',
  ];
  return points[Math.round(normalized / 45)]!;
}

function elevationArcPath(elevFraction: number): string {
  const cx = 60;
  const cy = 60;
  const r = 48;
  const startX = cx + r;
  const startY = cy;
  const sweepDeg = elevFraction * 90;
  const sweepRad = (sweepDeg * Math.PI) / 180;
  const endX = cx + r * Math.cos(sweepRad);
  const endY = cy - r * Math.sin(sweepRad);
  return `M ${startX} ${startY} A ${r} ${r} 0 0 0 ${endX} ${endY}`;
}
