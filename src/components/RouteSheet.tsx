import { useEffect, useRef, useState } from 'react';
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
  | 'sunny-spot'
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
  // Patio Gold Rush — caller wants the SUNNIEST possible patch along
  // the route so they can plant a coffee and read in direct sun.
  // Same negative glareAvoidance as 'sunniest' but stronger so the
  // sunny-spot ranking dominates ties decisively.
  'sunny-spot': {
    glareAvoidance: -1.5,
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
  'avoid-sun': { label: '☀️ Avoid Sun', verb: 'cooler', accent: 'sun' },
  'avoid-wind': { label: '🌬️ Avoid Wind', verb: 'calmer', accent: 'wind' },
  'avoid-both': { label: '🌳 Avoid Both', verb: 'gentler', accent: 'sun' },
  'avoid-rain': { label: '💧 Avoid Rain', verb: 'drier', accent: 'rain' },
  sunniest: { label: '🌞 Sunniest', verb: 'sunnier', accent: 'sun' },
  'sunny-spot': { label: '⭐ Sunny Spot', verb: 'warmer', accent: 'sun' },
  'no-preference': {
    label: 'No preference',
    verb: 'comfort',
    accent: 'neutral',
  },
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
  'sunny-spot',
  'no-preference',
];

/**
 * Maps the active filter pill to a sun direction the comfort-percent
 * helper understands. Sun-aware filters → exposure-derived absolute %.
 * Wind / no-preference → fall back to candidate-relative normalize.
 */
