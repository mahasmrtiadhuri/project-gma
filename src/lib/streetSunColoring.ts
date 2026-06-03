// Continuous per-segment sun exposure for street centerlines.
//
// Each Overpass street is split into [a, b] pairs; each pair gets:
//   exposure = max(0, cos(segmentBearing − sunAzimuth)) × sunIntensity
//
// where sunIntensity = (sun above horizon) × (1 − cloudCover/100). The
// SAME exposure number is then (a) used to derive the render color and
// (b) sampled by the route scorer in routeExposureScoring.ts. That keeps
// the visual overlay and the route comfort score provably consistent —
// they are literally the same number.
//
// We also build a grid hash index over segment midpoints so the route
// scorer can resolve "what's the exposure at (lng, lat)?" in O(1) per
// query without scanning thousands of OSM segments.

import { bearingDegrees } from './hlciRouter';
import type { StreetWay } from './overpass';

export interface StreetSegmentExposure {
  /** Polyline segment as [lng, lat] pair. */
  path: [[number, number], [number, number]];
  midLng: number;
  midLat: number;
  /** Continuous solar exposure 0..1. 0 = fully shaded, 1 = facing full sun. */
  exposure: number;
  /** Render color derived from exposure (binary palette, alpha scales). */
  color: [number, number, number, number];
}

export interface StreetExposureIndex {
  segments: StreetSegmentExposure[];
  /** lngBucket|latBucket → indices into `segments`. */
  grid: Map<string, number[]>;
  /** Grid cell size in degrees. */
  cellSize: number;
}

// Per the UI-polish pass, the street overlay was overpowering Positron's
// place labels — cap at 0.25 alpha so the overlay reads as a tint rather
// than competing with the basemap. Palette also retuned to the route
// polyline's vivid amber-500 / blue-500 for visual consistency.
const SUN_RGB: [number, number, number] = [245, 158, 11]; //  amber-500 #F59E0B
const SHADE_RGB: [number, number, number] = [59, 130, 246]; // blue-500  #3B82F6
const SUN_ALPHA_MAX = 64; // 0.25 × 255
const SHADE_ALPHA = 45; //   ~0.18 × 255 — slightly fainter so sunny still pops

const EXPOSURE_AMBER_THRESHOLD = 0.1;
const GRID_CELL_DEG = 0.001; // ~100 m at NYC latitude

export function colorizeStreets(
  streets: readonly StreetWay[],
  sunAzimuthDeg: number,
  sunElevationDeg: number,
  cloudCoverPct: number,
): StreetSegmentExposure[] {
  const sunIsUp = sunElevationDeg > 0;
  const cloudFactor = Math.max(0, 1 - cloudCoverPct / 100);
  const sunIntensity = sunIsUp ? cloudFactor : 0;

  const out: StreetSegmentExposure[] = [];
  for (const street of streets) {
    for (let i = 0; i < street.path.length - 1; i++) {
      const a = street.path[i]!;
      const b = street.path[i + 1]!;
      const bearing = bearingDegrees(
        { lng: a[0], lat: a[1] },
        { lng: b[0], lat: b[1] },
      );
      const facing = Math.max(0, Math.cos(toRad(bearing - sunAzimuthDeg)));
      const exposure = facing * sunIntensity;

      const color = colorForExposure(exposure);

      out.push({
        path: [a, b],
        midLng: (a[0] + b[0]) / 2,
        midLat: (a[1] + b[1]) / 2,
        exposure,
        color,
      });
    }
  }
  return out;
}

function colorForExposure(
  exposure: number,
): [number, number, number, number] {
  if (exposure <= EXPOSURE_AMBER_THRESHOLD) {
    return [SHADE_RGB[0], SHADE_RGB[1], SHADE_RGB[2], SHADE_ALPHA];
  }
  // Amber, alpha scales with exposure between SHADE_ALPHA (at threshold)
  // and SUN_ALPHA_MAX (at exposure = 1.0). Higher exposure → more saturated.
  const t = (exposure - EXPOSURE_AMBER_THRESHOLD) / (1 - EXPOSURE_AMBER_THRESHOLD);
  const alpha = Math.round(SHADE_ALPHA + (SUN_ALPHA_MAX - SHADE_ALPHA) * t);
  return [SUN_RGB[0], SUN_RGB[1], SUN_RGB[2], alpha];
}

export function buildStreetIndex(
  segments: StreetSegmentExposure[],
): StreetExposureIndex {
  const grid = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const key = cellKey(s.midLng, s.midLat, GRID_CELL_DEG);
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(i);
  }
  return { segments, grid, cellSize: GRID_CELL_DEG };
}

/**
 * Nearest street segment to (lng, lat) within `maxRadiusM`. Returns null
 * when nothing's close enough. Searches the cell containing the point + a
 * widening neighborhood ring until either a match is found or the ring
 * exceeds `maxRadiusM`.
 */
export function nearestStreetSegment(
  index: StreetExposureIndex,
  lng: number,
  lat: number,
  maxRadiusM: number,
): { segment: StreetSegmentExposure; distanceM: number } | null {
  const cellSize = index.cellSize;
  const cellX = Math.floor(lng / cellSize);
  const cellY = Math.floor(lat / cellSize);

  // Convert maxRadiusM to a max ring count in cells.
  const meterPerCellLat = cellSize * 111_000;
  const maxRing = Math.max(1, Math.ceil(maxRadiusM / meterPerCellLat));

  let best: { segment: StreetSegmentExposure; distanceM: number } | null = null;
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        // Only visit cells on the perimeter of this ring (already covered the rest).
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const bucket = index.grid.get(`${cellX + dx}|${cellY + dy}`);
        if (!bucket) continue;
        for (const i of bucket) {
          const s = index.segments[i]!;
          const dm = haversineMeters(lng, lat, s.midLng, s.midLat);
          if (dm > maxRadiusM) continue;
          if (!best || dm < best.distanceM) {
            best = { segment: s, distanceM: dm };
          }
        }
      }
    }
    // Early-out: once we have a hit AND have searched at least the immediate
    // neighborhood, any further-out cell can't beat a closer match.
    if (best && ring >= 1) return best;
  }
  return best;
}

function cellKey(lng: number, lat: number, cellSize: number): string {
  return `${Math.floor(lng / cellSize)}|${Math.floor(lat / cellSize)}`;
}

function haversineMeters(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
