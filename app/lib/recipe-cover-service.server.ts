import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { deferBackgroundTask } from "~/lib/background-task.server";
import { sanitizeImagePromptAddition, type ImageGenEnv, type ImageGenRunner } from "~/lib/image-gen.server";
import { validateRecipeImageAssignment } from "~/lib/recipe-image-assignment.server";
import { setActiveRecipeCover } from "~/lib/recipe-cover.server";
import type { RecipeCoverSourceType } from "~/lib/recipe-cover-schema.server";
import { scheduleAiPlaceholderCover } from "~/lib/ai-placeholder-cover.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";

export interface RecipeCoverGenerationContext {
  db: PrismaClientType;
  env?: ImageGenEnv | null;
  bucket?: R2Bucket;
  imageGenRunner?: ImageGenRunner;
  allowLocalImageFallback?: boolean;
  waitUntil?: (promise: Promise<unknown>) => void;
  logger?: Pick<Console, "error">;
}

export interface RecipeCoverActivationGuard {
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string;
}

export type RecipeCoverTaskScheduling = "await" | "waitUntil";

interface RecipeCoverTaskOptions {
  scheduling?: RecipeCoverTaskScheduling;
  defer?: boolean;
}

export interface ScheduleRecipeCoverStylizationInput {
  userId: string;
  recipeId: string;
  coverId: string;
  parentCoverId?: string | null;
  promptAddition?: string | null;
  rawPhotoUrl: string;
  recipeTitle: string;
  sourceType: Extract<RecipeCoverSourceType, "chef-upload" | "spoon">;
  activateWhenReady?: boolean;
  suppressAutoActivation?: boolean;
  activationGuard?: RecipeCoverActivationGuard;
}

export interface ScheduleRecipePlaceholderGenerationInput {
  userId: string;
  recipeId: string;
  coverId: string;
  title: string;
  description: string | null;
  promptAddition?: string | null;
  activateWhenReady?: boolean;
  suppressAutoActivation?: boolean;
  activationGuard?: RecipeCoverActivationGuard;
}

export interface RecipeCoverImageSourceInput {
  imageUrl: string;
  ownerId: string;
  bucket?: R2Bucket;
  allowLocalImageFallback?: boolean;
}

function scheduledTask<T>(defer: boolean | undefined, task: () => Promise<T>): Promise<T> {
  return defer ? deferBackgroundTask(task) : task();
}

async function dispatchRecipeCoverTask(
  context: RecipeCoverGenerationContext,
  task: Promise<unknown>,
  scheduling: RecipeCoverTaskScheduling,
): Promise<void> {
  if (scheduling === "waitUntil" && context.waitUntil) {
    context.waitUntil(task);
    return;
  }
  await task;
}

export function sanitizeRecipeCoverPromptAddition(value: string | null | undefined): string | null {
  return sanitizeImagePromptAddition(value);
}

export async function validateRecipeCoverImageSource(input: RecipeCoverImageSourceInput): Promise<void> {
  await validateRecipeImageAssignment(input);
}

export async function scheduleRecipeCoverStylization(
  context: RecipeCoverGenerationContext,
  input: ScheduleRecipeCoverStylizationInput,
  options: RecipeCoverTaskOptions = {},
): Promise<void> {
  const task = scheduledTask(options.defer, () => scheduleSpoonCoverStylization({
    db: context.db,
    userId: input.userId,
    recipeId: input.recipeId,
    coverId: input.coverId,
    parentCoverId: input.parentCoverId,
    promptAddition: input.promptAddition,
    rawPhotoUrl: input.rawPhotoUrl,
    recipeTitle: input.recipeTitle,
    env: context.env ?? null,
    bucket: context.bucket,
    runner: context.imageGenRunner,
    allowLocalImageFallback: context.allowLocalImageFallback,
    sourceType: input.sourceType,
    activateWhenReady: input.activateWhenReady,
    suppressAutoActivation: input.suppressAutoActivation,
    activationGuard: input.activationGuard,
    logger: context.logger,
  }));
  await dispatchRecipeCoverTask(context, task, options.scheduling ?? "await");
}

export async function scheduleRecipePlaceholderGeneration(
  context: RecipeCoverGenerationContext,
  input: ScheduleRecipePlaceholderGenerationInput,
  options: RecipeCoverTaskOptions = {},
): Promise<void> {
  const task = scheduledTask(options.defer, () => scheduleAiPlaceholderCover({
    db: context.db,
    userId: input.userId,
    recipeId: input.recipeId,
    coverId: input.coverId,
    title: input.title,
    description: input.description,
    promptAddition: input.promptAddition,
    env: context.env ?? null,
    bucket: context.bucket,
    runner: context.imageGenRunner,
    activateWhenReady: input.activateWhenReady,
    suppressAutoActivation: input.suppressAutoActivation ?? !input.activateWhenReady,
    activationGuard: input.activationGuard,
    logger: context.logger,
  }));
  await dispatchRecipeCoverTask(context, task, options.scheduling ?? "await");
}

export async function activateRecipeCoverWithBestAvailableVariant(
  db: PrismaClientType,
  input: { recipeId: string; coverId: string },
): Promise<void> {
  const cover = await db.recipeCover.findUnique({
    where: { id: input.coverId },
    select: { stylizedImageUrl: true },
  });
  await setActiveRecipeCover(db, {
    recipeId: input.recipeId,
    coverId: input.coverId,
    variant: cover?.stylizedImageUrl ? "stylized" : "image",
  });
}
