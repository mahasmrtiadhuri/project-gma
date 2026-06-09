// Per-segment route polyline coloring. Strict binary "is this segment in
// the sun?" — every segment is either warm amber (sunny) or cool blue
// (shaded). No neutral / white default; the whole route reads as a
// continuous heat map.
//
// Sun-mode classification priority:
//   1. Sun below horizon         → 'low-sun-angle'  (shaded — global)
//   2. Inside a building shadow  → 'building-shadow'(shaded)
//   3. Within 15 m of a tree     → 'tree-canopy'    (shaded)
//   4. Solar API sample in range → use measured exposureRatio
//      ratio >  SOLAR_SUNNY_RATIO  → 'sunny'
//      else                       → 'low-sun-angle'
//   5. Else (bearing fallback)   → cos(bearing − sunAz) > 0 → 'sunny'
//                                  else                     → 'low-sun-angle'
//
// Wind-mode keeps two-tone headwind / tailwind. Each segment carries a
// human-readable `label` for the hover/tap tooltip in GMACanvas.

import { bearingDegrees, type RoutePoint } from './hlciRouter';
import { pointInPolygon, type BuildingShadow } from './buildingShadows';
import type { Building, TreeNode } from './overpass';
import type { SolarSample } from '../hooks/useSolarAPI';
import type { PrecipitationType } from '../hooks/useWeatherData';
import { computeVenturiAmplifier } from './venturi';
import { nearestGlareHotspot, type GlareHotspot } from './glassGlare';

const ROUTE_ALTITUDE_M = 2;
// Trees only shade a segment when (a) the canopy is genuinely near the
// segment AND (b) the sun is low enough that the leaf canopy actually
// projects onto the sidewalk. At noon-ish (>60° elevation) sparse
// street trees throw near-vertical shadows that miss the sidewalk
// entirely, so the prior 15 m all-day rule was over-claiming shade.
const TREE_RADIUS_M = 8;
const TREE_MAX_USEFUL_SUN_ELEVATION_DEG = 60;
// Bearing fallback: a segment heading within ~72° of the sun bearing
// (cos > 0.3) reads as sunny. The previous `cos > 0` (within 90°) was
// over-claiming sun on diagonally-oriented streets where the sun glances
// off the building face rather than landing on the sidewalk.
const BEARING_SUNNY_THRESHOLD = 0.3;
const SOLAR_SAMPLE_RADIUS_M = 300;
// A roof getting > 50% of its theoretical max annual sunshine is "well
// exposed" → adjacent sidewalk likely sunny. Lower → likely shaded.
const SOLAR_SUNNY_RATIO = 0.5;

// Sun-mode palette — vivid Tailwind-style brand colors. Sunny = amber 500,
// shaded = blue 500, tree-canopy = emerald 500. The previous three-shades-
// of-blue scheme has been collapsed: building shadow and bearing fallback
// now share the same vivid blue. The diagnostic tooltip still reports
// WHICH branch fired, so audit transparency isn't lost — the visual just
// reads cleaner. Glare is the highest-intensity sun reason — deep red.
const AMBER: [number, number, number, number] = [245, 158, 11, 245]; //   #F59E0B amber-500
const BUILDING_SHADOW_BLUE: [number, number, number, number] = [59, 130, 246, 245]; // #3B82F6 blue-500
const TREE_CANOPY_GREEN: [number, number, number, number] = [16, 185, 129, 245]; //   #10B981 emerald-500
const LOW_SUN_BLUE: [number, number, number, number] = [59, 130, 246, 245]; //        #3B82F6 blue-500
const GLARE_RED: [number, number, number, number] = [220, 38, 38, 245]; //            #DC2626 red-600

const GLARE_HOTSPOT_RADIUS_M = 20; // segment-to-hotspot match radius
const GLARE_SEGMENT_EXPOSURE = 1.5; // worse than direct sun — pushes hlciCost higher

// Wind-mode palette — vivid violet for headwind / canyon, emerald for
// sheltered. Same Tailwind-500 family as the sun palette so the route
// reads as a coherent design language regardless of which filter is
// active. Threshold is per-segment exposure 0.5 (Venturi-amplified).
const HEADWIND_PURPLE: [number, number, number, number] = [168, 85, 247, 245]; // violet-500
const TAILWIND_GREEN: [number, number, number, number] = [16, 185, 129, 245]; //  emerald-500

const WIND_SUNNY_THRESHOLD = 0.5; // segment exposure > 0.5 → headwind

