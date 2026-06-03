# Technical Project Specification
## Generative Micro-Climate Architect (GMA)

**Author:** Maha  
**Target Event:** Google Maps Platform Developer Community Day — NYC Office, June 10, 2026  
**Version:** 2.1 (May 2026)  
**Status:** Active Architecture & Build

---

## 1. Executive Summary

Modern navigation solves for speed and distance. It completely ignores the physical experience of the human walking or cycling that route.

Cities are dense labyrinths of micro-climates that no weather app captures:

- **The Glare Effect:** Glass skyscrapers act as parabolic solar mirrors, concentrating radiation onto specific pavement coordinates. Standing in that beam raises the local "feels like" temperature by up to 15°F.
- **The Venturi Vortex:** High-rise street canyons compress ambient wind. A gentle 10 mph breeze can accelerate to 30+ mph at street level through narrow building gaps — invisible until you're cycling into it.
- **The Context Gap:** A map has no idea if you're wearing a wool suit, carrying a child, or riding an e-bike with limited battery.

**Generative Micro-Climate Architect (GMA)** is a geospatial micro-climate simulation and routing engine. It combines Google's Photorealistic 3D Tiles, GPU-accelerated solar ray-tracing, real-time wind vector approximation, and a conversational agentic interface to compute Hyper-Localized Comfort Indices (HLCI) at the sidewalk level — then routes users through them.

---

## 2. Technical Architecture

Three decoupled layers: data ingestion, physics simulation, and agentic interface.

```
+-----------------------------------------------------------------------------------+
|                          LAYER 1: DATA INGESTION                                  |
|  Google Photorealistic 3D Tiles API    Google Solar API (Baseline Shade Rasters)  |
|  Maps Grounding Lite MCP Server        Google Weather API (Wind Direction/Speed)  |
+-----------------------------------------------------------------------------------+
                                        |
                                        v
+-----------------------------------------------------------------------------------+
|                       LAYER 2: PHYSICS & SHADER SIMULATION                        |
|  WebGL 2.0 / GLSL Fragment Shaders  →  Solar Reflection Ray-Tracing               |
|  Fluid Continuity Approximation     →  Venturi Wind Canyon Detection              |
+-----------------------------------------------------------------------------------+
                                        |
                                        v
+-----------------------------------------------------------------------------------+
|                      LAYER 3: AGENTIC INTERFACE & ROUTING                         |
|  Maps Agentic UI Toolkit (A2UI)        Gemini 2.0 Pro (Host Model)                |
|  Google Routes API (Advanced Tier)     Custom HLCI Cost-Matrix Injection           |
+-----------------------------------------------------------------------------------+
```

---

## 3. Full Tech Stack

| Domain | Technology | Notes |
|---|---|---|
| Framework | React 19 + Vite + TypeScript | Strict mode, fast HMR |
| Styling | Tailwind CSS | Utility-first, mobile-first |
| 3D Rendering | deck.gl + @loaders.gl/3d-tiles | Streams OGC 3D Tilesets |
| 3D Data | Google Photorealistic 3D Tiles API | Real NYC building meshes |
| Physics | WebGL 2.0 + Custom GLSL Shaders | GPU-accelerated, runs client-side |
| Baseline Shade | Google Solar API | Pre-computed hourly shadow rasters |
| Wind Data | Google Weather API (MetNet) | Real-time wind direction + speed |
| AI Model | Gemini 2.0 Pro | Host LLM for agentic routing |
| Agentic UI | Maps Agentic UI Toolkit (A2UI v0.8+) | Experimental, broadly available May 2026 |
| Geo Grounding | Maps Grounding Lite MCP Server | Places, weather, routes grounding |
| Routing | Google Routes API (Advanced Tier) | Custom cost-matrix injection |

---

## 4. Implementation Logic

### Module A — Solar Reflection Ray-Tracing (GLSL Shader)

The 3D meshes from Photorealistic 3D Tiles are analyzed inside a WebGL fragment shader. No CPU-side ray casting.

