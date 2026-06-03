// HLCI-aware comfort routing.
//
// Split into two functions on purpose:
//
//   fetchCandidateRoutes(origin, dest, apiKey)
//     -> CandidateRoute[]   (Routes API + polyline decode, no scoring)
//
//   scoreAndRankRoutes(candidates, weights, sun, wind, cloud, ctx)
//     -> RouteResult        (pure local scoring + sort, no network)
//
// This lets the UI re-rank routes instantly when the user taps a comfort
// filter pill, without burning another Routes API quota call.
//
// scoreAndRankRoutes calls sampleRouteExposure with the SAME building-
// shadow / tree / solar-sample / bearing inputs that the route polyline
// renderer (colorizeRoute) uses. Both call the unified
// classifyRouteSegmentSun, so a route polyline that reads as 90% amber
// gets meanSunExposure ≈ 0.9 → displayed "10% cooler". The on-card
// number is by construction equal to "fraction of the visible route
// that's shaded", which is the only invariant the demo audience can
// actually verify by looking at the map.

import {
  sampleRouteExposure,
  sampleRoutePrecipExposure,
  sampleRouteWindExposure,
} from './routeExposureScoring';
import type { BuildingShadow } from './buildingShadows';
import type { Building, TreeNode } from './overpass';
import type { SolarSample } from '../hooks/useSolarAPI';
import type { GlareHotspot } from './glassGlare';

// ---------- types ----------

export interface HlciWeights {
  /** Cost coefficient on sun-in-face exposure. Positive = avoid sun. Negative = prefer sun. */
  glareAvoidance: number;
  /** Cost coefficient on headwind exposure. Positive = avoid wind. */
  windAvoidance: number;
  /** Bonus weight on shaded segments. Kept for Gemini-era backcompat; pill presets leave it at 0. */
  shadePreference: number;
  /**
   * Cost coefficient on wind-driven precipitation exposure. Positive =
   * avoid walking into the rain/snow. The "Avoid Rain" pill sets this to
   * 1.0; "Avoid Both" sets it to 0.6 when precipitation probability is
   * elevated, otherwise leaves it at 0.
   */
  rainAvoidance: number;
}

export interface RoutePoint {
  lng: number;
  lat: number;
}

export interface SolarPosition {
  /** Bearing of the sun clockwise from north, 0..360. */
  azimuthDeg: number;
  /** Altitude of the sun above the horizon, -90..90. */
  elevationDeg: number;
}

export interface AmbientWind {
  /** Direction the wind is COMING FROM, clockwise from N (meteorological). */
  directionDeg: number;
  speedMph: number;
}

/** Routes API v2 travel modes that the UI exposes. */
export type TravelMode = 'WALK' | 'BICYCLE' | 'DRIVE' | 'TRANSIT';

export interface RouteStep {
  /** Human-readable instruction text (e.g. "Turn right onto Broadway"). */
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
}

/** A Routes API result before any local HLCI scoring is applied. */
export interface CandidateRoute {
  polyline: RoutePoint[];
  distanceMeters: number;
  durationSeconds: number;
  /** Routes API `description` if present (e.g. "via 6th Ave"), else "". */
  description: string;
  /** Flattened turn-by-turn from routes.legs.steps. Empty for straight-line fallback. */
  steps: RouteStep[];
}