// Rain-mode palette — cyan for sheltered (rain not in face), slate-grey
// for exposed (walking into rain).
const RAIN_EXPOSED_GREY: [number, number, number, number] = [71, 85, 105, 245]; //  slate-600
const RAIN_SHELTERED_CYAN: [number, number, number, number] = [6, 182, 212, 245]; // cyan-500

// Snow-mode palette — light blue for sheltered, deep blue for exposed.
const SNOW_EXPOSED_BLUE: [number, number, number, number] = [30, 58, 138, 245]; //  blue-900
const SNOW_SHELTERED_PALE: [number, number, number, number] = [186, 230, 253, 245]; // sky-200

// Segment is classified as rain/snow-EXPOSED above this exposure value.
// The exposure = cos(bearing - windFrom) × probability/100, so the
// threshold is lower than wind's 0.5 — even moderate facing in a 50%
// shower should classify as exposed.
const PRECIP_EXPOSED_THRESHOLD = 0.3;

export type SunReason =
  | 'sunny'
  | 'building-shadow'
  | 'tree-canopy'
  | 'low-sun-angle'
  | 'glare';

export type WindReason = 'headwind' | 'sheltered';

export type PrecipReason =
  | 'rain-exposed'
  | 'rain-sheltered'
  | 'snow-exposed'
  | 'snow-sheltered';

export type SegmentReason = SunReason | WindReason | PrecipReason;

const SUN_LABELS: Record<SunReason, string> = {
  sunny: 'Sunny — direct sun exposure',
  'building-shadow': 'Shaded — building shadow',
  'tree-canopy': 'Shaded — tree canopy',
  'low-sun-angle': 'Shaded — facing away from sun',
  glare: 'Glass glare — building reflection, +15°F feels like temperature',
};

const WIND_LABELS: Record<WindReason, string> = {
  headwind: 'Headwind — walking into wind',
  sheltered: 'Sheltered — wind not in your face',
};

const PRECIP_LABELS: Record<PrecipReason, string> = {
  'rain-exposed': 'Rain exposed — wind driving rain into your face',
  'rain-sheltered': 'Rain sheltered — wind not in your face',
  'snow-exposed': 'Snow exposed — wind driving snow into your face',
  'snow-sheltered': 'Snow sheltered — wind not in your face',
};

export type ColoringMode = 'sun' | 'wind' | 'rain';

export interface ColoredSegment {
  path: [number, number, number][];
  color: [number, number, number, number];
  /** Classification key used for analytics + the legend chip lookups. */
  reason: SegmentReason;
  /** Human-readable tooltip headline shown on hover / tap. */
  label: string;
  /**
   * Full audit record for the sun classification of this segment — used
   * by the hover tooltip to show *exactly* why the segment is the color
   * it is (Solar API value, nearest tree distance, building shadow hit
   * or miss, final bearing). Absent on wind-mode segments.
   */
  diagnostic?: SunDiagnostic;
}

