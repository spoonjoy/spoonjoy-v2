import type { AppLoadContext } from "react-router";
import { redirect } from "react-router";
import { deferBackgroundTask } from "~/lib/background-task.server";
import { getRequestDb } from "~/lib/route-platform.server";
import {
  archiveRecipeCover,
  createCover,
  getRecipeCoverDisplay,
  getRecipeCoverProvenanceLabel,
  getScopedActiveCover,
  RECIPE_COVER_DISPLAY_SELECT,
  setActiveRecipeCover,
  type RecipeCoverVariant,
} from "~/lib/recipe-cover.server";
import { activateSpoonCoverForDecision } from "~/lib/spoon-cover-activation.server";
import {
  createSpoon,
  deleteSpoon,
  isOriginCookCandidate,
  listSpoonsForRecipe,
  SpoonAuthError,
  SpoonNotFoundError,
  SpoonValidationError,
} from "~/lib/recipe-spoon.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";
import { getUserId, requireUserId } from "~/lib/session.server";
import { notifySpoonOnMyRecipe } from "~/lib/notification-triggers.server";
import { fanoutFellowChefOriginCook } from "~/lib/notification-fanout.server";
import { getVapidConfig, type VapidEnv } from "~/lib/env.server";
import { absoluteUrlFromRequest, recipeOgPath } from "~/lib/og-image.server";
import type { PostHogServerEnv } from "~/lib/analytics-server";
import type { ImageGenEnv } from "~/lib/image-gen.server";
import {
  decideSpoonCoverCreation,
  getSpoonCoverPromptMode,
  hasActiveRealRecipeCover,
} from "~/lib/spoon-cover-decision.server";
import type { RecipeCover } from "@prisma/client";
import type { ScheduleSpoonStylizationInput } from "~/lib/spoon-cover-stylization.server";

interface CloudflareContextLike {
  cloudflare?: {
    env?:
      | (ImageGenEnv & { PHOTOS?: R2Bucket } & VapidEnv & PostHogServerEnv)
      | null;
    ctx?: { waitUntil?: (promise: Promise<unknown>) => void };
  };
}

function spoonErrorToResponse(error: unknown): never {
  if (error instanceof SpoonValidationError) {
    throw new Response(error.message, { status: 400 });
  }
  if (error instanceof SpoonAuthError) {
    throw new Response(error.message, { status: 403 });
  }
  if (error instanceof SpoonNotFoundError) {
    throw new Response(error.message, { status: 404 });
  }
  throw error;
}

function getCloudflareCtx(context: AppLoadContext): {
  bucket?: R2Bucket;
  env: (ImageGenEnv & PostHogServerEnv) | null;
  vapidEnv: VapidEnv;
  waitUntil?: (promise: Promise<unknown>) => void;
} {
  const cf = (context as unknown as CloudflareContextLike).cloudflare;
  const envSource = cf?.env ?? null;
  return {
    bucket: cf?.env?.PHOTOS,
    env: envSource
      ? {
          OPENAI_API_KEY: envSource.OPENAI_API_KEY,
          GOOGLE_API_KEY: envSource.GOOGLE_API_KEY,
          GEMINI_API_KEY: envSource.GEMINI_API_KEY,
          GEMINI_IMAGE_MODEL: envSource.GEMINI_IMAGE_MODEL,
          GEMINI_IMAGE_TIMEOUT_MS: envSource.GEMINI_IMAGE_TIMEOUT_MS,
          IMAGE_PROVIDER_PRIMARY: envSource.IMAGE_PROVIDER_PRIMARY,
          IMAGE_PROVIDER_FALLBACKS: envSource.IMAGE_PROVIDER_FALLBACKS,
          POSTHOG_KEY: envSource.POSTHOG_KEY,
          POSTHOG_HOST: envSource.POSTHOG_HOST,
          POSTHOG_DISABLED: envSource.POSTHOG_DISABLED,
        }
      : null,
    vapidEnv: {
      VAPID_PUBLIC_KEY: envSource?.VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: envSource?.VAPID_PRIVATE_KEY,
      VAPID_SUBJECT: envSource?.VAPID_SUBJECT,
    },
    waitUntil: cf?.ctx?.waitUntil ? cf.ctx.waitUntil.bind(cf.ctx) : undefined,
  };
}