/** A CandidateRoute decorated with the comfort cost under a specific weight set. */
export interface ScoredRoute extends CandidateRoute {
  /** Composite HLCI cost. Lower is better under the active filter. */
  hlciCost: number;
  /**
   * Length-weighted mean solar exposure 0..1 sampled along the route, using
   * the SAME per-segment exposure values that drive the street overlay.
   * Null only when the route has < 2 polyline points. Drives the absolute
   * cooler/sunnier percentage in the UI.
   */
  meanSunExposure: number | null;
  /**
   * Length-weighted mean wind exposure 0..1 sampled along the route.
   * Combines per-segment `cos(bearing − windFrom)` with the Venturi
   * canyon amplifier and the wind speed intensity. Null when polyline
   * has < 2 points or wind speed is 0. Drives the absolute
   * shelterier/windier percentage in the UI under wind filters.
   */
  meanWindExposure: number | null;
  /** How many sampled segments sat inside a Venturi canyon (amplifier > 1.05). */
  windCanyonSegments: number;
  /**
   * Length-weighted mean precipitation exposure 0..1. Per-segment value
   * is `max(0, cos(bearing − windFrom)) × (precipitationProbability/100)`,
   * so a route walking into a 70 %-probability rain shows 0.7 exposure.
   * Null when precipitation probability is 0 or the polyline has < 2 points.
   */
  meanPrecipExposure: number | null;
  /** True iff this was the time-fastest alternative the Routes API returned. */
  isFastest: boolean;
  /** UI display label derived from description or position. */
  label: string;
}

export interface RouteResult {
  /** Routes sorted by hlciCost ascending — index 0 is the best for current weights. */
  routes: ScoredRoute[];
  weights: HlciWeights;
}

// ---------- public API ----------

export async function fetchCandidateRoutes(
  origin: RoutePoint,
  destination: RoutePoint,
  travelMode: TravelMode,
  apiKey: string | undefined,
): Promise<CandidateRoute[]> {
  if (!apiKey) return [makeStraightLineRoute(origin, destination)];

  try {
    // 1) Direct call with computeAlternativeRoutes — Routes API returns up
    //    to 3 alternatives if they exist. For short walks or very direct
    //    paths it often returns only 1.
    const direct = await fetchRoutesApi(origin, destination, travelMode, apiKey);
    console.log(`[GMA] Routes API direct: ${direct.length} route(s)`);

    let all: CandidateRoute[] = [...direct];

    // 2) If we still don't have 3 genuinely-different routes, force more by
    //    re-asking with intermediary waypoints offset perpendicular to the
    //    direct path. Each forced waypoint yields a route that must pass
    //    through that point, virtually guaranteeing a different street
    //    sequence (and therefore different HLCI score).
    if (all.length < 3) {
      const detours = await fetchDetourAlternatives(
        origin,
        destination,
        travelMode,
        apiKey,
      );
      console.log(`[GMA] Detour alternatives: ${detours.length} route(s)`);
      all = [...all, ...detours];
    }

    // 3) Deduplicate routes whose midpoints are within 100m AND whose
    //    distance/duration differ by < 10% — those are effectively the
    //    same path.
    const unique = dedupeRoutes(all);
    console.log(`[GMA] After dedup: ${unique.length} unique route(s)`);

    // 4) Cap at 3 so the sheet doesn't get crowded.
    const final = unique.slice(0, 3);
    return final.length > 0 ? final : [makeStraightLineRoute(origin, destination)];
  } catch (error) {
    console.warn('[GMA] Routes API failed; using straight-line fallback:', error);
    return [makeStraightLineRoute(origin, destination)];
  }
}

