import { useState } from 'react';
import {
  routeComfortPercent,
  routeRainComfortPercent,
  routeWindComfortPercent,
  type HlciWeights,
  type ScoredRoute,
  type SunComfortDirection,
} from '../lib/hlciRouter';
import type { RGB } from '../lib/daylight';
import type { PrecipitationType } from '../hooks/useWeatherData';

export type FilterMode =
  | 'avoid-sun'
  | 'avoid-wind'
  | 'avoid-both'
  | 'avoid-rain'
  | 'sunniest'
  | 'no-preference';

// All four cost axes (sun / wind / rain / shade-bonus) baked into each
// preset. `avoid-both` sets a small rain weight too — App.tsx replaces
// it dynamically when the current weather has elevated precipitation
// probability, but the default keeps the slot non-zero so a downpour
// stays in the cost model even without that runtime bump.
export const FILTER_PRESETS: Record<FilterMode, HlciWeights> = {
  'avoid-sun': {
    glareAvoidance: 1.0,
    windAvoidance: 0.0,
    shadePreference: 0.0,
    rainAvoidance: 0.0,
  },
  'avoid-wind': {
    glareAvoidance: 0.0,
    windAvoidance: 1.0,
    shadePreference: 0.0,
    rainAvoidance: 0.0,
  },
  'avoid-both': {
    glareAvoidance: 0.8,
    windAvoidance: 0.8,
    shadePreference: 0.0,
    rainAvoidance: 0.0, //  bumped at runtime when it's actually raining
  },
  'avoid-rain': {
    glareAvoidance: 0.0,
    windAvoidance: 0.0,
    shadePreference: 0.0,
    rainAvoidance: 1.0,
  },
  sunniest: {
    glareAvoidance: -1.0,
    windAvoidance: 0.0,
    shadePreference: 0.0,
    rainAvoidance: 0.0,
  },
  'no-preference': {
    glareAvoidance: 0.0,
    windAvoidance: 0.0,
    shadePreference: 0.0,
    rainAvoidance: 0.0,
  },
};

const FILTER_META: Record<
  FilterMode,
  { label: string; verb: string; accent: 'sun' | 'wind' | 'rain' | 'neutral' }
> = {
  'avoid-sun': { label: 'Avoid Sun', verb: 'cooler', accent: 'sun' },
  'avoid-wind': { label: 'Avoid Wind', verb: 'calmer', accent: 'wind' },
  'avoid-both': { label: 'Avoid Both', verb: 'gentler', accent: 'sun' },
  'avoid-rain': { label: 'Avoid Rain', verb: 'drier', accent: 'rain' },
  sunniest: { label: 'Sunniest', verb: 'sunnier', accent: 'sun' },
  'no-preference': { label: 'No preference', verb: 'comfort', accent: 'neutral' },
};

// Probability threshold for showing the Avoid Rain pill at all.
// Below this the pill is filtered out of ORDERED_FILTERS at render time.
const RAIN_PILL_MIN_PROBABILITY = 20;

const ORDERED_FILTERS: FilterMode[] = [
  'avoid-sun',
  'avoid-wind',
  'avoid-both',
  'avoid-rain',
  'sunniest',
  'no-preference',
];

/**
 * Maps the active filter pill to a sun direction the comfort-percent
 * helper understands. Sun-aware filters → exposure-derived absolute %.
 * Wind / no-preference → fall back to candidate-relative normalize.
 */
function filterToSunDirection(mode: FilterMode): SunComfortDirection {
  if (mode === 'avoid-sun' || mode === 'avoid-both') return 'cooler';
  if (mode === 'sunniest') return 'sunnier';
  return null;
}

/**
 * Plain-English condition label derived from the route's binary mean sun
 * exposure (0..1). Thresholds per the 2026-06-01 fix:
 *   exposure > 0.7  → "Mostly sunny"
 *   0.3 ≤ ≤ 0.7    → "Partly shaded"
 *   exposure < 0.3  → "Mostly shaded"
 */
type RouteCondition =
  | 'mostly-sunny'
  | 'partly-shaded'
  | 'mostly-shaded'
  | 'strong-headwind'
  | 'moderate-wind'
  | 'sheltered'
  | 'rain-exposed'
  | 'rain-sheltered'
  | 'snow-exposed'
  | 'snow-sheltered';

function exposureToSunCondition(exposure: number): RouteCondition {
  if (exposure > 0.7) return 'mostly-sunny';
  if (exposure < 0.3) return 'mostly-shaded';
  return 'partly-shaded';
}