function filterToSunDirection(mode: FilterMode): SunComfortDirection {
  if (mode === 'avoid-sun' || mode === 'avoid-both') return 'cooler';
  if (mode === 'sunniest' || mode === 'sunny-spot') return 'sunnier';
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
  | 'glare-detected'
  | 'strong-headwind'
  | 'moderate-wind'
  | 'sheltered'
  | 'rain-exposed'
  | 'rain-sheltered'
  | 'snow-exposed'
  | 'snow-sheltered';

function exposureToSunCondition(exposure: number): RouteCondition {
  // > 1.0 only happens when the route passes through glass-glare segments,
  // which contribute exposure 1.5 — a regular all-sunny route caps at 1.0.
  if (exposure > 1.0) return 'glare-detected';
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
  'mostly-sunny': 'Full sun ☀️',
  'partly-shaded': 'Mixed sun & shade ⛅',
  'mostly-shaded': 'Shaded walk 🌳',
  'glare-detected': 'Glass glare zone 🔆',
  'strong-headwind': 'Strong headwind 🌬',
  'moderate-wind': 'Moderate wind',
  sheltered: 'Wind sheltered',
  'rain-exposed': 'Rain exposed 💧',
  'rain-sheltered': 'Rain sheltered',
  'snow-exposed': 'Snow exposed ❄',
  'snow-sheltered': 'Snow sheltered',
};

const CONDITION_COLOR: Record<RouteCondition, string> = {
  'mostly-sunny': 'rgb(234, 88, 12)', //   amber-orange — uncomfortable
  'partly-shaded': 'rgb(180, 130, 20)', // muted gold
  'mostly-shaded': 'rgb(5, 150, 105)', //  green — comfortable
  'glare-detected': 'rgb(220, 38, 38)', // red-600 — danger
  'strong-headwind': 'rgb(168, 85, 247)', // violet-500 — windy
  'moderate-wind': 'rgb(180, 130, 20)', //  muted gold — middle
  sheltered: 'rgb(5, 150, 105)', //         green — comfortable
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
  isLoading: boolean;
  /** Live time-of-day color used for sun-accent filter pills + Start button. */
  dayColor: RGB;
  /**
   * Live precipitation probability 0..100. Drives whether the
   * "Avoid Rain" filter pill is rendered (only at > 20 %).
   */
  precipitationProbability: number;
  /** Rain vs snow vs none — switches the condition chip label + color. */
  precipitationType: PrecipitationType;
  /**
   * Live wind speed in mph. Feeds the wind-mode feels-like badges
   * (`~6 mph headwind`) and the wind delta on the GMA comparison line.
   * 0 → "Calm" label across the wind filter.
   */
  windSpeedMph: number;
  /**
   * Live solar elevation in degrees above horizon. ≤ 0 means the sun
   * is below the horizon — every comfort badge for sun-aware filters
   * switches to "No sun exposure · Night routing" and the
   * fastest-vs-comfort temperature delta is suppressed, since at
   * night every route is thermally identical.
   */
  sunElevationDeg: number;
  /**
   * Embedded route-color legend rendered between the drag handle and
   * the filter pills. Replaces the previous floating RouteLegend
   * pill that overlapped the map. Null hides the strip.
   */
  legendMode?: 'sun' | 'wind' | 'rain';
  legendSnow?: boolean;
  /**
   * Desktop sidebar mode. When true, the sheet renders as a normal
   * flex-column child of the sidebar — no absolute positioning, no
   * fixed height, no rounded-top corners, no bottom scroll padding
   * (the sibling embedded Start button uses the sidebar's natural
   * bottom edge instead of overlapping the scroll area).
   */
  embedded?: boolean;
  /**
   * Shaded/sunny/glare breakdown of the SELECTED route only — only
   * the chosen route has its colored segments computed at the App
   * level, so the bar shows only on the selected card.
   */
  selectedRouteBreakdown?: SegmentBreakdown | null;
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
  isLoading,
  dayColor,
  precipitationProbability,
  precipitationType,
  windSpeedMph,
  sunElevationDeg,
  legendMode,
  legendSnow = false,
  embedded = false,
  selectedRouteBreakdown = null,
}: RouteSheetProps) {
  const dayAccent = `rgb(${dayColor[0]}, ${dayColor[1]}, ${dayColor[2]})`;
  const sunDirection = filterToSunDirection(filterMode);
  const isSunFilter =
    filterMode === 'avoid-sun' || filterMode === 'avoid-both';
  const isWindFilter = filterMode === 'avoid-wind';
  const isRainFilter = filterMode === 'avoid-rain';
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  // Auto-expand More Options whenever the selected route lives inside
  // it. Without this, the demo's filter cycle (or any manual selection
  // of route 2+) can leave the selected card hidden under a collapsed
  // expander, leaving the viewer unsure which option was chosen.
  // routes[0] = comfort (GMA pick); the index with min durationSeconds
  // = fastest; anything else = inside More Options.
  useEffect(() => {
    if (routes.length === 0) return;
    const fastestIdx = routes.reduce(
      (minIdx, r, i, arr) =>
        r.durationSeconds < arr[minIdx]!.durationSeconds ? i : minIdx,
      0,
    );
    const comfortIdx = 0;
    const selectedIsInOthers =
      selectedRouteIdx !== fastestIdx && selectedRouteIdx !== comfortIdx;
    if (selectedIsInOthers) setShowMoreOptions(true);
  }, [selectedRouteIdx, routes]);

  // Hide the Avoid Rain pill when probability is too low to matter.
  // (We still keep it visible if the user already selected it — pulling
  // a pill out from under them mid-session would be confusing.)
  const visibleFilters = ORDERED_FILTERS.filter(
    (m) =>
      m !== 'avoid-rain' ||
      precipitationProbability >= RAIN_PILL_MIN_PROBABILITY ||
      filterMode === 'avoid-rain',
  );

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

  // Conditional shell — `embedded` switches between the mobile
  // bottom-sheet (absolute, 50 vh, rounded top corners only) and the
  // desktop sidebar mode (regular flex child of the sidebar column,
  // no positioning, no rounded corners since it stacks between the
  // top form pills and the bottom Start button).
  const shellClass = embedded
    ? 'gma-card pointer-events-auto flex w-full min-h-0 flex-1 flex-col overflow-hidden border-0 bg-transparent'
    : 'gma-card pointer-events-auto absolute bottom-0 left-1/2 z-30 flex h-[50vh] max-h-[50vh] w-[min(440px,100vw)] -translate-x-1/2 flex-col rounded-t-2xl sm:h-auto sm:max-h-[min(75vh,75dvh)]';

  return (
    <div
      className={shellClass}
      style={{
        boxShadow: embedded ? 'none' : 'var(--gma-shadow-lg)',
        borderBottom: 'none',
      }}
      role="dialog"
      aria-label="Route options"
    >
      {!embedded && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close routes"
          className="gma-press absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full text-[var(--gma-text-secondary)] hover:bg-[var(--gma-hover-bg)] hover:text-[var(--gma-text-primary)]"
        >
          <CloseIcon />
        </button>
      )}

      {!embedded && (
        <div
          className="mx-auto my-2 h-1 w-10 shrink-0 rounded-full"
          style={{ background: 'var(--gma-border-strong)' }}
        />
      )}

      {legendMode && (
        <InlineRouteLegend mode={legendMode} snow={legendSnow} />
      )}

      {/* Filter pill row wrapper — `relative` to anchor the
       * right-edge gradient fade that hints at horizontal
       * overflow. The fade pseudo-element is rendered as a
       * sibling absolute div so it doesn't intercept taps on
       * the pills underneath. */}
      <div className="relative shrink-0">
        <div
          className={
            'flex gap-1.5 overflow-x-auto pb-3 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] ' +
            (embedded ? 'px-4' : 'pl-4 pr-16')
          }
        >
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
            <FilterPill
              key={mode}
              active={active}
              accent={accent}
              label={meta.label}
              onClick={() => onFilterChange(mode)}
            />
          );
        })}
        </div>
        {/* Right-edge gradient fade — pointer-events-none so taps
         * pass through to the pills underneath. Hints that the
         * row scrolls when there are more pills than fit. */}
        <div
          className="pointer-events-none absolute bottom-0 right-0 top-0 w-10"
          style={{
            background:
              'linear-gradient(to right, color-mix(in srgb, var(--gma-surface) 0%, transparent) 0%, var(--gma-surface) 100%)',
          }}
          aria-hidden="true"
        />
      </div>

      {/* Conversational input was removed in the 2026-06-08 chat-panel
       * pass — natural-language routing now lives in the AIChatPanel
       * floating bottom-right of the map. RouteSheet stays focused on
       * filter pills + route cards + Start. */}

      <div
        className="flex-1 overflow-y-auto"
        // Mobile: 120 px bottom padding so the trailing "More options"
        // disclosure can scroll above the floating Start strip
        // (occupies viewport pixels 56–136 from the bottom).
        // Embedded (desktop sidebar): the sibling Start button is a
        // normal flex item below the scroll area, so no padding needed.
        style={{ paddingBottom: embedded ? '12px' : '120px' }}
      >
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
              const delta = computeFeelsLikeDelta(
                fastest,
                comfort,
                filterMode,
                windSpeedMph,
                sunElevationDeg,
              );
              // Silence the now-unused relative percent helpers when
              // building feels-like badges — kept around for future
              // a11y disclosure / debug surface but not the visible UI.
              void isRainFilter;
              void routeComfortPercent;
              void routeRainComfortPercent;
              void routeWindComfortPercent;
              void sunDirection;

              const getComfortBadge = (route: ScoredRoute): ComfortBadge | null =>
                comfortBadgeFor(route, filterMode, windSpeedMph, sunElevationDeg);

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
                      comfortBadge={getComfortBadge(comfort)}
                      condition={conditionFor(comfort)}
                      explanation={null}
                      selected={comfortIdx === selectedRouteIdx}
                      onClick={() => onSelectRoute(comfortIdx)}
                      dayAccent={dayAccent}
                      filterMode={filterMode}
                      breakdown={selectedRouteBreakdown}
                    />
                    <p
                      className="px-2 py-1 text-center text-xs"
                      style={{
                        color: 'rgb(5, 150, 105)',
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
                        comfortBadgeFor={getComfortBadge}
                        conditionFor={conditionFor}
                        dayAccent={dayAccent}
                        filterMode={filterMode}
                        selectedRouteBreakdown={selectedRouteBreakdown}
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
                    comfortBadge={getComfortBadge(fastest)}
                    condition={conditionFor(fastest)}
                    explanation={null}
                    selected={fastestIdx === selectedRouteIdx}
                    onClick={() => onSelectRoute(fastestIdx)}
                    dayAccent={dayAccent}
                    filterMode={filterMode}
                    breakdown={selectedRouteBreakdown}
                  />
                  <ComparisonLine
                    timeDeltaMin={timeDeltaMin}
                    delta={delta}
                  />
                  <RouteCard
                    variant="gma"
                    route={comfort}
                    comfortBadge={getComfortBadge(comfort)}
                    condition={conditionFor(comfort)}
                    explanation={buildGmaExplanation(timeDeltaMin, delta)}
                    selected={comfortIdx === selectedRouteIdx}
                    onClick={() => onSelectRoute(comfortIdx)}
                    dayAccent={dayAccent}
                    filterMode={filterMode}
                    breakdown={selectedRouteBreakdown}
                  />
                  {others.length > 0 && (
                    <MoreOptionsSection
                      others={others}
                      expanded={showMoreOptions}
                      onToggle={() => setShowMoreOptions((v) => !v)}
                      selectedRouteIdx={selectedRouteIdx}
                      onSelectRoute={onSelectRoute}
                      comfortBadgeFor={getComfortBadge}
                      conditionFor={conditionFor}
                      dayAccent={dayAccent}
                      filterMode={filterMode}
                      selectedRouteBreakdown={selectedRouteBreakdown}
                    />
                  )}
                </div>
              );
            })()
          )}
        </div>
      </div>

      {/* Start button used to live here. Lifted to a fixed-position
       * <StartButton> in App.tsx (z-100) so it stays visible at the
       * bottom of the viewport regardless of sheet height / phone size.
       * The scrollable routes list above gets extra bottom padding so
       * the last card can be scrolled into view above the floating
       * Start button — see `pb-[96px]` on the overflow container. */}
    </div>
  );
}

