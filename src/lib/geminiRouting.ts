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
import type { WeatherSnapshot } from '../hooks/useWeatherData';

export type SunPreference = 'avoid_sun' | 'want_sun' | 'neutral';
export type WindPreference = 'avoid_wind' | 'neutral';
export type Intensity = 'low' | 'medium' | 'high';

export interface GeminiInterpretation {
  sunPreference: SunPreference;
  windPreference: WindPreference;
  intensity: Intensity;
}

/**
 * Live micro-climate snapshot the caller passes in so Gemini can ground
 * QA answers ("is it good cycling weather?") in real numbers rather
 * than hallucinating values.
 */
export interface GeminiContext {
  weather: WeatherSnapshot | null;
  cloudCoverPct: number | null;
  sunElevationDeg: number;
  currentTime: Date;
}

/**
 * Discriminated union — routing preference gets remapped to a
 * FilterMode + intensity by `mapInterpretation`; qa answer flows
 * straight to the toast.
 */
export type GeminiResponse =
  | { mode: 'routing'; interpretation: GeminiInterpretation }
  | { mode: 'qa'; answer: string };

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

/**
 * Two-mode response schema. Gemini decides which mode the user's input
 * fits into and fills out the matching subset of fields:
 *
 *   routing: physical-context / preference statements like
 *     "I'm in a suit", "find me sun", "I'm cycling" → fills out
 *     sunPreference / windPreference / intensity. App.tsx remaps to
 *     the FilterMode pill and updates the active filter.
 *
 *   qa: general questions about current conditions like
 *     "what's the weather like?" / "is it good for cycling?" /
 *     "is it sunny right now?" → fills out the `answer` field with
 *     a short helpful text response grounded in the live weather
 *     context the caller injected.
 */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mode: {
      type: 'STRING',
      enum: ['routing', 'qa'],
    },
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
    answer: {
      type: 'STRING',
    },
  },
  required: ['mode'],
};

function buildSystemInstruction(ctx: GeminiContext): string {
  const tempStr =
    ctx.weather?.temperatureF != null
      ? `${Math.round(ctx.weather.temperatureF)}°F`
      : 'unknown';
  const windStr =
    ctx.weather?.windSpeedMph != null
      ? `${Math.round(ctx.weather.windSpeedMph)} mph`
      : 'unknown';
  const cloudStr =
    ctx.cloudCoverPct != null ? `${Math.round(ctx.cloudCoverPct)}%` : 'unknown';
  const precipStr =
    ctx.weather?.precipitationProbability != null
      ? `${Math.round(ctx.weather.precipitationProbability)}%`
      : 'unknown';
  const dayPart =
    ctx.sunElevationDeg > 0
      ? `daytime (sun ${ctx.sunElevationDeg.toFixed(0)}° above horizon)`
      : 'nighttime (sun below horizon)';
  return [
    'You are a hyper-local micro-climate assistant for New York City.',
    '',
    'Live context (use these in any QA answer):',
    `- Time: ${ctx.currentTime.toISOString()} (${dayPart})`,
    `- Temperature: ${tempStr}`,
    `- Wind: ${windStr}`,
    `- Cloud cover: ${cloudStr}`,
    `- Precipitation chance: ${precipStr}`,
    `- Precipitation type: ${ctx.weather?.precipitationType ?? 'none'}`,
    '',
    'Decide whether the user is:',
    '  (A) Describing a physical context or routing preference',
    '      (e.g. "I am in a suit", "find me sun", "cycling to work").',
    '      In that case set mode="routing" and fill out sunPreference',
    '      (avoid_sun | want_sun | neutral), windPreference',
    '      (avoid_wind | neutral), and intensity (low | medium | high).',
    '      Do NOT fill out `answer`.',
    '',
    '  (B) Asking a general question about current conditions',
    '      (e.g. "what is the weather like?", "is it good for cycling?",',
    '      "is it sunny right now?", "should I bring a jacket?").',
    '      In that case set mode="qa" and fill out `answer` with a',
    '      concise (1–2 sentences) helpful response grounded in the',
    '      live context above. Do NOT fill out the routing fields.',
    '',
    'Return ONLY a JSON object matching the schema. No prose outside JSON.',
  ].join('\n');
}

/**
 * Run the user's free text through Gemini 2.5 Flash. Returns either a
 * routing interpretation OR a free-text answer (qa) depending on
 * what Gemini classifies the input as. Returns null on any failure
 * (missing key, HTTP error, malformed JSON, schema mismatch). Caller
 * is expected to surface a fallback toast on null.
 */
export async function interpretPreference(
  userText: string,
  context: GeminiContext,
): Promise<GeminiResponse | null> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.warn(
      '[GMA] Gemini: VITE_GEMINI_API_KEY not set in .env — conversational routing disabled.',
    );
    return null;
  }
  const trimmed = userText.trim();
  if (trimmed.length === 0) return null;

  const systemInstruction = buildSystemInstruction(context);

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: trimmed }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  };

  console.log('[GMA] Gemini: interpreting preference', {
    input: trimmed,
    contextTempF: context.weather?.temperatureF,
    contextWindMph: context.weather?.windSpeedMph,
    contextCloudPct: context.cloudCoverPct,
  });

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

    const result = parseGeminiResponse(parsed);
    if (!result) {
      console.warn('[GMA] Gemini: response did not match schema', parsed);
      return null;
    }
    console.log('[GMA] Gemini response:', { input: trimmed, output: result });
    return result;
  } catch (error) {
    console.warn('[GMA] Gemini call threw:', error);
    return null;
  }
}

/**
 * Discriminate between the two response shapes and validate the
 * matching subset of fields. Tolerant of Gemini occasionally
 * including the "other mode"'s fields too — we just ignore them.
 */
function parseGeminiResponse(obj: unknown): GeminiResponse | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const mode = o.mode;
  if (mode === 'routing') {
    if (!isValidInterpretation(o)) return null;
    return {
      mode: 'routing',
      interpretation: {
        sunPreference: o.sunPreference,
        windPreference: o.windPreference,
        intensity: o.intensity,
      },
    };
  }
  if (mode === 'qa') {
    if (typeof o.answer !== 'string' || o.answer.trim().length === 0) {
      return null;
    }
    return { mode: 'qa', answer: o.answer.trim() };
  }
  return null;
}

function isValidInterpretation(
  o: Record<string, unknown>,
): o is GeminiInterpretation & Record<string, unknown> {
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