export function colorizeRoute(
  polyline: readonly RoutePoint[],
  coloringMode: ColoringMode,
  sunAzimuthDeg: number,
  sunElevationDeg: number,
  windFromDeg: number,
  windSpeedMph: number,
  precipitationProbability: number,
  precipitationType: PrecipitationType,
  trees: readonly TreeNode[] | null,
  buildingShadows: readonly BuildingShadow[] | null,
  buildings: readonly Building[] | null = null,
  solarSamples: readonly SolarSample[] | null = null,
  glareHotspots: readonly GlareHotspot[] | null = null,
): ColoredSegment[] {
  if (polyline.length < 2) return [];

  const isWindFilter = coloringMode === 'wind';
  const isRainFilter = coloringMode === 'rain';
  const isSnow = precipitationType === 'snow';
  const segments: ColoredSegment[] = [];

  // Per-route counters logged once at the end so we can tell at a glance
  // whether the demo is showing real Solar API data or the bearing fallback.
  let usedSolarCount = 0;
  let usedBearingCount = 0;
  let shadowedCount = 0;
  let treeShadedCount = 0;
  let windCanyonCount = 0;
  let windHeadwindCount = 0;
  let precipExposedCount = 0;
  let glareCount = 0;

  // Wind intensity factor (0..1) — multiplies the Venturi-amplified
  // facing score so that low wind days never classify any segment as a
  // headwind (everything reads as 'sheltered').
  const windIntensity = Math.max(0, Math.min(1, windSpeedMph / 20));
  // Precipitation probability factor (0..1) drives the rain branch.
  const precipFactor = Math.max(
    0,
    Math.min(1, precipitationProbability / 100),
  );

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const bearing = bearingDegrees(a, b);
    const midLng = (a.lng + b.lng) / 2;
    const midLat = (a.lat + b.lat) / 2;

    let color: [number, number, number, number];
    let reason: SegmentReason;
    let diagnostic: SunDiagnostic | undefined;

    if (isWindFilter) {
      // Same Venturi-amplified exposure formula as
      // sampleRouteWindExposure → identical numbers as the wind score.
      const windFacing = Math.max(
        0,
        Math.cos(toRad(bearing - windFromDeg)),
      );
      const amplifier =
        buildings && buildings.length > 0
          ? computeVenturiAmplifier(midLng, midLat, bearing, buildings)
          : 1.0;
      const exposure = Math.max(
        0,
        Math.min(1, windFacing * amplifier * windIntensity),
      );
      if (amplifier > 1.05) windCanyonCount++;
      if (exposure > WIND_SUNNY_THRESHOLD) {
        color = HEADWIND_PURPLE;
        reason = 'headwind';
        windHeadwindCount++;
      } else {
        color = TAILWIND_GREEN;
        reason = 'sheltered';
      }
    } else if (isRainFilter) {
      // Same formula as sampleRoutePrecipExposure — segment facing the
      // wind takes the brunt of wind-driven precipitation. Snow flips
      // the palette to the cool blue family; rain stays in cyan/grey.
      const windFacing = Math.max(
        0,
        Math.cos(toRad(bearing - windFromDeg)),
      );
      const exposure = Math.max(0, Math.min(1, windFacing * precipFactor));
      const exposed = exposure > PRECIP_EXPOSED_THRESHOLD;
      if (exposed) precipExposedCount++;
      if (isSnow) {
        color = exposed ? SNOW_EXPOSED_BLUE : SNOW_SHELTERED_PALE;
        reason = exposed ? 'snow-exposed' : 'snow-sheltered';
      } else {
        color = exposed ? RAIN_EXPOSED_GREY : RAIN_SHELTERED_CYAN;
        reason = exposed ? 'rain-exposed' : 'rain-sheltered';
      }
    } else {
      const { classification, diagnostic: segDiagnostic } =
        classifyWithDiagnostics(
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
      reason = classification.reason;
      color = sunReasonColor(reason);
      diagnostic = segDiagnostic;

      if (classification.via === 'glare') glareCount++;
      else if (classification.via === 'shadow') shadowedCount++;
      else if (classification.via === 'tree') treeShadedCount++;
      else if (classification.via === 'solar') usedSolarCount++;
      else if (classification.via === 'bearing') usedBearingCount++;
    }

    const label = isRainFilter
      ? PRECIP_LABELS[reason as PrecipReason]
      : isWindFilter
        ? WIND_LABELS[reason as WindReason]
        : SUN_LABELS[reason as SunReason];

    segments.push({
      path: [
        [a.lng, a.lat, ROUTE_ALTITUDE_M],
        [b.lng, b.lat, ROUTE_ALTITUDE_M],
      ],
      color,
      reason,
      label,
      diagnostic,
    });
  }

  return segments;
}

export type SunVia =
  | 'shadow'
  | 'tree'
  | 'solar'
  | 'bearing'
  | 'night'
  | 'glare';

export interface SunClassification {
  /**
   * Segment exposure used by both the visual amber/blue/red split and
   * the absolute comfort score. 1 = sunny segment, 0 = shaded segment.
   * Glare segments report 1.5 — worse than direct sun, penalized harder
   * in `composeHlciCost`. `meanSunExposure` is clamped at 1 for the UI
   * percent display but can exceed 1 internally on glare-heavy routes.
   */
  exposure: number;
  reason: SunReason;
  /** Which branch of the priority chain produced the classification. */
  via: SunVia;
}

/**
 * Full audit record per segment — every input check is evaluated, not
 * just the winning one, so the tooltip and the console log can show the
 * complete reasoning ("Solar API said 0.42 → shaded; nearest tree 23 m
 * away → not in canopy; not in any shadow polygon; bearing 145° vs sun
 * 130° → Δ15° → bearing-fallback would have said sunny but Solar API
 * outranks it"). This is the layer the demo audience uses to verify
 * the visualization isn't fabricated.
 */
