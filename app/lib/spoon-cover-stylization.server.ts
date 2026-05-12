import type { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import {
  createOpenAIImageRunner,
  stylizeSpoonPhoto,
  type ImageGenRunner,
} from "~/lib/image-gen.server";
import { tryConsumeImageGenQuota } from "~/lib/image-gen-ledger.server";

export interface ScheduleSpoonStylizationInput {
  db: PrismaClient;
  userId: string;
  coverId: string;
  rawPhotoUrl: string;
  recipeTitle: string;
  env?: { OPENAI_API_KEY?: string } | null;
  bucket?: R2Bucket;
  runner?: ImageGenRunner;
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: Pick<Console, "error">;
}

function createDefaultRunner(
  env: { OPENAI_API_KEY?: string } | null | undefined,
): ImageGenRunner | null {
  if (!env?.OPENAI_API_KEY) return null;
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
  });
  return createOpenAIImageRunner(client as never);
}

/**
 * Background task: consumes one stylization quota unit, runs gpt-image-1 (with DALL-E
 * 3 fallback) against `rawPhotoUrl`, and writes the resulting URL to the cover row's
 * `stylizedImageUrl`. Failures leave `stylizedImageUrl` null and are logged. This
 * function never throws.
 */
export async function scheduleSpoonCoverStylization(
  input: ScheduleSpoonStylizationInput,
): Promise<void> {
  const logger = input.logger ?? console;
  try {
    const consumed = await tryConsumeImageGenQuota(
      input.db,
      input.userId,
      "stylization",
      input.now ? { now: () => new Date(input.now!()) } : {},
    );
    if (!consumed) return;

    const runner = input.runner ?? createDefaultRunner(input.env);
    if (!runner) return;

    const result = await stylizeSpoonPhoto(input.rawPhotoUrl, input.recipeTitle, {
      env: input.env ?? {},
      runner,
      fetchImpl: input.fetchImpl,
      bucket: input.bucket,
      now: input.now,
    });

    await input.db.recipeCover.update({
      where: { id: input.coverId },
      data: { stylizedImageUrl: result.url },
    });
  } catch (error) {
    logger.error("spoon cover stylization failed", error);
  }
}
