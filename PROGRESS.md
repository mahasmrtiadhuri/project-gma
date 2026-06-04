# PROGRESS.md

> Living progress log for **Project GMA** (Generative Micro-Climate Architect).
> Read alongside [CLAUDE.md](CLAUDE.md) at the start of every session.
> Update this file after every task — append to the appropriate phase, note any architectural decisions, and refresh build status.

## Status at a glance

| Phase | Name | Status |
|---|---|---|
| 1 | The Canvas | ✅ completed 2026-05-28 |
| 2 | The Physics | ✅ completed 2026-05-28 |
| 3 | The Brain | ✅ completed 2026-05-28 |
| 4 | The Interface | ✅ completed 2026-05-28 |
| 5 | Polish & Demo Prep | ⏳ in progress (light rebuild 2026-06-01) |

**Demo target:** Google Maps Platform Developer Community Day, NYC office, **June 10, 2026**.

---

## Phase 1 — The Canvas (✅ 2026-05-28)

### Scaffolded
- Vite 6 + React 19 + TypeScript (strict mode, `noImplicitAny`, no `any`)
- Tailwind CSS v4 via the `@tailwindcss/vite` plugin
- `vite-plugin-glsl` for `.glsl` / `.vert` / `.frag` imports in TS
- `vite-plugin-pwa` (autoUpdate, manifest in [vite.config.ts](vite.config.ts))
- TypeScript project references — root [tsconfig.json](tsconfig.json) → [tsconfig.app.json](tsconfig.app.json) + [tsconfig.node.json](tsconfig.node.json)

### Dependencies installed
- **Runtime:** `@deck.gl/core`, `@deck.gl/geo-layers`, `@deck.gl/layers`, `@deck.gl/react`, `@loaders.gl/3d-tiles`, `@loaders.gl/core`, `react`, `react-dom`
- **Dev:** `@tailwindcss/vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `tailwindcss`, `typescript`, `vite`, `vite-plugin-glsl`, `vite-plugin-pwa`

### Files created
- Root configs: [package.json](package.json), [vite.config.ts](vite.config.ts), [tsconfig.json](tsconfig.json), [tsconfig.app.json](tsconfig.app.json), [tsconfig.node.json](tsconfig.node.json), [index.html](index.html), [.gitignore](.gitignore), [.env.example](.env.example)
- App bootstrap: [src/main.tsx](src/main.tsx), [src/App.tsx](src/App.tsx), [src/vite-env.d.ts](src/vite-env.d.ts), [src/styles/globals.css](src/styles/globals.css) (CSS variables from CLAUDE.md §10)
- [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — initial `Tile3DLayer` against Google Photorealistic 3D Tiles, view centered on Manhattan `(40.758, -73.9855)`, `pitch: 45`, `zoom: 15`, reading the key from `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`
- Empty placeholders for every other file in CLAUDE.md §11

### Architectural decisions
- **No CLAUDE.md at scaffold time** — the spec was originally `GMA-SPEC.md`; renamed to `CLAUDE.md` after Phase 2.
- **Tailwind v4** chosen over v3 because the `@tailwindcss/vite` plugin avoids the PostCSS dance and is the 2026-default install path.
- **Project references** for tsc so the `vite.config.ts` (Node-side) and the app (browser-side) can have different `lib`/`types` without bleeding.

### Build status
- `tsc -b` clean
- `vite build` clean (only output is a deck.gl bundle-size advisory, not an error)

---

## Phase 2 — The Physics (✅ 2026-05-28)

### Architectural decision: synthetic-dataset + real-shader split

The spec's reflection ray-trace (§4 Module A) and Venturi extraction (§4 Module B) are both written against geometry from the 3D tileset. But **`Tile3DLayer`'s internal scenegraph isn't directly addressable from outside the layer**. So Phase 2 ships:

1. **Real physics** — the GLSL reflection shader and the Venturi math are exactly per spec.
2. **Hand-curated synthetic geometry** — a 6-facade Midtown glass-tower dataset feeds the shader, and a 6-segment Midtown street dataset feeds the Venturi math.

This delivers a working visual physics demo today; the dataset swap to live 3D-tile geometry is the Phase 3 hookup (see "Phase 3 hookup tasks" below).

### Files created / updated

#### Solar reflection layer
- [src/lib/shaders/solar.vert.glsl](src/lib/shaders/solar.vert.glsl) — fullscreen-quad vertex shader (passes UV to fragment stage)
- [src/lib/shaders/solar.frag.glsl](src/lib/shaders/solar.frag.glsl) — full `R = I − 2(I·N)N` reflection physics; projects reflected ray from facade origin to z=0 ground plane; gaussian beam falloff (σ = 28 m); cool-blue → white → thermal-red colormap matching the CSS palette in CLAUDE.md §10
- [src/lib/solar.ts](src/lib/solar.ts) — `SolarHeatmapRenderer` class runs the shader in an **offscreen WebGL2 framebuffer** (512×512). Reads pixels into a **fresh `Uint8Array` each call** so deck.gl's `BitmapLayer` detects the new image identity and re-uploads to the GPU. Exports `MIDTOWN_FACADES` (6 hand-curated glass facades at Bank of America Tower, One Vanderbilt, 7 Bryant Park, 1271 Sixth Ave, 1095 Sixth Ave) and `MANHATTAN_BBOX`.
- [src/hooks/useSolarPosition.ts](src/hooks/useSolarPosition.ts) — NOAA-style azimuth/elevation from a timestamp + lat/lng. Returns `sunDirection` as a unit vector in east-north-up coords, pointing sun→ground (the `Î` the shader's `uSunDirection` expects). Accuracy ~0.5°, ample for demo work.
- [src/hooks/useSolarHeatmap.ts](src/hooks/useSolarHeatmap.ts) — React lifecycle wrapper that maintains a single renderer instance for the component's lifetime and re-renders whenever the sun direction changes.

#### Venturi wind layer
- [src/lib/venturi.ts](src/lib/venturi.ts) — implements `v_local = v_ambient × (W_entry / W_canyon)` with a ±30° axis-alignment gate (no Venturi when wind isn't aligned with the street). Corridor flag at multiplier > 2.0. `pathWithArrowhead()` builds polylines that include an arrowhead at the segment end for `PathLayer` to render. Exports `MIDTOWN_STREET_SEGMENTS` (6 segments along 5/6/7 Aves and 42nd St).
- [src/hooks/useWindData.ts](src/hooks/useWindData.ts) — fetches `weather.googleapis.com/v1/currentConditions:lookup`; normalizes the response to mph; polls every 10 min. **Falls back to a synthetic NW 12 mph wind** when no API key is configured or the fetch fails, so the Venturi overlay always has motion to demo.

#### UI
- [src/components/TimeScrubber.tsx](src/components/TimeScrubber.tsx) — 6 AM–10 PM slider, 5-min steps, accent-colored, with live "2:35 PM" readout. Lifted state lives in `App.tsx` (defaults to 2 PM per demo script §9).
- [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — wires `Tile3DLayer` + `BitmapLayer` (heatmap) + `PathLayer` (wind arrows). Adds a small mono telemetry readout (top-left) showing sun AZ/EL, wind speed/direction/source, and active corridor count.
- [src/App.tsx](src/App.tsx) — owns the timestamp state, mounts `TimeScrubber`.

### Wind-arrow z-elevation fix

Wind arrows initially rendered as 2D paths at ground level and got occluded by the 3D building meshes whenever the camera tilted toward street level. Fix in [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx):

1. **Lift path coordinates to z = 5 m** (street-light height) — avoids z-fighting with the ground plane and puts the arrows where street-level wind actually exists.
2. **Disable depth test on the wind PathLayer** — `parameters: { depthCompare: 'always', depthWriteEnabled: false }` so arrows remain visible even when geometrically occluded by tall buildings.

Result: wind arrows read correctly from both top-down and street-level camera angles. They render as a 2D annotation overlay rather than competing with the 3D mesh for occlusion.

### Build status
- `tsc -b` clean
- `vite build` clean

### Phase 3 hookup tasks (dataset swap)

The two synthetic datasets are **intentional placeholders**. Phase 3 needs to replace them with geometry extracted from the live 3D tileset:

1. **Facades** — hook into `Tile3DLayer.onTileLoad`, walk the glTF scenegraph, identify reflective faces with a heuristic (verticalish normals, large face area, modern-tower glass classifier). Replace `MIDTOWN_FACADES` in [src/lib/solar.ts](src/lib/solar.ts). The shader and the renderer don't need to change — just the data.
2. **Street segments + canyon widths** — derive parallel building-wall polygons along each street axis, compute `W_entry` and `W_canyon`. Replace `MIDTOWN_STREET_SEGMENTS` in [src/lib/venturi.ts](src/lib/venturi.ts). The `computeVenturi()` math and the `pathWithArrowhead()` arrow geometry don't need to change.

Until that swap lands, the hardcoded data is demo-tuned for Midtown 47th–51st along 5/6/7 Aves.

---

## Phase 3 — The Brain (✅ 2026-05-28)

### Architectural decisions

1. **A2UI fallback.** `@google/a2ui` wasn't published to npm at scaffold time. Per CLAUDE.md §12, the conversational layer ships as a plain Gemini chat with structured JSON output. `ConversationBar.tsx` is the rendering surface; swapping in `A2UIRenderer` is a Phase 4+ task when the package lands.
2. **No SDK.** Gemini, Routes, and Geocoding all called via direct `fetch` — no `@google/genai` dependency. Smaller bundle, fewer moving parts, and the REST `responseSchema` enforces the structured `ComfortIntent` shape just as well as the SDK.
3. **Maps Grounding Lite via Geocoding.** MCP is primarily a stdio protocol; the HTTP transport for Maps Grounding Lite isn't reachable from a browser at scaffold time. `mcpClient.ts` documents this and satisfies the only capability the comfort agent needs (place-name → lat/lng) via Google Geocoding API. Swap target for when MCP HTTP ships.
4. **Cost-matrix injection via re-scoring.** Routes API doesn't expose per-edge cost overrides. The comfort router asks for `computeAlternativeRoutes: true`, then **re-scores each candidate polyline client-side** by sampling thermal (from `MIDTOWN_FACADES`) and Venturi (from `MIDTOWN_STREET_SEGMENTS`) costs at 25 m intervals along the polyline. The lowest-HLCI alternative wins; the fastest is always the first.
5. **Graceful degradation.** No Gemini key → neutral `DEFAULT_INTENT` so routing still runs. No Maps key → straight-line fallback route so scoring still runs. Both surfaces label themselves so it's clear what's live vs. simulated.

### Files created / updated

#### Brain
- [src/lib/a2uiClient.ts](src/lib/a2uiClient.ts) — `createComfortAgent()` returns `{ isAvailable, sendComfortPrompt }`. System instructions adapted from CLAUDE.md §4 Module C. `responseSchema` enforces `{ summary, hlciWeights: { glareAvoidance, windAvoidance, shadePreference }, origin, destination }`. Falls back to `DEFAULT_INTENT` when no key.
- [src/lib/mcpClient.ts](src/lib/mcpClient.ts) — `geocodePlace(query, apiKey)` hits Google Geocoding API biased to Manhattan; returns `PlaceLocation | null`. Documented Phase 3.5+ swap target for real MCP HTTP transport.

#### Routing
- [src/lib/hlciRouter.ts](src/lib/hlciRouter.ts) — `computeComfortRoute()`: hits Routes API (`directions/v2:computeRoutes`, WALK, `computeAlternativeRoutes: true`); decodes polylines (Google encoded-polyline algorithm inlined to avoid `@googlemaps/polyline`); scores each candidate via `scoreRouteHlci()` using `thermalAtPoint` + `windAtPoint` kernels at 25 m sample intervals; picks the lowest HLCI cost; returns `{ selected, alternatives, hlciDelta, comfortGain, weights }`. Straight-line fallback when Routes API isn't reachable. `thermalAtPoint` + `windAtPoint` are exported so `useHLCI` reuses them.
- [src/hooks/useHLCI.ts](src/hooks/useHLCI.ts) — `useHLCI(lat, lng, sunDirection, windDirectionDeg, windSpeedMph)` returns `{ score: 0..100, thermal, wind }` at a single sample point. Drives the HLCIBadge.

#### UI
- [src/components/ConversationBar.tsx](src/components/ConversationBar.tsx) — A2UI-placeholder chat panel: scrollable message history, three suggestion chips when empty, text input + send button. Disabled state when no Gemini key. Auto-scrolls on new message.
- [src/components/RouteCard.tsx](src/components/RouteCard.tsx) — top-right (offset below HLCIBadge) showing distance, duration, "+N comfort over fastest" badge, ΔHLCI scalar, dismiss button.
- [src/components/HLCIBadge.tsx](src/components/HLCIBadge.tsx) — top-right 0..100 score with color tone (cool blue ≥80, warm ≥40, hot <40).
- [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — added `routeResult` prop; renders the selected route as an amber `PathLayer` at z=400 m with depth test disabled; mounts `HLCIBadge`.

#### Wiring
- [src/App.tsx](src/App.tsx) — owns `messages`, `routeResult`, `busy`; constructs the agent; on send: calls `agent.sendComfortPrompt(text)` → `geocodePlace()` for both endpoints (or Bryant Park ↔ Rockefeller Center defaults) → `computeComfortRoute()`. Uses refs to read latest sun/wind into the async handler without stale closures.
- [.env.example](.env.example) — added `VITE_GEMINI_API_KEY`.
- [src/vite-env.d.ts](src/vite-env.d.ts) — typed the new env var.

### Demo flow

User types in ConversationBar → Gemini returns `ComfortIntent` (or default if offline) → mcpClient geocodes the origin/destination (or Midtown defaults) → hlciRouter fetches alternatives from Routes API + re-scores them → selected route renders as amber polyline on the map + RouteCard shows the comfort delta. Time scrubber moves the sun; HLCIBadge reading updates live.

### Build status
- `tsc -b` clean
- `vite build` clean

---

## Phase 4 — The Interface (✅ 2026-05-28)

Most of Phase 4's spec surface — `ConversationBar`, `RouteCard`, `HLCIBadge`, polished `TimeScrubber` — already shipped during Phase 3 because they were prerequisites for wiring the brain into the canvas. What landed in Phase 4 is the remaining UI plumbing.

### Files created / updated

- [src/components/LayerToggle.tsx](src/components/LayerToggle.tsx) — three-mode pill radio (Thermal / Wind / All) per CLAUDE.md §10 component #2. ARIA `radiogroup` + `radio` roles. Active pill colored with `--gma-thermal-warm`; inactive pills use secondary text color.
- [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — accepts `layerMode: LayerMode` prop. The thermal `ScatterplotLayer` only mounts when `layerMode ∈ {'thermal', 'all'}`; the wind `PathLayer` only mounts when `layerMode ∈ {'wind', 'all'}`. The route polyline and 3D tiles are always on.
- [src/App.tsx](src/App.tsx) — owns `layerMode` state (default `'all'`), threads it into `GMACanvas` and `LayerToggle`.

### Mobile layout polish

- [src/components/TimeScrubber.tsx](src/components/TimeScrubber.tsx), [src/components/LayerToggle.tsx](src/components/LayerToggle.tsx), [src/components/ConversationBar.tsx](src/components/ConversationBar.tsx) — bottom positions switched from plain `bottom-X` to `bottom-[calc(env(safe-area-inset-bottom,0px)+Nrem)]` so the home-indicator on notched phones doesn't overlap the controls. `index.html` already declares `viewport-fit=cover`, which is what makes `env(safe-area-inset-bottom)` non-zero on iOS.
- Bottom stack (bottom → top): TimeScrubber (24 px above safe-area) → LayerToggle (128 px) → ConversationBar (192 px). On a 375 × 812 mockup the stack clears without collision; on shorter screens the ConversationBar history truncates via its existing `max-h-48 overflow-y-auto`.

### Build status
- `tsc -b` clean
- `vite build` clean

---

## Phase 5 — Polish & Demo Prep (⏸ per CLAUDE.md §7 Days 11–13)

- Bounding-box optimization: viewport-radius tile culling (target 60 FPS on phone per §12)
- Offline fallback for conference WiFi
- Rehearse the 5-min demo script (CLAUDE.md §9)
- README + screenshots + 60-sec demo video for portfolio

---

## Conventions

- **Session start:** read [CLAUDE.md](CLAUDE.md) and this file (PROGRESS.md) before starting any new work. Automated via a `SessionStart` hook in `.claude/settings.local.json` (PowerShell, prints both files to stdout; the harness injects that into context).
- **After every task:** append to the relevant phase here. Capture (a) what shipped, (b) any architectural decisions, (c) build status.
- **Build verification:** `npx tsc -b && npx vite build` must pass clean before a phase is marked ✅.

---

## Tooling changes

### 2026-05-28 — SessionStart hook

Added `.claude/settings.local.json` with a `SessionStart` hook that prints `CLAUDE.md` and `PROGRESS.md` to stdout via PowerShell. Output is injected into the model context at session start, so the spec and progress log are always available without explicit reads. The file is gitignored.

### 2026-05-28 — Vertex AI investigation (no code change, billing path chosen)

User asked to swap [src/lib/a2uiClient.ts](src/lib/a2uiClient.ts) from AI Studio (`generativelanguage.googleapis.com`) to Vertex AI to fix the recurring 429s. Investigated empirically before any code change.

#### Empirical findings against the current `VITE_GEMINI_API_KEY` (AQ.…)

| Endpoint | Result | Reading |
|---|---|---|
| AI Studio `generativelanguage.googleapis.com/.../gemini-2.5-flash` | 429 `"Your prepayment credits are depleted"` (from earlier turn) | **Billing exhausted on the AI Studio account** |
| Vertex Express `aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-2.5-flash` | 403 `API_KEY_SERVICE_BLOCKED` | API key has restrictions that block `aiplatform.googleapis.com` |
| Vertex Express `aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash` | 403 `"Agent Platform API has not been used in project 25971016883 ... or it is disabled"` | Vertex AI API itself is disabled on the GCP project that owns the key |

#### Why the swap would have made things worse

1. **The 429 is a billing problem, not an endpoint problem.** The error message links explicitly to ai.studio/projects/billing. Switching endpoints doesn't migrate billing — Vertex requires its own funded billing on a GCP project.
2. **The API key is bound to GCP project `25971016883`**, not the `project-b76fcd27-8411-4456-bb3` the user mentioned (which is also truncated mid-UUID).
3. **`@google-cloud/vertexai` is Node-only** — uses Application Default Credentials / service-account JSON. It cannot run in a browser without exposing service-account private keys. The only browser-safe Vertex path is **Vertex Express Mode with API key**, which is exactly what's blocked above.
4. Writing the swap would have replaced `429 RESOURCE_EXHAUSTED` with `403 PERMISSION_DENIED` — strictly worse.

#### Decision

User chose: **fix AI Studio billing externally, keep code unchanged.** Action item is at [ai.studio/projects](https://ai.studio/projects) — top up prepay credits. After that, the existing `gemini-2.5-flash` call in `a2uiClient.ts` will return real responses without code changes.

#### Vertex swap re-entry conditions (for a future session)

If you later want Vertex anyway, three things need to be true *before* the code swap is worth doing — all GCP-console actions, not code:
- `aiplatform.googleapis.com` enabled on whatever project owns the API key (currently `25971016883`)
- That project has billing enabled with non-zero balance
- The API key's "API restrictions" allow `aiplatform.googleapis.com` (currently it doesn't)

If you'd rather, a Node.js backend proxy with service-account auth bypasses all three but is ~150 lines of new server code + deployment + CORS work.

### Build status (no diff from previous turn)
- `tsc -b` clean
- `vite build` clean

### 2026-06-01 — Departure/arrival time picker (`effectiveTime` drives everything)

Google-Maps-style "Leave now / Leave at / Arrive by" time picker. The selected time becomes the **effective time** that drives the entire astronomical pipeline — sun position, day phase, color temperature, route comfort scoring, and the sun-glow direction all reflect conditions at the planned departure/arrival time instead of "right now".

#### New component — [src/components/TimePicker.tsx](src/components/TimePicker.tsx)

- Trigger: small clock-icon pill (`gma-glass`), sits at `top-[calc(env(safe-area-inset-top,0px)+11rem)]` (just below the TransportModeSwitcher at `7.5rem`). Label updates to reflect the selection: `"Leave now"` / `"Leave at 8:30 AM"` / `"Arrive by 9:00 AM"`. Chevron rotates when the dropdown is open.
- Dropdown: `gma-glass-strong` card centered below the trigger, 320px max. Three mode buttons; the active one fills with the live `dayColor` and has a soft glow.
- When `leave-at` or `arrive-by` is active, a native `<input type="datetime-local">` appears below the mode buttons. Styled dark via `colorScheme: 'dark'` + `background: rgba(255,255,255,0.08)` + `border: 1px solid rgba(255,255,255,0.15)`. On modern Chrome/Edge/Safari this gives a dark native picker UI.
- Click-outside-to-close via document `mousedown` listener bound while the dropdown is open.
- Mode switching seeds a default `plannedTime` of `now + 30 min` if the user hadn't picked one yet, so the datetime input has something sensible to show immediately.

#### Wiring in [src/App.tsx](src/App.tsx)

```ts
const [timeMode, setTimeMode] = useState<TimeMode>('leave-now');
const [plannedTime, setPlannedTime] = useState<Date | null>(null);

const effectiveTime = useMemo(() => {
  if (timeMode === 'leave-now' || !plannedTime) return timestamp;
  return plannedTime;
}, [timeMode, plannedTime, timestamp]);
```

`effectiveTime` replaces `timestamp` as the input to:
- `useSolarPosition(effectiveTime, …)` — sun azimuth + elevation now reflect the planned time
- `computeSunTimes(effectiveTime, …)` — sunrise/sunset for the date of the planned time (handles cross-day pickers)
- `dayProgress(effectiveTime, sunTimes.times)` — phase + color reflect the planned time
- `SunCompass.now={effectiveTime}` — compass time display shows the planned time

The existing 10-min `timestamp` refresh still runs and drives `effectiveTime` when in `leave-now` mode. Picking a future time freezes the visualization at that time; switching back to `leave-now` resumes live updates.

The diagnostic `[GMA] Daylight` console log now includes `timeMode`, `plannedTime`, and `effectiveTime` so it's verifiable in DevTools that picking 8:30 PM tomorrow really does shift the sun computation to that timestamp:

```
[GMA] Daylight: {
  source: 'computed',
  timeMode: 'leave-at',
  plannedTime: '2026-06-02T00:30:00.000Z',
  effectiveTime: '2026-06-02T00:30:00.000Z',
  sunrise: '2026-06-02T09:24:18.343Z',
  sunset:  '2026-06-03T00:28:31.657Z',
  progress: 0.997,
  phase: 'sunset',
  color: [231, 111, 81],
  ...
}
```

#### "Arrive by" semantics — simplification worth knowing

Properly, an arrive-by time means the user walks during `[arrival − duration, arrival]`, so the sun position they'd actually experience is somewhere between (or, conservatively, the midpoint). Computing that exactly would create a circular dep — color depends on effectiveTime → sort by color depends on effectiveTime → selected route depends on sort → walk duration depends on selected route → effectiveTime depends on duration.

For v1 the code treats `plannedTime` AS the effective sun-position time regardless of mode (leave-at and arrive-by use the picked time directly). Slightly off for arrive-by routes — the actual walk would experience earlier sun position than what's rendered. An easy follow-up: once `selectedRoute` is known, compute `effective = plannedTime − selectedRoute.durationSeconds * 1000` when `timeMode === 'arrive-by'`. Skipped for now to keep the wiring linear.

#### Auto-pan re-fit on time change worth knowing

Since `result` is derived from `effectiveTime` (sun azimuth feeds the per-route comfort scoring → sort order), changing the planned time can change which route lands at `result.routes[0]`. The existing auto-pan effect refits to `result.routes[0].polyline` on any `result` change, so picking a different time may trigger a camera re-fit if the best route changes. Acceptable behavior — the user gets visual feedback that the choice mattered. If it becomes disruptive, the fix is gating auto-pan on origin/destination changes only, not on result.

#### Build status

- `tsc -b` clean
- `vite build` clean (1361 KB precache)

### 2026-05-31 — Replaced PlaceAutocompleteElement with manual input + AutocompleteSuggestion API

The `PlaceAutocompleteElement` web component renders in shadow DOM with a white background that the documented `::part(input)` overrides + `--gmp-*` custom properties couldn't reliably override (the white surface was on a part Google doesn't expose for theming on the current SDK rev). Replacing with a regular `<input>` + manual suggestion-fetch via the new `google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions()` API gives full DOM-level styling control.

#### What changed in [src/components/SearchBar.tsx](src/components/SearchBar.tsx)

`PlaceField` is now a self-contained component with:

1. **Controlled `<input>`** styled per spec — `rgba(255,255,255,0.08)` bg, `#ffffff` text, `rgba(255,255,255,0.15)` border, `placeholder:text-white/40` Tailwind utility for the placeholder color.
2. **200ms debounce** between keystroke and API call. Stale suggestions from the previous query are cleared *immediately* on keystroke so the dropdown never shows mismatched results while waiting for the new fetch.
3. **`AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, locationBias, includedRegionCodes })`** — the new Places API method per the user's spec. Replaces the PaE web component entirely.
4. **Custom dropdown** rendered as a `gma-glass-strong` rounded card directly below the input via `top-full mt-2`. Each suggestion row shows `mainText` (white, primary) and `secondaryText` (white/60, secondary) stacked, with a hairline `border-white/[0.06]` between rows and a `hover:bg-white/[0.06]` interaction state.
5. **Click-not-blur** ordering — suggestion buttons use `onMouseDown={preventDefault}` so input retains focus when clicked, preventing the blur handler from hiding the dropdown before the click registers. The blur handler also delays the close by 150ms as a belt-and-suspenders.
6. **`prediction.toPlace().fetchFields({ fields: ['location', 'displayName', 'formattedAddress'] })`** on pick — same place-detail mechanism as before, just driven by our manual flow instead of the web component's internal one.
7. **External value → input text sync** preserved — `useEffect` on `[value]` resets `text` to the parent's value, unless the input is currently `document.activeElement` (so an in-flight auto-fill doesn't clobber the user's typing).
8. **Diagnostic logs kept** — `[GMA] Autocomplete (Origin) "5 brya" → 3 suggestion(s)` on each fetch, `[GMA] Picked (Destination): { lng, lat, label }` on each selection.

#### Trade-offs worth flagging

- **Session tokens skipped** for v1. The new `AutocompleteSuggestion` + `Place.fetchFields` pipeline's session-token plumbing is poorly captured in `@types/google.maps` currently, and per-call billing is acceptable for the demo. If quota becomes a concern, adding `sessionToken: new AutocompleteSessionToken()` to both the suggestions request and (where supported) the place fetch is a 5-line change.
- **Keyboard navigation** (arrow keys + Enter + Escape) not wired — click-to-select only. Phase-5 polish item; would need a `selectedSuggestionIdx` state + `onKeyDown` handler on the input.
- **Input width / dropdown width** match by design (`absolute left-0 right-0`) — the dropdown is constrained to the field's width rather than spanning the full search card. Looks indented; visually matches Google Maps' inline autocomplete pattern.

The unused `gmp-place-autocomplete` CSS rules in [src/styles/globals.css](src/styles/globals.css) are left in place — they're dormant when no `<gmp-place-autocomplete>` elements exist in the DOM, and keeping them means re-adding the web component later doesn't require restoring the theming.

#### Build status
- `tsc -b` clean
- `vite build` clean (1356 KB precache)

### 2026-05-31 — Critical text-color fix (everything white on dark glass)

The dark sci-fi redesign left text invisible: the CSS variables had moved to dark glassmorphism surfaces but the text tokens (`--gma-text-primary` = `#e8eaf6`, `--gma-text-secondary` = `#9ba3b8`, `--gma-text-muted` = `#5f6680`) were still hue-based grays that read as nearly black against the deep navy basemap and `rgba(15, 20, 34, 0.6)` glass cards. Fix is in two layers — global tokens + per-component overrides where the spec wanted exact alpha values or where active-state text was previously dark-on-bright.

#### Global token flip in [src/styles/globals.css](src/styles/globals.css)

```css
--gma-text-primary: #ffffff;
--gma-text-secondary: rgba(255, 255, 255, 0.7);
--gma-text-muted: rgba(255, 255, 255, 0.5);
```

Plus `html, body, #root { color: #ffffff }` so any text without an explicit color attribute inherits white instead of the user agent's default (typically `#000`).

Also fixed Places UI Kit: `gmp-place-autocomplete::part(input)` now sets `color: #ffffff`, with a separate `::part(input)::placeholder { color: rgba(255, 255, 255, 0.5) }` rule (some browsers split placeholder styling into a sub-pseudo even within shadow DOM parts).

#### Per-component overrides

| Component | What changed |
|---|---|
| [RouteSheet.tsx](src/components/RouteSheet.tsx) | Filter pill **active** text `#0a0e1a` → `#ffffff`; filter pill **inactive** text `var(--gma-text-secondary)` → `rgba(255, 255, 255, 0.6)` (per-spec exact alpha, distinct from the 0.7 default); comfort badge percent + verb both `#ffffff`; Start button text `#0a0e1a` → `#ffffff` |
| [SunCompass.tsx](src/components/SunCompass.tsx) | `<text>` SVG fill for "N" reference `var(--gma-text-secondary)` → `#ffffff`; time label inline color → `#ffffff` (kept the accent-colored `text-shadow` so the warm glow remains); phase + elevation row → `#ffffff` |
| [MapViewSwitcher.tsx](src/components/MapViewSwitcher.tsx) | 2D / 3D / SAT pill text always `text-white` regardless of active state |
| [TransportModeSwitcher.tsx](src/components/TransportModeSwitcher.tsx) | Active + inactive icon color → `#ffffff` (active state previously dark-on-amber) |
| [NavigationPanel.tsx](src/components/NavigationPanel.tsx) | Stop button, time + km readouts, step instruction text, step distance text, "+ N more steps" line all → `text-white`; active step badge (idx 0) inline color `#0a0e1a` → `#ffffff` |

#### Contrast trade-off worth knowing

The spec puts `#ffffff` text on the **active filter pills**, which use the live `dayColor` as background — that's often light amber/gold during midday. White-on-amber reads less crisply than the previous dark-on-amber. This is a deliberate spec choice for consistency with every other text being white; if it becomes a problem in practice the cleanest fix is darkening the active background (not the text) when the dayColor is light. Same applies to the Start button, TransportModeSwitcher active pill, and NavigationPanel "next step" badge — all use the same active-bg + white-text pattern now.

