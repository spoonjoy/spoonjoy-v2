import type { Prisma, PrismaClient as PrismaClientType } from "@prisma/client";
import {
  ApiAuthError,
  assertCanUseOwnerEmail,
  createApiCredential,
  requireApiPrincipal,
  type ApiPrincipal,
} from "~/lib/api-auth.server";
import { validateActiveRecipeTitleUnique } from "~/lib/recipe-title-uniqueness.server";
import { createCover, getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";
import { normalizeSearchScope, searchSpoonjoy } from "~/lib/search.server";
import {
  createSpoon as createRecipeSpoon,
  deleteSpoon as deleteRecipeSpoon,
  isOriginCookCandidate,
  listSpoonsByChef,
  listSpoonsForRecipe,
  updateSpoon as updateRecipeSpoon,
  SpoonValidationError,
  SpoonAuthError,
  SpoonNotFoundError,
} from "~/lib/recipe-spoon.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";
import type { ImageGenRunner } from "~/lib/image-gen.server";
import * as recipeImport from "~/lib/recipe-import.server";
import {
  forkRecipe,
  ForkSourceNotFoundError,
  ForkTitleExhaustedError,
} from "~/lib/recipe-fork.server";

export interface SpoonjoyApiContext {
  db: PrismaClientType;
  principal?: ApiPrincipal | null;
  defaultOwnerEmail?: string;
  waitUntil?: (promise: Promise<unknown>) => void;
  env?: { OPENAI_API_KEY?: string } | null;
  bucket?: R2Bucket;
  imageGenRunner?: ImageGenRunner;
  logger?: Pick<Console, "error">;
}

export interface SpoonjoyApiOperationInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface SpoonjoyApiOperation extends SpoonjoyApiOperationInfo {
  handle(args: Record<string, unknown>, context: SpoonjoyApiContext): Promise<unknown>;
}

type Database = PrismaClientType | Prisma.TransactionClient;

type RecipeWithDetails = Prisma.RecipeGetPayload<{
  include: {
    chef: { select: { id: true; email: true; username: true } };
    covers: true;
    steps: {
      include: {
        ingredients: { include: { unit: true; ingredientRef: true } };
      };
    };
  };
}>;

type ShoppingListWithItems = Prisma.ShoppingListGetPayload<{
  include: {
    items: { include: { unit: true; ingredientRef: true } };
  };
}>;

type ApiCredentialRecord = Prisma.ApiCredentialGetPayload<{}>;

type CookbookWithRecipes = Prisma.CookbookGetPayload<{
  include: {
    author: { select: { id: true; email: true; username: true } };
    recipes: {
      include: {
        recipe: {
          include: {
            chef: { select: { id: true; email: true; username: true } };
            covers: true;
            steps: {
              include: {
                ingredients: { include: { unit: true; ingredientRef: true } };
              };
            };
          };
        };
      };
    };
  };
}>;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

const cookbookRecipeInclude = {
  author: { select: { id: true, email: true, username: true } },
  recipes: {
    orderBy: { createdAt: "desc" },
    include: {
      recipe: {
        include: {
          chef: { select: { id: true, email: true, username: true } },
          covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
          steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
        },
      },
    },
  },
} satisfies Prisma.CookbookInclude;

function json(value: unknown): unknown {
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args[key]);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function positiveNumber(value: unknown, key: string): number {
  const parsed = optionalPositiveNumber(value);
  if (parsed === undefined) throw new Error(`${key} must be a positive number`);
  return parsed;
}

function optionalQuantity(value: unknown, key: string): number | null {
  if (value === undefined || value === null) return null;
  const parsed = optionalPositiveNumber(value);
  if (parsed === undefined) throw new Error(`${key} must be a positive number`);
  return parsed;
}

function requiredBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

function ownerEmail(args: Record<string, unknown>, context: SpoonjoyApiContext): string | undefined {
  const requestedOwnerEmail = optionalString(args.ownerEmail)?.toLowerCase();

  if (context.principal) {
    const principalEmail = context.principal.email.toLowerCase();
    if (requestedOwnerEmail) {
      assertCanUseOwnerEmail(context.principal, requestedOwnerEmail);
    }
    return principalEmail;
  }

  return requestedOwnerEmail ?? context.defaultOwnerEmail?.toLowerCase();
}

function requireOwnerEmail(args: Record<string, unknown>, context: SpoonjoyApiContext): string {
  const email = ownerEmail(args, context);
  if (!email) throw new ApiAuthError("ownerEmail is required, or authenticate/set SPOONJOY_MCP_USER_EMAIL", 401);
  return email.toLowerCase();
}

function rejectOwnerEmail(args: Record<string, unknown>): void {
  if (Object.prototype.hasOwnProperty.call(args, "ownerEmail")) {
    throw new ApiAuthError(
      "ownerEmail is not supported on this op; use API token",
      400,
    );
  }
}

function runOrSchedule(
  context: SpoonjoyApiContext,
  task: Promise<unknown>,
): Promise<unknown> {
  if (context.waitUntil) {
    context.waitUntil(task);
    return Promise.resolve();
  }
  return task;
}

function formatSpoon(spoon: {
  id: string;
  chefId: string;
  recipeId: string;
  cookedAt: Date;
  photoUrl: string | null;
  note: string | null;
  nextTime: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: spoon.id,
    chefId: spoon.chefId,
    recipeId: spoon.recipeId,
    cookedAt: spoon.cookedAt.toISOString(),
    photoUrl: spoon.photoUrl,
    note: spoon.note,
    nextTime: spoon.nextTime,
    deletedAt: spoon.deletedAt ? spoon.deletedAt.toISOString() : null,
    createdAt: spoon.createdAt.toISOString(),
    updatedAt: spoon.updatedAt.toISOString(),
  };
}

function formatCover(cover: {
  id: string;
  recipeId: string;
  imageUrl: string;
  stylizedImageUrl: string | null;
  sourceType: string;
  sourceSpoonId: string | null;
  createdAt: Date;
}) {
  return {
    id: cover.id,
    recipeId: cover.recipeId,
    imageUrl: cover.imageUrl,
    stylizedImageUrl: cover.stylizedImageUrl,
    sourceType: cover.sourceType,
    sourceSpoonId: cover.sourceSpoonId,
    createdAt: cover.createdAt.toISOString(),
  };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function usernameFromEmail(email: string): string {
  const local = email.split("@")[0]?.toLowerCase() || "agent";
  return local.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}

async function uniqueUsername(db: Database, email: string): Promise<string> {
  const base = usernameFromEmail(email);
  let candidate = base;
  let suffix = 2;

  while (await db.user.findUnique({ where: { username: candidate } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function getOrCreateOwner(db: Database, email: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;

  return db.user.create({
    data: {
      email,
      username: await uniqueUsername(db, email),
    },
  });
}

async function getOrCreateUnit(db: Database, name: string) {
  const normalized = normalizeName(name);
  const existing = await db.unit.findUnique({ where: { name: normalized } });
  if (existing) return existing;
  return db.unit.create({ data: { name: normalized } });
}

async function getOrCreateIngredientRef(db: Database, name: string) {
  const normalized = normalizeName(name);
  const existing = await db.ingredientRef.findUnique({ where: { name: normalized } });
  if (existing) return existing;
  return db.ingredientRef.create({ data: { name: normalized } });
}

function formatRecipe(recipe: RecipeWithDetails) {
  const steps = [...recipe.steps]
    .sort((a, b) => a.stepNum - b.stepNum)
    .map((step) => ({
      id: step.id,
      stepNum: step.stepNum,
      title: step.stepTitle,
      description: step.description,
      duration: step.duration,
      ingredients: [...step.ingredients]
        .sort((a, b) => a.ingredientRef.name.localeCompare(b.ingredientRef.name))
        .map((ingredient) => ({
          id: ingredient.id,
          quantity: ingredient.quantity,
          unit: ingredient.unit.name,
          name: ingredient.ingredientRef.name,
        })),
    }));

  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    sourceUrl: recipe.sourceUrl,
    sourceRecipeId: recipe.sourceRecipeId,
    imageUrl: getRecipeCoverImageUrl(recipe, recipe.covers),
    chef: recipe.chef,
    steps,
    ingredientCount: steps.reduce((sum, step) => sum + step.ingredients.length, 0),
  };
}

function formatRecipeSummary(recipe: RecipeWithDetails) {
  const ingredientNames = new Set<string>();
  for (const step of recipe.steps) {
    for (const ingredient of step.ingredients) {
      ingredientNames.add(ingredient.ingredientRef.name);
    }
  }

  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    chef: recipe.chef,
    stepCount: recipe.steps.length,
    ingredientNames: [...ingredientNames].sort(),
  };
}

function formatShoppingList(list: ShoppingListWithItems) {
  return {
    id: list.id,
    ownerId: list.authorId,
    items: [...list.items]
      .filter((item) => !item.deletedAt)
      .sort((a, b) => a.sortIndex - b.sortIndex || a.ingredientRef.name.localeCompare(b.ingredientRef.name))
      .map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unit: item.unit?.name ?? null,
        name: item.ingredientRef.name,
        checked: item.checked,
        categoryKey: item.categoryKey,
        iconKey: item.iconKey,
        sortIndex: item.sortIndex,
      })),
  };
}

function formatApiCredential(credential: ApiCredentialRecord) {
  return {
    id: credential.id,
    userId: credential.userId,
    name: credential.name,
    tokenPrefix: credential.tokenPrefix,
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    revokedAt: credential.revokedAt?.toISOString() ?? null,
    createdAt: credential.createdAt.toISOString(),
    updatedAt: credential.updatedAt.toISOString(),
  };
}

function activeCookbookRecipes(cookbook: CookbookWithRecipes) {
  return cookbook.recipes.filter((item) => !item.recipe.deletedAt);
}

function formatCookbookSummary(cookbook: CookbookWithRecipes) {
  const recipes = activeCookbookRecipes(cookbook);

  return {
    id: cookbook.id,
    title: cookbook.title,
    ownerId: cookbook.authorId,
    author: cookbook.author,
    recipeCount: recipes.length,
    recipes: recipes.map((item) => ({
      id: item.recipe.id,
      title: item.recipe.title,
      imageUrl: getRecipeCoverImageUrl(item.recipe, item.recipe.covers),
    })),
  };
}

function formatCookbook(cookbook: CookbookWithRecipes) {
  return {
    ...formatCookbookSummary(cookbook),
    recipes: activeCookbookRecipes(cookbook).map((item) => ({
      relationId: item.id,
      addedById: item.addedById,
      addedAt: item.createdAt.toISOString(),
      recipe: formatRecipeSummary(item.recipe),
    })),
  };
}

function parseIngredient(value: unknown, index: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`steps.ingredients[${index}] must be an object`);
  }

  const raw = value as Record<string, unknown>;
  return {
    name: requiredString(raw, "name"),
    quantity: positiveNumber(raw.quantity, "quantity"),
    unit: requiredString(raw, "unit"),
  };
}

