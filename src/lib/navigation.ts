// Live-navigation derivations from the chosen Routes API result + the
// device's current geolocation. Two outputs:
//
//   computeRouteProgress(polyline, livePos)
//     → { traveledM, totalM, nearestVertexIdx }
//
//   computeNextTurn(polyline, steps, livePos)
//     → { instruction, distanceM } | null
//
// "Traveled" is approximated by projecting the live position onto the
// nearest polyline vertex (good enough for a demo on a city grid).
// "Next turn" walks the cumulative step-boundary distances along the
// polyline and reports the upcoming step's instruction + the distance
// from the user to that boundary.

import type { RoutePoint, RouteStep } from './hlciRouter';

export interface RouteProgress {
  /** Meters traveled from the route's start, up to the nearest polyline vertex. */
  traveledM: number;
  /** Total route length, summed over the polyline. */
  totalM: number;
  /** Index into `polyline` of the vertex closest to livePos. */
  nearestVertexIdx: number;
  /** Meters from livePos to that nearest vertex (the "off-route" distance). */
  offRouteM: number;
}

export interface NextTurn {
  instruction: string;
  /** Meters along the route from the user to the start of the next turn. */
  distanceM: number;
  /** True iff this is the "arriving at destination" pseudo-turn. */
  isArrival: boolean;
}

/**
 * Project the live position onto the route polyline (nearest-vertex
 * approximation) and report how far along the route the user has come.
 * Returns null when the polyline is degenerate.
 */
export function computeRouteProgress(
  polyline: readonly RoutePoint[],
  livePos: { lat: number; lng: number } | null,
): RouteProgress | null {
  if (polyline.length < 2) return null;
  const cum = cumulativePolylineDistances(polyline);
  const totalM = cum[cum.length - 1]!;

  if (!livePos) {
    return {
      traveledM: 0,
      totalM,
      nearestVertexIdx: 0,
      offRouteM: 0,
    };
  }

  let nearestVertexIdx = 0;
  let nearestD = Infinity;
  for (let i = 0; i < polyline.length; i++) {
    const d = haversineMeters(
      livePos.lng,
      livePos.lat,
      polyline[i]!.lng,
      polyline[i]!.lat,
    );
    if (d < nearestD) {
      nearestD = d;
      nearestVertexIdx = i;
    }
  }

  return {
    traveledM: cum[nearestVertexIdx]!,
    totalM,
    nearestVertexIdx,
    offRouteM: nearestD,
  };
}

/**
 * Pick the upcoming turn the user should be told about. The currently-
 * traversed step's instruction is what the user already executed, so we
 * return the NEXT step. Past the last step we return an "Arriving"
 * pseudo-turn.
 */
export function computeNextTurn(
  polyline: readonly RoutePoint[],
  steps: readonly RouteStep[],
  livePos: { lat: number; lng: number } | null,
): NextTurn | null {
  if (polyline.length < 2 || steps.length === 0) return null;
  const progress = computeRouteProgress(polyline, livePos);
  if (!progress) return null;

  // Cumulative distance at the END of each step (step boundaries from the
  // route start). `boundaries[i]` is where step `i` ends, i.e. where step
  // `i+1` begins.
  const boundaries: number[] = [];
  let acc = 0;
  for (const s of steps) {
    acc += s.distanceMeters;
    boundaries.push(acc);
  }

  // Current step = smallest i such that traveledM < boundaries[i].
  let currentStep = steps.length - 1;
  for (let i = 0; i < boundaries.length; i++) {
    if (progress.traveledM < boundaries[i]!) {
      currentStep = i;
      break;
    }
  }

  const nextStepIdx = currentStep + 1;
  if (nextStepIdx >= steps.length) {
    return {
      instruction: 'Arriving at destination',
      distanceM: Math.max(0, progress.totalM - progress.traveledM),
      isArrival: true,
    };
  }
  return {
    instruction: steps[nextStepIdx]!.instruction,
    distanceM: Math.max(0, boundaries[currentStep]! - progress.traveledM),
    isArrival: false,
  };
}

function cumulativePolylineDistances(polyline: readonly RoutePoint[]): number[] {
  const out = [0];
  for (let i = 1; i < polyline.length; i++) {
    const prev = polyline[i - 1]!;
    const here = polyline[i]!;
    out.push(out[i - 1]! + haversineMeters(prev.lng, prev.lat, here.lng, here.lat));
  }
  return out;
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
