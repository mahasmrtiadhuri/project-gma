import { useEffect, useMemo, useState } from 'react';
import { FlyToInterpolator, type MapViewState } from '@deck.gl/core';
import { GMACanvas } from './components/GMACanvas';
import { MapViewSwitcher, type MapView } from './components/MapViewSwitcher';
import {
  SearchBar,
  type PlacePick,
} from './components/SearchBar';
import { TransportModeSwitcher } from './components/TransportModeSwitcher';
import { TimePicker, type TimeMode } from './components/TimePicker';
import {
  RouteSheet,
  FILTER_PRESETS,
  type FilterMode,
} from './components/RouteSheet';
import { NavigationHeader } from './components/NavigationHeader';
import { NextTurnIndicator } from './components/NextTurnIndicator';
import { SunCompass } from './components/SunCompass';
import { SunGlow } from './components/SunGlow';
import { DataAttribution } from './components/DataAttribution';
import { Toast } from './components/Toast';
import { ThemeToggle } from './components/ThemeToggle';
import { StartButton } from './components/StartButton';
import { ColorLegendButton } from './components/ColorLegendButton';
import { useTheme } from './hooks/useTheme';
import { useSolarPosition } from './hooks/useSolarPosition';
import { useWeatherData } from './hooks/useWeatherData';
import { useCurrentLocation } from './hooks/useCurrentLocation';
import { useOverpassData } from './hooks/useOverpassData';
import { useSolarAPI } from './hooks/useSolarAPI';
import { useLiveLocation } from './hooks/useLiveLocation';
import { reverseGeocode } from './lib/geocoding';
import {
  computeNextTurn,
  computeRouteProgress,
  warmRouteNavigationCache,
} from './lib/navigation';
import type { Building } from './lib/overpass';
import {
  fetchCandidateRoutes,
  scoreAndRankRoutes,
  type CandidateRoute,
  type RoutePoint,
  type ScoredRoute,
  type TravelMode,
} from './lib/hlciRouter';
import { colorizeRoute, type ColoringMode } from './lib/routeColoring';
import { colorizeStreets } from './lib/streetSunColoring';
import {
  filterBuildingsNearPolyline,
  projectShadows,
} from './lib/buildingShadows';
import {
  classifyGlassReason,
  computeGlareHotspot,
  type GlareHotspot,
} from './lib/glassGlare';
import {
  interpretPreference,
  mapInterpretation,
  scaleWeights,
} from './lib/geminiRouting';
import {
  computeSunTimes,
  dayPhase,
  dayProgress,
  interpolatedDayColor,
  type RGB,
  type SunTimes,
} from './lib/daylight';
import type { Bbox } from './lib/overpass';

const NYC_CENTER = { lat: 40.758, lng: -73.9855 };

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: NYC_CENTER.lng,
  latitude: NYC_CENTER.lat,
  zoom: 14,
  pitch: 0,
  bearing: 0,
};

const SUN_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

// Night fallback color used for accent pills + sun overlays when the sun is
// below the horizon. Cool slate-blue reads as "twilight" without going so
// dark that white text on it becomes a contrast hazard.
const NIGHT_FALLBACK_COLOR: RGB = [85, 120, 180];

// Bbox sizing for the no-candidates Overpass viewport query.
// EARTH_CIRC_M / TILE_SIZE_PX are the Web Mercator constants we use to
// turn (zoom, latitude, window dimensions) into the actual lat/lng
// span of the visible map area. MAX_HALF_DEG caps the per-side extent
// so a zoom-out doesn't dump a continent-scale query at the public
// Overpass endpoint (it would 429 or time out).
const EARTH_CIRC_M = 40_075_000;
const TILE_SIZE_PX = 256;
const OVERPASS_VIEWPORT_PAD_M = 200; // extra ring around the visible canvas
const OVERPASS_MAX_HALF_DEG = 0.06; //  ~6.7 km per side at the equator

