# PROGRESS

Phase-level changelog for **Project GMA** (Generative Micro-Climate Architect). For the architecture spec see [PROJECT.md](PROJECT.md); for runtime usage see [README.md](README.md).

| Phase | Name | Status | Completed |
|---|---|---|---|
| 1 | The Canvas | ✅ shipped | 2026-05-28 |
| 2 | The Physics | ✅ shipped | 2026-05-28 |
| 3 | The Brain | ✅ shipped | 2026-05-29 |
| 4 | The Interface | ✅ shipped | 2026-05-30 |
| 5 | Polish & Demo Prep | ✅ shipped | 2026-06-09 |

Target event: **Google Maps Platform Developer Community Day — NYC, June 10, 2026.**

---

## Phase 1 — The Canvas (2026-05-28)

- Scaffolded React 19 + Vite 6 + TypeScript 5.7 (strict mode, `noImplicitAny`, no `any` types).
- Tailwind CSS v4 via the `@tailwindcss/vite` plugin.
- `vite-plugin-glsl` for `.glsl` / `.vert` / `.frag` imports in TypeScript.
- `vite-plugin-pwa` (`autoUpdate`, manifest in [vite.config.ts](vite.config.ts)).
- TypeScript project references: root [tsconfig.json](tsconfig.json) → [tsconfig.app.json](tsconfig.app.json) + [tsconfig.node.json](tsconfig.node.json).
- deck.gl 9 + `@loaders.gl/3d-tiles` mounted with `Tile3DLayer` against Google Photorealistic 3D Tiles.
- Initial view: Manhattan `(40.758, -73.9855)`, `pitch: 45`, `zoom: 15`.
- HTTPS deployment target (required for GPU APIs on mobile).

## Phase 2 — The Physics (2026-05-28)

- Solar reflection ray-trace in a GLSL fragment shader: `R = I − 2(I · N̂)N̂`. Building facets, sun direction, projected hotspot positions, all computed per-pixel on the GPU.
- Building-shadow projection driven by `useSolarPosition` (azimuth + elevation from device time + NYC coordinates).
- Venturi wind-canyon approximation: extracts parallel building walls bounding each street segment, computes `v_local = v_ambient × (W_entry / W_canyon)`, flags segments where `v_local > 2.0 × v_ambient`.
- Per-segment route coloring (amber sunny / blue shaded / emerald tree-canopy / red glare) using the same exposure values the scorer reads — single source of truth.
- Glass-glare hotspot rendering: 15 m orange-red dots projected where reflected sun rays from glass-clad buildings hit the ground plane.

## Phase 3 — The Brain (2026-05-29)

- HLCI cost scoring across four axes: glare avoidance, wind avoidance, shade preference, rain avoidance.
- Routes API alternates ranked client-side by composite HLCI cost; index 0 = GMA Pick, fastest by `durationSeconds` = Fastest.
- Gemini 2.5 Flash integration via `responseMimeType: 'application/json'` + typed `responseSchema`. One call extracts sun/wind/rain preference, intensity, urgency, origin query, destination query, and a natural-language reasoning string.
- Conversational chat panel: amber FAB → dark-glass slide-up card → user/AI bubble history → multi-line composer with Enter-to-submit + 3-dot typing indicator while Gemini is in flight.
- Forward + reverse geocoding (Google Geocoding API → Nominatim fallback).
- One-prompt routing pipeline: typed message → Gemini extraction → parallel forward-geocode of origin + destination → `setOrigin` / `setDestination` (with amber field-flash animation) → filter applied → routes auto-fetched → re-ranked.

## Phase 4 — The Interface (2026-05-30)

- Route sheet with FASTEST + GMA PICK cards, "More options" expander for additional alternates.
- Filter pill row: Avoid Sun · Avoid Wind · Sunny Spot · Avoid Both · Avoid Rain · No Preference. Active pill auto-scrolls to the center of the horizontal row.
- Selected route card auto-scrolls into view in the sidebar; More Options auto-expands when the selection lives inside it.
- Time-of-day scrubber (6 AM → 10 PM); solar position + glare + route colors recompute live.
- Persistent legend card (top-left of map area) + per-route segment breakdown bar (% shaded · % sunny · % glass glare).
- Map view switcher (2D / 3D / Satellite), origin/destination pins, swap button, "use my current location" geolocation flow.
- Mobile bottom-sheet vs desktop sidebar shells; same `RouteSheet` component, `embedded` prop switches layouts.

## Phase 5 — Polish & Demo Prep (2026-06-09)

- 60 s scripted demo sequence for the promo recording (1251 Avenue of the Americas → Chrysler Building).
- Hero moment t=6 → t=30: long contextual typewriter prompt at 50 ms/char, deterministic field fill at t=22 (visual anchored regardless of Gemini latency), AI reasoning bubble visible alongside user message.
- Demo time locked to 2 PM throughout so glass-glare hotspots stay lit for the recording.
- `showAllRoutes` overlay layer: GMACanvas renders non-selected candidates as muted grey lines under the colored primary route (Google-Maps alternate-route style).
- AIChatPanel height bumped to 620 px so a long typed prompt + multi-sentence AI response both fit in one screenshot.
- Light-mode polish across every component; dark-mode override preserved.
- Solar API server-side proxy ([server/index.js](server/index.js) + [netlify/functions/solar.js](netlify/functions/solar.js)) so the API key for the one CORS-blocked endpoint never reaches the browser.
- Public-facing [README.md](README.md) authored at the repo root.
- Pre-release audit: no hardcoded secrets in source, env + agent-scratch dirs gitignored, diagnostic console logs culled from hot paths.

### Build status

- `npx tsc -b` clean
- `npx vite build` clean (~1.5 MB main chunk; bundle-size advisory only)
- All API keys ship via `.env` / `import.meta.env.*` — no secrets in source.
