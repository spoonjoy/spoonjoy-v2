/**
 * LLM fallback extractor for recipe-import.
 *
 * The runner is dependency-injectable via `clientFactory` so unit tests never
 * touch a real OpenAI client and no real OpenAI calls occur.
 */

import { z } from "zod";
import { createOpenAIClient } from "~/lib/openai-client.server";
import { extractOpenAIErrorFields } from "~/lib/openai-error.server";

export const DEFAULT_RECIPE_LLM_MODEL = "gpt-4o-mini";
export const DEFAULT_RECIPE_LLM_TIMEOUT_MS = 30_000;
const MAX_PROMPT_CHARS = 50_000;

export interface RecipeLlmEnv {
  OPENAI_API_KEY?: string;
  RECIPE_LLM_MODEL?: string;
  RECIPE_LLM_TIMEOUT_MS?: string;
}

export interface OpenAIRecipeLlmClient {
  chat: {
    completions: {
      create: (args: {
        model: string;
        messages: { role: "system" | "user"; content: string }[];
        response_format: { type: "json_schema"; json_schema: unknown };
      }) => Promise<{
        choices: Array<{
          message: {
            content?: string | null;
            refusal?: string | null;
          };
        }>;
      }>;
    };
  };
}

export const RECIPE_LLM_PROVIDER = "openai";

export interface RecipeLlmRunner {
  /** LLM provider backing this runner (always `openai` today). */
  readonly provider?: string;
  /** Resolved model id (e.g. `gpt-4o-mini`). */
  readonly model?: string;
  extract(text: string): Promise<{
    title: string;
    description: string | null;
    servings: string | null;
    ingredients: string[];
    steps: string[];
  }>;
}

export class RecipeLlmError extends Error {
  readonly cause?: unknown;
  /** Original OpenAI error code (e.g. `insufficient_quota`), when known. */
  readonly code: string | null;
  /** Original OpenAI error type, when known. */
  readonly type: string | null;
  /** Original OpenAI HTTP status, when known. */
  readonly status: number | null;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RecipeLlmError";
    if (cause !== undefined) this.cause = cause;
    const fields = extractOpenAIErrorFields(cause);
    this.code = fields.code;
    this.type = fields.type;
    this.status = fields.status;
  }
}

const ParsedLlmRecipeSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  servings: z.string().nullable(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
});

const RECIPE_RESPONSE_JSON_SCHEMA = {
  name: "recipe_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: ["string", "null"] },
      servings: { type: ["string", "null"] },
      ingredients: { type: "array", items: { type: "string" } },
      steps: { type: "array", items: { type: "string" } },
    },
    required: ["title", "description", "servings", "ingredients", "steps"],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT =
  "You are an expert recipe parser. Extract a recipe from the given plain text. " +
  "If no recipe is present, return empty strings/arrays. Output strictly the schema fields. English only.";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function htmlToPlainText(html: string): string {
  let text = html;
  // Strip block tags whose content should be discarded.
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, "");
  // Treat block-element boundaries as newlines.
  text = text.replace(
    /<\/?(?:p|br|div|li|ul|ol|h[1-6]|tr|td|th|section|article)\b[^>]*>/gi,
    "\n",
  );
  // Strip remaining tags.
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  // Collapse runs of horizontal whitespace, but preserve newlines.
  text = text.replace(/[ \t\r\f\v]+/g, " ");
  // Collapse runs of newlines.
  text = text.replace(/\n+/g, "\n");
  text = text.trim();
  if (text.length > MAX_PROMPT_CHARS) {
    text = text.slice(0, MAX_PROMPT_CHARS);
  }
  return text;
}

function resolveTimeout(value: string | undefined): number {
  if (!value) return DEFAULT_RECIPE_LLM_TIMEOUT_MS;
  const n = Number(value.trim());
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_RECIPE_LLM_TIMEOUT_MS;
  return n;
}

function getStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const s = (err as { status?: unknown }).status;
  return typeof s === "number" ? s : undefined;
}

function mapOpenAIError(err: unknown): RecipeLlmError {
  const status = getStatus(err);
  if (status === 401 || status === 403) {
    return new RecipeLlmError("OpenAI authentication failed", err);
  }
  if (status === 429) {
    return new RecipeLlmError("OpenAI rate limit exceeded", err);
  }
  if (status !== undefined && status >= 500) {
    return new RecipeLlmError("OpenAI temporary failure", err);
  }
  return new RecipeLlmError("Recipe LLM call failed", err);
}

export interface CreateRecipeLlmRunnerOpts {
  clientFactory?: (config: {
    apiKey: string;
    timeout: number;
  }) => OpenAIRecipeLlmClient;
}

function defaultClientFactory(config: {
  apiKey: string;
  timeout: number;
}): OpenAIRecipeLlmClient {
  return createOpenAIClient({
    apiKey: config.apiKey,
    timeout: config.timeout,
  }) as unknown as OpenAIRecipeLlmClient;
}

export function createOpenAIRecipeLlmRunner(
  env: RecipeLlmEnv,
  opts: CreateRecipeLlmRunnerOpts = {},
): RecipeLlmRunner {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new RecipeLlmError("OPENAI_API_KEY is required for recipe-import LLM");
  }
  const model = env.RECIPE_LLM_MODEL?.trim() || DEFAULT_RECIPE_LLM_MODEL;
  const timeout = resolveTimeout(env.RECIPE_LLM_TIMEOUT_MS);
  const factory = opts.clientFactory ?? defaultClientFactory;
  const client = factory({ apiKey, timeout });
  return {
    provider: RECIPE_LLM_PROVIDER,
    model,
    async extract(text) {
      let response;
      try {
        response = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
          response_format: {
            type: "json_schema",
            json_schema: RECIPE_RESPONSE_JSON_SCHEMA,
          },
        });
      } catch (err) {
        throw mapOpenAIError(err);
      }
      const choice = response.choices[0];
      if (!choice) {
        throw new RecipeLlmError("OpenAI returned no choices");
      }
      if (choice.message.refusal) {
        throw new RecipeLlmError(`OpenAI refused: ${choice.message.refusal}`);
      }
      const content = choice.message.content;
      if (!content) {
        throw new RecipeLlmError("OpenAI returned empty content");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        throw new RecipeLlmError("OpenAI returned non-JSON content", err);
      }
      const validated = ParsedLlmRecipeSchema.safeParse(parsed);
      if (!validated.success) {
        throw new RecipeLlmError(
          `OpenAI response failed schema validation: ${validated.error.message}`,
          validated.error,
        );
      }
      return validated.data;
    },
  };
}
