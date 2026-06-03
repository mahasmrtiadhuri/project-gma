import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import glsl from 'vite-plugin-glsl';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
