import type { PrismaClient as PrismaClientType } from "@prisma/client";
import type { AppLoadContext } from "react-router";
import { getDb, getLocalDb } from "~/lib/db.server";
import type { IngredientParserEnv } from "~/lib/ingredient-parse.server";

export function getCloudflareEnv(context: AppLoadContext): Env | undefined {
  return context.cloudflare?.env ?? undefined;
}

export function getIngredientParserEnv(context: AppLoadContext): IngredientParserEnv {
  const env = getCloudflareEnv(context);

  return {
    OPENAI_API_KEY: env?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
    // Gemini fallback provider — parseIngredients falls back to Gemini when a
    // retryable OpenAI call fails. These MUST stay wired here: the fallback is
    // gated on a truthy googleApiKey, so omitting GOOGLE_API_KEY silently makes
    // the fallback dead on every interactive parse surface (the exact outage
    // this is meant to cover). GEMINI_TEXT_* are optional overrides (defaults
    // apply when unset).
    GOOGLE_API_KEY: env?.GOOGLE_API_KEY ?? process.env.GOOGLE_API_KEY,
    GEMINI_TEXT_MODEL: env?.GEMINI_TEXT_MODEL ?? process.env.GEMINI_TEXT_MODEL,
    GEMINI_TEXT_TIMEOUT_MS:
      env?.GEMINI_TEXT_TIMEOUT_MS ?? process.env.GEMINI_TEXT_TIMEOUT_MS,
    INGREDIENT_PARSE_PROVIDER:
      env?.INGREDIENT_PARSE_PROVIDER ?? process.env.INGREDIENT_PARSE_PROVIDER,
    INGREDIENT_PARSE_MODEL:
      env?.INGREDIENT_PARSE_MODEL ?? process.env.INGREDIENT_PARSE_MODEL,
    INGREDIENT_PARSE_TIMEOUT_MS:
      env?.INGREDIENT_PARSE_TIMEOUT_MS ?? process.env.INGREDIENT_PARSE_TIMEOUT_MS,
    INGREDIENT_PARSE_MAX_RETRIES:
      env?.INGREDIENT_PARSE_MAX_RETRIES ?? process.env.INGREDIENT_PARSE_MAX_RETRIES,
    // PostHog keys ride along so parseIngredients can capture LLM-call failures.
    POSTHOG_KEY: env?.POSTHOG_KEY ?? process.env.POSTHOG_KEY,
    POSTHOG_HOST: env?.POSTHOG_HOST ?? process.env.POSTHOG_HOST,
    POSTHOG_DISABLED: env?.POSTHOG_DISABLED ?? process.env.POSTHOG_DISABLED,
  };
}

export async function getRequestDb(context: AppLoadContext): Promise<PrismaClientType> {
  const env = getCloudflareEnv(context);

  if (env?.DB) {
    return getDb({ DB: env.DB });
  }

  return getLocalDb();
}
