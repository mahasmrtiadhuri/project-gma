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
