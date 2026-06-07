/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_GEMINI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.glsl' {
  const value: string;
  export default value;
}
declare module '*.vert' {
  const value: string;
  export default value;
}
declare module '*.frag' {
  const value: string;
  export default value;
}

// Compile-time-injected build date (see `define` in vite.config.ts).
// Rendered by the bottom-right VersionLabel chrome.
declare const __GMA_BUILD_DATE__: string;