#### Build status
- `tsc -b` clean
- `vite build` clean (1354 KB precache)

### 2026-05-31 — Cinematic sci-fi Earth-from-space redesign

Full visual rewrite. The earlier consumer-app white palette is gone; the app now reads as a glassmorphism HUD over a dark Earth basemap with live sunlight visualization. Physics layer (`useSolarPosition`, `useWeatherData`, `hlciRouter`) untouched per the user's "keep physics unchanged" mandate; everything in this pass is visual.

#### Spec deviations from CLAUDE.md worth flagging

Original CLAUDE.md §10 called for a "dark spatial instrument panel" with DM Mono — that's the closest match for this rebuild. The intermediate consumer-app palette (white surfaces, Inter font, Google-Maps-style) is fully replaced. DM Mono is back as the body font.

#### Astronomical color system — heart of the redesign

[src/lib/daylight.ts](src/lib/daylight.ts) **NEW**. Three pieces:

1. `computeSunTimes(date, lat, lng)` — NOAA-style sunrise/sunset (Cooper declination + equation-of-time + −0.833° atmospheric refraction). Returns `null` at polar latitudes during midnight-sun/polar-night.
2. `dayProgress(now, times)` — 0 = sunrise, 1 = sunset, < 0 / > 1 = night.
3. `interpolatedDayColor(progress)` — 5-anchor smooth gradient: dawn `#ff6b35` → morning `#ffd166` → midday `#fff4d6` → afternoon `#f4a261` → sunset `#e76f51`, with blends into/out of night `#1a1a2e` at the [0, 1] edges.

[src/hooks/useWeatherData.ts](src/hooks/useWeatherData.ts) extended to optionally parse `isDaytime`, `currentTime`, `sunriseTime`, `sunsetTime`, and `sunEvents.sunriseTime/sunsetTime` from the Weather API response — but **the `currentConditions:lookup` endpoint that this hook hits doesn't actually surface sunrise/sunset** (those live on `forecast/days:lookup`). So:

- If the API surfaces them on a future SDK rev → used directly, console logs `source: 'api'`.
- Otherwise → `computeSunTimes` runs client-side, console logs `source: 'computed'`.

[src/App.tsx](src/App.tsx) logs `[GMA] Daylight: {source, sunrise, sunset, progress, phase, color, apiIsDaytime}` whenever phase or source changes. That lets you verify which path produced the current color without noise.

#### The "look" — what the colors drive

The interpolated dayColor RGB flows through props into every warm accent:
- **SunGlow** ([src/components/SunGlow.tsx](src/components/SunGlow.tsx)) — full-screen radial-gradient overlay positioned beyond the viewport in the sun's bearing (160% from center), `mix-blend-mode: screen` so it lightens the dark basemap without obscuring routes. Glow intensity scales with sun elevation. Hidden at night.
- **Route polyline warm anchor** (`colorizeRoute` in [src/lib/routeColoring.ts](src/lib/routeColoring.ts)) — cool fixed dark blue `rgba(20, 40, 80, 0.4)` at exposure=0; dayColor at exposure=1. Always-on now (not gated by filter mode) — the user always sees live sun-exposure along the route. Wind filter switches to green→purple instead.
- **SunCompass arrow + time text** — accent glow uses dayColor.
- **Filter pill active state** — sun-related pills (Avoid Sun / Avoid Both / Sunniest) use dayColor; wind pill uses fixed `--gma-accent-wind` purple; No-preference uses neutral grey.
- **Start button** background + glow.
- **TransportModeSwitcher** active pill.
- **NavigationPanel** "next step" badge.

#### Map + route layers