export interface SunDiagnostic {
  midLng: number;
  midLat: number;
  bearingDeg: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  /** cos(bearing − sunAz), -1..1. Sign drives the bearing branch. */
  bearingFacing: number;
  /** Whether `sunElevationDeg > 0`. */
  sunAboveHorizon: boolean;
  /** True iff the midpoint sits inside any projected building-shadow polygon. */
  buildingShadowHit: boolean;
  /** Meters to the nearest tree node (any distance). null when no trees were supplied. */
  nearestTreeDistanceM: number | null;
  /** True iff a tree sits within TREE_RADIUS_M of the midpoint. */
  inTreeCanopy: boolean;
  /**
   * Nearest Solar API sample within SOLAR_SAMPLE_RADIUS_M, with its
   * measured ratio and how far away (meters) it is. null when no sample
   * within range or none had an exposureRatio.
   */
  solarSample: {
    exposureRatio: number;
    distanceM: number;
    lat: number;
    lng: number;
  } | null;
  /**
   * Nearest glass-glare hotspot within GLARE_HOTSPOT_RADIUS_M, with the
   * source building id and the reflection strength. Null when no
   * hotspots in range. When present this wins the classification — a
   * specular sun reflection beats any other on-ground signal.
   */
  glareHotspot: {
    distanceM: number;
    buildingId: string;
    reflectionStrength: number;
  } | null;
}

const TREE_NEAREST_SEARCH_RADIUS_M = 100;

/**
 * Classify a route polyline segment as sunny / shaded using the SAME
 * priority chain the visual heat-map relies on. Exported so the comfort
 * scorer in routeExposureScoring.ts can stay literally in sync with the
 * on-map color of each segment.
 */
export function classifyRouteSegmentSun(
  midLng: number,
  midLat: number,
  bearing: number,
  sunAzimuthDeg: number,
  sunElevationDeg: number,
  buildingShadows: readonly BuildingShadow[] | null,
  trees: readonly TreeNode[] | null,
  solarSamples: readonly SolarSample[] | null,
  glareHotspots: readonly GlareHotspot[] | null = null,
): SunClassification {
  return classifyWithDiagnostics(
    midLng,
    midLat,
    bearing,
    sunAzimuthDeg,
    sunElevationDeg,
    buildingShadows,
    trees,
    solarSamples,
    glareHotspots,
  ).classification;
}

/**
 * Like `classifyRouteSegmentSun` but also returns the full audit record
 * for the segment (every check's result, regardless of which one won).
 */
export function classifyWithDiagnostics(
  midLng: number,
  midLat: number,
  bearing: number,
  sunAzimuthDeg: number,
  sunElevationDeg: number,
  buildingShadows: readonly BuildingShadow[] | null,
  trees: readonly TreeNode[] | null,
  solarSamples: readonly SolarSample[] | null,
  glareHotspots: readonly GlareHotspot[] | null = null,
): { classification: SunClassification; diagnostic: SunDiagnostic } {
  const sunAboveHorizon = sunElevationDeg > 0;
  const bearingFacing = Math.cos(toRad(bearing - sunAzimuthDeg));

  // Evaluate every check up front so the diagnostic is complete even when
  // the winner short-circuits later branches.
  const buildingShadowHit =
    !!buildingShadows &&
    isInAnyShadow([midLng, midLat], buildingShadows);

  const nearestTreeDistanceM =
    trees && trees.length > 0
      ? findNearestTreeDistance(midLng, midLat, trees, TREE_NEAREST_SEARCH_RADIUS_M)
      : null;
  // Tree canopy only counts when (i) there's a tree within
  // TREE_RADIUS_M of the segment AND (ii) the sun is low enough that
  // the canopy actually casts onto the sidewalk (elevation < 60°).
  const inTreeCanopy =
    nearestTreeDistanceM != null &&
    nearestTreeDistanceM < TREE_RADIUS_M &&
    sunElevationDeg < TREE_MAX_USEFUL_SUN_ELEVATION_DEG;

  const solarSample = findNearestSolarSample(midLng, midLat, solarSamples);

  const nearestGlare = nearestGlareHotspot(
    midLng,
    midLat,
    glareHotspots,
    GLARE_HOTSPOT_RADIUS_M,
  );
  const glareHotspotDiag = nearestGlare
    ? {
        distanceM: nearestGlare.distanceM,
        buildingId: nearestGlare.hotspot.buildingId,
        reflectionStrength: nearestGlare.hotspot.reflectionStrength,
      }
    : null;

  const diagnostic: SunDiagnostic = {
    midLng,
    midLat,
    bearingDeg: bearing,
    sunAzimuthDeg,
    sunElevationDeg,
    bearingFacing,
    sunAboveHorizon,
    buildingShadowHit,
    nearestTreeDistanceM,
    inTreeCanopy,
    solarSample,
    glareHotspot: glareHotspotDiag,
  };

  // Priority chain. Glare comes first among day branches — a specular
  // building reflection physically concentrates radiation onto that
  // ground patch, so it overrides shadow/tree/solar classifications.
  let classification: SunClassification;
  if (!sunAboveHorizon) {
    classification = { exposure: 0, reason: 'low-sun-angle', via: 'night' };
  } else if (nearestGlare) {
    classification = {
      exposure: GLARE_SEGMENT_EXPOSURE,
      reason: 'glare',
      via: 'glare',
    };
  } else if (buildingShadowHit) {
    classification = { exposure: 0, reason: 'building-shadow', via: 'shadow' };
  } else if (inTreeCanopy) {
    classification = { exposure: 0, reason: 'tree-canopy', via: 'tree' };
  } else if (solarSample !== null) {
    classification =
      solarSample.exposureRatio > SOLAR_SUNNY_RATIO
        ? { exposure: 1, reason: 'sunny', via: 'solar' }
        : { exposure: 0, reason: 'low-sun-angle', via: 'solar' };
  } else if (bearingFacing > BEARING_SUNNY_THRESHOLD) {
    classification = { exposure: 1, reason: 'sunny', via: 'bearing' };
  } else {
    classification = { exposure: 0, reason: 'low-sun-angle', via: 'bearing' };
  }

  return { classification, diagnostic };
}

