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
  const [showMoreOptions, setShowMoreOptions] = useState(false);

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
            <div className="space-y-2">
              <div className="flex items-center gap-3 px-3 py-2 text-sm text-[var(--gma-text-secondary)]">
                <Spinner color={dayAccent} />
                Finding routes…
              </div>
              <SkeletonRouteCard />
              <SkeletonRouteCard />
              <SkeletonRouteCard />
            </div>
          ) : routes.length === 0 ? (
            <div className="px-3 py-5 text-center text-sm text-[var(--gma-text-secondary)]">
              No routes found. Try a closer destination.
            </div>
          ) : (
            (() => {
              // ---- Derive fastest + GMA pick + others ------------------
              // `routes` is already sorted by hlciCost ascending, so the
              // comfort pick is routes[0]. Fastest = lowest durationSeconds.
              const comfortIdx = 0;
              const comfort = routes[0]!;
              const fastest = routes.reduce(
                (min, r) => (r.durationSeconds < min.durationSeconds ? r : min),
                routes[0]!,
              );
              const fastestIdx = routes.indexOf(fastest);
              const isCombined = fastestIdx === comfortIdx;
              const others = routes
                .map((r, i) => ({ route: r, idx: i }))
                .filter(
                  ({ idx }) => idx !== fastestIdx && idx !== comfortIdx,
                );

              const timeDeltaMin = Math.max(
                0,
                Math.round(
                  (comfort.durationSeconds - fastest.durationSeconds) / 60,
                ),
              );
              const expDelta = computeExposureDelta(
                fastest,
                comfort,
                filterMode,
              );

              const percentFor = (route: ScoredRoute) =>
                isRainFilter
                  ? routeRainComfortPercent(route, routes, 'sheltered')
                  : isWindFilter
                    ? routeWindComfortPercent(route, routes, 'sheltered')
                    : routeComfortPercent(route, routes, sunDirection);

              const conditionFor = (route: ScoredRoute): RouteCondition | null =>
                isRainFilter && route.meanPrecipExposure != null
                  ? exposureToPrecipCondition(
                      route.meanPrecipExposure,
                      precipitationType,
                    )
                  : isWindFilter && route.meanWindExposure != null
                    ? exposureToWindCondition(route.meanWindExposure)
                    : isSunFilter && route.meanSunExposure != null
                      ? exposureToSunCondition(route.meanSunExposure)
                      : null;

              if (isCombined) {
                return (
                  <div className="space-y-2">
                    <RouteCard
                      variant="combined"
                      route={comfort}
                      percent={percentFor(comfort)}
                      verb={verb}
                      condition={conditionFor(comfort)}
                      explanation={null}
                      selected={comfortIdx === selectedRouteIdx}
                      onClick={() => onSelectRoute(comfortIdx)}
                      dayAccent={dayAccent}
                      filterMode={filterMode}
                    />
                    <p
                      className="px-2 py-1 text-center text-xs"
                      style={{
                        color: 'rgb(30, 120, 60)',
                        fontFamily: 'var(--font-data)',
                      }}
                    >
                      Great news — the fastest route is also the most
                      comfortable right now.
                    </p>
                    {others.length > 0 && (
                      <MoreOptionsSection
                        others={others}
                        expanded={showMoreOptions}
                        onToggle={() => setShowMoreOptions((v) => !v)}
                        selectedRouteIdx={selectedRouteIdx}
                        onSelectRoute={onSelectRoute}
                        percentFor={percentFor}
                        conditionFor={conditionFor}
                        verb={verb}
                        dayAccent={dayAccent}
                        filterMode={filterMode}
                      />
                    )}
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  <RouteCard
                    variant="fastest"
                    route={fastest}
                    percent={percentFor(fastest)}
                    verb={verb}
                    condition={conditionFor(fastest)}
                    explanation={null}
                    selected={fastestIdx === selectedRouteIdx}
                    onClick={() => onSelectRoute(fastestIdx)}
                    dayAccent={dayAccent}
                    filterMode={filterMode}
                  />
                  <ComparisonLine
                    timeDeltaMin={timeDeltaMin}
                    expDelta={expDelta}
                  />
                  <RouteCard
                    variant="gma"
                    route={comfort}
                    percent={percentFor(comfort)}
                    verb={verb}
                    condition={conditionFor(comfort)}
                    explanation={buildGmaExplanation(
                      timeDeltaMin,
                      expDelta,
                    )}
                    selected={comfortIdx === selectedRouteIdx}
                    onClick={() => onSelectRoute(comfortIdx)}
                    dayAccent={dayAccent}
                    filterMode={filterMode}
                  />
                  {others.length > 0 && (
                    <MoreOptionsSection
                      others={others}
                      expanded={showMoreOptions}
                      onToggle={() => setShowMoreOptions((v) => !v)}
                      selectedRouteIdx={selectedRouteIdx}
                      onSelectRoute={onSelectRoute}
                      percentFor={percentFor}
                      conditionFor={conditionFor}
                      verb={verb}
                      dayAccent={dayAccent}
                      filterMode={filterMode}
                    />
                  )}
                </div>
              );
            })()
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

type CardVariant = 'fastest' | 'gma' | 'combined' | 'other';

interface RouteCardProps {
  variant: CardVariant;
  route: ScoredRoute;
  percent: number;
  verb: string;
  /** Plain-English condition derived from meanSunExposure; null for non-sun filters. */
  condition: RouteCondition | null;
  /** One-line "+2 min · 40% less sun exposure" shown under GMA pick cards. */
  explanation: string | null;
  selected: boolean;
  onClick: () => void;
  dayAccent: string;
  filterMode: FilterMode;
}

const GMA_ACCENT = 'rgb(245, 158, 11)'; //         amber-500 (sun fallback)
const GMA_WIND_ACCENT = 'rgb(168, 85, 247)'; //    violet-500
const GMA_RAIN_ACCENT = 'rgb(6, 182, 212)'; //     cyan-500
const FASTEST_BADGE_BG = 'rgba(0, 0, 0, 0.06)';
const FASTEST_BADGE_FG = 'var(--gma-text-secondary)';

function gmaAccentFor(mode: FilterMode): string {
  if (mode === 'avoid-wind') return GMA_WIND_ACCENT;
  if (mode === 'avoid-rain') return GMA_RAIN_ACCENT;
  return GMA_ACCENT;
}

function RouteCard({
  variant,
  route,
  percent,
  verb,
  condition,
  explanation,
  selected,
  onClick,
  dayAccent,
  filterMode,
}: RouteCardProps) {
  const showFastestBadge = variant === 'fastest' || variant === 'combined';
  const showGmaBadge = variant === 'gma' || variant === 'combined';
  const gmaAccent = gmaAccentFor(filterMode);
  // GMA card variants get a left accent stripe to set them apart from
  // the clean white fastest card.
  const accentBorderLeft =
    variant === 'gma' || variant === 'combined' ? gmaAccent : 'transparent';
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
      className="flex min-h-[64px] w-full items-stretch gap-3 overflow-hidden rounded-xl border p-3 text-left transition-colors"
      style={
        selected
          ? {
              borderColor: dayAccent,
              background: 'rgba(255, 160, 0, 0.06)',
              boxShadow: `inset 0 0 0 1px ${dayAccent}, inset 4px 0 0 0 ${accentBorderLeft}`,
            }
          : {
              borderColor: 'var(--gma-border)',
              background:
                variant === 'gma' || variant === 'combined'
                  ? 'rgba(245, 158, 11, 0.04)'
                  : '#ffffff',
              boxShadow: `inset 4px 0 0 0 ${accentBorderLeft}`,
            }
      }
    >
      <div
        className="flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-full border-2"
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
        <div className="flex flex-wrap items-center gap-1.5">
          {showFastestBadge && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{
                background: FASTEST_BADGE_BG,
                color: FASTEST_BADGE_FG,
              }}
            >
              Fastest
            </span>
          )}
          {showGmaBadge && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{
                background: gmaAccent,
                color: '#ffffff',
              }}
            >
              <PickFilterIcon mode={filterMode} />
              GMA Pick
            </span>
          )}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-base text-[var(--gma-text-primary)]">
            {min} min
          </span>
        </div>
        <div className="mt-0.5 truncate text-xs text-[var(--gma-text-secondary)]">
          {km} km · {route.label}
        </div>
        {explanation && (
          <div
            className="mt-1 truncate text-xs"
            style={{
              color: gmaAccent,
              fontFamily: 'var(--font-data)',
            }}
          >
            {explanation}
          </div>
        )}
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

