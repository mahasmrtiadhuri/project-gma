import { useEffect, useState } from 'react';

export type PrecipitationType = 'rain' | 'snow' | 'sleet' | 'none';

export interface WeatherSnapshot {
  /** Wind speed in mph, normalized from whatever unit the API returned. */
  windSpeedMph: number;
  /** Direction the wind is COMING FROM, degrees clockwise from N (meteorological). */
  windDirectionDeg: number;
  /** Cloud cover percentage, clamped to [0, 100]. */
  cloudCoverPct: number;
  /** Surface air temperature in degrees Fahrenheit. */
  temperatureF: number;
  /**
   * Probability of precipitation in the next hour, 0..100. 0 when the API
   * doesn't return a probability block (treat as "no precipitation").
   */
  precipitationProbability: number;
  /**
   * Kind of precipitation expected — drives the color palette in the
   * route coloring + the icon in the SunCompass footer. 'none' when
   * probability is 0 or the API doesn't classify it.
   */
  precipitationType: PrecipitationType;
  /** Wall-clock time of the fetch that produced this snapshot. */
  fetchedAt: Date;
  /** From Google Weather currentConditions — true if local time is between sunrise and sunset. */
  isDaytime?: boolean;
  /** Local time as reported by the API (currentConditions:lookup returns currentTime). */
  apiCurrentTime?: Date;
  /** Sunrise — only present if the API surfaces it; otherwise computed client-side. */
  sunriseTime?: Date;
  /** Sunset — only present if the API surfaces it; otherwise computed client-side. */
  sunsetTime?: Date;
}

const ENDPOINT = 'https://weather.googleapis.com/v1/currentConditions:lookup';
const POLL_INTERVAL_MS = 10 * 60 * 1000;

// ---------- module-scope singleton -----------------------------------------
//
// Multiple components call useWeatherData (App + GMACanvas), and React
// StrictMode double-mounts each in dev — left unguarded the hook fired 4
// times concurrently on first paint. This singleton ensures *one* in-flight
// request and *one* polling timer regardless of how many subscribers mount.

let cached: WeatherSnapshot | null = null;
let inflightPromise: Promise<WeatherSnapshot | null> | null = null;
const subscribers = new Set<(snap: WeatherSnapshot | null) => void>();
let pollTimerId: number | null = null;
let pollContext: { apiKey: string; lat: number; lng: number } | null = null;

function notifyAll(snap: WeatherSnapshot | null): void {
  for (const cb of subscribers) {
    try {
      cb(snap);
    } catch {
      // Don't let one bad subscriber suppress the others.
    }
  }
}

function dedupedFetch(
  apiKey: string,
  lat: number,
  lng: number,
): Promise<WeatherSnapshot | null> {
  if (inflightPromise) return inflightPromise;
  inflightPromise = fetchWeather(apiKey, lat, lng)
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

function ensurePolling(apiKey: string, lat: number, lng: number): void {
  if (pollTimerId !== null) return;
  pollContext = { apiKey, lat, lng };
  pollTimerId = window.setInterval(() => {
    if (pollContext) {
      void dedupedFetch(pollContext.apiKey, pollContext.lat, pollContext.lng);
    }
  }, POLL_INTERVAL_MS);
}

function maybeStopPolling(): void {
  if (subscribers.size === 0 && pollTimerId !== null) {
    window.clearInterval(pollTimerId);
    pollTimerId = null;
    pollContext = null;
  }
}

/**
 * Single source of truth for live Google Weather conditions. All callers
 * share one in-flight request and one polling timer via a module-scope
 * singleton — multiple components + StrictMode double-mount cannot fan out
 * to multiple network requests.
 *
 * Returns `null` until the first successful fetch and stays at the most
 * recent good snapshot if a subsequent poll fails. There is no synthetic
 * fallback — consumers must treat `null` as "weather not yet available" and
 * degrade visibly.
 */
export function useWeatherData(
  latDeg: number,
  lngDeg: number,
): WeatherSnapshot | null {
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(cached);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!apiKey) return;

    subscribers.add(setSnapshot);
    // If something landed in the cache before this subscriber registered,
    // push it now so the component doesn't have to wait for the next poll.
    if (cached) setSnapshot(cached);

    void dedupedFetch(apiKey, latDeg, lngDeg);
    ensurePolling(apiKey, latDeg, lngDeg);

    return () => {
      subscribers.delete(setSnapshot);
      maybeStopPolling();
    };
  }, [apiKey, latDeg, lngDeg]);

  return snapshot;
}

// ---------- raw fetch ------------------------------------------------------

