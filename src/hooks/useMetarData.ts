import { useEffect, useState } from 'react';

const STATION_IDS = ['KJFK', 'KLGA', 'KEWR'] as const;
const POLL_INTERVAL_MS = 30 * 60 * 1000;
const ENDPOINT = 'https://aviationweather.gov/api/data/metar';

export type MetarSkyCondition =
  | 'CLR' //  clear
  | 'SKC' //  sky clear
  | 'FEW' //  1/8–2/8
  | 'SCT' //  3/8–4/8
  | 'BKN' //  5/8–7/8
  | 'OVC' //  8/8 overcast
  | 'VV'; //  vertical visibility (obscured)

export interface MetarCloudLayer {
  cover: MetarSkyCondition;
  /** Cloud base height above ground in feet, when reported. */
  baseFt: number | null;
}

export interface MetarReport {
  stationId: string;
  /** Wall-clock time the report was issued. */
  reportTime: Date | null;
  /** All reported cloud layers, bottom to top. */
  clouds: MetarCloudLayer[];
  /** Synthesized fractional cloud cover [0, 1] from the highest layer cover. */
  fractionalCover: number;
  /** Lowest reported cloud base in feet, when any layer reports one. */
  lowestBaseFt: number | null;
}

export interface MetarSnapshot {
  /** Per-station reports, in `STATION_IDS` order. */
  reports: MetarReport[];
  /** Mean fractional cloud cover across the reports that contained sky data. */
  meanCoverPct: number | null;
  /** Wall-clock time of the fetch that produced this snapshot. */
  fetchedAt: Date;
}

// Module-scope cache + in-flight dedupe so multiple subscribers share
// a single fetch (mirrors the singleton pattern in useWeatherData).
let cached: MetarSnapshot | null = null;
let inflightPromise: Promise<MetarSnapshot | null> | null = null;
const subscribers = new Set<(snap: MetarSnapshot | null) => void>();
let pollTimerId: number | null = null;

/**
 * METAR reports for the three NYC-area airports (JFK, LGA, EWR) refreshed
 * every 30 minutes. Used to cross-check the live Open-Meteo / Google
 * Weather cloud-cover number — pilots' sky reports are the most reliable
 * sub-cloud-deck observation in the area.
 *
 * Returns `null` until the first fetch completes (or the request fails
 * outright). The hook is lazy: nothing fires until at least one component
 * subscribes.
 */
export function useMetarData(): MetarSnapshot | null {
  const [snapshot, setSnapshot] = useState<MetarSnapshot | null>(cached);

  useEffect(() => {
    subscribers.add(setSnapshot);
    if (cached) setSnapshot(cached);
    void dedupedFetch();
    ensurePolling();
    return () => {
      subscribers.delete(setSnapshot);
      maybeStopPolling();
    };
  }, []);

  return snapshot;
}

function dedupedFetch(): Promise<MetarSnapshot | null> {
  if (inflightPromise) return inflightPromise;
  inflightPromise = fetchMetar()
    .then((snap) => {
      if (snap) {
        cached = snap;
        notifyAll(snap);
      }
      return snap;
    })
    .finally(() => {
      inflightPromise = null;
    });
  return inflightPromise;
}

function ensurePolling(): void {
  if (pollTimerId !== null) return;
  pollTimerId = window.setInterval(() => {
    void dedupedFetch();
  }, POLL_INTERVAL_MS);
}

function maybeStopPolling(): void {
  if (subscribers.size === 0 && pollTimerId !== null) {
    window.clearInterval(pollTimerId);
    pollTimerId = null;
  }
}

function notifyAll(snap: MetarSnapshot | null): void {
  for (const cb of subscribers) {
    try {
      cb(snap);
    } catch {
      // ignore: one bad subscriber must not break the others
    }
  }
}

async function fetchMetar(): Promise<MetarSnapshot | null> {
  const url = `${ENDPOINT}?ids=${STATION_IDS.join(',')}&format=json`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[GMA] METAR HTTP ${response.status}`);
      return null;
    }
    const raw: unknown = await response.json();
    const reports = parseMetarReports(raw);
    const valid = reports.filter((r) => r.clouds.length > 0);
    const meanCoverPct =
      valid.length > 0
        ? Math.round(
            (100 *
              valid.reduce((acc, r) => acc + r.fractionalCover, 0)) /
              valid.length,
          )
        : null;
    const snapshot: MetarSnapshot = {
      reports,
      meanCoverPct,
      fetchedAt: new Date(),
    };
    return snapshot;
  } catch (err) {
    console.warn('[GMA] METAR fetch threw:', err);
    return null;
  }
}

/**
 * The aviationweather.gov v1 JSON shape: `[{icaoId, reportTime, clouds: [{cover, base}]}, …]`.
 * We read defensively because the live API has reshuffled field names
 * between versions and the public docs lag.
 */
interface RawMetar {
  icaoId?: string;
  receiptTime?: string;
  reportTime?: string;
  clouds?: Array<{ cover?: string; base?: number | null }>;
}

function parseMetarReports(raw: unknown): MetarReport[] {
  if (!Array.isArray(raw)) return [];
  const byStation = new Map<string, RawMetar>();
  for (const entry of raw as RawMetar[]) {
    if (entry?.icaoId) byStation.set(entry.icaoId, entry);
  }
  return STATION_IDS.map((stationId) => {
    const entry = byStation.get(stationId);
    if (!entry) {
      return {
        stationId,
        reportTime: null,
        clouds: [],
        fractionalCover: 0,
        lowestBaseFt: null,
      };
    }
    const clouds: MetarCloudLayer[] = (entry.clouds ?? [])
      .map((c) => ({
        cover: normalizeCover(c.cover),
        baseFt: typeof c.base === 'number' ? c.base : null,
      }))
      .filter((c): c is MetarCloudLayer => c.cover != null);
    const fractionalCover =
      clouds.length === 0
        ? 0
        : clouds.reduce(
            (acc, c) => Math.max(acc, coverFraction(c.cover)),
            0,
          );
    const lowestBaseFt = clouds.reduce<number | null>((min, c) => {
      if (c.baseFt == null) return min;
      if (min == null) return c.baseFt;
      return Math.min(min, c.baseFt);
    }, null);
    return {
      stationId,
      reportTime: parseIso(entry.reportTime ?? entry.receiptTime),
      clouds,
      fractionalCover,
      lowestBaseFt,
    };
  });
}

function normalizeCover(raw: string | undefined): MetarSkyCondition | null {
  if (!raw) return null;
  const up = raw.toUpperCase();
  if (up === 'CLR' || up === 'SKC') return up;
  if (up === 'FEW' || up === 'SCT' || up === 'BKN' || up === 'OVC') return up;
  if (up === 'VV') return 'VV';
  return null;
}

function coverFraction(cover: MetarSkyCondition): number {
  // METAR cover codes map to oktas (eighths of sky covered). Translate
  // to a [0, 1] fraction matching the existing cloudCoverPct semantics.
  switch (cover) {
    case 'CLR':
    case 'SKC':
      return 0;
    case 'FEW':
      return 0.2; //   1–2/8
    case 'SCT':
      return 0.45; //  3–4/8
    case 'BKN':
      return 0.75; //  5–7/8
    case 'OVC':
      return 1.0; //   8/8
    case 'VV':
      return 1.0; //   obscured
  }
}

function parseIso(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