// ---------- RouteCard ----------------------------------------------------

type CardVariant = 'fastest' | 'gma' | 'combined' | 'other';

interface RouteCardProps {
  variant: CardVariant;
  route: ScoredRoute;
  /** Feels-like comfort summary shown in the right column. Null hides the badge. */
  comfortBadge: ComfortBadge | null;
  /** Plain-English condition derived from meanSunExposure; null for non-sun filters. */
  condition: RouteCondition | null;
  /** One-line "+2 min · Feels ~6°F cooler" shown under GMA pick cards. */
  explanation: string | null;
  selected: boolean;
  onClick: () => void;
  dayAccent: string;
  filterMode: FilterMode;
  /**
   * Per-route shaded/sunny/glare breakdown rendered as a slim
   * three-color bar at the bottom of the card. Only the SELECTED
   * route knows its colored segments at the App.tsx level, so this
   * is null for other cards — they just don't show the bar.
   */
  breakdown?: SegmentBreakdown | null;
}

export interface SegmentBreakdown {
  shadedPct: number; // building shadow + tree canopy + low-sun-angle
  sunnyPct: number; // direct sun
  glarePct: number; // glass-glare segments
}

const GMA_ACCENT = 'rgb(245, 158, 11)'; //         amber-500 (sun fallback)
const GMA_WIND_ACCENT = 'rgb(168, 85, 247)'; //    violet-500
const GMA_RAIN_ACCENT = 'rgb(6, 182, 212)'; //     cyan-500
const FASTEST_BADGE_BG = 'var(--gma-hover-bg)';
const FASTEST_BADGE_FG = 'var(--gma-text-secondary)';

