import { useEffect, useState } from 'react';
import {
  fetchOverpassData,
  type Bbox,
  type OverpassData,
  type OverpassStatus,
} from '../lib/overpass';

const EMPTY: OverpassData = {
  streets: [],
  trees: [],
  buildings: [],
  forests: [],
};

const DEBOUNCE_MS = 3_000;

export type OverpassHookStatus = OverpassStatus | 'idle' | 'loading';

export interface UseOverpassDataResult extends OverpassData {
  /** Lifecycle / network state for the most recent fetch. */
  status: OverpassHookStatus;
}

/**
 * Streets + trees + buildings + forests for the given bbox, fetched in a
 * single Overpass round trip per unique (rounded) bbox.
 *
 * Pass `null` as the bbox to suspend fetching entirely — the hook
 * keeps returning EMPTY with `status: 'idle'`. App.tsx uses this to
 * lazy-load: nothing is fetched on the no-destination map load; the
 * first call fires only when the user picks a destination.
 *
 * Debouncing: a fetch is only initiated after the bbox has been stable
 * for DEBOUNCE_MS — rapid map drags / zooms therefore queue at most
 * one request, not one per intermediate viewState. This is the public
 * Overpass instance, which rate-limits aggressively (HTTP 429 after a
 * burst).
 *
 * Returned `status` lets the on-map indicator surface "rate-limited" vs
 * "active" to the demo audience.
 *
 * `extendedStreets`: false → primary + secondary only (lean default).
 * true → also tertiary + residential. App.tsx flips this to true once
 * the user has route candidates, so route polylines have side-street
 * coverage to score against.
 */
export function useOverpassData(
  bbox: Bbox | null,
  extendedStreets: boolean = false,
): UseOverpassDataResult {
  const [data, setData] = useState<OverpassData>(EMPTY);
  const [status, setStatus] = useState<OverpassHookStatus>('idle');

  useEffect(() => {
    if (!bbox) {
      setData(EMPTY);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    const timer = window.setTimeout(() => {
      fetchOverpassData(bbox, { extendedStreets }).then((result) => {
        if (cancelled) return;
        setData(result.data);
        setStatus(result.status);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bbox?.south, bbox?.west, bbox?.north, bbox?.east, extendedStreets]);

  return { ...data, status };
}
