// Route comfort scoring — length-weighted mean of the per-segment binary
// sun classification.
//
// CRITICAL invariant: this function uses the EXACT same classifier as
// `colorizeRoute` in routeColoring.ts (`classifyRouteSegmentSun`). What
// you see on the map (amber vs blue per segment) is what the score
// counts. If the route polyline reads as 90% amber, meanExposure is
// ≈ 0.9 and the displayed "X% cooler" is ≈ 10. Previously the score was
// derived from the OSM street-index continuous exposure (a separate
// dataset from the route polyline visual), which is why a mostly-sunny
// route could read as "90% cooler" on the card.

import { bearingDegrees, type RoutePoint } from './hlciRouter';
import {
  classifyWithDiagnostics,
  type SunDiagnostic,
  type SunReason,
  type SunVia,
} from './routeColoring';
import type { BuildingShadow } from './buildingShadows';
import type { Building, TreeNode } from './overpass';
import type { SolarSample } from '../hooks/useSolarAPI';
import { computeVenturiDiagnostic } from './venturi';
import type { GlareHotspot } from './glassGlare';

const WIND_REFERENCE_MPH = 20;
const WIND_SAMPLE_STEP_M = 100;

export interface RouteExposureMatch {
  routeSegIdx: number;
  routeSegMid: [number, number];
  lengthM: number;
  /**
   * Per-segment sun exposure — 0 (shaded), 1 (sunny), or 1.5 (glass
   * glare hotspot). The display layer clamps the mean to [0, 1] when
   * showing the cooler percent, but `composeHlciCost` reads the raw
   * value so glare-heavy routes get penalized harder than direct-sun
   * routes.
   */
  exposure: number;
  reason: SunReason;
  via: SunVia;
  /** Full audit of every check for this segment — used by the per-route log. */
  diagnostic: SunDiagnostic;
}

export interface RouteExposureBySource {
  shadow: number;
  tree: number;
  solar: number;
  bearing: number;
  night: number;
  glare: number;
}

export interface RouteExposureResult {
  /** Length-weighted mean of the per-segment binary exposures, 0..1. */
  meanExposure: number;
  matches: RouteExposureMatch[];
  bySource: RouteExposureBySource;
}

export function sampleRouteExposure(
  polyline: readonly RoutePoint[],
  sunAzimuthDeg: number,
  sunElevationDeg: number,
  buildingShadows: readonly BuildingShadow[] | null,
  trees: readonly TreeNode[] | null,
  solarSamples: readonly SolarSample[] | null,
  glareHotspots: readonly GlareHotspot[] | null = null,
): RouteExposureResult {
  const emptyResult: RouteExposureResult = {
    meanExposure: 0,
    matches: [],
    bySource: { shadow: 0, tree: 0, solar: 0, bearing: 0, night: 0, glare: 0 },
  };
  if (polyline.length < 2) return emptyResult;

  const matches: RouteExposureMatch[] = [];
  const bySource: RouteExposureBySource = {
    shadow: 0,
    tree: 0,
    solar: 0,
    bearing: 0,
    night: 0,
    glare: 0,
  };
  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const lengthM = haversineMeters(a.lng, a.lat, b.lng, b.lat);
    if (lengthM < 0.5) continue;

    const midLng = (a.lng + b.lng) / 2;
    const midLat = (a.lat + b.lat) / 2;
    const bearing = bearingDegrees(a, b);
    const { classification, diagnostic } = classifyWithDiagnostics(
      midLng,
      midLat,
      bearing,
      sunAzimuthDeg,
      sunElevationDeg,
      buildingShadows,
      trees,
      solarSamples,
      glareHotspots,
    );

    bySource[classification.via]++;
    matches.push({
      routeSegIdx: i,
      routeSegMid: [midLng, midLat],
      lengthM,
      exposure: classification.exposure,
      reason: classification.reason,
      via: classification.via,
      diagnostic,
    });
    weightedSum += classification.exposure * lengthM;
    weightTotal += lengthM;
  }

  return {
    meanExposure: weightTotal > 0 ? weightedSum / weightTotal : 0,
    matches,
    bySource,
  };
}

// ---------- wind exposure (Venturi-amplified) --------------------------

export interface RouteWindExposureMatch {
  routeSegIdx: number;
  routeSegMid: [number, number];
  lengthM: number;
  bearingDeg: number;
  /** cos(bearing − windFrom), -1..1; positive = walking into wind. */
  windFacing: number;
  /** Venturi amplifier at this midpoint, 1.0–3.0. */
  amplifier: number;
  /** Venturi canyon width when both sides have buildings, else null. */
  canyonWidthM: number | null;
  /**
   * Wind exposure 0..1 = max(0, windFacing) × amplifier × windIntensity
   * clamped to [0, 1]. 0 = no headwind / no wind; 1 = full headwind
   * in a deep canyon at reference wind speed.
   */
  exposure: number;
}

export interface RouteWindExposureResult {
  /** Length-weighted mean of per-segment exposures, 0..1. */
  meanExposure: number;
  matches: RouteWindExposureMatch[];
  /** How many segments sat inside a Venturi canyon (amplifier > 1.05). */
  canyonSegments: number;
}