function parseStep(value: unknown, index: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`steps[${index}] must be an object`);
  }

  const raw = value as Record<string, unknown>;
  const rawIngredients = Array.isArray(raw.ingredients) ? raw.ingredients : [];

  return {
    title: optionalString(raw.title),
    description: requiredString(raw, "description"),
    duration: optionalPositiveNumber(raw.duration),
    ingredients: rawIngredients.map((ingredient, ingredientIndex) => parseIngredient(ingredient, ingredientIndex)),
  };
}

function parseSteps(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("steps must be an array");
  return value.map((step, index) => parseStep(step, index));
}

async function findRecipeByIdOrTitle(db: PrismaClientType, args: Record<string, unknown>) {
  const id = optionalString(args.id);
  const title = optionalString(args.title);

  if (!id && !title) throw new Error("id or title is required");

  return db.recipe.findFirst({
    where: id ? { id, deletedAt: null } : { title, deletedAt: null },
    include: {
      chef: { select: { id: true, email: true, username: true } },
      covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
    },
  });
}

async function findOwnerCookbook(db: Database, ownerId: string, args: Record<string, unknown>) {
  const cookbookId = optionalString(args.cookbookId);
  const title = optionalString(args.title) ?? optionalString(args.cookbookTitle);

  if (!cookbookId && !title) throw new Error("cookbookId or title is required");

  return db.cookbook.findFirst({
    where: {
      authorId: ownerId,
      ...(cookbookId ? { id: cookbookId } : { title }),
    },
    include: cookbookRecipeInclude,
  });
}

