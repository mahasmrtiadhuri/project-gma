import { useEffect, useRef, useState } from 'react';

interface Coord {
  lat: number;
  lng: number;
}

/**
 * Smoothly interpolate between successive GPS positions.
 *
 * `useLiveLocation` emits a new coord every ~1 s. Painting that raw value
 * makes the live dot jump in discrete hops. Wrapping it in this hook
 * emits an animated coord that linearly interpolates from the previous
 * displayed value to the new GPS fix over `durationMs` using
 * `requestAnimationFrame`, so the dot glides instead of teleporting.
 *
 * - First fix snaps immediately (no animation from null).
 * - Subsequent fixes interpolate over `durationMs` ms.
 * - If a newer fix arrives mid-interpolation, the interpolation continues
 *   from wherever the dot currently is (no visual snap mid-step).
 * - When `target` flips to null (navigation stop) the animated value
 *   clears too.
 */
export function useAnimatedLocation(
  target: Coord | null,
  durationMs: number = 1000,
): Coord | null {
  const [animated, setAnimated] = useState<Coord | null>(target);

  // Mirror the rendered animated state into a ref so the rAF loop can
  // read the latest displayed position without re-running the effect.
  const animatedRef = useRef<Coord | null>(target);
  animatedRef.current = animated;

  const fromRef = useRef<Coord | null>(target);
  const toRef = useRef<Coord | null>(target);
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setAnimated(null);
      return;
    }

    // First fix in a session — snap.
    if (!animatedRef.current) {
      setAnimated(target);
      fromRef.current = target;
      toRef.current = target;
      return;
    }

    // Begin a fresh interpolation from current displayed position to
    // the new target. If a previous interpolation is mid-flight, start
    // the new one from where the dot is right now.
    fromRef.current = animatedRef.current;
    toRef.current = target;
    startTimeRef.current = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const from = fromRef.current!;
      const to = toRef.current!;
      // Linear interpolation per spec.
      const next = {
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
      };
      animatedRef.current = next;
      setAnimated(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target?.lat, target?.lng, durationMs]);

  return animated;
}
