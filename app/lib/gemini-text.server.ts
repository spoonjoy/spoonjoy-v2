/**
 * Gemini structured-JSON text completion — the **fallback** provider for
 * Spoonjoy's text LLM features (ingredient parsing today; recipe import later)
 * when the primary provider (OpenAI) is unavailable.
 *
 * Calls Google's `generativelanguage` `:generateContent` endpoint with a JSON
 * `responseSchema`, so the model is constrained to emit schema-shaped JSON. The
 * caller still validates the parsed result against its own (Zod) schema — this
 * adapter only guarantees "a JSON string came back", never that its contents are
 * correct — so a malformed/empty Gemini response surfaces as a thrown
 * {@link GeminiTextError} and the caller can fall through to its primary error.
 *
 * `GOOGLE_API_KEY` already exists as a Worker secret (used by image generation).
 */

const GENERATIVELANGUAGE_MODELS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

/** Default Gemini text model. Overridable via `GEMINI_TEXT_MODEL`. */
export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-2.5-flash";

/** Default per-call timeout for the Gemini text fallback. */
export const DEFAULT_GEMINI_TEXT_TIMEOUT_MS = 8_000;

export interface GeminiTextConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * Error from the Gemini text API. Preserves the HTTP `status` and Google error
 * `code` so callers can classify/telemeter it like other LLM-call failures.
 */
export class GeminiTextError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(
    message: string,
    options?: { status?: number | null; code?: string | null; cause?: unknown },
  ) {
    super(message);
    this.name = "GeminiTextError";
    this.status = options?.status ?? null;
    this.code = options?.code ?? null;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

/** Concatenate all text parts of the first candidate. */
function extractText(response: GeminiGenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

/** Turn a non-2xx Gemini response into a {@link GeminiTextError}. */
async function geminiTextApiError(response: Response): Promise<GeminiTextError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const googleError =
    typeof payload === "object" && payload !== null && "error" in payload
      ? (payload as { error?: { message?: string; status?: string } }).error
      : undefined;
  const message = googleError?.message ?? response.statusText;
  return new GeminiTextError(
    `Gemini text generation failed with status ${response.status}: ${message}`,
    { status: response.status, code: googleError?.status ?? String(response.status) },
  );
}

/**
 * Generate a JSON completion from Gemini, constrained to `responseSchema`.
 * Returns the raw JSON text (the caller parses + validates it). Throws
 * {@link GeminiTextError} on timeout, transport failure, a non-2xx response, a
 * non-JSON body, or empty content.
 */
export async function geminiGenerateJson(input: {
  config: GeminiTextConfig;
  systemPrompt: string;
  userText: string;
  responseSchema: unknown;
}): Promise<string> {
  const { config, systemPrompt, userText, responseSchema } = input;
  const fetchImpl = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(
      `${GENERATIVELANGUAGE_MODELS_URL}/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userText }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema,
          },
        }),
        signal: controller.signal,
      },
    );
  } catch (cause) {
    const timedOut = controller.signal.aborted;
    throw new GeminiTextError(timedOut ? "Gemini request timed out" : "Gemini request failed", {
      code: timedOut ? "timeout" : "network",
      cause,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw await geminiTextApiError(response);
  }

  let payload: GeminiGenerateContentResponse;
  try {
    payload = (await response.json()) as GeminiGenerateContentResponse;
  } catch (cause) {
    throw new GeminiTextError("Gemini returned a non-JSON response", {
      status: response.status,
      cause,
    });
  }

  const text = extractText(payload);
  if (!text) {
    throw new GeminiTextError("Gemini returned empty content", { status: response.status });
  }
  return text;
}