**Given a UTC timestamp:**
1. Compute normalized sun direction vector **Î** (solar azimuth + elevation from device time + NYC coordinates)
2. For each building surface polygon, extract its surface normal vector **N̂**
3. Compute the reflected ray trajectory **R̂** across glass vs. brick facades:

$$\vec{R} = \vec{I} - 2(\vec{I} \cdot \vec{N})\vec{N}$$

4. Project ray intersections onto the ground plane mesh
5. Map an additive thermal scalar (+ΔT_glare) onto corresponding sidewalk coordinates
6. Render as a color-coded heatmap overlay: cool blue → neutral white → thermal red

**Material differentiation:** Glass facades (high reflectivity index ~0.7) vs. brick/concrete (~0.3) produce different ΔT scalars. Material type inferred from building metadata in the 3D Tileset where available; defaulted to glass for modern towers post-2000.

---

### Module B — Venturi Wind Canyon Approximation

Full fluid dynamics simulation is too compute-heavy for a browser. GMA uses structural spacing to approximate wind acceleration through building gaps.

**Algorithm:**
1. Extract parallel building wall polygons bounding each street segment from the 3D Tileset
2. Calculate the cross-sectional entry width (W_entry) and canyon width (W_canyon)
3. When ambient wind direction (from Weather API) aligns within ±30° of the street axis:

$$v_{local} = v_{ambient} \times \left(\frac{W_{entry}}{W_{canyon}}\right)$$

4. Flag segments where v_local > 2.0 × v_ambient as high-resistance Venturi corridors
5. Render as animated wind-vector overlays on the map canvas

---

### Module C — Agentic Routing via A2UI + Gemini

The Maps Agentic UI Toolkit (A2UI) interprets natural language and maps it to programmatic routing weight adjustments.

```typescript
import { A2UIClient, A2UIRenderer } from '@google/a2ui';
import { GoogleGenAI } from '@google/genai';

const client = new A2UIClient({ endpoint: "http://localhost:10002" });
const renderer = new A2UIRenderer();

const SYSTEM_INSTRUCTIONS = `
  You are a micro-climate routing agent for New York City.
  You have access to real-time solar glare coordinates, wind tunnel segments,
  and shade coverage data via the Maps Grounding Lite MCP server.
  
  When a user describes their physical context (hot, sweating, cycling, carrying luggage),
  translate that into routing weight adjustments:
  - Heat/sun sensitivity → penalize glare segments, maximize shade coverage
  - Wind sensitivity → avoid Venturi corridor segments
  - Neutral → optimize for combined comfort score (HLCI)
  
  Always return a structured route request with HLCI cost multipliers attached.
`;

async function handleComfortPrompt(userInput: string) {
  renderer.addUserMessage(userInput);
  const response = await client.send(userInput, {
    systemInstructions: SYSTEM_INSTRUCTIONS,
    mcpServers: [{ url: "https://mapstools.googleapis.com/mcp" }]
  });
  renderer.processResponse(response);
  // Response triggers Routes API call with injected cost matrix
}
```

**Example natural language → routing translation:**
- "I'm in a suit walking to a meeting" → maximize shade, avoid glare segments
- "Cycling to the office" → avoid Venturi corridors, battery-efficient path
- "Find me a sunny café patio at 4pm" → invert shade logic, find solar exposure

---

## 5. Use Cases (Demo Priority Order)

| # | Use Case | Name | Core Feature |
|---|---|---|---|
| 1 | Summer pedestrian | **The Vampire Route** | Shade routing + glare avoidance |
| 2 | Urban cyclist | **Aerodynamic Assist** | Venturi wind-tunnel avoidance |
| 3 | Café seeker | **Patio Gold-Rush** | Inverted shade logic, solar exposure finder |
| 4 | Urban planner | **Micro-Climate Sandbox** | Upload .gltf model, simulate shadow/wind impact |

**For June 10 demo: focus on Use Cases 1 and 2.** Cases 3 and 4 are roadmap slides.

---

## 6. Privacy & Data Principles

- **Location data:** Used only for routing computation. Not stored or transmitted beyond the active session.
- **No backend persistence:** All physics computation runs client-side on WebGL. No user data stored server-side.
- **Weather + routing API calls:** Stateless per request. No user profiles built or retained.

