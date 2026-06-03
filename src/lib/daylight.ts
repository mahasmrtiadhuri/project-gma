// Astronomical color system.
//
// Reads sunriseTime/sunsetTime from the Google Weather API if useWeatherData
// could parse them; falls back to local solar geometry (Cooper declination
// + equation of time, with -0.833° refraction correction at the horizon).
// Result is a normalized day progress 0..1 (0 = sunrise, 1 = sunset, <0 or
// >1 = night). Maps to a 5-phase interpolated color used everywhere the
// "warm" accent shows up — sun glow, street segment warm anchor, route
// polyline accent, filter pill active color when on a sun preset.

export type RGB = [number, number, number];

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

export type DayPhase = 'night' | 'dawn' | 'morning' | 'midday' | 'afternoon' | 'sunset';

// ----- sunrise/sunset --------------------------------------------------

/**
 * NOAA-style sunrise/sunset for a given date + lat/lng. Returns null at
 * polar latitudes during periods of midnight sun / polar night.
 */
export function computeSunTimes(
  date: Date,
  latDeg: number,
  lngDeg: number,
): SunTimes | null {
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;

  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - yearStart) / 86_400_000);

  // Solar declination (Cooper).
  const declDeg = 23.45 * Math.sin(DEG * ((360 * (284 + dayOfYear)) / 365));
  const declRad = declDeg * DEG;
  const latRad = latDeg * DEG;

  // Hour angle at sunrise/sunset, with -0.833° refraction correction
  // (atmospheric refraction + half of the sun's angular diameter).
  const zenithRad = 90.833 * DEG;
  const cosH =
    (Math.cos(zenithRad) - Math.sin(latRad) * Math.sin(declRad)) /
    (Math.cos(latRad) * Math.cos(declRad));

  if (cosH > 1) return null; // polar night
  if (cosH < -1) return null; // polar day

  const H = Math.acos(cosH) * RAD; // degrees
  const dayHours = H / 15;

  // Equation of time (minutes).
  const B = DEG * ((360 * (dayOfYear - 81)) / 365);
  const eotMin = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

  // Solar noon UTC in minutes from midnight.
  const noonUTCMin = 720 - lngDeg * 4 - eotMin;
  const sunriseUTCMin = noonUTCMin - dayHours * 60;
  const sunsetUTCMin = noonUTCMin + dayHours * 60;

  const dayStartUTC = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );

  return {
    sunrise: new Date(dayStartUTC + sunriseUTCMin * 60_000),
    sunset: new Date(dayStartUTC + sunsetUTCMin * 60_000),
  };
}

// ----- progress + phase -----------------------------------------------

/**
 * Normalized progress between sunrise (0) and sunset (1). Negative before
 * sunrise, > 1 after sunset (both are "night").
 */
export function dayProgress(now: Date, times: SunTimes): number {
  const total = times.sunset.getTime() - times.sunrise.getTime();
  if (total <= 0) return 0;
  return (now.getTime() - times.sunrise.getTime()) / total;
}

export function dayPhase(progress: number): DayPhase {
  if (progress < 0 || progress > 1) return 'night';
  if (progress < 0.1) return 'dawn';
  if (progress < 0.4) return 'morning';
  if (progress < 0.6) return 'midday';
  if (progress < 0.9) return 'afternoon';
  return 'sunset';
}

// ----- interpolated color ----------------------------------------------

const NIGHT_COLOR: RGB = [26, 26, 46]; // #1a1a2e

// Phase anchors with center points + brand colors per spec.
const PHASE_ANCHORS: Array<{ at: number; color: RGB }> = [
  { at: 0.05, color: [255, 107, 53] }, // Dawn: deep orange #ff6b35
  { at: 0.25, color: [255, 209, 102] }, // Morning: warm gold #ffd166
  { at: 0.5, color: [255, 244, 214] }, //  Midday: bright white-yellow #fff4d6
  { at: 0.75, color: [244, 162, 97] }, //  Afternoon: amber #f4a261
  { at: 0.95, color: [231, 111, 81] }, //  Sunset: deep red-orange #e76f51
];

/**
 * Continuous interpolation across the 5 phase anchors, with smooth blends
 * into and out of the night color at the edges of the [0, 1] range.
 */
export function interpolatedDayColor(progress: number): RGB {
  if (progress < 0 || progress > 1) return NIGHT_COLOR;

  const first = PHASE_ANCHORS[0]!;
  const last = PHASE_ANCHORS[PHASE_ANCHORS.length - 1]!;

  if (progress < first.at) {
    const t = progress / first.at;
    return lerpRGB(NIGHT_COLOR, first.color, t);
  }
  if (progress > last.at) {
    const t = (progress - last.at) / (1 - last.at);
    return lerpRGB(last.color, NIGHT_COLOR, t);
  }
  for (let i = 0; i < PHASE_ANCHORS.length - 1; i++) {
    const a = PHASE_ANCHORS[i]!;
    const b = PHASE_ANCHORS[i + 1]!;
    if (progress >= a.at && progress <= b.at) {
      const t = (progress - a.at) / (b.at - a.at);
      return lerpRGB(a.color, b.color, t);
    }
  }
  return last.color;
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function rgbToCss(rgb: RGB, alpha = 1): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}
