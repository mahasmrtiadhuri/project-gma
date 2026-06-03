// Venturi wind-canyon amplification — per CLAUDE.md §4 Module B.
//
//   v_local = v_ambient × (W_entry / W_canyon)
//
// For a route segment at (midLng, midLat) with bearing θ, we look
// perpendicular to θ on both sides for the nearest building. The
// canyon width is approximated as the sum of those two perpendicular
// distances; the open-street baseline `W_entry` is fixed at 100 m.
// Tall buildings amplify the effect by √(avgHeight / 30 m).
//
// Return is clamped to [1.0, MAX_AMPLIFIER]:
//   1.0 when one side is open (intersection, park, water frontage)
//   1.0 when canyon is wider than the baseline (no narrowing)
//   up to MAX_AMPLIFIER for narrow, tall canyons (Midtown 6th Ave at noon)
//
// Pure function — caller owns the building list (OSM + Solar-derived).
// Walking the building array is O(B) per segment; for typical NYC
// viewports (B ≤ 500, segments ≤ 200) that's well under one frame.

import type { Building } from './overpass';

const PERP_SEARCH_RADIUS_M = 60;
const CANYON_BASELINE_M = 100;
const HEIGHT_BASELINE_M = 30;
const MAX_AMPLIFIER = 3.0;

export interface VenturiDiagnostic {
  amplifier: number;
  canyonWidthM: number | null;
  leftDistM: number | null;
  rightDistM: number | null;
  avgHeightM: number | null;
}

/**
 * Compute the Venturi amplification factor at a single point. Use
 * `computeVenturiAmplifier()` when you only need the scalar; this
 * variant also reports the underlying widths + heights for diagnostics.
 */
export function computeVenturiDiagnostic(
  midLng: number,
  midLat: number,
  segmentBearingDeg: number,
  buildings: readonly Building[],
): VenturiDiagnostic {
  // Unit vector perpendicular to the segment (bearing + 90°).
  // (perpE, perpN) are the east and north components in meters per
  // degree of bearing rotation; multiplying with (dE, dN) gives a
  // signed perpendicular projection in meters.
  const perpRad = ((segmentBearingDeg + 90) * Math.PI) / 180;
  const perpE = Math.sin(perpRad);
  const perpN = Math.cos(perpRad);

  let nearestPositiveM = Infinity;
  let nearestPositiveHeight = 0;
  let nearestNegativeM = Infinity;
  let nearestNegativeHeight = 0;

  for (const b of buildings) {
    // Centroid of the footprint — cheap approximation; for shadow-cast
    // accuracy we'd use the closest vertex, but for canyon detection
    // the centroid is fine and 10–20× faster across hundreds of polys.
    let cLng = 0;
    let cLat = 0;
    for (const [lng, lat] of b.footprint) {
      cLng += lng;
      cLat += lat;
    }
    cLng /= b.footprint.length;
    cLat /= b.footprint.length;

    const dLng = cLng - midLng;
    const dLat = cLat - midLat;
    const dE = dLng * 84_500; //   ≈ m per degree of longitude at NYC latitude
    const dN = dLat * 111_000; //  ≈ m per degree of latitude
    const distM = Math.hypot(dE, dN);
    if (distM > PERP_SEARCH_RADIUS_M) continue;

    // Signed projection onto the perpendicular axis. Positive vs negative
    // splits "left of segment" from "right of segment". A canyon needs
    // a building on BOTH sides — one-sided cases short-circuit to 1.0.
    const perpDot = dE * perpE + dN * perpN;
    if (perpDot > 0) {
      if (distM < nearestPositiveM) {
        nearestPositiveM = distM;
        nearestPositiveHeight = b.height;
      }
    } else {
      if (distM < nearestNegativeM) {
        nearestNegativeM = distM;
        nearestNegativeHeight = b.height;
      }
    }
  }

  if (nearestPositiveM === Infinity || nearestNegativeM === Infinity) {
    return {
      amplifier: 1.0,
      canyonWidthM: null,
      leftDistM:
        nearestNegativeM === Infinity ? null : nearestNegativeM,
      rightDistM:
        nearestPositiveM === Infinity ? null : nearestPositiveM,
      avgHeightM: null,
    };
  }

  const canyonWidth = nearestPositiveM + nearestNegativeM;
  const avgHeight = (nearestPositiveHeight + nearestNegativeHeight) / 2;

  if (canyonWidth >= CANYON_BASELINE_M) {
    return {
      amplifier: 1.0,
      canyonWidthM: canyonWidth,
      leftDistM: nearestNegativeM,
      rightDistM: nearestPositiveM,
      avgHeightM: avgHeight,
    };
  }

  const widthFactor = CANYON_BASELINE_M / canyonWidth;
  const heightFactor = Math.sqrt(
    Math.max(0.3, avgHeight / HEIGHT_BASELINE_M),
  );
  const amplifier = Math.max(
    1.0,
    Math.min(MAX_AMPLIFIER, widthFactor * heightFactor),
  );

  return {
    amplifier,
    canyonWidthM: canyonWidth,
    leftDistM: nearestNegativeM,
    rightDistM: nearestPositiveM,
    avgHeightM: avgHeight,
  };
}

export function computeVenturiAmplifier(
  midLng: number,
  midLat: number,
  segmentBearingDeg: number,
  buildings: readonly Building[],
): number {
  return computeVenturiDiagnostic(
    midLng,
    midLat,
    segmentBearingDeg,
    buildings,
  ).amplifier;
}
