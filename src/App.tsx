import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type SegmentBreakdown,
} from './components/RouteSheet';
import { NavigationHeader } from './components/NavigationHeader';
import { NextTurnIndicator } from './components/NextTurnIndicator';
import { SunCompass } from './components/SunCompass';
import { SunGlow } from './components/SunGlow';
import { DataAttribution } from './components/DataAttribution';
import { Toast } from './components/Toast';
import { ThemeToggle } from './components/ThemeToggle';
import { StartButton } from './components/StartButton';
import { MapTapPopup } from './components/MapTapPopup';
import { VersionLabel } from './components/VersionLabel';
import { DemoButton } from './components/DemoButton';
import { DemoWatermark } from './components/DemoWatermark';
import { DemoIntroOverlay } from './components/DemoIntroOverlay';
import { DemoProgressBar } from './components/DemoProgressBar';
import {
  RouteLegendOverlay,
  RouteLegendButton,
} from './components/RouteLegendOverlay';
import { PersistentMapLegend } from './components/PersistentMapLegend';
import { TimeScrubber } from './components/TimeScrubber';
import { useDemoMode } from './hooks/useDemoMode';
import { useTheme } from './hooks/useTheme';
import { useSolarPosition } from './hooks/useSolarPosition';
import { useWeatherData } from './hooks/useWeatherData';
import { useMetarData } from './hooks/useMetarData';
import { useCurrentLocation } from './hooks/useCurrentLocation';
import { useOverpassData } from './hooks/useOverpassData';
import { useSolarAPI } from './hooks/useSolarAPI';
import { useLiveLocation } from './hooks/useLiveLocation';
import { useAnimatedLocation } from './hooks/useAnimatedLocation';
import { RecenterButton } from './components/RecenterButton';
import { reverseGeocode } from './lib/geocoding';
import {
  computeNextTurn,
  computeRouteProgress,
  warmRouteNavigationCache,
} from './lib/navigation';
import type { Building } from './lib/overpass';
import {
  bearingDegrees,
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
  // 30° initial pitch — subtle 3D tilt on first paint so the map
  // doesn't read as a flat document. Switches back to pitch 0 when
  // the demo / follow-cam want a top-down view explicitly.
  pitch: 30,
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
  const { theme, toggle: toggleTheme, setTheme } = useTheme();

  // Demo Mode — activated by `?demo=true` in the URL. Renders a
  // floating START DEMO CTA + a top-left watermark. Tapping the CTA
  // kicks off the 60 s scripted sequence (`runDemoSequence` below).
  const isDemoMode = useDemoMode();
  const [demoRunning, setDemoRunning] = useState(false);
  const demoTimeoutsRef = useRef<number[]>([]);
  // demoLiveCoord shadows the real GPS during the demo's navigation
  // simulation segment (t=52s onward). When set, it replaces the live
  // location reading for the chevron + follow-cam so the camera
  // sweeps along the route as if the user were walking it. rAF
  // handle stored separately for clean cancellation.
  const [demoLiveCoord, setDemoLiveCoord] =
    useState<{ lat: number; lng: number } | null>(null);
  const demoNavRafRef = useRef<number | null>(null);

  // Cinematic chrome state — driven entirely by the demo scheduler.
  // `demoIntroVisible` covers the 2 s opening title card.
  // `glarePulsePhase` is the 0→1 sweep for the glare-hotspot pulse.
  // `legendAutoShow` flips on for 4 s when a route first appears.
  //
  // Floating annotations were removed in the 2026-06-08 polish pass —
  // the visual sequence speaks for itself; voiceover-style pills read
  // as noise on a recording.
  const [demoIntroVisible, setDemoIntroVisible] = useState(false);
  const [glarePulsePhase, setGlarePulsePhase] = useState(0);
  const glarePulseRafRef = useRef<number | null>(null);
  const demoHourRafRef = useRef<number | null>(null);

  // Legend overlay: shows for 4 s when a route first appears; also
  // re-openable via the persistent "?" button bottom-left.
  const [legendAutoShow, setLegendAutoShow] = useState(false);
  const [legendManualShow, setLegendManualShow] = useState(false);
  const legendAutoTimerRef = useRef<number | null>(null);
  const legendShownForRouteRef = useRef<string | null>(null);

  // Clear scheduled legend hide on unmount.
  useEffect(
    () => () => {
      if (legendAutoTimerRef.current != null) {
        window.clearTimeout(legendAutoTimerRef.current);
      }
      if (glarePulseRafRef.current != null) {
        cancelAnimationFrame(glarePulseRafRef.current);
      }
      if (demoHourRafRef.current != null) {
        cancelAnimationFrame(demoHourRafRef.current);
      }
    },
    [],
  );

  // Clear any pending scheduled steps + the nav-sim rAF on unmount so
  // a navigation away mid-demo doesn't fire setters against a dead
  // component.
  useEffect(
    () => () => {
      for (const id of demoTimeoutsRef.current) {
        window.clearTimeout(id);
      }
      demoTimeoutsRef.current = [];
      if (demoNavRafRef.current != null) {
        cancelAnimationFrame(demoNavRafRef.current);
        demoNavRafRef.current = null;
      }
    },
    [],
  );

  // ---- Feature-mount log ----------------------------------------------
  // Single mount-time log set so the user can confirm — from
  // DevTools — which build is actually running on their device and
  // which interactive features the bundle includes. The first line
  // doubles as a service-worker-staleness check (compare against the
  // version chip in the bottom-right corner of the screen and the
  // deploy log).
  useEffect(() => {
    console.log(`[GMA] Build date: ${__GMA_BUILD_DATE__}`);
    console.log('[GMA] Feature: current location button mounted');
    console.log('[GMA] Feature: map tap handler active');
    console.log('[GMA] Feature: sunny spot filter available');
  }, []);

  // Desktop / mobile breakpoint. ≥ 768 px gets the dedicated 380 px
  // sidebar layout (every chrome card stacked vertically, fully
  // visible, scrollable). < 768 px keeps the current mobile floating
  // layout (search at top, sheet sliding up from bottom). Tracked
  // reactively so a window resize crossing the breakpoint redraws
  // the whole layout immediately.
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(min-width: 768px)').matches;
  });
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  // Sidebar is active only when on desktop AND not currently in
  // navigation mode (nav takes the full viewport regardless of size).
  // sheetOpen is checked later by individual children that conditionally
  // mount on user input.
  const useSidebar = isDesktop && !navigating;

  // Live geolocation watch is gated on `navigating` so we don't drain
  // battery / spam the permission prompt outside of an active route.
  const liveLocation = useLiveLocation(navigating);

  // Animated GPS coord. `useLiveLocation` emits roughly 1 fix per second;
  // wrapping it in `useAnimatedLocation` linearly interpolates the
  // displayed position over 1 s using requestAnimationFrame so the
  // chevron glides rather than teleporting between fixes. The route
  // progress + nextTurn computations still read the RAW coord
  // (`liveLocation.coord`) — that's the source-of-truth GPS reading.
  // Effective coord = demoLiveCoord during the demo's nav-simulation
  // segment, real GPS otherwise. The downstream useAnimatedLocation
  // smooths whichever source we plug in, so the demo simulation
  // benefits from the same 1 s gliding interpolation as real GPS.
  const effectiveLiveCoord = demoLiveCoord ?? liveLocation.coord;
  const animatedCoord = useAnimatedLocation(effectiveLiveCoord, 1000);

  // Heading fallback. The geolocation API often returns
  // `position.coords.heading === null` (most desktop browsers, slow
  // movement, indoors). Derive a fallback bearing from the last two
  // raw GPS coords so the chevron always points roughly in the travel
  // direction.
  const prevCoordRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastHeadingRef = useRef<number | null>(null);
  const computedHeading = useMemo<number | null>(() => {
    if (liveLocation.heading != null) {
      lastHeadingRef.current = liveLocation.heading;
      return liveLocation.heading;
    }
    if (effectiveLiveCoord && prevCoordRef.current) {
      const prev = prevCoordRef.current;
      const cur = effectiveLiveCoord;
      const dLat = cur.lat - prev.lat;
      const dLng = cur.lng - prev.lng;
      if (dLat * dLat + dLng * dLng > 2e-11) {
        const h = bearingDegrees(prev, cur);
        lastHeadingRef.current = h;
        return h;
      }
    }
    return lastHeadingRef.current ?? 0;
  }, [effectiveLiveCoord, liveLocation.heading]);

  useEffect(() => {
    if (effectiveLiveCoord) {
      prevCoordRef.current = effectiveLiveCoord;
    }
  }, [effectiveLiveCoord]);

  // Follow-cam control. `followCamActive` toggles whether each new GPS
  // fix snaps the camera back to the user. User pan/zoom flips it
  // off; a 5 s no-interaction timer flips it back on so the camera
  // resumes following. The Re-center button forces it back on too.
  const [followCamActive, setFollowCamActive] = useState(true);
  const followCamResumeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Reset to active whenever a fresh nav session starts.
    if (navigating) setFollowCamActive(true);
  }, [navigating]);

  const pauseFollowCam = useCallback(() => {
    setFollowCamActive(false);
    if (followCamResumeTimerRef.current != null) {
      window.clearTimeout(followCamResumeTimerRef.current);
    }
    followCamResumeTimerRef.current = window.setTimeout(() => {
      setFollowCamActive(true);
      followCamResumeTimerRef.current = null;
    }, 5_000);
  }, []);

  const resumeFollowCam = useCallback(() => {
    if (followCamResumeTimerRef.current != null) {
      window.clearTimeout(followCamResumeTimerRef.current);
      followCamResumeTimerRef.current = null;
    }
    setFollowCamActive(true);
  }, []);

  useEffect(
    () => () => {
      if (followCamResumeTimerRef.current != null) {
        window.clearTimeout(followCamResumeTimerRef.current);
      }
    },
    [],
  );

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
  // Demo mode time scrubber — 6 AM → 10 PM. Defaults to 14 (2 PM)
  // so the recording lands in vibrant orange/blue territory with
  // glass glare hotspots visible. The TimeScrubber slider mutates
  // this; effectiveTime below clamps the system clock to the
  // demo hour when demo mode is active.
  const isDemoModeForTime = isDemoMode;
  const [demoHour, setDemoHour] = useState(14);

  const effectiveTime = useMemo(() => {
    // Demo lock: anchor to today's date at `demoHour:00`. Locks the
    // recording to a daytime sky regardless of when in the day the
    // video is being captured, and lets the scrubber sweep the
    // entire daylight band live.
    if (isDemoModeForTime) {
      const t = new Date(timestamp);
      t.setHours(demoHour, 0, 0, 0);
      return t;
    }
    if (timeMode === 'leave-now' || !plannedTime) return timestamp;
    return plannedTime;
  }, [isDemoModeForTime, demoHour, timeMode, plannedTime, timestamp]);

  const solar = useSolarPosition(effectiveTime, NYC_CENTER.lat, NYC_CENTER.lng);
  const weather = useWeatherData(NYC_CENTER.lat, NYC_CENTER.lng);

  // METAR cross-check from JFK/LGA/EWR. The hook self-polls every
  // 30 min and logs its own snapshot; we blend its mean cover with
  // the Google Weather / Open-Meteo reading below to get a more
  // robust cloudCoverPct for the sun-classifier chain.
  const metar = useMetarData();
  const cloudCoverPct = useMemo<number>(() => {
    const ow = weather?.cloudCoverPct ?? null;
    const mt = metar?.meanCoverPct ?? null;
    if (ow != null && mt != null) {
      // Both sources present — take the mean. METAR is sub-cloud-deck
      // truth from pilots; Open-Meteo / Google Weather is the
      // wider-area model. Average smooths over the cases where one
      // source lags the actual sky by 10–20 min.
      return Math.round((ow + mt) / 2);
    }
    return ow ?? mt ?? 0;
  }, [weather?.cloudCoverPct, metar?.meanCoverPct]);

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
      // METAR-blended cloud cover so the street overlay's "is this
      // segment sunny?" gate respects the cross-checked sky state,
      // not just the single-source Open-Meteo/Google reading.
      cloudCoverPct,
    );
  }, [
    candidates.length,
    overpass.streets,
    solar.azimuthDeg,
    solar.elevationDeg,
    cloudCoverPct,
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

  // Route-color legend auto-show — fires for the first 4 s after a
  // route appears for a new origin↔destination pair. The "first time"
  // guard uses a stable string key so subsequent re-runs (filter
  // swaps, time scrubs) don't re-trigger.
  useEffect(() => {
    if (!coloredSegments || coloredSegments.length === 0) return;
    const key = `${origin?.point.lat ?? ''},${origin?.point.lng ?? ''}|${destination?.point.lat ?? ''},${destination?.point.lng ?? ''}`;
    if (legendShownForRouteRef.current === key) return;
    legendShownForRouteRef.current = key;
    setLegendAutoShow(true);
    if (legendAutoTimerRef.current != null) {
      window.clearTimeout(legendAutoTimerRef.current);
    }
    legendAutoTimerRef.current = window.setTimeout(() => {
      setLegendAutoShow(false);
      legendAutoTimerRef.current = null;
    }, 4_000);
  }, [
    coloredSegments,
    origin?.point.lat,
    origin?.point.lng,
    destination?.point.lat,
    destination?.point.lng,
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

  // ---- "Use my current location" button inside origin field -----------
  // Triggered by SearchBar's origin crosshair affordance. Requests a
  // fresh geolocation fix, reverse-geocodes it to a human-readable
  // address, then sets origin. Independent of the on-load `useCurrentLocation`
  // hook so the user can re-request a fresh fix mid-session
  // (e.g. after walking a block away).
  const [locatingOrigin, setLocatingOrigin] = useState(false);

  // ---- Tap-to-set-destination popup state -----------------------------
  // GMACanvas's onMapTap callback stashes the tap coord + screen
  // pixel here. App renders <MapTapPopup> anchored to those pixels;
  // tapping "Set as destination" reverse-geocodes the coord and
  // commits via setDestination. Tap outside (backdrop) clears.
  const [pendingTap, setPendingTap] = useState<{
    lng: number;
    lat: number;
    pixelX: number;
    pixelY: number;
  } | null>(null);
  const [settingDestination, setSettingDestination] = useState(false);

  const handleMapTap = useCallback(
    (info: { lng: number; lat: number; pixelX: number; pixelY: number }) => {
      // Suppress tap-to-destination during navigation — the live map
      // is for following the route, not re-routing.
      if (navigating) return;
      setPendingTap(info);
    },
    [navigating],
  );

  const handleConfirmDestinationFromTap = useCallback(async () => {
    if (!pendingTap) return;
    setSettingDestination(true);
    const { lat, lng } = pendingTap;
    const label =
      (await reverseGeocode(lat, lng, apiKey)) ??
      `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    setDestination({ point: { lat, lng }, label });
    setSettingDestination(false);
    setPendingTap(null);
  }, [pendingTap, apiKey]);
  const handleUseCurrentLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      console.warn('[GMA] Geolocation API not available');
      return;
    }
    setLocatingOrigin(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const label = (await reverseGeocode(lat, lng, apiKey)) ?? 'Current location';
        setOrigin({ point: { lat, lng }, label });
        setLocatingOrigin(false);
      },
      (error) => {
        console.warn('[GMA] Geolocation request failed:', error);
        setLocatingOrigin(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }, [apiKey]);

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
        solar.elevationDeg,
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
      const response = await interpretPreference(text, {
        weather: weather ?? null,
        cloudCoverPct,
        sunElevationDeg: solar.elevationDeg,
        currentTime: effectiveTime,
      });
      if (!response) {
        setToastMessage('Could not reach Gemini — try again');
        return;
      }
      if (response.mode === 'routing') {
        // Routing intent — remap to a FilterMode + intensity bump.
        const mapped = mapInterpretation(response.interpretation);
        setFilterMode(mapped.filterMode);
        setIntensityMultiplier(mapped.intensityMultiplier);
        setToastMessage(mapped.toastMessage);
        return;
      }
      // Q&A intent — Gemini already wrote a context-grounded answer.
      // Surface it as a toast (keeps the chat surface lightweight; the
      // confidence range stays in the conversation history).
      setToastMessage(response.answer);
    } finally {
      setGeminiBusy(false);
    }
  };

  // ---- Demo Mode scripted sequence ----------------------------------
  // 45 s scripted walkthrough for the recorded promo video. Activated
  // by tapping the floating START DEMO button. Each step is scheduled
  // via setTimeout from t=0; the ref array of timeout IDs lets us
  // cancel cleanly on unmount. All filter / theme / camera changes
  // hit the same setters a normal interaction would, so the demo is
  // a real end-to-end exercise of the app, not a mocked recording.
  //
  // Origin = Times Square, destination = Grand Central. Route auto-
  // fetches from the existing `[origin, destination, travelMode]`
  // effect — no manual fetchCandidateRoutes call needed.
  const runDemoSequence = useCallback(() => {
    console.log('[GMA] Demo sequence starting');
    setDemoRunning(true);
    // Wipe any leftover schedule + rAF handles before starting fresh.
    for (const id of demoTimeoutsRef.current) {
      window.clearTimeout(id);
    }
    demoTimeoutsRef.current = [];
    if (demoNavRafRef.current != null) {
      cancelAnimationFrame(demoNavRafRef.current);
      demoNavRafRef.current = null;
    }
    if (glarePulseRafRef.current != null) {
      cancelAnimationFrame(glarePulseRafRef.current);
      glarePulseRafRef.current = null;
    }
    if (demoHourRafRef.current != null) {
      cancelAnimationFrame(demoHourRafRef.current);
      demoHourRafRef.current = null;
    }
    setDemoLiveCoord(null);
    setGlarePulsePhase(0);
    legendShownForRouteRef.current = null; // force legend to re-show

    const schedule = (delayMs: number, fn: () => void) => {
      const id = window.setTimeout(fn, delayMs);
      demoTimeoutsRef.current.push(id);
    };

    // ─── Demo route: One Vanderbilt → Bryant Park ──────────────
    // Shorter (~0.25 mi) than the prior 432 Park route, which was
    // entirely south-bound on Madison and read as one continuous
    // orange streak. The west-bound corridor between One Vanderbilt
    // and Bryant Park exercises every classifier branch in the
    // visible window: shadow cast by One Vanderbilt's tower
    // (blue), 42nd-St sunny stretches (orange), Bryant Park's
    // tree edge (green), and a glass-glare hotspot directly off
    // the tower's south facade (red).
    const ORIGIN = { lat: 40.7557, lng: -73.98 };
    const DESTINATION = { lat: 40.7536, lng: -73.9832 };
    const MID_LAT = (ORIGIN.lat + DESTINATION.lat) / 2;
    const MID_LNG = (ORIGIN.lng + DESTINATION.lng) / 2;

    // ─── Cinematic intro: 2 s white title card ─────────────────
    // Title fades in over 600 ms, holds, fades out at t=1.6 s so
    // by t=2 s the map is fully revealed for the rest of the
    // sequence.
    setDemoIntroVisible(true);
    schedule(1_600, () => setDemoIntroVisible(false));

    // ─── t = 0 s : seed route + reset chrome ────────────────────
    setOrigin({ point: ORIGIN, label: 'One Vanderbilt' });
    setDestination({ point: DESTINATION, label: 'Bryant Park' });
    setMapView('2d');
    setTheme('light'); // light mode for the entire demo
    setTimeMode('leave-now');
    setPlannedTime(null);
    setFilterMode('no-preference');
    setViewState({
      longitude: MID_LNG,
      latitude: MID_LAT,
      zoom: 15,
      pitch: 30,
      bearing: 0,
      transitionDuration: 2_000,
      transitionInterpolator: new FlyToInterpolator(),
    } as MapViewState);

    // ─── t = 10 s : zoom in to street level ─────────────────────
    // Holds at the t=0 zoom-15 framing for the first 10 s so the
    // route's color palette + auto-shown legend land first.
    schedule(10_000, () => {
      setViewState({
        longitude: MID_LNG,
        latitude: MID_LAT,
        zoom: 17,
        pitch: 30,
        bearing: 0,
        transitionDuration: 2_500,
        transitionInterpolator: new FlyToInterpolator(),
      } as MapViewState);
    });

    // ─── t = 16 s : glare hotspot close-up + pulse ──────────────
    schedule(16_000, () => {
      setViewState({
        longitude: MID_LNG,
        latitude: MID_LAT,
        zoom: 18,
        pitch: 45,
        bearing: 25,
        transitionDuration: 2_500,
        transitionInterpolator: new FlyToInterpolator(),
      } as MapViewState);
      // Pulse the glare-hotspot dots: scale 1 → ~1.4 → 1 over
      // 600 ms via `glarePulsePhase` 0 → 1 → 0. Driven by rAF so
      // it tracks frames cleanly.
      const pulseStart = performance.now();
      const pulseDuration = 600;
      const pulseTick = (now: number) => {
        const t = Math.min(1, (now - pulseStart) / pulseDuration);
        setGlarePulsePhase(t);
        if (t < 1) {
          glarePulseRafRef.current = requestAnimationFrame(pulseTick);
        } else {
          glarePulseRafRef.current = null;
          // Settle back to baseline.
          window.setTimeout(() => setGlarePulsePhase(0), 50);
        }
      };
      glarePulseRafRef.current = requestAnimationFrame(pulseTick);
    });

    // ─── t = 20 s : auto-animate time scrubber 8 → 14 over 3 s ─
    schedule(20_000, () => {
      const startMs = performance.now();
      const duration = 3_000;
      const fromHour = 8;
      const toHour = 14;
      setDemoHour(fromHour);
      const tick = (now: number) => {
        const t = Math.min(1, (now - startMs) / duration);
        const hour = fromHour + (toHour - fromHour) * t;
        setDemoHour(Math.round(hour));
        if (t < 1) {
          demoHourRafRef.current = requestAnimationFrame(tick);
        } else {
          demoHourRafRef.current = null;
        }
      };
      demoHourRafRef.current = requestAnimationFrame(tick);
    });

    // ─── t = 25 s : avoid-sun filter ────────────────────────────
    // GMA's cooler-path comfort card appears alongside the fastest.
    schedule(25_000, () => setFilterMode('avoid-sun'));

    // ─── t = 35 s : avoid wind — route recolors emerald/violet ─
    schedule(35_000, () => setFilterMode('avoid-wind'));

    // ─── t = 40 s : sunny spot — yellow stars overlay ──────────
    schedule(40_000, () => setFilterMode('sunny-spot'));

    // ─── t = 45 s : Gemini routing intent from free-text ───────
    schedule(45_000, () => {
      void handleSubmitPreference('I am walking in a suit');
    });

    // ─── t = 52 s : navigation simulation (6 s walk) ───────────
    // Shorter than the prior 8 s so the simulated nav ends at
    // exactly t=58 s — the demo's final-state fly-out begins
    // immediately after the chevron finishes walking the route,
    // no awkward "Arrived at destination" beat between them.
    schedule(52_000, () => {
      if (!selectedRoute) return;
      const polyline = selectedRoute.polyline;
      if (polyline.length < 2) return;
      setNavigating(true);
      const first = polyline[0]!;
      setViewState({
        longitude: first.lng,
        latitude: first.lat,
        zoom: 18,
        pitch: 45,
        bearing: 0,
        transitionDuration: 2_000,
        transitionInterpolator: new FlyToInterpolator(),
      } as MapViewState);
      const startMs = performance.now();
      const durationMs = 6_000;
      const tick = (now: number) => {
        const elapsed = now - startMs;
        const t = Math.min(1, elapsed / durationMs);
        const idxFloat = t * (polyline.length - 1);
        const i0 = Math.floor(idxFloat);
        const i1 = Math.min(polyline.length - 1, i0 + 1);
        const frac = idxFloat - i0;
        const a = polyline[i0]!;
        const b = polyline[i1]!;
        setDemoLiveCoord({
          lat: a.lat + (b.lat - a.lat) * frac,
          lng: a.lng + (b.lng - a.lng) * frac,
        });
        if (t < 1) {
          demoNavRafRef.current = requestAnimationFrame(tick);
        } else {
          demoNavRafRef.current = null;
        }
      };
      demoNavRafRef.current = requestAnimationFrame(tick);
    });

    // ─── t = 58 s : exit nav, fly back to full-route view ──────
    // Cleanly ends the chevron walk with no "arrived" cue. Fly
    // back to the route's framing zoom + pitch 30 so the viewer
    // sees the entire 432 Park → Bryant Park polyline, glare
    // hotspots, sunny-spot stars, and the route sheet all in
    // one final composition. Set filterMode to avoid-sun so the
    // route card shows the cooler-path comfort delta as the
    // sequence settles.
    schedule(58_000, () => {
      if (demoNavRafRef.current != null) {
        cancelAnimationFrame(demoNavRafRef.current);
        demoNavRafRef.current = null;
      }
      setDemoLiveCoord(null);
      setNavigating(false);
      setFilterMode('avoid-sun');
      setViewState({
        longitude: MID_LNG,
        latitude: MID_LAT,
        zoom: 15,
        pitch: 30,
        bearing: 0,
        transitionDuration: 2_500,
        transitionInterpolator: new FlyToInterpolator(),
      } as MapViewState);
    });

    // ─── t = 60 s : silent end ─────────────────────────────────
    // No toast, no "Demo complete" message — just settle into
    // the beautiful full-route view. The Start Demo button
    // re-appears (demoRunning flips false) for a replay.
    schedule(60_000, () => {
      setDemoRunning(false);
      demoTimeoutsRef.current = [];
    });
  }, [handleSubmitPreference, setTheme, selectedRoute]);

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

  // Comfort color of the segment the user is about to walk through —
  // drives the colored stripe on top of the NextTurnIndicator pill.
  // `nearestVertexIdx` is the polyline vertex closest to the live
  // position; the segment AHEAD of it has index `nearestVertexIdx`
  // (segments are 1:1 with edges, so segment i lies between vertex i
  // and i+1). Falls back to the first segment before the first GPS fix
  // arrives, and clamps at the last segment near the destination.
  const upcomingSegmentColor = useMemo<
    [number, number, number, number] | null
  >(() => {
    if (!navigating || !coloredSegments || coloredSegments.length === 0) {
      return null;
    }
    const idx =
      routeProgress != null
        ? Math.min(routeProgress.nearestVertexIdx, coloredSegments.length - 1)
        : 0;
    return coloredSegments[idx]?.color ?? null;
  }, [navigating, coloredSegments, routeProgress?.nearestVertexIdx]);

  // Shaded / sunny / glass-glare bucketed breakdown for the SELECTED
  // route — fed into RouteCard as a slim color bar. Counts every
  // segment classified by routeColoring's priority chain:
  //   shaded  = building-shadow + tree-canopy + low-sun-angle
  //   sunny   = direct sun
  //   glare   = glass-glare specular hits
  const selectedRouteBreakdown = useMemo<SegmentBreakdown | null>(() => {
    if (!coloredSegments || coloredSegments.length === 0) return null;
    let shaded = 0;
    let sunny = 0;
    let glare = 0;
    for (const seg of coloredSegments) {
      if (seg.reason === 'sunny') sunny++;
      else if (seg.reason === 'glare') glare++;
      else shaded++; // building-shadow / tree-canopy / low-sun-angle
    }
    const total = shaded + sunny + glare;
    if (total === 0) return null;
    return {
      shadedPct: (100 * shaded) / total,
      sunnyPct: (100 * sunny) / total,
      glarePct: (100 * glare) / total,
    };
  }, [coloredSegments]);

  // ---- Sunny Spot markers (Patio Gold Rush use case) -----------------
  // Yellow star pins at sunlit patches along the route — what the user
  // selects "Sunny Spot 🌞" to find. Drawn from the route's own
  // sun-classified segments: every `STRIDE_M` meters of contiguous
  // sunny stretch gets one star, restarting the counter whenever the
  // route enters shade so each new sunny pocket gets its own star
  // even if it's short.
  //
  // This is a coloredSegment-derived proxy for true outdoor cafe /
  // park positions. A future iteration could overlay Overpass-fetched
  // amenity=cafe + leisure=park nodes filtered to high-exposure spots.
  const sunnySpots = useMemo<{ lat: number; lng: number }[] | null>(() => {
    if (filterMode !== 'sunny-spot') return null;
    if (!coloredSegments || coloredSegments.length === 0) return null;
    const STRIDE_M = 120;
    const spots: { lat: number; lng: number }[] = [];
    let distSinceLast = STRIDE_M; // emit first eligible segment
    for (const seg of coloredSegments) {
      const isSunny = seg.reason === 'sunny' || seg.reason === 'glare';
      if (!isSunny) {
        distSinceLast = STRIDE_M;
        continue;
      }
      const a = seg.path[0];
      const b = seg.path[1];
      if (!a || !b) continue;
      const dLng = b[0] - a[0];
      const dLat = b[1] - a[1];
      const segLenM = Math.sqrt(
        (dLng * 84_500) ** 2 + (dLat * 111_000) ** 2,
      );
      if (distSinceLast >= STRIDE_M) {
        spots.push({
          lat: (a[1] + b[1]) / 2,
          lng: (a[0] + b[0]) / 2,
        });
        distSinceLast = 0;
      }
      distSinceLast += segLenM;
    }

    // Layer in nearby outdoor spaces (Overpass parks + cafes with
    // outdoor_seating=yes) that sit within ~150 m of the route AND
    // happen to be sunny right now per the route classifier. The
    // proximity check uses the closest route-segment midpoint; the
    // sunny check inherits classification from that nearest segment
    // (an OutdoorSpot near a sunny segment is sunny, near a shaded
    // segment is shaded). Skip night entirely.
    if (
      solar.elevationDeg > 0 &&
      overpass.outdoorSpots.length > 0 &&
      coloredSegments.length > 0
    ) {
      const NEAR_M = 150;
      let outdoorSunnyCount = 0;
      for (const spot of overpass.outdoorSpots) {
        let bestDist = Infinity;
        let bestSunny = false;
        for (const seg of coloredSegments) {
          const a = seg.path[0];
          const b = seg.path[1];
          if (!a || !b) continue;
          const midLng = (a[0] + b[0]) / 2;
          const midLat = (a[1] + b[1]) / 2;
          const dLng = (spot.lng - midLng) * 84_500;
          const dLat = (spot.lat - midLat) * 111_000;
          const dM = Math.sqrt(dLng * dLng + dLat * dLat);
          if (dM < bestDist) {
            bestDist = dM;
            bestSunny =
              seg.reason === 'sunny' || seg.reason === 'glare';
          }
        }
        if (bestDist <= NEAR_M && bestSunny) {
          spots.push({ lat: spot.lat, lng: spot.lng });
          outdoorSunnyCount++;
        }
      }
      console.log('[GMA] Sunny Spot outdoor scan', {
        outdoorSpotsFetched: overpass.outdoorSpots.length,
        outdoorSpotsSunny: outdoorSunnyCount,
        routeSpots: spots.length - outdoorSunnyCount,
      });
    }

    return spots.length > 0 ? spots : null;
  }, [
    filterMode,
    coloredSegments,
    overpass.outdoorSpots,
    solar.elevationDeg,
  ]);

  const remainingDurationS = selectedRoute
    ? selectedRoute.distanceMeters > 0
      ? selectedRoute.durationSeconds *
        (remainingDistanceM / selectedRoute.distanceMeters)
      : selectedRoute.durationSeconds
    : 0;

  // ---- follow-cam --------------------------------------------------
  // While navigating AND `followCamActive`, every new live geolocation
  // fix re-centers the map on the user with a 500 ms FlyToInterpolator
  // transition (was 200 ms — bumped per spec so the camera glides
  // rather than snapping). Pitch 0 keeps the chase consistent across
  // 2D/3D/satellite. Zoom 17 keeps a wider band of the route in view.
  // Bearing follows the COMPUTED heading (GPS heading when available,
  // else movement bearing) so the chevron's nose stays aligned with
  // travel direction.
  //
  // When `followCamActive` is false (user has panned/zoomed), the
  // effect short-circuits — the camera stays where the user left it
  // until they tap the Re-center button or the 5 s no-interaction
  // timer flips followCamActive back on.
  useEffect(() => {
    if (!navigating || !liveLocation.coord || !followCamActive) return;
    setViewState({
      longitude: liveLocation.coord.lng,
      latitude: liveLocation.coord.lat,
      zoom: 17,
      pitch: 0,
      bearing: computedHeading ?? 0,
      transitionDuration: 500,
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
    computedHeading,
    followCamActive,
  ]);

  const phaseDisplay =
    daylight.phase.charAt(0).toUpperCase() + daylight.phase.slice(1);

  // Shared chrome rendered inside the map area on both layouts.
  // Returns a Fragment so it can be slotted into either the
  // `relative flex-1` desktop map container or directly into the
  // mobile root.
  const renderMapAndSharedChrome = () => (
    <>
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
        onViewStateChange={(next, userInteracting) => {
          setViewState(next);
          if (navigating && userInteracting) {
            pauseFollowCam();
          }
        }}
        liveLocation={
          animatedCoord
            ? {
                lat: animatedCoord.lat,
                lng: animatedCoord.lng,
                accuracyM: liveLocation.accuracyM,
                headingDeg: computedHeading,
              }
            : null
        }
        navigating={navigating}
        theme={theme}
        // Pins render whenever a route is on the map (selectedRoute
        // is non-null) OR during navigation. This way the user sees
        // green/red endpoints from the moment the route is computed
        // through the entire follow-cam session.
        originPoint={
          selectedRoute || navigating ? origin?.point ?? null : null
        }
        destinationPoint={
          selectedRoute || navigating ? destination?.point ?? null : null
        }
        sunnySpots={sunnySpots}
        glarePulsePhase={glarePulsePhase}
        onMapTap={handleMapTap}
      />

      {pendingTap && !navigating && (
        <MapTapPopup
          pixelX={pendingTap.pixelX}
          pixelY={pendingTap.pixelY}
          onSetDestination={handleConfirmDestinationFromTap}
          onDismiss={() => setPendingTap(null)}
          busy={settingDestination}
        />
      )}

      <SunGlow
        sunAzimuthDeg={solar.azimuthDeg}
        sunElevationDeg={solar.elevationDeg}
        dayColor={daylight.color}
      />

      {!navigating && <ThemeToggle theme={theme} onToggle={toggleTheme} />}

      {/* Mobile-only floating top stack — gated on !useSidebar so it
       * never paints on desktop (where the same chrome lives in the
       * sidebar). */}
      {!useSidebar && !navigating && (
        <div
          className="pointer-events-none absolute left-2 right-[4.5rem] top-0 z-40 flex flex-col items-center gap-2"
          style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)' }}
        >
          <div className="w-full max-w-[460px]">
            <SearchBar
              origin={origin}
              destination={destination}
              onOriginChange={setOrigin}
              onDestinationChange={setDestination}
              onSwap={handleSwap}
              onUseCurrentLocation={handleUseCurrentLocation}
              locating={locatingOrigin}
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

      {/* Mobile-only floating route sheet + Start button */}
      {!useSidebar && !navigating && sheetOpen && (
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
          sunElevationDeg={solar.elevationDeg}
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
          selectedRouteBreakdown={selectedRouteBreakdown}
        />
      )}
      {!useSidebar && (
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
      )}

      {navigating && selectedRoute && destination && (
        <>
          <NavigationHeader
            destinationLabel={destination.label}
            remainingDistanceM={remainingDistanceM}
            remainingDurationS={remainingDurationS}
            onStop={handleStopNavigation}
          />
          <NextTurnIndicator
            nextTurn={nextTurn}
            upcomingColor={upcomingSegmentColor}
          />
          <RecenterButton
            visible={!followCamActive}
            onRecenter={resumeFollowCam}
          />
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
          // On desktop the sheet lives in the sidebar — never overlaps
          // the SunCompass which sits bottom-left of the map area.
          routeSheetOpen={!useSidebar && sheetOpen}
        />
      )}

      {/* Floating time scrubber — mobile only. Desktop renders an
       * embedded copy at the bottom of the sidebar (see below) so the
       * scrubber doesn't overlap the route on the map. */}
      <TimeScrubber
        visible={!useSidebar && isDemoMode && !navigating}
        hour={demoHour}
        onChange={setDemoHour}
      />

      {/* Desktop-only persistent legend card. Sits above the "?"
       * button and lists the four map-layer color codes (glare
       * hotspot, tree dot, sunny segment, shaded segment) so the
       * user always has the symbol→meaning lookup on screen. Mobile
       * keeps its on-tap "?" tooltip instead — the persistent card
       * would crowd a phone viewport. */}
      <PersistentMapLegend
        visible={
          useSidebar &&
          !navigating &&
          coloredSegments != null &&
          coloredSegments.length > 0
        }
      />

      {/* Persistent "?" route-color legend button — bottom-left.
       * Visible whenever a colored route is on the map so the user
       * can recall the legend after the auto-show has faded. */}
      <RouteLegendButton
        visible={
          !navigating &&
          coloredSegments != null &&
          coloredSegments.length > 0
        }
        onToggle={() => setLegendManualShow((v) => !v)}
      />
      <RouteLegendOverlay
        autoShow={legendAutoShow}
        manualShow={legendManualShow}
        onDismiss={() => setLegendManualShow(false)}
      />

      {/* Demo cinematic chrome — progress bar at very top, voiceover
       * pill at 70 % viewport height, intro title card. All gated on
       * `?demo=true` so they never render outside demo runs. */}
      <DemoProgressBar active={demoRunning} durationMs={60_000} />
      <DemoIntroOverlay visible={demoIntroVisible} />

      <MapViewSwitcher
        value={mapView}
        onChange={setMapView}
        // Sidebar layout never overlaps the switcher, so leave the
        // mobile-sheet bottom-stacking off.
        routeSheetOpen={!useSidebar && sheetOpen && !navigating}
        navigating={navigating}
        // On desktop, stack just below the ThemeToggle at top-right
        // so the two form a single vertical toolbar (item 4 of the
        // 2026-06-07 polish pass).
        stackedTopRight={useSidebar}
      />

      <DataAttribution
        // Floating attribution is mobile-only now — desktop renders
        // an inline copy at the bottom of the sidebar. Hidden during
        // navigation and when the mobile sheet covers the band.
        visible={!useSidebar && !navigating && !sheetOpen}
      />
    </>
  );

  return useSidebar ? (
    // ─── DESKTOP LAYOUT ────────────────────────────────────────────
    // 380 px sidebar on the left contains search + transport pills +
    // time picker + (when routes exist) the embedded RouteSheet + the
    // embedded Start button. Everything stays fully visible without
    // truncation — the routes list itself scrolls inside the sheet.
    // Map fills the remaining `flex-1` area; all the floating chrome
    // (ThemeToggle, SunCompass, MapViewSwitcher) positions relative
    // to that map area, so it never overlaps the sidebar.
    <div className="relative flex h-dvh w-dvw overflow-hidden bg-[var(--gma-bg)]">
      <aside
        className="flex w-[380px] shrink-0 flex-col gap-3 overflow-hidden border-r p-4"
        style={{
          borderColor: 'var(--gma-border)',
          background: 'var(--gma-bg)',
          paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)',
        }}
        aria-label="Search + route options"
      >
        {isDemoMode && !demoRunning && (
          <button
            type="button"
            onClick={() => {
              console.log('[GMA] Start Demo clicked (sidebar button)');
              runDemoSequence();
            }}
            className="gma-press flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-semibold uppercase tracking-[0.18em]"
            style={{
              background: 'rgba(30, 41, 59, 0.06)',
              color: 'rgb(30, 41, 59)',
              border: '1px solid rgba(30, 41, 59, 0.12)',
              fontFamily: 'var(--font-data)',
            }}
            aria-label="Start the recorded demo sequence"
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'rgb(220, 38, 38)',
              }}
            />
            Start Demo
          </button>
        )}
        <SearchBar
          origin={origin}
          destination={destination}
          onOriginChange={setOrigin}
          onDestinationChange={setDestination}
          onSwap={handleSwap}
          onUseCurrentLocation={handleUseCurrentLocation}
          locating={locatingOrigin}
        />
        {sheetOpen && (
          <TransportModeSwitcher
            value={travelMode}
            onChange={setTravelMode}
            dayColor={daylight.color}
          />
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
        {sheetOpen && (
          <RouteSheet
            embedded
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
            sunElevationDeg={solar.elevationDeg}
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
            selectedRouteBreakdown={selectedRouteBreakdown}
          />
        )}
        <StartButton
          embedded
          visible={
            !navigating &&
            sheetOpen &&
            !routesLoading &&
            (result?.routes.length ?? 0) > 0
          }
          dayColor={daylight.color}
          onStart={handleStartNavigation}
        />
        {/* Embedded desktop time scrubber — sits at the bottom of
         * the sidebar so it doesn't overlap the route on the map.
         * Demo-only; visible when ?demo=true. */}
        {isDemoMode && !navigating && (
          <div className="mt-auto pt-2">
            <TimeScrubber
              visible
              embedded
              hour={demoHour}
              onChange={setDemoHour}
            />
          </div>
        )}
        {/* Sidebar-bottom attribution — replaces the floating chip
         * on desktop so the map area stays clean. Inline (not gma-glass)
         * so it sits flat at the bottom of the sidebar column. */}
        <div
          className={
            'pt-2 text-[10px] leading-snug ' +
            (isDemoMode && !navigating ? '' : 'mt-auto')
          }
          style={{
            color: 'rgb(71, 85, 105)',
            fontFamily: 'var(--font-data)',
            borderTop: '1px solid var(--gma-border)',
          }}
          aria-label="Data sources"
        >
          Sun data: Google Solar API · Trees: OpenStreetMap · Updated live
        </div>
        {/* GMA · Beta — tiny version chip at the very bottom of the
         * sidebar. slate-400 so it sits as a quiet trust signal
         * without competing with anything else for attention. */}
        <div
          className="pt-1.5 text-center text-[10px] uppercase tracking-[0.22em]"
          style={{
            color: 'rgb(148, 163, 184)', // slate-400
            fontFamily: 'var(--font-data)',
          }}
          aria-label="App version"
        >
          GMA · Beta
        </div>
      </aside>
      <div className="relative flex-1 overflow-hidden">
        {renderMapAndSharedChrome()}
      </div>
      <Toast message={toastMessage} />
      <VersionLabel />
      <DemoWatermark visible={isDemoMode} />
      <DemoButton
        // Floating CTA is mobile-only; the desktop sidebar renders
        // its own subtle Start Demo button at the top.
        visible={!useSidebar && isDemoMode && !demoRunning}
        onStart={runDemoSequence}
      />
    </div>
  ) : (
    // ─── MOBILE / NAVIGATION LAYOUT ────────────────────────────────
    // Single relative container — GMACanvas + all floating chrome
    // siblings, positioned absolutely against the viewport. Identical
    // to the pre-sidebar mobile structure.
    <div className="relative h-dvh w-dvw overflow-hidden bg-[var(--gma-bg)]">
      {renderMapAndSharedChrome()}
      <Toast message={toastMessage} />
      <VersionLabel />
      <DemoWatermark visible={isDemoMode} />
      <DemoButton
        // Floating CTA is mobile-only; the desktop sidebar renders
        // its own subtle Start Demo button at the top.
        visible={!useSidebar && isDemoMode && !demoRunning}
        onStart={runDemoSequence}
      />
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
  sunElevationDeg: number,
): string {
  const MAX_DELTA = 15;
  const sunExposure = route.meanSunExposure ?? 0.5;
  const windExposure = route.meanWindExposure ?? 0;
  const precipExposure = route.meanPrecipExposure ?? 0;

  // Night routing — every sun-aware filter collapses to the same
  // "no sun exposure" toast since the sun is below the horizon.
  // Rain/wind branches below still fire (they're real signals at
  // night too) so we only short-circuit when the filter cares about
  // the sun.
  const isNight = sunElevationDeg <= 0;
  const isSunAware =
    filterMode === 'avoid-sun' ||
    filterMode === 'avoid-both' ||
    filterMode === 'sunniest' ||
    filterMode === 'sunny-spot' ||
    filterMode === 'no-preference';
  if (isNight && isSunAware) {
    return '🌙 No sun exposure · Night routing';
  }

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
      ? `☀️ Catching maximum sun · ~${Math.abs(warmer)}°F warmer`
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
    ? `🌳 Feels ~${Math.abs(cooler)}°F cooler`
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