async function reloadOwnerCookbook(db: Database, ownerId: string, cookbookId: string) {
  return db.cookbook.findFirstOrThrow({
    where: { id: cookbookId, authorId: ownerId },
    include: cookbookRecipeInclude,
  });
}

async function nextSortIndex(db: Database, shoppingListId: string): Promise<number> {
  const maxItem = await db.shoppingListItem.findFirst({
    where: { shoppingListId, deletedAt: null },
    orderBy: { sortIndex: "desc" },
    select: { sortIndex: true },
  });
  return (maxItem?.sortIndex ?? -1) + 1;
}

async function getOrCreateShoppingList(db: Database, ownerId: string) {
  const existing = await db.shoppingList.findUnique({ where: { authorId: ownerId } });
  if (existing) return existing;
  return db.shoppingList.create({ data: { authorId: ownerId } });
}

async function reloadShoppingList(db: Database, shoppingListId: string): Promise<ShoppingListWithItems> {
  return db.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { items: { include: { unit: true, ingredientRef: true } } },
  });
}

async function getCredentialOwner(db: Database, args: Record<string, unknown>, context: SpoonjoyApiContext) {
  const email = requireOwnerEmail(args, context);
  return getOrCreateOwner(db, email);
}

const healthTool: SpoonjoyApiOperation = {
  name: "health",
  description: "Check Spoonjoy API readiness and whether the caller can use owner-scoped write operations.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handle(_args, context) {
    return json({
      ok: true,
      app: "spoonjoy-v2",
      authenticated: Boolean(context.principal),
      authSource: context.principal?.source ?? null,
      defaultOwnerEmail: context.defaultOwnerEmail ?? null,
      writable: Boolean(context.principal ?? context.defaultOwnerEmail),
    });
  },
};

const createApiTokenTool: SpoonjoyApiOperation = {
  name: "create_api_token",
  description: "Create an owner-scoped Spoonjoy API token. The token is returned once and is stored hashed.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      name: { type: "string" },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const owner = await getCredentialOwner(context.db, args, context);
    const name = optionalString(args.name) ?? "Spoonjoy API token";
    const created = await createApiCredential(context.db, owner.id, name);

    return json({
      token: created.token,
      credential: formatApiCredential(created.credential),
    });
  },
};

const listApiTokensTool: SpoonjoyApiOperation = {
  name: "list_api_tokens",
  description: "List API token metadata for the configured owner. Token secrets are never returned.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const owner = await getCredentialOwner(context.db, args, context);
    const credentials = await context.db.apiCredential.findMany({
      where: { userId: owner.id },
      orderBy: { createdAt: "desc" },
    });

    return json({ credentials: credentials.map(formatApiCredential) });
  },
};

const revokeApiTokenTool: SpoonjoyApiOperation = {
  name: "revoke_api_token",
  description: "Revoke one API token owned by the configured owner.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      credentialId: { type: "string" },
    },
    required: ["credentialId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const owner = await getCredentialOwner(context.db, args, context);
    const credentialId = requiredString(args, "credentialId");
    const credential = await context.db.apiCredential.findFirst({
      where: { id: credentialId, userId: owner.id },
    });

    if (!credential) throw new Error("API token not found");

    const updated = credential.revokedAt
      ? credential
      : await context.db.apiCredential.update({
          where: { id: credential.id },
          data: { revokedAt: new Date() },
        });

    return json({
      revoked: !credential.revokedAt,
      credential: formatApiCredential(updated),
    });
  },
};

