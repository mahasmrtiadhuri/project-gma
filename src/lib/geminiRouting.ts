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
export type RainPreference = 'avoid_rain' | 'neutral';
export type Intensity = 'low' | 'medium' | 'high';
export type Urgency = 'low' | 'medium' | 'high';

export interface GeminiInterpretation {
  sunPreference: SunPreference;
  windPreference: WindPreference;
  /** Whether the user prefers to avoid wet streets / driving rain. */
  rainPreference: RainPreference;
  /** Strength of the preference set above (low/medium/high). */
  intensity: Intensity;
  /**
   * How time-sensitive the user is. high = "running late", which the
   * scorer should weigh against comfort. Currently stored but not
   * yet folded into the HLCI weights — surfaced in the chat bubble
   * so the user can see Gemini understood the urgency cue.
   */
  urgency: Urgency;
  /**
   * Optional: a place name / address Gemini extracted from the prompt
   * for the route's starting point (e.g. "One Vanderbilt, New York").
   * App.tsx forward-geocodes this and calls setOrigin before applying
   * the routing weights. Null when the user didn't mention an origin.
   */
  originQuery: string | null;
  /**
   * Optional: same as originQuery but for the destination (e.g.
   * "Bryant Park, New York"). Null when the user didn't mention one.
   */
  destinationQuery: string | null;
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
 * straight to the chat panel as the AI bubble text. `reasoning` is
 * always populated on routing responses so the chat panel can show
 * a natural-language summary alongside the silent route update.
 */
export type GeminiResponse =
  | {
      mode: 'routing';
      interpretation: GeminiInterpretation;
      reasoning: string;
    }
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
    rainPreference: {
      type: 'STRING',
      enum: ['avoid_rain', 'neutral'],
    },
    intensity: {
      type: 'STRING',
      enum: ['low', 'medium', 'high'],
    },
    urgency: {
      type: 'STRING',
      enum: ['low', 'medium', 'high'],
    },
    originQuery: {
      type: 'STRING',
    },
    destinationQuery: {
      type: 'STRING',
    },
    reasoning: {
      type: 'STRING',
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
    '  (A) Describing a physical context, comfort preference, or routing intent.',
    '      DEFAULT TO THIS MODE for any input that mentions clothing, body',
    '      state, weather sensitivity, an action verb (walking, cycling,',
    '      running, going to…), a destination, OR words like "shade",',
    '      "sun", "cool", "hot", "wind", "rain", "shelter", "route me",',
    '      "take me", "find me". Examples:',
    '        - "I am overheating in a wool suit, route me through shade"',
    '        - "I am in a suit, it is hot, slight drizzle, running late"',
    '        - "find me sun"',
    '        - "cycling to work"',
    '        - "keep me in the shade"',
    '        - "I hate wind"',
    '      Set mode="routing". Extract EVERY signal you can find. Fill out:',
    '        - sunPreference: avoid_sun | want_sun | neutral',
    '        - windPreference: avoid_wind | neutral',
    '        - rainPreference: avoid_rain | neutral',
    '        - intensity: low | medium | high  (how strong the preference)',
    '        - urgency: low | medium | high    (how time-pressed the user is)',
    '        - originQuery: a place name / address from the prompt for the',
    '          STARTING point (e.g. "I am at One Vanderbilt" => "One Vanderbilt, New York").',
    '          Look for "I am at", "I\'m at", "starting from", "leaving from",',
    '          "from <place>". Append ", New York" if the place is a NYC landmark.',
    '          Set to null when no origin is mentioned.',
    '        - destinationQuery: a place name / address from the prompt for',
    '          the DESTINATION (e.g. "need to get to Bryant Park" => "Bryant Park, New York").',
    '          Look for "to <place>", "going to", "need to get to", "headed to",',
    '          "meeting at". Set to null when no destination is mentioned.',
    '      And ALWAYS fill `reasoning` with a friendly 1–2 sentence',
    '      summary of WHAT you extracted and HOW the route will be',
    '      optimized (e.g. "Got it — you need shade from the heat, rain',
    '      shelter from the drizzle, and the fastest comfortable route.',
    '      Routing for maximum shade and rain cover."). Do NOT fill `answer`.',
    '',
    '  (B) Asking a PURE question (no routing intent, no body context).',
    '      Only use this mode for direct questions about conditions:',
    '        - "what is the weather like?"',
    '        - "is it sunny right now?"',
    '        - "what time is sunset?"',
    '        - "how warm is it?"',
    '      Set mode="qa" and fill out `answer` with a concise (1–2',
    '      sentence) response grounded in the live context above. Do',
    '      NOT fill out the routing fields. If the user mentions ANY',
    '      physical context alongside a question ("it is hot, should',
    '      I bring a hat?"), prefer mode="routing" instead.',
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
    // Reasoning is required for routing mode (the chat bubble text),
    // but be lenient — if Gemini forgets it we synthesize a default
    // so the UX still works.
    const reasoning =
      typeof o.reasoning === 'string' && o.reasoning.trim().length > 0
        ? o.reasoning.trim()
        : 'Got it — updating your route.';
    return {
      mode: 'routing',
      interpretation: {
        sunPreference: o.sunPreference,
        windPreference: o.windPreference,
        // Default rain/urgency to neutral/low when Gemini omits them
        // (back-compat with prior responses that didn't include
        // these new fields).
        rainPreference:
          o.rainPreference === 'avoid_rain' ? 'avoid_rain' : 'neutral',
        intensity: o.intensity,
        urgency:
          o.urgency === 'high' || o.urgency === 'medium' || o.urgency === 'low'
            ? o.urgency
            : 'low',
        // Origin/destination queries are optional — coerce empty/missing
        // to null so the chat handler can early-skip the geocode step.
        originQuery:
          typeof o.originQuery === 'string' && o.originQuery.trim().length > 0
            ? o.originQuery.trim()
            : null,
        destinationQuery:
          typeof o.destinationQuery === 'string' &&
          o.destinationQuery.trim().length > 0
            ? o.destinationQuery.trim()
            : null,
      },
      reasoning,
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
  const wantsAvoidRain = interp.rainPreference === 'avoid_rain';

  let filterMode: FilterMode;
  let toastMessage: string;

  // Priority for FilterMode resolution when multiple preferences fire:
  //   1. want_sun     → 'sunniest' (overrides everything; user explicitly
  //                      asked for sun even if it's wet/windy).
  //   2. avoid_sun + avoid_wind  → 'avoid-both'
  //   3. avoid_sun    → 'avoid-sun'
  //   4. avoid_rain   → 'avoid-rain'  (rain comes before plain wind since
  //                      getting soaked is the more immediate discomfort).
  //   5. avoid_wind   → 'avoid-wind'
  //   6. neutral      → 'no-preference'
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
  } else if (wantsAvoidRain) {
    filterMode = 'avoid-rain';
    toastMessage =
      interp.intensity === 'high'
        ? 'Got it — finding you the driest route 💧'
        : 'Got it — finding rain-sheltered streets 💧';
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

  // intensity high bumps the weight multiplier; urgency high adds
  // a small extra bump on top (route-time matters more so the
  // shorter alternative wins ties).
  let intensityMultiplier = interp.intensity === 'high' ? 1.5 : 1.0;
  if (interp.urgency === 'high') {
    intensityMultiplier *= 0.85; // damp comfort weights so duration wins ties
  }

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