// ---------- comparison + delta helpers ----------------------------------

interface ExposureDelta {
  /** Percent reduction (positive = comfort has less exposure). */
  pct: number;
  /** "sun" / "wind" / "rain" / "sun + wind". */
  label: string;
  /** "less" for cooler filters; "more" for sunniest. */
  direction: 'less' | 'more';
}

function computeExposureDelta(
  fastest: ScoredRoute,
  comfort: ScoredRoute,
  filterMode: FilterMode,
): ExposureDelta | null {
  let f: number;
  let c: number;
  let label: string;
  let direction: 'less' | 'more' = 'less';

  if (filterMode === 'avoid-wind') {
    f = fastest.meanWindExposure ?? 0;
    c = comfort.meanWindExposure ?? 0;
    label = 'wind';
  } else if (filterMode === 'avoid-rain') {
    f = fastest.meanPrecipExposure ?? 0;
    c = comfort.meanPrecipExposure ?? 0;
    label = 'rain';
  } else if (filterMode === 'avoid-both') {
    const fSun = fastest.meanSunExposure ?? 0;
    const fWind = fastest.meanWindExposure ?? 0;
    const cSun = comfort.meanSunExposure ?? 0;
    const cWind = comfort.meanWindExposure ?? 0;
    f = (fSun + fWind) / 2;
    c = (cSun + cWind) / 2;
    label = 'sun + wind';
  } else if (filterMode === 'sunniest') {
    f = fastest.meanSunExposure ?? 0;
    c = comfort.meanSunExposure ?? 0;
    label = 'sun';
    direction = 'more';
  } else if (filterMode === 'no-preference') {
    return null;
  } else {
    // avoid-sun
    f = fastest.meanSunExposure ?? 0;
    c = comfort.meanSunExposure ?? 0;
    label = 'sun';
  }

  // Can't normalize when fastest has near-zero exposure.
  if (f < 0.01) return null;
  const rawDiff = direction === 'less' ? f - c : c - f;
  const pct = Math.round((rawDiff / f) * 100);
  if (pct < 5) return null; //   not a meaningful gap to advertise
  return { pct, label, direction };
}