const searchRecipesTool: SpoonjoyApiOperation = {
  name: "search_recipes",
  description: "Full-text search Spoonjoy recipes by title, description, source URL, steps, ingredients, and optional chef email.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      chefEmail: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const query = optionalString(args.query);
    const chefEmail = optionalString(args.chefEmail)?.toLowerCase();
    const limit = normalizeLimit(args.limit);
    const chef = chefEmail
      ? await context.db.user.findUnique({ where: { email: chefEmail }, select: { id: true } })
      : null;

    if (chefEmail && !chef) {
      return json({ recipes: [] });
    }

    const results = await searchSpoonjoy(context.db, {
      query,
      scope: "recipes",
      ownerId: chef?.id,
      limit,
    });
    const resultOrder = new Map(results.map((result, index) => [result.id, index]));

    const recipes = results.length
      ? await context.db.recipe.findMany({
          where: {
            id: { in: results.map((result) => result.id) },
            deletedAt: null,
          },
          include: {
            chef: { select: { id: true, email: true, username: true } },
            covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
            steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
          },
        })
      : [];

    recipes.sort((a, b) => (resultOrder.get(a.id) as number) - (resultOrder.get(b.id) as number));

    return json({ recipes: recipes.map(formatRecipeSummary) });
  },
};

const searchSpoonjoyTool: SpoonjoyApiOperation = {
  name: "search_spoonjoy",
  description: "Full-text search Spoonjoy recipes, cookbooks, chefs, and the configured owner's private shopping list.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      scope: {
        type: "string",
        enum: ["all", "recipes", "cookbooks", "chefs", "shopping-list", "shopping"],
      },
      ownerEmail: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const query = optionalString(args.query);
    const scope = normalizeSearchScope(optionalString(args.scope));
    const email = ownerEmail(args, context)?.toLowerCase();
    const owner = email ? await getOrCreateOwner(context.db, email) : null;

    const results = await searchSpoonjoy(context.db, {
      query,
      scope,
      viewerId: owner?.id,
      limit: normalizeLimit(args.limit),
    });

    return json({
      query: query ?? "",
      scope,
      results,
    });
  },
};

const searchShoppingListTool: SpoonjoyApiOperation = {
  name: "search_shopping_list",
  description: "Full-text search the configured owner's private shopping list by ingredient, unit, category, icon, and checked state.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      query: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const owner = await getOrCreateOwner(context.db, email);
    const query = optionalString(args.query);
    const items = await searchSpoonjoy(context.db, {
      query,
      scope: "shopping-list",
      viewerId: owner.id,
      ownerId: owner.id,
      limit: normalizeLimit(args.limit),
    });

    return json({
      query: query ?? "",
      items,
    });
  },
};

const getRecipeTool: SpoonjoyApiOperation = {
  name: "get_recipe",
  description: "Fetch a Spoonjoy recipe by id or exact title with ordered steps and ingredients.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const recipe = await findRecipeByIdOrTitle(context.db, args);
    return json({ recipe: recipe ? formatRecipe(recipe) : null });
  },
};

const createRecipeTool: SpoonjoyApiOperation = {
  name: "create_recipe",
  description: "Create a Spoonjoy recipe for the configured owner, including steps and ingredients.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      servings: { type: "string" },
      sourceUrl: { type: "string" },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            duration: { type: "number" },
            ingredients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  quantity: { type: "number" },
                  unit: { type: "string" },
                },
                required: ["name", "quantity", "unit"],
                additionalProperties: false,
              },
            },
          },
          required: ["description"],
          additionalProperties: false,
        },
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const title = requiredString(args, "title");
    const steps = parseSteps(args.steps);

    const recipe = await context.db.$transaction(async (tx) => {
      const owner = await getOrCreateOwner(tx, email);
      const titleUniqueness = await validateActiveRecipeTitleUnique(tx, {
        chefId: owner.id,
        title,
      });
      if (!titleUniqueness.valid) throw new Error(titleUniqueness.error);

      const created = await tx.recipe.create({
        data: {
          title,
          description: optionalString(args.description) ?? null,
          servings: optionalString(args.servings) ?? null,
          sourceUrl: optionalString(args.sourceUrl) ?? null,
          chefId: owner.id,
        },
      });

      for (const [index, step] of steps.entries()) {
        const stepNum = index + 1;
        await tx.recipeStep.create({
          data: {
            recipeId: created.id,
            stepNum,
            stepTitle: step.title ?? null,
            description: step.description,
            duration: step.duration ?? null,
          },
        });

        for (const ingredient of step.ingredients) {
          const unit = await getOrCreateUnit(tx, ingredient.unit);
          const ingredientRef = await getOrCreateIngredientRef(tx, ingredient.name);
          await tx.ingredient.create({
            data: {
              recipeId: created.id,
              stepNum,
              quantity: ingredient.quantity,
              unitId: unit.id,
              ingredientRefId: ingredientRef.id,
            },
          });
        }
      }

      const fullRecipe = await tx.recipe.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          chef: { select: { id: true, email: true, username: true } },
          covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
          steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
        },
      });

      return fullRecipe;
    });

    return json({ recipe: formatRecipe(recipe) });
  },
};

