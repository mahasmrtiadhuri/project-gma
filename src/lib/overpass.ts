// Unified Overpass API client. One union query per bbox fetches streets +
// trees + buildings + forests in a single round trip, categorized by
// element type/tags on response. The union is already in place (the
// `(way[...]; node[...]; way[...]; way[...]; way[...];)` block below) — we
// have NOT made three separate requests since the May 2026 rebuild.
//
// Rate-limit hardening (per 2026-06-01 fix):
//   - Module-scope cache keyed by 3-decimal-rounded bbox with a 30-minute
//     TTL. Same bbox within 30 min returns the cached promise verbatim;
//     pan / zoom across the same neighborhood is free.
//   - Exponential backoff on HTTP 429: retry after 5 s → 15 s → 30 s, then
//     give up and return EMPTY with `status: 'rate-limited'`.
//   - useOverpassData (hook) adds a 2 s debounce so rapid map drags don't
//     queue a fetch per intermediate viewState.
//
// All failure paths degrade to empty arrays — the app keeps working.

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface TreeNode {
  lat: number;
  lng: number;
}

export interface StreetWay {
  id: string;
  name: string;
  /** Polyline as [lng, lat] points. */
  path: [number, number][];
}

export interface Building {
  id: string;
  /** Estimated building height in meters. Defaults to 20 m when tags don't
   *  provide either `height` or `building:levels`. Solar API heights, when
   *  available, override this via App.tsx merging. */
  height: number;
  /** Outer footprint as [lng, lat] points (closed ring; first ≠ last). */
  footprint: [number, number][];
  /** OSM `name` tag if present — used by the glass-glare classifier to
   *  match known glass towers ("One Vanderbilt", "Hudson Yards", etc). */
  name?: string;
  /** Raw OSM tag bag for classifiers downstream (glass material/cladding,
   *  construction year, etc). Omitted for synthetic / Solar-derived
   *  buildings that don't carry OSM tags. */
  tags?: Record<string, string>;
}

export interface GreenArea {
  id: string;
  /** Polygon outline as [lng, lat] points. */
  polygon: [number, number][];
}

/**
 * A discrete outdoor space — park (way centroid) or cafe with
 * `outdoor_seating=yes` (node coord). Used by the "Sunny Spot 🌞"
 * filter to surface places the user could sit in the sun, beyond
 * the route-segment-derived synthetic markers.
 */
export interface OutdoorSpot {
  id: string;
  lat: number;
  lng: number;
  kind: 'park' | 'cafe';
  name?: string;
}

export interface OverpassData {
  streets: StreetWay[];
  trees: TreeNode[];
  buildings: Building[];
  forests: GreenArea[];
  outdoorSpots: OutdoorSpot[];
}

export type OverpassStatus = 'success' | 'rate-limited' | 'error';

export interface OverpassFetchResult {
  data: OverpassData;
  status: OverpassStatus;
}

const EMPTY: OverpassData = {
  streets: [],
  trees: [],
  buildings: [],
  forests: [],
  outdoorSpots: [],
};
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; //  2 hours
const RETRY_DELAYS_MS = [0, 5_000, 15_000, 30_000];

/**
 * Query variant — controls how many highway tiers come back. The
 * default lean set covers the on-screen "main roads" overlay before a
 * route exists; once a destination is picked we widen to include
 * tertiary + residential streets so the route polyline can score
 * against side streets too.
 */
export interface OverpassFetchOptions {
  /**
   * When false (default): only `primary` and `secondary` highways.
   * When true: also `tertiary` and `residential`. Caller passes true
   * once a route is active.
   */
  extendedStreets?: boolean;
}

interface CacheEntry {
  promise: Promise<OverpassFetchResult>;
  fetchedAt: number;
}

const CACHE = new Map<string, CacheEntry>();