function gmaPickGradient(accent: string): string {
  return `linear-gradient(135deg, ${accent} 0%, color-mix(in srgb, ${accent} 80%, #92400e) 100%)`;
}

function gmaAccentFor(mode: FilterMode): string {
  if (mode === 'avoid-wind') return GMA_WIND_ACCENT;
  if (mode === 'avoid-rain') return GMA_RAIN_ACCENT;
  return GMA_ACCENT;
}

function RouteCard({
  variant,
  route,
  comfortBadge,
  condition,
  explanation,
  selected,
  onClick,
  dayAccent,
  filterMode,
  breakdown,
}: RouteCardProps) {
  // Scroll the card into view whenever it becomes the selected one.
  // Required for the demo's filter-cycle beats and any manual
  // selection where the chosen card may be below the sidebar fold
  // (a 3-route ranking can push the GMA Pick off-screen on short
  // viewports). `block: 'nearest'` keeps the scroll minimal so cards
  // already in view don't jolt.
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!selected || !buttonRef.current) return;
    buttonRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [selected]);

  const showFastestBadge = variant === 'fastest' || variant === 'combined';
  const showGmaBadge = variant === 'gma' || variant === 'combined';
  const gmaAccent = gmaAccentFor(filterMode);
  // GMA card variants get a left accent stripe to set them apart from
  // the clean white fastest card.
  const accentBorderLeft =
    variant === 'gma' || variant === 'combined' ? gmaAccent : 'transparent';
  const km = (route.distanceMeters / 1000).toFixed(2);
  const min = Math.max(1, Math.round(route.durationSeconds / 60));

  // Night-routing card override — when sun's below horizon, every
  // sun-aware filter collapses to the same "no thermal differentiation"
  // state. Instead of leaving the card looking broken (grey badge on
  // white card), flip the whole card to slate-900 + white text so the
  // night-routing posture reads as intentional. Selected state still
  // shows the dayAccent ring.
  const isNight = !!comfortBadge?.nightRouting;

  // Card body style — three branches: night, selected, default.
  let cardStyle: React.CSSProperties;
  if (isNight) {
    cardStyle = {
      borderColor: selected ? dayAccent : 'rgb(30, 41, 59)',
      background: 'rgb(15, 23, 42)', // slate-900
      boxShadow: selected
        ? `inset 0 0 0 1px ${dayAccent}, inset 4px 0 0 0 rgb(5, 150, 105)`
        : 'inset 4px 0 0 0 rgb(5, 150, 105)', // emerald-600 left accent
      color: 'rgba(255, 255, 255, 0.92)',
    };
  } else if (selected) {
    cardStyle = {
      borderColor: dayAccent,
      background:
        'color-mix(in srgb, var(--gma-surface) 80%, ' + dayAccent + ' 20%)',
      boxShadow: `inset 0 0 0 1px ${dayAccent}, inset 4px 0 0 0 ${accentBorderLeft}`,
    };
  } else {
    cardStyle = {
      borderColor: 'var(--gma-border)',
      backgroundImage:
        variant === 'gma' || variant === 'combined'
          ? `linear-gradient(180deg, color-mix(in srgb, var(--gma-surface) 90%, ${gmaAccent} 10%) 0%, var(--gma-surface) 100%)`
          : 'linear-gradient(180deg, color-mix(in srgb, var(--gma-surface) 96%, transparent) 0%, var(--gma-surface) 100%)',
      boxShadow: `inset 4px 0 0 0 ${accentBorderLeft}`,
    };
  }

  // Night palette overrides for inner text + the Fastest pill.
  const titleColor = isNight ? 'rgba(255, 255, 255, 0.95)' : 'var(--gma-text-primary)';
  const subColor = isNight
    ? 'rgba(255, 255, 255, 0.70)'
    : 'var(--gma-text-secondary)';
  const fastestBadgeBg = isNight ? 'rgba(255, 255, 255, 0.08)' : FASTEST_BADGE_BG;
  const fastestBadgeFg = isNight ? 'rgba(255, 255, 255, 0.80)' : FASTEST_BADGE_FG;

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="gma-lift flex min-h-[72px] w-full items-stretch gap-3 overflow-hidden rounded-xl border p-4 text-left"
      style={cardStyle}
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
                background: fastestBadgeBg,
                color: fastestBadgeFg,
              }}
            >
              Fastest
            </span>
          )}
          {showGmaBadge && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{
                backgroundImage: gmaPickGradient(gmaAccent),
                backgroundColor: gmaAccent,
                color: 'var(--gma-text-on-accent)',
                boxShadow: 'var(--gma-glow-amber)',
              }}
            >
              <PickFilterIcon mode={filterMode} />
              GMA Pick
            </span>
          )}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span
            className="text-lg font-semibold"
            style={{ color: titleColor, letterSpacing: '-0.01em' }}
          >
            {min} min
          </span>
        </div>
        <div
          className="mt-0.5 truncate text-sm"
          style={{ color: subColor }}
        >
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
        {/* Breakdown bar only on the selected card — only the chosen
         * route has its colored segments computed at the App level,
         * so the other cards leave the slot empty. */}
        {breakdown && selected && (
          <SegmentBreakdownBar breakdown={breakdown} />
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1 self-center">
        {comfortBadge && (
          <span
            // Larger + heavier than the previous text-sm semibold so
            // the comfort delta (e.g. "~4°F cooler") reads as the
            // primary signal on each route card.
            className="whitespace-nowrap text-base font-bold"
            style={{
              color: comfortBadge.color,
              fontFamily: 'var(--font-data)',
              letterSpacing: '-0.01em',
            }}
          >
            {comfortBadge.text}
          </span>
        )}
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

// ---------- FilterPill -------------------------------------------------
// Single filter pill in the horizontal scroll row. Wraps the button in a
// component so it can hold its own ref + useEffect — when the pill
// becomes `active` it scrolls itself into view in the overflow-x parent.
// Required for the demo's filter-cycle beats (avoid-sun → avoid-wind →
// sunny-spot → avoid-both → avoid-sun), where the active pill could
// otherwise sit off the right edge and leave the viewer unsure which
// filter is selected.
interface FilterPillProps {
  active: boolean;
  accent: string;
  label: string;
  onClick: () => void;
}

function FilterPill({ active, accent, label, onClick }: FilterPillProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    ref.current.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="gma-press inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border px-5 text-sm font-medium"
      style={
        active
          ? {
              background: accent,
              borderColor: 'transparent',
              color: 'var(--gma-text-on-accent)',
              boxShadow: 'var(--gma-glow-amber)',
            }
          : {
              background: 'var(--gma-surface)',
              borderColor: 'rgba(15, 23, 42, 0.10)',
              color: 'rgb(51, 65, 85)', // slate-700
            }
      }
    >
      {label}
    </button>
  );
}

// ---------- "feels like" comfort display helpers -----------------------
//
// Replaces the abstract `67% COOLER` badge with human-readable feels-like
// text per PROJECT.md §1 (glass-glare claim of up to +15°F felt
// temperature). Sun routes report `~X°F cooler` / `~X°F warmer`; wind
// routes report avoided headwind in mph; rain routes report a verbal
// shelter state. All three keep their qualitative condition chip below
// the quantitative badge.

const MAX_FEELS_LIKE_DELTA_F = 15;

interface ComfortBadge {
  /** Primary line — e.g. "~8°F cooler" or "Wind sheltered". */
  text: string;
  /** Right-column text color — green for comfort, red for discomfort. */
  color: string;
  /**
   * Flips the rendering of the *whole* card to a dark slate-900
   * background + white text + emerald moon icon. Used when the sun
   * is below the horizon and every sun-aware filter collapses to
   * the same "no thermal differentiation" message — the dark card
   * communicates the night-routing state visually instead of just
   * via the chip text.
   */
  nightRouting?: boolean;
}

function comfortBadgeFor(
  route: ScoredRoute,
  filterMode: FilterMode,
  windSpeedMph: number,
  sunElevationDeg: number,
): ComfortBadge | null {
  // Night routing — short-circuit every sun-aware filter (and the
  // sun-only "no preference" default). Wind / rain filters still
  // surface real signal because they don't depend on the sun.
  const isNight = sunElevationDeg <= 0;
  const isSunAware =
    filterMode === 'avoid-sun' ||
    filterMode === 'avoid-both' ||
    filterMode === 'sunniest' ||
    filterMode === 'sunny-spot' ||
    filterMode === 'no-preference';
  if (isNight && isSunAware) {
    return {
      text: '🌙 Night routing',
      color: 'rgba(255, 255, 255, 0.92)',
      nightRouting: true,
    };
  }
  // Wind filter — show mph avoided / wind state.
  if (filterMode === 'avoid-wind') {
    if (windSpeedMph < 3) {
      return { text: 'Calm', color: 'rgb(5, 150, 105)' };
    }
    const exposure = route.meanWindExposure ?? 0;
    if (exposure < 0.3) {
      return { text: 'Wind sheltered', color: 'rgb(5, 150, 105)' };
    }
    const mph = Math.round(exposure * windSpeedMph);
    return {
      text: `~${mph} mph headwind`,
      color: 'rgb(168, 85, 247)',
    };
  }

  // Rain filter — verbal only, no temp delta.
  if (filterMode === 'avoid-rain') {
    const exposure = route.meanPrecipExposure ?? 0;
    if (exposure < 0.3) {
      return { text: 'Rain sheltered 💧', color: 'rgb(6, 182, 212)' };
    }
    return { text: 'Less rain exposure', color: 'rgb(71, 85, 105)' };
  }

  // Sun, sunniest, sunny-spot, both, no-preference — feels-like
  // temp delta. Glare segments push exposure above 1.0 and amplify
  // the heat felt.
  const exposure = route.meanSunExposure ?? 0;
  // Patio Gold Rush — caller wants warmth + a place to sit. Same
  // numeric delta as 'sunniest' (~X°F warmer) but appended with the
  // outdoor-seating callout. Below 1°F warmer we still surface the
  // seating phrase so the user knows the route delivers on the
  // promise of finding sunny spots even on a cool route.
  if (filterMode === 'sunny-spot') {
    const warmer = Math.round(
      Math.min(1, exposure) * MAX_FEELS_LIKE_DELTA_F,
    );
    const tempPart =
      warmer >= 1 ? `~${Math.abs(warmer)}°F warmer · ` : '';
    return {
      text: `${tempPart}Perfect for outdoor seating`,
      color: 'rgb(234, 88, 12)',
    };
  }
  if (filterMode === 'sunniest') {
    const warmer = Math.round(
      Math.min(1, exposure) * MAX_FEELS_LIKE_DELTA_F,
    );
    if (warmer < 1) {
      return { text: 'Same temp', color: 'var(--gma-text-secondary)' };
    }
    return {
      // Math.abs is defensive — the `if (warmer < 1)` early return
      // above already filters non-positives, but if upstream math
      // ever lets a negative slip through, we still render an
      // unsigned magnitude rather than "~-X°F".
      text: `~${Math.abs(warmer)}°F warmer`,
      color: 'rgb(234, 88, 12)',
    };
  }
  // Glare → red "hotter" badge (worse than direct sun).
  if (exposure > 1.0) {
    const hotter = Math.round(
      Math.min(1.5, exposure) * MAX_FEELS_LIKE_DELTA_F,
    );
    return {
      text: `~${Math.abs(hotter)}°F hotter`,
      color: 'rgb(220, 38, 38)',
    };
  }
  const cooler = Math.round((1 - exposure) * MAX_FEELS_LIKE_DELTA_F);
  if (cooler < 1) {
    return { text: 'Full sun', color: 'rgb(234, 88, 12)' };
  }
  return {
    text: `~${Math.abs(cooler)}°F cooler`,
    color: 'rgb(5, 150, 105)',
  };
}

// ---------- comparison + delta helpers ----------------------------------

/**
 * Feels-like delta between the fastest and comfort routes — formatted
 * for the comparison line and the GMA-pick explanation line. Returns
 * null when there's no meaningful gap (no-preference filter, sub-1°F
 * temp delta, sub-1 mph wind savings, etc).
 */
interface FeelsLikeDelta {
  /** Human-readable savings phrase: "~6°F cooler" / "~4 mph less headwind" / "less rain exposure". */
  phrase: string;
  /** Short version for the GMA explanation under the card: same phrasing minus the OR. */
  shortPhrase: string;
}

function computeFeelsLikeDelta(
  fastest: ScoredRoute,
  comfort: ScoredRoute,
  filterMode: FilterMode,
  windSpeedMph: number,
  sunElevationDeg: number,
): FeelsLikeDelta | null {
  if (filterMode === 'no-preference') return null;

  // Night routing — sun-aware comparisons are meaningless when the
  // sun is below horizon (every route has identical zero sun exposure
  // by definition). Return null so the comparison line + GMA-pick
  // explanation suppress entirely; the wind branch below still fires
  // for night wind shelter, which is real.
  const isNight = sunElevationDeg <= 0;
  const isSunAware =
    filterMode === 'avoid-sun' ||
    filterMode === 'avoid-both' ||
    filterMode === 'sunniest' ||
    filterMode === 'sunny-spot';
  if (isNight && isSunAware) return null;

  // Wind: mph of headwind avoided. Needs current wind speed; below
  // 3 mph the delta is too small to advertise.
  if (filterMode === 'avoid-wind') {
    if (windSpeedMph < 3) return null;
    const f = fastest.meanWindExposure ?? 0;
    const c = comfort.meanWindExposure ?? 0;
    const mph = Math.round((f - c) * windSpeedMph);
    if (mph < 1) return null;
    return {
      phrase: `avoid ~${mph} mph headwind`,
      shortPhrase: `Avoids ~${mph} mph headwind`,
    };
  }

  // Rain: verbal only — no temp/wind delta makes sense here.
  if (filterMode === 'avoid-rain') {
    const f = fastest.meanPrecipExposure ?? 0;
    const c = comfort.meanPrecipExposure ?? 0;
    if (f - c < 0.1) return null;
    return {
      phrase: 'less rain exposure',
      shortPhrase: 'Less rain exposure',
    };
  }

  // Sun / sunniest / both — feels-like temperature delta.
  // Glare segments push exposure above 1, amplifying the felt heat.
  const fSun = Math.max(0, Math.min(1.5, fastest.meanSunExposure ?? 0));
  const cSun = Math.max(0, Math.min(1.5, comfort.meanSunExposure ?? 0));
  const direction =
    filterMode === 'sunniest' || filterMode === 'sunny-spot'
      ? ('warmer' as const)
      : ('cooler' as const);
  const raw =
    direction === 'cooler'
      ? (fSun - cSun) * MAX_FEELS_LIKE_DELTA_F
      : (cSun - fSun) * MAX_FEELS_LIKE_DELTA_F;
  const degrees = Math.round(raw);
  if (degrees < 1) return null;
  return {
    phrase: `feel ~${Math.abs(degrees)}°F ${direction}`,
    shortPhrase: `Feels ~${Math.abs(degrees)}°F ${direction}`,
  };
}

function buildGmaExplanation(
  timeDeltaMin: number,
  delta: FeelsLikeDelta | null,
): string | null {
  if (!delta) return null;
  const time = timeDeltaMin === 0 ? 'Same time' : `+${timeDeltaMin} min`;
  return `${time} · ${delta.shortPhrase}`;
}

interface ComparisonLineProps {
  timeDeltaMin: number;
  delta: FeelsLikeDelta | null;
}

function ComparisonLine({ timeDeltaMin, delta }: ComparisonLineProps) {
  if (!delta) return null;
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
      Save {timeWord} OR {delta.phrase} — your choice.
    </div>
  );
}

