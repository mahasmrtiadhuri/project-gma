# GMA — Generative Micro-Climate Architect

**Routing for how a city feels.**

[![Live Demo](https://img.shields.io/badge/demo-live-success?style=flat-square)](#)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![deck.gl](https://img.shields.io/badge/deck.gl-9-000000?style=flat-square)](https://deck.gl/)
[![WebGL 2](https://img.shields.io/badge/WebGL-2.0-990000?style=flat-square&logo=webgl)](https://www.khronos.org/webgl/)
[![Gemini](https://img.shields.io/badge/Gemini-2.5_Flash-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/)
[![Google Maps Platform](https://img.shields.io/badge/Google_Maps-Platform-4285F4?style=flat-square&logo=googlemaps&logoColor=white)](https://mapsplatform.google.com/)

A geospatial micro-climate simulation and routing engine for New York City. GMA combines Google's Photorealistic 3D Tiles, GPU-accelerated solar ray-tracing, real-time wind-canyon approximation, and a conversational agentic interface to compute Hyper-Localized Comfort Indices (HLCI) at the sidewalk level — then routes you through them.

---

## The Problem

Modern navigation solves for speed and distance. It completely ignores the **physical experience** of the human walking or cycling that route. A glass facade can concentrate solar radiation onto a specific sidewalk coordinate and raise the local "feels like" temperature by 15°F. A narrow canyon between two towers can accelerate a gentle 10 mph breeze into a 30+ mph headwind. None of this shows up on a standard map — and no weather app captures it at the block-by-block scale where it actually matters.

GMA closes that gap.

---

## Key Features

- **Glass-Glare Ray Tracing.** GPU-accelerated reflection model that mirrors the sun direction across every glass facade in view and projects the resulting ray onto the ground plane:

  $$\vec{R} = \vec{I} - 2(\vec{I} \cdot \hat{N})\hat{N}$$

  Hotspots within 20 m of a route segment penalize that segment's HLCI cost and surface as `+15°F` glare markers on the map.

- **Venturi Wind-Canyon Approximation.** Detects parallel building walls bounding street segments and applies fluid continuity to estimate local wind speed:

  $$v_{local} = v_{ambient} \times \frac{W_{entry}}{W_{canyon}}$$

  When ambient wind aligns within ±30° of the street axis, segments where `v_local > 2.0 × v_ambient` are flagged as high-resistance corridors.

- **Hyper-Localized Comfort Index (HLCI).** Per-segment composite cost over four physical axes — glare avoidance, wind avoidance, shade preference, rain avoidance — re-weighted at routing time by the active filter and user-stated intensity. Sampled along the polyline using the same exposure values that drive the on-map color overlay (one source of truth, no scorer-vs-renderer drift).

- **Conversational Routing.** Gemini 2.5 Flash parses natural-language prompts ("I'm in a wool suit, running late, carrying a fragile model") via structured JSON output, extracting origin, destination, sun/wind/rain preferences, intensity, and urgency in a single call. Forward-geocoded endpoints flow straight into the route fetcher.

- **Live Sun + Weather Coupling.** Solar azimuth/elevation drives shadow projection, glare classification, and route coloring every frame; Open-Meteo + METAR cloud-cover blending grounds the comfort scoring in real atmospheric conditions.

- **Mobile-First, 60 FPS.** Bounding-box viewport culling on 3D tile loading, deck.gl color transitions at 400 ms interpolation, GLSL fragment shaders for all expensive per-pixel math. Tested at sustained 60 FPS on mid-range mobile hardware.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19, Vite 6, TypeScript 5.7 (strict mode) |
| Styling | Tailwind CSS v4 (@tailwindcss/vite) |
| 3D Rendering | deck.gl 9, @loaders.gl/3d-tiles |
| 3D Data | Google Photorealistic 3D Tiles API |
| Physics | WebGL 2.0, custom GLSL fragment shaders |
| Baseline Shade | Google Solar API (proxied server-side) |
| Wind Data | Google Weather API + Open-Meteo + METAR fallback |
| Routing | Google Routes API (Advanced) with custom cost-matrix injection |
| Geocoding | Google Geocoding API + Nominatim fallback |
| Place Search | Google Places Autocomplete (AutocompleteSuggestion) |
| AI Model | Gemini 2.5 Flash (structured JSON via `responseSchema`) |
| PWA | vite-plugin-pwa (Workbox, manual updates) |
| Hosting | Netlify (frontend) + Netlify Functions (Solar API proxy) |

---

## Architecture

Three decoupled layers — every layer ships to the browser, no persistent backend.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       LAYER 1 — DATA INGESTION                              │
│                                                                             │
│  • Google Photorealistic 3D Tiles API     • Google Solar API                │
│  • Google Weather API + Open-Meteo        • Overpass (building/tree geom)   │
│  • Google Routes API (alternates)         • Geocoding (forward + reverse)   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  LAYER 2 — PHYSICS & SHADER SIMULATION                      │
│                                                                             │
│  • WebGL 2.0 / GLSL  →  solar-reflection ray-trace (per-pixel)              │
│  • Building-shadow projection (sun azimuth + elevation)                     │
│  • Venturi continuity  →  street-canyon wind-speed amplification            │
│  • HLCI scorer  →  unified sun/wind/rain/shade cost per segment             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  LAYER 3 — AGENTIC INTERFACE & ROUTING                      │
│                                                                             │
│  • Gemini 2.5 Flash  →  structured intent extraction (one JSON call)        │
│  • Forward-geocode pipeline  →  setOrigin / setDestination                  │
│  • HLCI cost injection  →  Routes API alternates re-ranked client-side      │
│  • deck.gl render loop  →  per-segment color tween + glare markers          │
└─────────────────────────────────────────────────────────────────────────────┘
```

Everything physics-related runs client-side on the GPU. The Solar API call is the only server-side hop (a thin Netlify Function proxy that hides the API key for that one endpoint).

---

## Screenshots

> _Screenshots coming soon — drop your captures into `/docs/screenshots/` and reference them here._

| Empty start (Midtown corridor) | AI chat — typed prompt + Gemini reasoning |
|---|---|
| _[screenshot]_ | _[screenshot]_ |

| Three-route overview with glare hotspots | Avoid-sun close-up with segment breakdown |
|---|---|
| _[screenshot]_ | _[screenshot]_ |

---

## Getting Started

**Requirements:** Node.js 20+, a Google Cloud project with the APIs below enabled, an AI Studio API key for Gemini.

```bash
# clone + install
git clone https://github.com/your-handle/project-gma.git
cd project-gma
npm install

# env
cp .env.example .env
# (fill in the two keys — see "Environment Variables" below)

# dev — frontend only (Solar API calls will 404 without the proxy)
npm run dev

# dev — frontend + Solar API proxy (recommended)
npm run dev:all

# production build
npm run build
npm run preview
```

Visit `http://localhost:5173` and press **Start Demo** to run the 60-second scripted walkthrough.

---

## Environment Variables

Both keys are required for the full experience. The app degrades gracefully when either is missing (it warns to the console naming the missing capability) but parts of the visual stop working.

| Variable | Source | Used for |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | [Google Cloud Console](https://console.cloud.google.com/) | Photorealistic 3D Tiles, Routes API, Places Autocomplete, Geocoding (forward + reverse), Weather API, Solar API |
| `VITE_GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Conversational routing via Gemini 2.5 Flash (structured JSON mode) |

Enable each of these on the Google Cloud project for the Maps key:

1. [Map Tiles API](https://console.cloud.google.com/apis/library/tile.googleapis.com) — Photorealistic 3D Tiles
2. [Routes API](https://console.cloud.google.com/apis/library/routes.googleapis.com) — walking alternates
3. [Places API](https://console.cloud.google.com/apis/library/places.googleapis.com) — autocomplete
4. [Geocoding API](https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com) — address ↔ coord
5. [Weather API](https://console.cloud.google.com/apis/library/weather.googleapis.com) — wind + cloud + precipitation
6. [Solar API](https://console.cloud.google.com/apis/library/solar.googleapis.com) — per-building annual sunshine

Set a billing budget alert. Solar + Routes are the main cost drivers; per-day quotas in dev keep things tight.

---

## How It Works

### HLCI scoring (`src/lib/hlciRouter.ts`)

Every Routes-API alternate is sampled along its polyline into ~30 m segments. Each segment receives a per-axis exposure value:

- **Sun exposure (0..1)** — fraction of the segment in direct sun after building shadow projection and tree-canopy attenuation
- **Wind exposure (0..1)** — `cos(bearing − windFromDirection)` modulated by the Venturi amplifier for the containing canyon, scaled by ambient speed
- **Rain exposure (0..1)** — overhead cover (arcades, building overhangs) reduced from the segment's solar-API roof-rastered shelter score
- **Glare flag** — boolean, true if any glass-glare hotspot sits within 20 m of the segment midpoint (boosts exposure to 1.5)

Composite HLCI cost is then a dot product with weights derived from the active filter mode (avoid-sun / avoid-wind / sunny-spot / avoid-both / no-preference) plus an intensity multiplier (1.0 base, 1.5 when Gemini reports `intensity: 'high'`). Routes are ranked ascending by HLCI cost; index 0 is the GMA Pick, the route with the lowest `durationSeconds` is the Fastest, the remainder hide under a "More options" expander.

### Glass-glare physics (`src/lib/glassGlare.ts`)

For each glass-clad building in the visible viewport:

1. Classify glass via OSM tags (`building:material=glass`), name-match against a curated list of NYC glass towers, or a deterministic 30 % probability hash for untagged post-2000 buildings.
2. Find the wall facet whose outward normal is most aligned with the sun direction `Î`.
3. Mirror the incoming ray across that normal: `R = I − 2(I · N̂)N̂`.
4. Project the reflected ray from wall mid-height onto `z=0`.
5. Filter out hotspots whose horizontal travel exceeds 60 m or whose source sun elevation is < 10° (glare too low to matter).
6. Render as 15 m radius warm-orange markers between the shadow layer and the route polyline.

### Venturi math (`src/lib/venturi.ts`)

For each street segment with parallel building walls on both sides:

1. Measure `W_entry` (cross-sectional opening between the two intersecting cross-streets) and `W_canyon` (mean spacing along the segment).
2. Compute ambient-wind alignment: `cos(streetBearing − windFromDirection)`. Skip if `|alignment| < 0.866` (i.e. wind not within ±30° of the street axis).
3. Apply continuity: `v_local = v_ambient × (W_entry / W_canyon)`.
4. Flag segments where `v_local > 2.0 × v_ambient` as Venturi corridors and feed the amplifier into the wind-exposure exposure value.

### One-prompt routing (`src/lib/geminiRouting.ts` + `App.tsx`)

A single Gemini 2.5 Flash call with `responseMimeType: 'application/json'` and a typed `responseSchema` returns:

```json
{
  "mode": "routing",
  "sunPreference": "avoid_sun",
  "windPreference": "neutral",
  "rainPreference": "neutral",
  "intensity": "high",
  "urgency": "high",
  "originQuery": "1251 Avenue of the Americas, New York",
  "destinationQuery": "Chrysler Building, New York",
  "reasoning": "Got it — routing for maximum shade given the heat exhaustion …"
}
```

The chat handler forward-geocodes both queries in parallel, fires `setOrigin` + `setDestination` (which flash the search inputs amber via a counter-based animation key), and applies the mapped filter + intensity. A 100 ms `setFilterMode('no-preference')` → real-filter dance guarantees a visible state transition even when the new filter equals the prior one (React skips re-renders on `Object.is` equality).

---

## Roadmap

- **Micro-Climate Sandbox** — drag a `.gltf` model into the city, watch its shadow + wind deflection reshape the comfort field of surrounding blocks in real time. Aimed at urban planners running pre-foundation impact studies.
- **Patio Gold-Rush** — inverted shade logic to find the sunniest sidewalk café patio at a target hour. Café-discovery flow on top of the existing sunny-spot filter.
- **Live City Mesh** — replace the curated glass-tower name list with a live OSM Overpass query + IIIF facade-classifier pass so new construction shows up without code edits.
- **Multi-City Expansion** — Chicago, San Francisco, Tokyo. Each city ships with a hand-tuned glass-tower seed list + Solar API region pre-warmed.
- **AR Mode** — phone camera + ARKit/ARCore overlay of the next 100 m of HLCI heatmap on the actual sidewalk in front of you.

---

## Author

**Mahasmrti Adhuri** — [mahasmrtiadhuri@gmail.com](mailto:mahasmrtiadhuri@gmail.com) · [LinkedIn](https://www.linkedin.com/in/mahasmrti-adhuri/)