[src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — 2D basemap switched from Positron (light) to **CartoDB Dark Matter**. The selected route now renders as a **4-layer glow stack**:
1. `route-glow-outer` — 18px white at 14% alpha (halo)
2. `route-glow-inner` — 10px white at 35% alpha
3. `route-core` — 4px white at 90% alpha (bright spine)
4. `route-comfort-overlay` — 6px per-segment colored polyline (always-on sun encoding, or wind when that filter active)

Stacked with `depthCompare: 'always'` so the glow is visible from any camera angle. `updateTriggers` on `getPath` per layer prevent the deck.gl segment-cache from showing a stale polyline when the user picks a different route card.

#### Tree canopy shading (Overpass)

[src/lib/overpass.ts](src/lib/overpass.ts) + [src/hooks/useStreetTrees.ts](src/hooks/useStreetTrees.ts) **NEW**. Fetches `node[natural=tree]` within the selected route's bbox (~100m padding) from the public Overpass endpoint. Module-scope cache keyed by bbox rounded to 3 decimal places so panning doesn't re-hit Overpass. Failures (timeout, 4xx, 429) degrade silently to "no trees known". When tree data is available, `colorizeRoute` checks each segment midpoint against the tree list (haversine, 20m radius) and multiplies sun exposure by 0.3 for shaded segments — they fade toward the cool anchor on the gradient.

#### SunCompass (replaces WeatherCompass)

[src/components/SunCompass.tsx](src/components/SunCompass.tsx) — larger 110px disc, glowing amber arrow rotated to sun azimuth with SVG `feGaussianBlur` halo, quarter-arc on the right showing elevation as a sweep from horizon to current angle. Below the disc: local time in dayColor, phase name + elevation degrees in muted secondary.

The earlier 2-disc WeatherCompass is deleted; wind direction no longer has its own dedicated indicator. If desired, easy to re-add as a smaller second disc beside the sun one.

#### UI — dark glassmorphism

All chrome rebuilt:
- New CSS utility classes `.gma-glass` (rgba 0.6 + blur 20px saturate 140%) and `.gma-glass-strong` (rgba 0.85 + blur 24px saturate 160%).
- Search bar, route sheet, transport pills, view switcher, nav panel, sun compass all use these.
- Pill borders are hairline `rgba(255,255,255,0.08)` to read against the dark map.
- DM Mono throughout via Google Fonts link added to [index.html](index.html); `body` font-family chain in [src/styles/globals.css](src/styles/globals.css) starts with DM Mono and falls back to other monospaces.

#### Filter pill accent colors

[src/components/RouteSheet.tsx](src/components/RouteSheet.tsx) — each filter's `accent` metadata is `'sun' | 'wind' | 'neutral'`, mapped at render time to dayColor / `--gma-accent-wind` / `--gma-accent-neutral`. Active pill has a colored fill, dark text, and a 14px box-shadow glow in the matching color. Inactive pills are transparent on the glass surface with hairline border.

#### Build status
- `tsc -b` clean
- `vite build` clean (1354 KB precache)

### 2026-05-31 — Geocoding fallback diagnostics + per-segment route coloring + WeatherCompass

Two fixes. The first one is a small but high-signal change to make a previously-invisible failure visible. The second is a new visual layer that makes the comfort scoring legible on the map.

#### Issue 1 — Origin field stuck on "Your location"

Most likely cause: `reverseGeocode` returns `null` (Geocoding API isn't enabled on the GCP project, key restrictions block it, billing exhausted, etc.) and App's fallback was `address ?? 'Your location'` — that literal string is **visually indistinguishable from the placeholder**, so the user can't tell whether geocoding succeeded with an oddly-named place or failed silently.

Two changes:

1. [src/lib/geocoding.ts](src/lib/geocoding.ts) — every step now logs:
   - `Reverse-geocoding {lat}, {lng}…` on call
   - `Geocoding API status=<status>, results=<n>` on response
   - `Geocoding rejected: status=REQUEST_DENIED …` with the API's `error_message` if status ≠ `OK`
   - `Reverse-geocoded: <address>` on success
   When the field still falls back to coords, the console says exactly which Google-side gate rejected the request (`REQUEST_DENIED` = key/API restriction, `OVER_QUERY_LIMIT` = billing, `ZERO_RESULTS` = no nearby address).
2. [src/App.tsx](src/App.tsx) — fallback when `reverseGeocode` returns `null` is now `"${lat.toFixed(4)}°, ${lng.toFixed(4)}°"` instead of `"Your location"`. So:
   - **Geocoding succeeds** → field shows the real formatted address ("5 Bryant Park, New York, NY 10018, USA")
   - **Geocoding fails** → field shows the live coordinates (the actual lat/lng the geolocation API returned) so the user can see geolocation worked but Geocoding API didn't
   - **Geolocation denied** → origin stays `null`, field shows the placeholder "Your location" (unchanged)

Three distinct visual states for the three distinct outcomes.

#### Issue 2 — Per-segment colored route polyline + WeatherCompass

New [src/lib/routeColoring.ts](src/lib/routeColoring.ts) → `colorizeRoute(polyline, filterMode, sunAzimuth, windFrom)` returns a `ColoredSegment[]` (one per Routes-API polyline segment). Each segment's bearing is compared to the live sun azimuth or wind direction:

- For sun filters (Avoid Sun / Avoid Both / Sunniest): `cos(bearing − sunAzimuth)` maps a 3-stop gradient blue (sun behind) → white → red (sun in face)
- For wind filter (Avoid Wind): `cos(bearing − windFrom)` maps green (tailwind) → yellow → purple (headwind)
- For No preference: returns empty array → GMACanvas falls back to plain blue route polyline

**Design decision worth flagging:** the color encoding is **physically meaningful, not preference-relative**. Red always = sun in face, blue always = sun behind, regardless of whether the user picked "Avoid Sun" or "Sunniest". The filter pill controls scoring + ranking; the color tells the truth about each segment. This way a "Sunniest" user picks the most red-heavy route, an "Avoid Sun" user picks the most blue-heavy one — both reading the same color legend.

For "Avoid Both" the polyline colors by sun (more visually dramatic, dominant comfort axis on most days); the wind direction is still legible in the compass.

[src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — new `coloredSegments` prop. When non-null, swaps the single-color `PathLayer` (`id: comfort-route`) for a multi-color one (`id: comfort-route-colored`) backed by the segment array. Different IDs prevent deck.gl from trying to morph one into the other; `updateTriggers` on `getPath` + `getColor` keeps the tesselation fresh when filter/sun/wind change.

[src/components/WeatherCompass.tsx](src/components/WeatherCompass.tsx) — NEW. Small bottom-left white card with two compass discs:
- **Sun**: orange arrow rotated to `sunAzimuthDeg` (points toward where the sun is in the sky)
- **Wind**: purple arrow rotated to `(windFrom + 180) % 360` (points in flow direction, since the API reports the FROM direction)
Each disc has a tiny "N" reference at the top. Hidden when filter is "No preference" or when weather is `null`, and during navigation mode.

[src/lib/hlciRouter.ts](src/lib/hlciRouter.ts) — `bearingDegrees` upgraded from a private helper to an export so `routeColoring.ts` can reuse the exact same formula as the scorer. The two stay coherent: if scoring says a segment costs X for sun, the segment's color will reflect that same cos(bearing − azimuth).

#### Build status
- `tsc -b` clean
- `vite build` clean (1347 KB precache)

### 2026-05-31 — Geolocation auto-fill + reverse geocoding + diagnostic logs

Two issues. The auto-fill one had a real bug worth flagging; the route-sheet-not-appearing one I tackled with diagnostics rather than a guess because the user explicitly asked for logs.

#### Issue 2 — Geolocation auto-fill (real bug fixed)

[src/hooks/useCurrentLocation.ts](src/hooks/useCurrentLocation.ts) was returning the `fallback` argument synchronously on first render and only updating if geolocation resolved to a Manhattan-bbox location. [src/App.tsx](src/App.tsx)'s hydrate effect then set origin to `{point: fallback, label: 'Your location'}` immediately, and its `if (current) return current` overwrite guard prevented the real geolocation result from ever replacing it. End result: origin was permanently stuck at Bryant Park no matter what geolocation said.

Fix in three parts:

1. [src/hooks/useCurrentLocation.ts](src/hooks/useCurrentLocation.ts) — rewritten to return `{point: RoutePoint | null, status: 'pending' | 'available' | 'denied'}`. No synchronous fallback. The Manhattan bbox guard is also gone — it was a dev safeguard that legitimately rejected users in Brooklyn / Queens / anywhere outside the bbox. Logs `[GMA] Requesting geolocation permission…` on mount, then either `Geolocation resolved: …` with the point or `Geolocation failed (denied by user | position unavailable | timeout): …`.
2. [src/lib/geocoding.ts](src/lib/geocoding.ts) **NEW** — `reverseGeocode(lat, lng, apiKey)` hits `maps.googleapis.com/maps/api/geocode/json?latlng=…` and returns the most-specific `formatted_address`. Returns `null` (with a console warning) on API error, missing key, or zero results.
3. [src/App.tsx](src/App.tsx) auto-fill effect — when `location.status === 'available'`, calls `reverseGeocode` for a human-readable label, then `setOrigin((current) => current ?? {point, label})`. The functional setState preserves a user-typed origin if they happened to pick one while geolocation was in flight. If geolocation is denied or unavailable, `origin` stays `null` and the SearchBar's origin field shows its `"Your location"` placeholder per spec.

#### Issue 1 — Route sheet not appearing (diagnostic pass, not a blind fix)

User said: "Add console logs to trace the exact failure point — is it the API call, the response parsing, or the state update that's failing." Honoring that literally. Logs added across the full chain so the next reload prints exactly where the chain breaks:

| Layer | Log |
|---|---|
| `useCurrentLocation` | `Requesting geolocation permission…` / `Geolocation resolved` / `Geolocation failed` |
| `App` auto-fill | `Auto-filling origin from geolocation: …` (post reverse-geocode) |
| `App` state | `origin → …` and `destination → …` on every change |
| `SearchBar` PaE handler | `PaE select fired (Origin\|Destination); type=gmp-select`, then either the resolved `{lng, lat, label}` or a specific warn for missing prediction / missing location / thrown error |
| `App` fetch effect | `Route-fetch effect triggered. {hasOrigin, hasDestination, travelMode}` and `Calling fetchCandidateRoutes: …` |
| `hlciRouter` | (already had) `Routes API direct: N route(s)` / `Detour alternatives: M route(s)` / `After dedup: K unique route(s)` |
| `App` fetch result | `fetchCandidateRoutes returned N candidate(s): …` or `fetchCandidateRoutes threw: …` |
| `App` render | `sheet visibility: {sheetOpen, navigating, routesLoading, candidatesCount, willRender}` on every relevant state change |

What to look for in console when reproducing the bug:
- If `PaE select fired (Destination)` never appears → the web component isn't firing its event (UI / shadow-DOM issue)
- If `destination → …` never appears after the PaE log → the callback chain is broken between SearchBar and App
- If `Route-fetch effect triggered` shows `hasOrigin: false` or `hasDestination: false` → state isn't reaching the fetch effect
- If `Calling fetchCandidateRoutes` appears but `fetchCandidateRoutes returned` / `threw` doesn't → the network call hung
- If `fetchCandidateRoutes threw: …` appears → the API call itself is failing (auth, quota, network)
- If `sheet visibility: willRender: true` but no UI appears → CSS / z-index issue

The auto-fill fix should resolve most "sheet doesn't appear" cases on its own — previously the user-typed origin could collide with the stale Bryant Park default in confusing ways. With null-until-resolved semantics, the state is explicit.

#### Carrying note worth knowing

When geolocation is **denied**, `origin` stays `null` and the route sheet won't open even with a destination set (because `sheetOpen = origin !== null && destination !== null`). The user has to type an origin manually into the origin field. That matches the spec ("leave the field empty with placeholder"), but if you want the sheet to open with a "Set your origin first" empty-state instead, easy follow-up.

#### Build status
- `tsc -b` clean
- `vite build` clean (1343 KB precache)

### 2026-05-31 — Bearing-based scoring + selection-driven polyline + auto-pan

Four interlocking fixes. The biggest one is structural: HLCI scoring no longer depends on the synthetic Midtown facade dataset — it's now computed purely from route geometry vs live weather (sun azimuth/elevation, wind direction/speed, cloud cover).

#### Fix 1 — Selection-driven polyline (`updateTriggers` was missing)

[src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) `PathLayer` for the route now declares `updateTriggers: { getPath: selectedRoute.polyline }`. Without it, deck.gl's layer diffing kept the cached path geometry attached to the layer instance — swapping `selectedRoute` via `setSelectedRouteIdx` gave deck.gl a fresh `[selectedRoute]` data array but the visible polyline didn't re-tesselate. Trigger on the actual polyline reference fixes this.

#### Fixes 2 & 3 — Bearing-based HLCI scoring replaces facade dataset

[src/lib/hlciRouter.ts](src/lib/hlciRouter.ts) — `scoreRouteHlci` + `thermalAtPoint` + `windAtPoint` removed entirely; new `scoreRouteByGeometry` walks each polyline segment and computes:

```
sun_facing  = max(0, cos(segmentBearing − sunAzimuth))
wind_facing = max(0, cos(segmentBearing − windFromDirection))
```

`sun_facing` is 1.0 when walking directly toward the sun (sun in face), 0 when sun is to the side or behind. Then:

- Sun cost = `sun_facing × cos(elevation) × (1 − cloud/100)` — low sun glares hardest, overhead sun doesn't depend on direction, cloud cover collapses solar impact toward zero. Skipped entirely when sun is below horizon.
- Wind cost = `wind_facing × min(1, windSpeedMph / 20)` — calibrated against a 20 mph reference.
- Final per-segment cost = `glareAvoidance × sunCost + windAvoidance × windCost + shadePreference × (1 − sunCost)`.
- Long segments get weighted by `segMeters / 100` so a 500m east-bound stretch outweighs a 50m east-bound stretch when both face the sun the same way.

**This produces meaningfully different scores between routes.** Concrete example at 2pm on 2026-05-31 (sun azimuth ~220°, elevation ~60°):
- East-bound route (bearing 90°): `cos(90 − 220) = cos(−130°) ≈ −0.64` → `max(0, ...) = 0` → no sun penalty
- South-bound route (bearing 180°): `cos(180 − 220) = cos(−40°) ≈ 0.77` → strong sun penalty
- North-bound route (bearing 0°): `cos(0 − 220) = cos(−220°) ≈ −0.77` → no penalty (sun at back)

`scoreAndRankRoutes` signature now takes `sun: SolarPosition` (azimuth + elevation) and `wind: AmbientWind` instead of the `sunDirection` 3-vector and synthetic Venturi computation. Updated the call site in [src/App.tsx](src/App.tsx) accordingly.

#### Deletions

- `src/lib/solar.ts` — `MIDTOWN_FACADES` no longer referenced
- `src/lib/venturi.ts` — `computeVenturi` + `MIDTOWN_STREET_SEGMENTS` no longer referenced

The CLAUDE.md spec's facade/Venturi physics is preserved *in spirit* (scoring still reasons about geometry vs weather) but the implementation no longer depends on those hardcoded buildings or street segments. The 6-facade dataset was never going to scale beyond Midtown anyway; the bearing formula works for any route in any city.

#### Fix 4 — Auto-pan/zoom on origin/destination changes

[src/App.tsx](src/App.tsx) — new effect after the `result` useMemo, deps `[origin, destination, result, navigating]`:

| State | Action |
|---|---|
| `navigating === true` | skipped (handleStartNavigation already moved camera) |
| only origin set | fly to origin at zoom 14 |
| only destination set | fly to destination at zoom 15 |
| both set + routes loaded | fit to best route's polyline (with 20% padding) |

All transitions use `FlyToInterpolator` from `@deck.gl/core` with `transitionDuration: 800`. Two new helpers next to `originCenteredFitView`:

- `fitPolylineView(polyline)` — bbox-centered, zoom fits the full polyline with 20% padding (different from `originCenteredFitView` which centers on origin for the navigation start)
- `pointView(point, zoom)` — center-on-point at fixed zoom

**Won't re-fit on per-card selection** — `result` reference only changes on filter / candidate changes, not on `selectedRouteIdx`. So tapping different route cards updates the visible polyline (via Fix 1) but keeps the camera steady so the user can compare paths.

#### Build status
- `tsc -b` clean
- `vite build` clean (1341 KB precache)

### 2026-05-31 — Forced route alternatives + Start Navigation flow

Two interlocking features. The first one (genuinely-different routes) needed a correction to the user's diagnosis — the second (navigation flow) is new UI.

#### Route alternatives — diagnosis correction worth flagging

User said: "set computeAlternativeRoutes: true in the request body". **It was already set.** The actual root cause of all routes showing the same time/distance is that Routes API returns only 1 route for many queries even with the flag on — particularly short walks, narrow grids, or paths with no obvious alternative. The flag is a hint, not a guarantee.

Fix in [src/lib/hlciRouter.ts](src/lib/hlciRouter.ts):

1. **Direct call first** with `computeAlternativeRoutes: true` (unchanged) — collects whatever Routes API offers.
2. **If fewer than 3 routes returned, fire two parallel detour requests** via `fetchDetourAlternatives()`. Each detour passes a Routes API `intermediates` waypoint that's offset perpendicular to the direct origin→destination path (~300m offset, clamped to 35% of total path length so suburban-scale routes don't get absurd detours). Forcing a waypoint guarantees a different street sequence, and therefore a different HLCI score.
3. **Dedupe** via `routesAreSame()` — two routes are considered duplicates if their distance/duration differ by less than 10% AND their polyline midpoints are within 100m. Catches the case where the API or a detour happens to return the same path the direct call already gave.
4. **Cap at 3** so the route sheet doesn't crowd the screen.
5. Console logs at each stage so the next debugger can see exactly where alternatives are coming from: `[GMA] Routes API direct: N route(s)` / `[GMA] Detour alternatives: M route(s)` / `[GMA] After dedup: K unique route(s)`.

API cost: in the worst case, 3 Routes API requests per destination instead of 1. Acceptable for the demo; production may want to cache or skip the detours when the direct call already returns 2+ routes.

#### Turn-by-turn extraction

Same file — added `RouteStep` interface (`instruction`, `distanceMeters`, `durationSeconds`) and `steps: RouteStep[]` to `CandidateRoute`. Field mask now requests `routes.legs.steps.navigationInstruction`, `…distanceMeters`, `…staticDuration`. `extractSteps()` flattens `legs.flatMap(leg => leg.steps)` so detour routes (which have 2 legs: origin→waypoint, waypoint→destination) get a unified step list. Straight-line fallback synthesizes a single `"Head toward destination"` step so the NavigationPanel never renders blank.

#### Start Navigation flow

New [src/components/NavigationPanel.tsx](src/components/NavigationPanel.tsx) — top-of-screen white card showing first 3 turn-by-turn steps, total time + distance, and a Stop button. First step gets the accent-blue numbered badge to mark it as "next"; subsequent steps use the muted background. Falls back to `"Head toward destination."` if Routes API didn't return steps.

[src/components/RouteSheet.tsx](src/components/RouteSheet.tsx) — added a full-width accent-blue **Start** button at the bottom of the sheet (under the route cards), only enabled when `!isLoading && routes.length > 0`. New `onStartNavigation` prop fires the App-level handler.

[src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) converted from **internal viewState** to **controlled mode**: viewState + onViewStateChange are now props, owned by App. This is what makes external camera moves (the navigation zoom) possible without losing user pan/zoom afterward.

[src/App.tsx](src/App.tsx):
- New state `navigating: boolean` + `viewState: MapViewState`.
- `handleStartNavigation()` computes a viewState via `originCenteredFitView()` and applies it with `transitionDuration: 800` + `FlyToInterpolator` (from `@deck.gl/core`) so the camera animates smoothly instead of snapping.
- During navigation, SearchBar, TransportModeSwitcher, and RouteSheet are unmounted; NavigationPanel takes the top-of-screen slot. MapViewSwitcher stays visible (user can still toggle 2D/3D/Satellite during navigation).
- `handleStopNavigation()` exits navigation mode but does **not** snap the camera back — the user keeps the current view and can manually pan back.

#### `originCenteredFitView()` design decision worth flagging

User spec said "zoom into the selected route polyline" AND "center the view on the origin point". Those two goals conflict — fit-to-bounds centers on polyline midpoint, not origin. I honored "center on origin" literally: the viewState's longitude/latitude = origin, and the zoom is calculated so the **farthest** polyline point is still visible from that origin-centered viewport (with the lat axis normalized by 0.7 to account for mercator squish at NYC latitude). Result: origin sits in the visible area, the full route extends to one side, zoom level lands between 12 and 18 depending on route length.

#### Route polyline color
Already Google Maps blue (`#1A73E8`) from the prior consumer-UI rebuild — confirmed unchanged.

#### Build status
- `tsc -b` clean
- `vite build` clean (1343 KB precache)

### 2026-05-29 — PaE dropdown debugging pass

PlaceAutocompleteElement was loading successfully but predictions weren't appearing when the user typed. I can't see DevTools from here, so this pass is **defensive fixes against the four most likely causes + diagnostic logging** that will pinpoint the exact issue in the console next reload.

#### Fix 1 — Value-sync was clobbering keystrokes (most likely root cause)

[src/components/SearchBar.tsx](src/components/SearchBar.tsx) `PlaceField` had a `useEffect(() => { el.value = value }, [value])` that fired any time the parent re-rendered with a different `value` prop. Concrete failure mode: user starts typing in the **origin** field before `useCurrentLocation` resolves → geolocation resolves → App sets `origin = { ..., label: 'Your location' }` → the effect writes `"Your location"` into the element, **erasing whatever the user had typed mid-stroke**. Places autocomplete never accumulates a query because the value keeps being reset.

Fix: bail out of the value-sync if the element is currently the document's `activeElement` (focus retargets up the shadow tree, so the host element appears as `activeElement` whenever the inner shadow input has focus). Also skips when `el.value === value` to avoid unnecessary writes.

#### Fix 2 — Stacking context conflict

SearchBar wrapper was `z-20`; RouteSheet is `z-30` and MapViewSwitcher is `z-40`. If a user opened the route sheet then re-edited origin, the predictions popover could be painted under those elements depending on whether PaE uses the `popover` HTML API (top layer, immune) or absolute positioning (subject to z-index). Raised SearchBar to **`z-50`** to outrank everything. Also set `overflow: visible` explicitly on the card div as belt-and-suspenders against any future ancestor `overflow: hidden` regression.

#### Fix 3 — Aggressive `::part()` overrides were suppressing the popover

[src/styles/globals.css](src/styles/globals.css) had `::part(prediction-list)` rules setting `overflow: hidden`, `border-radius`, custom `box-shadow`, `margin-top`. PaE's prediction list is sensitive to overflow/layout overrides; on some SDK revisions, `overflow: hidden` on the list container clips the rendered items to a 0-height box that paints nothing. Pulled ALL `::part(prediction-*)` rules — only `::part(input)` and the input-related custom properties remain. The dropdown uses PaE's defaults (which look fine on a white background; the visual styling tradeoff is worth getting predictions back at all).

#### Fix 4 — Defensive `min-height` on the element

Added `min-height: 24px` to `gmp-place-autocomplete` so it can't collapse to 0 height during a render frame. PaE's popover uses anchor-positioning to the host element's bounding rect; a 0-height host produces a popover anchored at the wrong location.

#### Diagnostic logging added

Every time a `PlaceField` mounts, two `setTimeout` probes fire at 100ms and 500ms that log to console:

```js
[GMA] PaE probe @100ms (Origin): {
  tagName: 'gmp-place-autocomplete',
  width: 280,
  height: 24,
  hasShadowRoot: true,
  shadowInput: '<input value="">',
  parentTag: 'div'
}
```

What to look for in the output:
- `width: 0` or `height: 0` → sizing/positioning issue (fix already applied via `min-height`)
- `hasShadowRoot: false` → element didn't initialize (SDK loading problem)
- `shadowInput: null` → shadow DOM exists but no input — fundamental PaE setup issue
- `tagName` other than `gmp-place-autocomplete` → CSS selector won't match; need to update `globals.css`

If after this pass predictions still don't appear, the console output narrows it to one of: a Places API permission/quota issue (no network requests in DevTools Network tab), a different tagName, or shadow DOM not initialized.

#### Build status
- `tsc -b` clean
- `vite build` clean (1335 KB precache)

### 2026-05-29 — Maps loader v=beta + libraries=places eager load

Symptom: `google.maps.places.PlaceAutocompleteElement` was returning `undefined` in the browser even though `loadPlacesLibrary()` resolved and the SearchBar reached the "ready" state — the new Places UI Kit web component isn't exposed on `v=weekly` for our project. Root cause: the new web component requires the **beta** channel.

#### Changes in [src/lib/googleMapsLoader.ts](src/lib/googleMapsLoader.ts)

1. **Script URL**: `&v=weekly&loading=async` → `&v=beta&libraries=places&loading=async`. The `v=beta` flip is the actual fix for PlaceAutocompleteElement; `libraries=places` makes the Places library load eagerly with the bootstrap instead of via dynamic `importLibrary()`.
2. **`loadPlacesLibrary()` simplified**: dropped the `await google.maps.importLibrary('places')` call per spec. Library now arrives with the bootstrap script.
3. **New `waitForPlaceAutocompleteElement()` poll** added between bootstrap-ready and the function returning. `script.onload` only signals that the bootstrap loader downloaded — under `loading=async`, even libraries listed in the URL initialize asynchronously, so we explicitly poll for `PlaceAutocompleteElement` (not just the `places` namespace) with a 5s timeout. The error message on timeout names both URL params so the next debugger sees exactly what to verify.
4. **Removed unused export** `loadMapsCore()` — only consumer was the deleted Phase-3 brain.

#### Expected console output on success

```
[GMA] Maps API key loaded: AIzaSy… (39 chars)
[GMA] Injecting Maps script: https://maps.googleapis.com/maps/api/js?key=***REDACTED***&v=beta&libraries=places&loading=async
[GMA] Maps script onload fired
[GMA] Places library loaded — PlaceAutocompleteElement available (v=beta, libraries=places)
```

#### Diagnostic surface preserved

`window.gm_authFailure` callback, redacted URL log, key-shape validation (`AIza` vs `AQ.`), and the `onMapsAuthFailure` pub/sub all carry over unchanged — none of those are affected by the channel switch.

#### Build status
- `tsc -b` clean
- `vite build` clean (1335 KB precache)

### 2026-05-29 — Consumer-app UI rebuild (Google-Maps pattern, light theme)

Full UI rewrite to a clean white Google-Maps-style navigation app. Physics layer untouched — `useWeatherData`, `useSolarPosition`, `venturi`, and `hlciRouter` continue to score routes silently in the background. The visual overlay system (thermal dots, wind arrows, time scrubber, telemetry readout) is entirely gone.

#### Deliberate spec deviation worth flagging

CLAUDE.md §10 specifies a dark "spatial instrument panel" aesthetic with DM Mono throughout. **This rebuild overrides that** to a light consumer-app palette per the new product direction. The CSS variable structure is preserved (`--gma-bg`, `--gma-surface`, `--gma-text-primary` etc.) so any future revert is a variable-value swap, not a refactor. New values: `--gma-bg: #f1f3f4`, `--gma-surface: #fff`, `--gma-accent: #1a73e8` (Google Maps blue), plus comfort traffic-light variables (`--gma-comfort-good` / `-moderate` / `-harsh`).

#### New / rewritten components

- [src/components/SearchBar.tsx](src/components/SearchBar.tsx) — **two-field card**: "Your location" (origin, defaults to geolocation result with display label) + "Choose destination" (user-typed). Both fields are `PlaceAutocompleteElement` instances mounted into refs by an internal `PlaceField` sub-component. A swap button (vertically centered on the right) exchanges the two `PlacePick` objects in App state. The origin field's `value` is set programmatically from App via the sub-component's value-sync effect — that's how "Your location" shows on first paint and how the labels swap when the swap button is pressed.
- [src/components/TransportModeSwitcher.tsx](src/components/TransportModeSwitcher.tsx) — **NEW** — horizontal pill row of Walk / Bike / Drive / Transit icons (inline Material-style SVGs), sits directly under the SearchBar when a destination is set. Selecting a mode updates App's `travelMode` state and triggers a route refetch.
- [src/components/RouteSheet.tsx](src/components/RouteSheet.tsx) — rewritten as a **white bottom sheet** with: 5 filter pills (Avoid Sun / Avoid Wind / Avoid Both / Sunniest / **No preference** — new), then a vertical list of route cards. Each card shows `N min` (large) + `X.X km · via Y` (secondary) + a comfort badge `● 92% cooler` colored green ≥70%, yellow ≥40%, red below. Selected row gets the accent border + filled radio + tinted background. Drag handle + close button at top.
- [src/components/MapViewSwitcher.tsx](src/components/MapViewSwitcher.tsx) — restyled for white surface, bottom-right corner unchanged.
- [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — **CartoDB Positron** light tiles for 2D mode (replacing Dark Matter), ESRI World Imagery for satellite (unchanged), Google Photorealistic 3D Tiles for 3D mode (unchanged). Selected route renders as a **Google Maps blue** (`#1A73E8`) `PathLayer` at z=2 m with depth test disabled. **No thermal scatter, no wind arrows, no SunReadout, no HLCIBadge** — the layer pipeline is now basemap + route polyline only.
- [src/App.tsx](src/App.tsx) — new state shape: `origin: PlacePick | null`, `destination: PlacePick | null`, `travelMode: TravelMode` (default `'WALK'`), `filterMode: FilterMode` (default `'avoid-sun'` so the comfort-best route is selected by default per spec), `mapView: MapView` (default `'2d'`). Route fetch effect depends on `[origin, destination, travelMode, apiKey]` so a transport-mode change re-fetches.

#### Physics layer additions

- [src/lib/hlciRouter.ts](src/lib/hlciRouter.ts) — new exported `TravelMode = 'WALK' | 'BICYCLE' | 'DRIVE' | 'TRANSIT'` type. `fetchCandidateRoutes()` now takes `travelMode` and passes it straight into the Routes API body. Sort in `scoreAndRankRoutes()` now has a duration tie-breaker: when all weights are 0 ("No preference" filter) every route gets `hlciCost == 0`, and the secondary sort puts time-fastest first.
- [src/components/RouteSheet.tsx](src/components/RouteSheet.tsx) `FILTER_PRESETS` — added `'no-preference'` preset with all-zero weights.

#### Deletions

- `src/components/LayerToggle.tsx` — no overlays left to toggle
- `src/components/HLCIBadge.tsx` — no on-canvas comfort badge in the new UI
- `src/components/TimeScrubber.tsx` — sun is driven by live `new Date()` only
- `src/hooks/useHLCI.ts` — consumed only by the deleted HLCIBadge
- `src/hooks/useSolarHeatmap.ts` — dead since the Phase-2 heatmap visibility fix
- `src/lib/shaders/` (whole directory) — `solar.vert.glsl` + `solar.frag.glsl` are no longer used anywhere
- `src/lib/solar.ts` trimmed to **data only** (`MIDTOWN_FACADES`, `Facade`, `MANHATTAN_BBOX`); the `SolarHeatmapRenderer` class and its shader imports are gone.

#### Carrying notes (worth knowing)

1. **`shadePreference` formula quirk** is still present (when `glareAvoidance == shadePreference > 0` the thermal terms cancel). The new filter presets all set `shadePreference: 0` and use `glareAvoidance` signed (negative for "Sunniest"). A unified signed `thermalAversion` weight is still a future cleanup if you want the cost model simpler.
2. **Comfort badge is relative to the candidate set** — best of the visible 2–3 routes is 100%/green, worst is 0%/red. Under "No preference" all costs are equal so all routes land at 100%/green; that's correct messaging ("no comfort tradeoff between these routes") even if it looks uniform.
3. **PlaceAutocompleteElement styling is intentionally limited** by Google — the `::part(input)` / `::part(prediction-*)` overrides + `--gmp-*` custom properties in [globals.css](src/styles/globals.css) get the input and dropdown close to the palette but not pixel-perfect. Inspect the rendered shadow DOM in DevTools to discover any additional hooks in the current SDK.
4. **Transit alternatives** from Routes API tend to return fewer routes (often 1) than walking; the UI degrades cleanly to a single card.

#### Build status

- `tsc -b` clean
- `vite build` clean (1335 KB precache)

### 2026-05-28 — PlaceAutocompleteElement migration + Weather singleton dedup

Two fixes. The Maps one finally pins down the recurring "This page can't load Google Maps correctly" modal — it wasn't billing, wasn't referrer restrictions, wasn't the legacy/new Places API split as I speculated last turn. The actual cause: **the legacy `google.maps.places.Autocomplete` widget is not issued to API keys created after March 2025**. The diagnostics from last turn would have shown a more specific error, but the root fix is the migration regardless.

#### PlaceAutocompleteElement migration

[src/components/SearchBar.tsx](src/components/SearchBar.tsx) — replaced the classic `Autocomplete` widget (bound to an `<input>` ref) with the **Places UI Kit web component** `google.maps.places.PlaceAutocompleteElement`. Differences worth knowing:

- The component renders its own `<input>` inside a shadow DOM and gets appended to a host container, instead of decorating one of our inputs. The GMA pill chrome (border, search icon, clear button) is now an outer wrapper around the mount point.
- The `place_changed` event is replaced by `gmp-select` (newer SDK) — listening to both `gmp-select` and `gmp-placeselect` for SDK-version safety.
- The selection payload moved from `ac.getPlace()` to `event.placePrediction.toPlace()` + `await place.fetchFields({ fields: ['location', 'displayName', 'formattedAddress'] })`. Field names are camelCase.
- The clear button now sets `element.value = ''` instead of resetting an input ref directly.
- A defensive `'PlaceAutocompleteElement' in places` check fails fast with a clear console error if an older SDK is loaded that doesn't ship the element.

#### Styling — what works and what doesn't

[src/styles/globals.css](src/styles/globals.css) — replaced the `.pac-container` rules (which targeted the legacy widget's body-injected dropdown) with `gmp-place-autocomplete`-scoped overrides:

- `::part(input)` — input background/color/font (works on modern Chromium / Firefox / Safari)
- `::part(prediction-list)` and `::part(prediction-item)` — dropdown chrome
- `--gmp-place-autocomplete-input-*` and `--gmp-place-autocomplete-results-*` custom properties — set on the element root

**Honest caveat:** Google intentionally restricts the styling surface on this web component. The above gets close to the GMA palette but won't be pixel-perfect. Fine-tuning will require inspecting the actual rendered shadow DOM in DevTools to discover any additional `::part()` hooks shipped in the current SDK version. PROGRESS leaves this as a known limitation — not a bug.

#### Weather polling singleton — 4× → 1×

[src/hooks/useWeatherData.ts](src/hooks/useWeatherData.ts) — moved the cache + in-flight Promise + poll timer + subscriber set into **module-scope singletons**. Root cause of the 4× simultaneous fetch on mount: React StrictMode double-mounts each component (×2) AND both `App.tsx` and `GMACanvas.tsx` call `useWeatherData` (×2), so 4 useEffect runs each tried to fetch + setInterval independently.

After the refactor:

- `dedupedFetch()` checks a module-scope `inflightPromise` — N concurrent callers receive the same Promise, network sees 1 request.
- `ensurePolling()` is idempotent — first call starts the shared 10-min `setInterval`, subsequent calls early-return. Only one timer ever runs.
- `subscribers` is a `Set<setSnapshot>` — every hook instance registers its setter, the fetched snapshot fans out to all of them. New subscribers immediately receive the cached value via `useState(cached)` so they don't have to wait for the next poll.
- `maybeStopPolling()` clears the timer only when the subscriber set is empty — handles the legitimate full-unmount case without racing the StrictMode dance.

Result: exactly 1 network request and 1 timer regardless of how many components mount the hook or how many StrictMode dual-mounts fire. Logged `[GMA] Weather polling started (single shared timer)` so the singleton activation is verifiable in DevTools.

#### Build status

- `tsc -b` clean
- `vite build` clean (1334 KB precache)

### 2026-05-28 — Maps loader diagnostics (so the next failure isn't silent)

Last turn's loader rewrite fixed the `callback`/`loading=async` Promise hang, but a different user-side failure surfaced: the classic "This page can't load Google Maps correctly" modal. That modal is fired by `gm_authFailure()` inside Maps JS — without subscribing to that callback the failure was invisible to our code, so the UI just sat on "Loading Places…".

This turn adds **diagnostics**, not a blind code fix, because the root cause is on the GCP-console side and we can't observe it from here. The console now answers "what just got loaded and why did it fail" without browser-side guessing.

#### What changed in [src/lib/googleMapsLoader.ts](src/lib/googleMapsLoader.ts)

1. **`window.gm_authFailure` installed before script injection.** Maps JS calls this when auth fails. Our handler logs a 5-point checklist (Maps JavaScript API enabled? billing? key API restrictions? referrer? `AIza…` shape?) and fans the reason out to subscribers.
2. **Auth-failure pub/sub** — new `onMapsAuthFailure(cb)` export. The last failure is cached and replayed to late subscribers so the UI can't miss it just because it subscribed after the `gm_authFailure` callback fired.
3. **API key shape validation.** A `console.warn` fires immediately if the key doesn't start with `AIza` — catches the common mistake of pasting an AI Studio (`AQ.…`) or Vertex token into `VITE_GOOGLE_MAPS_API_KEY`.
4. **Constructed script URL is logged** before injection, with `key=***REDACTED***` so the value doesn't leak into shared console output. User can see exactly what's hitting Google.
5. **`importLibrary('places')` failure is caught separately** and the error message explicitly calls out the "Places API" (legacy) vs "Places API (New)" enablement split — the `google.maps.places.Autocomplete` widget the SearchBar uses requires the **legacy** API to be enabled. If only "Places API (New)" is enabled in the GCP project, the widget fails with that same generic modal.
6. **Empty-key path** now rejects with a clear message instructing to add the var to `.env` and restart Vite (env vars are only injected at startup, not per-request).

#### What changed in [src/components/SearchBar.tsx](src/components/SearchBar.tsx)

- Subscribes to `onMapsAuthFailure` and surfaces the first line of the reason into the input's placeholder: `"Google Maps authentication failed. Checklist: (see console)"`. The full diagnostic is in DevTools.
- Independent of the `loadPlacesLibrary` catch path so the UI bails out of "Loading Places…" even when the Maps script loaded but then auth-failed at use time.

#### Expected console output (happy path)

```
[GMA] Maps API key loaded: AIzaSy… (39 chars)
[GMA] Injecting Maps script: https://maps.googleapis.com/maps/api/js?key=***REDACTED***&v=weekly&loading=async
[GMA] Maps script onload fired
[GMA] Places library loaded successfully
```

#### Expected console output (auth failure)

```
[GMA] Maps API key loaded: AIzaSy… (39 chars)
[GMA] Injecting Maps script: …
[GMA] Maps script onload fired
[GMA] Google Maps authentication failed. Checklist:
  1. Is "Maps JavaScript API" enabled in the GCP project? (different from Places API)
  2. Is billing enabled on the project? (Maps JS requires it since 2018)
  3. Does the API key allow Maps JavaScript API in its API restrictions?
  4. If using key restrictions, is this origin in the HTTP referrer allowlist?
  5. Is the key the standard Maps Platform format ("AIza…")? AI Studio / Vertex keys ("AQ.…") will not work.
```

#### The Places (legacy) vs Places (New) split — most-likely root cause

User said "Places API is enabled" but didn't specify which. Google has **two separately-enableable products**:

| Product | Used by | SDK surface |
|---|---|---|
| Places API (legacy) | `google.maps.places.Autocomplete` (what SearchBar uses today) | classic widget |
| Places API (New) | `google.maps.places.PlaceAutocompleteElement` | web component |

Enabling only the New one is a frequent mistake — the legacy widget then fails to load with the same modal. If the user's GCP project shows "Places API (New)" enabled but not "Places API", **enabling "Places API"** is the fix. The alternative is migrating SearchBar to `PlaceAutocompleteElement`, which is the modern web component (Phase 5 polish — not done this turn because we don't yet know if it's needed).

#### Build status

- `tsc -b` clean
- `vite build` clean (1333 KB precache; deck.gl bundle-size advisory unchanged)

### 2026-05-28 — Clean nav UI + map view modes + Maps loader fix

Three interlocking fixes. The big shift: thermal + wind overlays go from "always on demo features" to "opt-in via the LayerToggle, only in 3D City mode". The 2D and Satellite modes are clean navigation surfaces.

#### Fix 1 — Google Maps loader

Root cause of the "Loading Places…" hang in [src/lib/googleMapsLoader.ts](src/lib/googleMapsLoader.ts): the old URL combined `&callback=…&loading=async`, which Google's docs explicitly say is unsupported — the callback is silently dropped under `loading=async`, so the loader's Promise never resolved.

Rewritten to the modern **bootstrap + `importLibrary` on demand** pattern:
- URL is now `?key=…&v=weekly&loading=async` — no `callback`, no `libraries=` in URL.
- New `loadPlacesLibrary(apiKey)` calls `google.maps.importLibrary('places')` after the script's `onload` fires.
- Hardened against React StrictMode double-mount and Vite HMR: module-scope Promise cache + `<script id="gma-google-maps-bootstrap">` sentinel + `window.google.maps.importLibrary` runtime probe.
- `script.onerror` now resets the cached Promise so a transient failure can be retried later in the session.

[src/components/SearchBar.tsx](src/components/SearchBar.tsx) — switched to `loadPlacesLibrary`, surfaces a `Places error — see console` placeholder when load fails, and logs the underlying error.

**Carrying note (configuration, not code):** if the GCP API key has HTTP referrer restrictions, the allowlist must include `http://localhost/*` and `http://localhost:5173/*` or the script returns 4xx. That's a GCP console action.

#### Fix 2 — Map view switcher

New [src/components/MapViewSwitcher.tsx](src/components/MapViewSwitcher.tsx) — bottom-right vertical pill stack with three modes: `2d` / `3d` / `satellite`. **Default `2d`**, so the heavy Google Photorealistic 3D Tiles stream only loads when the user opts in.

[src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) accepts a new `mapView: MapView` prop and conditionally renders the basemap:

| Mode | Basemap |
|---|---|
| `2d` | CartoDB Dark Matter via `TileLayer` (`a-d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`, 4-subdomain rotation) — matches the GMA dark palette, no API key required |
| `3d` | Google Photorealistic 3D Tiles via `Tile3DLayer` (unchanged) |
| `satellite` | ESRI World Imagery via `TileLayer` (`server.arcgisonline.com/.../World_Imagery/MapServer/tile/{z}/{y}/{x}`) — no API key required |

**Decision worth flagging:** chose ESRI over Google satellite tiles because Google's satellite either needs the full Maps JavaScript widget (heavy, conflicts with deck.gl ownership of the canvas) or the paid Static Tiles API. ESRI World Imagery is free for non-commercial use; a production deployment would want to swap to a paid satellite source and add a visible attribution badge.

#### Fix 3 — Clean nav UI

Removed from the visual UI: thermal `ScatterplotLayer`, wind `PathLayer`, `TimeScrubber`, the SunReadout telemetry box, and the HLCIBadge. The solar position calculation, weather poll, Venturi computation, and per-route HLCI scoring all **still run in the background** so the comfort-routing math keeps working — just nothing is painted over the basemap by default.

Sun direction now driven by **live wall-clock time** via `new Date()` on a 10-minute refresh interval (matches the weather poll cadence), since the TimeScrubber is gone.

[src/components/LayerToggle.tsx](src/components/LayerToggle.tsx) — added a fourth `'none'` mode (default in [src/App.tsx](src/App.tsx)) so 3D City mode opens clean and the user opts in to thermal/wind overlays via the toggle. The toggle is only mounted when `mapView === '3d' && !sheetOpen` — the only context where the overlays it controls are visible. In 2D and Satellite, the toggle stays hidden because the overlays render nothing regardless of mode.

Resulting visible chrome:
- **Always:** SearchBar (top), MapViewSwitcher (bottom-right)
- **When destination set:** RouteSheet (bottom)
- **Only in 3D City mode (and sheet closed):** LayerToggle (bottom-center)

#### Build status
- `tsc -b` clean (3 `TS2774 always-true` errors fixed by switching `importLibrary` existence check from optional-chain to `typeof === 'function'` — `@types/google.maps` declares the method as non-optional so the chain was being narrowed away at compile time)
- `vite build` clean (1331 KB precache; deck.gl bundle-size advisory unchanged)

### 2026-05-28 — Google-Maps-pattern UI rewrite (supersedes Phase 3 brain)

Full UI redesign to match the Google Maps interaction model while keeping GMA's visual identity (dark surface, DM Mono, existing CSS variables). The Gemini natural-language input pipeline is **superseded** by a structured search + filter pattern.

#### New components

- [src/components/SearchBar.tsx](src/components/SearchBar.tsx) — top-of-screen rounded search field driven by Maps JavaScript API **Places Autocomplete widget**. Bound to a Manhattan bbox (lng −74.02 to −73.93, lat 40.70 to 40.80) via `LatLngBounds`, with `strictBounds: false` so out-of-bbox places still appear but rank lower. The widget's `.pac-container` dropdown is themed in [src/styles/globals.css](src/styles/globals.css) with the GMA dark palette and DM Mono. Loader is inline ([src/lib/googleMapsLoader.ts](src/lib/googleMapsLoader.ts)) — singleton Promise that survives StrictMode double-mount — so no `@googlemaps/js-api-loader` dep.
- [src/components/RouteSheet.tsx](src/components/RouteSheet.tsx) — bottom sheet with **4 comfort filter pills** (Avoid sun / Avoid wind / Avoid both / Sunniest) above a ranked list of route options. Each row shows label, "N min · X km", and a comfort percentage with a filter-specific verb ("cooler" / "calmer" / "more comfortable" / "sunnier"). Tapping a pill re-ranks. Tapping a row swaps the polyline drawn on the map. ARIA `dialog` role; safe-area inset bottom padding.
- [src/hooks/useCurrentLocation.ts](src/hooks/useCurrentLocation.ts) — geolocation with a **Manhattan bbox guard**. A laptop in another city would otherwise route from the developer's living room to NYC — the guard keeps the fallback default for off-bbox positions.
- [src/lib/googleMapsLoader.ts](src/lib/googleMapsLoader.ts) — 20-line singleton script loader. Caches the in-flight Promise. Clears on script error so a retry can happen later in the session.

#### Refactored core

- [src/lib/hlciRouter.ts](src/lib/hlciRouter.ts) — **split into `fetchCandidateRoutes()` and `scoreAndRankRoutes()`**. Fetch hits Routes API once (`computeAlternativeRoutes: true`, requests `routes.description` for "via X" labels). Score is pure / local so filter pill taps re-rank instantly without burning quota. `HlciWeights` type moved here. New `routeComfortPercent()` helper: best-of-set is 100%, worst is 0% — filter-agnostic, works for the signed "Sunniest" preset too. New `ScoredRoute` interface with `label`, `isFastest`, and `description` fields.
- [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — `routeResult` prop renamed to `selectedRoute: ScoredRoute | null`. Polyline still amber at z=400 m with depth test disabled (Phase 2 fix).
- [src/App.tsx](src/App.tsx) — fully rewritten. State now: `destination`, `candidates` (cached), `filterMode`, `selectedRouteIdx`. `result = useMemo(scoreAndRankRoutes(...))` recomputes on filter / sun / weather changes. `LayerToggle` and `TimeScrubber` are conditionally rendered only when no destination is set so they don't collide with the bottom sheet. Sheet auto-closes when the search bar is cleared.
- [tsconfig.app.json](tsconfig.app.json) — added `"google.maps"` to the `types` array so the new typings compile.
- [src/styles/globals.css](src/styles/globals.css) — `.pac-container` and `.pac-item` rules to dark-theme the Places dropdown. The "powered by Google" footer is left untouched (Maps Platform Terms require visible Places attribution).

#### Filter pill presets (worth knowing)

```ts
'avoid-sun':  { glareAvoidance:  1.0, windAvoidance: 0.0, shadePreference: 0.0 },
'avoid-wind': { glareAvoidance:  0.0, windAvoidance: 1.0, shadePreference: 0.0 },
'avoid-both': { glareAvoidance:  0.8, windAvoidance: 0.8, shadePreference: 0.0 },
sunniest:     { glareAvoidance: -1.0, windAvoidance: 0.0, shadePreference: 0.0 },
```

"Sunniest" uses a **negative** `glareAvoidance` so the same scorer rewards sunny segments (lower cost = better). `shadePreference` is left at 0 in all presets — see formula-quirk note below.

#### `shadePreference` formula quirk (carried forward, not fixed)

The existing scorer is `glare*thermal + wind*windCost + shade*(1-thermal)`. When `glare == shade > 0` the thermal terms cancel into a constant — the optimizer can't distinguish sunny from shaded. The new pill presets sidestep this by always setting `shadePreference: 0` and using `glareAvoidance` *signed*. The Gemini system prompt that used `shadePreference` is now removed (a2uiClient deleted), so the field is effectively dead but kept in `HlciWeights` for type-stability. A cleaner formula (single signed `thermalAversion` weight) is a Phase 5 polish item.

#### Deleted (Phase 3 superseded)

- `src/components/ConversationBar.tsx`
- `src/components/RouteCard.tsx`
- `src/lib/a2uiClient.ts` (Gemini brain)
- `src/lib/mcpClient.ts` (geocoding — Places Autocomplete now returns lat/lng directly)

The conversational comfort-routing flow ("I'm walking in a suit" → Gemini → HLCI weights → route) is gone. New flow: search destination → see ranked routes → tap a filter pill to reorder. Phase 3 documented in PROGRESS is preserved for history.

### Build status

- `tsc -b` clean
- `vite build` clean (1227 KB precache; deck.gl bundle-size advisory unchanged)

### 2026-05-28 — Cloud-modulation coherence fix (router ↔ visual)

Closes the scoping note from the previous turn's weather integration. Now both the visual thermal dots AND the router/badge math attenuate by cloud cover, so an overcast day stops the router from steering around "glare" zones that visually show no glare.

#### Cascade

- [src/lib/hlciRouter.ts](src/lib/hlciRouter.ts):
  - `thermalAtPoint(point, sunDirection, cloudCoverPct)` — new third arg; multiplies the accumulated facade contribution by `Math.max(0, 1 - cloudCoverPct/100)`. Early-out returns 0 when overcast.
  - `scoreRouteHlci(..., cloudCoverPct)` — threads the value into every per-sample `thermalAtPoint` call.
  - `computeComfortRoute(..., cloudCoverPct, apiKey)` — new positional arg before `apiKey`.
- [src/hooks/useHLCI.ts](src/hooks/useHLCI.ts) — `useHLCI(..., cloudCoverPct)` adds the same arg, passes it through to `thermalAtPoint`, and includes it in the memo deps so the badge recomputes when cloud cover changes.
- [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — call site passes `weather?.cloudCoverPct ?? 100` to `useHLCI`.
- [src/App.tsx](src/App.tsx) — call site passes `live?.cloudCoverPct ?? 100` to `computeComfortRoute`.

#### Default-when-null choice

When `weather === null` (haven't fetched yet), both call sites pass `100` (treat as overcast). Rationale: the visual `ScatterplotLayer` already hides entirely when weather is null, so router+badge resolving to "no thermal penalty" matches the visual state — both report "no thermal effect right now". The previous turn's choice to *not* render visual thermal until weather loads is what set this convention.

#### Coherence verified

Same `(1 - cloudCoverPct/100)` modulation now applied in three places:
1. [GMACanvas.tsx](src/components/GMACanvas.tsx) `facadeThermal()` — visual dots
2. [hlciRouter.ts](src/lib/hlciRouter.ts) `thermalAtPoint()` — router cost
3. [useHLCI.ts](src/hooks/useHLCI.ts) (transitively) — badge score

100% cloud → all three collapse to 0 thermal. 0% cloud → all three at full intensity. Linear in between.

### Build status
- `tsc -b` clean
- `vite build` clean

### 2026-05-28 — Live weather data integration (no more synthetic fallback)

User mandate: the app must be driven by live Google Weather API data, not the synthetic "NW 12 mph / clear sky" placeholder that shipped in Phase 2.

#### useWeatherData hook (new)
- [src/hooks/useWeatherData.ts](src/hooks/useWeatherData.ts) — single source of truth. Polls `weather.googleapis.com/v1/currentConditions:lookup` for NYC every 10 min and returns `WeatherSnapshot | null` with `{ windSpeedMph, windDirectionDeg, cloudCoverPct, temperatureF, fetchedAt }`. **No synthetic fallback** — returns `null` until the first successful fetch, retains the last good value on subsequent failures. Logs the raw JSON response to console every poll so live data is verifiable in DevTools.
- [src/hooks/useWindData.ts](src/hooks/useWindData.ts) **deleted** — fully superseded.
- **Live API verified** during this turn for NYC (40.758, -73.9855): `temperature=18.4°C`, `wind={direction:328°/NNW, speed:13 km/h, gust:26 km/h}`, `cloudCover=7%`. Real, current, not stubbed.

#### Cloud-modulated thermal layer
- [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — `facadeThermal()` now multiplies the per-facade scalar by `(1 - cloudCoverPct/100)`. With today's 7% cloud, dots render at ~93% intensity (mostly red); at 100% overcast the dots collapse to cool blue (`thermalColor(0)` = `#3b82f6`). Sun angle still comes from the time scrubber as before. Thermal layer also skips rendering entirely until weather has loaded — no flash of synthetic-default thermal.
- **Scoping note (worth knowing):** I scoped cloud modulation to the visual `ScatterplotLayer` only. `thermalAtPoint` in [src/lib/hlciRouter.ts](src/lib/hlciRouter.ts) and the HLCI score in [src/hooks/useHLCI.ts](src/hooks/useHLCI.ts) still compute thermal without cloud modulation, which creates a visual/routing incoherence on cloudy days (route avoidance of "hot" zones that visually show no glare). A coherent fix is one more pass through three signatures — flag it and I'll cascade.

#### Live wind feeding Venturi + arrows
- [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — `computeVenturi()` is fed `weather.windDirectionDeg` / `weather.windSpeedMph` directly. Wind `PathLayer` only mounts when weather is non-null. `SunReadout` shows the live wind values plus temperature and cloud%, with "awaiting live data…" placeholder while loading. The "[source: fallback]" badge is gone (no fallback anymore).
- [src/App.tsx](src/App.tsx) — same swap on the routing side: `computeComfortRoute()` receives the live wind via `weatherRef.current`. If weather isn't loaded yet at send time, ambient wind passes as `{ directionDeg: 0, speedMph: 0 }` so Venturi penalties drop out — better than blocking the send button.

#### Gemini model fix (`gemini-2.0-flash` → `gemini-2.5-flash`)
- User requested `gemini-1.5-flash`. **That model is retired** — v1beta `:generateContent` returns `404 NOT_FOUND` for it. Listed available models via `ListModels` and asked which working ID to use; user picked `gemini-2.5-flash`.
- [src/lib/a2uiClient.ts](src/lib/a2uiClient.ts) `GEMINI_MODEL` set to `'gemini-2.5-flash'`.
- **Carrying issue (project, not code):** every Gemini model on this project now returns `429 RESOURCE_EXHAUSTED — "Your prepayment credits are depleted"`. Tested live with both `gemini-1.5-flash` (404 model) and `gemini-2.5-flash` (429 billing). The billing is a console action at [ai.studio/projects](https://ai.studio/projects) — no code change can fix it. Until topped up, the agent falls back to `DEFAULT_INTENT` per the designed degrade path.

### Build status
- `tsc -b` clean
- `vite build` clean

### 2026-05-28 — Gemini model fix (`gemini-2.0-pro` → `gemini-2.0-flash`)

[src/lib/a2uiClient.ts](src/lib/a2uiClient.ts) constant `GEMINI_MODEL` was `gemini-2.0-pro`, which isn't a valid Generative Language API model ID — every call 404'd. Changed to `gemini-2.0-flash`. Verified live by POSTing the real system instructions + response schema + the prompt *"I'm walking to a meeting in a suit"* to the API; got a `429 RESOURCE_EXHAUSTED` whose quota dimensions explicitly name `gemini-2.0-flash` (so the model is recognized — a 404 would have failed at the route, not the quota check). `tsc -b` + `vite build` clean.

**Carrying issue (project, not code):** the 429 reports `limit: 0` on both per-minute and per-day free-tier metrics for this Google Cloud project. The Gemini API is *enabled* on the project (auth succeeds) but has *no usable quota* until billing is enabled. Until then, `agent.sendComfortPrompt()` will always throw and the comfort agent falls back to `DEFAULT_INTENT` (which is the designed degrade path — routes still compute with neutral HLCI weights). This is a console setting on the user's GCP project, not a code change.

### 2026-05-28 — Heatmap + wind visibility fix

Both physics overlays were geometrically correct but invisible from any tilted camera angle because the 3D tile mesh occluded them. Fixed in [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx):

1. **Thermal heatmap** — replaced `BitmapLayer` (and the offscreen-canvas pipeline that fed it) with a `ScatterplotLayer` rendered at **z = 300 m** over the `MIDTOWN_FACADES` coordinates. `radiusMinPixels: 80`, `opacity: 0.6`, color computed per facade from `max(0, -I · N) × reflectivity` mapped through the same cool-blue → white → thermal-red gradient as `solar.frag.glsl`. Depth test disabled so even towers above 300 m (BoA Tower at 366 m, One Vanderbilt at 427 m) don't occlude their own dot. Dots animate as the time scrubber moves the sun. Skips when sun is below the horizon (`elevationDeg ≤ 1`).
2. **Wind arrows** — raised `WIND_ARROW_ALTITUDE_M` from 5 m to **400 m** so the path geometry sits above all but the tallest Midtown rooftops. The existing `depthCompare: 'always'` on the `PathLayer` already kept them un-occluded, but the elevation makes them visually float above the city instead of being projected into the streetscape.

**Trade-off:** the `SolarHeatmapRenderer` + offscreen WebGL2 framebuffer pipeline in [src/lib/solar.ts](src/lib/solar.ts), the `useSolarHeatmap` hook, and the GLSL shaders in [src/lib/shaders/](src/lib/shaders/) are still present and exported but no longer wired into the canvas. They're kept as the spec-accurate reference and a Phase 3+ path (real geometry-coupled reflections projected onto sidewalks). The current scatter-dot approach loses the "reflected beam hits the ground at point X" spatial truth but recovers visibility, which was Phase 2's actual blocker.

Build: `tsc -b` clean, `vite build` clean.

### 2026-06-01 — Full visual + data rebuild (light theme, realistic sun viz)

End-to-end rebuild aimed at replacing the dark sci-fi look with a Google-Maps-style light surface that actually visualizes the sun on the map (not just on the route). No dark mode anywhere. **`tsc -b` and `vite build` both clean** at the end of the pass.

**Data layer**

- **Unified Overpass fetcher** ([src/lib/overpass.ts](src/lib/overpass.ts)) — one round trip per bbox returns four categories in a single response:
  - `way[highway~"primary|secondary|tertiary|residential"][name]` → `StreetWay[]` (centerlines as `[lng, lat]` paths)
  - `node[natural=tree]` → `TreeNode[]`
  - `way[building]` → `Building[]` with `height` parsed from `tags.height` or `tags['building:levels'] × 3.5` (default 10 m)
  - `way[landuse=forest]` + `way[natural=wood]` → `GreenArea[]` polygons
  - Module-scope cache keyed by 3-decimal-rounded bbox so small pans share a key and skip the network. All failures (timeout, 4xx, 429) degrade to empty arrays — the app keeps working.
- **New hook** [src/hooks/useOverpassData.ts](src/hooks/useOverpassData.ts) — drop-in replacement for the deleted `useStreetTrees`. Returns the four categories together. Old `useStreetTrees.ts` removed.
- **Viewport bbox** is now derived live from `viewState` in [src/App.tsx](src/App.tsx): pad scales inversely with zoom (clamped to `[0.004°, 0.025°]`), center rounded to 3 decimals so panning around the same block doesn't re-fetch Overpass.

**Sun visualization on streets** ([src/lib/streetSunColoring.ts](src/lib/streetSunColoring.ts))

- For every viewport street segment, classify by `cos(bearing − sunAzimuth) > 0` → sunny (amber `rgba(255, 180, 0, 0.35)`) else shaded (cool blue `rgba(100, 140, 200, 0.20)`). Cloud cover dims the amber alpha proportionally; sun below horizon or fully overcast → everything collapses to blue.
- Rendered via `PathLayer` in [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) with `depthCompare: 'always'` so the colored stripes ride above the Positron raster.

**Building shadow projection** ([src/lib/buildingShadows.ts](src/lib/buildingShadows.ts))

- `projectShadows(buildings, sunAzimuth, sunElevation)` — translates each footprint by `height / tan(elevation)` meters (capped at 100 m) in the opposite direction of `sunAzimuth`. Converts meters → degrees at NYC latitude (`111 000 m/° lat`, `84 500 m/° lng`). Returns empty when sun ≤ 5° elevation.
- Rendered as `PolygonLayer` with `rgba(0, 0, 20, 0.25)` fill, no stroke.
- Exports a `pointInPolygon` ray-cast helper consumed by the route coloring path. Acknowledged simplification: we render only the displaced footprint, not the convex hull of `footprint ∪ displaced_footprint` — the connecting silhouette is missing. Good enough as a "is this segment in shadow" signal; documented in code.

**Route segment coloring** ([src/lib/routeColoring.ts](src/lib/routeColoring.ts))

- New signature: `colorizeRoute(polyline, mode, sunAzimuth, windFromDeg, trees, buildingShadows)`. Removed the old `(sunElevation, cloudCover, warmRGB)` params.
- Sun-mode priority per segment midpoint:
  1. In any building shadow polygon → `rgb(40, 60, 140)` deep blue
  2. Tree within 15 m (bbox prefilter + haversine fallback) → `rgb(30, 130, 60)` green
  3. `cos(bearing − sunAzimuth) > 0` → `rgb(255, 160, 0)` amber
  4. Else → `rgb(240, 240, 245)` white
  - All at alpha 235, 6 px width. Wind mode keeps headwind purple / tailwind green from the previous build.

**Trees + forests overlays**

- `ScatterplotLayer` at 8 m radius, `rgba(30, 100, 50, 0.6)` — exact spec color.
- `PolygonLayer` for forest/wood areas with translucent green fill + thin green outline (Central Park reads as a green block at midtown zoom).

**Light UI redesign — every component rewritten**

Flipped every glassmorphism + `text-white` to dark-on-white. CSS-variable tokens already point at the light palette; per-component changes were the inline `color: '#ffffff'` and `text-white*` classes:

- [SearchBar.tsx](src/components/SearchBar.tsx) — white card with `var(--gma-shadow-lg)`. Input bg is `rgba(0,0,0,0.03)` with `var(--gma-border)` stroke; suggestion dropdown is white with light grey dividers.
- [RouteSheet.tsx](src/components/RouteSheet.tsx) — white bottom sheet, filter pills: inactive = light grey + secondary text; active = live `dayColor` for sun-accent pills (`avoid-sun`, `avoid-both`, `sunniest`), `var(--gma-accent-wind)` blue for `avoid-wind`, neutral grey for `no-preference`. RouteCard: selected card gets a `dayColor` ring + inset shadow + faint amber tint. Comfort badge sits on a subtle grey pill instead of dark glass.
- [TransportModeSwitcher.tsx](src/components/TransportModeSwitcher.tsx), [TimePicker.tsx](src/components/TimePicker.tsx) — white pill rows; active pill fills with `dayColor`, white icon/text.
- [MapViewSwitcher.tsx](src/components/MapViewSwitcher.tsx) — white card on bottom-right, active option has light grey fill instead of white-on-grey reversed contrast.
- [NavigationPanel.tsx](src/components/NavigationPanel.tsx) — white card, dark instructions, secondary distance text uses DM Mono via `var(--font-data)`. Step 1 number-circle gets the live `dayColor`.
- [SunCompass.tsx](src/components/SunCompass.tsx) — white card, dark labels, accent-colored sun arrow with `feGaussianBlur` glow, accent-soft elevation arc, DM Mono time + phase line.
- [SunGlow.tsx](src/components/SunGlow.tsx) — `mix-blend-mode: multiply` (was `screen` on dark) so the lit side gets a subtle warm tint without blowing out the light basemap. Hidden below horizon.

**Light basemap**

- [GMACanvas.tsx](src/components/GMACanvas.tsx) 2D tiles changed from CartoDB Dark Matter to **CartoDB Positron** (the four-subdomain `light_all` raster). 3D and Satellite modes unchanged. Route polyline keeps a single white halo under the comfort overlay so the colored segments read against the busy street + shadow overlays.

**Astronomical color system on the light theme**

- `daylight.color` interpolation is unchanged; the same `RGB` value now drives active-pill fills + sun arrow + sun-glow tint on the light surface. `NIGHT_FALLBACK_COLOR` shifted from `[26, 26, 46]` (almost-black) to `[85, 120, 180]` (cool slate-blue) so accent pills at night still have legible white-on-color contrast.

**Address fix**

- [src/lib/geocoding.ts](src/lib/geocoding.ts) — `reverseGeocode` now tries Google Geocoding first (`tryGoogleGeocode`) and falls back to **Nominatim** (`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18`) when Google returns null or is misconfigured on the GCP project. Returns `display_name`. Origin auto-fill now gets a real "123 Main St, Manhattan, NY" string instead of a `40.7580°, -73.9855°` raw-coord fallback when the user's GCP Geocoding key isn't enabled.

**Backend Solar API proxy**

- New [server/index.js](server/index.js) — Express 5 proxy with permissive CORS. Endpoints: `GET /health` returns `{ok, hasKey}`; `GET /api/solar?lat=…&lng=…` proxies to `https://solar.googleapis.com/v1/buildingInsights:findClosest` using the server-side `VITE_GOOGLE_MAPS_API_KEY`. Default port 3001, override via `SOLAR_PROXY_PORT`.
- [package.json](package.json) — added `"start:server": "node server/index.js"` plus `express ^5.2.1` + `dotenv ^17.4.2` deps.
- [vite.config.ts](vite.config.ts) — added `server.proxy['/api'] → http://localhost:3001`, so the frontend can just `fetch('/api/solar?…')`.

**Data attribution**

- New [src/components/DataAttribution.tsx](src/components/DataAttribution.tsx) — bottom-centered pill, translucent white with `backdrop-filter: blur`, DM Mono, secondary-grey text: "Sun data: Google Solar API · Trees: OpenStreetMap · Updated live". `pointer-events-none`.

**Files deleted**

- `src/hooks/useStreetTrees.ts` — superseded by `useOverpassData` which returns trees alongside streets/buildings/forests in the unified fetcher.

**Build**

- `tsc -b` clean
- `vite build` clean (1412 modules, ~1.38 MB main chunk, 15.4 s — same bundle-size advisory deck.gl always produces)

### 2026-06-01 — Two visibility fixes: full route polyline + Overpass diagnostics

Both addressed after the light rebuild. `tsc -b` + `vite build` clean.

**Fix 1: full route polyline rendering**

- Symptom: only a short stub of the selected route appeared on the map.
- Root cause: [src/App.tsx](src/App.tsx) `useEffect` that drives the auto-fly fitted the map to `result.routes[0]` (the highest-scored alternative under the active filter), not to `selectedRoute`. Picking the 2nd or 3rd alternative left most of its polyline outside the viewport — which read as "tiny segment" even though deck.gl was drawing the full path.
- Fixes:
  - Auto-fit now uses `selectedRoute.polyline` directly, and depends on `selectedRoute?.polyline` so it re-fits whenever the user taps a different route card.
  - [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) halo `PathLayer` rewritten from `data: [selectedRoute]` with closure-captured `fullPath` to `data: [{ path: fullPath }]` with `getPath: (d) => d.path`. Eliminates any closure-staleness risk and makes deck.gl's update diffing unambiguous. Halo width bumped 9→10 px / min 7→8; comfort overlay 6→7 / min 5→6 so the colored route reads clearly over the new street-sun overlay.
  - Added defensive guard `selectedRoute.polyline.length >= 2` before building the halo (a 1-point polyline would have been a degenerate render).
- Diagnostic: App now logs `[GMA] Selected route polyline:` with `points / first / mid / last / distanceM / durationS` whenever the selection changes — a real walking route reports 50–200 points, a fallback straight-line reports 2.
- GMACanvas now logs `[GMA] Route halo polyline:` with point count + first/last coords each layer rebuild.

**Fix 2: street sun overlay visibility + Overpass diagnostics**

- Symptom: streets in the viewport weren't showing the amber/blue sun-vs-shaded overlay.
- The fetch itself was probably succeeding (it does log counts), but two things were obscuring the result on a light basemap:
  1. Spec alphas (`0.35` amber, `0.20` blue) read fine on the previous dark base but disappeared on Positron's near-white tiles.
  2. The 4 px stripe was too thin to be obvious against Positron's grey-on-white road network.
- Fixes in [src/lib/streetSunColoring.ts](src/lib/streetSunColoring.ts):
  - Amber alpha 89 → 140 (`0.55`); shade alpha 51 → 89 (`0.35`). Documented the deviation from the original spec values in code.
- Fixes in [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx):
  - Street-sun layer `getWidth` 4 → 6, `widthMinPixels` 3 → 5.
- Diagnostic upgrade in [src/lib/overpass.ts](src/lib/overpass.ts):
  - Pre-fetch log now reports `{ url, bbox, bboxKey, querySize }`.
  - Post-fetch log includes elapsed milliseconds + raw element count.
  - HTTP-error path logs `status / statusText` and the first 400 chars of the response body.
  - Network-error path catches the throw and logs `(likely CORS, network, or DNS)`.
  - When streets specifically come back empty (Overpass returned 200 OK but with no `way[highway~…]` matches — common cause: rate limit, oversize query, bbox over water), a one-line warn explains: "Street sun overlay will be hidden; route polyline still receives per-segment coloring."
- Per-segment route polyline coloring already works without any Overpass data — `colorizeRoute` falls through to amber-vs-white classification based on `cos(segmentBearing − sunAzimuth)` when `buildingShadows` and `trees` are empty. So even if Overpass is dead, the SELECTED route renders amber on sun-facing legs and white on others. Confirmed in code at [src/lib/routeColoring.ts](src/lib/routeColoring.ts) — the `if (buildingShadows && isInAnyShadow…)` / `else if (trees && hasTreeWithin…)` branches short-circuit on empty arrays.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.38 MB main chunk, ~13 s, same deck.gl bundle-size advisory)

### 2026-06-01 — Comfort scores derived from the same data as the visual

The visible street overlay and the route comfort score were previously two different calculations against the same trig — they tended to disagree on the margin ("this route runs through golden streets but reads 70% cooler"). Now there is one source of truth: a continuous per-segment exposure value. The renderer reads its color from it, and the route scorer samples it. Same numbers on both sides.

`tsc -b` and `vite build` clean.

**One source of truth: `StreetSegmentExposure`**

[src/lib/streetSunColoring.ts](src/lib/streetSunColoring.ts) reshaped:

- Each Overpass street segment now carries a continuous `exposure ∈ [0, 1]`: `max(0, cos(bearing − sunAzimuth)) × sunIntensity` where `sunIntensity = sunAboveHorizon × (1 − cloudCover/100)`.
- `colorForExposure(exposure)` derives the render color from that value — blue when exposure ≤ 0.1, amber otherwise with alpha scaling linearly from `0.35` (at threshold) to `0.55` (at exposure = 1.0). Higher exposure → more saturated amber. The visual is now a direct readout of the exposure value, not a binary cos-sign.
- New `buildStreetIndex(segments)` constructs a `StreetExposureIndex` — a grid hash (cell ≈ 100 m at NYC latitude) keying `lngBucket|latBucket` → segment-index array.
- New `nearestStreetSegment(index, lng, lat, maxRadiusM)` walks expanding cell rings from the query point. Early-out as soon as we have a hit and have searched the immediate neighborhood (no further-out cell can beat a closer match).

**Route sampler: `routeExposureScoring.ts`**

New file [src/lib/routeExposureScoring.ts](src/lib/routeExposureScoring.ts).

`sampleRouteExposure(polyline, index, sunAzimuth, sunElevation, cloudPct)` returns:

- `meanExposure` — length-weighted average across the route (a long straight east-facing stretch outweighs a 20 m kink onto a side street)
- `matches[]` — per-route-segment `{ routeSegIdx, routeSegMid, matchedExposure, matchedDistanceM, fallbackExposure, exposure, lengthM }`
- `matchedCount` + `fallbackCount` so the UI / console can show coverage

For each consecutive `[a, b]` pair in the route polyline:

1. Compute midpoint + bearing + length.
2. Query the street index at the midpoint with `MATCH_RADIUS_M = 40`. On a hit, inherit `segment.exposure` directly.
3. On miss, compute exposure from the route segment's own bearing using the **same** formula `max(0, cos(bearing − sunAzimuth)) × sunIntensity`. Values on the same scale, so mean exposure is meaningful even if no streets are in range.

Falling back rather than skipping is deliberate: every route gets a comparable `meanExposure` even when Overpass is rate-limited or the viewport is over water.

**Wiring through `hlciRouter.ts`**

- New `ScoredRoute.meanSunExposure: number | null` (null only for degenerate < 2-point polylines).
- `scoreAndRankRoutes(..., streetExposureIndex?)` — new last param. When the index has segments, each route's `meanSunExposure` is sampled from it; the sun cost in `hlciCost` becomes `weights.glareAvoidance × meanSunExposure`. The wind cost is still bearing-based per route segment — `meanWindCost(polyline, wind)` length-weights `max(0, cos(bearing − windFromDeg)) × windIntensity` — because there's no wind exposure map (real wind is too dynamic to index).
- Dead code removed: the old `scoreRouteByGeometry` (chunk-sampled bearing scorer) and the `SAMPLE_INTERVAL_M = 100` constant. Both were the previous-generation scorer, no longer reachable.
- Per-route console log on every score pass:
  ```
  [GMA] Route 0 (via 6th Ave) exposure sample {
    polylinePts: 87, segmentsScored: 86, meanExposure: 0.412,
    matchedFromOSM: 71, bearingFallback: 15, coverage: '83% matched',
    firstSamples: [{seg: 0, lenM: 38, matched: true, distM: 12, exposure: 0.512}, …]
  }
  ```
  Eight-sample preview per route so the user can spot-check exposure values against the visible street colors.

**Exposure-derived absolute comfort %**

[src/lib/hlciRouter.ts](src/lib/hlciRouter.ts) `routeComfortPercent` now takes a `SunComfortDirection`:

- `'cooler'` → `(1 − meanSunExposure) × 100` — a route through all-blue streets scores 100%, all-golden scores 0%.
- `'sunnier'` → `meanSunExposure × 100`.
- `null` (wind / no-preference) → previous candidate-relative normalize.

[src/components/RouteSheet.tsx](src/components/RouteSheet.tsx) maps the active filter pill to a `SunComfortDirection` via `filterToSunDirection`:

- `avoid-sun` / `avoid-both` → `'cooler'`
- `sunniest` → `'sunnier'`
- `avoid-wind` / `no-preference` → `null`

Sun-related filters now display an **absolute** comfort %, not a candidate-relative one. Two routes with identical exposure read the same number — useful for "is this route any better than the other in absolute terms?" instead of just "is this the best of these three?".

**App wiring**

[src/App.tsx](src/App.tsx):

- New memos: `streetExposures = colorizeStreets(...)` (renamed from `coloredStreets`), then `streetIndex = buildStreetIndex(streetExposures)`.
- `scoreAndRankRoutes` receives `streetIndex` as the sixth argument. Re-order: `result` is computed AFTER `streetIndex` (TS catches this — would otherwise be use-before-init).
- `selectedRoute` polyline diagnostic now also logs `meanSunExposure` so it's visible alongside point count + distance.

[src/components/GMACanvas.tsx](src/components/GMACanvas.tsx):

- Prop renamed `coloredStreets` → `streetExposures`. The renderer just reads `.path` and `.color` per segment as before — the underlying values are now derived from `.exposure`.
- Type rename `ColoredStreet` → `StreetSegmentExposure` everywhere.

**Verifying consistency in the console**

With the app running, expand a route in the sheet and watch DevTools:

1. The `[GMA] Route N … exposure sample` block reports `meanExposure: X.XXX` and 8 sample segments with their inherited exposures + match distances.
2. The same route's comfort % in the UI is `Math.round((1 − X.XXX) × 100)` for cooler filters, or `Math.round(X.XXX × 100)` for sunnier. Visual: the route polyline runs over visibly amber-vs-blue streets in roughly the same proportion.

If those three views ever disagree the bug is local to one of them, not a difference of formulas.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.38 MB main chunk, ~11 s)

### 2026-06-01 — Route is now a continuous blue-to-amber heat map + legend + tooltip

Route polyline is now strictly binary: every segment is either warm amber (sunny) or cool blue (shaded). No more white default. Small legend at the top of the map, hover/tap reveals a reason tooltip ("Sunny — direct sun exposure" / "Shaded — building shadow" / "Shaded — tree canopy" / "Shaded — facing away from sun"). `tsc -b` and `vite build` clean.

**Route classification** ([src/lib/routeColoring.ts](src/lib/routeColoring.ts))

Rewritten end-to-end. `ColoredSegment` now carries:

- `path` + `color` (as before)
- `reason: SegmentReason` — classification key (`'sunny' | 'building-shadow' | 'tree-canopy' | 'low-sun-angle' | 'headwind' | 'tailwind'`)
- `label: string` — the human-readable tooltip text

Sun-mode classification priority (returns `SunReason`):

1. **Sun below horizon** → `'low-sun-angle'` (overrides everything — no segment can be "sunny" at night even when bearing aligns with the sub-horizon azimuth)
2. **Midpoint inside any building shadow polygon** → `'building-shadow'`
3. **Tree within 15 m** of midpoint → `'tree-canopy'`
4. **`cos(bearing − sunAzimuth) > 0`** → `'sunny'`
5. **Else** → `'low-sun-angle'` (bearing faces away from the sun)

The fourth-priority WHITE neutral from the previous build is gone. Anything that would have been white is now `LOW_SUN_BLUE` ([85, 130, 195, 235]).

**Sun palette** — three shades of blue carry the "why shaded" subtext:

- Building shadow → deep blue `[40, 60, 140, 235]`
- Tree canopy → mid blue `[55, 100, 165, 235]`
- Facing-away → sky blue `[85, 130, 195, 235]`
- Sunny → amber `[255, 160, 0, 235]`

All three blues read as one "cool blue" channel against the amber sunny segments, but a sharp eye sees the depth difference and can intuit which shade is from the buildings vs the trees vs simply walking with sun behind. Wind mode is unchanged (headwind purple / tailwind green).

`colorizeRoute` signature now takes `sunElevationDeg` as well — needed for the below-horizon override.

**Legend** ([src/components/RouteLegend.tsx](src/components/RouteLegend.tsx))

New small pill at **top-center, below the TimePicker** (`top: calc(env(safe-area-inset-top, 0px) + 13.5rem)`). Renders only when:

- `coloringMode === 'sun'`
- Not in navigating state
- `coloredSegments` exist

The user asked for "bottom of screen", but the RouteSheet sits at the bottom (z-30) and would occlude any legend rendered there during the entire route-review flow. Top-center under the controls is the only band that's always visible whenever a colored route is on the map. Documented this trade-off in the component's JSDoc.

Body: a `linear-gradient(to right, rgb(40,60,140), rgb(85,130,195), rgb(220,175,90), rgb(255,160,0))` 128 px × 8 px bar bracketed by `Shaded` (deep-blue label) and `Sunny` (deep-amber label). DM Mono, 10 px, uppercase tracking. Glass styling matches the rest of the light UI.

**Hover / tap tooltip** ([src/components/GMACanvas.tsx](src/components/GMACanvas.tsx))

- `route-comfort-overlay` PathLayer is now `pickable: true` with `autoHighlight: true` and a translucent white `highlightColor` so the hovered segment subtly brightens.
- New `getTooltip` on `<DeckGL>`:
  - Filters by `info.layer?.id === 'route-comfort-overlay'` — other layers (street overlay, tree dots, building shadows, route halo) don't trigger tooltips.
  - Returns `{ text: obj.label, style: {…} }` styled to match the light theme (white background, dark text, soft drop-shadow, DM Mono, 11 px, no-wrap).
- deck.gl's `getTooltip` fires on both hover (desktop) and pick (mobile tap), so a single handler covers both input modes.

**App wiring** ([src/App.tsx](src/App.tsx))

- `colorizeRoute` call site passes `solar.elevationDeg` (the new param).
- `<RouteLegend visible={…} />` rendered at the bottom of the tree, conditioned on sun-mode + active colored segments.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.38 MB main chunk, ~8.5 s)

### 2026-06-01 — Google Solar API end-to-end (Express proxy + Netlify function + hook + route coloring + building heights)

Real satellite-derived sun-exposure data now drives the route color in place of the bearing approximation, end-to-end. `tsc -b` + `vite build` clean.

**Backend proxy** ([server/index.js](server/index.js))

- Re-wired with the `cors` package: explicit allowlist `[localhost:5173, 127.0.0.1:5173, localhost:4173]`, extra origins via `SOLAR_ALLOWED_ORIGINS=...` env var.
- `GET /api/solar?lat=X&lng=Y` now appends `&requiredQuality=LOW` to the upstream call (HIGH 404s outside major cities; LOW maximizes coverage).
- API key precedence: `GOOGLE_MAPS_API_KEY` (preferred, server-only) → `VITE_GOOGLE_MAPS_API_KEY` (frontend var, accepted as fallback).
- `GET /health` echoes the allowed-origins list for quick CORS debugging.

**Netlify serverless function** ([netlify/functions/solar.js](netlify/functions/solar.js))

- Mirror of the Express endpoint for production. Same query params, same `requiredQuality=LOW`, same env-var precedence.
- Returns CORS-permissive headers (`*` origin) since the function is co-deployed with the frontend on Netlify.
- New [netlify.toml](netlify.toml) at repo root: `command = "npm run build"`, `publish = "dist"`, `functions = "netlify/functions"`, plus a 200-status redirect `from = "/api/solar" → "/.netlify/functions/solar"` so the same fetch path works in dev (Vite proxy → Express) and prod (Netlify redirect → function).

**Package scripts + deps** ([package.json](package.json))

- New `cors ^2.8.6` runtime dep, new `concurrently ^9.2.1` devDep (19 packages added on install, zero vulns).
- New script `"dev:all": "concurrently -n vite,solar -c blue,yellow \"npm:dev\" \"npm:start:server\""` — one command launches Vite and the Solar proxy with color-tagged output.

**`useSolarAPI` hook** ([src/hooks/useSolarAPI.ts](src/hooks/useSolarAPI.ts))

- Samples the selected route polyline every `SAMPLE_INTERVAL_M = 200` m (linear interpolation along each segment), dedupes by 4-decimal-rounded coords (≈ 11 m bucket), caps at `MAX_SAMPLES_PER_ROUTE = 30` to bound the billed call count per route selection.
- Module-level `CACHE = new Map<rounded-coord-key, Promise<SolarSample>>` — the same lat/lng is never fetched twice in a session, regardless of which route or filter triggers it.
- Per-sample extraction:
  - `maxSunshineHours` ← `solarPotential.maxSunshineHoursPerYear` (latitude-bound theoretical max)
  - `annualSunshineHours` ← `wholeRoofStats.sunshineQuantiles[5]` (median of the 11-quantile distribution; the API returns 0…100 % in 10 % steps)
  - `exposureRatio` ← `annual / max`, clamped to [0, 1]
  - `buildingHeight` ← `buildingStats.buildingHeight ?? buildingStats.height ?? null` per the CLAUDE.md spec. The current public Solar API doesn't expose this directly, so the lookup falls through to null; documented as a "ships if Google adds it" hook.
  - `buildingPolygon` ← `boundingBox.sw / boundingBox.ne` converted into a 4-corner [lng, lat] ring (used as supplemental shadow-projection input).
- Failure modes degrade quietly: 404 (no building at that point — common over parks, intersections, water) → empty sample marked `hit: false` and the route uses bearing fallback for that segment. 500 / CORS / network throw → `console.warn` + empty sample. Batch-level promise failure → `EMPTY` data with `loading: false`.
- Console logs the sampling decision (`uniqueSamples`, `intervalM`, `capped`) and the batch result (`matched / missed / buildingsWithHeight`).

**Solar exposure → route coloring** ([src/lib/routeColoring.ts](src/lib/routeColoring.ts))

- `colorizeRoute` signature now takes `solarSamples: readonly SolarSample[] | null` as an optional final param.
- New `classifySunReason` flow:
  1. Sun below horizon → `'low-sun-angle'`
  2. Inside any building shadow polygon → `'building-shadow'`
  3. Tree within 15 m → `'tree-canopy'`
  4. **Solar API sample within `SOLAR_SAMPLE_RADIUS_M = 300` m** → use its `exposureRatio`. Ratio > `SOLAR_SUNNY_RATIO = 0.5` → `'sunny'`, else `'low-sun-angle'`. Classification carries `via: 'solar'`.
  5. Bearing fallback (`cos(bearing − sunAzimuth) > 0`) — threshold 0 preserved from the previous build so changing data sources doesn't cause visible churn for users without Solar API access. Carries `via: 'bearing'`.
- New `nearestSolarSample` helper does a bbox-prefilter then quadratic-distance compare to find the closest sample per segment midpoint. Samples without a hit (`hit === false`) or without a ratio are skipped.
- Per-route summary log at the end of `colorizeRoute`:
  ```
  [GMA] Route coloring sources {
    segments: 86, buildingShadow: 12, treeCanopy: 4,
    solarApi: 58, bearingFallback: 12,
    solarCoverage: '67% via Solar API'
  }
  ```
  Lets us tell at a glance whether the demo is showing real Google data or the cosine approximation.

**Building heights from Solar API → shadow projection** ([src/App.tsx](src/App.tsx))

- New `mergedBuildings` useMemo combines OSM `overpass.buildings` with Solar-derived buildings (`{ polygon: bboxRing, height: buildingHeight }`) into a single `Building[]`. Solar entries are appended (not deduped against OSM) — the visual overlap is acceptable since shadow alpha is 0.25 and `depthWriteEnabled: false`.
- `projectShadows(mergedBuildings, …)` consumes the merged array. No change to the shadow projection formula itself.
- When `useSolarAPI` returns no building-height records (the current public-API case), `mergedBuildings === overpass.buildings` and shadows behave exactly as before.

**OSM default height bumped 10 → 20 m** ([src/lib/overpass.ts](src/lib/overpass.ts))

- `parseHeight` fallback raised from 10 m to 20 m (≈ 6 stories) — closer to a NYC midblock baseline. The previous 10 m produced visibly too-short shadows in Midtown for buildings missing `height` / `building:levels` tags. Documented the trade-off in the function's comment.

**App wiring** ([src/App.tsx](src/App.tsx))

- New import: `useSolarAPI`, `Building`.
- Reorder: `selectedRoute` is now derived BEFORE `buildingShadows` (and `mergedBuildings`) because `useSolarAPI` depends on `selectedRoute.polyline`. Earlier `buildingShadows` declaration moved down accordingly.
- `coloredSegments` useMemo now passes `solarApi.samples` to `colorizeRoute`.
- Console-log when OSM buildings are augmented with Solar API building footprints (counts + height list).

**Files added / changed**

- New: [server/index.js](server/index.js) (updated), [netlify/functions/solar.js](netlify/functions/solar.js), [netlify.toml](netlify.toml), [src/hooks/useSolarAPI.ts](src/hooks/useSolarAPI.ts)
- Modified: [package.json](package.json), [src/lib/routeColoring.ts](src/lib/routeColoring.ts), [src/lib/overpass.ts](src/lib/overpass.ts), [src/App.tsx](src/App.tsx)

**How to run**

```
npm run dev:all
```

Vite at :5173, Solar proxy at :3001. Frontend always fetches `/api/solar?…` — Vite's `server.proxy['/api']` routes that to :3001 in dev, and Netlify's redirect routes it to the serverless function in prod.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.39 MB main chunk, ~10 s)

### 2026-06-01 — Overpass rate-limit hardening + visible data-sources indicator

Defended the public Overpass endpoint against 429s (the demo machine was getting throttled mid-pan) and added a small bottom-left strip so the demo audience can see at a glance which data sources are powering the visualization. `tsc -b` and `vite build` clean.

**Overpass rate-limit hardening** ([src/lib/overpass.ts](src/lib/overpass.ts), [src/hooks/useOverpassData.ts](src/hooks/useOverpassData.ts))

Four layers, in increasing aggression:

1. **30-minute TTL cache.** `Map<bboxKey, { promise, fetchedAt }>` keyed by 3-decimal-rounded bbox. Lookups within 30 min of `fetchedAt` return the cached promise verbatim; older entries trigger a fresh fetch. Replaces the previous "cache forever and immediately delete on error" pattern, which caused thrashing the moment a 429 came back. `CACHE_TTL_MS = 30 * 60 * 1000`.
2. **2-second debounce in the hook.** `useOverpassData` queues a fetch via `setTimeout(…, DEBOUNCE_MS)` and clears on bbox change, so rapid pans / zooms across the same neighborhood collapse to at most one request. `DEBOUNCE_MS = 2_000`. Trade-off: first load now waits 2 s before any Overpass request, which is acceptable because the route polyline + Solar API still render immediately and the street/tree/shadow overlays just appear shortly after.
3. **Exponential backoff retry on HTTP 429.** `RETRY_DELAYS_MS = [0, 5_000, 15_000, 30_000]` — the first attempt fires immediately, then 5 s / 15 s / 30 s pauses before retries on 429. Other HTTP statuses (400, 403, 504) short-circuit to `{ status: 'error' }` without retry — those aren't transient. When all four attempts return 429, the result resolves to `{ data: EMPTY, status: 'rate-limited' }` and the cached entry sticks until TTL expires (no repeated hammering).
4. **Single union query.** The query was already a union since the May 2026 rebuild (`(way[highway~"primary|…"]; node[natural=tree]; way[building]; way[landuse=forest]; way[natural=wood];)`), so this leg of the user's spec was a no-op — confirmed in code and annotated in the header comment so future maintainers don't try to "fix" it back to three separate fetches.

Fetcher return type changed: `fetchOverpassData(bbox) → Promise<OverpassFetchResult>` where `OverpassFetchResult = { data: OverpassData, status: 'success' | 'rate-limited' | 'error' }`. The hook surfaces this as `UseOverpassDataResult = OverpassData & { status: OverpassHookStatus }`, where `OverpassHookStatus` extends the fetch status with `'idle' | 'loading'` for the pre-fetch lifecycle.

**Solar API status** ([src/hooks/useSolarAPI.ts](src/hooks/useSolarAPI.ts))

Added a semantic `status: 'idle' | 'loading' | 'active' | 'unavailable'` to the hook's return alongside the existing `loading: boolean` and counts:

- `'idle'` — no route polyline yet.
- `'loading'` — at least one `/api/solar` call in flight.
- `'active'` — at least one sample returned data (`matchedCount > 0`).
- `'unavailable'` — every sample missed (404, proxy unreachable, or batch throw).

Console log on completion now includes the resolved status alongside the counts.

**Data sources indicator** ([src/components/DataSourcesIndicator.tsx](src/components/DataSourcesIndicator.tsx))

New small bottom-left card stacked above the SunCompass (`bottom: calc(env(safe-area-inset-bottom, 0px) + 15rem)`, `left-4`). Two lines, monospaced, 10 px uppercase tracking:

```
Solar API     ✓        (green)
Overpass      ✓        (green)
```

When a source falls back, the right-hand chip switches to orange-red:

| Source        | Active state             | Fallback / failure state                                       |
| ------------- | ------------------------ | -------------------------------------------------------------- |
| `Solar API`   | `✓` (matched samples)   | `(fallback)` — every sample missed; `…` while loading          |
| `Overpass`    | `✓` (200 OK)             | `(rate limited)` after 429 retries; `(unavailable)` on error; `…` while loading |

Renders unconditionally (pointer-events-none) so the demo audience can see source status before, during, and after a route is on the map.

**App wiring** ([src/App.tsx](src/App.tsx))

`<DataSourcesIndicator solarStatus={solarApi.status} overpassStatus={overpass.status} />` placed alongside `<MapViewSwitcher>` / `<RouteLegend>` / `<DataAttribution>`. No business logic — the hooks already export the right status values.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.39 MB main chunk, ~10 s)

### 2026-06-02 — Absolute comfort score derived from the visual classifier + condition labels + all-sunny warning

The bug: a route polyline rendered as "mostly amber" was reading as "90% cooler" on its card because the comfort percent and the visual were derived from two different data sources (street-index continuous exposure vs route-polyline classifier). After this fix they're literally the same number — `meanSunExposure` is now the length-weighted average of the per-segment binary classification that drives the on-map color, so "X% cooler = X% of the route polyline is blue" by construction. `tsc -b` + `vite build` clean.

**Unified sun classifier** ([src/lib/routeColoring.ts](src/lib/routeColoring.ts))

Promoted the internal `classifySunReason` to an exported `classifyRouteSegmentSun` and added a binary `exposure: 0 | 1` field. The priority chain is unchanged from the previous build:

1. Sun below horizon → `{ exposure: 0, reason: 'low-sun-angle', via: 'night' }`
2. Inside any building shadow polygon → `{ 0, 'building-shadow', 'shadow' }`
3. Tree within 15 m → `{ 0, 'tree-canopy', 'tree' }`
4. Solar API sample within 300 m: `exposureRatio > SOLAR_SUNNY_RATIO = 0.5` → `{ 1, 'sunny', 'solar' }`, else `{ 0, 'low-sun-angle', 'solar' }`
5. Bearing fallback: `cos(bearing − sunAz) > 0` → `{ 1, 'sunny', 'bearing' }`, else `{ 0, 'low-sun-angle', 'bearing' }`

New `via: 'shadow' | 'tree' | 'solar' | 'bearing' | 'night'` carries which branch fired — used for diagnostics + the `bySource` log.

`colorizeRoute` now calls this exported helper directly and reads the same `exposure` for free.

**Route exposure scoring** ([src/lib/routeExposureScoring.ts](src/lib/routeExposureScoring.ts))

Rewritten end-to-end. Old behavior: sample route midpoints against a separate `StreetExposureIndex` (continuous exposure, different dataset). New behavior: walk the polyline, call `classifyRouteSegmentSun` per segment, length-weight the binary `exposure`. Return shape simplified:

```ts
interface RouteExposureResult {
  meanExposure: number; // 0..1 length-weighted binary mean
  matches: RouteExposureMatch[]; //  per-segment { exposure, reason, via }
  bySource: { shadow, tree, solar, bearing, night }; // counts
}
```

`bySource` replaces the previous `matchedCount / fallbackCount` split — much more informative for verifying which data source produced each route's score.

**Scoring context** ([src/lib/hlciRouter.ts](src/lib/hlciRouter.ts))

`scoreAndRankRoutes` signature changed: the `streetExposureIndex` param is replaced with a `RouteScoringContext = { buildingShadows, trees, solarSamples }`. Internally:

- `sampleRouteExposure(c.polyline, sun.az, sun.elev, ctx.buildingShadows, ctx.trees, ctx.solarSamples)` is called per candidate.
- `meanSunExposure` is the length-weighted binary mean.
- Per-route console log now reports `bySource` counts and per-segment `{ seg, lenM, exposure, via, reason }`.

`hlciCost = weights.glareAvoidance × meanSunExposure + …` continues to drive ranking (negative weight for "Sunniest" flips the sort).

**Solar API: per-candidate sampling** ([src/hooks/useSolarAPI.ts](src/hooks/useSolarAPI.ts))

Old signature: `useSolarAPI(polyline: RoutePoint[] | null)` — sampled only the selected route, so non-selected candidates' scores fell back to bearing math. New signature: `useSolarAPI(polylines: ReadonlyArray<ReadonlyArray<RoutePoint>> | null)` — flattens, dedupes by 4-decimal coord, and caps the combined batch at `MAX_SAMPLES_PER_BATCH = 50` (replaces the per-route cap of 30). Every candidate now scores against the same real solar dataset.

Hook stability: a content-hash `polylinesKey` (point count + first/last coord per polyline) is the `useEffect` dependency, so re-renders that hand a new outer-array reference for identical content don't trigger refetches.

**RouteSheet — condition labels + warning** ([src/components/RouteSheet.tsx](src/components/RouteSheet.tsx))

- New `exposureToCondition(meanSunExposure)` derivation:
  - `> 0.7` → **Mostly sunny** (rgb(234, 88, 12), warm orange)
  - `0.3 ≤ ≤ 0.7` → **Partly shaded** (rgb(180, 130, 20), muted gold)
  - `< 0.3` → **Mostly shaded** (rgb(30, 120, 60), green)
- Each `RouteCard` renders the condition label in DM Mono under the percent pill — only when the active filter is sun-aware (`avoid-sun` / `avoid-both`). Wind / no-preference / sunniest filters don't get the chip (the verb wouldn't match).
- **All-sunny warning**: when `isSunFilter && every route has meanSunExposure > 0.7`, a yellow-tinted strip appears above the route list:
  > ☼ All routes are sunny at this time. Try leaving earlier or later for more shade.
  - Renders only for cooler-preferring filters (`avoid-sun` / `avoid-both`).
  - Inline `<SunWarningIcon />` SVG, no external assets.

**App wiring** ([src/App.tsx](src/App.tsx))

Re-ordered the hook calls so `solarApi` is available BEFORE `result`:

1. `candidatePolylines` (memoized from `candidates`)
2. `solarApi = useSolarAPI(candidatePolylines)` — fires when the candidate set changes (origin / destination / transport mode), NOT on filter changes
3. `mergedBuildings` (OSM + Solar API-derived)
4. `buildingShadows = projectShadows(mergedBuildings, …)`
5. `result = scoreAndRankRoutes(candidates, …, { buildingShadows, trees, solarSamples })`
6. `selectedRoute = result.routes[safeIdx]`
7. `coloredSegments = colorizeRoute(selectedRoute.polyline, …, solarApi.samples)`

No more feedback loop where selecting a different route triggers a solar refetch that re-ranks routes. Solar data is stable across filter + selection changes; only origin / destination / transport mode invalidates it.

`buildStreetIndex` import + memo removed — scoring no longer uses it, and the street overlay reads `streetExposures` directly.

**What didn't change**

- Wind filter still uses the candidate-relative normalize via `routeComfortPercent(route, allRoutes, null)`. The user's instructions were sun-specific; "% calmer" doesn't have an obvious absolute scale without a wind exposure map. Future fix.
- `routeComfortPercent`'s sun-direction branch is unchanged — `(1 − meanSunExposure) × 100` for cooler, `meanSunExposure × 100` for sunnier. The fix is upstream in how `meanSunExposure` is computed.

**Verification flow (browser DevTools)**

1. Select origin + destination.
2. Pick the **Avoid Sun** filter.
3. Console shows per-route `[GMA] Route N (…) exposure sample { …, meanExposure: 0.X, bySource: {shadow, tree, solar, bearing, night}, firstSamples: [{seg, lenM, exposure, via, reason}, …] }`.
4. The route card percent equals `Math.round((1 − meanExposure) × 100)`.
5. The route polyline on the map shows roughly `meanExposure × 100` % amber segments (the rest blue).
6. The condition chip matches: > 70 % amber → **Mostly sunny**; 30-70 % → **Partly shaded**; < 30 % → **Mostly shaded**.
7. When all routes are > 70 % amber, the warning strip appears.

If those views disagree, the bug is local to one of them, not a difference of formulas.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.39 MB main chunk, ~12 s)

### 2026-06-02 — Full transparency: per-segment diagnostic audit + Solar API sample-by-sample log + rich tooltip

A demo-audience-facing visualization is only trustworthy if you can interrogate it. Added a complete audit trail so anyone can see EXACTLY which data source decided each segment's color, what the underlying numbers were, and which Solar API samples actually fed the route. `tsc -b` + `vite build` clean.

**`SunDiagnostic` audit record** ([src/lib/routeColoring.ts](src/lib/routeColoring.ts))

New per-segment audit struct — every check is evaluated, not just the one that wins the priority chain:

```ts
interface SunDiagnostic {
  midLng, midLat;                              // segment midpoint coords
  bearingDeg, sunAzimuthDeg, sunElevationDeg;
  bearingFacing;                               // cos(bearing − sunAz) ∈ [-1, 1]
  sunAboveHorizon;                             // boolean
  buildingShadowHit;                           // boolean
  nearestTreeDistanceM | null;                 // any tree within 100 m
  inTreeCanopy;                                // distance < 15 m
  solarSample: { exposureRatio, distanceM, lat, lng } | null;
}
```

New `classifyWithDiagnostics(...)` returns `{ classification, diagnostic }`. The old `classifyRouteSegmentSun` now delegates to it for backwards compat with anything that only needs the classification.

Implementation details:

- Tree check uses a wider `TREE_NEAREST_SEARCH_RADIUS_M = 100` (vs `TREE_RADIUS_M = 15` for the canopy threshold) so the tooltip can show "nearest tree 47 m" even when the segment isn't shaded.
- Solar lookup `findNearestSolarSample` now returns full `{ exposureRatio, distanceM, lat, lng }` instead of just the ratio. Bbox prefilter then haversine compare; skips no-hit (404) and ratio-less samples.
- All four checks run for every segment, so the diagnostic is complete regardless of which branch fires first.

**Diagnostic on every `ColoredSegment`** ([src/lib/routeColoring.ts](src/lib/routeColoring.ts))

`ColoredSegment` gains an optional `diagnostic?: SunDiagnostic` field, populated by `colorizeRoute` for every sun-mode segment. Wind-mode segments leave it `undefined` (no sun chain to audit).

**Diagnostic on every `RouteExposureMatch`** ([src/lib/routeExposureScoring.ts](src/lib/routeExposureScoring.ts))

`sampleRouteExposure` now calls `classifyWithDiagnostics` and stores the full diagnostic per match. The score `meanExposure` is unchanged; the addition is purely for the audit log.

**Per-route transparency log** ([src/lib/hlciRouter.ts](src/lib/hlciRouter.ts))

Replaced the previous truncated 8-sample preview with a full collapsed group per route:

```
▸ [GMA] Route 0 (via 6th Ave) — 86 segments, mean exposure 0.412
    summary { polylinePts, segmentsScored, meanExposure, bySource, solarCoverage }
    ▢ console.table( all segments )
        seg | lenM | midLng | midLat | bearing | sunAz | sunElev |
        bearingFacing | bldgShadow | nearestTreeM | solarRatio |
        solarDistM | via | reason | exposure
    Solar API samples used by this route: 12 unique
    ▢ console.table( per-sample lat, lng, exposureRatio, matchedSegments )
```

Every segment's row shows ALL inputs the classifier saw plus the winner — the audience can scroll the table and confirm "row 17 has Solar API ratio 0.62 → won → sunny". Solar-samples-used table aggregates which unique Google Solar API data points actually drove this route's score, with their measured `exposureRatio` and a count of how many segments matched each.

Sample groups are collapsed by default so the console stays browseable across multiple route picks.

**Solar API per-sample log** ([src/hooks/useSolarAPI.ts](src/hooks/useSolarAPI.ts))

Replaced the previous count-only log with a collapsed group containing `console.table` of every fetched sample:

```
▸ [GMA] Solar API results — 27/30 matched, buildings with height: 0
    summary { totalSamples, matched, missed, buildingsWithHeight, status }
    ▢ console.table( per sample:
        lat, lng, hit, annualHours, maxHours, exposureRatio, buildingHeightM )
```

Every billed call shows up as one row — the audience can spot-check a coordinate on a map and confirm the response was real.

**Rich HTML tooltip** ([src/components/GMACanvas.tsx](src/components/GMACanvas.tsx))

`getTooltip` now returns `{ html, style }` instead of `{ text }` so the tooltip can show the full reasoning multi-line. The new `buildDiagnosticTooltipHtml(segment)` helper renders, for each hovered segment:

```
Sunny — direct sun exposure          ← reason headline, amber text
via solar                            ← which check won, small uppercase

Solar API: 62% of max (42 m away)
Trees: nearest 47 m (canopy radius 15 m)
Building shadow: miss
Bearing: 145° (sun 130°, Δ15°, cos 0.97)

40.75832, -73.98551                  ← midpoint coords, tiny grey
```

When the winner is `tree`, the Trees line bolds "in canopy"; for `shadow`, the Shadow line bolds "hit"; for `bearing`, the Bearing line is the one that fired. The user can verify any color claim against the underlying numbers.

Tooltip max-width 320 px, DM Mono 11 px, white card with shadow — matches the rest of the light UI. HTML is built from a fixed shape and the only user-facing string (the segment label, e.g. "Shaded — building shadow") is escaped via a local `escapeHtml` helper.

**Verification flow**

1. Pick origin + destination, choose **Avoid Sun**.
2. **Expand** `[GMA] Solar API results — N/M matched` — every row is a real call, lat/lng/ratio visible.
3. **Expand** `[GMA] Route 0 (…) — N segments, mean exposure X` — every segment is a row in the table; columns show what each input check returned plus which branch won.
4. **Hover** any route segment on the map — the tooltip says the same numbers the table shows.
5. **Look** at the route card percent — it's `(1 − meanExposure) × 100`, the same number from the summary line.

Every layer of the visualization is now an independently-verifiable claim.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.40 MB main chunk, ~10 s)

### 2026-06-02 — UI polish pass: cleaner route, vivid palette, start toast, compact compass

Visual housekeeping pass to bring the demo up to product-ready polish. `tsc -b` + `vite build` clean.

**Route polyline — one clean thick line** ([src/components/GMACanvas.tsx](src/components/GMACanvas.tsx), [src/lib/routeColoring.ts](src/lib/routeColoring.ts))

- Removed the `route-halo` PathLayer entirely. The previous "white halo under colored overlay" pattern was a workaround for the old muted palette; vivid Tailwind brand colors at 8 px stand on their own.
- Route width bumped 7 → **8 px** (min 6 → 7).
- New palette (alpha 245 — near-opaque, no haze):

| Reason | Color | Hex |
|---|---|---|
| `sunny` | amber-500 | `#F59E0B` `rgb(245, 158, 11)` |
| `building-shadow` | blue-500 | `#3B82F6` `rgb(59, 130, 246)` |
| `low-sun-angle` | blue-500 | `#3B82F6` (same) |
| `tree-canopy` | emerald-500 | `#10B981` `rgb(16, 185, 129)` |

Building-shadow and low-sun-angle now share the same vivid blue (previously they were three different blues to telegraph "why shaded"). The diagnostic tooltip still surfaces WHICH branch fired (`via: 'shadow' | 'bearing'`), so audit transparency is unchanged — the visual just reads cleaner.

`ROUTE_ALTITUDE_M` constant deleted (only the now-gone halo used it).

**Street sun overlay — softer tint** ([src/lib/streetSunColoring.ts](src/lib/streetSunColoring.ts))

- `SUN_ALPHA_MAX` 140 → **64** (0.55 → 0.25)
- `SHADE_ALPHA` 89 → **45** (0.35 → 0.18) — kept slightly fainter so sunny streets still pop
- Palette retuned from the previous `[255,180,0] / [100,140,200]` to match the route's vivid amber-500 / blue-500 — overlay and route now share a color language.
- Net effect: Positron's place labels stay readable; the overlay reads as a tint rather than competing with the basemap.

**Building footprints / shadows — almost invisible** ([src/components/GMACanvas.tsx](src/components/GMACanvas.tsx))

- `SHADOW_FILL` switched from `[0, 0, 20, 64]` (dark blue, 0.25 alpha) to **`[100, 100, 120, 20]`** (slate-grey, 0.08 alpha) per the user spec — no stroke (already was). Projected building polygons are now an almost-invisible grey hint rather than a high-contrast dark block. Loses some "look at the shadow" weight, but the route polyline reading shadow segments as vivid blue picks that up.

**Sun compass — smaller + embedded data sources** ([src/components/SunCompass.tsx](src/components/SunCompass.tsx))

- Disc 110 → **88 px**; card padding `p-3 → px-3 py-2.5`; min-width 128 px to fit the data-source lines without going narrow.
- Time text `text-base → text-sm`; phase line tracking tightened (`0.20em → 0.18em`).
- New thin footer (border-top, padding-top 2) carries `Solar` and `Overpass` status lines — same colors and semantics as the previous standalone `DataSourcesIndicator`. Active = emerald-500 (`#10B981`) `✓`; fallback / error = orange-600 (`#EA580C`) with the text reason (`fallback`, `rate-limited`, `unavailable`); loading = grey `…`.
- `[src/components/DataSourcesIndicator.tsx]` deleted — its content lives in the SunCompass footer now and the standalone wasn't used elsewhere.

**SearchBar polish** ([src/components/SearchBar.tsx](src/components/SearchBar.tsx))

- Card padding `p-3 → p-4`, max-width 440 → 460 px.
- Inline drop-shadow upgraded from the `--gma-shadow-lg` token to a richer two-stop shadow: `0 14px 36px rgba(0, 0, 0, 0.10), 0 4px 12px rgba(0, 0, 0, 0.05)` — pronounced enough to lift the card off Positron tiles without going heavy.
- Input padding `px-3 py-2 → px-3.5 py-3`; font `text-[0.9375rem] → text-base`. Input bg slightly faded (`rgba(0,0,0,0.03) → rgba(0,0,0,0.025)`) to balance the larger padding.
- Vertical gap between origin and destination rows `h-2 → h-2.5`.

**Start toast** ([src/components/Toast.tsx](src/components/Toast.tsx) + [src/App.tsx](src/App.tsx))

- New transient top-center notification component. White card, soft shadow, `text-base font-medium`. Fades in on a new message, fades out `durationMs = 3000` ms later. `pointer-events-none` so it never blocks a tap. `role="status" aria-live="polite"`.
- `handleStartNavigation` builds the message from `selectedRoute.meanSunExposure`:
  - `exposure < 0.3` → `'🌿 Mostly Shaded Route Selected'`
  - else → `'☀️ X% Cooler Route Selected'` where `X = Math.round((1 − exposure) × 100)`
- `App.tsx` holds `toastMessage` state; passing a non-null message into `<Toast />` triggers the fade-in via a `useEffect` timer inside the component.
- Z-index 60 so it floats above SearchBar / TimePicker / NavigationPanel (all z-50).

**App.tsx wiring** ([src/App.tsx](src/App.tsx))

- Dropped `DataSourcesIndicator` import + render.
- Added `Toast` import + `<Toast message={toastMessage} />` render.
- `SunCompass` now receives `solarStatus={solarApi.status}` and `overpassStatus={overpass.status}` so it can render its own status footer.
- Added `ScoredRoute` type import for the new `buildStartToast(route: ScoredRoute)` helper at the bottom of App.tsx.

**Files deleted**

- `src/components/DataSourcesIndicator.tsx` — superseded by the SunCompass footer.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.40 MB main chunk, ~17 s)

### 2026-06-02 — Navigation redesign: live blue dot + 3D follow-cam + clean header/turn UI

Tearing down the old turn-by-turn text panel in favor of a Google-Maps-style live map experience. `tsc -b` + `vite build` clean.

**`useLiveLocation` hook** ([src/hooks/useLiveLocation.ts](src/hooks/useLiveLocation.ts))

`navigator.geolocation.watchPosition` wrapper, gated on an `enabled` flag (only runs while `navigating === true` so the permission prompt + battery drain don't fire during route browsing). Returns:

```ts
interface LiveLocation {
  coord: { lat, lng } | null;
  heading: number | null;        //  device compass, when reported
  accuracyM: number | null;
  status: 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';
  error: string | null;
}
```

`enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000`. Handles permission denial and missing Geolocation API gracefully — both fall through to a still-functional UI (next-turn pill uses the route's first step as a static fallback, follow-cam noop, no blue dot).

**Navigation derivations** ([src/lib/navigation.ts](src/lib/navigation.ts))

Two pure helpers wired off the live geolocation:

- `computeRouteProgress(polyline, livePos)` — projects the live position onto the nearest polyline vertex (close-enough approximation on a city grid) and returns `{ traveledM, totalM, nearestVertexIdx, offRouteM }`.
- `computeNextTurn(polyline, steps, livePos)` — walks cumulative step-boundary distances along the polyline, finds the user's current step, and reports the NEXT step's instruction + the distance from the user to that boundary. Past the last step it emits the `'Arriving at destination'` pseudo-turn with the remaining-to-end distance.

Both are O(polyline.length + steps.length); no spatial index needed at urban-route scale.

**`NavigationHeader`** ([src/components/NavigationHeader.tsx](src/components/NavigationHeader.tsx))

Top-of-screen pill replacing the old text panel. Renders only what matters to the moment:

```
                  Grand Central Terminal · 0.8 km · 12 min
                                                              [ Stop ]
```

- Centered card, max-width `calc(100vw − 7rem)` so the Stop button on the right always has room.
- Destination name truncates at 180 px with a `title=` tooltip for the full label.
- Distance + duration in DM Mono; `formatKm(meters)` does `< 950 m → '380 m'`, else `'1.2 km'`.
- Stop button is a sibling rendered top-right (separate `<button>`) so it stays accessible regardless of header text length.

**`NextTurnIndicator`** ([src/components/NextTurnIndicator.tsx](src/components/NextTurnIndicator.tsx))

Bottom-of-screen pill, single line:

```
   ←   Turn left on W 43rd St   in 200 m
```

- Unicode arrow picked from instruction text: `pickArrow()` checks for "u-turn", "sharp left/right", "slight left/right", "left", "right", "merge/continue/straight/head". Defaults to ↑.
- For the `isArrival` pseudo-turn the arrow becomes ✓ in emerald-500; otherwise blue-500.
- `stripHtml()` removes the `<b>…</b>` wrappers Routes API sometimes returns around street names.
- `formatDistance()` rounds: `< 50 m → exact`, `< 950 m → snap-to-10`, else km with 1 decimal.
- Renders `null` when no `nextTurn` data — covers the pre-fix state where geolocation hasn't returned yet.

**GMACanvas — live dot + thicker route** ([src/components/GMACanvas.tsx](src/components/GMACanvas.tsx))

Two new `ScatterplotLayer`s render the user's live position Google-Maps-style:

- `live-location-halo` — 20–25 m radius (scales with reported `accuracyM`), `[66, 133, 244, 55]` soft blue, no stroke, min/max pixels 18/60.
- `live-location-dot` — 7 m radius (min 8 px), solid `[66, 133, 244, 255]` with a 2 px white stroke.

Both have `depthCompare: 'always'` so they sit on top of every other map layer.

Route polyline width during navigation: `getWidth: navigating ? 12 : 8` (min 10 vs 7). Picking + diagnostic tooltip are disabled while navigating (`pickable: !navigating, autoHighlight: !navigating`) — the user is following the route, not auditing it.

**App.tsx wiring** ([src/App.tsx](src/App.tsx))

- New `liveLocation = useLiveLocation(navigating)` — only watches GPS during navigation.
- New `routeProgress` + `nextTurn` memos depend on `selectedRoute` and `liveLocation.coord.{lat,lng}` so they recompute each fix.
- `remainingDistanceM` / `remainingDurationS` derived from `routeProgress` — duration prorated from `selectedRoute.durationSeconds × (remaining / total)`.
- **Follow-cam** `useEffect` re-centers `viewState` on every new fix: `{ longitude, latitude, zoom: 18, pitch: 55, bearing: heading ?? 0, transitionDuration: 500, transitionInterpolator: FlyToInterpolator }`. Deps exclude `viewState` so the interpolator's intermediate emissions don't re-fire the effect; updates fire only on coord/heading changes.
- `handleStartNavigation` also calls `setMapView('3d')` — auto-switch to Google Photorealistic 3D Tiles for the angled follow-the-route feel — and sets initial `pitch: 55` for the first fly-in.

Render-tree changes during navigation:

| Component | Non-navigating | Navigating |
|---|---|---|
| `SearchBar` | shown | hidden |
| `TransportModeSwitcher` | shown when route exists | hidden |
| `TimePicker` | shown when route exists | hidden |
| `RouteSheet` | shown when route exists | hidden |
| `NavigationHeader` (NEW) | hidden | shown |
| `NextTurnIndicator` (NEW) | hidden | shown |
| `SunCompass` | shown | hidden |
| `MapViewSwitcher` | shown | hidden |
| `RouteLegend` | shown when route exists | hidden |
| `Toast` | shown on Start | shown on Start |
| `DataAttribution` | shown | shown |

**Files deleted**

- `src/components/NavigationPanel.tsx` — the turn-by-turn text list it rendered is now replaced by the single-line `NextTurnIndicator` at the bottom.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.40 MB main chunk, ~25 s)

### 2026-06-02 — Navigation: respect user's map view + invariant-on per-segment route coloring

Two follow-up fixes to the navigation redesign. `tsc -b` + `vite build` clean.

**1 · Per-segment sun coloring stays on during navigation** ([src/components/GMACanvas.tsx](src/components/GMACanvas.tsx))

The `route-comfort-overlay` PathLayer already uses `data: coloredSegments` with `getColor: (d) => d.color` — segments render independently regardless of `navigating`. The previous build's only navigation-mode delta was width (12 px vs 8 px) and disabling picking; the per-segment color accessor was not changed.

Made the invariant explicit in code and added a render-time log so it's verifiable from DevTools:

```
[GMA] Route polyline: {
  mode: 'navigation',
  points: 87,
  coloredSegments: 86,
  sunny: 51,    // amber #F59E0B
  treeCanopy: 4, // emerald #10B981
  shaded: 31,   // blue #3B82F6
  widthPx: 12
}
```

The route at 12 px continues to paint amber sunny / blue shaded / emerald tree-canopy segments. When the user thought they saw a solid line, the cause was the tight zoom-18 + pitch-55 chase view, which is fixed in change #2 below.

**2 · No auto-3D on Start; honor the user's chosen map view** ([src/App.tsx](src/App.tsx))

- `handleStartNavigation` no longer calls `setMapView('3d')` — the user's current view (2D / 3D / Satellite) is preserved verbatim.
- Initial fly-in no longer forces `pitch: 55`. The map view choice now fully drives camera tilt: 2D / Satellite stay top-down, 3D Photorealistic Tiles still look great because the user picked them.
- **Follow-cam** updated:
  - `pitch: 0` (was 55). A 55° tilt looked wrong on the flat CartoDB raster and would have required a tilt-on-3D-only branch that would surprise users on switch.
  - `zoom: 17` (was 18). Slightly wider so a longer stretch of the route is in view — which is what makes the per-segment sun coloring actually readable while walking.
  - Bearing still follows `liveLocation.heading` when reported.
- `MapViewSwitcher` is now rendered unconditionally instead of gated on `!navigating`. The user can flip between 2D / 3D / Satellite mid-route.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.40 MB main chunk, ~11 s)

### 2026-06-02 — Gemini 2.5 Flash conversational routing (power-feature alongside filter pills)

Free-text routing preference layered on top of the existing pill UI. `tsc -b` + `vite build` clean.

**`src/lib/geminiRouting.ts`** ([new file](src/lib/geminiRouting.ts))

Direct browser call to AI Studio — `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$VITE_GEMINI_API_KEY`. No proxy (unlike Solar API) since AI Studio credits cover the call. Uses Gemini's structured-output mode:

```ts
generationConfig: {
  responseMimeType: 'application/json',
  responseSchema: {
    type: 'OBJECT',
    properties: {
      sunPreference:  { type: 'STRING', enum: ['avoid_sun', 'want_sun', 'neutral'] },
      windPreference: { type: 'STRING', enum: ['avoid_wind', 'neutral'] },
      intensity:      { type: 'STRING', enum: ['low', 'medium', 'high'] },
    },
    required: ['sunPreference', 'windPreference', 'intensity'],
  },
  temperature: 0.2,
}
```

`system_instruction`: *"You are a comfort routing assistant. The user will describe their physical context or preference. Extract: sunPreference (avoid_sun | want_sun | neutral), windPreference (avoid_wind | neutral), intensity (low | medium | high). Return ONLY a JSON object with these three fields, nothing else."*

`interpretPreference(userText)` returns `GeminiInterpretation | null`. Null on any failure (missing key, HTTP 4xx/5xx, non-JSON text, schema mismatch, network throw) — every path logs a `[GMA] Gemini:` warning so the caller can degrade gracefully without ambiguity. Successful calls log `{ input, output }` so the audience can verify in DevTools.

`mapInterpretation(interp) → MappedPreference` translates the structured output into the app's existing `FilterMode` plus an intensity weight multiplier and a plain-English toast phrase:

| sunPreference | windPreference | filterMode | toast verb |
|---|---|---|---|
| `want_sun` | * | `sunniest` | "finding the sunniest route" |
| `avoid_sun` | `avoid_wind` | `avoid-both` | "avoiding sun and wind" |
| `avoid_sun` | `neutral` | `avoid-sun` | "routing for shade" |
| `neutral` | `avoid_wind` | `avoid-wind` | "avoiding headwinds" |
| `neutral` | `neutral` | `no-preference` | "no specific preference" |

`intensity === 'high'` → multiplier `1.5`, else `1.0`; the toast verb is also intensified ("routing for **maximum** shade", "aggressively avoiding sun and wind", "avoiding **strong** headwinds").

`scaleWeights(weights, multiplier)` multiplies every field of an `HlciWeights` object — the route scorer reads the scaled weights without any other changes.

**`RouteSheet` conversational input** ([src/components/RouteSheet.tsx](src/components/RouteSheet.tsx))

New form below the filter pills, above the all-sunny warning + route list:

```
[ Describe your preference… e.g. I'm walking in a suit ]  [ ➤ ]
```

- 8 px high circular Send button colored with the live `dayAccent`, white icon (inline `<SendIcon />` SVG). Swaps to a spinner (`<SmallSpinner />`) while `geminiBusy === true`.
- Input bg `rgba(0, 0, 0, 0.04)`, border `var(--gma-border)`, `maxLength={140}`. Disabled while busy.
- Submit button disabled when input is empty or busy.
- `handlePreferenceSubmit` calls `onSubmitPreference(trimmed)` (host-supplied), then clears the input.

Two new props: `onSubmitPreference: (text: string) => Promise<void>` and `geminiBusy: boolean`.

**App.tsx wiring** ([src/App.tsx](src/App.tsx))

New state:

- `intensityMultiplier` (default 1.0) — applied via `scaleWeights(FILTER_PRESETS[filterMode], intensityMultiplier)` inside the `result` useMemo's `scoreAndRankRoutes` call.
- `geminiBusy` — surfaced to the sheet so its input + send button can disable themselves.

New handlers:

- `handleFilterChange(next)` — replaces the previous bare `setFilterMode`. Sets `filterMode` AND resets `intensityMultiplier` to 1.0. Manual pill clicks are always default-intensity; a subsequent Gemini submit may bump it back to 1.5.
- `handleSubmitPreference(text)` — sets `geminiBusy = true`, awaits `interpretPreference(text)`, then:
  - On success: applies `mapInterpretation(interp)` → updates `filterMode`, `intensityMultiplier`, and `toastMessage` ("Got it — …").
  - On null (any failure): shows `"Could not interpret preference — using current filter"` toast. Filter + intensity untouched.
  - Always clears `geminiBusy` in the `finally` block.

Active filter pill updates automatically when Gemini changes `filterMode` (it's already controlled by the same state), so the user sees what was interpreted. The Toast component reuses its existing top-center fade — Gemini's confirmation displaces any earlier "X% Cooler Route Selected" toast.

**`.env.example`** ([. env.example](.env.example))

Updated the `VITE_GEMINI_API_KEY` comment to reflect the new use site (`src/lib/geminiRouting.ts` instead of the now-deleted `a2uiClient.ts`), the model (2.5 Flash, not 2.0 Pro), and the graceful-degrade behavior when the key is absent.

**Demo script** (DevTools-friendly)

1. Type `I'm in a suit walking to a meeting`. → Gemini: `{ sunPreference: 'avoid_sun', windPreference: 'neutral', intensity: 'high' }` → filter pill flips to **Avoid Sun**, weights scale 1.5×, toast: "Got it — routing for maximum shade".
2. Type `I'm on a bike and it's windy`. → `{ neutral, avoid_wind, medium }` → **Avoid Wind**, multiplier 1.0, toast: "Got it — avoiding headwinds".
3. Type `find me a sunny patio`. → `{ want_sun, neutral, medium }` → **Sunniest**, toast: "Got it — finding the sunniest route".
4. Type gibberish (`asdf jkl;`). → Gemini still returns a valid JSON shape (probably `{ neutral, neutral, low }`), pipeline applies it. If the call ever does fail or the response is malformed, the fallback toast fires and the existing filter is left in place.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.41 MB main chunk, ~17 s)

### 2026-06-02 — Tree coverage fix for outer boroughs: expanded Overpass query + route-extent bbox + Solar-capacity fallback

Brooklyn residential blocks were reading as 0 trees from Overpass even though street trees are visibly there — OSM tags those trees inconsistently across boroughs, and the previous viewport-only bbox often missed routes that crossed into Brooklyn / Queens. Three layers of fix. `tsc -b` + `vite build` clean.

**1 · Expanded Overpass tree query** ([src/lib/overpass.ts](src/lib/overpass.ts))

The single union query now covers a wider set of tree-ish tags. The full body is logged verbatim on every fetch (`[GMA] Overpass query → …`) so the audience can paste it into overpass-turbo.eu to verify.

New tag coverage:

| Category | OSM tags included |
|---|---|
| Single trees | `node[natural=tree]` (canonical), `node[natural=tree_row]` (rare points), `node[street_tree=yes]`, `node[tree=yes]` (Brooklyn / Queens alt-tags) |
| Tree rows | `way[natural=tree_row]` |
| Forests / woods | `node[landuse=forest]`, `way[landuse=forest]`, `way[natural=wood]` |
| Parks + grass | `node[leisure=park]`, `way[leisure=park]`, `way[landuse=grass]` |
| (unchanged) Streets, buildings | `way[highway~"primary|secondary|tertiary|residential"]`, `way[building]` |

Way-level vegetation (parks, grass strips, tree rows, forests) now contributes to the canopy signal too — `scatterTreePoints(perimeter, trees, stepM)` sprinkles synthetic tree points along each way's perimeter at 12-m intervals (24 m for parks / grass — less dense) so the existing 15-m proximity check in the route-color classifier picks them up without a separate code path. Forest polygons still get their dedicated `forests[]` entry for the green fill overlay.

`categorize()` extended to recognize all four tree-ish point-tag variants. Synthetic tree points from ways append to the same `trees[]` array as OSM nodes.

**2 · Route-extent Overpass bbox + 500 m padding** ([src/App.tsx](src/App.tsx))

Replaced `viewportBbox` with `overpassBbox`:

- When `candidates.length > 0` → union extent of all candidate polylines + **500 m** padding on every side (`500 / 111_000` lat, `500 / 84_500` lng).
- Before any candidate exists → previous viewport-derived fallback (zoom-scaled padding, 3-decimal-rounded center for cache reuse).

This means trees on near-route side streets get fetched even when the route extends past the visible viewport — the Brooklyn-residential case where Manhattan-centered viewports missed everything beyond the East River. The 30-min Overpass cache TTL prevents the route-vs-viewport switch from re-billing on every pan.

**3 · Solar-capacity tree-canopy fallback** ([src/App.tsx](src/App.tsx), [src/hooks/useSolarAPI.ts](src/hooks/useSolarAPI.ts))

When Overpass still returns 0 trees (rate-limited / tag-coverage gap / bbox over water), the route classifier now synthesizes trees from the Solar API's nameplate-capacity signal.

- **`useSolarAPI`** now extracts `panelCapacityWatts` per `SolarSample`, computed as `solarPotential.panelCapacityWatts × solarPotential.maxArrayPanelsCount`. The per-panel rating alone is ~constant per imagery analysis, but the panel count (`maxArrayPanelsCount`) is suppressed on shaded roofs, so their product varies with shade. Per-sample table log now includes `panelCapacityW` so the audience can verify.
- **`treesForRouting` useMemo** in App.tsx: when `overpass.trees.length === 0`, take the Solar samples in the bottom 33 % of observed `panelCapacityWatts` and emit one synthetic tree at each sample's coords. Empty → empty (no synthetic trees if no Solar hits either). When OSM trees are present, the fallback is bypassed — OSM is always preferred.
- Synthetic trees are passed to both `colorizeRoute` (the visual) and `scoreAndRankRoutes` (the score) so the visual and score stay aligned per the prior consistency fix. The on-map tree-dot ScatterplotLayer still reads the raw `overpass.trees` (so synthetic dots don't appear in the wrong places — they're a routing signal, not a visual claim about specific trees).
- One-line log when the fallback fires: `[GMA] Trees fallback: OSM returned 0, synthesized N tree points from Solar API panelCapacityWatts (cutoff X W, bottom third of M hits)`.

**Verification flow**

1. Pick a Brooklyn destination from a Manhattan origin. Watch the console for `[GMA] Overpass query → …` and confirm the bbox now extends to Brooklyn.
2. `[GMA] Overpass returned in Xms: N streets, T trees, …` — `T` should now be non-zero on residential blocks thanks to the expanded tag set + way scattering.
3. If `T = 0`, the `[GMA] Trees fallback:` line surfaces, and route segments shaded by the Solar-capacity signal render as emerald tree-canopy.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.41 MB main chunk, ~32 s)