/**
 * Nearest Solar API sample within SOLAR_SAMPLE_RADIUS_M, including the
 * exact distance (meters) and the sample's own coords. Returns null when
 * no sample is in range or none had a valid exposureRatio. Samples
 * without a hit (404 from the proxy) are skipped.
 */
function findNearestSolarSample(
  lng: number,
  lat: number,
  samples: readonly SolarSample[] | null,
): { exposureRatio: number; distanceM: number; lat: number; lng: number } | null {
  if (!samples || samples.length === 0) return null;
  const radiusDegLat = SOLAR_SAMPLE_RADIUS_M / 111_000;
  const radiusDegLng = SOLAR_SAMPLE_RADIUS_M / 84_500;
  let best: { sample: SolarSample; distM: number } | null = null;
  for (const s of samples) {
    if (!s.hit || s.exposureRatio == null) continue;
    if (Math.abs(s.lat - lat) > radiusDegLat) continue;
    if (Math.abs(s.lng - lng) > radiusDegLng) continue;
    const distM = haversineMeters(lng, lat, s.lng, s.lat);
    if (distM > SOLAR_SAMPLE_RADIUS_M) continue;
    if (!best || distM < best.distM) {
      best = { sample: s, distM };
    }
  }
  if (!best) return null;
  return {
    exposureRatio: best.sample.exposureRatio!,
    distanceM: best.distM,
    lat: best.sample.lat,
    lng: best.sample.lng,
  };
}

/**
 * Nearest tree's distance in meters within `maxRadiusM`. Returns null
 * when no tree falls within that radius. Bbox-prefiltered before the
 * haversine compare, same as the in-canopy check below.
 */
function findNearestTreeDistance(
  lng: number,
  lat: number,
  trees: readonly TreeNode[],
  maxRadiusM: number,
): number | null {
  const radiusDegLat = maxRadiusM / 111_000;
  const radiusDegLng = maxRadiusM / 84_500;
  let bestDist: number | null = null;
  for (const t of trees) {
    if (Math.abs(t.lat - lat) > radiusDegLat) continue;
    if (Math.abs(t.lng - lng) > radiusDegLng) continue;
    const dM = haversineMeters(lng, lat, t.lng, t.lat);
    if (dM > maxRadiusM) continue;
    if (bestDist === null || dM < bestDist) bestDist = dM;
  }
  return bestDist;
}

function sunReasonColor(reason: SunReason): [number, number, number, number] {
  switch (reason) {
    case 'sunny':
      return AMBER;
    case 'building-shadow':
      return BUILDING_SHADOW_BLUE;
    case 'tree-canopy':
      return TREE_CANOPY_GREEN;
    case 'low-sun-angle':
      return LOW_SUN_BLUE;
    case 'glare':
      return GLARE_RED;
  }
}

function isInAnyShadow(
  point: [number, number],
  shadows: readonly BuildingShadow[],
): boolean {
  for (const s of shadows) {
    if (pointInPolygon(point, s.polygon)) return true;
  }
  return false;
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
