import { useCallback, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import type { PickingInfo } from '@deck.gl/core';
import {
  BitmapLayer,
  IconLayer,
  PathLayer,
  PolygonLayer,
  ScatterplotLayer,
} from '@deck.gl/layers';
import { Tile3DLayer, TileLayer } from '@deck.gl/geo-layers';
import { Tiles3DLoader } from '@loaders.gl/3d-tiles';
import type { Color, Layer, MapViewState } from '@deck.gl/core';
import type { ScoredRoute } from '../lib/hlciRouter';
import type { ColoredSegment } from '../lib/routeColoring';
import type { StreetSegmentExposure } from '../lib/streetSunColoring';
import type { BuildingShadow } from '../lib/buildingShadows';
import type { TreeNode, GreenArea } from '../lib/overpass';
import type { GlareHotspot } from '../lib/glassGlare';
import type { MapView } from './MapViewSwitcher';

const GOOGLE_3D_TILES_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';

// CartoDB Positron — light, Google-Maps-like raster basemap. Replaces the
// dark sci-fi Dark Matter tiles from the previous build.
const CARTO_POSITRON_TILES = [
  'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
];

// Carto "Dark Matter" — the same tile set with a near-black basemap.
// Picked automatically in dark mode so the 2D map matches the UI theme.
const CARTO_DARK_MATTER_TILES = [
  'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
];

const ESRI_SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// Forest/wood polygon fill — translucent green so it reads as "green area"
// without obscuring map labels.
const FOREST_FILL: Color = [30, 130, 60, 50];
const FOREST_OUTLINE: Color = [30, 100, 50, 120];

// Tree dot color — per spec rgba(30, 100, 50, 0.6).
const TREE_DOT_COLOR: Color = [30, 100, 50, 153];

// Building footprint / shadow polygon fill — per the UI-polish pass:
// `rgba(100, 100, 120, 0.08)` no stroke. Buildings (rendered at the
// projected shadow location) are now an almost-invisible grey hint
// rather than a high-contrast dark block, so the route polyline reads
// as the dominant on-map signal.
const SHADOW_FILL: Color = [100, 100, 120, 20];

// Glass-glare hotspot fill — warm orange-red at 0.5 alpha, 15 m radius
// dots projected where reflected sun rays from glass-clad buildings hit
// the ground. Rendered BELOW the route polyline so the route's deep-red
// glare segments remain visible on top.
const GLARE_HOTSPOT_FILL: Color = [255, 107, 53, 128]; // #FF6B35 @ 0.5

// ---- Navigation marker icons (inline SVG → data URL) -------------------
// Three icons rendered via deck.gl IconLayer during navigation mode:
//   - HEADING_CHEVRON: blue triangle sitting under the live-location dot,
//     rotated to the compass heading so the user can read which way they
//     are facing at a glance.
//   - ORIGIN_PIN_SVG / DEST_PIN_SVG: green and red map-pins anchored at
//     the route's origin and destination points respectively, visible
//     for the entire navigation session.
// All three are encoded as base64 data URLs at module scope so the
// browser caches them after the first IconLayer paint.
const HEADING_CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<path d="M16 4 L26 28 L16 22 L6 28 Z" fill="rgba(66,133,244,0.92)" stroke="white" stroke-width="2" stroke-linejoin="round"/>' +
  '</svg>';

const ORIGIN_PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40">' +
  '<path d="M16 2 C8 2 2 8 2 16 C2 24 16 38 16 38 C16 38 30 24 30 16 C30 8 24 2 16 2 Z" fill="rgb(16,185,129)" stroke="white" stroke-width="2"/>' +
  '<circle cx="16" cy="16" r="5" fill="white"/>' +
  '</svg>';

const DEST_PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40">' +
  '<path d="M16 2 C8 2 2 8 2 16 C2 24 16 38 16 38 C16 38 30 24 30 16 C30 8 24 2 16 2 Z" fill="rgb(220,38,38)" stroke="white" stroke-width="2"/>' +
  '<circle cx="16" cy="16" r="5" fill="white"/>' +
  '</svg>';

const HEADING_CHEVRON_URL = `data:image/svg+xml;base64,${btoa(HEADING_CHEVRON_SVG)}`;
const ORIGIN_PIN_URL = `data:image/svg+xml;base64,${btoa(ORIGIN_PIN_SVG)}`;
const DEST_PIN_URL = `data:image/svg+xml;base64,${btoa(DEST_PIN_SVG)}`;

const HEADING_CHEVRON_ICON = {
  url: HEADING_CHEVRON_URL,
  width: 32,
  height: 32,
  anchorX: 16,
  anchorY: 16,
  mask: false,
};

const ORIGIN_PIN_ICON = {
  url: ORIGIN_PIN_URL,
  width: 32,
  height: 40,
  anchorX: 16,
  anchorY: 38, // anchor at the point of the pin
  mask: false,
};

const DEST_PIN_ICON = {
  url: DEST_PIN_URL,
  width: 32,
  height: 40,
  anchorX: 16,
  anchorY: 38,
  mask: false,
};

export interface GMACanvasProps {
  selectedRoute: ScoredRoute | null;
  /** Per-segment route colored by sun / tree / building shadow status. */
  coloredSegments: ColoredSegment[] | null;
  /**
   * Per-segment street exposure entries — same array the route scorer
   * samples against. The renderer reads `.path` + `.color`, the scorer
   * reads `.exposure` via the spatial index. One source of truth.
   */
  streetExposures: StreetSegmentExposure[] | null;
  /** Tree positions for the green dot layer. */
  trees: TreeNode[];
  /** Forest / wood polygon outlines. */
  forests: GreenArea[];
  /** Projected building shadows from the live sun position. */
  buildingShadows: BuildingShadow[];
  mapView: MapView;
  viewState: MapViewState;
  onViewStateChange: (next: MapViewState) => void;
  /**
   * Glass-glare hotspots projected from glass-clad buildings. Rendered
   * as 15 m orange-red dots between the shadow + street-overlay layers
   * and the route polyline (so the route's deep-red glare segments stay
   * visible on top). Null / empty hides the layer entirely.
   */
  glareHotspots: GlareHotspot[] | null;
  /**
   * User's live position from useLiveLocation. When present, GMACanvas
   * renders a pulsing blue dot like Google Maps. `headingDeg` (degrees
   * clockwise from N) gates a directional chevron rendered ON the dot
   * during navigation so the user can read which way they're facing
   * at a glance — null hides the chevron and falls back to a plain
   * blue dot.
   */
  liveLocation: {
    lat: number;
    lng: number;
    accuracyM: number | null;
    headingDeg?: number | null;
  } | null;
  /**
   * Whether the app is in navigation mode — bumps the route polyline
   * width and skips the picking/tooltip behavior so the live dot reads
   * as the primary signal. Also enables the green origin pin + red
   * destination pin via `originPoint` / `destinationPoint`.
   */
  navigating: boolean;
  /** Green pin shown at the route's origin while navigating. */
  originPoint?: { lat: number; lng: number } | null;
  /** Red pin shown at the route's destination while navigating. */
  destinationPoint?: { lat: number; lng: number } | null;
  /**
   * Active theme — drives map-overlay opacity. Light mode keeps overlays
   * subtle (so the white basemap stays readable); dark mode amplifies to
   * vivid (so the route + glare hotspots glow against the dark map).
   */
  theme: 'light' | 'dark';
}

export function GMACanvas({
  selectedRoute,
  coloredSegments,
  streetExposures,
  trees,
  forests,
  buildingShadows,
  mapView,
  viewState,
  onViewStateChange,
  glareHotspots,
  liveLocation,
  navigating,
  theme,
  originPoint,
  destinationPoint,
}: GMACanvasProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const isDark = theme === 'dark';

  // Per-mode overlay alpha multiplier. Light: 1.0 (subtle, ≤ 0.2 absolute
  // alpha across overlays). Dark: 2.0 (vivid, ~0.5 alpha cap) so the
  // route reads against the dark basemap.
  const alphaMul = isDark ? 2.0 : 1.0;
  const tintAlpha = (rgba: Color): Color => [
    rgba[0],
    rgba[1],
    rgba[2],
    Math.min(255, Math.round((rgba[3] ?? 255) * alphaMul)),
  ];

  const layers = useMemo<Layer[]>(() => {
    const out: Layer[] = [];

    // ---- basemap -----------------------------------------------------
    if (mapView === '3d') {
      if (apiKey) {
        out.push(
          new Tile3DLayer({
            id: 'google-photorealistic-3d-tiles',
            data: `${GOOGLE_3D_TILES_ROOT}?key=${apiKey}`,
            loader: Tiles3DLoader,
            loadOptions: { fetch: { headers: { 'X-GOOG-API-KEY': apiKey } } },
          }),
        );
      }
    } else {
      out.push(buildBasemapTileLayer(mapView, theme));
    }

    // ---- forest / wood polygon fills --------------------------------
    // Suppressed in navigation mode: only base map + route polyline +
    // live-location dot remain, dramatically reducing GPU load so the
    // follow-cam stays at 60 FPS on mobile.
    if (!navigating && forests.length > 0) {
      out.push(
        new PolygonLayer<GreenArea>({
          id: 'forests',
          data: forests,
          getPolygon: (d) => d.polygon,
          getFillColor: tintAlpha(FOREST_FILL),
          getLineColor: tintAlpha(FOREST_OUTLINE),
          getLineWidth: 1,
          lineWidthUnits: 'pixels',
          stroked: true,
          filled: true,
          pickable: false,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
        }),
      );
    }

    // ---- building shadow projection ---------------------------------
    if (!navigating && buildingShadows.length > 0) {
      out.push(
        new PolygonLayer<BuildingShadow>({
          id: 'building-shadows',
          data: buildingShadows,
          getPolygon: (d) => d.polygon,
          getFillColor: tintAlpha(SHADOW_FILL),
          stroked: false,
          filled: true,
          pickable: false,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
          updateTriggers: {
            getPolygon: buildingShadows,
          },
        }),
      );
    }

    // ---- street sun overlay (per-segment exposure → color) ----------
    // Width bumped from 4→6 (min 4→5) so the colored stripe reads on the
    // white Positron basemap. Spec said 4 px which looked great on the
    // previous dark base; needed more presence here. Each segment's
    // .color is derived from its continuous .exposure value, the SAME
    // value the route scorer samples to compute the comfort %.
    if (!navigating && streetExposures && streetExposures.length > 0) {
      out.push(
        new PathLayer<StreetSegmentExposure>({
          id: 'street-sun-overlay',
          data: streetExposures,
          getPath: (d) => d.path,
          getColor: (d) => d.color,
          getWidth: 6,
          widthUnits: 'pixels',
          widthMinPixels: 5,
          capRounded: true,
          jointRounded: true,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
          updateTriggers: {
            getPath: streetExposures,
            getColor: streetExposures,
          },
        }),
      );
    }

    // ---- tree dots --------------------------------------------------
    if (!navigating && trees.length > 0) {
      out.push(
        new ScatterplotLayer<TreeNode>({
          id: 'trees',
          data: trees,
          getPosition: (t) => [t.lng, t.lat],
          getFillColor: TREE_DOT_COLOR,
          getRadius: 8,
          radiusUnits: 'meters',
          radiusMinPixels: 2,
          radiusMaxPixels: 10,
          stroked: false,
          pickable: false,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
        }),
      );
    }

    // ---- glass glare hotspots ---------------------------------------
    // Orange-red 15 m dots at the projected ground impact of reflected
    // sun rays from glass-clad buildings. Painted under the route
    // polyline so the route's deep-red glare segments stay visible.
    if (!navigating && glareHotspots && glareHotspots.length > 0) {
      out.push(
        new ScatterplotLayer<GlareHotspot>({
          id: 'glare-hotspots',
          data: glareHotspots,
          getPosition: (h) => [h.lng, h.lat],
          getFillColor: tintAlpha(GLARE_HOTSPOT_FILL),
          // Dark mode bumps the dot radius too so it reads as a glowing
          // marker, not just a tinted point.
          getRadius: isDark ? 22 : 15,
          radiusUnits: 'meters',
          radiusMinPixels: isDark ? 10 : 6,
          radiusMaxPixels: isDark ? 38 : 28,
          stroked: false,
          pickable: false,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
          updateTriggers: { getPosition: glareHotspots },
        }),
      );
    }

    // ---- route polyline (one clean thick line, no halo) ------------
    // The route is ALWAYS rendered as N independent ColoredSegment
    // paths with a per-segment `getColor` accessor — the same colors
    // shown during route selection (amber sunny / blue shaded /
    // emerald tree-canopy) persist verbatim into navigation mode. The
    // navigation-only delta is width (12 px vs 8 px) and disabling
    // picking so the live-location dot reads as the primary signal.
    // The accessor receives the segment's own .color so each polyline
    // segment paints independently — there is no path here where a
    // single solid color would be substituted.
    if (selectedRoute && selectedRoute.polyline.length >= 2) {
      if (coloredSegments && coloredSegments.length > 0) {
        const sunnyCount = coloredSegments.filter((s) => s.reason === 'sunny').length;
        const treeCount = coloredSegments.filter((s) => s.reason === 'tree-canopy').length;
        const shadedCount = coloredSegments.length - sunnyCount - treeCount;
        console.log('[GMA] Route polyline:', {
          mode: navigating ? 'navigation' : 'selection',
          points: selectedRoute.polyline.length,
          coloredSegments: coloredSegments.length,
          sunny: sunnyCount,
          treeCanopy: treeCount,
          shaded: shadedCount,
          widthPx: navigating ? 12 : 8,
        });
        out.push(
          new PathLayer<ColoredSegment>({
            id: 'route-comfort-overlay',
            data: coloredSegments,
            getPath: (d) => d.path,
            getColor: (d) => d.color,
            getWidth: navigating ? 12 : 8,
            widthUnits: 'pixels',
            widthMinPixels: navigating ? 10 : 7,
            capRounded: true,
            jointRounded: true,
            pickable: !navigating,
            highlightColor: [255, 255, 255, 60],
            autoHighlight: !navigating,
            parameters: { depthCompare: 'always', depthWriteEnabled: false },
            updateTriggers: {
              getPath: coloredSegments,
              getColor: coloredSegments,
            },
          }),
        );
      }
    }

    // ---- navigation marker pins (green origin / red destination) ----
    // Mounted only during navigation so the user always knows where
    // they started and where they're going, even when the follow-cam
    // pans far from either endpoint. Both anchor at the point of the
    // pin (anchorY: 38) so the geo coord is exactly underneath the tip.
    if (navigating && originPoint) {
      out.push(
        new IconLayer<{ lat: number; lng: number }>({
          id: 'nav-origin-pin',
          data: [originPoint],
          getPosition: (d) => [d.lng, d.lat],
          getIcon: () => ORIGIN_PIN_ICON,
          getSize: 40,
          sizeUnits: 'pixels',
          pickable: false,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
          updateTriggers: {
            getPosition: [originPoint.lng, originPoint.lat],
          },
        }),
      );
    }
    if (navigating && destinationPoint) {
      out.push(
        new IconLayer<{ lat: number; lng: number }>({
          id: 'nav-destination-pin',
          data: [destinationPoint],
          getPosition: (d) => [d.lng, d.lat],
          getIcon: () => DEST_PIN_ICON,
          getSize: 40,
          sizeUnits: 'pixels',
          pickable: false,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
          updateTriggers: {
            getPosition: [destinationPoint.lng, destinationPoint.lat],
          },
        }),
      );
    }

    // ---- live location dot (Google-Maps-style blue) ----------------
    // Three stacked layers when a heading is known:
    //   1. Accuracy halo (soft blue circle, ScatterplotLayer)
    //   2. Heading chevron (IconLayer, rotated to compass heading)
    //   3. Solid blue dot with white border (ScatterplotLayer)
    // The chevron renders BENEATH the dot so the dot is the visual
    // anchor and the chevron reads as an under-fanned direction cue.
    if (liveLocation) {
      const liveData = [liveLocation];
      out.push(
        new ScatterplotLayer<{
          lat: number;
          lng: number;
          accuracyM: number | null;
        }>({
          id: 'live-location-halo',
          data: liveData,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: (d) => Math.max(20, d.accuracyM ?? 25),
          radiusUnits: 'meters',
          radiusMinPixels: 18,
          radiusMaxPixels: 60,
          getFillColor: [66, 133, 244, 55],
          stroked: false,
          filled: true,
          pickable: false,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
          updateTriggers: {
            getPosition: [liveLocation.lng, liveLocation.lat],
            getRadius: liveLocation.accuracyM,
          },
        }),
      );

      // Heading chevron — only when we have a real compass heading
      // from the geolocation watch (typically only true on mobile
      // devices that have a compass + the user is moving).
      // deck.gl IconLayer `getAngle` rotates COUNTERCLOCKWISE in
      // degrees, so negate the compass heading (which is clockwise
      // from north) to get the chevron's nose pointing in travel
      // direction.
      if (liveLocation.headingDeg != null) {
        out.push(
          new IconLayer<{
            lat: number;
            lng: number;
            headingDeg?: number | null;
          }>({
            id: 'live-location-heading',
            data: liveData,
            getPosition: (d) => [d.lng, d.lat],
            getIcon: () => HEADING_CHEVRON_ICON,
            getSize: 38,
            sizeUnits: 'pixels',
            getAngle: (d) => -(d.headingDeg ?? 0),
            pickable: false,
            parameters: { depthCompare: 'always', depthWriteEnabled: false },
            updateTriggers: {
              getPosition: [liveLocation.lng, liveLocation.lat],
              getAngle: liveLocation.headingDeg,
            },
          }),
        );
      }

      out.push(
        new ScatterplotLayer<{ lat: number; lng: number }>({
          id: 'live-location-dot',
          data: liveData,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: 7,
          radiusUnits: 'meters',
          radiusMinPixels: 8,
          radiusMaxPixels: 12,
          getFillColor: [66, 133, 244, 255],
          getLineColor: [255, 255, 255, 255],
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 2,
          getLineWidth: 2,
          stroked: true,
          filled: true,
          pickable: false,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
          updateTriggers: {
            getPosition: [liveLocation.lng, liveLocation.lat],
          },
        }),
      );
    }

    return out;
  }, [
    apiKey,
    mapView,
    selectedRoute,
    coloredSegments,
    streetExposures,
    trees,
    forests,
    buildingShadows,
    glareHotspots,
    liveLocation,
    navigating,
    theme,
    originPoint,
    destinationPoint,
  ]);

  const getTooltip = useCallback(
    (info: PickingInfo) => {
      if (!info.layer || info.layer.id !== 'route-comfort-overlay') return null;
      const obj = info.object as ColoredSegment | undefined;
      if (!obj?.label) return null;
      return {
        html: buildDiagnosticTooltipHtml(obj),
        style: {
          background: isDark ? 'rgba(18, 18, 28, 0.95)' : '#ffffff',
          color: isDark ? '#f1f5f9' : '#1a1a2e',
          padding: '10px 12px',
          borderRadius: '10px',
          border: isDark
            ? '1px solid rgba(255, 255, 255, 0.18)'
            : '1px solid rgba(0, 0, 0, 0.08)',
          boxShadow: isDark
            ? '0 8px 24px rgba(0, 0, 0, 0.5)'
            : '0 8px 20px rgba(0, 0, 0, 0.15)',
          fontFamily: 'var(--font-data)',
          fontSize: '11px',
          letterSpacing: '0.02em',
          maxWidth: '320px',
          backdropFilter: isDark ? 'blur(12px)' : undefined,
        },
      };
    },
    [isDark],
  );

  return (
    <div className="absolute inset-0">
      <DeckGL
        viewState={viewState}
        controller
        layers={layers}
        getTooltip={getTooltip}
        onViewStateChange={({ viewState: next }) => {
          onViewStateChange(next as MapViewState);
        }}
      />
      {!apiKey && <MissingKeyOverlay />}
    </div>
  );
}

function buildBasemapTileLayer(
  mapView: Exclude<MapView, '3d'>,
  theme: 'light' | 'dark',
): TileLayer {
  const cartoTiles =
    theme === 'dark' ? CARTO_DARK_MATTER_TILES : CARTO_POSITRON_TILES;
  const data = mapView === '2d' ? cartoTiles : ESRI_SATELLITE_TILES;
  return new TileLayer({
    id: `basemap-${mapView}-${theme}`,
    data,
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    renderSubLayers: (props) => {
      const tile = props.tile as unknown as {
        boundingBox: [[number, number], [number, number]];
      };
      const [[west, south], [east, north]] = tile.boundingBox;
      const image = props.data as unknown as
        | string
        | HTMLImageElement
        | HTMLCanvasElement
        | ImageBitmap
        | null;
      if (!image) return null;
      return new BitmapLayer({
        id: `${props.id}-bitmap`,
        image,
        bounds: [west, south, east, north],
      });
    },
  });
}

/**
 * Build the multi-line tooltip HTML for a hovered route segment. Shows
 * the headline label (e.g. "Sunny — direct sun exposure") followed by
 * every input check the classifier ran:
 *
 *   - Solar API value + distance to the nearest sample
 *   - Nearest tree distance + canopy-radius compare
 *   - Building shadow hit/miss
 *   - Bearing vs sun azimuth, and cos(Δ) → which way the bearing branch
 *     would have classified the segment
 *
 * The leading "via …" tag tells the user which check actually won. This
 * is the verification surface — every claim in the tooltip is sourced
 * directly from the diagnostic the classifier produced.
 */
function buildDiagnosticTooltipHtml(segment: ColoredSegment): string {
  const headline = escapeHtml(segment.label);
  const d = segment.diagnostic;
  if (!d) {
    // Wind-mode segments have no sun diagnostic — just show the headline.
    return `<div style="font-weight:500">${headline}</div>`;
  }

  const viaTag = escapeHtml(d.sunAboveHorizon ? `via ${segment.reason}` : 'sun below horizon');
  const headColor = segment.reason === 'sunny' ? 'rgb(180, 100, 0)' : 'rgb(50, 80, 140)';

  const solarLine = d.solarSample
    ? `Solar API: <b>${formatRatio(d.solarSample.exposureRatio)}</b> ` +
      `<span style="opacity:0.65">(${Math.round(d.solarSample.distanceM)} m away)</span>`
    : 'Solar API: <span style="opacity:0.65">no sample within 300 m</span>';

  const treeLine =
    d.nearestTreeDistanceM == null
      ? 'Trees: <span style="opacity:0.65">none scanned</span>'
      : d.inTreeCanopy
        ? `Trees: <b>in canopy</b> <span style="opacity:0.65">(nearest ${Math.round(d.nearestTreeDistanceM)} m)</span>`
        : `Trees: nearest ${Math.round(d.nearestTreeDistanceM)} m <span style="opacity:0.65">(canopy radius 15 m)</span>`;

  const shadowLine = d.buildingShadowHit
    ? 'Building shadow: <b>hit</b>'
    : 'Building shadow: <span style="opacity:0.65">miss</span>';

  const delta = normalizeDelta(d.bearingDeg - d.sunAzimuthDeg);
  const bearingLine =
    `Bearing: ${Math.round(d.bearingDeg)}° ` +
    `<span style="opacity:0.65">(sun ${Math.round(d.sunAzimuthDeg)}°, Δ${Math.round(Math.abs(delta))}°, ` +
    `cos ${d.bearingFacing.toFixed(2)})</span>`;

  const coordLine =
    `<span style="opacity:0.55">${d.midLat.toFixed(5)}, ${d.midLng.toFixed(5)}</span>`;

  return [
    `<div style="font-weight:500;color:${headColor};margin-bottom:4px">${headline}</div>`,
    `<div style="opacity:0.7;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em;font-size:9px">${viaTag}</div>`,
    `<div style="line-height:1.5">`,
    `<div>${solarLine}</div>`,
    `<div>${treeLine}</div>`,
    `<div>${shadowLine}</div>`,
    `<div>${bearingLine}</div>`,
    `</div>`,
    `<div style="margin-top:6px;font-size:9px">${coordLine}</div>`,
  ].join('');
}

function formatRatio(r: number): string {
  return `${(r * 100).toFixed(0)}% of max`;
}

function normalizeDelta(deg: number): number {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function MissingKeyOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center"
      style={{ background: 'rgba(241, 243, 244, 0.92)' }}
    >
      <div className="max-w-sm space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-[var(--gma-text-secondary)]">
          Map unavailable
        </p>
        <p className="text-sm text-[var(--gma-text-primary)]">
          Set{' '}
          <code className="rounded bg-[rgba(0,0,0,0.05)] px-1.5 py-0.5 text-sm">
            VITE_GOOGLE_MAPS_API_KEY
          </code>{' '}
          in <code>.env</code> to load the map.
        </p>
      </div>
    </div>
  );
}