interface MoreOptionsSectionProps {
  others: { route: ScoredRoute; idx: number }[];
  expanded: boolean;
  onToggle: () => void;
  selectedRouteIdx: number;
  onSelectRoute: (idx: number) => void;
  comfortBadgeFor: (route: ScoredRoute) => ComfortBadge | null;
  conditionFor: (route: ScoredRoute) => RouteCondition | null;
  dayAccent: string;
  filterMode: FilterMode;
  selectedRouteBreakdown: SegmentBreakdown | null;
}

function MoreOptionsSection({
  others,
  expanded,
  onToggle,
  selectedRouteIdx,
  onSelectRoute,
  comfortBadgeFor: getComfortBadge,
  conditionFor,
  dayAccent,
  filterMode,
  selectedRouteBreakdown,
}: MoreOptionsSectionProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="gma-press flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-xs uppercase tracking-wider text-[var(--gma-text-secondary)] hover:bg-[var(--gma-hover-bg)]"
        style={{
          borderColor: 'var(--gma-border)',
          background: 'var(--gma-input-bg)',
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
              comfortBadge={getComfortBadge(route)}
              condition={conditionFor(route)}
              explanation={null}
              selected={idx === selectedRouteIdx}
              onClick={() => onSelectRoute(idx)}
              dayAccent={dayAccent}
              filterMode={filterMode}
              breakdown={selectedRouteBreakdown}
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

interface InlineRouteLegendProps {
  mode: 'sun' | 'wind' | 'rain';
  snow: boolean;
}

/**
 * Embedded legend strip that lives inside the route sheet — replaces
 * the previous floating RouteLegend pill which overlapped the map.
 * Shape + gradient palette match the floating version verbatim so the
 * color↔condition mapping reads the same.
 */
function SegmentBreakdownBar({ breakdown }: { breakdown: SegmentBreakdown }) {
  // Round each bucket but force the total to display as 100 % by
  // absorbing any rounding remainder into the biggest bucket.
  const raw = [breakdown.shadedPct, breakdown.sunnyPct, breakdown.glarePct];
  const rounded = raw.map((v) => Math.round(v));
  const drift = rounded.reduce((a, b) => a + b, 0) - 100;
  if (drift !== 0) {
    let biggestIdx = 0;
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i]! > rounded[biggestIdx]!) biggestIdx = i;
    }
    rounded[biggestIdx]! -= drift;
  }
  const [sh, su, gl] = rounded;

  return (
    <div className="mt-2">
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--gma-input-bg)' }}
        aria-label={`${sh}% shaded, ${su}% sunny, ${gl}% glass glare`}
      >
        {sh > 0 && (
          <span
            style={{
              width: `${sh}%`,
              background: 'rgb(59, 130, 246)',
            }}
          />
        )}
        {su > 0 && (
          <span
            style={{
              width: `${su}%`,
              background: 'rgb(245, 158, 11)',
            }}
          />
        )}
        {gl > 0 && (
          <span
            style={{
              width: `${gl}%`,
              background: 'rgb(220, 38, 38)',
            }}
          />
        )}
      </div>
      <div
        className="mt-1 text-[11px] font-medium"
        style={{
          // slate-600 instead of the lighter secondary token so
          // the percentages stay legible on the gradient card
          // background and at small font size.
          color: 'rgb(71, 85, 105)',
          fontFamily: 'var(--font-data)',
        }}
      >
        {sh}% shaded · {su}% sunny{gl > 0 ? ` · ${gl}% glass glare` : ''}
      </div>
    </div>
  );
}