interface RecipeDetailRouteArgs {
  request: Request;
  params: { id: string };
  context: AppLoadContext;
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function recipeCoverHistoryFor(recipe: {
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  covers: RecipeCover[];
}) {
  return recipe.covers.map((cover) => {
    const variants = [
      nonEmpty(cover.imageUrl)
        ? {
            variant: "image" as const,
            imageUrl: cover.imageUrl,
            provenanceLabel: getRecipeCoverProvenanceLabel(cover.sourceType, "image"),
            isActive: recipe.activeCoverId === cover.id && recipe.activeCoverVariant === "image",
          }
        : null,
      nonEmpty(cover.stylizedImageUrl)
        ? {
            variant: "stylized" as const,
            imageUrl: cover.stylizedImageUrl,
            provenanceLabel: getRecipeCoverProvenanceLabel(cover.sourceType, "stylized"),
            isActive: recipe.activeCoverId === cover.id && recipe.activeCoverVariant === "stylized",
          }
        : null,
    ].filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      id: cover.id,
      status: cover.status,
      generationStatus: cover.generationStatus,
      sourceType: cover.sourceType,
      sourceImageUrl: cover.sourceImageUrl,
      archivedAt: cover.archivedAt?.toISOString() ?? null,
      createdAt: cover.createdAt.toISOString(),
      isActive: recipe.activeCoverId === cover.id,
      activeVariant: recipe.activeCoverId === cover.id ? recipe.activeCoverVariant : null,
      variants,
    };
  });
}

