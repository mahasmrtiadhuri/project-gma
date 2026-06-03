// Glass building glare — the specular solar reflection from skyscrapers
// that turns specific sidewalk coordinates into thermal hot spots
// (~+15°F "feels like" per CLAUDE.md §1).
//
// Two stages:
//
//   1. Classify each Overpass building as glass-clad / not. Direct OSM
//      tags win; named glass towers win; untagged modern (post-2000)
//      buildings get a deterministic 30 % glass probability via id hash.
//
//   2. For each glass building, find the wall whose outward normal best
//      faces the sun, mirror the incoming sun ray across that normal
//      (R = I − 2(I·N)N), and project the reflected ray from the wall
//      mid-height onto the ground. The intersection is the glare
//      hotspot — a ~15 m radius "warm-floor" patch.
//
// Output is a list of `GlareHotspot { lng, lat, buildingId,
// reflectionStrength }`. The route-coloring classifier checks segment
// midpoints against these hotspots (20 m radius) and marks matches as
// 'glare' with exposure 1.5 — penalized harder than direct sun.

import type { Building } from './overpass';

// Known glass-clad NYC towers — partial match on the OSM `name` tag.
// All entries lowercase; the matcher lowercases the name before checking.
const KNOWN_GLASS_TOWERS = [
  'one vanderbilt',
  'hudson yards',
  '30 hudson yards',
  '10 hudson yards',
  '35 hudson yards',
  '55 hudson yards',
  'salesforce tower',
  'one world trade',
  '1 world trade',
  'bank of america tower',
  '432 park',
  '432 park avenue',
  'central park tower',
  'one57',
  '157 west 57',
  'time warner center',
  'comcast tower',
  'hearst tower',
  'seagram building',
  'lever house',
  'lipstick building',
  '53 west 53',
  '220 central park south',
  '111 west 57',
  '270 park avenue',
  'jpmorgan chase tower',
  '7 world trade',
  '4 world trade',
  '3 world trade',
  '111 murray',
  'manhattan west',
];

const UNTAGGED_MODERN_GLASS_PROBABILITY = 0.3;
const MODERN_CONSTRUCTION_YEAR = 2000;
const MIN_SUN_ELEVATION_DEG = 10; //   below this, glare too low to be meaningful
const MIN_BUILDING_HEIGHT_M = 12; //   skip squat structures
const MAX_GLARE_DISTANCE_M = 60; //    cap horizontal travel of reflected ray
// NYC-latitude meters-per-degree conversions, same constants used elsewhere.
const M_PER_DEG_LAT = 111_000;
const M_PER_DEG_LNG = 84_500;

export interface GlareHotspot {
  /** Hotspot center coords (where reflected ray hits z=0). */
  lng: number;
  lat: number;
  /** Source building id (`way/123…` or `solar/N`). */
  buildingId: string;
  /**
   * Strength of the reflection 0..1 — cos of the angle between the
   * sun-facing wall normal and the sun direction. 1 = wall directly
   * faces the sun (peak reflection); 0 = grazing.
   */
  reflectionStrength: number;
  /** Building height in meters (for telemetry / future intensity scaling). */
  buildingHeightM: number;
}

/**
 * Why a building was classified as glass-clad — surfaced in the App.tsx
 * debug log so the user can verify the classifier is firing on real
 * Midtown glass towers and not just hash-roulette guesses.
 */
export type GlassReason =
  | 'tag-material'
  | 'tag-facade'
  | 'tag-cladding'
  | 'name-match'
  | 'modern-probabilistic';

/**
 * Classify an OSM building as glass-clad AND report why. Returns null
 * when the building doesn't match any rule. Order of precedence:
 *   1. Explicit OSM tags (`building:material|facade|cladding = glass`).
 *   2. Building name matches a known glass tower (substring, lowercase).
 *   3. Untagged + construction year > 2000 → deterministic 30% by id hash.
 *   4. Otherwise → null (not glass).
 */
export function classifyGlassReason(
  building: Building,
): { reason: GlassReason; detail: string } | null {
  const tags = building.tags ?? {};
  if (tags['building:material'] === 'glass') {
    return { reason: 'tag-material', detail: 'building:material=glass' };
  }
  if (tags['building:facade'] === 'glass') {
    return { reason: 'tag-facade', detail: 'building:facade=glass' };
  }
  if (tags['building:cladding'] === 'glass') {
    return { reason: 'tag-cladding', detail: 'building:cladding=glass' };
  }
  const name = (building.name ?? '').toLowerCase();
  if (name) {
    const match = KNOWN_GLASS_TOWERS.find((tower) => name.includes(tower));
    if (match) {
      return {
        reason: 'name-match',
        detail: `name "${building.name}" matched known tower "${match}"`,
      };
    }
  }
  const startDate = tags['start_date'] ?? tags['construction:year'] ?? '';
  const year = parseInt(startDate.slice(0, 4), 10);
  if (!Number.isNaN(year) && year > MODERN_CONSTRUCTION_YEAR) {
    if (idHashProbability(building.id) < UNTAGGED_MODERN_GLASS_PROBABILITY) {
      return {
        reason: 'modern-probabilistic',
        detail: `start_date=${year}, id hash within 30% probability cohort`,
      };
    }
  }
  return null;
}

/**
 * Convenience boolean predicate — true iff the building is glass-clad.
 */