const addRecipeToShoppingListTool: SpoonjoyApiOperation = {
  name: "add_recipe_to_shopping_list",
  description: "Add all ingredients from a recipe to the configured owner shopping list, merging duplicates.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      recipeId: { type: "string" },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const recipeId = requiredString(args, "recipeId");

    const result = await context.db.$transaction(async (tx) => {
      const owner = await getOrCreateOwner(tx, email);
      const shoppingList = await getOrCreateShoppingList(tx, owner.id);
      const ingredients = await tx.ingredient.findMany({
        where: { recipeId },
        include: { unit: true, ingredientRef: true },
      });

      let created = 0;
      let updated = 0;

      for (const ingredient of ingredients) {
        const existing = await tx.shoppingListItem.findUnique({
          where: {
            shoppingListId_unitId_ingredientRefId: {
              shoppingListId: shoppingList.id,
              unitId: ingredient.unitId,
              ingredientRefId: ingredient.ingredientRefId,
            },
          },
        });

        if (existing) {
          updated += 1;
          await tx.shoppingListItem.update({
            where: { id: existing.id },
            data: {
              quantity: (existing.quantity ?? 0) + ingredient.quantity,
              checked: false,
              checkedAt: null,
              deletedAt: null,
            },
          });
        } else {
          created += 1;
          await tx.shoppingListItem.create({
            data: {
              shoppingListId: shoppingList.id,
              quantity: ingredient.quantity,
              unitId: ingredient.unitId,
              ingredientRefId: ingredient.ingredientRefId,
              sortIndex: await nextSortIndex(tx, shoppingList.id),
            },
          });
        }
      }

      const reloaded = await tx.shoppingList.findUniqueOrThrow({
        where: { id: shoppingList.id },
        include: { items: { include: { unit: true, ingredientRef: true } } },
      });

      return { created, updated, shoppingList: reloaded };
    });

    return json({
      created: result.created,
      updated: result.updated,
      shoppingList: formatShoppingList(result.shoppingList),
    });
  },
};

const listCookbooksTool: SpoonjoyApiOperation = {
  name: "list_cookbooks",
  description: "List cookbooks owned by the configured owner, with active recipe counts and covers.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      query: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const owner = await getOrCreateOwner(context.db, email);
    const query = optionalString(args.query);

    const cookbooks = await context.db.cookbook.findMany({
      where: {
        authorId: owner.id,
        ...(query ? { title: { contains: query } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: normalizeLimit(args.limit),
      include: cookbookRecipeInclude,
    });

    return json({ cookbooks: cookbooks.map(formatCookbookSummary) });
  },
};

const getCookbookTool: SpoonjoyApiOperation = {
  name: "get_cookbook",
  description: "Fetch one cookbook owned by the configured owner by cookbookId or exact title.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      cookbookId: { type: "string" },
      title: { type: "string" },
      cookbookTitle: { type: "string" },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const owner = await getOrCreateOwner(context.db, email);
    const cookbook = await findOwnerCookbook(context.db, owner.id, args);

    return json({ cookbook: cookbook ? formatCookbook(cookbook) : null });
  },
};

const createCookbookTool: SpoonjoyApiOperation = {
  name: "create_cookbook",
  description: "Create or return an existing cookbook for the configured owner by exact title.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      title: { type: "string" },
    },
    required: ["title"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const title = requiredString(args, "title");

    const result = await context.db.$transaction(async (tx) => {
      const owner = await getOrCreateOwner(tx, email);
      const existing = await tx.cookbook.findFirst({
        where: { authorId: owner.id, title },
        include: cookbookRecipeInclude,
      });

      if (existing) {
        return { created: false, cookbook: existing };
      }

      const created = await tx.cookbook.create({
        data: { authorId: owner.id, title },
      });

      return {
        created: true,
        cookbook: await reloadOwnerCookbook(tx, owner.id, created.id),
      };
    });

    return json({ created: result.created, cookbook: formatCookbook(result.cookbook) });
  },
};

const addRecipeToCookbookTool: SpoonjoyApiOperation = {
  name: "add_recipe_to_cookbook",
  description: "Idempotently add an active recipe to a cookbook owned by the configured owner.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      cookbookId: { type: "string" },
      title: { type: "string" },
      cookbookTitle: { type: "string" },
      recipeId: { type: "string" },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const recipeId = requiredString(args, "recipeId");

    const result = await context.db.$transaction(async (tx) => {
      const owner = await getOrCreateOwner(tx, email);
      const cookbook = await findOwnerCookbook(tx, owner.id, args);
      if (!cookbook) throw new Error("Cookbook not found");

      const recipe = await tx.recipe.findFirst({
        where: { id: recipeId, deletedAt: null },
        select: { id: true },
      });
      if (!recipe) throw new Error("Recipe not found");

      const existing = await tx.recipeInCookbook.findUnique({
        where: {
          cookbookId_recipeId: {
            cookbookId: cookbook.id,
            recipeId,
          },
        },
      });

      if (existing) {
        return {
          added: false,
          cookbook: await reloadOwnerCookbook(tx, owner.id, cookbook.id),
        };
      }

      await tx.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId,
          addedById: owner.id,
        },
      });

      return {
        added: true,
        cookbook: await reloadOwnerCookbook(tx, owner.id, cookbook.id),
      };
    });

    return json({ added: result.added, cookbook: formatCookbook(result.cookbook) });
  },
};