function InlineRouteLegend({ mode, snow }: InlineRouteLegendProps) {
  const variant = pickLegendVariant(mode, snow);
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mx-4 mb-2 shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={variant.ariaLabel}
        className="flex w-full items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[var(--gma-text-secondary)]"
        style={{
          borderColor: 'var(--gma-border)',
          background: 'var(--gma-input-bg)',
          fontFamily: 'var(--font-data)',
        }}
      >
        <span>Route colors</span>
        <LegendChevron open={expanded} />
      </button>
      {expanded && (
        <div className="mt-1.5 flex items-center gap-2 px-3">
          <span
            className="text-[10px] uppercase tracking-[0.16em]"
            style={{
              color: variant.leftColor,
              fontFamily: 'var(--font-data)',
            }}
          >
            {variant.leftLabel}
          </span>
          <span
            className="block h-2 flex-1 rounded-full"
            style={{ background: variant.gradient }}
            aria-hidden="true"
          />
          <span
            className="text-[10px] uppercase tracking-[0.16em]"
            style={{
              color: variant.rightColor,
              fontFamily: 'var(--font-data)',
            }}
          >
            {variant.rightLabel}
          </span>
        </div>
      )}
    </div>
  );
}

function LegendChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
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

interface LegendVariant {
  leftLabel: string;
  rightLabel: string;
  leftColor: string;
  rightColor: string;
  gradient: string;
  ariaLabel: string;
}