function buildGmaExplanation(
  timeDeltaMin: number,
  expDelta: ExposureDelta | null,
): string | null {
  if (!expDelta) return null;
  const time = timeDeltaMin === 0 ? 'Same time' : `+${timeDeltaMin} min`;
  return `${time} · ${expDelta.pct}% ${expDelta.direction} ${expDelta.label} exposure`;
}

interface ComparisonLineProps {
  timeDeltaMin: number;
  expDelta: ExposureDelta | null;
}

function ComparisonLine({ timeDeltaMin, expDelta }: ComparisonLineProps) {
  if (!expDelta) return null;
  const timeWord =
    timeDeltaMin <= 0
      ? 'no extra time'
      : `${timeDeltaMin} minute${timeDeltaMin === 1 ? '' : 's'}`;
  return (
    <div
      className="mx-2 my-1 text-center text-xs"
      style={{
        color: 'var(--gma-text-secondary)',
        fontFamily: 'var(--font-data)',
      }}
    >
      Save {timeWord} OR save {expDelta.pct}% {expDelta.label} exposure — your
      choice.
    </div>
  );
}

interface MoreOptionsSectionProps {
  others: { route: ScoredRoute; idx: number }[];
  expanded: boolean;
  onToggle: () => void;
  selectedRouteIdx: number;
  onSelectRoute: (idx: number) => void;
  percentFor: (route: ScoredRoute) => number;
  conditionFor: (route: ScoredRoute) => RouteCondition | null;
  verb: string;
  dayAccent: string;
  filterMode: FilterMode;
}

function MoreOptionsSection({
  others,
  expanded,
  onToggle,
  selectedRouteIdx,
  onSelectRoute,
  percentFor,
  conditionFor,
  verb,
  dayAccent,
  filterMode,
}: MoreOptionsSectionProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-xs uppercase tracking-wider text-[var(--gma-text-secondary)] transition-colors hover:bg-black/[0.02]"
        style={{
          borderColor: 'var(--gma-border)',
          background: 'rgba(0, 0, 0, 0.02)',
        }}
        aria-expanded={expanded}
      >
        <span>
          {expanded
            ? 'Hide options'
            : `More options (${others.length})`}
        </span>
        <ChevronIcon open={expanded} />
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {others.map(({ route, idx }) => (
            <RouteCard
              key={`other-${idx}-${route.label}`}
              variant="other"
              route={route}
              percent={percentFor(route)}
              verb={verb}
              condition={conditionFor(route)}
              explanation={null}
              selected={idx === selectedRouteIdx}
              onClick={() => onSelectRoute(idx)}
              dayAccent={dayAccent}
              filterMode={filterMode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform 200ms',
      }}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PickFilterIcon({ mode }: { mode: FilterMode }) {
  if (mode === 'avoid-wind') return <WindLeafIcon />;
  if (mode === 'avoid-rain') return <PickRainIcon />;
  return <PickSunIcon />;
}

function PickSunIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none">
        <line x1="12" y1="2.5" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="21.5" y2="12" />
      </g>
    </svg>
  );
}

function WindLeafIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 8h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PickRainIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c-3.5 4.7-6 8.3-6 11.7 0 3.4 2.7 6.1 6 6.1s6-2.7 6-6.1c0-3.4-2.5-7-6-11.7z" />
    </svg>
  );
}

function SkeletonRouteCard() {
  // Subtle shimmering placeholder matching the RouteCard's 64 px min
  // height. Uses CSS animate-pulse so the demo feels responsive while
  // the Routes API + Solar API are still in flight.
  return (
    <div
      aria-hidden="true"
      className="flex min-h-[64px] w-full animate-pulse items-center gap-3 rounded-xl border p-3"
      style={{
        borderColor: 'var(--gma-border)',
        background: 'rgba(0, 0, 0, 0.02)',
      }}
    >
      <div
        className="h-5 w-5 shrink-0 rounded-full"
        style={{ background: 'rgba(0, 0, 0, 0.08)' }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div
          className="h-3.5 w-20 rounded"
          style={{ background: 'rgba(0, 0, 0, 0.10)' }}
        />
        <div
          className="h-3 w-36 rounded"
          style={{ background: 'rgba(0, 0, 0, 0.06)' }}
        />
      </div>
      <div
        className="h-6 w-16 shrink-0 rounded-full"
        style={{ background: 'rgba(0, 0, 0, 0.06)' }}
      />
    </div>
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
