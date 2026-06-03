// Building shadow projection from sun azimuth + elevation.
//
// Approach: for each building, compute a shadow polygon by translating the
// building's footprint AWAY from the sun by `height / tan(elevation)`
// meters (clamped at 100 m to avoid unbounded shadows at low sun).
//
// What this approximation gets right:
//   - The shadow appears OFFSET from the building in the correct direction.
//   - The offset distance is proportional to building height and inversely
//     proportional to sun elevation.
//
// What it skips for simplicity:
//   - The true shadow is the convex hull of `footprint ∪ displaced_footprint`,
//     i.e. a "ribbon" connecting the building to its shadow tip. We render
//     only the displaced footprint, so the connecting silhouette is missing.
//   - No occlusion checks — overlapping shadows just stack.
//   - No accounting for sun being below horizon (early dawn / late dusk);
//     we return an empty array in that case.

import type { Building } from './overpass';

export interface BuildingShadow {
  buildingId: string;
  /** Shadow polygon as [lng, lat] points. */
  polygon: [number, number][];
}

const MAX_SHADOW_M = 100;
const MIN_USEFUL_ELEVATION_DEG = 5;

// Conversions valid at NYC latitude (~40.76°N). Good to ~0.3% over the
// Midtown bbox; cheap and well-suited to this approximation.
const M_PER_DEG_LAT = 111_000;
const M_PER_DEG_LNG = 84_500;

export function projectShadows(
  buildings: readonly Building[],
  sunAzimuthDeg: number,
  sunElevationDeg: number,
): BuildingShadow[] {
  if (sunElevationDeg <= MIN_USEFUL_ELEVATION_DEG) return [];

  const elRad = toRad(sunElevationDeg);
  // Shadow direction = opposite of sun bearing.
  const shadowDirRad = toRad((sunAzimuthDeg + 180) % 360);
  const sinDir = Math.sin(shadowDirRad);
  const cosDir = Math.cos(shadowDirRad);

  return buildings.map((b) => {
    const rawShadowM = b.height / Math.tan(elRad);
    const shadowM = Math.min(MAX_SHADOW_M, rawShadowM);
    const dxM = shadowM * sinDir;
    const dyM = shadowM * cosDir;
    const dxDeg = dxM / M_PER_DEG_LNG;
    const dyDeg = dyM / M_PER_DEG_LAT;

    const polygon = b.footprint.map(
      ([lng, lat]): [number, number] => [lng + dxDeg, lat + dyDeg],
    );

    return { buildingId: b.id, polygon };
  });
}

/**
 * Filter `buildings` to those whose footprint has at least one vertex
 * within `radiusM` meters of any vertex of the route polyline. Bbox
 * prefilter at the route extent keeps this O(buildings) — typical
 * NYC route + viewport: ~3 000 buildings, 100 polyline points, 50 ms
 * worst-case on a phone. Used to shrink the input to projectShadows
 * so per-sun-tick projection work stays cheap.
 *
 * Note: imports `Building` + `RoutePoint` lazily via duck-typing on
 * the input shapes so this file stays free of the higher-level type
 * imports (no circular risk).
 */
export function filterBuildingsNearPolyline<
  B extends { footprint: ReadonlyArray<readonly [number, number]> },
  P extends { lat: number; lng: number },
>(
  buildings: ReadonlyArray<B>,
  polyline: ReadonlyArray<P>,
  radiusM: number,
): B[] {
  if (buildings.length === 0 || polyline.length < 2) return [];
  // Route bbox + margin (in degrees) for the cheap first-pass prefilter.
  let routeS = Infinity;
  let routeN = -Infinity;
  let routeW = Infinity;
  let routeE = -Infinity;
  for (const p of polyline) {
    if (p.lat < routeS) routeS = p.lat;
    if (p.lat > routeN) routeN = p.lat;
    if (p.lng < routeW) routeW = p.lng;
    if (p.lng > routeE) routeE = p.lng;
  }
  const padLat = radiusM / M_PER_DEG_LAT;
  const padLng = radiusM / M_PER_DEG_LNG;
  routeS -= padLat;
  routeN += padLat;
  routeW -= padLng;
  routeE += padLng;

  const radiusSq = radiusM * radiusM;
  const out: B[] = [];
  for (const b of buildings) {
    // Skip when the entire footprint sits outside the route's padded bbox.
    let inBbox = false;
    for (const [lng, lat] of b.footprint) {
      if (lat >= routeS && lat <= routeN && lng >= routeW && lng <= routeE) {
        inBbox = true;
        break;
      }
    }
    if (!inBbox) continue;

    // Per-vertex distance check against every polyline point. The
    // building is kept iff any footprint vertex sits within radiusM
    // of any polyline vertex. Approximate (uses meters/deg constants
    // at NYC latitude) but a few-meter error doesn't change the
    // 200-m cutoff in practice.
    let near = false;
    outer: for (const [lng, lat] of b.footprint) {
      for (const p of polyline) {
        const dE = (lng - p.lng) * M_PER_DEG_LNG;
        const dN = (lat - p.lat) * M_PER_DEG_LAT;
        if (dE * dE + dN * dN <= radiusSq) {
          near = true;
          break outer;
        }
      }
    }
    if (near) out.push(b);
  }
  return out;
}

/**
 * Ray-cast point-in-polygon test in lng/lat space. Used by route coloring to
 * decide whether each route segment midpoint falls inside any building
 * shadow.
 */
export function pointInPolygon(
  point: [number, number],
  polygon: readonly [number, number][],
): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
