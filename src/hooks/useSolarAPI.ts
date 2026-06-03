// Google Solar API integration.
//
// Given the currently-selected route polyline, we sample the line every
// SAMPLE_INTERVAL_M meters, dedupe samples by 4-decimal-rounded coords,
// then hit `/api/solar?lat=…&lng=…` for each unique point. The proxy at
// server/index.js (dev) or netlify/functions/solar.js (prod) forwards
// to Google's buildingInsights:findClosest with the server-held key.
//
// From each response we extract:
//   - annualSunshineHours    — median of wholeRoofStats.sunshineQuantiles
//   - maxSunshineHours       — solarPotential.maxSunshineHoursPerYear
//                              (latitude-bound theoretical max)
//   - exposureRatio          — annual / max ∈ [0, 1] — used as the route
//                              segment's sun exposure value, replacing the
//                              bearing-based cos(…) approximation
//   - buildingHeight         — best-effort: read from any plausible field
//                              in the response (the public API doesn't
//                              expose a direct height, so we look at
//                              `buildingStats.buildingHeight` first per
//                              CLAUDE.md and fall back to null when absent)
//   - buildingPolygon        — bbox-derived rectangle in [lng,lat] order,
//                              used as a synthetic shadow-projection
//                              input alongside OSM buildings
//
// Module-level cache keyed by 4-decimal coord so the same neighborhood is
// never fetched twice in a session — Solar API calls are billed.
// Graceful degradation: a 404/500/CORS error on /api/solar just yields a
// null sample, and the route-coloring fallback path uses bearing math.

import { useEffect, useState } from 'react';
import type { RoutePoint } from '../lib/hlciRouter';

const SAMPLE_INTERVAL_M = 200;
const COORD_KEY_DECIMALS = 4; // ~11 m at the equator → coalesces dense samples
// Cap across ALL candidate polylines combined (post-dedup). 3 typical
// NYC alternatives × 30 samples = 90 raw, ≈ 50 unique after dedup.
const MAX_SAMPLES_PER_BATCH = 50;
const ENDPOINT = '/api/solar';

export interface SolarSample {
  lat: number;
  lng: number;
  annualSunshineHours: number | null;
  maxSunshineHours: number | null;
  /** annualSunshineHours / maxSunshineHours, clamped to [0, 1]; null when either input is missing. */
  exposureRatio: number | null;
  /** Best-effort building height in meters. Null when not present in the response. */
  buildingHeight: number | null;
  /** Building footprint bbox as a 4-corner ring in [lng, lat] order. Null when bbox missing. */
  buildingPolygon: [number, number][] | null;
  /**
   * Building nameplate solar capacity in watts — computed as
   * `solarPotential.panelCapacityWatts × solarPotential.maxArrayPanelsCount`
   * so it varies with how many viable panel placements the roof has.
   * Used as a tree/building-shade proxy in the canopy fallback: heavily
   * shaded roofs have far fewer viable panels → lower total capacity.
   * Null when the response was missing either component. (The per-panel
   * `panelCapacityWatts` alone is ~constant per imagery analysis and so
   * doesn't carry shade signal on its own.)
   */
  panelCapacityWatts: number | null;
  /** Whether the API call returned a hit (true) or 404 / error (false). */
  hit: boolean;
}

export type SolarStatus =
  | 'idle' //         no route polyline yet
  | 'loading' //      fetch in flight
  | 'active' //       at least one sample returned data
  | 'unavailable'; // every sample missed (404 / proxy unreachable / error)

export interface SolarRouteData {
  samples: SolarSample[];
  /** Distinct buildings observed, used as supplemental shadow sources. */
  buildings: { polygon: [number, number][]; height: number }[];
  matchedCount: number;
  totalSamples: number;
  loading: boolean;
  /** Lifecycle / network state used by the on-map data-sources indicator. */
  status: SolarStatus;
}