export default function App() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  const [timestamp, setTimestamp] = useState<Date>(() => new Date());
  const [mapView, setMapView] = useState<MapView>('2d');
  const [travelMode, setTravelMode] = useState<TravelMode>('WALK');
  const [filterMode, setFilterMode] = useState<FilterMode>('avoid-sun');
  const [timeMode, setTimeMode] = useState<TimeMode>('leave-now');
  const [plannedTime, setPlannedTime] = useState<Date | null>(null);
  const [origin, setOrigin] = useState<PlacePick | null>(null);
  const [destination, setDestination] = useState<PlacePick | null>(null);
  const [candidates, setCandidates] = useState<CandidateRoute[]>([]);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW_STATE);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Multiplier applied to FILTER_PRESETS[filterMode] before scoring.
  // Default 1.0; Gemini bumps to 1.5 when it interprets the user's
  // preference as high intensity. Reset to 1.0 whenever the user picks
  // a filter pill manually (manual choice is implicitly default-intensity).
  const [intensityMultiplier, setIntensityMultiplier] = useState(1.0);
  const [geminiBusy, setGeminiBusy] = useState(false);

  // Theme toggle — defaults to 'light', persisted to localStorage by
  // the hook. Applies `class="dark"` to <html>, which trips the dark
  // tokens in globals.css and crossfades the entire UI in 300 ms.
  const { theme, toggle: toggleTheme } = useTheme();

  // Live geolocation watch is gated on `navigating` so we don't drain
  // battery / spam the permission prompt outside of an active route.
  const liveLocation = useLiveLocation(navigating);

  // Track the actual window dimensions so the no-candidates Overpass
  // bbox covers the entire visible map area (not a fixed-pad square
  // around the viewState center). Updated on resize via a single
  // window listener — cheap, no per-frame work.
  const [windowSize, setWindowSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () =>
      setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const location = useCurrentLocation();

  // ---- effective time drives ALL astronomical computation -----------
  // leave-now → live timestamp; leave-at / arrive-by → planned time.
  // "Arrive by" is a v1 simplification: we treat plannedTime AS the
  // walk-time. The strict definition would be [plannedTime − walkDur,
  // plannedTime], but that introduces a circular dep (color → sort →
  // selection → duration). Fix later if it bites.
  const effectiveTime = useMemo(() => {
    if (timeMode === 'leave-now' || !plannedTime) return timestamp;
    return plannedTime;
  }, [timeMode, plannedTime, timestamp]);

  const solar = useSolarPosition(effectiveTime, NYC_CENTER.lat, NYC_CENTER.lng);
  const weather = useWeatherData(NYC_CENTER.lat, NYC_CENTER.lng);

  // ---- daylight: real sunrise/sunset → progress → phase + color ----
  const sunTimes = useMemo<{ times: SunTimes; source: 'api' | 'computed' } | null>(() => {
    if (weather?.sunriseTime && weather?.sunsetTime) {
      return {
        times: { sunrise: weather.sunriseTime, sunset: weather.sunsetTime },
        source: 'api',
      };
    }
    const computed = computeSunTimes(effectiveTime, NYC_CENTER.lat, NYC_CENTER.lng);
    if (!computed) return null;
    return { times: computed, source: 'computed' };
  }, [
    weather?.sunriseTime,
    weather?.sunsetTime,
    effectiveTime,
  ]);

  const daylight = useMemo(() => {
    if (!sunTimes) return { progress: 0, phase: 'night' as const, color: NIGHT_FALLBACK_COLOR };
    const progress = dayProgress(effectiveTime, sunTimes.times);
    const phase = dayPhase(progress);
    const color = interpolatedDayColor(progress);
    return { progress, phase, color };
  }, [sunTimes, effectiveTime]);

  useEffect(() => {
    if (!sunTimes) {
      console.log('[GMA] Daylight: polar edge case (no sunrise/sunset)');
      return;
    }
    console.log('[GMA] Daylight:', {
      source: sunTimes.source,
      timeMode,
      plannedTime: plannedTime?.toISOString() ?? null,
      effectiveTime: effectiveTime.toISOString(),
      sunrise: sunTimes.times.sunrise.toISOString(),
      sunset: sunTimes.times.sunset.toISOString(),
      progress: daylight.progress.toFixed(3),
      phase: daylight.phase,
      color: daylight.color,
      apiIsDaytime: weather?.isDaytime,
    });
  }, [sunTimes?.source, daylight.phase, timeMode, plannedTime]);

  // ---- origin auto-fill ----
  useEffect(() => {
    if (location.status !== 'available' || !location.point) return;
    let cancelled = false;
    const point = location.point;
    reverseGeocode(point.lat, point.lng, apiKey).then((address) => {
      if (cancelled) return;
      setOrigin((current) => {
        if (current) return current;
        const label =
          address ?? `${point.lat.toFixed(4)}°, ${point.lng.toFixed(4)}°`;
        console.log('[GMA] Auto-filling origin from geolocation:', {
          point,
          label,
          usedGeocoded: address !== null,
        });
        return { point, label };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [location.status, location.point?.lat, location.point?.lng, apiKey]);

  useEffect(() => {
    console.log('[GMA] origin →', origin);
  }, [origin]);
  useEffect(() => {
    console.log('[GMA] destination →', destination);
  }, [destination]);

  // Refresh sun position so background routing stays in sync as the day passes.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTimestamp(new Date());
    }, SUN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  // ---- route fetch ----
  useEffect(() => {
    console.log('[GMA] Route-fetch effect triggered.', {
      hasOrigin: !!origin,
      hasDestination: !!destination,
      travelMode,
    });
    if (!origin || !destination) {
      setCandidates([]);
      setNavigating(false);
      return;
    }
    let cancelled = false;
    setRoutesLoading(true);
    fetchCandidateRoutes(origin.point, destination.point, travelMode, apiKey)
      .then((c) => {
        if (cancelled) return;
        console.log(`[GMA] fetchCandidateRoutes returned ${c.length} candidate(s)`);
        setCandidates(c);
        setSelectedRouteIdx(0);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[GMA] fetchCandidateRoutes threw:', error);
        setCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setRoutesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [origin, destination, travelMode, apiKey]);

  useEffect(() => {
    setSelectedRouteIdx(0);
  }, [filterMode]);

  // ---- Overpass bbox -------------------------------------------------
  // Two regimes:
  //   1. WITH candidates → union extent of all candidate polylines +
  //      500 m padding. Guarantees trees on near-route side streets
  //      get fetched even when the route extends past the viewport
  //      (the Manhattan→Brooklyn case the May rebuild fixed).
  //   2. NO candidates → the actual visible map area (computed from
  //      live window dimensions + zoom + latitude via Web Mercator),
  //      plus a 200 m ring. Replaces the previous fixed-pad square
  //      around viewState center, which was too small for landscape
  //      viewports and made the street-sun overlay appear in only a
  //      tiny box around the map center.
  // Bbox derivation is split into two independent memos so the
  // candidates-regime bbox stays referentially stable when the user
  // pans/zooms the map. Previously a single memo depended on both
  // `candidates` AND `viewState`, so any viewport change recomputed
  // the bbox object even though the candidates-derived numbers were
  // identical — and although `useOverpassData` keyed off the bbox
  // primitives (so no refetch), downstream `useMemo`s reading
  // `overpassBbox` saw a new reference every pan, which cascaded
  // into rerun-cost spikes during typing/filter/time edits.
  //
  // Two-memo split keeps the candidates phase 100 % stable on
  // `candidates` only; the viewport phase only matters when there
  // are no candidates yet.
  const candidatesBbox = useMemo<Bbox | null>(() => {
    if (candidates.length === 0) return null;
    let south = Infinity;
    let west = Infinity;
    let north = -Infinity;
    let east = -Infinity;
    for (const c of candidates) {
      for (const p of c.polyline) {
        if (p.lat < south) south = p.lat;
        if (p.lat > north) north = p.lat;
        if (p.lng < west) west = p.lng;
        if (p.lng > east) east = p.lng;
      }
    }
    if (!Number.isFinite(north)) return null;
    const padLat = 500 / 111_000; //  ~0.0045°  (500 m N–S)
    const padLng = 500 / 84_500; //   ~0.0059°  (500 m E–W at NYC latitude)
    return {
      south: south - padLat,
      west: west - padLng,
      north: north + padLat,
      east: east + padLng,
    };
  }, [candidates]);

  const viewportBbox = useMemo<Bbox>(() => {
    // Web Mercator meters-per-pixel at this zoom + latitude:
    //   m/px = EARTH_CIRC × cos(lat) / (TILE_SIZE × 2^zoom)
    // Then half-extents = (canvas pixels / 2) × m/px → meters → degrees.
    const latRad = (viewState.latitude * Math.PI) / 180;
    const metersPerPixel =
      (EARTH_CIRC_M * Math.cos(latRad)) /
      (TILE_SIZE_PX * Math.pow(2, viewState.zoom));
    const halfWidthM = (windowSize.w / 2) * metersPerPixel + OVERPASS_VIEWPORT_PAD_M;
    const halfHeightM = (windowSize.h / 2) * metersPerPixel + OVERPASS_VIEWPORT_PAD_M;
    const halfLngDegRaw = halfWidthM / 84_500;
    const halfLatDegRaw = halfHeightM / 111_000;
    const halfLngDeg = Math.min(OVERPASS_MAX_HALF_DEG, halfLngDegRaw);
    const halfLatDeg = Math.min(OVERPASS_MAX_HALF_DEG, halfLatDegRaw);
    // 3-decimal-rounded center so small pans share a bboxKey and skip
    // the network — Overpass cache in src/lib/overpass.ts keys on this.
    const lat = Math.round(viewState.latitude * 1000) / 1000;
    const lng = Math.round(viewState.longitude * 1000) / 1000;
    return {
      south: lat - halfLatDeg,
      west: lng - halfLngDeg,
      north: lat + halfLatDeg,
      east: lng + halfLngDeg,
    };
  }, [
    viewState.latitude,
    viewState.longitude,
    viewState.zoom,
    windowSize.w,
    windowSize.h,
  ]);

  const overpassBbox: Bbox = candidatesBbox ?? viewportBbox;

  // Lazy-load Overpass: don't fetch anything until the user has picked
  // a destination. The no-destination map load stays close to zero
  // network beyond the basemap tiles. extendedStreets flips on once we
  // have route candidates, widening the highway-tier filter to
  // tertiary + residential so the route polyline can score against
  // side streets.
  const overpassEnabled = destination !== null;
  const overpassExtendedStreets = candidates.length > 0;
  const overpass = useOverpassData(
    overpassEnabled ? overpassBbox : null,
    overpassExtendedStreets,
  );

  // Per-segment continuous exposure for every viewport street. This single
  // computation is the source of truth — the renderer reads .color from
  // each segment; the route scorer samples .exposure from the spatial
  // index built over the same array.
  //
  // PERF: memoized on (streets, sunAz, sunElev, cloudCover) — only
  // refires when Overpass returns new streets, the sun moves (via
  // useSolarPosition's 10-minute timestamp tick or a planned-time
  // change), or the live cloud cover ticks. Per-render execution does
  // NOT touch this; per-frame deck.gl renders just consume the cached
  // array.
  //
  // DEFERRED on initial load — when no route candidates exist we skip
  // the whole colorize pass and return []. The street-sun overlay only
  // renders once the user has picked a destination and the Routes API
  // has returned candidates, so the no-destination load stays snappy.
  const streetExposures = useMemo(() => {
    if (candidates.length === 0) return [];
    return colorizeStreets(
      overpass.streets,
      solar.azimuthDeg,
      solar.elevationDeg,
      weather?.cloudCoverPct ?? 0,
    );
  }, [
    candidates.length,
    overpass.streets,
    solar.azimuthDeg,
    solar.elevationDeg,
    weather?.cloudCoverPct,
  ]);

  // (streetIndex previously feeding scoreAndRankRoutes was removed —
  //  scoring now uses the unified classifier so the route polyline visual
  //  and the comfort score are derived from the same data. streetExposures
  //  is still rendered as the on-map street overlay by GMACanvas.)

  // ---- Solar API: per-CANDIDATE satellite-measured sun exposure ----
  // Sampling every CANDIDATE polyline (not just the selected one) means
  // all alternatives are scored against the same real data — apples-to-
  // apples comparison. The hook flattens + dedupes by 4-decimal coord
  // and caps the batch at MAX_SAMPLES_PER_BATCH = 50 total.
  const candidatePolylines = useMemo(
    () => candidates.map((c) => c.polyline),
    [candidates],
  );
  const solarApi = useSolarAPI(candidatePolylines);

  // OSM buildings + Solar API building entries that came with explicit
  // heights. Solar entries are appended (not deduped against OSM) — minor
  // shadow doubling is acceptable; the visual is a translucent overlay
  // anyway. Solar-derived buildings without an explicit height are
  // skipped at the parse stage (useSolarAPI.parseSolarResponse), so this
  // array stays empty when the API doesn't expose buildingHeight.
  // ---- Solar-API tree-canopy fallback -----------------------------
  // When Overpass returns zero trees (rate-limited / tag-coverage gap /
  // bbox over a borough OSM under-tags), fall back to using the Solar
  // API's nameplate-capacity signal as a tree/building shade proxy.
  // Each Solar sample whose `panelCapacityWatts` falls in the bottom
  // ~33% of the observed range becomes a synthetic tree at the sample's
  // coordinates — the existing 15-m proximity check in the route-color
  // classifier then flags nearby segments as tree-canopy.
  const treesForRouting = useMemo(() => {
    if (overpass.trees.length > 0) return overpass.trees;
    const hits = solarApi.samples.filter(
      (s) => s.hit && s.panelCapacityWatts != null && s.panelCapacityWatts > 0,
    );
    if (hits.length === 0) return overpass.trees;
    const capacities = hits
      .map((s) => s.panelCapacityWatts!)
      .sort((a, b) => a - b);
    // Bottom-third cutoff.
    const cutoffIdx = Math.max(0, Math.floor(capacities.length * 0.33));
    const cutoff = capacities[cutoffIdx]!;
    const synthetic = hits
      .filter((s) => s.panelCapacityWatts! <= cutoff)
      .map((s) => ({ lat: s.lat, lng: s.lng }));
    if (synthetic.length > 0) {
      console.log(
        `[GMA] Trees fallback: OSM returned 0, synthesized ${synthetic.length} ` +
          `tree points from Solar API panelCapacityWatts (cutoff ${Math.round(cutoff)} W, ` +
          `bottom third of ${hits.length} hits)`,
      );
    }
    return synthetic;
  }, [overpass.trees, solarApi.samples]);

  const mergedBuildings = useMemo<Building[]>(() => {
    const solarBuildings: Building[] = solarApi.buildings.map((b, i) => ({
      id: `solar/${i}`,
      height: b.height,
      footprint: b.polygon,
    }));
    if (solarBuildings.length > 0) {
      console.log('[GMA] Augmenting OSM buildings with Solar API buildings', {
        osm: overpass.buildings.length,
        solar: solarBuildings.length,
        heights: solarBuildings.map((b) => Math.round(b.height)),
      });
    }
    return [...overpass.buildings, ...solarBuildings];
  }, [overpass.buildings, solarApi.buildings]);

  // Buildings filtered to a 200 m corridor around any candidate route
  // polyline before shadow projection. The full mergedBuildings array
  // can be a few thousand polygons in dense Midtown — projecting all
  // of them every sun tick is wasted work since the routes only see
  // shadows near their own paths. We union over ALL candidates (not
  // just the selected one) because the user can flip between them and
  // each one needs shadow context for its own segments.
  const shadowSourceBuildings = useMemo<Building[]>(() => {
    if (candidatePolylines.length === 0) return [];
    const allPoints = candidatePolylines.flat();
    if (allPoints.length < 2) return [];
    return filterBuildingsNearPolyline(mergedBuildings, allPoints, 200);
  }, [mergedBuildings, candidatePolylines]);

  // PERF: building-shadow projection runs once per (filteredBuildings,
  // sunAz, sunElev) tuple, not per render or per frame. The filtered
  // input is itself a useMemo, so identity is stable until the route,
  // OSM buildings, or Solar-API buildings list changes; sun deps only
  // tick every 10 min (or instantly when the user picks a planned time).
  const buildingShadows = useMemo(
    () =>
      projectShadows(
        shadowSourceBuildings,
        solar.azimuthDeg,
        solar.elevationDeg,
      ),
    [shadowSourceBuildings, solar.azimuthDeg, solar.elevationDeg],
  );

  // ---- glass-glare hotspots --------------------------------------
  // Effect-driven (not useMemo) because the input most likely to be
  // empty on first paint — `overpass.buildings` — populates AFTER an
  // async fetch. A useMemo would have computed and committed [] on the
  // first render anyway; the effect waits for buildings + sun gate +
  // cloud gate to ALL pass before doing any work. setGlareHotspots
  // commits the new array exactly when there's something real to show.
  const [glareHotspots, setGlareHotspots] = useState<GlareHotspot[]>([]);
  useEffect(() => {
    const sunElev = solar.elevationDeg;
    const sunAz = solar.azimuthDeg;
    // Cloud-cover source: live Weather API only when the user is in
    // Leave-now mode (`plannedTime === null`). For any planned departure
    // /arrival time, fall back to a default 30 % — current cloud cover
    // tells us nothing about conditions two hours from now, and the
    // Weather API doesn't yet expose hourly forecasts in this app.
    // 30 % is a clear-sky-leaning default that lets glare actually
    // render so the demo doesn't go dark whenever the user picks a
    // future time slot.
    const cloudSource: 'live' | 'planned-default' =
      plannedTime != null ? 'planned-default' : 'live';
    const cloudCover =
      cloudSource === 'planned-default' ? 30 : (weather?.cloudCoverPct ?? 0);
    const buildings = overpass.buildings;

    // Gate diagnostics — fires every dep change so the user can see why
    // glare is empty even before any compute has fired.
    console.log('[GMA] Glass glare: gate check', {
      sunElevationDeg: Number(sunElev.toFixed(1)),
      sunAzimuthDeg: Math.round(sunAz),
      cloudCoverPct: Math.round(cloudCover),
      cloudSource,
      osmBuildings: buildings.length,
      gateSunOK: sunElev >= 10,
      gateCloudOK: cloudCover <= 80,
      gateBuildingsOK: buildings.length > 0,
    });

    if (buildings.length === 0) {
      console.log(
        '[GMA] Glass glare: waiting — OSM buildings array is still empty (Overpass not back yet).',
      );
      return;
    }
    if (sunElev < 10) {
      console.log(
        `[GMA] Glass glare: skipped — sun elevation ${sunElev.toFixed(1)}° below 10° threshold.`,
      );
      if (glareHotspots.length !== 0) setGlareHotspots([]);
      return;
    }
    if (cloudCover > 80) {
      console.log(
        `[GMA] Glass glare: skipped — cloud cover ${Math.round(cloudCover)}% above 80% threshold.`,
      );
      if (glareHotspots.length !== 0) setGlareHotspots([]);
      return;
    }

    // All gates pass — classify, project, commit.
    const glassMatches: {
      building: (typeof buildings)[number];
      reason: string;
      detail: string;
    }[] = [];
    for (const b of buildings) {
      const classified = classifyGlassReason(b);
      if (classified) {
        glassMatches.push({
          building: b,
          reason: classified.reason,
          detail: classified.detail,
        });
      }
    }

    // Classifier diagnostic — surface the first ~10 matches with the
    // rule that fired so the user can verify Midtown towers are being
    // hit by name match or tag match (not just hash-roulette guesses).
    if (glassMatches.length > 0) {
      console.log(
        `[GMA] Glass glare: classifier matched ${glassMatches.length} of ${buildings.length} buildings`,
      );
      console.table(
        glassMatches.slice(0, 12).map((m) => ({
          id: m.building.id,
          name: m.building.name ?? '(unnamed)',
          heightM: Math.round(m.building.height),
          reason: m.reason,
          detail: m.detail,
        })),
      );
    } else {
      console.log(
        `[GMA] Glass glare: classifier matched 0 of ${buildings.length} buildings. ` +
          'No explicit glass tags, no name matches, no untagged-post-2000 hits. ' +
          'Likely the viewport is over a low-density / pre-2000 / poorly-tagged area.',
      );
      if (glareHotspots.length !== 0) setGlareHotspots([]);
      return;
    }

    const hotspots: GlareHotspot[] = [];
    let dropped = 0;
    for (const m of glassMatches) {
      const h = computeGlareHotspot(m.building, sunAz, sunElev);
      if (h) hotspots.push(h);
      else dropped++;
    }
    console.log(
      `[GMA] Glass glare: computed ${hotspots.length} hotspots from ${glassMatches.length} glass buildings ` +
        `(${dropped} dropped — short / no sun-facing wall / footprint < 2 pts), ` +
        `at sun ${Math.round(sunAz)}°/${sunElev.toFixed(0)}°.`,
    );
    setGlareHotspots(hotspots);
    // glareHotspots intentionally excluded from deps — we read it inside
    // the effect only to decide whether to commit an empty array, never
    // to derive a value. Including it would cause an extra refire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    overpass.buildings,
    solar.azimuthDeg,
    solar.elevationDeg,
    weather?.cloudCoverPct,
    // plannedTime presence (not the value) switches the cloud-cover
    // source between live and the 30 % planned-default; the effect must
    // refire when the user toggles in/out of Leave-now mode.
    plannedTime != null,
  ]);

  // ---- score + rank routes (UNIFIED with the visual classifier) ----
  // scoreAndRankRoutes now uses the same shadows + trees + solar +
  // bearing chain that colorizeRoute renders. meanSunExposure equals
  // "fraction of the route polyline that would render as amber".
  const result = useMemo(() => {
    if (candidates.length === 0) return null;
    const ambientWind = weather
      ? {
          directionDeg: weather.windDirectionDeg,
          speedMph: weather.windSpeedMph,
        }
      : { directionDeg: 0, speedMph: 0 };
    // Avoid-Both auto-includes precipitation when it's actually
    // raining — otherwise the rainAvoidance slot stays 0 and the
    // ranking remains a pure sun+wind compromise. The static preset
    // in FILTER_PRESETS keeps it at 0 by default; this bump is the
    // runtime "respond to current conditions" hook.
    const precipProb = weather?.precipitationProbability ?? 0;
    let baseWeights = FILTER_PRESETS[filterMode];
    if (filterMode === 'avoid-both' && precipProb > 20) {
      baseWeights = { ...baseWeights, rainAvoidance: 0.6 };
    }
    return scoreAndRankRoutes(
      candidates,
      scaleWeights(baseWeights, intensityMultiplier),
      { azimuthDeg: solar.azimuthDeg, elevationDeg: solar.elevationDeg },
      ambientWind,
      weather?.cloudCoverPct ?? 100,
      {
        buildingShadows,
        // Routing uses the merged tree set: OSM trees if any, otherwise
        // the Solar-capacity-derived synthetic trees so route segments
        // in canopy-shaded blocks still register as tree-canopy.
        trees: treesForRouting,
        solarSamples: solarApi.samples,
        // Buildings feed the Venturi wind-canyon amplifier — without
        // them every wind-mode segment would score on bearing alone
        // and rankings between alternates would barely move.
        buildings: mergedBuildings,
        // Precipitation probability drives sampleRoutePrecipExposure
        // inside scoreAndRankRoutes. 0 short-circuits the sampler.
        precipitationProbability: precipProb,
        // Glass-glare hotspots — segments within 20 m get classified
        // as 'glare' with exposure 1.5, overriding shadow/tree/solar
        // branches. Routes that pass through these hotspots score
        // worse than direct-sun routes.
        glareHotspots,
      },
    );
  }, [
    candidates,
    filterMode,
    intensityMultiplier,
    solar.azimuthDeg,
    solar.elevationDeg,
    weather,
    buildingShadows,
    treesForRouting,
    solarApi.samples,
    mergedBuildings,
    glareHotspots,
  ]);

  const safeIdx = Math.min(selectedRouteIdx, (result?.routes.length ?? 1) - 1);
  const selectedRoute = result?.routes[safeIdx] ?? null;
  const sheetOpen = destination !== null && origin !== null;

  // Pre-warm the navigation cache for every candidate the moment the
  // sheet has routes to show. The user is browsing options for at
  // least a few hundred ms before tapping Start, so the cumulative
  // distance tables + step boundaries are ready by the time
  // `computeNextTurn` first fires for the live position fix.
  useEffect(() => {
    if (!result || result.routes.length === 0) return;
    for (const r of result.routes) {
      warmRouteNavigationCache(r.polyline, r.steps);
    }
  }, [result]);

  // Diagnostic: surface the actual polyline shape when the user picks a
  // route. A real Routes API walking polyline is 50–200 points; 2 points
  // means we fell back to the straight-line fixture in hlciRouter.
  useEffect(() => {
    if (!selectedRoute) return;
    const p = selectedRoute.polyline;
    console.log('[GMA] Selected route polyline:', {
      idx: safeIdx,
      label: selectedRoute.label,
      points: p.length,
      first: p[0],
      mid: p[Math.floor(p.length / 2)],
      last: p[p.length - 1],
      distanceM: selectedRoute.distanceMeters,
      durationS: selectedRoute.durationSeconds,
      meanSunExposure: selectedRoute.meanSunExposure,
    });
  }, [selectedRoute, safeIdx]);

  // ---- per-segment route colors (sun mode uses shadows + trees + solar) --
  const coloringMode: ColoringMode =
    filterMode === 'avoid-wind'
      ? 'wind'
      : filterMode === 'avoid-rain'
        ? 'rain'
        : 'sun';
  const coloredSegments = useMemo(() => {
    if (!selectedRoute) return null;
    const segments = colorizeRoute(
      selectedRoute.polyline,
      coloringMode,
      solar.azimuthDeg,
      solar.elevationDeg,
      weather?.windDirectionDeg ?? 0,
      weather?.windSpeedMph ?? 0,
      weather?.precipitationProbability ?? 0,
      weather?.precipitationType ?? 'none',
      treesForRouting,
      buildingShadows,
      mergedBuildings,
      solarApi.samples,
      glareHotspots,
    );
    return segments.length > 0 ? segments : null;
  }, [
    selectedRoute,
    coloringMode,
    solar.azimuthDeg,
    solar.elevationDeg,
    weather?.windDirectionDeg,
    weather?.windSpeedMph,
    weather?.precipitationProbability,
    weather?.precipitationType,
    treesForRouting,
    buildingShadows,
    mergedBuildings,
    solarApi.samples,
    glareHotspots,
  ]);

  // ---- auto-pan/zoom ----
  // Fits the map to the route the user actually has selected. Previously
  // this always fit to `result.routes[0]` (the best-under-current-filter),
  // so picking the 2nd or 3rd alternative could leave it mostly off-screen.
  useEffect(() => {
    if (navigating) return;
    let target: MapViewState | null = null;
    if (selectedRoute && selectedRoute.polyline.length > 1) {
      target = fitPolylineView(selectedRoute.polyline);
    } else if (destination && !origin) {
      target = pointView(destination.point, 15);
    } else if (origin && !destination) {
      target = pointView(origin.point, 14);
    }
    if (!target) return;
    setViewState({
      ...target,
      transitionDuration: 800,
      transitionInterpolator: new FlyToInterpolator(),
    } as MapViewState);
  }, [
    origin,
    destination,
    selectedRoute?.polyline,
    navigating,
  ]);

  const handleSwap = () => {
    if (!origin || !destination) return;
    setOrigin(destination);
    setDestination(origin);
  };

  const handleStartNavigation = () => {
    if (!origin || !selectedRoute) return;
    // Flip to navigation mode FIRST so the UI transitions immediately —
    // the route polyline + coloredSegments are already memoized at this
    // point, so they paint on the very next React frame regardless of
    // whether geolocation, weather, or any other async data has come
    // back yet. Then dispatch the camera fly-in (400 ms — fast enough
    // that the user doesn't perceive a delay between tap and "moving").
    setNavigating(true);
    setToastMessage(
      buildStartToast(
        selectedRoute,
        filterMode,
        weather?.windSpeedMph ?? 0,
      ),
    );
    const target = originCenteredFitView(origin.point, selectedRoute.polyline);
    setViewState({
      ...target,
      transitionDuration: 400,
      transitionInterpolator: new FlyToInterpolator(),
    } as MapViewState);
  };

  const handleStopNavigation = () => {
    setNavigating(false);
  };

  // Manual filter pill click — always resets the intensity multiplier
  // to 1.0 (default). A subsequent Gemini submit may bump it back to
  // 1.5 if the model returns intensity='high'.
  const handleFilterChange = (next: FilterMode) => {
    setFilterMode(next);
    setIntensityMultiplier(1.0);
  };

  // Conversational preference → Gemini → mapped FilterMode + intensity.
  // On any failure (no key, HTTP error, malformed JSON, schema mismatch)
  // we leave the existing filter in place and surface a fallback toast.
  const handleSubmitPreference = async (text: string) => {
    setGeminiBusy(true);
    try {
      const interp = await interpretPreference(text);
      if (!interp) {
        setToastMessage(
          'Could not interpret preference — using current filter',
        );
        return;
      }
      const mapped = mapInterpretation(interp);
      setFilterMode(mapped.filterMode);
      setIntensityMultiplier(mapped.intensityMultiplier);
      setToastMessage(mapped.toastMessage);
    } finally {
      setGeminiBusy(false);
    }
  };

  // ---- live navigation derivations -----------------------------------
  // routeProgress / nextTurn / remaining-time recompute on every new
  // geolocation fix (typically once a second). Cheap helpers — no
  // network, no big allocations.
  const routeProgress = useMemo(
    () =>
      selectedRoute
        ? computeRouteProgress(selectedRoute.polyline, liveLocation.coord)
        : null,
    [selectedRoute, liveLocation.coord?.lat, liveLocation.coord?.lng],
  );

  const nextTurn = useMemo(
    () =>
      selectedRoute
        ? computeNextTurn(
            selectedRoute.polyline,
            selectedRoute.steps,
            liveLocation.coord,
          )
        : null,
    [selectedRoute, liveLocation.coord?.lat, liveLocation.coord?.lng],
  );

  const remainingDistanceM =
    routeProgress != null
      ? Math.max(0, routeProgress.totalM - routeProgress.traveledM)
      : (selectedRoute?.distanceMeters ?? 0);

  const remainingDurationS = selectedRoute
    ? selectedRoute.distanceMeters > 0
      ? selectedRoute.durationSeconds *
        (remainingDistanceM / selectedRoute.distanceMeters)
      : selectedRoute.durationSeconds
    : 0;

  // ---- follow-cam --------------------------------------------------
  // While navigating, every new live geolocation fix re-centers the map
  // on the user. 200 ms transition gives a smooth, walking-pace chase
  // that keeps up with brisk movement without feeling laggy. Pitch 0
  // so the chase view works regardless of which basemap the user is
  // on (2D / 3D / Satellite) — a 55° tilt looks wrong on the flat
  // CartoDB raster, and a tilt-on-3D-only branch would surprise the
  // user the first time they switched mid-route. Zoom 17 (was 18) so a
  // larger stretch of the route is in view, which is what makes the
  // per-segment sun coloring readable while walking. Bearing follows
  // device heading when reported.
  useEffect(() => {
    if (!navigating || !liveLocation.coord) return;
    setViewState({
      longitude: liveLocation.coord.lng,
      latitude: liveLocation.coord.lat,
      zoom: 17,
      pitch: 0,
      bearing: liveLocation.heading ?? 0,
      transitionDuration: 200,
      transitionInterpolator: new FlyToInterpolator(),
    } as MapViewState);
    // deps purposely exclude viewState — we drive the camera from live
    // location only, otherwise the FlyToInterpolator's intermediate
    // emissions would re-fire this effect and stall the transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    navigating,
    liveLocation.coord?.lat,
    liveLocation.coord?.lng,
    liveLocation.heading,
  ]);

  const phaseDisplay =
    daylight.phase.charAt(0).toUpperCase() + daylight.phase.slice(1);

  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-[var(--gma-bg)]">
      <GMACanvas
        selectedRoute={selectedRoute}
        coloredSegments={coloredSegments}
        streetExposures={streetExposures}
        trees={overpass.trees}
        forests={overpass.forests}
        buildingShadows={buildingShadows}
        glareHotspots={glareHotspots}
        mapView={mapView}
        viewState={viewState}
        onViewStateChange={setViewState}
        liveLocation={
          liveLocation.coord
            ? {
                lat: liveLocation.coord.lat,
                lng: liveLocation.coord.lng,
                accuracyM: liveLocation.accuracyM,
                headingDeg: liveLocation.heading,
              }
            : null
        }
        navigating={navigating}
        theme={theme}
        originPoint={navigating ? origin?.point ?? null : null}
        destinationPoint={navigating ? destination?.point ?? null : null}
      />

      {!navigating && <ThemeToggle theme={theme} onToggle={toggleTheme} />}

      <SunGlow
        sunAzimuthDeg={solar.azimuthDeg}
        sunElevationDeg={solar.elevationDeg}
        dayColor={daylight.color}
      />

      {/*
        LAYER 1 — Top stack. SearchBar + TransportModeSwitcher + TimePicker
        all share a single flex column container so they auto-stack with
        consistent gaps. No `top-[Xrem]` hand-tuned offsets anywhere —
        a longer search card or wrapped transport row simply pushes the
        time picker down, no overlap risk. Right inset (4.5 rem) leaves
        a permanent gutter for the ThemeToggle floating at top-right.
      */}
      {!navigating && (
        <div
          className="pointer-events-none absolute left-2 right-[4.5rem] top-0 z-40 flex flex-col items-center gap-2"
          style={{
            paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)',
          }}
        >
          <div className="w-full max-w-[460px]">
            <SearchBar
              origin={origin}
              destination={destination}
              onOriginChange={setOrigin}
              onDestinationChange={setDestination}
              onSwap={handleSwap}
            />
          </div>
          {sheetOpen && (
            <div className="max-w-[calc(100vw-5rem)]">
              <TransportModeSwitcher
                value={travelMode}
                onChange={setTravelMode}
                dayColor={daylight.color}
              />
            </div>
          )}
          {sheetOpen && (
            <TimePicker
              mode={timeMode}
              plannedTime={plannedTime}
              onChange={(nextMode, nextPlannedTime) => {
                setTimeMode(nextMode);
                setPlannedTime(nextPlannedTime);
              }}
              dayColor={daylight.color}
            />
          )}
        </div>
      )}

      {!navigating && sheetOpen && (
        <RouteSheet
          routes={result?.routes ?? []}
          selectedRouteIdx={safeIdx}
          onSelectRoute={setSelectedRouteIdx}
          filterMode={filterMode}
          onFilterChange={handleFilterChange}
          onDismiss={() => setDestination(null)}
          isLoading={routesLoading}
          dayColor={daylight.color}
          onSubmitPreference={handleSubmitPreference}
          geminiBusy={geminiBusy}
          precipitationProbability={weather?.precipitationProbability ?? 0}
          precipitationType={weather?.precipitationType ?? 'none'}
          windSpeedMph={weather?.windSpeedMph ?? 0}
          legendMode={
            coloredSegments && coloredSegments.length > 0
              ? coloringMode === 'wind'
                ? 'wind'
                : coloringMode === 'rain'
                  ? 'rain'
                  : 'sun'
              : undefined
          }
          legendSnow={weather?.precipitationType === 'snow'}
        />
      )}

      {navigating && selectedRoute && destination && (
        <>
          <NavigationHeader
            destinationLabel={destination.label}
            remainingDistanceM={remainingDistanceM}
            remainingDurationS={remainingDurationS}
            onStop={handleStopNavigation}
          />
          <NextTurnIndicator nextTurn={nextTurn} />
        </>
      )}

      {!navigating && (
        <SunCompass
          sunAzimuthDeg={solar.azimuthDeg}
          sunElevationDeg={solar.elevationDeg}
          dayColor={daylight.color}
          now={effectiveTime}
          phaseName={phaseDisplay}
          solarStatus={solarApi.status}
          overpassStatus={overpass.status}
          windDirectionDeg={weather?.windDirectionDeg ?? null}
          windSpeedMph={weather?.windSpeedMph ?? null}
          precipitationType={weather?.precipitationType ?? null}
          precipitationProbability={weather?.precipitationProbability ?? null}
          routeSheetOpen={sheetOpen}
        />
      )}

      {/*
       * MapViewSwitcher stays visible during navigation — the user owns
       * the map view choice (2D / 3D / Satellite) and may want to flip
       * it mid-route. Auto-3D on Start was removed; the switcher is the
       * single way to change views now. On mobile (<sm) the switcher
       * hides itself when the bottom sheet is open since the sheet
       * goes full-width and would overlap.
       */}
      <MapViewSwitcher
        value={mapView}
        onChange={setMapView}
        routeSheetOpen={sheetOpen && !navigating}
        navigating={navigating}
      />

      {/* Floating Start button — fixed at viewport bottom, z-100, always
       * visible when there's at least one routable candidate. Lives
       * outside the RouteSheet so a tight sheet height on small phones
       * can never clip it off-screen. */}
      <StartButton
        visible={
          !navigating &&
          sheetOpen &&
          !routesLoading &&
          (result?.routes.length ?? 0) > 0
        }
        dayColor={daylight.color}
        onStart={handleStartNavigation}
      />

      {/* "?" tooltip explaining route polyline colors — visible only
       * when a colored route is actually on the map. */}
      <ColorLegendButton
        visible={
          !navigating &&
          sheetOpen &&
          coloredSegments != null &&
          coloredSegments.length > 0
        }
      />

      <Toast message={toastMessage} />

      {/* Attribution sits at the very bottom — hidden whenever the
       * sheet or navigation chrome occupies that band. */}
      <DataAttribution visible={!navigating && !sheetOpen} />
    </div>
  );
}

/**
 * Build the Start-navigation toast — human-readable feels-like delta
 * with an emoji that matches the filter or route condition. Replaces
 * the old percentage-based toast.
 *
 *   Mostly shaded route → "🌳 Finding you the coolest route"
 *   Cooler than average → "🌳 Feels ~6°F cooler"
 *   Sunniest mode       → "☀️ Catching maximum sun · ~9°F warmer"
 *   Wind filter         → "🌬 Sheltered from wind · ~5 mph less"
 *   Rain filter         → "💧 Sheltered from rain"
 *   Glare route         → "🔆 Heads-up: route passes glass glare"
 */
function buildStartToast(
  route: ScoredRoute,
  filterMode: FilterMode,
  windSpeedMph: number,
): string {
  const MAX_DELTA = 15;
  const sunExposure = route.meanSunExposure ?? 0.5;
  const windExposure = route.meanWindExposure ?? 0;
  const precipExposure = route.meanPrecipExposure ?? 0;

  if (filterMode === 'avoid-rain') {
    if (precipExposure < 0.3) return '💧 Sheltered from rain';
    return '💧 Less rain on this route';
  }
  if (filterMode === 'avoid-wind') {
    if (windSpeedMph < 3) return '🌬 Calm winds out there';
    if (windExposure < 0.3) return '🌬 Sheltered from wind';
    const savedMph = Math.max(
      0,
      Math.round((1 - windExposure) * windSpeedMph),
    );
    return savedMph > 0
      ? `🌬 ~${savedMph} mph less headwind on this route`
      : '🌬 Less wind on this route';
  }
  if (filterMode === 'sunniest') {
    const warmer = Math.round(
      Math.max(0, Math.min(1, sunExposure)) * MAX_DELTA,
    );
    return warmer > 0
      ? `☀️ Catching maximum sun · ~${warmer}°F warmer`
      : '☀️ Catching maximum sun';
  }
  if (sunExposure > 1.0) {
    return '🔆 Heads-up: route passes glass glare';
  }
  if (sunExposure < 0.3) {
    return '🌳 Finding you the coolest route';
  }
  const cooler = Math.round((1 - sunExposure) * MAX_DELTA);
  return cooler > 0
    ? `🌳 Feels ~${cooler}°F cooler`
    : '🌳 Best comfort GMA could find';
}


function originCenteredFitView(
  origin: RoutePoint,
  polyline: readonly RoutePoint[],
): MapViewState {
  if (polyline.length === 0) {
    return {
      longitude: origin.lng,
      latitude: origin.lat,
      zoom: 16,
      pitch: 0,
      bearing: 0,
    };
  }
  let maxLngOffset = 0;
  let maxLatOffset = 0;
  for (const p of polyline) {
    maxLngOffset = Math.max(maxLngOffset, Math.abs(p.lng - origin.lng));
    maxLatOffset = Math.max(maxLatOffset, Math.abs(p.lat - origin.lat));
  }
  const span = 2 * Math.max(maxLngOffset, maxLatOffset / 0.7);
  const rawZoom = 15 - Math.log2(Math.max(span, 0.001) / 0.013);
  const zoom = Math.min(18, Math.max(12, rawZoom));
  return {
    longitude: origin.lng,
    latitude: origin.lat,
    zoom,
    pitch: 0,
    bearing: 0,
  };
}

function fitPolylineView(polyline: readonly RoutePoint[]): MapViewState {
  if (polyline.length === 0) {
    return {
      longitude: NYC_CENTER.lng,
      latitude: NYC_CENTER.lat,
      zoom: 14,
      pitch: 0,
      bearing: 0,
    };
  }
  let minLng = polyline[0]!.lng;
  let maxLng = polyline[0]!.lng;
  let minLat = polyline[0]!.lat;
  let maxLat = polyline[0]!.lat;
  for (const p of polyline) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  const span = 1.2 * Math.max(lngSpan, latSpan / 0.7);
  const rawZoom = 15 - Math.log2(Math.max(span, 0.001) / 0.013);
  const zoom = Math.min(17, Math.max(11, rawZoom));
  return {
    longitude: (minLng + maxLng) / 2,
    latitude: (minLat + maxLat) / 2,
    zoom,
    pitch: 0,
    bearing: 0,
  };
}

function pointView(point: RoutePoint, zoom: number): MapViewState {
  return {
    longitude: point.lng,
    latitude: point.lat,
    zoom,
    pitch: 0,
    bearing: 0,
  };
}
