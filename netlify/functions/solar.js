// Netlify Functions equivalent of server/index.js /api/solar — proxies
// Google Solar API buildingInsights:findClosest with a server-side API
// key. Deployed automatically when the repo is connected to Netlify and
// netlify.toml redirects /api/solar to /.netlify/functions/solar.
//
// Environment variables (set in the Netlify dashboard → Site settings →
// Environment):
//   GOOGLE_MAPS_API_KEY  — required. The key must have Solar API enabled.
//                          Falls back to VITE_GOOGLE_MAPS_API_KEY if the
//                          dedicated server var isn't set.

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: JSON_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: 'GOOGLE_MAPS_API_KEY not configured in Netlify environment',
      }),
    };
  }

  const params = event.queryStringParameters ?? {};
  const lat = params.lat;
  const lng = params.lng;
  if (typeof lat !== 'string' || typeof lng !== 'string') {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'lat and lng query params are required' }),
    };
  }

  const url =
    'https://solar.googleapis.com/v1/buildingInsights:findClosest' +
    `?location.latitude=${encodeURIComponent(lat)}` +
    `&location.longitude=${encodeURIComponent(lng)}` +
    `&requiredQuality=LOW` +
    `&key=${encodeURIComponent(apiKey)}`;

  try {
    const upstream = await fetch(url);
    const body = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: {
        ...JSON_HEADERS,
        'Content-Type':
          upstream.headers.get('content-type') ?? 'application/json',
      },
      body,
    };
  } catch (error) {
    console.error('[netlify/functions/solar] upstream error:', error);
    return {
      statusCode: 502,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};