### 2026-06-02 — Wind routing that actually reorders routes: Venturi amplification end-to-end

Wind scoring was relying on bearing-only cost (`cos(bearing − windFrom)` length-weighted), which made route alternates score within a few percent of each other and the ranking barely budged when the user switched from "Avoid Sun" to "Avoid Wind". Now there's a proper Venturi-amplified pipeline: streets that run between tall buildings on both sides get a 1.5–3× multiplier on their wind facing, so canyon routes score genuinely worse and the avoid-wind / avoid-both filters produce visibly different rankings. `tsc -b` + `vite build` clean.

**Venturi amplifier** ([src/lib/venturi.ts](src/lib/venturi.ts) — new file)

Per CLAUDE.md §4 Module B:

```
v_local = v_ambient × (W_entry / W_canyon)
```

Implementation:

- Take the route segment's bearing θ, project each nearby building's centroid onto the perpendicular axis (θ + 90°), in meters.
- Split buildings by side (positive / negative perp dot); track the nearest on each side.
- `canyonWidth = leftDist + rightDist`. If either side is empty within `PERP_SEARCH_RADIUS_M = 60`, return amplifier `1.0` (one-sided street, intersection, park frontage).
- Otherwise `widthFactor = CANYON_BASELINE_M (100m) / canyonWidth`, `heightFactor = √(avgHeight / 30m)`. Amplifier = `clamp(1.0, 3.0, widthFactor × heightFactor)`.
- Centroid (vs nearest vertex) is the cheap approximation — for ~500 buildings × ~200 segments it's well under one frame and the precision is fine for canyon detection.