---

## 7. Development Roadmap

### Phase 1 — The Canvas (Days 1–2)
- Scaffold React 19 + Vite + TypeScript + Tailwind
- Mount deck.gl with `Tile3DLayer` and `@loaders.gl/3d-tiles`
- Authenticate Photorealistic 3D Tiles API
- Render NYC Manhattan/Brooklyn 3D mesh full-screen
- Verify building geometry loads at street level
- Deploy to Netlify (HTTPS required for GPU APIs)

### Phase 2 — The Physics (Days 3–5)
- Write GLSL fragment shader: solar azimuth → surface normals → reflected ray projection
- Connect solar tracker slider to sun vector Î (time-of-day scrubber for demo)
- Render thermal heatmap overlay on ground plane
- Implement Venturi approximation: extract building wall polygons, compute v_local
- Render wind vector overlay on canyon streets
- Integrate Google Solar API baseline shade rasters as ground truth layer

### Phase 3 — The Brain (Days 6–8)
- Connect Maps Grounding Lite MCP server (mapstools.googleapis.com/mcp)
- Configure Gemini 2.0 Pro with system instructions for comfort routing
- Implement A2UI client + renderer
- Wire natural language input → HLCI cost multipliers → Routes API call
- Test: "I'm sweating in a suit" → shade-optimized route returned

### Phase 4 — The Interface (Days 9–10)
- Layer toggle panel: Thermal / Wind / All
- Conversational input bar (A2UI rendered)
- Route result card: shows HLCI delta vs. fastest route
- Time-of-day scrubber for solar position demo
- Mobile layout polish, 60 FPS target on device

### Phase 5 — Polish & Demo Prep (Days 11–13)
- Bounding box optimization: limit tile loading to active viewport radius
- Offline fallback for conference WiFi
- Demo script rehearsed (see Section 9)
- README + screenshots + 60-second demo video for portfolio

---

## 8. Google Cloud APIs Required

| API | Purpose | Estimated Cost |
|---|---|---|
| Maps JavaScript API | Base map rendering | ~$0 (covered by $200 credit) |
| Photorealistic 3D Tiles API | 3D building meshes | ~$10–30 dev usage |
| Solar API | Hourly shade rasters | ~$1–2 |
| Weather API | Wind direction + speed | ~$1–2 |
| Routes API (Advanced) | Cost-matrix routing | ~$2–5 |
| Maps Grounding Lite | MCP geospatial grounding | ~$1–3 |

**Total estimated cost: $15–42 against $200 monthly free credit. Net cost: $0.**

Enable all on a single Google Cloud project. Set a $50 budget alert.

---

## 9. Demo Script (5 Minutes, June 10)

**Setup:** PWA open on phone, Manhattan/Brooklyn 3D mesh loaded, time-of-day set to 2pm.

1. **0:00–0:45** — Open app, show 3D NYC. "Standard maps route you by speed. This routes you by how the city feels at a physical level."

2. **0:45–1:30** — Toggle thermal layer. Show heatmap flare off glass towers on 6th Ave. "That's real solar reflection data — glass facades on those towers are concentrating radiation onto specific sidewalk coordinates right now. The 'feels like' temperature in that beam is 15°F higher than one block over."

3. **1:30–2:15** — Type: *"I'm walking to a meeting in a suit."* Watch A2UI agent reroute through shaded parallel streets. Show HLCI delta on route card.

4. **2:15–3:00** — Toggle wind layer. Show Venturi corridors on narrow canyon streets. "That's fluid continuity approximation running on the 3D building geometry. The wind between those towers is 2.8× the ambient speed."

5. **3:00–3:45** — Type: *"I'm cycling to the office."* Route avoids wind corridors. "Same destination. Completely different physical experience."

6. **3:45–4:30** — Scrub time-of-day slider from 8am to 6pm. Watch shadow and glare heatmap move across the city in real time. "This is what Google's 3D Tiles unlock — not just where you are, but what the physics of that location feel like at any moment."

