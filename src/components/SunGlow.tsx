import type { RGB } from '../lib/daylight';

export interface SunGlowProps {
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  dayColor: RGB;
}

/**
 * Soft warm wash positioned at the sun's bearing across the viewport. On
 * the light basemap we use `mix-blend-mode: multiply` with low alpha so the
 * lit side acquires a faint warm tint without obscuring map features.
 * Hidden at night (sun below horizon → spec says "no sun overlay, cool blue
 * street tint only" which the street layer handles).
 */
export function SunGlow({
  sunAzimuthDeg,
  sunElevationDeg,
  dayColor,
}: SunGlowProps) {
  if (sunElevationDeg <= 0) return null;

  const rad = (sunAzimuthDeg * Math.PI) / 180;
  const xPct = 50 + 110 * Math.sin(rad);
  const yPct = 50 - 110 * Math.cos(rad);

  const elevationFactor = Math.min(1, sunElevationDeg / 70);
  const innerAlpha = 0.08 + 0.10 * elevationFactor;

  const [r, g, b] = dayColor;
  const innerColor = `rgba(${r}, ${g}, ${b}, ${innerAlpha.toFixed(3)})`;
  const outerColor = `rgba(${r}, ${g}, ${b}, 0)`;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5]"
      style={{
        mixBlendMode: 'multiply',
        background: `radial-gradient(circle at ${xPct.toFixed(1)}% ${yPct.toFixed(1)}%, ${innerColor} 0%, ${outerColor} 70%)`,
      }}
      aria-hidden="true"
    />
  );
}