function exposureToWindCondition(exposure: number): RouteCondition {
  if (exposure > 0.7) return 'strong-headwind';
  if (exposure < 0.3) return 'sheltered';
  return 'moderate-wind';
}

function exposureToPrecipCondition(
  exposure: number,
  precipType: PrecipitationType,
): RouteCondition {
  const isSnow = precipType === 'snow';
  if (exposure > 0.3) return isSnow ? 'snow-exposed' : 'rain-exposed';
  return isSnow ? 'snow-sheltered' : 'rain-sheltered';
}

const CONDITION_LABEL: Record<RouteCondition, string> = {
  'mostly-sunny': 'Mostly sunny',
  'partly-shaded': 'Partly shaded',
  'mostly-shaded': 'Mostly shaded',
  'strong-headwind': 'Strong headwind',
  'moderate-wind': 'Moderate wind',
  sheltered: 'Sheltered',
  'rain-exposed': 'Rain exposed',
  'rain-sheltered': 'Rain sheltered',
  'snow-exposed': 'Snow exposed',
  'snow-sheltered': 'Snow sheltered',
};

const CONDITION_COLOR: Record<RouteCondition, string> = {
  'mostly-sunny': 'rgb(234, 88, 12)', //   amber-orange — uncomfortable
  'partly-shaded': 'rgb(180, 130, 20)', // muted gold
  'mostly-shaded': 'rgb(30, 120, 60)', //  green — comfortable
  'strong-headwind': 'rgb(168, 85, 247)', // violet-500 — windy
  'moderate-wind': 'rgb(180, 130, 20)', //  muted gold — middle
  sheltered: 'rgb(30, 120, 60)', //         green — comfortable
  'rain-exposed': 'rgb(71, 85, 105)', //    slate-600 — wet
  'rain-sheltered': 'rgb(6, 182, 212)', //  cyan-500 — dry
  'snow-exposed': 'rgb(30, 58, 138)', //    blue-900 — frosty
  'snow-sheltered': 'rgb(99, 158, 235)', // lighter blue — protected
};

export interface RouteSheetProps {
  routes: ScoredRoute[];
  selectedRouteIdx: number;
  onSelectRoute: (idx: number) => void;
  filterMode: FilterMode;
  onFilterChange: (mode: FilterMode) => void;
  onDismiss: () => void;
  onStartNavigation: () => void;
  isLoading: boolean;
  /** Live time-of-day color used for sun-accent filter pills + Start button. */
  dayColor: RGB;
  /**
   * Submit a free-text preference to the Gemini interpreter. The host
   * (App.tsx) decides what to do with the response — update filter,
   * fire a toast, etc. Returns once the interpretation has completed.
   */
  onSubmitPreference: (text: string) => Promise<void>;
  /** True while a Gemini call is in flight — disables the input + button. */
  geminiBusy: boolean;
  /**
   * Live precipitation probability 0..100. Drives whether the
   * "Avoid Rain" filter pill is rendered (only at > 20 %).
   */
  precipitationProbability: number;
  /** Rain vs snow vs none — switches the condition chip label + color. */
  precipitationType: PrecipitationType;
}

/**
 * Light bottom sheet — Google-Maps-style card with filter pills, route
 * options, and a Start button. Sun-filter pills accent with the live
 * dayColor; wind pill uses fixed blue; no-preference uses neutral grey.
 */