async function fetchWeather(
  apiKey: string,
  lat: number,
  lng: number,
): Promise<WeatherSnapshot | null> {
  const url =
    `${ENDPOINT}?key=${encodeURIComponent(apiKey)}` +
    `&location.latitude=${lat}` +
    `&location.longitude=${lng}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      console.warn(`[GMA] Weather API ${response.status}:`, body.slice(0, 500));
      return fetchOpenMeteo(lat, lng);
    }

    const raw: unknown = await response.json();
    const snap = normalize(raw as GoogleWeatherResponse);
    if (snap) return snap;

    // Google responded 200 but the payload was unusable (missing wind
    // or missing cloud cover). Fall through to Open-Meteo rather than
    // returning null to the consumer.
    return fetchOpenMeteo(lat, lng);
  } catch (err) {
    console.warn('[GMA] Weather API fetch threw:', err);
    return fetchOpenMeteo(lat, lng);
  }
}

// ---------- Open-Meteo fallback --------------------------------------------
//
// Free, keyless current-conditions endpoint. Activates whenever the Google
// Weather call fails (HTTP error, network error, or 200 with missing wind /
// cloud cover). Mapped onto the same WeatherSnapshot shape so downstream
// consumers (route scorer, SunCompass, route card) are agnostic to the
// source. Open-Meteo's `current` block does not surface precipitation type
// or sunrise/sunset, so those fields degrade to 'rain'/'none' based on
// probability and to undefined respectively — daylight.ts already does a
// client-side daylight calc when these are absent.

const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

async function fetchOpenMeteo(
  lat: number,
  lng: number,
): Promise<WeatherSnapshot | null> {
  // temperature_2m added beyond the spec'd field list because
  // WeatherSnapshot.temperatureF is required — without it the feels-like
  // badge would always show 32 °F.
  const url =
    `${OPEN_METEO_ENDPOINT}?latitude=${lat}&longitude=${lng}` +
    `&current=cloud_cover,wind_speed_10m,wind_direction_10m,precipitation_probability,temperature_2m` +
    `&timezone=auto`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      console.warn(
        `[GMA] Open-Meteo HTTP ${response.status}:`,
        body.slice(0, 500),
      );
      return null;
    }
    const raw: unknown = await response.json();
    return normalizeOpenMeteo(raw as OpenMeteoResponse);
  } catch (err) {
    console.warn('[GMA] Open-Meteo fetch threw:', err);
    return null;
  }
}

interface OpenMeteoResponse {
  current?: {
    time?: string;
    cloud_cover?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    precipitation_probability?: number;
    temperature_2m?: number;
  };
  current_units?: {
    wind_speed_10m?: string;
    temperature_2m?: string;
  };
}

function normalizeOpenMeteo(json: OpenMeteoResponse): WeatherSnapshot | null {
  const c = json.current;
  if (
    !c ||
    c.wind_speed_10m === undefined ||
    c.wind_direction_10m === undefined ||
    c.cloud_cover === undefined
  ) {
    console.warn('[GMA] Open-Meteo response missing required fields', json);
    return null;
  }

  const windUnit = json.current_units?.wind_speed_10m ?? 'km/h';
  const tempUnit = json.current_units?.temperature_2m ?? '°C';
  const precipPct = clampPct(c.precipitation_probability ?? 0);

  return {
    windSpeedMph: openMeteoWindToMph(c.wind_speed_10m, windUnit),
    windDirectionDeg: c.wind_direction_10m,
    cloudCoverPct: clampPct(c.cloud_cover),
    temperatureF: openMeteoTempToF(c.temperature_2m ?? 0, tempUnit),
    precipitationProbability: precipPct,
    // Open-Meteo's free `current` block does not classify precipitation
    // type — default to rain when probability > 0 (snow/sleet would
    // require the dedicated weather_code field which adds complexity for
    // marginal value at a fallback path).
    precipitationType: precipPct > 0 ? 'rain' : 'none',
    fetchedAt: new Date(),
    // isDaytime / sunrise / sunset intentionally undefined — daylight.ts
    // computeSunTimes() supplies these client-side when absent.
  };
}

function openMeteoWindToMph(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.includes('mph')) return value;
  if (u.includes('m/s')) return value * 2.236_94;
  if (u.includes('kn')) return value * 1.150_78;
  // Open-Meteo default is km/h.
  return value * 0.621_371;
}

function openMeteoTempToF(value: number, unit: string): number {
  return unit.includes('F') ? value : (value * 9) / 5 + 32;
}

interface GoogleWeatherResponse {
  temperature?: { degrees?: number; unit?: TemperatureUnit };
  cloudCover?: number;
  wind?: {
    direction?: { degrees?: number };
    speed?: { value?: number; unit?: SpeedUnit };
  };
  /**
   * Precipitation block. Google Weather has shipped a few different
   * shapes across the v1 betas; we read several plausible field paths
   * defensively (probability.percent vs probabilityPercent vs the
   * type-nested variant). Probability is a percent, type is one of
   * RAIN | SNOW | SLEET | NONE | UNKNOWN.
   */
  precipitation?: {
    probability?: {
      percent?: number;
      type?: string;
    };
    probabilityPercent?: number;
    type?: string;
  };
  // Astronomical fields — the API may or may not surface these depending on
  // endpoint version. We read defensively and consumers fall back to
  // src/lib/daylight.ts computeSunTimes() when these are absent.
  isDaytime?: boolean;
  currentTime?: string;
  sunriseTime?: string;
  sunsetTime?: string;
  sunEvents?: { sunriseTime?: string; sunsetTime?: string };
}

type TemperatureUnit = 'CELSIUS' | 'FAHRENHEIT';
type SpeedUnit =
  | 'KILOMETERS_PER_HOUR'
  | 'MILES_PER_HOUR'
  | 'METERS_PER_SECOND';

function normalize(json: GoogleWeatherResponse): WeatherSnapshot | null {
  const wind = json.wind;
  // Use explicit undefined checks so direction = 0 (a true north wind) survives.
  if (
    wind?.direction?.degrees === undefined ||
    wind?.speed?.value === undefined
  ) {
    console.warn('[GMA] Weather API response missing wind block', json);
    return null;
  }

  // Cloud cover drives the glare model + the SunCompass dimming — if the
  // Google response omits it (some v1 betas have done so transiently),
  // we treat the response as unusable so the caller can fall back to
  // Open-Meteo rather than silently substituting 0 % and overstating
  // sun intensity.
  if (json.cloudCover === undefined || json.cloudCover === null) {
    console.warn('[GMA] Weather API response missing cloud cover', json);
    return null;
  }

  const sunriseRaw =
    json.sunEvents?.sunriseTime ?? json.sunriseTime;
  const sunsetRaw =
    json.sunEvents?.sunsetTime ?? json.sunsetTime;

  // Precipitation — read percent + type defensively across the
  // different v1-beta response shapes. When probability is 0 (or the
  // block is missing entirely) we report type 'none' regardless of
  // what the API claimed, so downstream checks `prob > 20 → show pill`
  // don't see a stale `rain` classification on a dry day.
  const precipPercentRaw =
    json.precipitation?.probability?.percent ??
    json.precipitation?.probabilityPercent ??
    0;
  const precipPct = clampPct(precipPercentRaw);
  const precipTypeRaw = (
    json.precipitation?.probability?.type ??
    json.precipitation?.type ??
    'NONE'
  ).toUpperCase();
  let precipitationType: PrecipitationType;
  if (precipPct <= 0) {
    precipitationType = 'none';
  } else if (precipTypeRaw.includes('SNOW')) {
    precipitationType = 'snow';
  } else if (precipTypeRaw.includes('SLEET')) {
    precipitationType = 'sleet';
  } else if (precipTypeRaw.includes('RAIN')) {
    precipitationType = 'rain';
  } else {
    precipitationType = 'none';
  }

  return {
    windSpeedMph: toMph(
      wind.speed.value,
      wind.speed.unit ?? 'KILOMETERS_PER_HOUR',
    ),
    windDirectionDeg: wind.direction.degrees,
    cloudCoverPct: clampPct(json.cloudCover),
    temperatureF: toFahrenheit(
      json.temperature?.degrees ?? 0,
      json.temperature?.unit ?? 'CELSIUS',
    ),
    precipitationProbability: precipPct,
    precipitationType,
    fetchedAt: new Date(),
    isDaytime: json.isDaytime,
    apiCurrentTime: parseIso(json.currentTime),
    sunriseTime: parseIso(sunriseRaw),
    sunsetTime: parseIso(sunsetRaw),
  };
}

function parseIso(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toMph(value: number, unit: SpeedUnit): number {
  switch (unit) {
    case 'MILES_PER_HOUR':
      return value;
    case 'KILOMETERS_PER_HOUR':
      return value * 0.621_371;
    case 'METERS_PER_SECOND':
      return value * 2.236_94;
  }
}

function toFahrenheit(value: number, unit: TemperatureUnit): number {
  return unit === 'FAHRENHEIT' ? value : (value * 9) / 5 + 32;
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}