const EMPTY: SolarRouteData = {
  samples: [],
  buildings: [],
  matchedCount: 0,
  totalSamples: 0,
  loading: false,
  status: 'idle',
};

const CACHE = new Map<string, Promise<SolarSample>>();

/**
 * Sample the Solar API across an array of candidate polylines.
 *
 * Previously this took a single polyline (the selected route), which
 * meant non-selected candidates fell back to bearing math for scoring.
 * Taking ALL candidates up front means every alternative's comfort score
 * uses real Solar API data when available — apples-to-apples.
 *
 * Sample points are flattened across all polylines and deduped by
 * 4-decimal-rounded coord BEFORE the batch cap, so overlapping route
 * geometry shares samples for free.
 */
export function useSolarAPI(
  polylines: ReadonlyArray<ReadonlyArray<RoutePoint>> | null,
): SolarRouteData {
  const [data, setData] = useState<SolarRouteData>(EMPTY);

  // Stable polyline-set identity: a join of point counts + first/last
  // coords per polyline. This is enough to detect "did the candidates
  // actually change" without re-firing on identical content reaching us
  // via a new outer array reference.
  const polylinesKey = polylines
    ? polylines
        .map(
          (p) =>
            `${p.length}:${p[0]?.lat ?? ''},${p[0]?.lng ?? ''}|${p[p.length - 1]?.lat ?? ''},${p[p.length - 1]?.lng ?? ''}`,
        )
        .join(';')
    : '';

  useEffect(() => {
    if (!polylines || polylines.length === 0) {
      setData(EMPTY);
      return;
    }
    const nonTrivial = polylines.filter((p) => p.length >= 2);
    if (nonTrivial.length === 0) {
      setData(EMPTY);
      return;
    }

    let cancelled = false;
    const allPoints: RoutePoint[] = [];
    const seen = new Set<string>();
    for (const polyline of nonTrivial) {
      for (const p of samplePolyline(polyline, SAMPLE_INTERVAL_M)) {
        const key = `${p.lat}|${p.lng}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allPoints.push(p);
        if (allPoints.length >= MAX_SAMPLES_PER_BATCH) break;
      }
      if (allPoints.length >= MAX_SAMPLES_PER_BATCH) break;
    }

    if (allPoints.length === 0) {
      setData(EMPTY);
      return;
    }

    setData((prev) => ({ ...prev, loading: true, status: 'loading' }));

    console.log('[GMA] Solar API: sampling candidates', {
      candidatePolylines: nonTrivial.length,
      uniqueSamples: allPoints.length,
      intervalM: SAMPLE_INTERVAL_M,
      cappedAt: MAX_SAMPLES_PER_BATCH,
    });

    Promise.all(allPoints.map((p) => fetchSampleCached(p.lat, p.lng)))
      .then((results) => {
        if (cancelled) return;
        const samples = results;
        const matchedCount = samples.filter((s) => s.hit).length;
        const buildingsMap = new Map<
          string,
          { polygon: [number, number][]; height: number }
        >();
        for (const s of samples) {
          if (
            s.buildingPolygon &&
            s.buildingHeight != null &&
            s.buildingHeight > 0
          ) {
            const key = `${s.lat.toFixed(4)}|${s.lng.toFixed(4)}`;
            if (!buildingsMap.has(key)) {
              buildingsMap.set(key, {
                polygon: s.buildingPolygon,
                height: s.buildingHeight,
              });
            }
          }
        }
        const status: SolarStatus =
          matchedCount > 0 ? 'active' : 'unavailable';

        // Transparency log: show every sample, its coords, and its
        // measured annual-sun ratio. Collapsed group so it doesn't
        // dominate the console.
        console.groupCollapsed(
          `[GMA] Solar API results — ${matchedCount}/${samples.length} matched, buildings with height: ${buildingsMap.size}`,
        );
        console.log('summary', {
          totalSamples: samples.length,
          matched: matchedCount,
          missed: samples.length - matchedCount,
          buildingsWithHeight: buildingsMap.size,
          status,
        });
        console.table(
          samples.map((s) => ({
            lat: Number(s.lat.toFixed(4)),
            lng: Number(s.lng.toFixed(4)),
            hit: s.hit,
            annualHours:
              s.annualSunshineHours != null
                ? Math.round(s.annualSunshineHours)
                : null,
            maxHours:
              s.maxSunshineHours != null
                ? Math.round(s.maxSunshineHours)
                : null,
            exposureRatio:
              s.exposureRatio != null
                ? Number(s.exposureRatio.toFixed(3))
                : null,
            buildingHeightM:
              s.buildingHeight != null ? Math.round(s.buildingHeight) : null,
            panelCapacityW:
              s.panelCapacityWatts != null
                ? Math.round(s.panelCapacityWatts)
                : null,
          })),
        );
        console.groupEnd();
        setData({
          samples,
          buildings: Array.from(buildingsMap.values()),
          matchedCount,
          totalSamples: samples.length,
          loading: false,
          status,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('[GMA] Solar API: batch fetch failed', error);
        setData({ ...EMPTY, status: 'unavailable' });
      });

    return () => {
      cancelled = true;
    };
    // polylinesKey collapses identical content across new outer-array refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polylinesKey]);

  return data;
}

function fetchSampleCached(lat: number, lng: number): Promise<SolarSample> {
  const roundedLat = roundCoord(lat);
  const roundedLng = roundCoord(lng);
  const key = `${roundedLat}|${roundedLng}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const promise = fetchSample(roundedLat, roundedLng).catch(() =>
    emptySample(roundedLat, roundedLng),
  );
  CACHE.set(key, promise);
  return promise;
}

async function fetchSample(lat: number, lng: number): Promise<SolarSample> {
  try {
    const response = await fetch(
      `${ENDPOINT}?lat=${lat}&lng=${lng}`,
    );
    if (!response.ok) {
      // 404 just means no building data at this point — common over parks,
      // intersections, water. Treat as a miss, not a fault.
      if (response.status !== 404) {
        const body = await response.text();
        console.warn(
          `[GMA] Solar API ${response.status} for (${lat}, ${lng})`,
          body.slice(0, 200),
        );
      }
      return emptySample(lat, lng);
    }
    const json = (await response.json()) as SolarApiResponse;
    return parseSolarResponse(lat, lng, json);
  } catch (error) {
    console.warn(`[GMA] Solar API fetch failed (${lat}, ${lng}):`, error);
    return emptySample(lat, lng);
  }
}

function parseSolarResponse(
  queryLat: number,
  queryLng: number,
  json: SolarApiResponse,
): SolarSample {
  const sp = json.solarPotential ?? null;
  const maxSunshineHours = sp?.maxSunshineHoursPerYear ?? null;

  // Median of the roof's sunshine quantiles → "typical annual sunshine hours
  // at the building". The Solar API returns 11 quantiles (0…100% in 10%
  // steps) so index 5 is the median.
  const quantiles = sp?.wholeRoofStats?.sunshineQuantiles ?? [];
  const annualSunshineHours = quantiles.length === 11 ? quantiles[5] ?? null : null;

  let exposureRatio: number | null = null;
  if (annualSunshineHours != null && maxSunshineHours && maxSunshineHours > 0) {
    exposureRatio = Math.max(
      0,
      Math.min(1, annualSunshineHours / maxSunshineHours),
    );
  }

  // Height: CLAUDE.md spec mentions `buildingStats.buildingHeight`. The
  // public Solar API schema doesn't expose that directly, so we look in
  // several plausible places and fall back to null. When null the existing
  // OSM-derived height is used in projectShadows.
  const buildingHeight =
    json.buildingStats?.buildingHeight ??
    json.buildingStats?.height ??
    null;

  // Nameplate solar capacity = per-panel watts × max viable panels. The
  // per-panel field alone is ~constant per imagery analysis, so on its
  // own it has no shade signal — but the panel COUNT (`maxArrayPanelsCount`)
  // is suppressed on shaded roofs. Their product is the variable we want.
  let panelCapacityWatts: number | null = null;
  if (
    sp?.panelCapacityWatts != null &&
    sp.maxArrayPanelsCount != null &&
    sp.panelCapacityWatts > 0 &&
    sp.maxArrayPanelsCount >= 0
  ) {
    panelCapacityWatts = sp.panelCapacityWatts * sp.maxArrayPanelsCount;
  }

  const buildingPolygon = bboxToPolygon(json.boundingBox);

  return {
    lat: queryLat,
    lng: queryLng,
    annualSunshineHours,
    maxSunshineHours,
    exposureRatio,
    buildingHeight,
    buildingPolygon,
    panelCapacityWatts,
    hit: true,
  };
}

function bboxToPolygon(
  bbox: SolarApiResponse['boundingBox'],
): [number, number][] | null {
  if (!bbox?.sw || !bbox.ne) return null;
  const { sw, ne } = bbox;
  if (sw.latitude == null || sw.longitude == null) return null;
  if (ne.latitude == null || ne.longitude == null) return null;
  return [
    [sw.longitude, sw.latitude],
    [ne.longitude, sw.latitude],
    [ne.longitude, ne.latitude],
    [sw.longitude, ne.latitude],
  ];
}

function emptySample(lat: number, lng: number): SolarSample {
  return {
    lat,
    lng,
    annualSunshineHours: null,
    maxSunshineHours: null,
    exposureRatio: null,
    buildingHeight: null,
    buildingPolygon: null,
    panelCapacityWatts: null,
    hit: false,
  };
}

function samplePolyline(
  polyline: readonly RoutePoint[],
  intervalM: number,
): RoutePoint[] {
  const out: RoutePoint[] = [];
  const seen = new Set<string>();
  let cumulative = 0;
  let nextStep = 0;

  pushUnique(polyline[0]!);
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const segM = haversineMeters(a.lng, a.lat, b.lng, b.lat);
    if (segM < 1) continue;
    const segStart = cumulative;
    const segEnd = cumulative + segM;
    while (nextStep <= segEnd) {
      const t = (nextStep - segStart) / segM;
      pushUnique({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
      nextStep += intervalM;
    }
    cumulative = segEnd;
  }
  pushUnique(polyline[polyline.length - 1]!);

  function pushUnique(p: RoutePoint) {
    const key = `${roundCoord(p.lat)}|${roundCoord(p.lng)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ lat: roundCoord(p.lat), lng: roundCoord(p.lng) });
  }

  return out;
}

function roundCoord(v: number): number {
  const f = 10 ** COORD_KEY_DECIMALS;
  return Math.round(v * f) / f;
}

function haversineMeters(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---- Solar API response shape (narrow) ---------------------------------

interface SolarApiResponse {
  solarPotential?: {
    maxSunshineHoursPerYear?: number;
    /** Per-panel rated capacity in watts — typically constant (e.g. 250). */
    panelCapacityWatts?: number;
    /** Max viable panel placements on the roof — varies with shade. */
    maxArrayPanelsCount?: number;
    wholeRoofStats?: {
      sunshineQuantiles?: number[];
    };
  };
  boundingBox?: {
    sw?: { latitude?: number; longitude?: number };
    ne?: { latitude?: number; longitude?: number };
  };
  /**
   * Per CLAUDE.md, the spec calls for `buildingStats.buildingHeight`. The
   * current public Solar API doesn't expose that field, but we still look
   * for it (along with a couple of likely alternates) so the integration
   * picks it up if Google ever ships it. Falls back to null otherwise.
   */
  buildingStats?: {
    buildingHeight?: number;
    height?: number;
  };
}