7. **4:30–5:00** — "This is v1. The roadmap is a Micro-Climate Sandbox where urban planners can drag a new tower glTF model into the city and see exactly how its shadow and wind deflection alter the comfort profile of surrounding blocks before a single foundation is poured."

---

## 10. Design Specification

**Aesthetic:** Dark spatial instrument panel. Precise, atmospheric, data-dense without feeling cluttered.

**Color Palette (CSS variables):**
```css
--gma-bg: #080810;
--gma-surface: #10101a;
--gma-border: #1a1a2e;
--gma-thermal-hot: #ef4444;       /* glare / heat */
--gma-thermal-warm: #f59e0b;      /* moderate heat */
--gma-thermal-cool: #3b82f6;      /* shade / cool */
--gma-wind-high: #a855f7;         /* Venturi corridor */
--gma-wind-low: #6366f1;          /* low wind */
--gma-text-primary: #f1f5f9;
--gma-text-secondary: #64748b;
--gma-overlay-bg: rgba(8, 8, 16, 0.88);
```

**Typography:**
- UI / data labels: `DM Mono` (monospace, technical)
- Body / conversational: `Geist` or `IBM Plex Sans`

**Key UI Components:**
1. **HLCI Score Badge** — top right, live comfort index 0–100
2. **Layer Toggle Panel** — bottom sheet, pill toggles for Thermal / Wind
3. **Time Scrubber** — bottom bar, 6am–10pm slider, moves sun vector in real time
4. **Conversational Input** — A2UI rendered, slides up from bottom
5. **Route Card** — appears after routing, shows HLCI delta vs fastest route

---

## 11. File Structure

```
project-gma/
├── public/
│   ├── manifest.json
│   └── icons/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── GMACanvas.tsx          # deck.gl + 3D Tiles map wrapper
│   │   ├── HLCIBadge.tsx          # Live comfort index display
│   │   ├── LayerToggle.tsx        # Thermal / Wind toggles
│   │   ├── TimeScrubber.tsx       # Time-of-day slider
│   │   ├── RouteCard.tsx          # Route result + HLCI delta
│   │   └── ConversationBar.tsx    # A2UI conversational input
│   ├── hooks/
│   │   ├── useSolarPosition.ts    # Solar azimuth + elevation from time + coords
│   │   ├── useWindData.ts         # Weather API wind fetch + caching
│   │   └── useHLCI.ts             # Combines thermal + wind into comfort index
│   ├── lib/
│   │   ├── shaders/
│   │   │   ├── solar.vert.glsl    # Vertex shader
│   │   │   └── solar.frag.glsl    # Fragment shader: reflection ray-tracing
│   │   ├── venturi.ts             # Wind canyon approximation logic
│   │   ├── hlciRouter.ts          # Routes API call with HLCI cost matrix
│   │   └── a2uiClient.ts          # A2UI + Gemini integration
│   └── styles/
│       └── globals.css            # CSS variables, base styles
├── CLAUDE.md
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 12. What Claude Code Should Know

- This is a fresh repo. Do NOT carry over any code from the Aura v1 PWA. No acoustic layer, no Web Audio API, no dB badge.
- Build mobile-first. Demo runs on a phone.
- deck.gl + Tile3DLayer is the map foundation — not Leaflet, not Google Maps JS API directly.
- GLSL shaders go in `src/lib/shaders/` as separate `.glsl` files, imported via vite-plugin-glsl.
- All physics runs client-side. No backend server.
- A2UI is experimental (v0.8). If the npm package doesn't exist yet, implement the conversational layer using Gemini API directly with a chat UI, and note it as an A2UI placeholder.
- TypeScript strict mode on. No `any` types.
- Commit after each phase is complete.
- Target 60 FPS on mobile — use bounding box viewport culling from day one on tile loading.

---

*Last updated: May 2026*  
*Stack: React 19 + Vite + TypeScript + deck.gl + WebGL 2.0 + Gemini 2.0 Pro + A2UI*  
*Target: Google Maps Platform Developer Community Day, NYC, June 10, 2026*