const removeRecipeFromCookbookTool: SpoonjoyApiOperation = {
  name: "remove_recipe_from_cookbook",
  description: "Idempotently remove a recipe from a cookbook owned by the configured owner.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      cookbookId: { type: "string" },
      title: { type: "string" },
      cookbookTitle: { type: "string" },
      recipeId: { type: "string" },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const recipeId = requiredString(args, "recipeId");

    const result = await context.db.$transaction(async (tx) => {
      const owner = await getOrCreateOwner(tx, email);
      const cookbook = await findOwnerCookbook(tx, owner.id, args);
      if (!cookbook) throw new Error("Cookbook not found");

      const deleted = await tx.recipeInCookbook.deleteMany({
        where: {
          cookbookId: cookbook.id,
          recipeId,
        },
      });

      return {
        removed: deleted.count > 0,
        cookbook: await reloadOwnerCookbook(tx, owner.id, cookbook.id),
      };
    });

    return json({ removed: result.removed, cookbook: formatCookbook(result.cookbook) });
  },
};

const addShoppingListItemTool: SpoonjoyApiOperation = {
  name: "add_shopping_list_item",
  description: "Add or restore one manual item on the configured owner shopping list, merging matching items.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      name: { type: "string" },
      quantity: { type: "number", exclusiveMinimum: 0 },
      unit: { type: "string" },
      categoryKey: { type: "string" },
      iconKey: { type: "string" },
    },
    required: ["name"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const name = requiredString(args, "name");
    const quantity = optionalQuantity(args.quantity, "quantity");
    const unitName = optionalString(args.unit);
    const categoryKey = optionalString(args.categoryKey) ?? null;
    const iconKey = optionalString(args.iconKey) ?? null;

    const result = await context.db.$transaction(async (tx) => {
      const owner = await getOrCreateOwner(tx, email);
      const shoppingList = await getOrCreateShoppingList(tx, owner.id);
      const ingredientRef = await getOrCreateIngredientRef(tx, name);
      const unit = unitName ? await getOrCreateUnit(tx, unitName) : null;
      const existing = await tx.shoppingListItem.findFirst({
        where: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          unitId: unit?.id ?? null,
        },
      });

      if (existing) {
        const shouldMoveToEnd = Boolean(existing.checked || existing.checkedAt || existing.deletedAt);
        await tx.shoppingListItem.update({
          where: { id: existing.id },
          data: {
            quantity: quantity === null ? existing.quantity : (existing.quantity ?? 0) + quantity,
            checked: false,
            checkedAt: null,
            deletedAt: null,
            sortIndex: shouldMoveToEnd ? await nextSortIndex(tx, shoppingList.id) : existing.sortIndex,
            categoryKey: categoryKey ?? existing.categoryKey,
            iconKey: iconKey ?? existing.iconKey,
          },
        });

        return { created: 0, updated: 1, shoppingList: await reloadShoppingList(tx, shoppingList.id) };
      }

      await tx.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          quantity,
          unitId: unit?.id ?? null,
          ingredientRefId: ingredientRef.id,
          sortIndex: await nextSortIndex(tx, shoppingList.id),
          categoryKey,
          iconKey,
        },
      });

      return { created: 1, updated: 0, shoppingList: await reloadShoppingList(tx, shoppingList.id) };
    });

    return json({
      created: result.created,
      updated: result.updated,
      shoppingList: formatShoppingList(result.shoppingList),
    });
  },
};

const setShoppingListItemCheckedTool: SpoonjoyApiOperation = {
  name: "set_shopping_list_item_checked",
  description: "Set checked state for one active item on the configured owner shopping list.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      itemId: { type: "string" },
      checked: { type: "boolean" },
    },
    required: ["itemId", "checked"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const itemId = requiredString(args, "itemId");
    const checked = requiredBoolean(args, "checked");

    const result = await context.db.$transaction(async (tx) => {
      const owner = await getOrCreateOwner(tx, email);
      const shoppingList = await getOrCreateShoppingList(tx, owner.id);
      const item = await tx.shoppingListItem.findFirst({
        where: { id: itemId, shoppingListId: shoppingList.id, deletedAt: null },
      });
      if (!item) throw new Error("Shopping list item not found");

      await tx.shoppingListItem.update({
        where: { id: item.id },
        data: {
          checked,
          checkedAt: checked ? new Date() : null,
          sortIndex: checked ? await nextSortIndex(tx, shoppingList.id) : item.sortIndex,
        },
      });

      return reloadShoppingList(tx, shoppingList.id);
    });

    return json({ shoppingList: formatShoppingList(result) });
  },
};

const removeShoppingListItemTool: SpoonjoyApiOperation = {
  name: "remove_shopping_list_item",
  description: "Soft-remove one item from the configured owner shopping list.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      itemId: { type: "string" },
    },
    required: ["itemId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const itemId = requiredString(args, "itemId");

    const result = await context.db.$transaction(async (tx) => {
      const owner = await getOrCreateOwner(tx, email);
      const shoppingList = await getOrCreateShoppingList(tx, owner.id);
      const item = await tx.shoppingListItem.findFirst({
        where: { id: itemId, shoppingListId: shoppingList.id },
      });
      if (!item) throw new Error("Shopping list item not found");

      if (!item.deletedAt) {
        await tx.shoppingListItem.update({
          where: { id: item.id },
          data: { deletedAt: new Date() },
        });
      }

      return reloadShoppingList(tx, shoppingList.id);
    });

    return json({ shoppingList: formatShoppingList(result) });
  },
};

const getShoppingListTool: SpoonjoyApiOperation = {
  name: "get_shopping_list",
  description: "Fetch the configured owner shopping list.",
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const owner = await getOrCreateOwner(context.db, email);
    const shoppingList = await getOrCreateShoppingList(context.db, owner.id);
    const reloaded = await reloadShoppingList(context.db, shoppingList.id);

    return json({ shoppingList: formatShoppingList(reloaded) });
  },
};