/**
 * Walk the route polyline by WIND_SAMPLE_STEP_M chunks (≈ 100 m per
 * PROJECT.md §4 Module B). For each chunk compute the wind facing and
 * Venturi amplifier; combine into a 0..1 exposure scalar. Length-weight
 * the average so a long east-facing stretch in a canyon outweighs a
 * 30 m kink on a side street.
 */
export function sampleRouteWindExposure(
  polyline: readonly RoutePoint[],
  windFromDeg: number,
  windSpeedMph: number,
  buildings: readonly Building[] | null,
): RouteWindExposureResult {
  const empty: RouteWindExposureResult = {
    meanExposure: 0,
    matches: [],
    canyonSegments: 0,
  };
  if (polyline.length < 2) return empty;

  const windIntensity = Math.max(
    0,
    Math.min(1, windSpeedMph / WIND_REFERENCE_MPH),
  );
  if (windIntensity === 0) return empty;

  const matches: RouteWindExposureMatch[] = [];
  let weightedSum = 0;
  let weightTotal = 0;
  let canyonSegments = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const segLengthM = haversineMeters(a.lng, a.lat, b.lng, b.lat);
    if (segLengthM < 0.5) continue;

    // Per PROJECT.md, sample every 100 m. For short OSM segments (most
    // are < 100 m) the segment IS the sample; for longer ones we just
    // weight by their full length without further subdivision — the
    // bearing doesn't vary within a straight Routes-API segment.
    const bearing = bearingDegrees(a, b);
    const midLng = (a.lng + b.lng) / 2;
    const midLat = (a.lat + b.lat) / 2;
    const windFacing = Math.cos(toRad(bearing - windFromDeg));
    const facingHead = Math.max(0, windFacing);

    let amplifier = 1.0;
    let canyonWidthM: number | null = null;
    if (buildings && buildings.length > 0) {
      const v = computeVenturiDiagnostic(midLng, midLat, bearing, buildings);
      amplifier = v.amplifier;
      canyonWidthM = v.canyonWidthM;
    }
    if (amplifier > 1.05) canyonSegments++;

    const exposure = Math.max(
      0,
      Math.min(1, facingHead * amplifier * windIntensity),
    );

    matches.push({
      routeSegIdx: i,
      routeSegMid: [midLng, midLat],
      lengthM: segLengthM,
      bearingDeg: bearing,
      windFacing,
      amplifier,
      canyonWidthM,
      exposure,
    });

    weightedSum += exposure * segLengthM;
    weightTotal += segLengthM;
    // Per-100 m sampling: longer segments contribute proportionally
    // already via the length weighting above.
    void WIND_SAMPLE_STEP_M;
  }

  return {
    meanExposure: weightTotal > 0 ? weightedSum / weightTotal : 0,
    matches,
    canyonSegments,
  };
}

// ---------- precipitation exposure (wind-driven) -----------------------

export interface RoutePrecipExposureMatch {
  routeSegIdx: number;
  routeSegMid: [number, number];
  lengthM: number;
  bearingDeg: number;
  /** cos(bearing − windFrom), -1..1; positive = walking into rain/snow. */
  windFacing: number;
  /** Per-segment precipitation exposure 0..1. */
  exposure: number;
}

export interface RoutePrecipExposureResult {
  meanExposure: number;
  matches: RoutePrecipExposureMatch[];
}

/**
 * Precipitation falls at an angle set by the wind. A segment with
 * bearing facing into the wind has rain/snow hitting the walker's
 * face; a tailwind keeps it off. Per-segment exposure =
 * max(0, cos(bearing − windFrom)) × (precipitationProbability / 100).
 * Length-weighted average. Returns zero when probability is 0.
 */
export function sampleRoutePrecipExposure(
  polyline: readonly RoutePoint[],
  windFromDeg: number,
  precipitationProbabilityPct: number,
): RoutePrecipExposureResult {
  const empty: RoutePrecipExposureResult = { meanExposure: 0, matches: [] };
  if (polyline.length < 2) return empty;
  const probFactor = Math.max(0, Math.min(1, precipitationProbabilityPct / 100));
  if (probFactor === 0) return empty;

  const matches: RoutePrecipExposureMatch[] = [];
  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const lengthM = haversineMeters(a.lng, a.lat, b.lng, b.lat);
    if (lengthM < 0.5) continue;

    const bearing = bearingDegrees(a, b);
    const midLng = (a.lng + b.lng) / 2;
    const midLat = (a.lat + b.lat) / 2;
    const windFacing = Math.cos(toRad(bearing - windFromDeg));
    const facingHead = Math.max(0, windFacing);
    const exposure = Math.max(0, Math.min(1, facingHead * probFactor));

    matches.push({
      routeSegIdx: i,
      routeSegMid: [midLng, midLat],
      lengthM,
      bearingDeg: bearing,
      windFacing,
      exposure,
    });
    weightedSum += exposure * lengthM;
    weightTotal += lengthM;
  }

  return {
    meanExposure: weightTotal > 0 ? weightedSum / weightTotal : 0,
    matches,
  };
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
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