Exports `computeVenturiAmplifier(midLng, midLat, bearing, buildings)` (scalar) and `computeVenturiDiagnostic(...)` (scalar + the underlying `{canyonWidthM, leftDistM, rightDistM, avgHeightM}` for diagnostics).

**Wind exposure sampler** ([src/lib/routeExposureScoring.ts](src/lib/routeExposureScoring.ts))

New `sampleRouteWindExposure(polyline, windFromDeg, windSpeedMph, buildings)` returns:

```ts
interface RouteWindExposureResult {
  meanExposure: number;        // 0..1 length-weighted
  matches: RouteWindExposureMatch[];
  canyonSegments: number;       // amplifier > 1.05
}
```

Per segment:

```ts
windFacing  = max(0, cos(segmentBearing - windFromDeg));
amplifier   = computeVenturiAmplifier(midLng, midLat, bearing, buildings);
intensity   = clamp(0, 1, windSpeedMph / 20);
exposure    = clamp(0, 1, windFacing × amplifier × intensity);
```

Length-weighted average across segments. Skips at calm wind (`speedMph === 0` short-circuits to 0). Per-segment match record carries `{bearing, windFacing, amplifier, canyonWidthM, exposure}` for the per-route log.

**`hlciRouter` exposes wind exposure as a first-class field** ([src/lib/hlciRouter.ts](src/lib/hlciRouter.ts))

