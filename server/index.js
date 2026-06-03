// Lightweight Express proxy for the Google Solar API.
//
// Browsers can't call solar.googleapis.com directly because the Solar API
// has no CORS headers. This server lives alongside the Vite dev server,
// forwards /api/solar requests to Google with the API key attached
// server-side, and returns the JSON to the browser. The frontend never
// sees the key. Vite's `server.proxy` config routes /api/* here in dev.
//
// Run with: npm run start:server (or `npm run dev:all` to start it
// alongside the Vite dev server).
//
// Environment variables read from .env (via dotenv):
//   VITE_GOOGLE_MAPS_API_KEY  — same key the frontend uses; needs Solar API
//                                enabled in the GCP project + billing
//   GOOGLE_MAPS_API_KEY       — server-only alternate (preferred name; falls
//                                back to VITE_GOOGLE_MAPS_API_KEY)
//   SOLAR_PROXY_PORT          — optional, defaults to 3001

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = Number(process.env.SOLAR_PROXY_PORT ?? 3001);
const API_KEY =
  process.env.GOOGLE_MAPS_API_KEY ?? process.env.VITE_GOOGLE_MAPS_API_KEY;

if (!API_KEY) {
  console.warn(
    '[server] GOOGLE_MAPS_API_KEY / VITE_GOOGLE_MAPS_API_KEY not set in .env — /api/solar will return 500.',
  );
}

// Allow the Vite dev server (port 5173) and the preview server (4173) by
// default. Add additional origins via SOLAR_ALLOWED_ORIGINS, comma-separated.
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
];
const extraOrigins = (process.env.SOLAR_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = [...DEFAULT_ORIGINS, ...extraOrigins];

app.use(
  cors({
    origin(origin, cb) {
      // Non-browser callers (curl, server-to-server) come through with no
      // Origin header — allow those. Browser callers must match the list.
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'OPTIONS'],
  }),
);

app.get('/health', (_req, res) => {
  res.json({ ok: true, hasKey: Boolean(API_KEY), allowedOrigins: ALLOWED_ORIGINS });
});

// Solar API — buildingInsights:findClosest. Returns roof segments, solar
// potential, etc. Frontend can fetch `/api/solar?lat=40.758&lng=-73.9855`.
// requiredQuality=LOW maximizes coverage (HIGH would 404 outside major cities).
app.get('/api/solar', async (req, res) => {
  if (!API_KEY) {
    res.status(500).json({ error: 'Server missing GOOGLE_MAPS_API_KEY' });
    return;
  }
  const { lat, lng } = req.query;
  if (typeof lat !== 'string' || typeof lng !== 'string') {
    res.status(400).json({ error: 'lat and lng query params are required' });
    return;
  }

  const url =
    'https://solar.googleapis.com/v1/buildingInsights:findClosest' +
    `?location.latitude=${encodeURIComponent(lat)}` +
    `&location.longitude=${encodeURIComponent(lng)}` +
    `&requiredQuality=LOW` +
    `&key=${encodeURIComponent(API_KEY)}`;

  try {
    const upstream = await fetch(url);
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') ?? 'application/json',
    );
    res.send(body);
  } catch (error) {
    console.error('[server] Solar API upstream error:', error);
    res.status(502).json({ error: String(error) });
  }
});

app.listen(PORT, () => {
  console.log(`[server] Solar proxy listening on http://localhost:${PORT}`);
  console.log(`[server]   GET /health`);
  console.log(`[server]   GET /api/solar?lat=…&lng=…`);
  console.log(`[server]   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