export function RouteSheet({
  routes,
  selectedRouteIdx,
  onSelectRoute,
  filterMode,
  onFilterChange,
  onDismiss,
  onStartNavigation,
  isLoading,
  dayColor,
  onSubmitPreference,
  geminiBusy,
  precipitationProbability,
  precipitationType,
}: RouteSheetProps) {
  const verb = FILTER_META[filterMode].verb;
  const canStart = !isLoading && routes.length > 0;
  const dayAccent = `rgb(${dayColor[0]}, ${dayColor[1]}, ${dayColor[2]})`;
  const sunDirection = filterToSunDirection(filterMode);
  const isSunFilter =
    filterMode === 'avoid-sun' || filterMode === 'avoid-both';
  const isWindFilter = filterMode === 'avoid-wind';
  const isRainFilter = filterMode === 'avoid-rain';
  const [preferenceInput, setPreferenceInput] = useState('');

  // Hide the Avoid Rain pill when probability is too low to matter.
  // (We still keep it visible if the user already selected it — pulling
  // a pill out from under them mid-session would be confusing.)
  const visibleFilters = ORDERED_FILTERS.filter(
    (m) =>
      m !== 'avoid-rain' ||
      precipitationProbability >= RAIN_PILL_MIN_PROBABILITY ||
      filterMode === 'avoid-rain',
  );

  const handlePreferenceSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const trimmed = preferenceInput.trim();
    if (!trimmed || geminiBusy) return;
    await onSubmitPreference(trimmed);
    setPreferenceInput('');
  };

  // Warn when every route in the result set is "mostly sunny" — exposure
  // above the 0.7 threshold — for cooler-preferring filters. Tells the
  // user there's no shaded option at this time-of-day so they consider
  // shifting the departure window.
  const allMostlySunny =
    isSunFilter &&
    !isLoading &&
    routes.length > 0 &&
    routes.every(
      (r) => r.meanSunExposure != null && r.meanSunExposure > 0.7,
    );

  return (
    <div
      className="pointer-events-auto absolute bottom-0 left-1/2 z-30 flex max-h-[60dvh] w-[min(440px,100vw)] -translate-x-1/2 flex-col rounded-t-2xl bg-white pb-[max(env(safe-area-inset-bottom,0px),16px)] sm:max-h-[75dvh]"
      style={{
        boxShadow: 'var(--gma-shadow-lg)',
        border: '1px solid var(--gma-border)',
        borderBottom: 'none',
      }}
      role="dialog"
      aria-label="Route options"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Close routes"
        className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full text-[var(--gma-text-secondary)] hover:bg-black/5 hover:text-[var(--gma-text-primary)]"
      >
        <CloseIcon />
      </button>

      <div
        className="mx-auto my-2 h-1 w-10 shrink-0 rounded-full"
        style={{ background: 'var(--gma-border-strong)' }}
      />

      <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-3 pt-1 [-ms-overflow-style:none] [scrollbar-width:none]">
        {visibleFilters.map((mode) => {
          const meta = FILTER_META[mode];
          const active = mode === filterMode;
          // The 'rain' accent picks cyan for rain probability,
          // sky-blue for snow — both read as "wet weather" colors.
          const rainAccent =
            precipitationType === 'snow'
              ? 'rgb(99, 158, 235)'
              : 'rgb(6, 182, 212)';
          const accent =
            meta.accent === 'sun'
              ? dayAccent
              : meta.accent === 'rain'
                ? rainAccent
                : meta.accent === 'wind'
                ? 'var(--gma-accent-wind)'
                : 'var(--gma-accent-neutral)';
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onFilterChange(mode)}
              className="inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm transition-colors"
              style={
                active
                  ? {
                      background: accent,
                      borderColor: 'transparent',
                      color: '#ffffff',
                    }
                  : {
                      background: 'rgba(0, 0, 0, 0.04)',
                      borderColor: 'transparent',
                      color: 'var(--gma-text-secondary)',
                    }
              }
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      <form
        onSubmit={handlePreferenceSubmit}
        className="mx-3 mb-3 flex shrink-0 items-center gap-2"
        aria-label="Describe your routing preference"
      >
        <input
          type="text"
          value={preferenceInput}
          onChange={(event) => setPreferenceInput(event.target.value)}
          placeholder="e.g. I'm walking in a suit"
          disabled={geminiBusy}
          maxLength={140}
          className="h-11 flex-1 rounded-full px-4 text-sm outline-none placeholder:text-[var(--gma-text-muted)] disabled:opacity-60"
          style={{
            background: 'rgba(0, 0, 0, 0.04)',
            border: '1px solid var(--gma-border)',
            color: 'var(--gma-text-primary)',
          }}
          aria-label="Routing preference"
        />
        <button
          type="submit"
          disabled={geminiBusy || preferenceInput.trim().length === 0}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
          style={{
            background: dayAccent,
            color: '#ffffff',
          }}
          aria-label={geminiBusy ? 'Interpreting…' : 'Send to Gemini'}
        >
          {geminiBusy ? <SmallSpinner /> : <SendIcon />}
        </button>
      </form>

      <div className="flex-1 overflow-y-auto">
        {allMostlySunny && (
          <div
            className="mx-3 mb-2 flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
            style={{
              background: 'rgba(251, 188, 4, 0.12)',
              border: '1px solid rgba(234, 88, 12, 0.30)',
              color: 'rgb(140, 60, 0)',
            }}
            role="status"
          >
            <SunWarningIcon />
            <span>
              All routes are sunny at this time. Try leaving earlier or later
              for more shade.
            </span>
          </div>
        )}

        <div className="space-y-2 px-3 pb-3">
          {isLoading ? (
          <div className="flex items-center gap-3 px-3 py-5 text-sm text-[var(--gma-text-secondary)]">
            <Spinner color={dayAccent} />
            Finding routes…
          </div>
        ) : routes.length === 0 ? (
          <div className="px-3 py-5 text-center text-sm text-[var(--gma-text-secondary)]">
            No routes found. Try a closer destination.
          </div>
        ) : (
          routes.map((route, idx) => (
            <RouteCard
              key={`${route.label}-${idx}`}
              route={route}
              percent={
                isRainFilter
                  ? routeRainComfortPercent(route, routes, 'sheltered')
                  : isWindFilter
                    ? routeWindComfortPercent(route, routes, 'sheltered')
                    : routeComfortPercent(route, routes, sunDirection)
              }
              verb={verb}
              condition={
                isRainFilter && route.meanPrecipExposure != null
                  ? exposureToPrecipCondition(
                      route.meanPrecipExposure,
                      precipitationType,
                    )
                  : isWindFilter && route.meanWindExposure != null
                    ? exposureToWindCondition(route.meanWindExposure)
                    : isSunFilter && route.meanSunExposure != null
                      ? exposureToSunCondition(route.meanSunExposure)
                      : null
              }
              selected={idx === selectedRouteIdx}
              onClick={() => onSelectRoute(idx)}
              dayAccent={dayAccent}
            />
          ))
        )}
        </div>
      </div>

      {canStart && (
        <div className="shrink-0 px-3 pb-1 pt-2">
          <button
            type="button"
            onClick={onStartNavigation}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl text-base font-medium uppercase tracking-wider transition-transform active:scale-[0.98]"
            style={{
              background: dayAccent,
              color: '#ffffff',
            }}
          >
            <NavIcon />
            Start
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- RouteCard ----------------------------------------------------

interface RouteCardProps {
  route: ScoredRoute;
  percent: number;
  verb: string;
  /** Plain-English condition derived from meanSunExposure; null for non-sun filters. */
  condition: RouteCondition | null;
  selected: boolean;
  onClick: () => void;
  dayAccent: string;
}

function RouteCard({
  route,
  percent,
  verb,
  condition,
  selected,
  onClick,
  dayAccent,
}: RouteCardProps) {
  const km = (route.distanceMeters / 1000).toFixed(2);
  const min = Math.max(1, Math.round(route.durationSeconds / 60));
  const badgeColor =
    percent >= 70
      ? 'rgb(52, 168, 83)' //   green
      : percent >= 40
        ? 'rgb(251, 188, 4)' // amber
        : 'rgb(234, 67, 53)'; // red

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="flex min-h-[64px] w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors"
      style={
        selected
          ? {
              borderColor: dayAccent,
              background: 'rgba(255, 160, 0, 0.06)',
              boxShadow: `inset 0 0 0 1px ${dayAccent}`,
            }
          : {
              borderColor: 'var(--gma-border)',
              background: 'rgba(0, 0, 0, 0.02)',
            }
      }
    >
      <div
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
        style={{
          borderColor: selected ? dayAccent : 'var(--gma-border-strong)',
        }}
      >
        {selected && (
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: dayAccent }}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-base text-[var(--gma-text-primary)]">
            {min} min
          </span>
          {route.isFastest && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--gma-text-secondary)]"
              style={{ background: 'rgba(0, 0, 0, 0.05)' }}
            >
              Fastest
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-[var(--gma-text-secondary)]">
          {km} km · {route.label}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <div
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
          style={{ background: 'rgba(0, 0, 0, 0.05)' }}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: badgeColor }}
            aria-hidden="true"
          />
          <span className="text-xs text-[var(--gma-text-primary)]">
            {percent}%
          </span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--gma-text-secondary)]">
            {verb}
          </span>
        </div>
        {condition && (
          <span
            className="whitespace-nowrap text-[10px]"
            style={{
              color: CONDITION_COLOR[condition],
              fontFamily: 'var(--font-data)',
            }}
          >
            {CONDITION_LABEL[condition]}
          </span>
        )}
      </div>
    </button>
  );
}

// ---------- icons --------------------------------------------------------

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
    </svg>
  );
}

function SmallSpinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SunWarningIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, marginTop: 1 }}
    >
      <circle cx="12" cy="12" r="4" fill="rgb(234, 88, 12)" />
      <g stroke="rgb(234, 88, 12)" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.9" y1="4.9" x2="7" y2="7" />
        <line x1="17" y1="17" x2="19.1" y2="19.1" />
        <line x1="4.9" y1="19.1" x2="7" y2="17" />
        <line x1="17" y1="7" x2="19.1" y2="4.9" />
      </g>
    </svg>
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      style={{ color }}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