- `ScoredRoute.meanWindExposure: number | null` — set when the polyline has ≥2 points AND `windSpeedMph > 0`.
- `ScoredRoute.windCanyonSegments: number` — segments inside a Venturi canyon, for diagnostics.
- `RouteScoringContext.buildings: readonly Building[] | null` — new field; `scoreAndRankRoutes` passes it into `sampleRouteWindExposure`.
- `composeHlciCost(meanSunExposure, meanWindExposure, weights)` simplified — both sun and wind terms now come from per-segment exposure samples; the legacy in-file `meanWindCost` helper was deleted.
- Per-route console log adds a `Wind exposure` block inside the existing collapsed group: `{meanWindExposure, canyonSegments, totalSegments, windFromDeg, windMph, preview: [{seg, bearing, facing, amp, canyonM, exposure}, …]}`. Expand it and confirm the values differ across the three candidates — that's the proof the ranking has substance.
- New `WindComfortDirection = 'sheltered' | null` and `routeWindComfortPercent(route, allRoutes, direction)` — mirrors the sun helper but reads `meanWindExposure`. Returns absolute `(1 − exposure) × 100` for `'sheltered'`; relative-normalize fallback otherwise.

**Route coloring for wind mode** ([src/lib/routeColoring.ts](src/lib/routeColoring.ts))

- New signature: `colorizeRoute(polyline, mode, sunAz, sunElev, windFromDeg, windSpeedMph, trees, buildingShadows, buildings?, solarSamples?)`. The added `windSpeedMph` and `buildings` parameters are what make wind-mode segments inherit the same Venturi-amplified exposure as the wind score.
- Wind branch now uses the continuous-exposure threshold (`exposure > 0.5 → headwind`, else `sheltered`) instead of the previous binary `cos > 0`.
- Palette refreshed to Tailwind brand colors:
  - **Headwind**: `rgb(168, 85, 247)` violet-500
  - **Sheltered**: `rgb(16, 185, 129)` emerald-500
- `WindReason` renamed `'tailwind' → 'sheltered'` (perpendicular winds aren't tailwinds — "sheltered" is the honest label).
- Per-route log adds wind-specific counters: `{segments, headwind, sheltered, canyonSegments, windFrom, windMph, windIntensity}`.

**RouteSheet — wind condition labels** ([src/components/RouteSheet.tsx](src/components/RouteSheet.tsx))

`RouteCondition` extended with three wind-mode states. Mapping from `meanWindExposure`:

| Exposure | Condition | Color |
|---|---|---|
| `> 0.7` | **Strong headwind** | violet-500 |
| `0.3 – 0.7` | **Moderate wind** | muted gold |
| `< 0.3` | **Sheltered** | green |

Each `RouteCard` shows the wind condition + absolute percent (`routeWindComfortPercent`) when the active filter is `avoid-wind`. Sun filters keep the existing sun condition chip. Other filters render no chip (unchanged).

**RouteLegend wind variant** ([src/components/RouteLegend.tsx](src/components/RouteLegend.tsx))

New `mode?: 'sun' | 'wind'` prop. `'wind'` renders:

```
SHELTERED  [emerald → muted → violet]  WINDY
```

App.tsx passes `mode={coloringMode === 'wind' ? 'wind' : 'sun'}` so the legend tracks the active filter.

**SunCompass — wind direction arrow + speed/cardinal line** ([src/components/SunCompass.tsx](src/components/SunCompass.tsx))

Two new props: `windDirectionDeg`, `windSpeedMph`. When present:

- A violet arrow inside the sun disc points in the direction the wind is GOING (`windFromDeg + 180`), shorter than the sun arrow so the two don't compete.
- A new third footer line in violet: `WIND · 12 MPH · NE`. `compassCardinal()` snaps the degree value to 8-point compass labels.

Both default to null — when Weather hasn't returned yet, nothing extra renders.

**App.tsx wiring** ([src/App.tsx](src/App.tsx))

- `scoreAndRankRoutes` call passes `buildings: mergedBuildings` in the context — without this every wind segment would have amplifier 1.0 and rankings wouldn't move.
- `colorizeRoute` call passes `weather?.windSpeedMph ?? 0` and `mergedBuildings` so the visual matches the score.
- `<SunCompass />` receives the two new wind props.
- `<RouteLegend />` receives `mode` derived from `coloringMode`.

**Verification flow**

1. Pick origin + destination in Midtown (north–south route preferred — Venturi canyons run that direction).
2. Open DevTools, expand the per-route collapsed groups.
3. Under each route's `Wind exposure` block, confirm `canyonSegments > 0` and `meanWindExposure` varies across the three alternates (typically 0.2 – 0.6 spread).
4. Switch filter pill `Avoid Sun → Avoid Wind`. The top-ranked route changes; the route polyline color flips from amber/blue to violet/emerald, and the legend swaps `SHADED/SUNNY → SHELTERED/WINDY`.
5. RouteCard percent flips to `routeWindComfortPercent` with `Strong headwind / Moderate wind / Sheltered` chips.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.41 MB main chunk, ~23 s)

### 2026-06-02 — Precipitation routing (rain + snow, wind-driven exposure)

End-to-end "avoid walking into rain/snow" pipeline alongside the existing sun and wind routing. The Avoid Rain pill only appears when precipitation probability is non-trivial (≥ 20 %), and Avoid Both auto-includes precipitation when it's actually raining. `tsc -b` + `vite build` clean.

**Weather snapshot extension** ([src/hooks/useWeatherData.ts](src/hooks/useWeatherData.ts))

`WeatherSnapshot` gains:

```ts
precipitationProbability: number;  // 0..100
precipitationType: 'rain' | 'snow' | 'sleet' | 'none';
```

Normalization reads the precipitation block defensively across the v1-beta shapes Google has shipped — `precipitation.probability.{percent, type}`, `precipitation.probabilityPercent`, `precipitation.type` all considered. Type strings are uppercase-matched on substrings (`SNOW`, `SLEET`, `RAIN`) and fall back to `'none'`. Probability of 0 always forces type to `'none'` so a downstream `prob > 20 → show pill` check never sees a stale rain classification on a dry day.

**Precipitation exposure sampler** ([src/lib/routeExposureScoring.ts](src/lib/routeExposureScoring.ts))

```ts
sampleRoutePrecipExposure(polyline, windFromDeg, precipProbPct)
  → { meanExposure, matches }
```

Per segment: `max(0, cos(bearing − windFromDeg)) × (precipProb/100)`. Length-weighted average. Returns 0 when probability is 0. Per-segment match record carries `{bearing, windFacing, exposure}` for the per-route log.

The key insight: rain falls at the angle the wind drives it. A 70 %-probability rain with the wind out of the north means a route walking north has exposure ≈ 0.7; a route walking south has exposure 0.

**Scoring** ([src/lib/hlciRouter.ts](src/lib/hlciRouter.ts))

- `HlciWeights.rainAvoidance: number` — new cost axis.
- `ScoredRoute.meanPrecipExposure: number | null` — exposure value used by the UI percent helpers.
- `RouteScoringContext.precipitationProbability: number` — passed through to `sampleRoutePrecipExposure` inside the per-candidate loop.
- `composeHlciCost(sun, wind, precip, weights)` — fourth cost term added: `weights.rainAvoidance × meanPrecipExposure`.
- `RainComfortDirection = 'sheltered' | null` + `routeRainComfortPercent(route, allRoutes, direction)` mirror the sun/wind helpers: `'sheltered' → (1 − exposure) × 100` absolute; null falls back to relative normalize.
- New `Precipitation exposure` block inside the per-route collapsed console group: `{meanPrecipExposure, precipProbability, windFromDeg, preview: [{seg, bearing, facing, exposure}, …]}` — lets the audience see which candidate has more rain-facing segments.

**Route coloring for rain mode** ([src/lib/routeColoring.ts](src/lib/routeColoring.ts))

- New `ColoringMode = 'sun' | 'wind' | 'rain'`.
- New `PrecipReason = 'rain-exposed' | 'rain-sheltered' | 'snow-exposed' | 'snow-sheltered'` (added to `SegmentReason`) and matching `PRECIP_LABELS` for tooltips.
- `colorizeRoute` signature gains `precipitationProbability` + `precipitationType` params. The new rain branch computes per-segment exposure with the same formula as the sampler, then picks a color by snow vs rain:
  | Type | Sheltered (exposure ≤ 0.3) | Exposed (> 0.3) |
  |---|---|---|
  | rain / sleet | cyan-500 `#06B6D4` | slate-600 `#475569` |
  | snow | sky-200 `#BAE6FD` | blue-900 `#1E3A8A` |
- Threshold `PRECIP_EXPOSED_THRESHOLD = 0.3` (lower than wind's 0.5) — a 50 % chance of rain × moderate facing should already classify as exposed.
- Per-route log adds a rain-mode branch: `{segments, exposed, sheltered, precipProbability, precipitationType, windFrom, precipFactor}`.

**RouteSheet — Avoid Rain pill + condition labels** ([src/components/RouteSheet.tsx](src/components/RouteSheet.tsx))

- New filter mode `'avoid-rain'` with weight preset `{glareAvoidance:0, windAvoidance:0, shadePreference:0, rainAvoidance:1}`.
- `FILTER_META` adds `{label:'Avoid Rain', verb:'drier', accent:'rain'}` — the rain accent picks cyan for rain probability, lighter blue when type is snow.
- The pill is filtered out of `visibleFilters` when `precipitationProbability < RAIN_PILL_MIN_PROBABILITY = 20`. Exception: if the user already selected it, it stays visible so the choice doesn't disappear under them mid-session.
- `'avoid-both'` preset still defaults `rainAvoidance: 0` in the static table — but `App.tsx` bumps it to `0.6` at runtime when current `precipitationProbability > 20`.
- New `RouteCondition` values `rain-exposed | rain-sheltered | snow-exposed | snow-sheltered` with matching labels + colors. `exposureToPrecipCondition(exposure, type)` picks the right one based on `> 0.3` threshold and snow vs rain.
- Each RouteCard shows the precip condition chip + `routeRainComfortPercent` percent when the active filter is `avoid-rain`.

**RouteLegend rain variant** ([src/components/RouteLegend.tsx](src/components/RouteLegend.tsx))

New `mode='rain'` + optional `snow={true}` flag:

- Rain: `SHELTERED [cyan → muted-slate → slate-600] WET`
- Snow: `SHELTERED [sky-200 → lighter-blue → blue-900] SNOWY`

App.tsx passes `mode={coloringMode}` and `snow={weather?.precipitationType === 'snow'}`.

**SunCompass precipitation footer** ([src/components/SunCompass.tsx](src/components/SunCompass.tsx))

Two new props: `precipitationType`, `precipitationProbability`. When type !== 'none' and probability > 0:

- Footer line below the wind line: `[icon] RAIN · 65%` (or `SNOW · 80%`).
- Inline `<RaindropIcon />` for rain/sleet (teardrop SVG); `<SnowflakeIcon />` for snow (6-pointed star SVG).
- Colored cyan-500 for rain, blue-900 for snow.

**App.tsx wiring** ([src/App.tsx](src/App.tsx))

- `coloringMode` derivation extended: `filterMode === 'avoid-rain' → 'rain'`.
- `result` useMemo reads `weather?.precipitationProbability`, applies the Avoid-Both bump (`rainAvoidance: 0.6` when `prob > 20`), passes `precipitationProbability` into the scoring context.
- `colorizeRoute` call passes `weather?.precipitationProbability ?? 0` and `weather?.precipitationType ?? 'none'`.
- `<RouteSheet>` receives the two new precipitation props.
- `<SunCompass>` receives `precipitationType` + `precipitationProbability`.
- `<RouteLegend>` receives `mode` + `snow={precipType === 'snow'}`.

**`scaleWeights` updated** ([src/lib/geminiRouting.ts](src/lib/geminiRouting.ts))

Scales the new `rainAvoidance` field too so Gemini's `intensity: 'high'` 1.5× boost propagates through the rain cost axis as well.

**Verification flow**

1. Pick origin + destination on a day with active precipitation (>20% probability). The **Avoid Rain** pill appears in the filter row.
2. Console: per-route collapsed group now includes a `Precipitation exposure` block — confirm exposures differ across candidates (a route walking with the wind should be ≈ 0, against it ≈ 0.4–0.7 for 50–70% rain).
3. Activate **Avoid Rain** — route polyline flips to cyan / slate (rain) or sky-blue / deep-blue (snow). Legend swaps to `SHELTERED / WET` (or `/ SNOWY`). RouteCard shows `Rain sheltered` / `Rain exposed` chips.
4. SunCompass footer shows `[💧] RAIN · 65%` or `[❄] SNOW · 80%`.
5. Activate **Avoid Both** — the route ranking shifts when precipitation is present (rainAvoidance bumped to 0.6 internally). On a dry day, Avoid Both behaves identically to before.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.42 MB main chunk, ~11 s)

### 2026-06-02 — Glass building glare: specular reflection routing penalty

The CLAUDE.md headline effect — glass skyscrapers acting as parabolic solar mirrors, concentrating radiation onto specific sidewalk coordinates at ~+15°F "feels like" — is now live end-to-end. `tsc -b` + `vite build` clean.

**Classifier + hotspot projection** ([src/lib/glassGlare.ts](src/lib/glassGlare.ts) — new file)

`isGlassBuilding(building)` decides whether an Overpass `Building` is glass-clad, in priority order:

1. Explicit OSM tags: `building:material=glass`, `building:facade=glass`, `building:cladding=glass`.
2. `name` matches a known glass tower (substring, lowercase). Curated list: `one vanderbilt`, the `hudson yards` family, `salesforce tower`, the `world trade` towers, `432 park`, `central park tower`, `one57`, `time warner center`, `comcast tower`, `hearst tower`, `seagram building`, `lever house`, `lipstick building`, `53 west 53`, `220 central park south`, `111 west 57`, `jpmorgan chase tower`, `manhattan west`, `111 murray`, etc.
3. Untagged buildings with `start_date` / `construction:year` > 2000 → deterministic 30 % glass probability via `idHashProbability(id)` — same `id` always classifies the same way, so route coloring is stable across re-fetches.
4. Otherwise → false.

`computeGlareHotspot(building, sunAzimuth, sunElevation)` projects the reflected ray onto the ground:

- Skip when sun elevation < `MIN_SUN_ELEVATION_DEG = 10°`, building height < 12 m, or footprint has < 2 vertices.
- For each footprint edge, take the 90°-rotated edge vector as the candidate wall normal; flip if it points away from the sun. Pick the wall whose outward normal has the highest dot product with the sun direction.
- Mirror the incoming ray across the wall normal: `R = I − 2(I·N)N` in the horizontal plane.
- Vertical drop = half the building height (reflection happens mid-facade). Horizontal travel = `verticalDrop / tan(sunElevation)`, capped at `MAX_GLARE_DISTANCE_M = 60`.
- Hotspot coords = wall midpoint + reflected direction × horizontal distance. Returns `{lng, lat, buildingId, reflectionStrength, buildingHeightM}`.

`nearestGlareHotspot(lng, lat, hotspots, radiusM)` — bbox-prefilter + haversine compare. Used by the route classifier to decide whether a segment midpoint is in a glare zone.

**Building tag pass-through** ([src/lib/overpass.ts](src/lib/overpass.ts))

`Building` interface extended with optional `name?: string` and `tags?: Record<string, string>`. The `categorize()` parser now passes both through for OSM `way[building]` elements. Solar-derived synthetic buildings (from `useSolarAPI`) leave them undefined, so the glass classifier safely returns `false` for them.

**Route classification** ([src/lib/routeColoring.ts](src/lib/routeColoring.ts))

