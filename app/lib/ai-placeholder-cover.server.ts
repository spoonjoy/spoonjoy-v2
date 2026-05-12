import type { PrismaClient } from "@prisma/client";
import {
  createOpenAIImageRunner,
  generatePlaceholderImage,
  type ImageGenRunner,
} from "~/lib/image-gen.server";
import { tryConsumeImageGenQuota } from "~/lib/image-gen-ledger.server";
import { createOpenAIClient } from "~/lib/openai-client.server";

export interface SchedulePlaceholderInput {
  db: PrismaClient;
  userId: string;
  coverId: string;
  title: string;
  description: string | null;
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
  const client = createOpenAIClient({ apiKey: env.OPENAI_API_KEY });
  return createOpenAIImageRunner(client as never);
}

/**
 * Background task: spends a per-user image-gen quota unit, generates the AI placeholder
 * cover for `coverId`, and replaces its `imageUrl` with the resulting R2 URL. Failures
 * leave the SVG fallback in place and are logged. This function never throws.
 */
export async function scheduleAiPlaceholderCover(
  input: SchedulePlaceholderInput,
): Promise<void> {
  const logger = input.logger ?? console;
  try {
    const consumed = await tryConsumeImageGenQuota(
      input.db,
      input.userId,
      "placeholder",
      input.now ? { now: () => new Date(input.now!()) } : {},
    );
    if (!consumed) return;

    const runner = input.runner ?? createDefaultRunner(input.env);
    if (!runner) return;

    const url = await generatePlaceholderImage(input.title, input.description, {
      env: input.env ?? {},
      runner,
      fetchImpl: input.fetchImpl,
      bucket: input.bucket,
      now: input.now,
    });

    await input.db.recipeCover.update({
      where: { id: input.coverId },
      data: { imageUrl: url },
    });
  } catch (error) {
    logger.error("ai-placeholder cover generation failed", error);
  }
}
