import type { AppLoadContext } from "react-router";
import { redirect } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { createCover, getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";
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
import { requireUserId } from "~/lib/session.server";

interface CloudflareContextLike {
  cloudflare?: {
    env?: { OPENAI_API_KEY?: string; PHOTOS?: R2Bucket } | null;
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
  env: { OPENAI_API_KEY?: string } | null;
  waitUntil?: (promise: Promise<unknown>) => void;
} {
  const cf = (context as unknown as CloudflareContextLike).cloudflare;
  return {
    bucket: cf?.env?.PHOTOS,
    env: cf?.env ? { OPENAI_API_KEY: cf.env.OPENAI_API_KEY } : null,
    waitUntil: cf?.ctx?.waitUntil ? cf.ctx.waitUntil.bind(cf.ctx) : undefined,
  };
}

interface RecipeDetailRouteArgs {
  request: Request;
  params: { id: string };
  context: AppLoadContext;
}

export async function loadRecipeDetail({ request, params, context }: RecipeDetailRouteArgs) {
  const userId = await requireUserId(request);
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
      covers: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

  const isOwner = recipe.chefId === userId;
  const coverImageUrl = getRecipeCoverImageUrl(recipe, recipe.covers);

  const userCookbooks = await database.cookbook.findMany({
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
  });

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
  if (recipeIngredientKeys.size > 0 && recipeIngredientRefIds.length > 0) {
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
    isOriginCookCandidate(database, userId, id),
  ]);
  const spoons = spoonsRaw.map((spoon) => ({
    id: spoon.id,
    cookedAt: spoon.cookedAt.toISOString(),
    photoUrl: spoon.photoUrl,
    note: spoon.note,
    nextTime: spoon.nextTime,
    chef: spoon.chef,
  }));

  return {
    recipe,
    coverImageUrl,
    isOwner,
    cookbooks,
    savedInCookbookIds,
    hasIngredientsInShoppingList,
    spoons,
    isOriginCookCandidate: originCookCandidate,
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

  const { bucket, env, waitUntil } = getCloudflareCtx(context);

  const result = await createSpoon(
    database,
    { chefId: userId, recipeId, photoFile, note, nextTime, cookedAt },
    { bucket },
  ).catch(spoonErrorToResponse);

  if (result.isOriginCook && result.spoon.photoUrl) {
    const recipe = await database.recipe.findUniqueOrThrow({
      where: { id: recipeId },
      select: { id: true, title: true },
    });
    const cover = await createCover(database, {
      recipeId,
      imageUrl: result.spoon.photoUrl,
      sourceType: "spoon",
      sourceSpoonId: result.spoon.id,
    });
    const task = scheduleSpoonCoverStylization({
      db: database,
      userId,
      coverId: cover.id,
      rawPhotoUrl: result.spoon.photoUrl,
      recipeTitle: recipe.title,
      env,
      bucket,
    });
    if (waitUntil) {
      waitUntil(task);
    } else {
      await task;
    }
  }

  return { success: true, spoon: { id: result.spoon.id }, isOriginCook: result.isOriginCook };
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
  const userId = await requireUserId(request);
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

      try {
        await database.recipeInCookbook.create({
          data: {
            cookbookId,
            recipeId: id,
            addedById: userId,
          },
        });
        return { success: true };
      } catch {
        return { success: true };
      }
    }
  }

  const recipe = await database.recipe.findUnique({
    where: { id },
    select: { chefId: true, deletedAt: true },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }

  if (recipe.chefId !== userId) {
    throw new Response("Unauthorized", { status: 403 });
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