- New `SunReason` variant `'glare'` + matching `SunVia` value.
- `SunClassification.exposure` widened from `0 | 1` to `number` — glare segments emit `1.5` (`GLARE_SEGMENT_EXPOSURE`), penalized harder than direct sun in `composeHlciCost` (the mean can exceed 1, the UI percent display clamps to [0, 100]).
- `SunDiagnostic` gains `glareHotspot: { distanceM, buildingId, reflectionStrength } | null` so the tooltip / per-route log can surface which building's reflection hit which segment.
- `classifyWithDiagnostics` now takes an optional `glareHotspots` param and checks it FIRST among the daytime branches — a specular reflection physically wins over shadow / tree / solar / bearing. `GLARE_HOTSPOT_RADIUS_M = 20` is the segment-to-hotspot match threshold.
- `SUN_LABELS['glare']`: `"Glass glare — building reflection, +15°F feels like temperature"`. Surfaced as the tooltip on the route polyline.
- New `GLARE_RED` palette entry: `#DC2626` (red-600) at alpha 245. Per-route log adds `glare` counter alongside `buildingShadow`/`treeCanopy`/`solarApi`/`bearingFallback`.

**Scoring** ([src/lib/routeExposureScoring.ts](src/lib/routeExposureScoring.ts), [src/lib/hlciRouter.ts](src/lib/hlciRouter.ts))

- `RouteExposureMatch.exposure` widened to `number`; `RouteExposureBySource` gains `glare: number`.
- `sampleRouteExposure` takes an optional `glareHotspots` param and forwards it to `classifyWithDiagnostics`.
- `RouteScoringContext.glareHotspots: readonly GlareHotspot[] | null` — passed into the sampler. `meanSunExposure` can now exceed 1.0 on glare-heavy routes, and `composeHlciCost`'s sun term scales proportionally so the route ranks worse.

**Glare-hotspot overlay** ([src/components/GMACanvas.tsx](src/components/GMACanvas.tsx))

New `glareHotspots` prop + `glare-hotspots` `ScatterplotLayer`:

- Color `[255, 107, 53, 128]` (`#FF6B35` at 0.5 alpha).
- Radius 15 m, `radiusMinPixels: 6`, `radiusMaxPixels: 28`.
- Inserted after the tree-dots layer but BEFORE the route polyline, so the route's deep-red glare segments stay visible on top of the orange-red dots.
- `depthCompare: 'always'` so the dots always paint regardless of basemap depth.
- Layer is skipped entirely when `glareHotspots` is null / empty (no flickering empty layer).

**App.tsx wiring** ([src/App.tsx](src/App.tsx))

New `glareHotspots` useMemo:

- Returns `[]` (no glare layer) when sun elevation < 10° OR cloud cover > 80% OR no buildings. Two-line spec: meaningful glare needs a clear sky AND a sun high enough to specularly reflect.
- Otherwise filters `mergedBuildings` through `isGlassBuilding`, calls `computeGlareHotspot` per glass building, drops nulls.
- One-line log when hotspots are produced: `[GMA] Glass glare: projected N hotspots from M glass buildings (of T total) at sun XXX°/YY°`.

Wired downstream:

- `scoreAndRankRoutes` context gets `glareHotspots` so per-route scoring picks up the penalty.
- `colorizeRoute` call passes `glareHotspots` so visual segments turn red where the route crosses a hotspot.
- `<GMACanvas glareHotspots={glareHotspots} />` renders the on-map orange-red dots.

**Verification flow**

1. Pick origin + destination in Midtown (Hudson Yards or 6th Ave for guaranteed glass coverage), late morning / early afternoon for sun > 30°.
2. Console: `[GMA] Glass glare: projected N hotspots from M glass buildings…` — non-zero counts.
3. The map shows orange-red 15 m dots where reflected rays land. Hover a route segment that crosses one — tooltip says `"Glass glare — building reflection, +15°F feels like temperature"`.
4. Per-route `console.groupCollapsed` shows `glare` count > 0 in the `bySource` block; `meanSunExposure` can exceed 1.0.
5. Switch filter to **Avoid Sun** — routes that thread through fewer glare hotspots rank higher; the comfort-percent card updates to favor the glare-free option.
6. At night (sun elevation < 10°) or under heavy clouds (> 80% cover), the hotspot overlay disappears and route coloring reverts to the regular sun/shaded palette.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.42 MB main chunk, ~12 s)

### 2026-06-02 — Glass glare debug visibility + Geocoding-API actionable warning + .env.example API checklist

Two small but high-leverage debugging fixes following the glass-glare integration. `tsc -b` + `vite build` clean.

**Glass glare: always-on inputs log** ([src/App.tsx](src/App.tsx))

Previously the only log was a one-liner that fired iff at least one hotspot got projected. When the layer came up empty there was no way to tell whether the cloud gate, the sun gate, the buildings array, or the classifier was the cause.

`glareHotspots` useMemo now logs on every recompute:

```
[GMA] Glass glare: inputs {
  sunElevationDeg, sunAzimuthDeg,
  cloudCoverPct,
  totalBuildings, osmBuildings, glassBuildings,
  gateSunOK, gateCloudOK, gateBuildingsOK
}
```

Followed by exactly one of:

- `SKIPPED — sun elevation X° < 10°`
- `SKIPPED — cloud cover X% > 80%`
- `SKIPPED — no buildings available yet (Overpass + Solar API both empty; waiting for fetch). This is the common cause of "no log appears" on first load — the memo runs early before Overpass returns.`
- `SKIPPED — 0 of N buildings classified as glass. Check OSM tags (building:material=glass / known-tower name); untagged buildings fall back to a hash-based 30 % probability so SOME should match.`
- `projected H hotspots from G glass buildings (D dropped — short / no sun-facing wall / footprint < 2 pts), of N total buildings, at sun XXX°/YY°.`

Added `overpass.buildings.length` to the dep array so the memo refires when Overpass returns and the building array transitions from empty → populated (covers the suspected "ran too early" case).

**Geocoding API: actionable error specificity** ([src/lib/geocoding.ts](src/lib/geocoding.ts))

When Google Geocoding returns `REQUEST_DENIED` with an error_message matching `not authorized|not enabled|API not enabled|API key not valid`, the warning now reads:

> Geocoding API is NOT ENABLED on this Google Cloud project. Enable "Geocoding API" at https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com so origin auto-fill gets a real street address instead of the Nominatim fallback. (Google returned: status=REQUEST_DENIED, message="…")

For any other `status !== 'OK'` the previous generic warning fires. Either way the function returns null and the call site falls through to Nominatim, so the app continues to work — but now the console tells the user exactly what to do.

**`.env.example`: full GCP API checklist** ([. env.example](.env.example))

Expanded the `VITE_GOOGLE_MAPS_API_KEY` block from a single comma-separated line into a numbered checklist with the direct console-library URL per API:

1. Map Tiles API — 3D photorealistic tileset
2. Routes API — directions
3. Places API — SearchBar autocomplete
4. **Geocoding API** — reverse-geocoding origin auto-fill (without this → Nominatim fallback)
5. Weather API — wind, cloud, precipitation
6. Solar API — per-building annual sunshine (proxied via `/api/solar`)

Each entry links straight to `https://console.cloud.google.com/apis/library/<library>.googleapis.com` so the user can enable them with one click each. Also notes a billing budget alert recommendation.

**Verification flow**

1. Pick origin + destination. Watch DevTools:
   - **Glass glare**: every memo recompute prints the `inputs` block. Track down which gate is failing. The most common is `totalBuildings: 0` on first load — wait for the next compute after `[GMA] Overpass returned in Xms: …` lines.
   - **Geocoding**: if Google is the problem, the log now says exactly what to click. If you see `[GMA] Nominatim geocoded:` without a Google warning, the API is enabled but returning zero results (which can happen for rural / off-road coordinates).
2. After enabling Geocoding API in the GCP console, hard-refresh the page. The next geolocation auto-fill should log `[GMA] Google geocoded: …` with a real street address; Nominatim line should not appear.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.42 MB main chunk, ~13 s)

### 2026-06-02 — Glass glare: switch to effect + state; classifier-reason diagnostic

The always-on input log added in the previous turn revealed the obvious: `glareHotspots` was rendering on the first paint with `totalBuildings: 0`. A useMemo computes synchronously during render, so it ran before Overpass returned — and although the dep array meant it would re-run when buildings arrived, the user wanted the timing to be explicit and gated. Refactored to `useState` + `useEffect` so the compute only fires when all three gates pass. `tsc -b` + `vite build` clean.

**`classifyGlassReason` helper** ([src/lib/glassGlare.ts](src/lib/glassGlare.ts))

Promoted the boolean `isGlassBuilding` to a tagged-union returner:

```ts
type GlassReason =
  | 'tag-material'   // building:material=glass
  | 'tag-facade'      // building:facade=glass
  | 'tag-cladding'    // building:cladding=glass
  | 'name-match'      // name contains a KNOWN_GLASS_TOWERS entry
  | 'modern-probabilistic'; //  start_date>2000 + 30% id-hash

function classifyGlassReason(building):
  | { reason: GlassReason; detail: string }  //  matched
  | null                                       // not glass
```

`detail` carries an audit string like `building:material=glass`, `name "30 Hudson Yards" matched known tower "30 hudson yards"`, or `start_date=2019, id hash within 30% probability cohort`. `isGlassBuilding` retained as a thin convenience over `classifyGlassReason(b) !== null`.

**`useState` + `useEffect` replacement** ([src/App.tsx](src/App.tsx))

```ts
const [glareHotspots, setGlareHotspots] = useState<GlareHotspot[]>([]);
useEffect(() => {
  // 1. log gate inputs every fire
  // 2. EARLY RETURN (no setState) when buildings.length === 0 — leaves
  //    state at whatever it was before (typically still [])
  // 3. EARLY RETURN with setGlareHotspots([]) when sun / cloud gate fails
  // 4. classify; console.table the first 12 matches with reason + detail
  // 5. computeGlareHotspot per match; setGlareHotspots(result)
}, [overpass.buildings, solar.azimuthDeg, solar.elevationDeg, weather?.cloudCoverPct]);
```

Key behavioral notes:

- **Iterating `overpass.buildings` directly, not `mergedBuildings`** — Solar-derived synthetic buildings have neither tags nor name nor `start_date`, so they could never classify as glass under any rule. Pulling the source straight from Overpass also simplifies the dep array.
- **Empty-buildings branch returns WITHOUT touching state** — that way the on-screen hotspot layer doesn't flicker between empty and populated during the initial fetch.
- **Sun / cloud gate failures DO call `setGlareHotspots([])`** — when conditions change to "no glare possible", any stale dots clear.
- **Classifier diagnostic via `console.table`** — first 12 matches with `{id, name, heightM, reason, detail}` columns. Lets the user verify the classifier is hitting real Midtown towers (One Vanderbilt, Hudson Yards, 30 HY etc.) by name match, not just hash-roulette guesses.
- **Success log**: `[GMA] Glass glare: computed N hotspots from G glass buildings (D dropped — short / no sun-facing wall / footprint < 2 pts), at sun XXX°/YY°.`

**Expected DevTools sequence on first load** (Midtown, midday)

1. `[GMA] Glass glare: gate check { ..., osmBuildings: 0, ... }`
2. `[GMA] Glass glare: waiting — OSM buildings array is still empty (Overpass not back yet).`
3. *(several seconds later — Overpass debounce + fetch)*
4. `[GMA] Overpass returned in 1240ms: 87 streets, 14 trees, 412 buildings, 2 forests/woods`
5. `[GMA] Glass glare: gate check { ..., osmBuildings: 412, gateBuildingsOK: true, ... }`
6. `[GMA] Glass glare: classifier matched 38 of 412 buildings`
7. *(table with the 12 most informative matches)*
8. `[GMA] Glass glare: computed 17 hotspots from 38 glass buildings (21 dropped — short / no sun-facing wall / footprint < 2 pts), at sun 165°/64°.`

If step 6 shows `0 of N`, the classifier isn't finding glass tags / known towers / post-2000 buildings in the viewport — most likely a tag-coverage gap in OSM for that area.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.42 MB main chunk, ~12 s)

### 2026-06-02 — Glass glare: planned-time cloud-cover default

The glare effect was reading live `weather.cloudCoverPct` regardless of whether the user had picked a future departure / arrival time. On an overcast morning the gate would suppress glare even when the user was planning a 4 pm walk under (likely) clearer skies. Fixed. `tsc -b` + `vite build` clean.

**`cloudSource` switch** ([src/App.tsx](src/App.tsx))

Inside the glare `useEffect`:

```ts
const cloudSource: 'live' | 'planned-default' =
  plannedTime != null ? 'planned-default' : 'live';
const cloudCover =
  cloudSource === 'planned-default' ? 30 : (weather?.cloudCoverPct ?? 0);
```

- `plannedTime === null` (Leave-now mode) → live Weather API value.
- `plannedTime !== null` (Leave at / Arrive by) → fixed **30 %**, a clear-sky-leaning default that keeps glare visible for future-time demos.
- 30 % is below the 80 % cutoff, so the gate always passes from the cloud side when planning ahead. If the demo later wires hourly forecasts, this constant becomes the natural seam to swap in `forecast[plannedTime].cloudCoverPct`.

**Diagnostic** — the existing `[GMA] Glass glare: gate check` log now also reports `cloudSource: 'live' | 'planned-default'` so the user can verify which path the effect took without inspecting state.

**Deps update**

`plannedTime != null` (boolean) added to the `useEffect` dep array. The effect refires whenever the user toggles in or out of Leave-now mode. The actual `plannedTime` Date object isn't a dep — we don't care about the exact time for cloud sourcing, only whether it's set; the existing `solar.azimuthDeg` / `solar.elevationDeg` deps already cover the sun-position changes that flow from picking a specific time.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.42 MB main chunk, ~15 s)

### 2026-06-02 — Deployment prep: keyboard nav, PWA icons, perf-audit annotations

Pre-Netlify pass: a11y + installability + performance posture buttoned up. `tsc -b` + `vite build` clean.

**Keyboard navigation in the autocomplete dropdown** ([src/components/SearchBar.tsx](src/components/SearchBar.tsx))

`PlaceField` gains a `highlightedIdx` state and an `onKeyDown` handler:

- **ArrowDown** — moves highlight one item down, wraps from last → first. Opens the dropdown if it was closed but suggestions exist.
- **ArrowUp** — moves highlight up, wraps first → last.
- **Enter** — selects the highlighted suggestion. When nothing is highlighted (idx = −1), selects the first suggestion as the convenient default.
- **Escape** — closes the dropdown, resets highlight, blurs the input.
- **Mouse hover** — also updates `highlightedIdx` so the keyboard + mouse states stay in sync.

Highlight visual: `background: rgba(0, 0, 0, 0.05)` on the active row.

Accessibility — the input is now a `role="combobox"` with `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`. The dropdown is `role="listbox"`; each option is `role="option"` with `aria-selected`. Screen readers announce the highlighted suggestion as you arrow through.

`highlightedIdx` resets to −1 whenever a fresh result set arrives, the input is cleared, or Escape fires.

**PWA installable icons** ([public/icons/icon.svg](public/icons/icon.svg), [public/manifest.json](public/manifest.json), [vite.config.ts](vite.config.ts), [index.html](index.html))

- New `public/icons/icon.svg` — a 512×512 viewBox stylized illustration of the app: sky-gradient background, amber sun (`#FFB84D → #F59E0B → #D97706`), two glass-tower silhouettes (`#1E3A8A` with `#3B82F6` window grid), plus a small amber specular-glare patch on the near tower's east face. Encodes the project's headline effect in the icon itself.
- `public/manifest.json` updated with the icon entry `{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }`. `theme_color` flipped from the legacy dark `#080810` to `#ffffff` to match the current light UI; `background_color` set to `#f1f3f4` (matches `--gma-bg`).
- `vite.config.ts` PWA manifest config mirrored to keep the plugin-generated `manifest.webmanifest` consistent with the static one. `includeAssets: ['icons/icon.svg']` adds the icon to the workbox precache (precache count went 5 → 6).
- `index.html` head:
  - `<meta name="theme-color">` updated to `#ffffff`
  - `<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">` (modern browsers)
  - `<link rel="apple-touch-icon" href="/icons/icon.svg">` (iOS 16+ home-screen install)
  - `<link rel="mask-icon" href="/icons/icon.svg" color="#F59E0B">` (Safari pinned tabs)
  - `<link rel="manifest" href="/manifest.json">` (explicit reference for browsers that don't pick up the plugin's webmanifest)

For older iOS devices that don't support SVG apple-touch-icon, the docstring on `icon.svg` notes to run `npx pwa-asset-generator public/icons/icon.svg public/icons` to fill in PNG fallbacks at production time.

**Performance audit — three callouts confirmed memoized**

The user's three named hotspots were already memoized — each annotated with an explicit `PERF:` comment that documents the dep-array invalidation triggers:

| Computation | Mechanism | Refire trigger |
|---|---|---|
| Street coloring (`streetExposures`) | `useMemo` | new Overpass streets / sun-position tick / cloud-cover update |
| Building shadow projection (`buildingShadows`) | `useMemo` | merged buildings change / sun azimuth or elevation change |
| Glass-glare hotspots (`glareHotspots`) | `useState` + `useEffect` (effect-driven so it can gate on async Overpass arrival; doesn't compute or commit until all sun/cloud/buildings gates pass) | same plus `plannedTime` toggle for the cloud-source switch |

Render-path verification (`grep useMemo|useEffect src/App.tsx`):

- All derived collections (`streetExposures`, `candidatePolylines`, `treesForRouting`, `mergedBuildings`, `buildingShadows`, `result`, `coloredSegments`, `routeProgress`, `nextTurn`) live in `useMemo`.
- All async side-effects (route fetch, Solar API trigger, Overpass debounce, follow-cam, navigation derivations, glare computation) live in `useEffect`.
- No per-render expensive work in the JSX body; the deck.gl layer array is itself memoized inside `GMACanvas`.

**Netlify configuration verified** ([netlify.toml](netlify.toml))

Already in place from the Solar-proxy turn. Build command `npm run build`, publish `dist`, functions `netlify/functions`. The `/api/solar` → `/.netlify/functions/solar` redirect (status 200, force true) keeps the production frontend's `fetch('/api/solar?…')` working without any client-side path changes. Set `GOOGLE_MAPS_API_KEY` in the Netlify dashboard (NOT in this file — committed env vars would leak the key).

**Production build output**

```
dist/registerSW.js              0.13 kB
dist/manifest.webmanifest       0.39 kB
dist/index.html                 1.43 kB │ gzip: 0.69 kB
dist/assets/index-….css        23.57 kB │ gzip: 5.28 kB
dist/assets/index-….js       1425.18 kB │ gzip: 414.29 kB
PWA precache: 6 entries (1416 KiB)
```

Single ~414 kB gzipped main chunk — within tolerance for the demo. Future code-splitting on deck.gl would knock another ~150 kB off the initial-paint cost; deferred to post-demo.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.42 MB main chunk, ~21 s)

### 2026-06-02 — Street overlay full-viewport bbox + production build verified

Two follow-up fixes after the deployment-prep pass. `tsc -b` + `vite build` + `npm run build` (from a clean `dist/`) all complete with no errors.

**Street-sun overlay now covers the entire visible map** ([src/App.tsx](src/App.tsx))

The no-candidates branch of `overpassBbox` was a fixed-pad square around `viewState.{lat,lng}` — `pad ≈ 0.015°` at zoom 14, i.e. a ~3.3 × 3.3 km box centered on the map. On landscape monitors that's narrower than the visible viewport, so the street-sun overlay appeared in only a small box.

Rewrote to compute true viewport bounds from live window dimensions:

```ts
const metersPerPixel =
  (EARTH_CIRC_M × cos(lat)) / (TILE_SIZE_PX × 2^zoom);
const halfWidthM  = (windowSize.w / 2) × metersPerPixel + 200; //  200 m ring
const halfHeightM = (windowSize.h / 2) × metersPerPixel + 200;
halfLngDeg = min(0.06, halfWidthM / 84_500);   //  cap at 0.06° per side
halfLatDeg = min(0.06, halfHeightM / 111_000); //  (Overpass query safety)
```

- New `windowSize` state + one `resize` listener — cheap, fires once per resize, not per render or per frame.
- 3-decimal-rounded center retained so the per-bbox cache (`src/lib/overpass.ts`) still catches small pans without re-fetching.
- Per-side cap `OVERPASS_MAX_HALF_DEG = 0.06` prevents a zoom-out from dumping a continent-scale query at the public Overpass endpoint.
- Pad of 200 m beyond the visible canvas so streets at the very edge of the viewport are still fetched.
- WITH candidates branch unchanged — still route-extent + 500 m.
- Removed the now-unused `OVERPASS_MIN_PAD_DEG` / `OVERPASS_MAX_PAD_DEG` constants and the local `clamp` helper.

**Production build verified for Netlify** (`npm run build` from a clean `dist/`)

```
dist/
├─ index.html               1.43 kB  (gzip 0.69 kB)
├─ manifest.json            445 B    (static; linked from index.html)
├─ manifest.webmanifest     391 B    (plugin-generated)
├─ registerSW.js            134 B    (service-worker bootstrap)
├─ sw.js                   1.16 kB
├─ workbox-9c191d2f.js    15.11 kB
├─ assets/
│   ├─ index-….css         23.59 kB (gzip 5.29 kB)
│   └─ index-….js        1425.61 kB (gzip 414.51 kB)
└─ icons/
    └─ icon.svg            3.07 kB
```

- TSC: clean
- Vite: clean (1422 modules, ~10 s wall clock from a cold `dist/`)
- PWA precache: 6 entries, 1416.76 KiB total
- No console errors; the sole stderr is the standard deck.gl 500-kB-chunk advisory (informational only — common across deck.gl apps and tolerable for the demo).
- Ready to push to Netlify: `netlify.toml` at repo root carries the build command, publish dir, functions dir, and the `/api/solar` → serverless redirect. Set `GOOGLE_MAPS_API_KEY` + `VITE_GEMINI_API_KEY` in the Netlify dashboard before the first deploy.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.42 MB main chunk, ~10 s)

### 2026-06-02 — Mobile layout pass (375 px iPhone SE target)

Live deploy at https://neon-empanada-9d30e9.netlify.app was broken on phone screens. Every floating control resized + repositioned for mobile-first; all touch targets bumped to ≥ 44 × 44 px per Apple HIG / Material guidance. `tsc -b` + `vite build` clean.

**Width pattern adopted everywhere**

`w-[min(<desktop-max>, calc(100vw - 2rem))]` — fills the viewport minus 16 px on each side on mobile, caps at the desktop max. Replaces the previous `w-[min(440px, 92vw)]` pattern that left awkward gutters at narrow widths.

**Per-component changes**

| Component | Mobile width | Touch height | Notes |
|---|---|---|---|
| [SearchBar](src/components/SearchBar.tsx) | `min(460px, 100vw − 32)` | inputs `h-12` (py-3) | `top-[calc(env(safe-area-inset-top)+1rem)]` |
| [TransportModeSwitcher](src/components/TransportModeSwitcher.tsx) | `max-w-[100vw − 32]`, `overflow-x-auto` | pills `h-11 w-14` (44 × 56) | repositioned to `top-[insetTop+9.5rem]` to clear taller SearchBar |
| [TimePicker](src/components/TimePicker.tsx) | `min(300px, 100vw − 32)` | trigger `h-11`, mode options `min-h-[44px]` | `top-[insetTop+13.5rem]` |
| [RouteLegend](src/components/RouteLegend.tsx) | unchanged content | n/a | `top-[insetTop+17rem]` (was 13.5rem) to clear the new stack |
| [RouteSheet](src/components/RouteSheet.tsx) | `min(440px, 100vw)` | filter pills `min-h-[44px]`, RouteCard `min-h-[64px]`, Start button `h-14`, close button `h-11 w-11` | `flex flex-col max-h-[60dvh] sm:max-h-[75dvh]`; warning + cards wrapped in `flex-1 overflow-y-auto` so Start button stays pinned to the bottom |
| [SunCompass](src/components/SunCompass.tsx) | unchanged | n/a | disc `h-[70px] w-[70px] sm:h-[88px] sm:w-[88px]`; hides on mobile via `max-sm:hidden` when `routeSheetOpen` |
| [MapViewSwitcher](src/components/MapViewSwitcher.tsx) | unchanged | buttons `min-h-[44px] min-w-[44px]` | same `max-sm:hidden` when sheet open |
| [NavigationHeader](src/components/NavigationHeader.tsx) | mobile `left-4 right-[5.5rem]` (full-width minus stop-button column); desktop `min(460px, 100vw − 7rem)` centered | bar + Stop button both `h-12` | Stop button gains `min-w-[64px]` |
| [NextTurnIndicator](src/components/NextTurnIndicator.tsx) | `min(460px, 100vw − 32)` | pill `h-14` | bottom inset `+1rem` (was `+2.5rem`) so it sits closer to the home-indicator safe area |

**Sheet open / mobile chrome interaction**

`sheetOpen` (boolean derived from origin + destination present) now flows into SunCompass and MapViewSwitcher as `routeSheetOpen`. Both components apply `max-sm:hidden` when true — the bottom sheet is full-width on mobile and would overlap the corner controls; they're hidden until the user dismisses or starts navigation.

On desktop (`sm:` and up, ≥ 640 px) the sheet is 440 px wide centered, leaving the bottom-left + bottom-right corners free, so both controls stay visible.

**RouteSheet height management**

Outer container: `flex flex-col max-h-[60dvh] sm:max-h-[75dvh]`. Inner sections by role:

```
┌─ shrink-0  drag handle + filter pills + conversational input
├─ flex-1 overflow-y-auto: warning + route list
│  (scrolls when content overflows the 60dvh cap)
└─ shrink-0  Start button + safe-area inset
```

Start always reachable without scrolling past the cards.

**Verification at 375 × 667 (iPhone SE)**

1. SearchBar fills with 16 px gutters; inputs comfortable thumb size.
2. Transport pills stack centered, scrollable if all 4 don't fit.
3. TimePicker centered below the pills, full pill stretches to 300 px.
4. RouteSheet covers bottom 60 % of viewport with internal scroll; filter pills scroll horizontally; route cards 64 px tall; Start button is 56 px and full width.
5. SunCompass + MapViewSwitcher hidden while sheet is open; visible the moment the user closes destination.
6. Navigation: header bar + Stop button side-by-side at top, next-turn pill 56 px tall at the bottom above the home-indicator inset.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.43 MB main chunk, ~16 s)

### 2026-06-03 — Mobile performance pass: lazy-load, smaller queries, longer caches, defer work, skeleton

The Netlify deploy was sluggish on phone-grade hardware — every map load fired Overpass + Solar + per-frame work for streets the user might never look at. Eight changes in one pass to cut the cold-start cost. `tsc -b` + `vite build` clean.

**1. Lazy-load Overpass — only after a destination is picked** ([src/App.tsx](src/App.tsx))

`useOverpassData(overpassEnabled ? overpassBbox : null, …)` with `overpassEnabled = destination !== null`. Before a destination exists the hook keeps its `EMPTY` shape and `status: 'idle'` — no network, no debounce timer, no overpass-side state. The no-destination map load is now basemap-only.

**2. Smaller default Overpass query — primary + secondary only** ([src/lib/overpass.ts](src/lib/overpass.ts), [src/hooks/useOverpassData.ts](src/hooks/useOverpassData.ts))

New `OverpassFetchOptions.extendedStreets?: boolean`:

| Mode | Highway regex | When |
|---|---|---|
| lean (default) | `^(primary\|secondary)$` | before any route candidates |
| extended | `^(primary\|secondary\|tertiary\|residential)$` | once `candidates.length > 0` |

App.tsx passes `extendedStreets = candidates.length > 0`. The lean query returns roughly an order of magnitude fewer ways in dense Midtown — first-fetch budget drops dramatically. Cache key now includes the variant (`<bbox>#lean` vs `<bbox>#ext`) so switching to extended after the user picks a destination triggers one fresh fetch, then both keys are warm.

**3. Debounce 2 s → 3 s** ([src/hooks/useOverpassData.ts](src/hooks/useOverpassData.ts))

`DEBOUNCE_MS = 3_000`. Aggressive pan/zoom on mobile (where momentum scrolling can fire dozens of viewState updates over a few seconds) now collapses to a single fetch.

**4. Cache TTLs extended** ([src/lib/overpass.ts](src/lib/overpass.ts), [src/hooks/useSolarAPI.ts](src/hooks/useSolarAPI.ts))

- Overpass: `30 min → 2 h`. A second session within two hours hits the cache.
- Solar API: previously had no TTL, just a forever-Map. Wrapped each entry in `{promise, fetchedAt}` with `CACHE_TTL_MS = 60 * 60 * 1000` (1 hour). Solar samples don't meaningfully change over an hour; the cache wins now also reduce metered API spend.

**5. Solar API: fewer + sparser samples** ([src/hooks/useSolarAPI.ts](src/hooks/useSolarAPI.ts))

- `SAMPLE_INTERVAL_M: 200 → 400` (one sample per ~400 m along the route)
- `MAX_SAMPLES_PER_BATCH: 50 → 15` (cap across all candidate polylines combined)

A typical 3-route NYC selection used to bill ~50 Solar API calls; now ≤ 15. Median first-paint shaves ~3 s on a flaky cell connection.

**6. Defer street-sun overlay computation until route exists** ([src/App.tsx](src/App.tsx))

`streetExposures` useMemo now short-circuits to `[]` when `candidates.length === 0`. The `colorizeStreets` pass (per-segment bearing dot + color synthesis over hundreds of OSM streets) doesn't run on the no-destination load. GMACanvas already skipped the street-sun PathLayer when `streetExposures.length === 0`, so this just makes the upstream cheap too.

**7. Route-corridor building filter for shadows** ([src/lib/buildingShadows.ts](src/lib/buildingShadows.ts), [src/App.tsx](src/App.tsx))

New `filterBuildingsNearPolyline(buildings, polyline, radiusM)` — bbox prefilter at the route extent (padded by `radiusM`), then per-footprint-vertex distance check against each polyline vertex. Kept any building with at least one vertex within `radiusM` of the route.

