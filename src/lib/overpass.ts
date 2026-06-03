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

export interface OverpassData {
  streets: StreetWay[];
  trees: TreeNode[];
  buildings: Building[];
  forests: GreenArea[];
}

export type OverpassStatus = 'success' | 'rate-limited' | 'error';

export interface OverpassFetchResult {
  data: OverpassData;
  status: OverpassStatus;
}

const EMPTY: OverpassData = { streets: [], trees: [], buildings: [], forests: [] };
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_MS = 30 * 60 * 1000; //   30 minutes
const RETRY_DELAYS_MS = [0, 5_000, 15_000, 30_000];

interface CacheEntry {
  promise: Promise<OverpassFetchResult>;
  fetchedAt: number;
}

const CACHE = new Map<string, CacheEntry>();

export function fetchOverpassData(bbox: Bbox): Promise<OverpassFetchResult> {
  const key = bboxKey(bbox);
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.promise;
  }

  const promise = fetchWithBackoff(bbox);
  CACHE.set(key, { promise, fetchedAt: Date.now() });
  return promise;
}

async function fetchWithBackoff(bbox: Bbox): Promise<OverpassFetchResult> {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  // Union query — one round trip covers streets, trees, buildings, and
  // green areas. The tree slice intentionally over-covers: Brooklyn
  // street trees are often tagged `street_tree=yes` or `tree=yes`
  // instead of the Manhattan-common `natural=tree`, and parks /
  // tree-rows / grass strips also contribute to the canopy signal.
  const query =
    '[out:json][timeout:30];' +
    '(' +
    // Streets (route + sun overlay)
    `way[highway~"^(primary|secondary|tertiary|residential)$"][name](${b});` +
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
    // Buildings (shadow projection)
    `way[building](${b});` +
    ');' +
    'out geom;';

  console.log('[GMA] Fetching Overpass data', {
    url: OVERPASS_URL,
    bbox,
    bboxKey: bboxKey(bbox),
    querySize: query.length,
  });
  // Full query body, on its own log line so it can be copy-pasted into
  // overpass-turbo.eu for verification.
  console.log('[GMA] Overpass query →\n' + query);

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
      continue;
    }
  }

  return { streets, trees, buildings, forests };
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