const createSpoonTool: SpoonjoyApiOperation = {
  name: "create_spoon",
  description: "Create a RecipeSpoon (cook event) authored by the authenticated principal.",
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string" },
      photoUrl: { type: "string" },
      note: { type: "string" },
      nextTime: { type: "string" },
      cookedAt: { type: "string" },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const cookedAtRaw = optionalString(args.cookedAt);
    const cookedAt = cookedAtRaw ? new Date(cookedAtRaw) : undefined;
    if (cookedAt && Number.isNaN(cookedAt.getTime())) {
      throw new Error("cookedAt must be a valid ISO date string");
    }

    const result = await createRecipeSpoon(context.db, {
      chefId: principal.id,
      recipeId,
      photoUrl: optionalString(args.photoUrl) ?? null,
      note: optionalString(args.note) ?? null,
      nextTime: optionalString(args.nextTime) ?? null,
      cookedAt,
    });

    let coverPayload: ReturnType<typeof formatCover> | null = null;
    if (result.isOriginCook && result.spoon.photoUrl) {
      const recipe = await context.db.recipe.findUniqueOrThrow({
        where: { id: recipeId },
        select: { id: true, title: true },
      });
      const cover = await createCover(context.db, {
        recipeId,
        imageUrl: result.spoon.photoUrl,
        sourceType: "spoon",
        sourceSpoonId: result.spoon.id,
      });
      coverPayload = formatCover(cover);
      const task = scheduleSpoonCoverStylization({
        db: context.db,
        userId: principal.id,
        coverId: cover.id,
        rawPhotoUrl: result.spoon.photoUrl,
        recipeTitle: recipe.title,
        env: context.env ?? null,
        bucket: context.bucket,
        runner: context.imageGenRunner,
        logger: context.logger,
      });
      await runOrSchedule(context, task);
    }

    return json({
      spoon: formatSpoon(result.spoon),
      isOriginCook: result.isOriginCook,
      cover: coverPayload,
    });
  },
};

const updateSpoonTool: SpoonjoyApiOperation = {
  name: "update_spoon",
  description: "Update note, nextTime, photoUrl, or cookedAt on a spoon owned by the authenticated principal.",
  inputSchema: {
    type: "object",
    properties: {
      spoonId: { type: "string" },
      note: { type: "string" },
      nextTime: { type: "string" },
      photoUrl: { type: ["string", "null"] },
      cookedAt: { type: "string" },
    },
    required: ["spoonId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    const principal = requireApiPrincipal(context.principal);
    const spoonId = requiredString(args, "spoonId");
    const patch: {
      note?: string | null;
      nextTime?: string | null;
      photoUrl?: string | null;
      cookedAt?: Date;
    } = {};
    if (Object.prototype.hasOwnProperty.call(args, "note")) {
      patch.note = typeof args.note === "string" ? args.note : null;
    }
    if (Object.prototype.hasOwnProperty.call(args, "nextTime")) {
      patch.nextTime = typeof args.nextTime === "string" ? args.nextTime : null;
    }
    if (Object.prototype.hasOwnProperty.call(args, "photoUrl")) {
      patch.photoUrl = typeof args.photoUrl === "string" ? args.photoUrl : null;
    }
    if (Object.prototype.hasOwnProperty.call(args, "cookedAt")) {
      const cookedAtRaw = optionalString(args.cookedAt);
      const cookedAt = cookedAtRaw ? new Date(cookedAtRaw) : undefined;
      if (!cookedAt || Number.isNaN(cookedAt.getTime())) {
        throw new Error("cookedAt must be a valid ISO date string");
      }
      patch.cookedAt = cookedAt;
    }

    const spoon = await updateRecipeSpoon(context.db, spoonId, principal.id, patch);
    return json({ spoon: formatSpoon(spoon) });
  },
};

function formatSpoonWithChef(spoon: {
  id: string;
  chefId: string;
  recipeId: string;
  cookedAt: Date;
  photoUrl: string | null;
  note: string | null;
  nextTime: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  chef: { id: string; username: string; photoUrl: string | null };
}) {
  return {
    ...formatSpoon(spoon),
    chef: spoon.chef,
  };
}

const listSpoonsForRecipeTool: SpoonjoyApiOperation = {
  name: "list_spoons_for_recipe",
  description: "List the most-recent non-deleted spoons for a recipe.",
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string" },
      limit: { type: "number" },
      offset: { type: "number" },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const offset = typeof args.offset === "number" ? args.offset : undefined;
    const spoons = await listSpoonsForRecipe(context.db, recipeId, {
      limit,
      offset,
    });
    const recipe = await context.db.recipe.findUnique({
      where: { id: recipeId },
      include: {
        covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      },
    });
    const coverImageUrl = recipe
      ? getRecipeCoverImageUrl(recipe, recipe.covers)
      : null;
    return json({
      spoons: spoons.map((spoon) => ({
        ...formatSpoonWithChef(spoon),
        coverImageUrl,
      })),
    });
  },
};

