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

const DEBOUNCE_MS = 2_000;

export type OverpassHookStatus = OverpassStatus | 'idle' | 'loading';

export interface UseOverpassDataResult extends OverpassData {
  /** Lifecycle / network state for the most recent fetch. */
  status: OverpassHookStatus;
}

/**
 * Streets + trees + buildings + forests for the given bbox, fetched in a
 * single Overpass round trip per unique (rounded) bbox.
 *
 * Debouncing: a fetch is only initiated after the bbox has been stable for
 * DEBOUNCE_MS — rapid map drags / zooms therefore queue at most one
 * request, not one per intermediate viewState. This is the public
 * Overpass instance, which rate-limits aggressively (HTTP 429 after a
 * burst).
 *
 * Returned `status` lets the on-map indicator surface "rate-limited" vs
 * "active" to the demo audience.
 */
export function useOverpassData(bbox: Bbox | null): UseOverpassDataResult {
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
      fetchOverpassData(bbox).then((result) => {
        if (cancelled) return;
        setData(result.data);
        setStatus(result.status);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bbox?.south, bbox?.west, bbox?.north, bbox?.east]);

  return { ...data, status };
}
