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
  console.log('[GMA] Google geocoding returned null; trying Nominatim fallback');
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

  console.log(`[GMA] Google reverse-geocoding ${lat.toFixed(4)}, ${lng.toFixed(4)}…`);

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
    console.log(
      `[GMA] Google Geocoding status=${json.status ?? '(none)'}, results=${json.results?.length ?? 0}`,
    );

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

    console.log('[GMA] Google geocoded:', top.formatted_address);
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

  console.log(`[GMA] Nominatim reverse-geocoding ${lat.toFixed(4)}, ${lng.toFixed(4)}…`);

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
    console.log('[GMA] Nominatim geocoded:', json.display_name);
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
