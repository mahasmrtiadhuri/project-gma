import { useMemo } from 'react';

export interface SolarPosition {
  /** Bearing of the sun measured clockwise from true north, in degrees [0, 360). */
  azimuthDeg: number;
  /** Altitude of the sun above the horizon, in degrees [-90, 90]. */
  elevationDeg: number;
  /**
   * Incident sun vector pointing FROM the sun TOWARD the ground, unit length,
   * in local east-north-up coordinates. This is the Î fed straight to
   * solar.frag.glsl.
   */
  sunDirection: [number, number, number];
}

/**
 * NOAA-style solar azimuth/elevation from a wall-clock timestamp and a
 * geographic position. Accuracy is ~0.5 deg, plenty for shadow demo work --
 * we don't need ephemeris-grade precision to render a heatmap.
 */
export function useSolarPosition(
  timestamp: Date,
  latDeg: number,
  lngDeg: number,
): SolarPosition {
  return useMemo(
    () => computeSolarPosition(timestamp, latDeg, lngDeg),
    [timestamp.getTime(), latDeg, lngDeg],
  );
}

export function computeSolarPosition(
  date: Date,
  latDeg: number,
  lngDeg: number,
): SolarPosition {
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;

  // Day of year [1, 366].
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - yearStart) / 86_400_000);

  // Fractional UTC hour.
  const utcHour =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;

  // Spencer-style equation-of-time correction (minutes).
  const B = DEG * ((360 * (dayOfYear - 81)) / 365);
  const eotMinutes =
    9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

  // Solar declination (Cooper).
  const declDeg = 23.45 * Math.sin(DEG * ((360 * (284 + dayOfYear)) / 365));
  const declRad = declDeg * DEG;

  // Local apparent solar time, then hour angle (0 at solar noon, +15 deg/hr).
  const solarHour = utcHour + lngDeg / 15 + eotMinutes / 60;
  const hourAngleRad = 15 * (solarHour - 12) * DEG;

  const latRad = latDeg * DEG;

  const sinElev =
    Math.sin(declRad) * Math.sin(latRad) +
    Math.cos(declRad) * Math.cos(latRad) * Math.cos(hourAngleRad);
  const elevRad = Math.asin(clamp(sinElev, -1, 1));
  const elevDeg = elevRad * RAD;

  // Azimuth via the standard horizontal-coordinate formula, mirrored across
  // solar noon so morning sun reads as east (< 180) and afternoon as west.
  const cosAz =
    (Math.sin(declRad) - Math.sin(elevRad) * Math.sin(latRad)) /
    (Math.cos(elevRad) * Math.cos(latRad));
  let azRad = Math.acos(clamp(cosAz, -1, 1));
  if (hourAngleRad > 0) azRad = 2 * Math.PI - azRad;
  const azDeg = (azRad * RAD + 360) % 360;

  // Build the incident vector. The vector to the sun is
  //   (cos(elev) sin(az), cos(elev) cos(az), sin(elev))
  // in east-north-up; the incident direction (sun -> ground) is its negation.
  const cosE = Math.cos(elevRad);
  const sinE = Math.sin(elevRad);
  const sinA = Math.sin(azRad);
  const cosA = Math.cos(azRad);

  const sunDirection: [number, number, number] = [
    -cosE * sinA,
    -cosE * cosA,
    -sinE,
  ];

  return {
    azimuthDeg: azDeg,
    elevationDeg: elevDeg,
    sunDirection,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
