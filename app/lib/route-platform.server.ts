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
    INGREDIENT_PARSE_PROVIDER:
      env?.INGREDIENT_PARSE_PROVIDER ?? process.env.INGREDIENT_PARSE_PROVIDER,
    INGREDIENT_PARSE_MODEL:
      env?.INGREDIENT_PARSE_MODEL ?? process.env.INGREDIENT_PARSE_MODEL,
    INGREDIENT_PARSE_TIMEOUT_MS:
      env?.INGREDIENT_PARSE_TIMEOUT_MS ?? process.env.INGREDIENT_PARSE_TIMEOUT_MS,
    INGREDIENT_PARSE_MAX_RETRIES:
      env?.INGREDIENT_PARSE_MAX_RETRIES ?? process.env.INGREDIENT_PARSE_MAX_RETRIES,
  };
}

export async function getRequestDb(context: AppLoadContext): Promise<PrismaClientType> {
  const env = getCloudflareEnv(context);

  if (env?.DB) {
    return getDb({ DB: env.DB });
  }

  return getLocalDb();
}
