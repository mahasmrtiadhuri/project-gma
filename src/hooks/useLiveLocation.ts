// Live geolocation tracker used during navigation mode.
//
// Wraps `navigator.geolocation.watchPosition` so the component tree can
// just read a reactive `{ coord, heading, accuracyM, status }`. The hook
// is gated by an `enabled` flag because watchPosition is metered (drains
// battery, requests permission) and should only run while the user is
// actively following a route.
//
// Status semantics:
//   idle        — hook is disabled (navigation not started)
//   requesting  — enabled but no fix yet (permission prompt or first GPS lock)
//   granted     — at least one position reported
//   denied      — user rejected the permission prompt
//   unavailable — no geolocation API at all (older browsers, secure-origin issues)

import { useEffect, useState } from 'react';

export type LiveLocationStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable';

export interface LiveLocation {
  coord: { lat: number; lng: number } | null;
  /**
   * Compass heading in degrees from north, 0–360. Null when the device
   * doesn't expose it (most desktop browsers, stationary mobile).
   */
  heading: number | null;
  /** Reported position accuracy radius in meters, or null. */
  accuracyM: number | null;
  status: LiveLocationStatus;
  error: string | null;
}

const INITIAL: LiveLocation = {
  coord: null,
  heading: null,
  accuracyM: null,
  status: 'idle',
  error: null,
};

export function useLiveLocation(enabled: boolean): LiveLocation {
  const [state, setState] = useState<LiveLocation>(INITIAL);

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      console.warn('[GMA] Geolocation API unavailable in this browser.');
      setState({
        ...INITIAL,
        status: 'unavailable',
        error: 'Geolocation API not supported',
      });
      return;
    }

    setState((prev) => ({ ...prev, status: 'requesting' }));

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setState({
          coord: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          heading:
            position.coords.heading != null && !Number.isNaN(position.coords.heading)
              ? position.coords.heading
              : null,
          accuracyM: position.coords.accuracy ?? null,
          status: 'granted',
          error: null,
        });
      },
      (error) => {
        console.warn('[GMA] Live location error:', error);
        setState((prev) => ({
          ...prev,
          status:
            error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable',
          error: error.message,
        }));
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled]);

  return state;
}