async function runOrQueueSpoonCoverStylization(
  input: ScheduleSpoonStylizationInput,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<void> {
  if (waitUntil) {
    waitUntil(deferBackgroundTask(() => scheduleSpoonCoverStylization(input)));
    return;
  }
  await scheduleSpoonCoverStylization(input);
}

export async function loadRecipeDetail({ request, params, context }: RecipeDetailRouteArgs) {
  const userId = await getUserId(request, context.cloudflare?.env);
  const { id } = params;

  const database = await getRequestDb(context);

  const recipe = await database.recipe.findUnique({
    where: { id },
    include: {
      chef: {
        select: {
          id: true,
          username: true,
          photoUrl: true,
        },
      },
      sourceRecipe: {
        select: {
          id: true,
          title: true,
          deletedAt: true,
          chef: { select: { username: true } },
        },
      },
      activeCover: {
        select: RECIPE_COVER_DISPLAY_SELECT,
      },
      steps: {
        orderBy: {
          stepNum: "asc",
        },
        include: {
          ingredients: {
            include: {
              unit: true,
              ingredientRef: true,
            },
          },
          usingSteps: {
            include: {
              outputOfStep: {
                select: {
                  stepNum: true,
                  stepTitle: true,
                },
              },
            },
            orderBy: {
              outputStepNum: "asc",
            },
          },
        },
      },
    },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }

  const isOwner = userId !== null && recipe.chefId === userId;
  const activeCover = getScopedActiveCover(recipe);
  const coverDisplay = getRecipeCoverDisplay(recipe, activeCover ? [activeCover] : []);
  const activeRealCover = hasActiveRealRecipeCover(recipe);
  const coverImageUrl = coverDisplay?.displayUrl ?? null;
  const coverProvenanceLabel = coverDisplay?.provenanceLabel ?? null;
  const canonicalUrl = absoluteUrlFromRequest(request.url, `/recipes/${id}`);
  const ogImageUrl = absoluteUrlFromRequest(request.url, recipeOgPath(id));

  const userCookbooks = userId
    ? await database.cookbook.findMany({
        where: { authorId: userId },
        select: {
          id: true,
          title: true,
          recipes: {
            where: { recipeId: id },
            select: { id: true },
          },
        },
        orderBy: { title: "asc" },
      })
    : [];

  const cookbooks = userCookbooks.map((cookbook) => ({
    id: cookbook.id,
    title: cookbook.title,
  }));
  const savedInCookbookIds = userCookbooks
    .filter((cookbook) => cookbook.recipes.length > 0)
    .map((cookbook) => cookbook.id);

  const recipeIngredientKeys = new Set(
    recipe.steps.flatMap((step) =>
      step.ingredients.map((ingredient) => `${ingredient.ingredientRefId}:${ingredient.unitId}`)
    )
  );
  const recipeIngredientRefIds = Array.from(
    new Set(recipe.steps.flatMap((step) => step.ingredients.map((ingredient) => ingredient.ingredientRefId)))
  );

  let hasIngredientsInShoppingList = false;
  if (userId && recipeIngredientKeys.size > 0 && recipeIngredientRefIds.length > 0) {
    const shoppingList = await database.shoppingList.findUnique({
      where: { authorId: userId },
      select: {
        items: {
          where: {
            deletedAt: null,
            ingredientRefId: { in: recipeIngredientRefIds },
          },
          select: {
            ingredientRefId: true,
            unitId: true,
          },
        },
      },
    });

    const shoppingListIngredientKeys = new Set(
      (shoppingList?.items ?? []).map(
        (item) => `${item.ingredientRefId}:${item.unitId ?? "null"}`
      )
    );
    hasIngredientsInShoppingList = Array.from(recipeIngredientKeys).every((key) =>
      shoppingListIngredientKeys.has(key)
    );
  }

  const [spoonsRaw, originCookCandidate] = await Promise.all([
    listSpoonsForRecipe(database, id, { limit: 10 }),
    userId ? isOriginCookCandidate(database, userId, id) : Promise.resolve(false),
  ]);
  const spoons = spoonsRaw.map((spoon) => ({
    id: spoon.id,
    cookedAt: spoon.cookedAt.toISOString(),
    photoUrl: spoon.photoUrl,
    note: spoon.note,
    nextTime: spoon.nextTime,
    chef: spoon.chef,
  }));
  const coverHistoryCovers = isOwner
    ? await database.recipeCover.findMany({
        where: { recipeId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    : [];
  const spoonImages = isOwner
    ? await database.recipeSpoon.findMany({
        where: {
          recipeId: id,
          deletedAt: null,
          photoUrl: { not: null },
        },
        select: {
          id: true,
          photoUrl: true,
          cookedAt: true,
          chef: { select: { id: true, username: true, photoUrl: true } },
        },
        orderBy: [{ cookedAt: "desc" }, { id: "desc" }],
      })
    : [];
  const { activeCover: _activeCover, ...recipeForClient } = recipe;

  return {
    recipe: recipeForClient,
    coverImageUrl,
    coverProvenanceLabel,
    canonicalUrl,
    ogImageUrl,
    isOwner,
    cookbooks,
    savedInCookbookIds,
    hasIngredientsInShoppingList,
    spoons,
    coverHistory: isOwner
      ? recipeCoverHistoryFor({ ...recipe, covers: coverHistoryCovers })
      : [],
    spoonImages: spoonImages
      .filter((spoon): spoon is typeof spoon & { photoUrl: string } => nonEmpty(spoon.photoUrl))
      .map((spoon) => ({
        id: spoon.id,
        photoUrl: spoon.photoUrl,
        cookedAt: spoon.cookedAt.toISOString(),
        chef: spoon.chef,
      })),
    isOriginCookCandidate: originCookCandidate,
    coverPromptMode: getSpoonCoverPromptMode({
      isOwner,
      isOriginCookCandidate: originCookCandidate,
      coverMode: recipe.coverMode,
      hasActiveRealCover: activeRealCover,
    }),
    isAuthenticated: Boolean(userId),
  };
}

async function handleCreateSpoon(
  database: Awaited<ReturnType<typeof getRequestDb>>,
  userId: string,
  recipeId: string,
  formData: FormData,
  context: AppLoadContext,
) {
  const photoEntry = formData.get("photo");
  const photoFile = photoEntry instanceof File && photoEntry.size > 0 ? photoEntry : undefined;
  const noteRaw = formData.get("note");
  const nextTimeRaw = formData.get("nextTime");
  const cookedAtRaw = formData.get("cookedAt");
  const useAsRecipeCover = formData.get("useAsRecipeCover") === "true";
  const note = typeof noteRaw === "string" ? noteRaw : undefined;
  const nextTime = typeof nextTimeRaw === "string" ? nextTimeRaw : undefined;
  let cookedAt: Date | undefined;
  if (typeof cookedAtRaw === "string" && cookedAtRaw.trim() !== "") {
    const parsed = new Date(cookedAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Response("Invalid cookedAt", { status: 400 });
    }
    cookedAt = parsed;
  }

  const { bucket, env, vapidEnv, waitUntil } = getCloudflareCtx(context);

  const result = await createSpoon(
    database,
    { chefId: userId, recipeId, photoFile, note, nextTime, cookedAt },
    { bucket },
  ).catch(spoonErrorToResponse);

  // Notify the recipe owner when someone else cooks their recipe.
  try {
    const vapid = getVapidConfig(vapidEnv);
    const notifyTask = notifySpoonOnMyRecipe(
      database,
      { recipeId, spoonerId: userId },
      { vapid, waitUntil },
    );
    if (waitUntil) {
      waitUntil(notifyTask);
    } else {
      await notifyTask;
    }
  } catch {
    // VAPID not configured locally — skip silently.
  }

  if (result.spoon.photoUrl) {
    const recipe = await database.recipe.findUniqueOrThrow({
      where: { id: recipeId },
      select: {
        id: true,
        title: true,
        chefId: true,
        coverMode: true,
        activeCoverId: true,
        activeCoverVariant: true,
        activeCover: {
          select: {
            id: true,
            recipeId: true,
            imageUrl: true,
            stylizedImageUrl: true,
            sourceType: true,
            status: true,
            archivedAt: true,
          },
        },
      },
    });
    const coverDecision = decideSpoonCoverCreation({
      recipe,
      userId,
      isOriginCook: result.isOriginCook,
      hasPhoto: true,
      useAsRecipeCover,
    });

    if (coverDecision.shouldCreateCover) {
      const cover = await createCover(database, {
        recipeId,
        imageUrl: result.spoon.photoUrl,
        sourceType: "spoon",
        sourceSpoonId: result.spoon.id,
        status: "processing",
        createdById: userId,
        sourceImageUrl: result.spoon.photoUrl,
        generationStatus: "processing",
      });
      await activateSpoonCoverForDecision(database, {
        recipeId,
        coverId: cover.id,
        decision: coverDecision,
        previousActiveCoverId: recipe.activeCoverId,
      });
      const stylizationInput = {
        db: database,
        userId,
        recipeId,
        coverId: cover.id,
        rawPhotoUrl: result.spoon.photoUrl,
        recipeTitle: recipe.title,
        env,
        bucket,
      };
      await runOrQueueSpoonCoverStylization(stylizationInput, waitUntil);
    }
  }

  // Fan-out fellow_chef_origin_cook to every chef the spooner has previously
  // engaged with — runs only when the spoon was an origin cook for the chef.
  if (result.isOriginCook) {
    try {
      const recipeMeta = await database.recipe.findUniqueOrThrow({
        where: { id: recipeId },
        select: { id: true, title: true },
      });
      const spooner = await database.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, username: true },
      });
      const vapid = getVapidConfig(vapidEnv);
      const fanoutTask = fanoutFellowChefOriginCook(
        database,
        {
          spoonerId: userId,
          recipeId: recipeMeta.id,
          recipeTitle: recipeMeta.title,
          spoonerUsername: spooner.username,
        },
        { vapid, waitUntil },
      );
      if (waitUntil) {
        waitUntil(fanoutTask);
      } else {
        await fanoutTask;
      }
    } catch {
      // VAPID not configured locally — skip silently.
    }
  }

  return {
    success: true,
    intent: "createSpoon",
    spoon: { id: result.spoon.id },
    isOriginCook: result.isOriginCook,
  };
}

async function handleDeleteSpoon(
  database: Awaited<ReturnType<typeof getRequestDb>>,
  userId: string,
  formData: FormData,
) {
  const spoonId = formData.get("spoonId");
  if (typeof spoonId !== "string" || !spoonId) {
    throw new Response("spoonId is required", { status: 400 });
  }
  await deleteSpoon(database, spoonId, userId).catch(spoonErrorToResponse);
  return { success: true };
}

export async function handleRecipeDetailAction({ request, params, context }: RecipeDetailRouteArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const { id } = params;
  const formData = await request.formData();
  const intent = formData.get("intent");

  const database = await getRequestDb(context);

  if (intent === "createSpoon") {
    return handleCreateSpoon(database, userId, id, formData, context);
  }

  if (intent === "deleteSpoon") {
    return handleDeleteSpoon(database, userId, formData);
  }

  if (intent === "createCookbookAndSave") {
    await assertActiveRecipe(database, id);

    const title = formData.get("title")?.toString()?.trim();
    if (!title) {
      throw new Response("Title is required", { status: 400 });
    }
    const newCookbook = await database.cookbook.create({
      data: {
        title,
        authorId: userId,
      },
    });
    await database.recipeInCookbook.create({
      data: {
        cookbookId: newCookbook.id,
        recipeId: id,
        addedById: userId,
      },
    });
    return { success: true, newCookbook: { id: newCookbook.id, title: newCookbook.title } };
  }

  if (intent === "addToCookbook" || intent === "removeFromCookbook") {
    const cookbookId = formData.get("cookbookId")?.toString();
    if (cookbookId) {
      const cookbook = await database.cookbook.findUnique({
        where: { id: cookbookId },
        select: { authorId: true },
      });
      if (!cookbook || cookbook.authorId !== userId) {
        throw new Response("Unauthorized", { status: 403 });
      }

      if (intent === "removeFromCookbook") {
        await database.recipeInCookbook.deleteMany({
          where: { cookbookId, recipeId: id },
        });
        return { success: true };
      }

      await assertActiveRecipe(database, id);

      try {
        await database.recipeInCookbook.create({
          data: {
            cookbookId,
            recipeId: id,
            addedById: userId,
          },
        });
        return { success: true };
      } catch (error: any) {
        // P2002 = the recipe is already in this cookbook, so re-adding is an
        // idempotent success. Anything else is a real failure and must surface;
        // swallowing it silently let "saved" UIs hide actual data loss.
        if (error?.code === "P2002") {
          return { success: true };
        }
        throw error;
      }
    }
  }

  const recipe = await database.recipe.findUnique({
    where: { id },
    select: {
      chefId: true,
      deletedAt: true,
      title: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
    },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }

  if (recipe.chefId !== userId) {
    throw new Response("Unauthorized", { status: 403 });
  }

  if (intent === "setRecipeCover") {
    const coverId = formData.get("coverId");
    const variant = formData.get("variant");
    if (typeof coverId !== "string" || !coverId) {
      throw new Response("coverId is required", { status: 400 });
    }
    if (variant !== "image" && variant !== "stylized") {
      throw new Response("Invalid cover variant", { status: 400 });
    }
    await setActiveRecipeCover(database, {
      recipeId: id,
      coverId,
      variant: variant as RecipeCoverVariant,
    });
    return { success: true, intent: "setRecipeCover" };
  }

  if (intent === "setRecipeNoCover") {
    if (formData.get("confirmNoCover") !== "true") {
      throw new Response("confirmNoCover is required", { status: 400 });
    }
    await database.recipe.update({
      where: { id },
      data: {
        activeCoverId: null,
        activeCoverVariant: null,
        coverMode: "none",
      },
    });
    return { success: true, intent: "setRecipeNoCover" };
  }

  if (intent === "createCoverFromSpoon") {
    const spoonId = formData.get("spoonId");
    const activateWhenReady = formData.get("activateWhenReady") === "true";
    if (typeof spoonId !== "string" || !spoonId) {
      throw new Response("spoonId is required", { status: 400 });
    }
    const spoon = await database.recipeSpoon.findFirst({
      where: { id: spoonId, recipeId: id, deletedAt: null, photoUrl: { not: null } },
      select: { id: true, photoUrl: true },
    });
    if (!spoon?.photoUrl) {
      throw new Response("Spoon photo not found", { status: 404 });
    }
    const { bucket, env, waitUntil } = getCloudflareCtx(context);
    const cover = await createCover(database, {
      recipeId: id,
      imageUrl: spoon.photoUrl,
      sourceType: "spoon",
      sourceSpoonId: spoon.id,
      status: "processing",
      createdById: userId,
      sourceImageUrl: spoon.photoUrl,
      generationStatus: "processing",
    });
    await runOrQueueSpoonCoverStylization(
      {
        db: database,
        userId,
        recipeId: id,
        coverId: cover.id,
        rawPhotoUrl: spoon.photoUrl,
        recipeTitle: recipe.title,
        env,
        bucket,
        activateWhenReady,
        suppressAutoActivation: !activateWhenReady,
        activationGuard: activateWhenReady
          ? {
              activeCoverId: recipe.activeCoverId,
              activeCoverVariant: recipe.activeCoverVariant,
              coverMode: recipe.coverMode,
            }
          : undefined,
      },
      waitUntil,
    );
    return { success: true, intent: "createCoverFromSpoon", coverId: cover.id };
  }

  if (intent === "regenerateRecipeCover") {
    const coverId = formData.get("coverId");
    const activateWhenReady = formData.get("activateWhenReady") === "true";
    if (typeof coverId !== "string" || !coverId) {
      throw new Response("coverId is required", { status: 400 });
    }
    const cover = await database.recipeCover.findFirst({
      where: { id: coverId, recipeId: id },
    });
    if (!cover) {
      throw new Response("Cover not found", { status: 404 });
    }
    if (cover.status === "archived" || cover.archivedAt) {
      throw new Response("Archived covers cannot be regenerated", { status: 400 });
    }
    const rawPhotoUrl = cover.sourceImageUrl || cover.imageUrl;
    if (!rawPhotoUrl.trim()) {
      throw new Response("Cover has no source image", { status: 400 });
    }
    const { bucket, env, waitUntil } = getCloudflareCtx(context);
    await database.recipeCover.update({
      where: { id: cover.id },
      data: {
        status: "processing",
        generationStatus: "processing",
        failureReason: null,
        sourceImageUrl: cover.sourceImageUrl ?? rawPhotoUrl,
      },
    });
    await runOrQueueSpoonCoverStylization(
      {
        db: database,
        userId,
        recipeId: id,
        coverId: cover.id,
        rawPhotoUrl,
        recipeTitle: recipe.title,
        env,
        bucket,
        sourceType: cover.sourceType === "spoon" ? "spoon" : "chef-upload",
        activateWhenReady,
        suppressAutoActivation: !activateWhenReady,
        activationGuard: activateWhenReady
          ? {
              activeCoverId: recipe.activeCoverId,
              activeCoverVariant: recipe.activeCoverVariant,
              coverMode: recipe.coverMode,
            }
          : undefined,
      },
      waitUntil,
    );
    return { success: true, intent: "regenerateRecipeCover", coverId: cover.id };
  }

  if (intent === "archiveRecipeCover") {
    const coverId = formData.get("coverId");
    if (typeof coverId !== "string" || !coverId) {
      throw new Response("coverId is required", { status: 400 });
    }
    const replacementCoverId = formData.get("replacementCoverId");
    const replacementVariant = formData.get("replacementVariant");
    if (
      typeof replacementCoverId === "string" &&
      replacementCoverId &&
      replacementVariant !== "image" &&
      replacementVariant !== "stylized"
    ) {
      throw new Response("replacementVariant is required", { status: 400 });
    }

    try {
      await archiveRecipeCover(database, {
        recipeId: id,
        coverId,
        replacementCoverId:
          typeof replacementCoverId === "string" && replacementCoverId
            ? replacementCoverId
            : null,
        replacementVariant:
          replacementVariant === "image" || replacementVariant === "stylized"
            ? replacementVariant
            : null,
        confirmNoCover: formData.get("confirmNoCover") === "true",
      });
    } catch (error) {
      throw new Response((error as Error).message, { status: 400 });
    }
    return { success: true, intent: "archiveRecipeCover" };
  }

  if (intent === "delete") {
    await database.recipe.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return redirect("/recipes");
  }

  return null;
}

async function assertActiveRecipe(
  database: Awaited<ReturnType<typeof getRequestDb>>,
  recipeId: string,
) {
  const recipe = await database.recipe.findFirst({
    where: { id: recipeId, deletedAt: null },
    select: { id: true },
  });
  if (!recipe) {
    throw new Response("Recipe not found", { status: 404 });
  }
}