async function fetchDetourAlternatives(
  origin: RoutePoint,
  destination: RoutePoint,
  travelMode: TravelMode,
  apiKey: string,
): Promise<CandidateRoute[]> {
  // Perpendicular offset waypoints from the midpoint of origin → destination.
  const midLng = (origin.lng + destination.lng) / 2;
  const midLat = (origin.lat + destination.lat) / 2;
  const dx = destination.lng - origin.lng;
  const dy = destination.lat - origin.lat;
  const len = Math.hypot(dx, dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  // Offset clamped to ~300m max so the detour stays in the neighborhood.
  const offset = Math.min(0.003, len * 0.35);

  const waypoints: RoutePoint[] = [
    { lng: midLng + perpX * offset, lat: midLat + perpY * offset },
    { lng: midLng - perpX * offset, lat: midLat - perpY * offset },
  ];

  const settled = await Promise.allSettled(
    waypoints.map((wp) =>
      fetchRoutesApi(origin, destination, travelMode, apiKey, wp),
    ),
  );

  return settled
    .filter(
      (r): r is PromiseFulfilledResult<CandidateRoute[]> =>
        r.status === 'fulfilled',
    )
    .flatMap((r) => r.value);
}

function dedupeRoutes(routes: readonly CandidateRoute[]): CandidateRoute[] {
  const unique: CandidateRoute[] = [];
  for (const route of routes) {
    if (route.polyline.length === 0) continue;
    const isDupe = unique.some((existing) => routesAreSame(existing, route));
    if (!isDupe) unique.push(route);
  }
  return unique;
}

function routesAreSame(a: CandidateRoute, b: CandidateRoute): boolean {
  // Distance + duration within 10% AND polyline midpoints within 100m.
  const maxDist = Math.max(a.distanceMeters, b.distanceMeters, 1);
  const maxDur = Math.max(a.durationSeconds, b.durationSeconds, 1);
  if (Math.abs(a.distanceMeters - b.distanceMeters) / maxDist > 0.1) return false;
  if (Math.abs(a.durationSeconds - b.durationSeconds) / maxDur > 0.1) return false;
  if (a.polyline.length === 0 || b.polyline.length === 0) return false;
  const midA = a.polyline[Math.floor(a.polyline.length / 2)]!;
  const midB = b.polyline[Math.floor(b.polyline.length / 2)]!;
  return haversineMeters(midA, midB) < 100;
}

export interface RouteScoringContext {
  /** Projected building shadow polygons (from useSolarPosition + projectShadows). */
  buildingShadows: readonly BuildingShadow[] | null;
  /** OSM trees in the viewport — segments within 15 m count as tree-shaded. */
  trees: readonly TreeNode[] | null;
  /** Solar API samples for the candidate polylines (when proxy is reachable). */
  solarSamples: readonly SolarSample[] | null;
  /**
   * OSM (+ Solar-derived) buildings — passed to the Venturi amplifier
   * so wind-canyon segments get penalized correctly. Null = no buildings
   * available; wind scoring degrades to pure bearing facing.
   */
  buildings: readonly Building[] | null;
  /**
   * Precipitation probability 0..100 from the Google Weather API.
   * Drives the precipitation exposure sampler — 0 short-circuits to a
   * null `meanPrecipExposure` on every route.
   */
  precipitationProbability: number;
  /**
   * Glass-glare hotspots projected from glass-clad buildings (per
   * src/lib/glassGlare.ts). Route segments within 20 m of a hotspot get
   * classified as 'glare' with exposure 1.5 — overrides shadow / tree /
   * solar branches. Null when the sun is below the meaningful glare
   * elevation or it's too cloudy to reflect.
   */
  glareHotspots: readonly GlareHotspot[] | null;
}

const EMPTY_CONTEXT: RouteScoringContext = {
  buildingShadows: null,
  trees: null,
  solarSamples: null,
  buildings: null,
  precipitationProbability: 0,
  glareHotspots: null,
};

export function scoreAndRankRoutes(
  candidates: readonly CandidateRoute[],
  weights: HlciWeights,
  sun: SolarPosition,
  wind: AmbientWind,
  _cloudCoverPct: number,
  context: RouteScoringContext = EMPTY_CONTEXT,
): RouteResult {
  // cloudCoverPct is consumed inside sampleRouteExposure (sun chain),
  // not at this level — left in the signature for back-compat with
  // call sites that compute it from useWeatherData.
  if (candidates.length === 0) {
    return { routes: [], weights };
  }

  const scored: ScoredRoute[] = candidates.map((c, i) => {
    // Sample per-segment binary exposure using the unified classifier —
    // identical chain to what `colorizeRoute` renders on the map. The
    // resulting meanExposure equals "fraction of the route polyline that
    // would render as amber".
    const sample = sampleRouteExposure(
      c.polyline,
      sun.azimuthDeg,
      sun.elevationDeg,
      context.buildingShadows,
      context.trees,
      context.solarSamples,
      context.glareHotspots,
    );

    // Wind exposure: bearing-facing × Venturi amplifier × wind intensity,
    // length-weighted. Identical formula to colorizeRoute's wind classifier
    // so the score and the visual stay aligned.
    const windSample = sampleRouteWindExposure(
      c.polyline,
      wind.directionDeg,
      wind.speedMph,
      context.buildings,
    );

    // Precipitation exposure: cos(bearing − windFrom) × precipProb/100,
    // length-weighted. Only meaningful when both there's wind and rain
    // is plausible (probability > 0).
    const precipSample = sampleRoutePrecipExposure(
      c.polyline,
      wind.directionDeg,
      context.precipitationProbability,
    );

    const meanSunExposure = c.polyline.length >= 2 ? sample.meanExposure : null;
    const meanWindExposure =
      c.polyline.length >= 2 && wind.speedMph > 0
        ? windSample.meanExposure
        : null;
    const meanPrecipExposure =
      c.polyline.length >= 2 && context.precipitationProbability > 0
        ? precipSample.meanExposure
        : null;

    // -------------- per-route TRANSPARENCY log --------------
    // We dump every segment's source + exposure + coords + diagnostic
    // checks. Wrapped in console.groupCollapsed so the console stays
    // browseable — the demo audience can expand the group to verify any
    // route's classifications top-to-bottom.
    const routeLabel = c.description.trim() || `alt ${i + 1}`;
    const headline = {
      polylinePts: c.polyline.length,
      segmentsScored: sample.matches.length,
      meanExposure: Number(sample.meanExposure.toFixed(3)),
      bySource: sample.bySource,
      solarCoverage:
        sample.matches.length > 0
          ? `${Math.round((100 * sample.bySource.solar) / sample.matches.length)}% via Solar API`
          : '0%',
    };
    console.groupCollapsed(
      `[GMA] Route ${i} (${routeLabel}) — ${sample.matches.length} segments, mean exposure ${headline.meanExposure}`,
    );
    console.log('summary', headline);

    // Per-segment full reasoning.
    const perSegment = sample.matches.map((m) => {
      const d = m.diagnostic;
      return {
        seg: m.routeSegIdx,
        lenM: Math.round(m.lengthM),
        midLng: Number(d.midLng.toFixed(5)),
        midLat: Number(d.midLat.toFixed(5)),
        bearing: Math.round(d.bearingDeg),
        sunAz: Math.round(d.sunAzimuthDeg),
        sunElev: Math.round(d.sunElevationDeg),
        bearingFacing: Number(d.bearingFacing.toFixed(3)),
        bldgShadow: d.buildingShadowHit ? 'hit' : 'miss',
        nearestTreeM:
          d.nearestTreeDistanceM != null
            ? Math.round(d.nearestTreeDistanceM)
            : null,
        solarRatio:
          d.solarSample != null ? Number(d.solarSample.exposureRatio.toFixed(3)) : null,
        solarDistM:
          d.solarSample != null ? Math.round(d.solarSample.distanceM) : null,
        via: m.via,
        reason: m.reason,
        exposure: m.exposure,
      };
    });
    console.table(perSegment);

    // Roll up which Solar API samples actually informed this route — and
    // their measured ratios. Each is a real Google satellite-derived
    // datum, so we surface coords + ratio so the audience can spot-check.
    const solarUsage = new Map<
      string,
      { lat: number; lng: number; exposureRatio: number; matchedSegments: number }
    >();
    for (const m of sample.matches) {
      const ss = m.diagnostic.solarSample;
      if (!ss) continue;
      // Only count samples whose Solar branch actually "won". That's the
      // segments where the score genuinely traces back to Google data.
      if (m.via !== 'solar') continue;
      const key = `${ss.lat.toFixed(4)}|${ss.lng.toFixed(4)}`;
      const existing = solarUsage.get(key);
      if (existing) {
        existing.matchedSegments++;
      } else {
        solarUsage.set(key, {
          lat: ss.lat,
          lng: ss.lng,
          exposureRatio: Number(ss.exposureRatio.toFixed(3)),
          matchedSegments: 1,
        });
      }
    }
    if (solarUsage.size > 0) {
      console.log(
        `Solar API samples used by this route: ${solarUsage.size} unique`,
      );
      console.table(Array.from(solarUsage.values()));
    } else {
      console.log(
        'No Solar API samples won the classification for any segment of this route (bearing fallback / shadow / tree took priority).',
      );
    }

    // Wind diagnostics — surfaced so the audience can verify the wind
    // filter is actually reordering routes (canyonSegments count, mean
    // exposure, per-segment amplifier preview).
    if (meanWindExposure != null) {
      console.log('Wind exposure', {
        meanWindExposure: Number(meanWindExposure.toFixed(3)),
        canyonSegments: windSample.canyonSegments,
        totalSegments: windSample.matches.length,
        windFromDeg: Math.round(wind.directionDeg),
        windMph: Number(wind.speedMph.toFixed(1)),
        preview: windSample.matches.slice(0, 8).map((m) => ({
          seg: m.routeSegIdx,
          bearing: Math.round(m.bearingDeg),
          facing: Number(m.windFacing.toFixed(2)),
          amp: Number(m.amplifier.toFixed(2)),
          canyonM:
            m.canyonWidthM != null ? Math.round(m.canyonWidthM) : null,
          exposure: Number(m.exposure.toFixed(3)),
        })),
      });
    }
    // Precipitation diagnostics — confirms the avoid-rain ranking has
    // substance (per-route exposure should differ when wind direction
    // is consistent across candidates).
    if (meanPrecipExposure != null) {
      console.log('Precipitation exposure', {
        meanPrecipExposure: Number(meanPrecipExposure.toFixed(3)),
        precipProbability: context.precipitationProbability,
        windFromDeg: Math.round(wind.directionDeg),
        preview: precipSample.matches.slice(0, 6).map((m) => ({
          seg: m.routeSegIdx,
          bearing: Math.round(m.bearingDeg),
          facing: Number(m.windFacing.toFixed(2)),
          exposure: Number(m.exposure.toFixed(3)),
        })),
      });
    }
    console.groupEnd();

    const hlciCost = composeHlciCost(
      meanSunExposure,
      meanWindExposure,
      meanPrecipExposure,
      weights,
    );

    return {
      ...c,
      hlciCost,
      meanSunExposure,
      meanWindExposure,
      windCanyonSegments: windSample.canyonSegments,
      meanPrecipExposure,
      isFastest: i === 0,
      label: c.description.trim() || `Route ${i + 1}`,
    };
  });

  // Sort by HLCI cost ascending (lowest = best under current weights), with
  // duration as a tie-breaker. The tie-breaker matters for the "No
  // preference" filter where all weights are 0 and every route has cost 0 —
  // we fall back to time-fastest order.
  scored.sort((a, b) => {
    const costDelta = a.hlciCost - b.hlciCost;
    if (Math.abs(costDelta) > 1e-6) return costDelta;
    return a.durationSeconds - b.durationSeconds;
  });

  return { routes: scored, weights };
}

/**
 * Final HLCI cost = sun term + wind term + shade-bonus term. Both sun
 * and wind terms come from per-segment exposure samples that ALSO drive
 * the on-map visual (the unified classifier in routeColoring +
 * sampleRouteWindExposure with Venturi amplification). A negative
 * `glareAvoidance` (the "Sunniest" filter) flips the sun term's sign
 * automatically — sort order does the right thing.
 */
function composeHlciCost(
  meanSunExposure: number | null,
  meanWindExposure: number | null,
  meanPrecipExposure: number | null,
  weights: HlciWeights,
): number {
  const sunExposure = meanSunExposure ?? 0;
  const windExposure = meanWindExposure ?? 0;
  const precipExposure = meanPrecipExposure ?? 0;
  const sunCost = weights.glareAvoidance * sunExposure;
  const windCost = weights.windAvoidance * windExposure;
  const rainCost = weights.rainAvoidance * precipExposure;
  const shadeBonus = weights.shadePreference * (1 - sunExposure);
  return sunCost + windCost + rainCost + shadeBonus;
}

/**
 * What direction the user "wants" relative to sun exposure. Passed in by
 * the UI based on the active filter pill so the comfort % can be derived
 * from the SAME exposure value that drives the visual street overlay,
 * instead of a candidate-relative normalize.
 *
 *   'cooler'    → display = (1 − meanSunExposure) × 100
 *   'sunnier'   → display =      meanSunExposure  × 100
 *   null        → fall back to the relative-cost normalize for wind / no-preference
 */
export type SunComfortDirection = 'cooler' | 'sunnier' | null;

/**
 * Wind comfort direction — exposes the same absolute-percent semantics
 * for wind as `SunComfortDirection` does for sun.
 *
 *   'sheltered' → display = (1 − meanWindExposure) × 100
 *   null        → fall back to the relative-cost normalize
 */
export type WindComfortDirection = 'sheltered' | null;

/**
 * Absolute wind comfort percent for a single route. Mirrors
 * `routeComfortPercent` for sun but reads `meanWindExposure`. Returns
 * a relative-normalize fallback when the route lacks a wind exposure
 * value (calm wind / not enough polyline points).
 */
export function routeWindComfortPercent(
  route: ScoredRoute,
  allRoutes: readonly ScoredRoute[],
  direction: WindComfortDirection = 'sheltered',
): number {
  if (direction === 'sheltered' && route.meanWindExposure != null) {
    const pct = (1 - route.meanWindExposure) * 100;
    return Math.round(Math.max(0, Math.min(100, pct)));
  }
  if (allRoutes.length === 0) return 0;
  const costs = allRoutes.map((r) => r.hlciCost);
  const max = Math.max(...costs);
  const min = Math.min(...costs);
  const range = max - min;
  if (range < 1e-4) return 100;
  return Math.round((100 * (max - route.hlciCost)) / range);
}

/**
 * Rain comfort direction — same semantics as sun/wind but reads
 * `meanPrecipExposure`. 'sheltered' returns absolute (1 − exposure) ×
 * 100; null falls back to the candidate-relative normalize.
 */
export type RainComfortDirection = 'sheltered' | null;

export function routeRainComfortPercent(
  route: ScoredRoute,
  allRoutes: readonly ScoredRoute[],
  direction: RainComfortDirection = 'sheltered',
): number {
  if (direction === 'sheltered' && route.meanPrecipExposure != null) {
    const pct = (1 - route.meanPrecipExposure) * 100;
    return Math.round(Math.max(0, Math.min(100, pct)));
  }
  if (allRoutes.length === 0) return 0;
  const costs = allRoutes.map((r) => r.hlciCost);
  const max = Math.max(...costs);
  const min = Math.min(...costs);
  const range = max - min;
  if (range < 1e-4) return 100;
  return Math.round((100 * (max - route.hlciCost)) / range);
}

/**
 * Comfort percentage for a single route, [0, 100]. When a sun direction is
 * supplied AND the route has a meanSunExposure (always true once the route
 * has ≥ 2 polyline points), the percent is read directly off the exposure
 * value — provably the same data as the on-map street coloring. Otherwise
 * we normalize hlciCost across the candidate set (the previous behavior),
 * which is still useful for wind / no-preference filters.
 */
export function routeComfortPercent(
  route: ScoredRoute,
  allRoutes: readonly ScoredRoute[],
  sunDirection: SunComfortDirection = null,
): number {
  if (sunDirection && route.meanSunExposure != null) {
    const pct =
      sunDirection === 'cooler'
        ? (1 - route.meanSunExposure) * 100
        : route.meanSunExposure * 100;
    return Math.round(Math.max(0, Math.min(100, pct)));
  }
  if (allRoutes.length === 0) return 0;
  const costs = allRoutes.map((r) => r.hlciCost);
  const max = Math.max(...costs);
  const min = Math.min(...costs);
  const range = max - min;
  if (range < 1e-4) return 100;
  return Math.round((100 * (max - route.hlciCost)) / range);
}

// ---------- Routes API ----------

async function fetchRoutesApi(
  origin: RoutePoint,
  destination: RoutePoint,
  travelMode: TravelMode,
  apiKey: string,
  intermediate?: RoutePoint,
): Promise<CandidateRoute[]> {
  const body: Record<string, unknown> = {
    origin: {
      location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
    },
    destination: {
      location: {
        latLng: { latitude: destination.lat, longitude: destination.lng },
      },
    },
    travelMode,
    // Only ask for alternatives on the direct call. Detour calls with a
    // forced waypoint each return one specific path; collecting them gives
    // the variety.
    computeAlternativeRoutes: !intermediate,
    languageCode: 'en-US',
    units: 'METRIC',
  };

  if (intermediate) {
    body.intermediates = [
      {
        location: {
          latLng: {
            latitude: intermediate.lat,
            longitude: intermediate.lng,
          },
        },
      },
    ];
  }

  const response = await fetch(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'routes.duration',
          'routes.distanceMeters',
          'routes.polyline.encodedPolyline',
          'routes.description',
          'routes.legs.steps.navigationInstruction',
          'routes.legs.steps.distanceMeters',
          'routes.legs.steps.staticDuration',
        ].join(','),
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`Routes ${response.status}`);
  }

  const json = (await response.json()) as RoutesApiResponse;
  const routes = json.routes ?? [];

  return routes.map((r) => ({
    polyline: decodePolyline(r.polyline?.encodedPolyline ?? ''),
    distanceMeters: r.distanceMeters ?? 0,
    durationSeconds: parseDurationSeconds(r.duration),
    description: r.description ?? '',
    steps: extractSteps(r.legs),
  }));
}

