// Google Maps JavaScript API loader.
//
// History — what each rewrite fixed:
//   v1: `&callback=…&loading=async` URL combo; callback never fired, loader
//       hung on "Loading Places…".
//   v2: modern bootstrap + `importLibrary('places')` on demand.
//   v3 (this file): switched to v=beta + libraries=places URL params because
//       google.maps.places.PlaceAutocompleteElement was returning undefined
//       under v=weekly + dynamic importLibrary. The new web component is
//       exposed reliably under the beta channel; the URL-param load is
//       eager and removes the importLibrary indirection.
//
// Diagnostics surface (unchanged from prior rev):
//   1. window.gm_authFailure callback — Maps JS triggers this when auth
//      fails (it's what produces the "This page can't load Google Maps
//      correctly" modal).
//   2. The constructed script URL is logged before injection (key redacted).
//   3. API key shape is validated — "AQ.…" keys (AI Studio / Vertex) and
//      empty keys are flagged immediately.
//   4. After bootstrap, we explicitly poll for PlaceAutocompleteElement
//      on google.maps.places — script.onload alone doesn't guarantee the
//      eagerly-loaded library has finished initializing.
//
// Localhost gotcha: if the GCP API key has HTTP referrer restrictions, the
// allowlist must include `http://localhost/*` and `http://localhost:5173/*`.

const SCRIPT_ID = 'gma-google-maps-bootstrap';

declare global {
  interface Window {
    google?: typeof google;
    gm_authFailure?: () => void;
  }
}

// @types/google.maps declares `importLibrary` as non-optional, so a normal
// optional-chain check would be narrowed away by TS. Use a runtime typeof
// probe instead.
function isMapsReady(): boolean {
  return (
    typeof window.google !== 'undefined' &&
    typeof window.google.maps !== 'undefined' &&
    typeof window.google.maps.importLibrary === 'function'
  );
}

// ---------- auth failure pub/sub ---------------------------------------

let lastAuthFailure: string | null = null;
let authListeners: Array<(reason: string) => void> = [];

export function onMapsAuthFailure(
  cb: (reason: string) => void,
): () => void {
  // Replay any prior failure so a late subscriber still sees it.
  if (lastAuthFailure) cb(lastAuthFailure);
  authListeners.push(cb);
  return () => {
    authListeners = authListeners.filter((listener) => listener !== cb);
  };
}

function notifyAuthFailure(reason: string): void {
  lastAuthFailure = reason;
  for (const cb of authListeners) {
    try {
      cb(reason);
    } catch {
      // Don't let one bad subscriber suppress the others.
    }
  }
}

function installAuthFailureCallback(): void {
  if (typeof window.gm_authFailure === 'function') return;
  window.gm_authFailure = () => {
    const reason =
      'Google Maps authentication failed. Checklist:\n' +
      '  1. Is "Maps JavaScript API" enabled in the GCP project? (different from Places API)\n' +
      '  2. Is billing enabled on the project? (Maps JS requires it since 2018)\n' +
      '  3. Does the API key allow Maps JavaScript API in its API restrictions?\n' +
      '  4. If using key restrictions, is this origin in the HTTP referrer allowlist?\n' +
      '  5. Is the key the standard Maps Platform format ("AIza…")? AI Studio / Vertex keys ("AQ.…") will not work.';
    console.error('[GMA]', reason);
    notifyAuthFailure(reason);
  };
}

// ---------- script loader ----------------------------------------------

let scriptPromise: Promise<void> | null = null;

function bootstrap(apiKey: string): Promise<void> {
  if (scriptPromise) return scriptPromise;

  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error('loadGoogleMaps called outside the browser.'),
    );
  }

  if (!apiKey) {
    const msg =
      'VITE_GOOGLE_MAPS_API_KEY is not set. Add it to .env and restart the dev server (Vite only injects env vars at startup).';
    console.error('[GMA]', msg);
    return Promise.reject(new Error(msg));
  }

  if (apiKey.startsWith('AIza')) {
    console.log(
      `[GMA] Maps API key loaded: ${apiKey.slice(0, 6)}… (${apiKey.length} chars)`,
    );
  } else {
    console.warn(
      `[GMA] VITE_GOOGLE_MAPS_API_KEY does not start with "AIza" — Maps JS expects a Google Maps Platform key. Got prefix: "${apiKey.slice(0, 4)}…". AI Studio (AQ.…) and Vertex tokens will be rejected.`,
    );
  }

  installAuthFailureCallback();

  if (isMapsReady()) {
    scriptPromise = Promise.resolve();
    return scriptPromise;
  }

  if (document.getElementById(SCRIPT_ID)) {
    scriptPromise = waitForBootstrap();
    return scriptPromise;
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    // v=beta is REQUIRED to expose google.maps.places.PlaceAutocompleteElement
    // (the new Places UI Kit web component); v=weekly returns undefined for
    // it in our project. libraries=places loads the Places library eagerly
    // with the bootstrap instead of via dynamic importLibrary().
    script.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(apiKey)}` +
      '&v=beta' +
      '&libraries=places' +
      '&loading=async';

    console.log(
      '[GMA] Injecting Maps script:',
      script.src.replace(/key=[^&]+/, 'key=***REDACTED***'),
    );

    script.onload = () => {
      if (isMapsReady()) {
        resolve();
      } else {
        // Bootstrap script loaded but global not attached yet — poll briefly.
        waitForBootstrap().then(resolve, reject);
      }
    };
    script.onerror = () => {
      scriptPromise = null;
      const msg =
        'Maps script failed to load (network error or DNS failure). Check the Network panel for the script request status.';
      console.error('[GMA]', msg);
      notifyAuthFailure(msg);
      reject(new Error(msg));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function waitForBootstrap(timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (isMapsReady()) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        const msg =
          'Timed out waiting for google.maps.importLibrary — auth may have failed silently. Check the network panel for HTTP errors on the maps/api/js request.';
        console.error('[GMA]', msg);
        notifyAuthFailure(msg);
        reject(new Error(msg));
      } else {
        window.setTimeout(tick, 50);
      }
    };
    tick();
  });
}

// Wait for PlaceAutocompleteElement specifically — script.onload firing only
// means the bootstrap loader script downloaded, NOT that the eagerly-loaded
// Places library has finished initializing. Even with libraries=places in
// the URL, that initialization is async under loading=async.
function waitForPlaceAutocompleteElement(timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      // Read through `unknown` so @types/google.maps' static class declaration
      // can't narrow the typeof check away.
      const ctor = (
        google?.maps?.places as unknown as {
          PlaceAutocompleteElement?: unknown;
        } | undefined
      )?.PlaceAutocompleteElement;

      if (typeof ctor === 'function') {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        const msg =
          'google.maps.places.PlaceAutocompleteElement still undefined after 5s. Verify the script URL has v=beta AND libraries=places.';
        console.error('[GMA]', msg);
        reject(new Error(msg));
      } else {
        window.setTimeout(tick, 50);
      }
    };
    tick();
  });
}

// ---------- public API ---------------------------------------------------

export async function loadPlacesLibrary(
  apiKey: string,
): Promise<typeof google.maps.places> {
  await bootstrap(apiKey);
  await waitForPlaceAutocompleteElement();
  console.log(
    '[GMA] Places library loaded — PlaceAutocompleteElement available (v=beta, libraries=places)',
  );
  return google.maps.places;
}
