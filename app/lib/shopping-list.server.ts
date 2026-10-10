import type { Prisma, PrismaClient, ShoppingListItem } from "@prisma/client";
import type { AppLoadContext } from "react-router";
import { data } from "react-router";
import { getCloudflareEnv, getIngredientParserEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { requestD1, type D1ReadDatabase } from "~/lib/d1-read.server";
import { readShoppingListFromD1, readShoppingListWithPrisma } from "~/lib/shopping-list-reads.server";
import { IngredientParseError, parseIngredients } from "~/lib/ingredient-parse.server";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import {
  parseShoppingItemFallback,
  type ParsedItemDraft,
} from "~/lib/shopping-list-parser";
import {
  addShoppingListItem,
  coalesceShoppingRecipeIngredients,
  findCompatibleShoppingListItem,
  mergedShoppingItemQuantity,
  runCompatibleShoppingListBatch,
} from "~/lib/shopping-list-mutations.server";
import {
  addRecipeToShoppingListOnD1,
  addShoppingListItemOnD1,
  clearCompletedShoppingListItemsOnD1,
  clearShoppingListOnD1,
  ensureShoppingListIdOnD1,
  removeShoppingListItemOnD1,
  toggleShoppingListItemOnD1,
} from "~/lib/shopping-list-d1-actions.server";

type ShoppingListItemPosition = {
  id: string;
  sortIndex: number;
};

interface ShoppingListRouteArgs {
  request: Request;
  context: AppLoadContext;
}

async function nextSortIndex(database: PrismaClient, shoppingListId: string) {
  const maxItem = await database.shoppingListItem.findFirst({
    where: { shoppingListId, deletedAt: null },
    orderBy: { sortIndex: "desc" },
    select: { sortIndex: true },
  });

  return (maxItem?.sortIndex ?? -1) + 1;
}

// Renumbers the active rows 0..n-1 in their current order after rows leave the list. It writes
// only `sortIndex`, and only on rows whose position changes: it reads the whole list, and any other
// field it wrote back from that read could overwrite a concurrent toggle of another row (shopping
// list journey, run 37920386776).
async function normalizeShoppingListOrdering(
  database: PrismaClient,
  shoppingListId: string
) {
  const activeItems: ShoppingListItemPosition[] = await database.shoppingListItem.findMany({
    where: { shoppingListId, deletedAt: null },
    select: { id: true, sortIndex: true },
    orderBy: [{ sortIndex: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
  });

  await Promise.all(
    activeItems.flatMap((item, index) =>
      item.sortIndex === index
        ? []
        : [database.shoppingListItem.update({
          where: { id: item.id },
          data: { sortIndex: index },
        })]
    )
  );
}

export async function loadShoppingList({ request, context }: ShoppingListRouteArgs) {
  const userId = await requireUserId(request, "/login", getCloudflareEnv(context));

  // With a D1 binding the page reads in one batch and never builds a Prisma client.
  const d1 = requestD1(context);
  return d1
    ? readShoppingListFromD1(d1, userId)
    : readShoppingListWithPrisma(await getRequestDb(context), userId);
}

export async function handleShoppingListAction({ request, context }: ShoppingListRouteArgs) {
  const userId = await requireUserId(request, "/login", getCloudflareEnv(context));
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  // With a D1 binding every write is one D1 batch and no Prisma client is built.
  const d1 = requestD1(context);
  const writes = d1 ? await d1ShoppingListWrites(d1, userId) : await prismaShoppingListWrites(await getRequestDb(context), userId);

  if (intent === "addItem") {
    const ingredientText = formData.get("ingredientText")?.toString() || "";
    const manualQuantity = formData.get("quantity")?.toString() || "";
    const manualUnitName = formData.get("unitName")?.toString() || "";
    const manualIngredientName = formData.get("ingredientName")?.toString() || "";
    const submittedCategoryKey = formData.get("categoryKey")?.toString() || null;
    const submittedIconKey = formData.get("iconKey")?.toString() || null;

    let parsedDraft: ParsedItemDraft = {
      quantity: manualQuantity,
      unitName: manualUnitName,
      ingredientName: manualIngredientName,
      isAmbiguous: false,
      originalText: ingredientText,
    };

    if (!parsedDraft.ingredientName.trim() && ingredientText.trim()) {
      const parserEnv = getIngredientParserEnv(context);

      if (parserEnv.OPENAI_API_KEY) {
        try {
          const parsedIngredients = await parseIngredients(ingredientText, parserEnv, {
            distinctId: userId,
          });
          const firstParsed = parsedIngredients[0];

          if (parsedIngredients.length === 1 && firstParsed) {
            parsedDraft = {
              quantity: String(firstParsed.quantity),
              unitName: firstParsed.unit,
              ingredientName: firstParsed.ingredientName,
              isAmbiguous: false,
              originalText: ingredientText,
            };
          } else {
            const fallbackDraft = parseShoppingItemFallback(ingredientText);
            return data(
              {
                errors: {
                  parse: "Couldn't confidently parse one item. Review and correct before adding.",
                },
                parseDraft: fallbackDraft,
              },
              { status: 400 }
            );
          }
        } catch (error) {
          const fallbackDraft = parseShoppingItemFallback(ingredientText);
          const parseMessage =
            error instanceof IngredientParseError
              ? error.message
              : "Unable to parse item right now. Review and correct before adding.";

          return data(
            {
              errors: {
                parse: parseMessage,
              },
              parseDraft: fallbackDraft,
            },
            { status: 400 }
          );
        }
      } else {
        parsedDraft = parseShoppingItemFallback(ingredientText);
      }
    }

    const ingredientName = parsedDraft.ingredientName.trim();
    const unitName = parsedDraft.unitName.trim();
    const quantity = parsedDraft.quantity.trim();

    if (!ingredientName || parsedDraft.isAmbiguous) {
      return data(
        {
          errors: {
            parse: "Couldn't confidently parse one item. Review and correct before adding.",
          },
          parseDraft: parsedDraft,
        },
        { status: 400 }
      );
    }

    const affordance = resolveIngredientAffordance(
      ingredientName,
      submittedCategoryKey,
      submittedIconKey
    );
    const added = await writes.addItem({
      ingredientName: ingredientName.toLowerCase(),
      /* istanbul ignore next -- @preserve unit name is usually provided */
      unitName: unitName ? unitName.toLowerCase() : null,
      /* istanbul ignore next -- @preserve a quantity is usually given */
      quantity: quantity ? parseFloat(quantity) : null,
      categoryKey: affordance.categoryKey,
      iconKey: affordance.iconKey,
    });
    if (!added) throw new Response("Shopping list not found", { status: 404 });

    return data({ success: true, intent: "addItem" as const });
  }

  if (intent === "addFromRecipe") {
    const recipeId = formData.get("recipeId")?.toString();
    const scaleFactorRaw = formData.get("scaleFactor")?.toString();
    const parsedScaleFactor = scaleFactorRaw ? Number.parseFloat(scaleFactorRaw) : 1;
    const scaleFactor = Number.isFinite(parsedScaleFactor) && parsedScaleFactor > 0 ? parsedScaleFactor : 1;

    if (recipeId && !(await writes.addRecipe(recipeId, scaleFactor))) {
      throw new Response("Recipe not found", { status: 404 });
    }
    return data({ success: true });
  }

  if (intent === "toggleCheck") {
    const itemId = formData.get("itemId")?.toString();
    const nextCheckedRaw = formData.get("nextChecked")?.toString();

    if (itemId) await writes.toggle(itemId, nextCheckedRaw ? nextCheckedRaw === "true" : null);
    return data({ success: true });
  }

  if (intent === "removeItem") {
    const itemId = formData.get("itemId")?.toString();

    if (itemId) await writes.remove(itemId);
    return data({ success: true });
  }

  if (intent === "clearCompleted") {
    await writes.clearCompleted();
    return data({ success: true });
  }

  if (intent === "clearAll") {
    await writes.clearAll();
    return data({ success: true });
  }

  return null;
}

interface ShoppingListItemInput {
  /** Lowercased, as the ingredient and unit tables store names. */
  ingredientName: string;
  unitName: string | null;
  quantity: number | null;
  categoryKey: string | null;
  iconKey: string | null;
}

/** The shopping list page's writes for one chef's list, on D1 or on Prisma. */
interface ShoppingListWrites {
  /** False when the list no longer exists. */
  addItem(item: ShoppingListItemInput): Promise<boolean>;
  /** False when the recipe does not exist or was deleted. */
  addRecipe(recipeId: string, scaleFactor: number): Promise<boolean>;
  /** With `nextChecked` null, flips the item. */
  toggle(itemId: string, nextChecked: boolean | null): Promise<void>;
  remove(itemId: string): Promise<void>;
  clearCompleted(): Promise<void>;
  clearAll(): Promise<void>;
}

async function d1ShoppingListWrites(d1: D1ReadDatabase, userId: string): Promise<ShoppingListWrites> {
  const shoppingListId = await ensureShoppingListIdOnD1(d1, userId, new Date());
  return {
    addItem: (item) => addShoppingListItemOnD1(d1, { ...item, shoppingListId, now: new Date() }),
    addRecipe: (recipeId, scaleFactor) =>
      addRecipeToShoppingListOnD1(d1, { shoppingListId, recipeId, scaleFactor, now: new Date() }),
    toggle: (itemId, nextChecked) =>
      toggleShoppingListItemOnD1(d1, { shoppingListId, itemId, nextChecked, now: new Date() }),
    remove: (itemId) => removeShoppingListItemOnD1(d1, { shoppingListId, itemId, now: new Date() }),
    clearCompleted: () => clearCompletedShoppingListItemsOnD1(d1, { shoppingListId, now: new Date() }),
    clearAll: () => clearShoppingListOnD1(d1, { shoppingListId, now: new Date() }),
  };
}

async function prismaShoppingListWrites(database: PrismaClient, userId: string): Promise<ShoppingListWrites> {
  // Get or create shopping list
  let shoppingList = await database.shoppingList.findUnique({
    where: { authorId: userId },
  });

  if (!shoppingList) {
    shoppingList = await database.shoppingList.create({
      data: { authorId: userId },
    });
  }
  const shoppingListId = shoppingList.id;

  return {
    async addItem(item) {
      // Get or create ingredient ref
      let ingredientRef = await database.ingredientRef.findUnique({
        where: { name: item.ingredientName },
      });

      if (!ingredientRef) {
        ingredientRef = await database.ingredientRef.create({
          data: { name: item.ingredientName },
        });
      }

      let unitId: string | null = null;

      /* istanbul ignore else -- @preserve unit name is usually provided */
      if (item.unitName) {
        // Get or create unit
        let unit = await database.unit.findUnique({
          where: { name: item.unitName },
        });

        if (!unit) {
          unit = await database.unit.create({
            data: { name: item.unitName },
          });
        }

        unitId = unit.id;
      }

      const added = await addShoppingListItem(database, {
        identity: {
          shoppingListId,
          unitId,
          ingredientRefId: ingredientRef.id,
        },
        quantity: item.quantity,
        categoryKey: item.categoryKey,
        iconKey: item.iconKey,
        nextSortIndex: () => nextSortIndex(database, shoppingListId),
      });
      return added !== null;
    },

    async addRecipe(recipeId, scaleFactor) {
      const recipe = await database.recipe.findFirst({
        where: { id: recipeId, deletedAt: null },
        include: {
          steps: {
            include: {
              ingredients: {
                include: {
                  unit: true,
                  ingredientRef: true,
                },
              },
            },
          },
        },
      });

      if (!recipe) return false;

      const candidates = recipe.steps.flatMap((step) =>
        step.ingredients.map((ingredient) => {
          const affordance = resolveIngredientAffordance(
            ingredient.ingredientRef.name,
            null,
            null
          );

          return {
            stepNum: step.stepNum,
            ingredientId: ingredient.id,
            ingredientRefId: ingredient.ingredientRefId,
            unitId: ingredient.unitId,
            quantity: ingredient.quantity,
            categoryKey: affordance.categoryKey,
            iconKey: affordance.iconKey,
          };
        })
      );
      const ingredients = coalesceShoppingRecipeIngredients(candidates, scaleFactor);

      // Without a binding the batch is one Prisma `$transaction`; a lost race rebuilds it.
      await runCompatibleShoppingListBatch(database, async () => {
        const existingItems = await Promise.all(
          ingredients.map((ingredient) =>
            findCompatibleShoppingListItem(database, {
              shoppingListId,
              ingredientRefId: ingredient.ingredientRefId,
              unitId: ingredient.unitId,
            })
          )
        );
        let availableSortIndex = await nextSortIndex(database, shoppingListId);
        const operations: Array<Prisma.PrismaPromise<ShoppingListItem>> = [];

        for (const [index, ingredient] of ingredients.entries()) {
          const existingItem = existingItems[index];

          if (existingItem) {
            const shouldMoveToEnd = Boolean(
              existingItem.deletedAt || existingItem.checkedAt || existingItem.checked
            );
            operations.push(database.shoppingListItem.update({
              where: { id: existingItem.id },
              data: {
                quantity: mergedShoppingItemQuantity(existingItem, ingredient.quantity || null),
                checked: false,
                checkedAt: null,
                deletedAt: null,
                sortIndex: shouldMoveToEnd ? availableSortIndex++ : existingItem.sortIndex,
                categoryKey: existingItem.categoryKey ?? ingredient.categoryKey,
                iconKey: ingredient.iconKey,
              },
            }));
            continue;
          }

          operations.push(database.shoppingListItem.create({
            data: {
              id: crypto.randomUUID(),
              shoppingListId,
              quantity: ingredient.quantity || null,
              unitId: ingredient.unitId,
              ingredientRefId: ingredient.ingredientRefId,
              sortIndex: availableSortIndex++,
              categoryKey: ingredient.categoryKey,
              iconKey: ingredient.iconKey,
            },
          }));
        }

        return { operations, metadata: null };
      });
      return true;
    },

    async toggle(itemId, nextChecked) {
      const item = await database.shoppingListItem.findFirst({
        where: {
          id: itemId,
          shoppingListId,
        },
      });

      /* istanbul ignore else -- @preserve item should exist if toggling */
      if (item) {
        const willBeChecked = nextChecked ?? !item.checked;

        // One write to this row only. Checking keeps the row where it is, so the list needs no
        // renumbering, and renumbering here would race the user's next tap on another row.
        await database.shoppingListItem.update({
          where: { id: itemId },
          data: {
            checked: willBeChecked,
            checkedAt: willBeChecked ? new Date() : null,
          },
        });
      }
    },

    async remove(itemId) {
      await database.shoppingListItem.updateMany({
        where: {
          id: itemId,
          shoppingListId,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      await normalizeShoppingListOrdering(database, shoppingListId);
    },

    async clearCompleted() {
      await database.shoppingListItem.updateMany({
        where: {
          shoppingListId,
          deletedAt: null,
          OR: [
            { checkedAt: { not: null } },
            { checked: true },
          ],
        },
        data: { deletedAt: new Date() },
      });
      await normalizeShoppingListOrdering(database, shoppingListId);
    },

    async clearAll() {
      await database.shoppingListItem.updateMany({
        where: { shoppingListId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    },
  };
}