export function fetchOverpassData(
  bbox: Bbox,
  options: OverpassFetchOptions = {},
): Promise<OverpassFetchResult> {
  const extended = options.extendedStreets === true;
  // Cache key includes the variant so the lean (pre-route) and the
  // extended (route-active) queries don't collide. The two responses
  // live side-by-side in the cache — switching to extended after the
  // user picks a destination triggers one fresh fetch, then both keys
  // are warm.
  const key = `${bboxKey(bbox)}#${extended ? 'ext' : 'lean'}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.promise;
  }

  const promise = fetchWithBackoff(bbox, extended);
  CACHE.set(key, { promise, fetchedAt: Date.now() });
  return promise;
}

async function fetchWithBackoff(
  bbox: Bbox,
  extendedStreets: boolean,
): Promise<OverpassFetchResult> {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  // Highway tier set. Lean default is just primary + secondary — keeps
  // the no-destination map load cheap. Extended adds tertiary +
  // residential once a route exists (the route's segment-coloring
  // needs side-street coverage).
  const highwayRegex = extendedStreets
    ? '^(primary|secondary|tertiary|residential)$'
    : '^(primary|secondary)$';
  // Union query — one round trip covers streets, trees, buildings, and
  // green areas. The tree slice intentionally over-covers: Brooklyn
  // street trees are often tagged `street_tree=yes` or `tree=yes`
  // instead of the Manhattan-common `natural=tree`, and parks /
  // tree-rows / grass strips also contribute to the canopy signal.
  const query =
    '[out:json][timeout:30];' +
    '(' +
    // Streets (route + sun overlay)
    `way[highway~"${highwayRegex}"][name](${b});` +
    // Trees — primary tag
    `node[natural=tree](${b});` +
    // Tree-rows + alternate tree tags common in Brooklyn / Queens
    `node[natural=tree_row](${b});` +
    `way[natural=tree_row](${b});` +
    `node[street_tree=yes](${b});` +
    `node[tree=yes](${b});` +
    // Forests / wood polygons (already supported as green areas)
    `node[landuse=forest](${b});` +
    `way[landuse=forest](${b});` +
    `way[natural=wood](${b});` +
    // Parks + grass strips treated as canopy proxies
    `node[leisure=park](${b});` +
    `way[leisure=park](${b});` +
    `way[landuse=grass](${b});` +
    // Cafés with outdoor seating — surfaced as discrete OutdoorSpots
    // for the "Sunny Spot 🌞" filter to mark places the user could
    // sit in the sun. `outdoor_seating=yes` filter keeps the list
    // tight to spots that actually have terraces / sidewalk tables.
    `node[amenity=cafe][outdoor_seating=yes](${b});` +
    // Buildings (shadow projection)
    `way[building](${b});` +
    ');' +
    'out geom;';

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt]!;
    if (delay > 0) {
      console.warn(
        `[GMA] Overpass 429 — exponential backoff, waiting ${delay / 1000}s ` +
          `before retry ${attempt}/${RETRY_DELAYS_MS.length - 1}`,
      );
      await sleep(delay);
    }

    const startedAt =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    let response: Response;
    try {
      response = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: query,
      });
    } catch (error) {
      const elapsed = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
          startedAt,
      );
      console.warn(
        `[GMA] Overpass fetch threw after ${elapsed}ms (likely CORS, network, or DNS):`,
        error,
      );
      return { data: EMPTY, status: 'error' };
    }

    const elapsed = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
        startedAt,
    );

    if (response.status === 429) {
      // Retry per the backoff schedule. Don't read the body — the public
      // Overpass instance often closes the connection mid-body on 429.
      console.warn(
        `[GMA] Overpass HTTP 429 in ${elapsed}ms on attempt ${attempt + 1}/${RETRY_DELAYS_MS.length}.`,
      );
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(
        `[GMA] Overpass HTTP ${response.status} (${response.statusText}) in ${elapsed}ms — non-retriable. Returning empty data.`,
        body.slice(0, 400),
      );
      return { data: EMPTY, status: 'error' };
    }

    const json = (await response.json()) as OverpassResponse;
    const data = categorize(json.elements ?? []);
    console.log(
      `[GMA] Overpass returned in ${elapsed}ms: ${data.streets.length} streets, ` +
        `${data.trees.length} trees, ${data.buildings.length} buildings, ` +
        `${data.forests.length} forests/woods (${json.elements?.length ?? 0} raw elements)`,
    );
    if (data.streets.length === 0) {
      console.warn(
        '[GMA] Overpass returned 0 streets for the viewport. Possible causes: oversize query, bbox over water/empty area. Street sun overlay will be hidden; route polyline still receives per-segment coloring.',
      );
    }
    return { data, status: 'success' };
  }

  // All retries exhausted on 429.
  console.warn(
    '[GMA] Overpass: exhausted retries after 429. Showing empty viewport data; the route polyline still gets per-segment coloring from bearing math + Solar API.',
  );
  return { data: EMPTY, status: 'rate-limited' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function categorize(elements: ReadonlyArray<OverpassElement>): OverpassData {
  const streets: StreetWay[] = [];
  const trees: TreeNode[] = [];
  const buildings: Building[] = [];
  const forests: GreenArea[] = [];
  const outdoorSpots: OutdoorSpot[] = [];

  for (const el of elements) {
    if (el.type === 'node') {
      // Accept any of the tree-ish point tags. `natural=tree` is the
      // canonical OSM tag; `natural=tree_row` is a point row (rare); the
      // other two are common alternate-tagged variants in NYC outer
      // boroughs.
      if (el.lat == null || el.lon == null) continue;
      const tags = el.tags;
      if (tags) {
        if (
          tags.natural === 'tree' ||
          tags.natural === 'tree_row' ||
          tags.street_tree === 'yes' ||
          tags.tree === 'yes'
        ) {
          trees.push({ lat: el.lat, lng: el.lon });
        }
        if (tags.amenity === 'cafe' && tags.outdoor_seating === 'yes') {
          outdoorSpots.push({
            id: `node/${el.id}`,
            lat: el.lat,
            lng: el.lon,
            kind: 'cafe',
            name: tags.name,
          });
        }
      }
      continue;
    }
    if (el.type !== 'way') continue;

    const geom = (el.geometry ?? [])
      .filter((g): g is { lat: number; lon: number } => g.lat != null && g.lon != null)
      .map((g): [number, number] => [g.lon, g.lat]);
    if (geom.length < 2) continue;
    const tags = el.tags ?? {};
    const id = `way/${el.id}`;

    if (
      tags.highway &&
      ['primary', 'secondary', 'tertiary', 'residential'].includes(tags.highway) &&
      tags.name
    ) {
      streets.push({ id, name: tags.name, path: geom });
      continue;
    }
    if (tags.building !== undefined) {
      buildings.push({
        id,
        height: parseHeight(tags),
        footprint: geom,
        name: tags.name,
        tags,
      });
      continue;
    }
    if (tags.landuse === 'forest' || tags.natural === 'wood') {
      forests.push({ id, polygon: geom });
      // Forests also scatter synthetic tree points so route segments
      // crossing them get tree-canopy classification (the 15-m proximity
      // check works against the same tree array used for street trees).
      scatterTreePoints(geom, trees, TREE_SCATTER_STEP_M);
      continue;
    }
    if (tags.natural === 'tree_row') {
      // Way tagged as a row of trees — sprinkle synthetic tree points
      // along the polyline.
      scatterTreePoints(geom, trees, TREE_SCATTER_STEP_M);
      continue;
    }
    if (tags.leisure === 'park' || tags.landuse === 'grass') {
      // Parks + grass strips: scatter sparser tree points so route
      // segments along the perimeter / interior register as canopy.
      scatterTreePoints(geom, trees, TREE_SCATTER_STEP_M * 2);
      // Parks (not grass strips) also surface as discrete OutdoorSpots
      // — pick the centroid of the way as a representative point so
      // the "Sunny Spot" star sits roughly in the middle of the
      // greenery rather than on the perimeter.
      if (tags.leisure === 'park') {
        const c = centroid(geom);
        if (c) {
          outdoorSpots.push({
            id,
            lat: c.lat,
            lng: c.lng,
            kind: 'park',
            name: tags.name,
          });
        }
      }
      continue;
    }
  }

  return { streets, trees, buildings, forests, outdoorSpots };
}

function centroid(
  ring: ReadonlyArray<[number, number]>,
): { lat: number; lng: number } | null {
  if (ring.length === 0) return null;
  let lngSum = 0;
  let latSum = 0;
  for (const [lng, lat] of ring) {
    lngSum += lng;
    latSum += lat;
  }
  return { lng: lngSum / ring.length, lat: latSum / ring.length };
}

const TREE_SCATTER_STEP_M = 12;

/**
 * Sprinkle synthetic tree points along the perimeter of a way (forest,
 * park, tree-row, grass strip). The route-coloring 15 m canopy check
 * works on point trees, so this lets way-level vegetation contribute
 * to the tree-canopy classification without a separate code path.
 *
 * Step `stepM` is in meters along the perimeter — 12 m means a route
 * segment within 15 m of the way perimeter will always have at least
 * one scattered point in range.
 */
function scatterTreePoints(
  perimeter: ReadonlyArray<[number, number]>,
  out: TreeNode[],
  stepM: number,
): void {
  if (perimeter.length < 2) return;
  const stepDegLat = stepM / 111_000;
  const stepDegLng = stepM / 84_500;
  for (let i = 0; i < perimeter.length - 1; i++) {
    const [lng1, lat1] = perimeter[i]!;
    const [lng2, lat2] = perimeter[i + 1]!;
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    const lenLat = dLat / stepDegLat;
    const lenLng = dLng / stepDegLng;
    const segSteps = Math.max(1, Math.round(Math.hypot(lenLat, lenLng)));
    for (let s = 0; s < segSteps; s++) {
      const t = s / segSteps;
      out.push({ lat: lat1 + dLat * t, lng: lng1 + dLng * t });
    }
  }
  // Make sure the final vertex is included for closure.
  const last = perimeter[perimeter.length - 1]!;
  out.push({ lat: last[1], lng: last[0] });
}

function parseHeight(tags: Record<string, string>): number {
  if (tags.height) {
    const n = Number.parseFloat(tags.height);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  if (tags['building:levels']) {
    const lvls = Number.parseFloat(tags['building:levels']);
    if (!Number.isNaN(lvls) && lvls > 0) return lvls * 3.5;
  }
  // Default for buildings without `height` or `building:levels` tags. 20 m
  // ≈ 6 stories — closer to a NYC midblock baseline than the previous 10 m
  // (which produced visibly too-short shadows in Midtown). Solar API
  // building heights, when available, override this via App.tsx merging.
  return 20;
}

function bboxKey(b: Bbox): string {
  return [
    b.south.toFixed(3),
    b.west.toFixed(3),
    b.north.toFixed(3),
    b.east.toFixed(3),
  ].join(',');
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}
