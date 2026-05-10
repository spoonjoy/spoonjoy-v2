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

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const DEFAULT_RECIPE_IMAGE_URL =
  "https://res.cloudinary.com/dpjmyc4uz/image/upload/v1674541350/clbe7wr180009tkhggghtl1qd.png";

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
    const reloaded = await context.db.shoppingList.findUniqueOrThrow({
      where: { id: shoppingList.id },
      include: { items: { include: { unit: true, ingredientRef: true } } },
    });

    return json({ shoppingList: formatShoppingList(reloaded) });
  },
};

const tools: SpoonjoyMcpTool[] = [
  healthTool,
  searchRecipesTool,
  getRecipeTool,
  createRecipeTool,
  addRecipeToShoppingListTool,
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
