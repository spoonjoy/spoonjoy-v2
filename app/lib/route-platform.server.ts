import type { PrismaClient as PrismaClientType } from "@prisma/client";
import type { AppLoadContext } from "react-router";
import { getDb, getLocalDb } from "~/lib/db.server";

export function getCloudflareEnv(context: AppLoadContext): Env | undefined {
  return context.cloudflare?.env ?? undefined;
}

export async function getRequestDb(context: AppLoadContext): Promise<PrismaClientType> {
  const env = getCloudflareEnv(context);

  if (env?.DB) {
    return getDb({ DB: env.DB });
  }

  return getLocalDb();
}