function extractSteps(legs: RoutesApiLegs | undefined): RouteStep[] {
  if (!legs) return [];
  return legs
    .flatMap((leg) => leg.steps ?? [])
    .map((step) => ({
      instruction: step.navigationInstruction?.instructions ?? '',
      distanceMeters: step.distanceMeters ?? 0,
      durationSeconds: parseDurationSeconds(step.staticDuration),
    }))
    .filter((s) => s.instruction.length > 0);
}

function makeStraightLineRoute(
  origin: RoutePoint,
  destination: RoutePoint,
): CandidateRoute {
  const meters = haversineMeters(origin, destination);
  return {
    polyline: [origin, destination],
    distanceMeters: meters,
    durationSeconds: meters / 1.4, // ~5 km/h pedestrian
    description: 'Direct path',
    steps: [
      {
        instruction: 'Head toward destination',
        distanceMeters: meters,
        durationSeconds: meters / 1.4,
      },
    ],
  };
}

// ---------- geometry helpers ----------
// Wind cost no longer lives in this file — sampleRouteWindExposure in
// routeExposureScoring.ts owns the per-segment Venturi-amplified
// exposure, and composeHlciCost just consumes the resulting scalar.

export function bearingDegrees(a: RoutePoint, b: RoutePoint): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMeters(a: RoutePoint, b: RoutePoint): number {
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Google encoded polyline algorithm format. Inlined to avoid the
// @googlemaps/polyline dep.
function decodePolyline(encoded: string): RoutePoint[] {
  const out: RoutePoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    out.push({ lng: lng / 1e5, lat: lat / 1e5 });
  }
  return out;
}

function parseDurationSeconds(duration: string | undefined): number {
  if (!duration) return 0;
  const match = /^(\d+)s$/.exec(duration);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

interface RoutesApiResponse {
  routes?: Array<{
    duration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
    description?: string;
    legs?: Array<{
      steps?: Array<{
        navigationInstruction?: { instructions?: string };
        distanceMeters?: number;
        staticDuration?: string;
      }>;
    }>;
  }>;
}

type RoutesApiLegs = NonNullable<NonNullable<RoutesApiResponse['routes']>[number]['legs']>;
