// Reverse-geocoding for the origin field. Tries Google Geocoding first; if
// it returns null (API not enabled / key restricted / over quota / zero
// results), falls back to OpenStreetMap's Nominatim — free, no key, but
// rate-limited to ~1 req/sec per their fair-use policy. Either way the
// origin field gets a real street address instead of raw coordinates.

export async function reverseGeocode(
  lat: number,
  lng: number,
  apiKey: string | undefined,
): Promise<string | null> {
  const fromGoogle = await tryGoogleGeocode(lat, lng, apiKey);
  if (fromGoogle) return fromGoogle;
  return tryNominatim(lat, lng);
}

async function tryGoogleGeocode(
  lat: number,
  lng: number,
  apiKey: string | undefined,
): Promise<string | null> {
  if (!apiKey) {
    console.warn('[GMA] reverseGeocode: no API key configured');
    return null;
  }

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?latlng=${lat},${lng}` +
    `&key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      console.warn(
        `[GMA] Geocoding HTTP ${response.status}:`,
        body.slice(0, 500),
      );
      return null;
    }
    const json = (await response.json()) as GoogleGeocodeResponse;

    if (json.status && json.status !== 'OK') {
      // REQUEST_DENIED with a "not authorized" / "not enabled" message is
      // the dominant fail in dev — surface it loudly with the fix.
      const errMsg = json.error_message ?? '';
      const isNotEnabled =
        json.status === 'REQUEST_DENIED' &&
        /not authorized|not enabled|API not enabled|API key not valid/i.test(
          errMsg,
        );
      if (isNotEnabled) {
        console.warn(
          '[GMA] Geocoding API is NOT ENABLED on this Google Cloud project. ' +
            'Enable "Geocoding API" at https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com ' +
            'so origin auto-fill gets a real street address instead of the Nominatim fallback. ' +
            `(Google returned: status=${json.status}, message="${errMsg}")`,
        );
      } else {
        console.warn(
          `[GMA] Google Geocoding rejected: status=${json.status}`,
          errMsg,
        );
      }
      return null;
    }

    const top = json.results?.[0];
    if (!top || !top.formatted_address) {
      console.warn('[GMA] Google Geocoding returned no formatted_address');
      return null;
    }

    return top.formatted_address;
  } catch (error) {
    console.warn('[GMA] Google reverse geocoding fetch failed:', error);
    return null;
  }
}

async function tryNominatim(lat: number, lng: number): Promise<string | null> {
  // Nominatim policy: must send a descriptive User-Agent OR Referer. Browsers
  // can't set User-Agent directly but the Referer header is sent automatically.
  // For higher-volume production use, self-host or use a different provider.
  const url =
    'https://nominatim.openstreetmap.org/reverse' +
    `?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[GMA] Nominatim ${response.status}`);
      return null;
    }
    const json = (await response.json()) as NominatimResponse;
    if (!json.display_name) {
      console.warn('[GMA] Nominatim returned no display_name');
      return null;
    }
    return json.display_name;
  } catch (error) {
    console.warn('[GMA] Nominatim fetch failed:', error);
    return null;
  }
}

interface GoogleGeocodeResponse {
  status?: string;
  error_message?: string;
  results?: Array<{ formatted_address?: string }>;
}

interface NominatimResponse {
  display_name?: string;
}

// ===========================================================================
// FORWARD GEOCODING — text "One Vanderbilt" → { lat, lng, formattedAddress }
// ---------------------------------------------------------------------------
// Used by the AI chat panel: when Gemini extracts origin/destination strings
// from a free-text prompt ("I'm at One Vanderbilt going to Bryant Park"),
// each string gets geocoded here so App.tsx can call setOrigin/setDestination
// with a real {point, label} PlacePick.
//
// Same fallback chain as reverseGeocode: Google first, then Nominatim. NYC
// viewport bias on the Google request so "Bryant Park" resolves to the
// Manhattan one and not a Brooklyn parkette of the same name.
// ===========================================================================

export interface ForwardGeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

/** NYC bias bounds — same envelope SearchBar uses for autocomplete. */
const NYC_BIAS = {
  south: 40.7,
  west: -74.02,
  north: 40.8,
  east: -73.93,
} as const;

export async function forwardGeocode(
  query: string,
  apiKey: string | undefined,
): Promise<ForwardGeocodeResult | null> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;
  const fromGoogle = await tryGoogleForward(trimmed, apiKey);
  if (fromGoogle) return fromGoogle;
  console.log(
    `[GMA] Google forward geocode of "${trimmed}" returned null; trying Nominatim`,
  );
  return tryNominatimForward(trimmed);
}

async function tryGoogleForward(
  query: string,
  apiKey: string | undefined,
): Promise<ForwardGeocodeResult | null> {
  if (!apiKey) {
    console.warn('[GMA] forwardGeocode: no API key configured');
    return null;
  }
  // `bounds` biases — not restricts — the result toward NYC. `region=us`
  // breaks ties for ambiguous names. Append "New York" to the query when
  // the caller didn't, to nudge place-name disambiguation.
  const augmented = /new york|nyc|manhattan|brooklyn|ny\b/i.test(query)
    ? query
    : `${query}, New York, NY`;
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?address=${encodeURIComponent(augmented)}` +
    `&bounds=${NYC_BIAS.south},${NYC_BIAS.west}|${NYC_BIAS.north},${NYC_BIAS.east}` +
    '&region=us' +
    `&key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[GMA] Forward geocoding HTTP ${response.status}`);
      return null;
    }
    const json = (await response.json()) as GoogleForwardResponse;
    if (json.status && json.status !== 'OK') {
      console.warn(
        `[GMA] Google forward geocoding rejected: status=${json.status}`,
        json.error_message ?? '',
      );
      return null;
    }
    const top = json.results?.[0];
    const loc = top?.geometry?.location;
    if (!top || !loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
      console.warn('[GMA] Google forward geocoding returned no location');
      return null;
    }
    return {
      lat: loc.lat,
      lng: loc.lng,
      formattedAddress: top.formatted_address ?? query,
    };
  } catch (error) {
    console.warn('[GMA] Google forward geocoding fetch failed:', error);
    return null;
  }
}

async function tryNominatimForward(
  query: string,
): Promise<ForwardGeocodeResult | null> {
  const augmented = /new york|nyc|manhattan|brooklyn/i.test(query)
    ? query
    : `${query}, New York, NY`;
  const url =
    'https://nominatim.openstreetmap.org/search' +
    `?format=json&q=${encodeURIComponent(augmented)}&limit=1` +
    `&viewbox=${NYC_BIAS.west},${NYC_BIAS.north},${NYC_BIAS.east},${NYC_BIAS.south}` +
    '&bounded=1';
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[GMA] Nominatim forward ${response.status}`);
      return null;
    }
    const json = (await response.json()) as NominatimForwardResponse[];
    const top = json[0];
    if (!top || !top.lat || !top.lon) {
      console.warn('[GMA] Nominatim forward returned no result');
      return null;
    }
    const lat = parseFloat(top.lat);
    const lng = parseFloat(top.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return {
      lat,
      lng,
      formattedAddress: top.display_name ?? query,
    };
  } catch (error) {
    console.warn('[GMA] Nominatim forward fetch failed:', error);
    return null;
  }
}

interface GoogleForwardResponse {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
}

interface NominatimForwardResponse {
  lat?: string;
  lon?: string;
  display_name?: string;
}
