import type { Prisma, PrismaClient as PrismaClientType } from "@prisma/client";
import { validateActiveRecipeTitleUnique } from "~/lib/recipe-title-uniqueness.server";

export interface SpoonjoyMcpContext {
  db: PrismaClientType;
  defaultOwnerEmail?: string;
}

export interface SpoonjoyMcpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface SpoonjoyMcpTool extends SpoonjoyMcpToolInfo {
  handle(args: Record<string, unknown>, context: SpoonjoyMcpContext): Promise<string>;
}

type Database = PrismaClientType | Prisma.TransactionClient;

type RecipeWithDetails = Prisma.RecipeGetPayload<{
  include: {
    chef: { select: { id: true; email: true; username: true } };
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

type CookbookWithRecipes = Prisma.CookbookGetPayload<{
  include: {
    author: { select: { id: true; email: true; username: true } };
    recipes: {
      include: {
        recipe: {
          include: {
            chef: { select: { id: true; email: true; username: true } };
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
const DEFAULT_RECIPE_IMAGE_URL =
  "https://res.cloudinary.com/dpjmyc4uz/image/upload/v1674541350/clbe7wr180009tkhggghtl1qd.png";

const cookbookRecipeInclude = {
  author: { select: { id: true, email: true, username: true } },
  recipes: {
    orderBy: { createdAt: "desc" },
    include: {
      recipe: {
        include: {
          chef: { select: { id: true, email: true, username: true } },
          steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
        },
      },
    },
  },
} satisfies Prisma.CookbookInclude;

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
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

function ownerEmail(args: Record<string, unknown>, context: SpoonjoyMcpContext): string | undefined {
  return optionalString(args.ownerEmail) ?? context.defaultOwnerEmail;
}

function requireOwnerEmail(args: Record<string, unknown>, context: SpoonjoyMcpContext): string {
  const email = ownerEmail(args, context);
  if (!email) throw new Error("ownerEmail is required, or set SPOONJOY_MCP_USER_EMAIL");
  return email.toLowerCase();
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
    imageUrl: recipe.imageUrl,
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
      imageUrl: item.recipe.imageUrl,
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

const healthTool: SpoonjoyMcpTool = {
  name: "health",
  description: "Check Spoonjoy MCP readiness and whether write tools have a default owner email.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handle(_args, context) {
    return json({
      ok: true,
      app: "spoonjoy-v2",
      defaultOwnerEmail: context.defaultOwnerEmail ?? null,
      writable: Boolean(context.defaultOwnerEmail),
    });
  },
};

const searchRecipesTool: SpoonjoyMcpTool = {
  name: "search_recipes",
  description: "Search Spoonjoy recipes by title, description, source URL, and optional chef email.",
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

    const recipes = await context.db.recipe.findMany({
      where: {
        deletedAt: null,
        ...(chefEmail ? { chef: { email: chefEmail } } : {}),
        ...(query
          ? {
              OR: [
                { title: { contains: query } },
                { description: { contains: query } },
                { sourceUrl: { contains: query } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        chef: { select: { id: true, email: true, username: true } },
        steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
      },
    });

    return json({ recipes: recipes.map(formatRecipeSummary) });
  },
};

const getRecipeTool: SpoonjoyMcpTool = {
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

const createRecipeTool: SpoonjoyMcpTool = {
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
          imageUrl: DEFAULT_RECIPE_IMAGE_URL,
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
          steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
        },
      });

      return fullRecipe;
    });

    return json({ recipe: formatRecipe(recipe) });
  },
};

const addRecipeToShoppingListTool: SpoonjoyMcpTool = {
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

const listCookbooksTool: SpoonjoyMcpTool = {
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

const getCookbookTool: SpoonjoyMcpTool = {
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

const createCookbookTool: SpoonjoyMcpTool = {
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

const addRecipeToCookbookTool: SpoonjoyMcpTool = {
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

const removeRecipeFromCookbookTool: SpoonjoyMcpTool = {
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

const addShoppingListItemTool: SpoonjoyMcpTool = {
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

const setShoppingListItemCheckedTool: SpoonjoyMcpTool = {
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

const removeShoppingListItemTool: SpoonjoyMcpTool = {
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

const getShoppingListTool: SpoonjoyMcpTool = {
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

const tools: SpoonjoyMcpTool[] = [
  healthTool,
  searchRecipesTool,
  getRecipeTool,
  createRecipeTool,
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
];

export function listSpoonjoyMcpTools(): SpoonjoyMcpToolInfo[] {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function callSpoonjoyMcpTool(
  name: string,
  args: Record<string, unknown>,
  context: SpoonjoyMcpContext
): Promise<string> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown Spoonjoy MCP tool: ${name}`);
  return tool.handle(args, context);
}