App.tsx feeds shadow projection through this filter at 200 m radius, using the union of all candidate polylines (so flipping between routes doesn't require a refilter). In dense Midtown that drops `projectShadows` input from ~3 000 polygons to typically 100–300 — projection runs in well under a frame even on a phone.

The `mergedBuildings` array is still the full set for the glass-glare classifier (which runs once per Overpass fetch in a `useEffect`, not per frame). Only the per-sun-tick shadow projection sees the filtered subset.

**8. Skeleton route cards while loading** ([src/components/RouteSheet.tsx](src/components/RouteSheet.tsx))

New `SkeletonRouteCard` component: 64 px-tall placeholder matching the real RouteCard's layout (avatar circle, two text bars, percent pill), styled with `animate-pulse` via Tailwind. The route-sheet loading state now renders three of these underneath the "Finding routes…" spinner line. The sheet feels populated and responsive even while the Routes API + Solar API are still in flight.

**Verification cold-start sequence**

1. App opens → basemap tiles only. No Overpass log, no Solar log, no street overlay, no shadows. `[GMA] Glass glare: gate check` still logs (it's gated separately on sun + cloud + buildings, and buildings is still empty).
2. User picks origin via geolocation auto-fill. Still no Overpass — destination is the gate.
3. User picks destination. After 3 s debounce: `[GMA] Fetching Overpass data … bboxKey: …#lean`. Lean query returns ~tens of streets in seconds.
4. Routes API returns candidates → `extendedStreets` flips true → second Overpass fetch (`…#ext`) for the full highway tier set. `streetExposures` populates and the on-map street overlay appears.
5. Solar API fires for ≤ 15 unique coords across all candidates.
6. Shadow projection runs on the ~150 buildings within 200 m of any candidate polyline (not the full 3 000-building viewport).

**Build**

- `tsc -b` clean
- `vite build` clean (~1.43 MB main chunk, ~12 s)

### 2026-06-03 — RouteSheet redesign: Fastest vs GMA-pick comparison cards

Replaced the ranked-list of three identical route cards with a Google-Maps-style "Fastest vs comfort" comparison — the demo now reads as "this is what Google Maps gives you, this is what GMA recommends, and here's exactly the trade-off." `tsc -b` + `vite build` clean.

**Two-card layout** ([src/components/RouteSheet.tsx](src/components/RouteSheet.tsx))

The route-list region now branches on whether the fastest route is also the GMA pick:

- **Distinct case** (the interesting one):
  1. Fastest card — clean white background, grey **FASTEST** badge, time / km / via-street, comfort percent + condition chip on the right.
  2. Comparison line — `Save 2 minutes OR save 40 % sun exposure — your choice.`
  3. GMA pick card — left amber stripe + soft amber fill (cyan or violet for rain / wind filters), amber **GMA PICK** badge with a sun / wind / rain icon, same time + via line plus a one-line explanation underneath: `+2 min · 40 % less sun exposure`.
  4. Collapsible `More options (N)` — taps to expand the remaining candidates.
- **Combined case** (fastest = GMA pick):
  1. Single card carrying BOTH badges.
  2. Reassuring green line: `Great news — the fastest route is also the most comfortable right now.`
  3. Same collapsible More options below.

Cards stay clickable to select; the existing `selectedRouteIdx` plumbing carries through, so Start still uses whichever card the user picks.

**`RouteCard` variants**

```ts
type CardVariant = 'fastest' | 'gma' | 'combined' | 'other';
```

Visual axes that change with variant:
- Background — white for `fastest`, faint amber (`rgba(245, 158, 11, 0.04)`) for `gma` / `combined`, near-white grey for `other`.
- Left accent stripe (4 px inset shadow) — amber for `gma` / `combined`, transparent otherwise.
- Badges row — `Fastest` chip for fastest+combined, `GMA Pick` chip with filter icon for gma+combined.
- Explanation line — rendered under the via-street row only when present (only the gma variant supplies it).

`GMA Pick` chip background is filter-aware:

| Filter | Chip background |
|---|---|
| `avoid-sun` / `avoid-both` / `sunniest` / `no-preference` | amber-500 `#F59E0B` |
| `avoid-wind` | violet-500 `#A855F7` |
| `avoid-rain` | cyan-500 `#06B6D4` |

Icon is `PickSunIcon` / `WindLeafIcon` / `PickRainIcon` — all 10 × 10 px inline SVGs.

**Delta math** (`computeExposureDelta`)

```
f = fastest.mean<Sun|Wind|Precip>Exposure
c = comfort.mean<Sun|Wind|Precip>Exposure

if (f < 0.01)        return null  // can't normalize
rawDiff = direction === 'less' ? f − c : c − f
pct = round(rawDiff / f × 100)
if (pct < 5)         return null  // not a meaningful gap to advertise
```

Per filter:

| Filter | Exposure field | Direction | Label |
|---|---|---|---|
| `avoid-sun` | `meanSunExposure` | less | `sun` |
| `avoid-wind` | `meanWindExposure` | less | `wind` |
| `avoid-rain` | `meanPrecipExposure` | less | `rain` |
| `avoid-both` | average of sun + wind | less | `sun + wind` |
| `sunniest` | `meanSunExposure` | more | `sun` |
| `no-preference` | — (returns null) | — | — |

`buildGmaExplanation(timeDeltaMin, expDelta)` formats `+X min · Y% {less|more} {label} exposure`. ComparisonLine formats `Save {X minutes|no extra time} OR save Y% {label} exposure — your choice.` Both gracefully degrade to null when there's no meaningful delta (e.g., no-preference filter, or the fastest is within 5 % exposure of the comfort pick).

**`MoreOptionsSection`**

Collapsible button — `More options (N)` / `Hide options` with a rotating chevron. When expanded, renders the remaining routes as `variant='other'` (white background, no accent stripe, no badges) so the visual hierarchy stays clear.

**State** — single `showMoreOptions: boolean` in RouteSheet. Doesn't reset on filter change since the user probably wants the same expand/collapse preference; resets implicitly when the sheet unmounts (origin / destination cleared).

**Touch targets** preserved from the previous mobile pass — all cards 64 px min height, More-options button 44 px, badges sized appropriately for thumbs.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.43 MB main chunk, ~19 s)

### 2026-06-03 — Human-readable "feels like" comfort, app-wide

The cards used to read like a benchmark scoreboard (`67% COOLER`). Now they speak in the units people actually care about — `~8°F cooler`, `~6 mph less headwind`, `Wind sheltered`, `Glass glare zone 🔆`. The CLAUDE.md spec's "up to +15°F felt temperature from glass glare" anchors the temp scale. `tsc -b` + `vite build` clean.

**Sun / shade — feels-like temperature** ([src/components/RouteSheet.tsx](src/components/RouteSheet.tsx))

```
cooler °F = (1 − meanSunExposure) × 15      // absolute, per card
hotter °F = (meanSunExposure − 1) × 15      // glare case, exposure > 1.0
delta °F  = (fastest − comfort) × 15        // GMA comparison
```

`comfortBadgeFor(route, filterMode, windSpeedMph)` returns the right-column badge:

| Exposure / state | Badge | Color |
|---|---|---|
| `0–0.07` (or `< 1°F`) | "Full sun" | amber-orange |
| `0.07–1.0` | "~X°F cooler" | green |
| `> 1.0` (glare) | "~X°F hotter" | red-600 |
| sunniest mode | "~X°F warmer" | amber-orange |

**Wind — mph of headwind avoided**

```
exposure < 0.3                → "Wind sheltered"         (green)
exposure ≥ 0.3, wind ≥ 3 mph  → "~X mph headwind"        (violet-500)
wind < 3 mph                  → "Calm"                   (green)
```

**Rain — verbal shelter state**

```
exposure < 0.3 → "Rain sheltered 💧"     (cyan-500)
exposure ≥ 0.3 → "Less rain exposure"    (slate-600)
```

**Condition labels — emoji'd** ([src/components/RouteSheet.tsx](src/components/RouteSheet.tsx))

Below the feels-like badge a smaller condition chip names the route in plain English:

| Internal key | Label |
|---|---|
| `mostly-shaded` | `Shaded walk 🌳` |
| `partly-shaded` | `Mixed sun & shade ⛅` |
| `mostly-sunny` | `Full sun ☀️` |
| `glare-detected` (NEW) | `Glass glare zone 🔆` |
| `sheltered` | `Wind sheltered` |
| `moderate-wind` | `Moderate wind` |
| `strong-headwind` | `Strong headwind 🌬` |
| `rain-sheltered` | `Rain sheltered` |
| `rain-exposed` | `Rain exposed 💧` |
| `snow-sheltered` | `Snow sheltered` |
| `snow-exposed` | `Snow exposed ❄` |

`exposureToSunCondition` gains a `> 1.0` branch — glass-glare segments push `meanSunExposure` past 1 (segments report 1.5), and only those routes get the `Glass glare zone 🔆` chip + red badge.

**GMA explanation line + ComparisonLine**

`computeFeelsLikeDelta` replaces the old `computeExposureDelta` (which returned `%`). New shape:

```ts
interface FeelsLikeDelta {
  phrase: string;       // "feel ~6°F cooler" / "avoid ~4 mph headwind" / "less rain exposure"
  shortPhrase: string;  // "Feels ~6°F cooler" / "Avoids ~4 mph headwind" / "Less rain exposure"
}
```

Wind mode requires `windSpeedMph ≥ 3` for a meaningful delta; rain mode requires `(fastest − comfort) ≥ 0.1`; sun mode requires `≥ 1°F` after rounding.

Card explanation example: `+2 min · Feels ~6°F cooler` (was `+2 min · 40 % less sun exposure`).

ComparisonLine example: `Save 2 minutes OR feel ~6°F cooler — your choice.` (was `Save 2 minutes OR save 40 % sun exposure — your choice.`)

Both null-degrade when the gap is below threshold.

**Start toast** ([src/App.tsx](src/App.tsx))

`buildStartToast(route, filterMode, windSpeedMph)`:

| Filter | Condition | Toast |
|---|---|---|
| `avoid-rain` | sheltered | `💧 Sheltered from rain` |
| `avoid-rain` | exposed | `💧 Less rain on this route` |
| `avoid-wind` | calm winds | `🌬 Calm winds out there` |
| `avoid-wind` | sheltered | `🌬 Sheltered from wind` |
| `avoid-wind` | partial | `🌬 ~X mph less headwind on this route` |
| `sunniest` | — | `☀️ Catching maximum sun · ~X°F warmer` |
| any sun filter | glare | `🔆 Heads-up: route passes glass glare` |
| any sun filter | shaded | `🌳 Finding you the coolest route` |
| any sun filter | partial | `🌳 Feels ~X°F cooler` |

**Gemini conversational confirmations** ([src/lib/geminiRouting.ts](src/lib/geminiRouting.ts))

`mapInterpretation` no longer composes `Got it — routing for X` from a verb token; each branch returns a complete sentence with an emoji:

| Filter (intensity) | Toast |
|---|---|
| `sunniest` | `Got it — finding you the sunniest route ☀️` |
| `avoid-both` (high) | `Got it — finding you the coolest, calmest route 🌳🌬` |
| `avoid-both` | `Got it — finding cooler, calmer streets 🌳🌬` |
| `avoid-sun` (high) | `Got it — finding you the coolest route 🌳` |
| `avoid-sun` | `Got it — finding shadier streets 🌳` |
| `avoid-wind` (high) | `Got it — finding you the most sheltered route 🌬` |
| `avoid-wind` | `Got it — avoiding the worst headwinds 🌬` |
| `no-preference` | `Got it — no specific preference` |

**API surface changes**

- `RouteSheetProps` gains `windSpeedMph: number` (feeds the wind feels-like badge + the wind comparison delta).
- `RouteCardProps.percent` + `RouteCardProps.verb` removed; replaced with `comfortBadge: ComfortBadge | null`.
- `MoreOptionsSection` takes `comfortBadgeFor` instead of `percentFor` + `verb`.
- `RouteCondition` adds `'glare-detected'`.
- App.tsx passes `weather?.windSpeedMph ?? 0` to both RouteSheet and the Start toast.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.43 MB main chunk, ~12 s)

---

## 2026-06-03 — Navigation startup perf + smoothness pass

Six-item perf pass aimed at the moment between tap-Start and the first follow-cam frame, plus the per-frame cost while moving. Goal: navigation feels instant on tap and stays at 60 FPS on mobile.

| # | Item | Change |
|---|---|---|
| 1 | Instant nav start | `handleStartNavigation` flips `setNavigating(true)` BEFORE dispatching the camera fly-in. Route polyline + `coloredSegments` are already `useMemo`-cached, so the navigation chrome paints on the very next React frame regardless of geolocation/weather/etc. |
| 2 | Fly-in delay | FlyToInterpolator `transitionDuration` 800 ms → 400 ms in `handleStartNavigation` ([src/App.tsx](src/App.tsx)). |
| 3 | Pre-computed nav data | New WeakMap caches in [src/lib/navigation.ts](src/lib/navigation.ts) keyed by polyline / steps array reference; exported `warmRouteNavigationCache(polyline, steps)` helper; private `getCumulativeDistances` / `getStepBoundaries` cached getters. `computeRouteProgress` and `computeNextTurn` both swapped to the cached getters. App.tsx warms the cache for every candidate the moment `result.routes` changes (effect on `[result]`), so first `computeNextTurn` after Start fires in O(1). |
| 4 | Smooth follow-cam | Follow-cam viewState updates: `transitionDuration` 500 ms → 200 ms ([src/App.tsx](src/App.tsx)) — the camera keeps up with walking pace without jumping or feeling laggy. |
| 5 | Layer-count diet | [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) now gates `forests`, `building-shadows`, `street-sun-overlay`, `trees`, and `glare-hotspots` on `!navigating`. During nav only the basemap + route polyline + live-location halo/dot paint, dramatically reducing GPU load. |
| 6 | Route sun coloring preserved | Untouched: `route-comfort-overlay` PathLayer still uses per-segment `coloredSegments` colors (amber sunny / blue shaded / emerald canopy) during nav. The accessor was already per-segment, so the user keeps the upcoming-section sun-feel signal. |

**Files touched**

- [src/App.tsx](src/App.tsx) — import `warmRouteNavigationCache`; instant-flip + 400 ms fly-in in `handleStartNavigation`; 200 ms follow-cam transition; new `useEffect([result])` warming the per-candidate nav cache.
- [src/lib/navigation.ts](src/lib/navigation.ts) — WeakMap caches + `warmRouteNavigationCache` export + cached getters + module docstring updated to describe the warm-on-selection pipeline.
- [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx) — `!navigating &&` gates on the five non-essential layer pushes. Memo deps already include `navigating`.

**Why WeakMap**

Routes API responses produce stable `polyline` and `steps` arrays per candidate (they live for the lifetime of the candidate). WeakMap keys auto-release when the candidate is GC'd, so the cache never leaks across route searches.

**What still paints during navigation**

- Basemap (`carto-positron-basemap` or 3D Tile3DLayer when satellite/3D modes are picked)
- `route-comfort-overlay` PathLayer (per-segment colors preserved)
- `live-location-halo` ScatterplotLayer
- `live-location-dot` ScatterplotLayer

Everything else suppressed until the user exits navigation mode.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.43 MB main chunk, ~17 s)

---

## 2026-06-04 — Open-Meteo fallback for the weather pipeline

Google Weather has had transient drop-outs where the v1 beta returns 200 with no `cloudCover` block. Without cloud cover the glare model overstates sun intensity, and the SunCompass dimming reads wrong. To make the demo robust to that we now fall back to Open-Meteo — free, keyless, and well-shaped for the same `WeatherSnapshot` type.

**Trigger conditions** (any of these, in [src/hooks/useWeatherData.ts](src/hooks/useWeatherData.ts) `fetchWeather`):

1. Google HTTP not-ok.
2. Google fetch throws (network error).
3. Google 200 with missing wind block (`normalize` returns null — pre-existing check).
4. Google 200 with missing cloud cover (`normalize` returns null — NEW check).

When the fallback activates we log `[GMA] Weather: using Open-Meteo fallback` plus the raw payload, so the source of any given snapshot is easy to verify in DevTools.

**Endpoint**

```
GET https://api.open-meteo.com/v1/forecast
    ?latitude={lat}
    &longitude={lng}
    &current=cloud_cover,wind_speed_10m,wind_direction_10m,precipitation_probability,temperature_2m
    &timezone=auto
```

`temperature_2m` added beyond the spec'd field list — `WeatherSnapshot.temperatureF` is required by downstream consumers (feels-like temp badge, route comparison line). Without it, the badge would always read 32 °F.

**WeatherSnapshot mapping** (in `normalizeOpenMeteo`)

| WeatherSnapshot field | Open-Meteo source | Notes |
|---|---|---|
| `windSpeedMph` | `current.wind_speed_10m` | Unit-aware conversion via `openMeteoWindToMph(value, unit)`; defaults to km/h, also handles mph/m/s/knots |
| `windDirectionDeg` | `current.wind_direction_10m` | Degrees clockwise from N (same convention as Google) |
| `cloudCoverPct` | `current.cloud_cover` | `clampPct` — required field, returns null if absent |
| `temperatureF` | `current.temperature_2m` | Unit-aware via `openMeteoTempToF`; defaults to °C |
| `precipitationProbability` | `current.precipitation_probability` | `clampPct`, 0 if absent |
| `precipitationType` | derived | `'rain'` if probability > 0 else `'none'`. Open-Meteo's free `current` block does not classify type; doing so would require weather_code mapping which is overkill for a fallback path |
| `fetchedAt` | client wall clock | |
| `isDaytime` / `sunriseTime` / `sunsetTime` | not surfaced | Left `undefined`; `daylight.ts` `computeSunTimes()` already supplies these client-side when absent |

**Singleton + polling unchanged**

The module-scope `cached` / `inflightPromise` / `subscribers` / `pollTimerId` singleton is untouched — the fallback rides inside `fetchWeather`, so dedup, in-flight coalescing, and the 10-minute poll timer all apply transparently to Open-Meteo too.

**Files touched**

- [src/hooks/useWeatherData.ts](src/hooks/useWeatherData.ts) — `normalize` returns null when `cloudCover` is undefined/null; `fetchWeather` now `try`/`catch`-wraps the Google call and falls back via `fetchOpenMeteo(lat, lng)` on any failure or unusable payload; added `fetchOpenMeteo`, `OpenMeteoResponse` interface, `normalizeOpenMeteo`, `openMeteoWindToMph`, `openMeteoTempToF`.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.44 MB main chunk, ~13 s)

---

## 2026-06-04 — Light/dark theme + next-gen UI redesign

Full visual-layer pass — no behavior changes. The app now ships with a light Apple-Maps-style aesthetic by default and a dark glassmorphism mode toggled from a sun/moon button in the top-right corner. Preference persists to localStorage; flipping the toggle crossfades the entire UI in 300 ms with no layout shift.

**Design system** — [src/styles/globals.css](src/styles/globals.css)

| Token group | Light | Dark |
|---|---|---|
| `--gma-bg` | `#f7f8fa` | `#080810` |
| `--gma-surface` | `#ffffff` | `rgba(255, 255, 255, 0.08)` (glass) |
| `--gma-border` | `rgba(0, 0, 0, 0.06)` | `rgba(255, 255, 255, 0.12)` |
| `--gma-text-primary` | `#1a1a2e` | `#f1f5f9` |
| `--gma-glow-amber` | transparent | `0 0 24px rgba(245, 158, 11, 0.45)` |
| `--gma-shadow-md` | soft grey | deep black |

Every component reads these tokens, so the entire color/elevation system flips through one `html.dark` class swap. A global `* { transition: background-color, color, border-color, box-shadow, backdrop-filter 300ms ease }` rule crossfades the whole tree at once.

**New utility classes**

- `.gma-card` — surface + border + shadow. Adds backdrop-filter blur in dark mode.
- `.gma-glass` / `.gma-glass-strong` — backdrop-filtered translucent surfaces.
- `.gma-press` — `transform: scale(0.95)` on active, springs back via cubic-bezier(0.5, 1.6, 0.4, 1).
- `.gma-press-soft` — gentler 0.98 scale for the Start button.
- `.gma-pop-in` — keyframed scale + translate intro for toasts/dropdowns.
- `.gma-shimmer` — left-to-right gradient sweep for skeleton placeholders.
- `.gma-lift` — translateY + shadow on hover (route cards).
- `.gma-glow-amber` / `.gma-glow-wind` — applies the corresponding glow box-shadow (no-op in light, lit in dark).

**Theme infra**

- [src/hooks/useTheme.ts](src/hooks/useTheme.ts) — single source of truth. State `'light' | 'dark'`, defaults to light, persisted under `gma:theme`. Toggling applies `class="dark"` on `<html>`. Exposes `{ theme, toggle, setTheme }`.
- [src/components/ThemeToggle.tsx](src/components/ThemeToggle.tsx) — 44 px round floating button in the top-right corner. Sun + moon SVGs are stacked and crossfaded with a 220 ms opacity + 300 ms spring transform — no layout shift on toggle.

**Inter font**

[index.html](index.html) — Google Fonts call expanded to include `Inter:400/500/600/700` alongside `DM Mono`. `--font-ui` set to `'Inter', system fallbacks…`; `--font-data` unchanged.

**Per-component changes**

| Component | Light mode | Dark mode |
|---|---|---|
| [SearchBar](src/components/SearchBar.tsx) | `.gma-card` rounded-2xl, hairline border, `var(--gma-shadow-lg)`. Origin dot = blue pulsing ring; destination dot = solid amber. Swap button rotates 180° on press (CSS spring via [SearchBar.css](src/components/SearchBar.css)). | Same structure, glass surface, blue + amber dots glow against the dark surface. |
| [TransportModeSwitcher](src/components/TransportModeSwitcher.tsx) | White rounded-2xl card, 24 px icons + uppercase label, active pill fills with live dayColor. | Glass card, active pill picks up `--gma-glow-amber` glow ring. Every pill uses `.gma-press`. |
| [TimePicker](src/components/TimePicker.tsx) | White pill trigger + dropdown, native datetime-local input themed. | Glass pill + `.gma-pop-in` glass dropdown. Top offset shifted from 13.5 rem → 15.5 rem to clear the now-taller transport pills. |
| [RouteSheet](src/components/RouteSheet.tsx) | `.gma-card` rounded-top sheet, filter pills + cards on white. FASTEST stays grey (`--gma-hover-bg`); GMA PICK uses an amber linear gradient + glow. Start button is a 135° amber gradient with `.gma-press-soft`. Skeletons use the new `.gma-shimmer` sweep. | Same layout on glass; pills + Start glow in amber/violet/cyan depending on the filter accent. |
| [SunCompass](src/components/SunCompass.tsx) | Compact 80 px disc inside a `.gma-card`. SVG strokes/fills swapped to `--gma-border-strong` / `--gma-text-muted` so they invert cleanly. | Same disc on a glass surface; violet wind arrow stays violet (works in both modes). |
| [NavigationHeader](src/components/NavigationHeader.tsx) + [NextTurnIndicator](src/components/NextTurnIndicator.tsx) | Clean white pills with strong shadows. | Glassmorphism pills; the Stop button uses `.gma-press`. |
| [MapViewSwitcher](src/components/MapViewSwitcher.tsx) | White vertical pill, active option highlights with `--gma-press-bg`. | Glass pill, same accent logic. |
| [Toast](src/components/Toast.tsx) | `.gma-card` with `--gma-shadow-lg`. | Same primitive; glass + dark elevation. |
| [RouteLegend](src/components/RouteLegend.tsx) | White pill, offset bumped from 17 rem → 19 rem to clear the taller transport switcher. | Glass pill. |
| [DataAttribution](src/components/DataAttribution.tsx) | `.gma-glass` pill — explicit blur, no longer a baked rgba. | Same primitive picks up the dark glass tokens. |
| [ThemeToggle](src/components/ThemeToggle.tsx) | White round button. | Glass round button, backdrop-blur applied inline because Tailwind's class composition can't conditionally toggle a filter. |

**Map overlays — GMACanvas** ([src/components/GMACanvas.tsx](src/components/GMACanvas.tsx))

- New `theme: 'light' | 'dark'` prop.
- Basemap: 2D mode picks `CARTO_POSITRON_TILES` (light) or `CARTO_DARK_MATTER_TILES` (dark). 3D and satellite are unchanged — they already render dark-friendly.
- Overlay alpha multiplier: light 1.0 (overlays stay ≤ ~0.2 alpha, basemap legible); dark 2.0 (overlays jump to ~0.5 alpha, route + glare hotspots pop). Applied to forest fill, building shadows, glare hotspots via the `tintAlpha()` helper. Street sun overlay and route polyline keep their per-segment colors verbatim — those drive the comfort signal and shouldn't shift on theme.
- Glare hotspots in dark mode bump radius 15 → 22 m + min-pixel 6 → 10 so they read as glowing markers rather than tinted dots.
- Tooltip background swaps to a dark-glass surface in dark mode.

**App.tsx wiring**

- Imports `useTheme` + `ThemeToggle`.
- `const { theme, toggle: toggleTheme } = useTheme()` at the top of `App()`.
- `GMACanvas` receives `theme={theme}`.
- `<ThemeToggle theme={theme} onToggle={toggleTheme} />` mounted right after `GMACanvas` so it sits on top of every other overlay.

**Files touched**

- New: [src/hooks/useTheme.ts](src/hooks/useTheme.ts), [src/components/ThemeToggle.tsx](src/components/ThemeToggle.tsx), [src/components/SearchBar.css](src/components/SearchBar.css).
- Rewritten: [src/styles/globals.css](src/styles/globals.css), [src/components/TransportModeSwitcher.tsx](src/components/TransportModeSwitcher.tsx), [src/components/TimePicker.tsx](src/components/TimePicker.tsx).
- Updated: [src/components/SearchBar.tsx](src/components/SearchBar.tsx), [src/components/SunCompass.tsx](src/components/SunCompass.tsx), [src/components/MapViewSwitcher.tsx](src/components/MapViewSwitcher.tsx), [src/components/NavigationHeader.tsx](src/components/NavigationHeader.tsx), [src/components/NextTurnIndicator.tsx](src/components/NextTurnIndicator.tsx), [src/components/Toast.tsx](src/components/Toast.tsx), [src/components/RouteLegend.tsx](src/components/RouteLegend.tsx), [src/components/DataAttribution.tsx](src/components/DataAttribution.tsx), [src/components/RouteSheet.tsx](src/components/RouteSheet.tsx), [src/components/GMACanvas.tsx](src/components/GMACanvas.tsx), [src/App.tsx](src/App.tsx), [index.html](index.html).

**Verification**

- Every component still uses `var(--gma-*)` tokens — single class swap on `<html>` flips the whole palette.
- The 300 ms global transition rule applies to background/border/color/shadow/backdrop-filter only — transforms + opacity manage their own timing, so press animations stay snappy.
- All deck.gl layers' memo deps include `theme`, so the canvas re-paints with the right palette + basemap on toggle.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.44 MB main chunk, CSS ~28 KB / gzip 6.4 KB, ~14 s)

---

## 2026-06-04 — Critical mobile fixes

Five-item pass on issues surfaced from real-device testing on the deployed Netlify build.

| # | Issue | Fix |
|---|---|---|
| 1 | TimePicker dropdown stuck open on mobile, blocking the rest of the UI | Click-outside handler in [src/components/TimePicker.tsx](src/components/TimePicker.tsx) now listens for BOTH `mousedown` AND `touchstart` (iOS Safari can swallow/delay mousedown). Added a full-viewport `<button>` backdrop (z-19, transparent) rendered when `open === true`; tapping anywhere off the dropdown closes it via the backdrop's own onClick — a reliable mobile fallback even if the document touchstart listener misses. |
| 2 | Cards show "71% COOLER" instead of "~8°F cooler" on deployed build | Verified the code in [src/components/RouteSheet.tsx](src/components/RouteSheet.tsx) already returns the feels-like text via `comfortBadgeFor` (no code drift). Root cause was the previous PWA service worker holding the user on the old bundle. Added `workbox: { skipWaiting: true, clientsClaim: true, cleanupOutdatedCaches: true }` to [vite.config.ts](vite.config.ts) so new SW takes over immediately on next page load and stale Workbox precache entries are dropped. Future deploys won't strand users on prior builds. |
| 3 | GMA PICK explanation still shows percent on deployed build | Same root cause — `buildGmaExplanation` already returns `${time} · ${delta.shortPhrase}` with `shortPhrase: 'Feels ~${degrees}°F ${direction}'`. Same SW-refresh fix unsticks it. |
| 4 | Touch targets < 44 px | Audited all interactive surfaces. Fixed in [src/components/SearchBar.tsx](src/components/SearchBar.tsx): swap button bumped from `p-2` (~34 px) → `h-11 w-11` (44 px); place-field clear button from `p-1` (~22 px) → `h-11 w-11`; autocomplete suggestion rows now `min-h-[44px]`. Search row right-padding bumped `pr-12 → pr-14` to clear the wider swap button. Input gains conditional `pr-12` only on fields that surface a clear button so long labels don't slide under the X. RouteSheet, TimePicker, MapViewSwitcher, TransportModeSwitcher already complied with 44 px. |
| 5 | Start button hidden below the viewport on mobile | [src/components/RouteSheet.tsx](src/components/RouteSheet.tsx) — Start container is now `sticky bottom-0` with its own `paddingBottom: max(env(safe-area-inset-bottom, 0px), 16px)` (moved off the outer sheet) + a `var(--gma-surface)` background + top border so scrolled route content underneath is obscured cleanly. Sheet max-height switched from pure `60dvh` to `min(80vh, 80dvh)` — older iOS Safari (≤15.3) resolves `dvh` to 0 px which would collapse the sheet entirely; the `vh` fallback prevents that. |

**Why issues 2 & 3 looked like code bugs**

The PWA's previous service worker (built before the 2026-06-01 feels-like refactor) was still serving the old JS chunk to anyone who'd installed the app or visited before that deploy. `vite-plugin-pwa` default config registers in `autoUpdate` mode but waits for all tabs to close before activating a new SW. Adding `skipWaiting + clientsClaim + cleanupOutdatedCaches` to the workbox config forces the new worker to take over on the very next navigation and purges old Workbox caches, so the build verified locally is also what runs on the device.

**Files touched**

- [vite.config.ts](vite.config.ts) — `workbox` block added to `VitePWA` config.
- [src/components/TimePicker.tsx](src/components/TimePicker.tsx) — `touchstart` listener + viewport backdrop button.
- [src/components/SearchBar.tsx](src/components/SearchBar.tsx) — 44 px swap + clear buttons, `min-h-[44px]` autocomplete rows, conditional `pr-12` on clearable inputs, `pr-14` row gutter.
- [src/components/RouteSheet.tsx](src/components/RouteSheet.tsx) — sticky Start container with own safe-area padding + surface background + border, `min(80vh, 80dvh)` max-height with vh fallback.

**Build**

- `tsc -b` clean
- `vite build` clean (~1.44 MB main chunk, CSS ~28.8 KB / gzip 6.5 KB, ~11 s)
