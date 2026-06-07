import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import glsl from 'vite-plugin-glsl';
import { VitePWA } from 'vite-plugin-pwa';

// Build-time date stamp. Becomes part of the workbox `cacheId` so each
// deploy gets a fresh cache namespace (the old caches still get
// `cleanupOutdatedCaches`-purged, but a new cacheId guarantees an
// unambiguous cut even if Workbox's content-hash matching ever drifts).
// Also injected into the bundle as `__GMA_BUILD_DATE__` so the
// in-app VersionLabel can render the date.
const BUILD_DATE = new Date().toISOString().slice(0, 10);

export default defineConfig({
  // Compile-time constant: the build date string is inlined into every
  // bundle where `__GMA_BUILD_DATE__` is referenced. Used by the
  // VersionLabel chrome to surface the build the user is currently
  // running — a quick visual diff against the deploy log catches
  // stuck-service-worker situations immediately.
  define: {
    __GMA_BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
  // In dev, `/api/*` is forwarded to the Express proxy (server/index.js)
  // started with `npm run start:server` on port 3001. Lets the frontend
  // fetch `/api/solar?…` without CORS issues during local development.
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    glsl({
      include: ['**/*.glsl', '**/*.vert', '**/*.frag'],
      defaultExtension: 'glsl',
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      // Force a clean SW takeover on every deploy. Without these, mobile
      // PWAs hang onto the previous service worker until the user closes
      // every open tab — meaning new RouteSheet copy ("feels-like ~X°F"
      // instead of "X% cooler") wouldn't show until the user fully quit
      // Safari. skipWaiting + clientsClaim activates the new worker
      // immediately; cleanupOutdatedCaches drops stale Workbox caches
      // so we don't serve old hashed JS chunks.
      workbox: {
        // Per-deploy cache namespace — combined with `cleanupOutdatedCaches`
        // this guarantees any client that loads a new index.html immediately
        // drops the previous build's cached chunks.
        cacheId: `gma-${BUILD_DATE}`,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Generative Micro-Climate Architect',
        short_name: 'GMA',
        description:
          'Hyper-local comfort routing through NYC using solar ray-tracing and Venturi wind approximation.',
        theme_color: '#ffffff',
        background_color: '#f1f3f4',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
});