function pickLegendVariant(
  mode: 'sun' | 'wind' | 'rain',
  snow: boolean,
): LegendVariant {
  if (mode === 'wind') {
    return {
      leftLabel: 'Sheltered',
      rightLabel: 'Windy',
      leftColor: 'rgb(16, 185, 129)',
      rightColor: 'rgb(168, 85, 247)',
      gradient:
        'linear-gradient(to right, rgb(16, 185, 129), rgb(120, 130, 200), rgb(168, 85, 247))',
      ariaLabel: 'Route wind-exposure legend',
    };
  }
  if (mode === 'rain') {
    if (snow) {
      return {
        leftLabel: 'Sheltered',
        rightLabel: 'Snowy',
        leftColor: 'rgb(99, 158, 235)',
        rightColor: 'rgb(30, 58, 138)',
        gradient:
          'linear-gradient(to right, rgb(186, 230, 253), rgb(99, 158, 235), rgb(30, 58, 138))',
        ariaLabel: 'Route snow-exposure legend',
      };
    }
    return {
      leftLabel: 'Sheltered',
      rightLabel: 'Wet',
      leftColor: 'rgb(6, 182, 212)',
      rightColor: 'rgb(71, 85, 105)',
      gradient:
        'linear-gradient(to right, rgb(6, 182, 212), rgb(80, 130, 160), rgb(71, 85, 105))',
      ariaLabel: 'Route rain-exposure legend',
    };
  }
  return {
    leftLabel: 'Shaded',
    rightLabel: 'Sunny',
    leftColor: 'rgb(40, 60, 140)',
    rightColor: 'rgb(220, 130, 0)',
    gradient:
      'linear-gradient(to right, rgb(40, 60, 140), rgb(85, 130, 195), rgb(220, 175, 90), rgb(255, 160, 0))',
    ariaLabel: 'Route sun-exposure legend',
  };
}

function SkeletonRouteCard() {
  // Shimmering placeholder matching the RouteCard's 64 px min height.
  // Uses `.gma-shimmer` so the bar sweeps left-to-right across each
  // placeholder block, reading like a Skeleton in both light + dark.
  return (
    <div
      aria-hidden="true"
      className="flex min-h-[64px] w-full items-center gap-3 rounded-xl border p-3"
      style={{
        borderColor: 'var(--gma-border)',
        background: 'var(--gma-input-bg)',
      }}
    >
      <div
        className="gma-shimmer h-5 w-5 shrink-0 rounded-full"
        style={{ background: 'var(--gma-hover-bg)' }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div
          className="gma-shimmer h-3.5 w-20 rounded"
          style={{ background: 'var(--gma-hover-bg)' }}
        />
        <div
          className="gma-shimmer h-3 w-36 rounded"
          style={{ background: 'var(--gma-hover-bg)' }}
        />
      </div>
      <div
        className="gma-shimmer h-6 w-16 shrink-0 rounded-full"
        style={{ background: 'var(--gma-hover-bg)' }}
      />
    </div>
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
