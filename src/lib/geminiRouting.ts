// Gemini 2.5 Flash conversational preference parser.
//
// Called directly from the browser using VITE_GEMINI_API_KEY (the
// project's AI Studio credits cover this — there's no proxy in front,
// unlike the Solar API). The structured-output `responseSchema` +
// `responseMimeType: 'application/json'` force the model to return a
// shape we can typecheck, so no fragile regex parsing.
//
// The mapping layer (`mapInterpretation`) translates Gemini's three-
// field intent into the app's existing FilterMode + a 1.0/1.5 weight
// multiplier that the route scorer multiplies into the HLCI weights
// when intensity = 'high'.

import type { FilterMode } from '../components/RouteSheet';
import type { HlciWeights } from './hlciRouter';

export type SunPreference = 'avoid_sun' | 'want_sun' | 'neutral';
export type WindPreference = 'avoid_wind' | 'neutral';
export type Intensity = 'low' | 'medium' | 'high';

export interface GeminiInterpretation {
  sunPreference: SunPreference;
  windPreference: WindPreference;
  intensity: Intensity;
}

export interface MappedPreference {
  interpretation: GeminiInterpretation;
  filterMode: FilterMode;
  /** Weight multiplier applied to FILTER_PRESETS[filterMode] — 1.5x when intensity=high, else 1.0. */
  intensityMultiplier: number;
  /** Plain-English summary for the confirmation toast. */
  toastMessage: string;
}

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SYSTEM_INSTRUCTION =
  'You are a comfort routing assistant. The user will describe their physical context or preference. Extract: sunPreference (avoid_sun | want_sun | neutral), windPreference (avoid_wind | neutral), intensity (low | medium | high). Return ONLY a JSON object with these three fields, nothing else.';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sunPreference: {
      type: 'STRING',
      enum: ['avoid_sun', 'want_sun', 'neutral'],
    },
    windPreference: {
      type: 'STRING',
      enum: ['avoid_wind', 'neutral'],
    },
    intensity: {
      type: 'STRING',
      enum: ['low', 'medium', 'high'],
    },
  },
  required: ['sunPreference', 'windPreference', 'intensity'],
};

/**
 * Run the user's free-text preference through Gemini 2.5 Flash.
 * Returns null on any failure (missing key, HTTP error, non-JSON or
 * malformed JSON, schema mismatch). Caller is expected to surface a
 * fallback toast and leave the existing filter pill state untouched.
 */
export async function interpretPreference(
  userText: string,
): Promise<GeminiInterpretation | null> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.warn(
      '[GMA] Gemini: VITE_GEMINI_API_KEY not set in .env — conversational routing disabled.',
    );
    return null;
  }
  const trimmed = userText.trim();
  if (trimmed.length === 0) return null;

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: trimmed }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  };

  console.log('[GMA] Gemini: interpreting preference', { input: trimmed });

  try {
    const response = await fetch(
      `${ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.warn(
        `[GMA] Gemini HTTP ${response.status} (${response.statusText}):`,
        errBody.slice(0, 400),
      );
      return null;
    }

    const json = (await response.json()) as GeminiResponseShape;
    const textContent = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      console.warn('[GMA] Gemini: no text part in response', json);
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent);
    } catch (error) {
      console.warn(
        '[GMA] Gemini: response text was not valid JSON',
        textContent.slice(0, 300),
        error,
      );
      return null;
    }

    if (!isValidInterpretation(parsed)) {
      console.warn('[GMA] Gemini: response did not match schema', parsed);
      return null;
    }

    console.log('[GMA] Gemini interpretation:', {
      input: trimmed,
      output: parsed,
    });
    return parsed;
  } catch (error) {
    console.warn('[GMA] Gemini call threw:', error);
    return null;
  }
}

function isValidInterpretation(obj: unknown): obj is GeminiInterpretation {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.sunPreference === 'string' &&
    ['avoid_sun', 'want_sun', 'neutral'].includes(o.sunPreference) &&
    typeof o.windPreference === 'string' &&
    ['avoid_wind', 'neutral'].includes(o.windPreference) &&
    typeof o.intensity === 'string' &&
    ['low', 'medium', 'high'].includes(o.intensity)
  );
}

/**
 * Translate Gemini's structured output into the FilterMode +
 * intensity multiplier the app's routing pipeline already understands.
 *
 * Mapping (sunPreference, windPreference):
 *   avoid_sun  + avoid_wind  → 'avoid-both'  ("avoiding sun and wind")
 *   avoid_sun  + neutral     → 'avoid-sun'   ("routing for shade")
 *   neutral    + avoid_wind  → 'avoid-wind'  ("avoiding headwinds")
 *   want_sun   + (any)       → 'sunniest'    ("finding the sunniest route")
 *   neutral    + neutral     → 'no-preference' ("no specific preference")
 *
 * intensity = 'high' bumps the weight multiplier to 1.5x; otherwise 1.0x.
 */
export function mapInterpretation(interp: GeminiInterpretation): MappedPreference {
  const wantsAvoidSun = interp.sunPreference === 'avoid_sun';
  const wantsSun = interp.sunPreference === 'want_sun';
  const wantsAvoidWind = interp.windPreference === 'avoid_wind';

  let filterMode: FilterMode;
  // Human-readable feels-like phrasing with a matching emoji. Replaces
  // the previous abstract "routing for X" verbs.
  let toastMessage: string;

  if (wantsSun) {
    filterMode = 'sunniest';
    toastMessage = 'Got it — finding you the sunniest route ☀️';
  } else if (wantsAvoidSun && wantsAvoidWind) {
    filterMode = 'avoid-both';
    toastMessage =
      interp.intensity === 'high'
        ? 'Got it — finding you the coolest, calmest route 🌳🌬'
        : 'Got it — finding cooler, calmer streets 🌳🌬';
  } else if (wantsAvoidSun) {
    filterMode = 'avoid-sun';
    toastMessage =
      interp.intensity === 'high'
        ? 'Got it — finding you the coolest route 🌳'
        : 'Got it — finding shadier streets 🌳';
  } else if (wantsAvoidWind) {
    filterMode = 'avoid-wind';
    toastMessage =
      interp.intensity === 'high'
        ? 'Got it — finding you the most sheltered route 🌬'
        : 'Got it — avoiding the worst headwinds 🌬';
  } else {
    filterMode = 'no-preference';
    toastMessage = 'Got it — no specific preference';
  }

  const intensityMultiplier = interp.intensity === 'high' ? 1.5 : 1.0;

  return {
    interpretation: interp,
    filterMode,
    intensityMultiplier,
    toastMessage,
  };
}

/**
 * Multiply every weight in an HlciWeights object by `multiplier`. Used
 * so the high-intensity case (1.5x) makes the active comfort dimension
 * matter more in the relative ranking against the other candidates.
 */
export function scaleWeights(
  weights: HlciWeights,
  multiplier: number,
): HlciWeights {
  return {
    glareAvoidance: weights.glareAvoidance * multiplier,
    windAvoidance: weights.windAvoidance * multiplier,
    shadePreference: weights.shadePreference * multiplier,
    rainAvoidance: weights.rainAvoidance * multiplier,
  };
}

// ---- ambient response types --------------------------------------------

interface GeminiResponseShape {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}