const listSpoonsByChefTool: SpoonjoyApiOperation = {
  name: "list_spoons_by_chef",
  description: "List the chef's most-recent non-deleted spoons across all recipes.",
  inputSchema: {
    type: "object",
    properties: {
      chefIdOrUsername: { type: "string" },
      limit: { type: "number" },
      offset: { type: "number" },
    },
    required: ["chefIdOrUsername"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    requireApiPrincipal(context.principal);
    const chefIdOrUsername = requiredString(args, "chefIdOrUsername");
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const offset = typeof args.offset === "number" ? args.offset : undefined;
    const spoons = await listSpoonsByChef(context.db, chefIdOrUsername, {
      limit,
      offset,
    });
    return json({
      spoons: spoons.map((spoon) => ({
        ...formatSpoonWithChef(spoon),
        recipe: {
          id: spoon.recipe.id,
          title: spoon.recipe.title,
          chefId: spoon.recipe.chefId,
        },
        coverImageUrl: getRecipeCoverImageUrl(
          { id: spoon.recipe.id, title: spoon.recipe.title },
          spoon.recipe.covers,
        ),
      })),
    });
  },
};

const deleteSpoonTool: SpoonjoyApiOperation = {
  name: "delete_spoon",
  description: "Soft-delete a spoon owned by the authenticated principal.",
  inputSchema: {
    type: "object",
    properties: { spoonId: { type: "string" } },
    required: ["spoonId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    const principal = requireApiPrincipal(context.principal);
    const spoonId = requiredString(args, "spoonId");
    const spoon = await deleteRecipeSpoon(context.db, spoonId, principal.id);
    return json({ spoon: formatSpoon(spoon) });
  },
};

const importRecipeFromUrlTool: SpoonjoyApiOperation = {
  name: "import_recipe_from_url",
  description:
    "Import a recipe from a public web URL into the authenticated principal's library.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      dryRun: { type: "boolean", default: false },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    const url = requiredString(args, "url");
    const dryRun = args.dryRun === true;
    const chefId = await resolveImportChefId(context);
    const result = await recipeImport.importRecipeFromUrl(
      { url, chefId, dryRun },
      {
        db: context.db,
        env: context.env ?? undefined,
        bucket: context.bucket,
        waitUntil: context.waitUntil,
        imageGenRunner: context.imageGenRunner,
        logger: context.logger,
      },
    );
    return json({
      recipe: result.recipe,
      recipeId: result.recipeId,
      confidence: result.confidence,
      source: result.source,
      existingRecipeId: result.existingRecipeId,
      coverPending: result.coverPending,
    });
  },
};

async function resolveImportChefId(context: SpoonjoyApiContext): Promise<string> {
  if (context.principal) return context.principal.id;
  const email = context.defaultOwnerEmail?.toLowerCase();
  if (!email) {
    throw new ApiAuthError("Authentication required for import_recipe_from_url", 401);
  }
  const user = await context.db.user.findUnique({ where: { email } });
  if (!user) {
    throw new ApiAuthError(
      "Authentication required: defaultOwnerEmail does not match any user",
      401,
    );
  }
  return user.id;
}

const forkRecipeTool: SpoonjoyApiOperation = {
  name: "fork_recipe",
  description:
    "Fork an existing Spoonjoy recipe into the authenticated principal's kitchen. Clones title, description, servings, steps, ingredients, and step-output uses; snapshots the source's latest cover; sets sourceRecipeId on the new recipe.",
  inputSchema: {
    type: "object",
    properties: {
      sourceRecipeId: { type: "string" },
      title: {
        type: "string",
        description:
          "Optional title override. Subject to the same `(chefId, title)` collision suffixing as the default title.",
      },
    },
    required: ["sourceRecipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    const principal = requireApiPrincipal(context.principal);
    const sourceRecipeId = requiredString(args, "sourceRecipeId");
    const titleOverride = optionalString(args.title) ?? null;

    try {
      const result = await forkRecipe(context.db, {
        sourceRecipeId,
        viewerId: principal.id,
        titleOverride,
      });
      return json({
        recipeId: result.recipe.id,
        recipe: formatRecipe(result.recipe),
        attribution: result.attribution,
        appliedTitle: result.appliedTitle,
        titleWasSuffixed: result.titleWasSuffixed,
      });
    } catch (err) {
      if (err instanceof ForkSourceNotFoundError) {
        throw new ApiAuthError("Source recipe not found", 404);
      }
      if (err instanceof ForkTitleExhaustedError) {
        throw new ApiAuthError(
          "Could not resolve a unique title for the fork",
          409,
        );
      }
      throw err;
    }
  },
};

const tools: SpoonjoyApiOperation[] = [
  healthTool,
  createApiTokenTool,
  listApiTokensTool,
  revokeApiTokenTool,
  searchSpoonjoyTool,
  searchRecipesTool,
  searchShoppingListTool,
  getRecipeTool,
  createRecipeTool,
  importRecipeFromUrlTool,
  forkRecipeTool,
  addRecipeToShoppingListTool,
  listCookbooksTool,
  getCookbookTool,
  createCookbookTool,
  addRecipeToCookbookTool,
  removeRecipeFromCookbookTool,
  addShoppingListItemTool,
  setShoppingListItemCheckedTool,
  removeShoppingListItemTool,
  getShoppingListTool,
  createSpoonTool,
  updateSpoonTool,
  deleteSpoonTool,
  listSpoonsForRecipeTool,
  listSpoonsByChefTool,
];

export function listSpoonjoyApiOperations(): SpoonjoyApiOperationInfo[] {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function callSpoonjoyApiOperation(
  name: string,
  args: Record<string, unknown>,
  context: SpoonjoyApiContext
): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown Spoonjoy operation: ${name}`);
  return tool.handle(args, context);
}
