import { useEffect, useState } from 'react';
import type { RoutePoint } from '../lib/hlciRouter';

export type LocationStatus = 'pending' | 'available' | 'denied';

export interface CurrentLocationState {
  point: RoutePoint | null;
  status: LocationStatus;
}

/**
 * Browser-geolocation hook. Returns `{point: null, status: 'pending'}` on
 * mount, then transitions to either:
 *
 *   - `{point, status: 'available'}` if geolocation resolves successfully
 *   - `{point: null, status: 'denied'}` if the user denies, the API is
 *     unavailable, or the lookup times out
 *
 * No synchronous fallback to a hardcoded default — the previous revision
 * pre-set origin to Bryant Park immediately and then the App's overwrite
 * guard (`if (current) return current`) prevented the real location from
 * ever replacing it. Now consumers see explicit `status === 'pending'`
 * until the real answer arrives.
 *
 * No Manhattan bbox guard — that was a dev safeguard against routing from a
 * developer's laptop in another city, but it also rejects real users in
 * Brooklyn/Queens/anywhere else.
 */
export function useCurrentLocation(): CurrentLocationState {
  const [state, setState] = useState<CurrentLocationState>({
    point: null,
    status: 'pending',
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setState({ point: null, status: 'denied' });
      return;
    }

    let cancelled = false;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const point: RoutePoint = {
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
        };
        setState({ point, status: 'available' });
      },
      (error) => {
        if (cancelled) return;
        const reason =
          error.code === 1
            ? 'denied by user'
            : error.code === 2
              ? 'position unavailable'
              : error.code === 3
                ? 'timeout'
                : 'unknown error';
        console.warn(`[GMA] Geolocation failed (${reason}):`, error.message);
        setState({ point: null, status: 'denied' });
      },
      { timeout: 5000, maximumAge: 600_000 },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