export function isGlassBuilding(building: Building): boolean {
  return classifyGlassReason(building) !== null;
}

/**
 * Compute a single glare hotspot per glass building — the projected
 * ground impact of the reflected sun ray.
 *
 * Returns null when:
 *   - sun is below the minimum elevation threshold,
 *   - the building is too short for meaningful reflection,
 *   - no wall faces the sun (all walls are in shadow), or
 *   - the footprint has fewer than 2 vertices.
 */
export function computeGlareHotspot(
  building: Building,
  sunAzimuthDeg: number,
  sunElevationDeg: number,
): GlareHotspot | null {
  if (sunElevationDeg < MIN_SUN_ELEVATION_DEG) return null;
  if (building.height < MIN_BUILDING_HEIGHT_M) return null;
  if (building.footprint.length < 2) return null;

  // Sun direction (toward the sun) projected onto the horizontal plane,
  // in (east, north) meters-per-degree-of-rotation units. The vertical
  // component drops out — we only need the horizontal mirror for the
  // ground-plane hotspot calculation.
  const sunRad = (sunAzimuthDeg * Math.PI) / 180;
  const sunToHorizE = Math.sin(sunRad);
  const sunToHorizN = Math.cos(sunRad);

  // Incoming ray (from sun toward ground) horizontal = −(sunToHoriz).
  const iE = -sunToHorizE;
  const iN = -sunToHorizN;

  // Find the footprint edge whose outward normal best faces the sun.
  // For each edge: candidate normal = 90° rotation of the edge vector;
  // flip sign if the unflipped one points away from the sun (we want
  // the OUTWARD normal in the sun's half-plane).
  let best: {
    midLng: number;
    midLat: number;
    normalE: number;
    normalN: number;
    dotWithSun: number;
  } | null = null;

  const ring = building.footprint;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i]!;
    const [lng2, lat2] = ring[i + 1]!;
    const edgeE = (lng2 - lng1) * M_PER_DEG_LNG;
    const edgeN = (lat2 - lat1) * M_PER_DEG_LAT;
    let normalE = edgeN; //  90° CCW
    let normalN = -edgeE;
    const nLen = Math.hypot(normalE, normalN);
    if (nLen < 0.001) continue;
    normalE /= nLen;
    normalN /= nLen;
    // Force the normal to face the sun (positive dot with sun direction).
    let dot = sunToHorizE * normalE + sunToHorizN * normalN;
    if (dot < 0) {
      normalE = -normalE;
      normalN = -normalN;
      dot = -dot;
    }
    if (!best || dot > best.dotWithSun) {
      best = {
        midLng: (lng1 + lng2) / 2,
        midLat: (lat1 + lat2) / 2,
        normalE,
        normalN,
        dotWithSun: dot,
      };
    }
  }

  if (!best || best.dotWithSun <= 0) return null;

  // Reflected ray (horizontal component): R = I − 2(I·N)N.
  const iDotN = iE * best.normalE + iN * best.normalN;
  const rE = iE - 2 * iDotN * best.normalE;
  const rN = iN - 2 * iDotN * best.normalN;

  // Distance from the reflecting wall to the ground hotspot:
  // assume reflection happens at half the building height, ray drops
  // at tan(elevation) per meter of horizontal travel.
  const elRad = (sunElevationDeg * Math.PI) / 180;
  const verticalDrop = building.height / 2;
  const horizMetersUncapped = verticalDrop / Math.tan(elRad);
  const horizM = Math.min(MAX_GLARE_DISTANCE_M, Math.max(0, horizMetersUncapped));

  const dxDeg = (rE * horizM) / M_PER_DEG_LNG;
  const dyDeg = (rN * horizM) / M_PER_DEG_LAT;

  return {
    lng: best.midLng + dxDeg,
    lat: best.midLat + dyDeg,
    buildingId: building.id,
    reflectionStrength: best.dotWithSun,
    buildingHeightM: building.height,
  };
}

/**
 * Find the nearest glare hotspot within `radiusM` of (lng, lat).
 * Bbox-prefilter then haversine compare. Used by the route classifier
 * to decide whether a segment midpoint is in a glare zone.
 */
export function nearestGlareHotspot(
  lng: number,
  lat: number,
  hotspots: readonly GlareHotspot[] | null,
  radiusM: number,
): { hotspot: GlareHotspot; distanceM: number } | null {
  if (!hotspots || hotspots.length === 0) return null;
  const radiusDegLat = radiusM / M_PER_DEG_LAT;
  const radiusDegLng = radiusM / M_PER_DEG_LNG;
  let best: { hotspot: GlareHotspot; distanceM: number } | null = null;
  for (const h of hotspots) {
    if (Math.abs(h.lat - lat) > radiusDegLat) continue;
    if (Math.abs(h.lng - lng) > radiusDegLng) continue;
    const dE = (h.lng - lng) * M_PER_DEG_LNG;
    const dN = (h.lat - lat) * M_PER_DEG_LAT;
    const distM = Math.hypot(dE, dN);
    if (distM > radiusM) continue;
    if (!best || distM < best.distanceM) {
      best = { hotspot: h, distanceM: distM };
    }
  }
  return best;
}

/**
 * Deterministic 0..1 from an OSM id. Same id always yields the same
 * value, so building classification is stable across re-fetches.
 */
function idHashProbability(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h % 1000) / 1000;
}
