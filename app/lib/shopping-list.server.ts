import type { PrismaClient } from "@prisma/client";
import type { AppLoadContext } from "react-router";
import { data } from "react-router";
import { getIngredientParserEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { IngredientParseError, parseIngredients } from "~/lib/ingredient-parse.server";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import {
  parseShoppingItemFallback,
  type ParsedItemDraft,
} from "~/lib/shopping-list-parser";

type ShoppingListItemState = {
  id: string;
  checkedAt: Date | null;
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

async function normalizeShoppingListOrdering(
  database: PrismaClient,
  shoppingListId: string
) {
  const activeItems: ShoppingListItemState[] = await database.shoppingListItem.findMany({
    where: { shoppingListId, deletedAt: null },
    select: { id: true, checkedAt: true, sortIndex: true },
    orderBy: [{ checkedAt: "asc" }, { sortIndex: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
  });

  const unchecked = activeItems.filter((item) => !item.checkedAt);
  const checked = activeItems.filter((item) => item.checkedAt);
  const ordered = [...unchecked, ...checked];

  await Promise.all(
    ordered.map((item, index) =>
      database.shoppingListItem.update({
        where: { id: item.id },
        data: { sortIndex: index, checked: Boolean(item.checkedAt) },
      })
    )
  );
}

export async function loadShoppingList({ request, context }: ShoppingListRouteArgs) {
  const userId = await requireUserId(request);

  const database = await getRequestDb(context);

  // Get or create shopping list
  let shoppingList = await database.shoppingList.findUnique({
    where: { authorId: userId },
    include: {
      items: {
        where: { deletedAt: null },
        include: {
          unit: true,
          ingredientRef: true,
        },
        orderBy: [
          { checkedAt: "asc" },
          { sortIndex: "asc" },
          {
            ingredientRef: {
              name: "asc",
            },
          },
        ],
      },
    },
  });

  if (!shoppingList) {
    shoppingList = await database.shoppingList.create({
      data: {
        authorId: userId,
      },
      include: {
        items: {
          include: {
            unit: true,
            ingredientRef: true,
          },
        },
      },
    });
  }

  // Get user's recipes for adding ingredients
  const recipes = await database.recipe.findMany({
    where: {
      chefId: userId,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
    },
    orderBy: {
      title: "asc",
    },
  });

  return { shoppingList, recipes };
}

export async function handleShoppingListAction({ request, context }: ShoppingListRouteArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  const database = await getRequestDb(context);

  // Get or create shopping list
  let shoppingList = await database.shoppingList.findUnique({
    where: { authorId: userId },
  });

  if (!shoppingList) {
    shoppingList = await database.shoppingList.create({
      data: { authorId: userId },
    });
  }

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
          const parsedIngredients = await parseIngredients(ingredientText, parserEnv);
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

    if (ingredientName && !parsedDraft.isAmbiguous) {
      // Get or create ingredient ref
      let ingredientRef = await database.ingredientRef.findUnique({
        where: { name: ingredientName.toLowerCase() },
      });

      if (!ingredientRef) {
        ingredientRef = await database.ingredientRef.create({
          data: { name: ingredientName.toLowerCase() },
        });
      }

      const affordance = resolveIngredientAffordance(
        ingredientName,
        submittedCategoryKey,
        submittedIconKey
      );

      let unitId: string | null = null;

      /* istanbul ignore else -- @preserve unit name is usually provided */
      if (unitName) {
        // Get or create unit
        let unit = await database.unit.findUnique({
          where: { name: unitName.toLowerCase() },
        });

        if (!unit) {
          unit = await database.unit.create({
            data: { name: unitName.toLowerCase() },
          });
        }

        unitId = unit.id;
      }

      // Check if item already exists
      const existingItem = await database.shoppingListItem.findFirst({
        where: {
          shoppingListId: shoppingList.id,
          unitId,
          ingredientRefId: ingredientRef.id,
        },
      });

      if (existingItem) {
        /* istanbul ignore next -- @preserve ternary branches for quantity addition */
        const newQuantity = quantity
          ? (existingItem.quantity || 0) + parseFloat(quantity)
          : existingItem.quantity;
        const shouldMoveToEnd = Boolean(existingItem.deletedAt || existingItem.checkedAt || existingItem.checked);

        await database.shoppingListItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: newQuantity,
            checked: false,
            checkedAt: null,
            categoryKey: affordance.categoryKey,
            iconKey: affordance.iconKey,
            deletedAt: null,
            sortIndex: shouldMoveToEnd ? await nextSortIndex(database, shoppingList.id) : existingItem.sortIndex,
          },
        });
      } else {
        const sortIndex = await nextSortIndex(database, shoppingList.id);

        await database.shoppingListItem.create({
          data: {
            shoppingListId: shoppingList.id,
            quantity: quantity ? parseFloat(quantity) : null,
            unitId,
            ingredientRefId: ingredientRef.id,
            categoryKey: affordance.categoryKey,
            iconKey: affordance.iconKey,
            sortIndex,
          },
        });
      }
    }

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

    return data({ success: true });
  }

  if (intent === "addFromRecipe") {
    const recipeId = formData.get("recipeId")?.toString();
    const scaleFactorRaw = formData.get("scaleFactor")?.toString();
    const parsedScaleFactor = scaleFactorRaw ? Number.parseFloat(scaleFactorRaw) : 1;
    const scaleFactor = Number.isFinite(parsedScaleFactor) && parsedScaleFactor > 0 ? parsedScaleFactor : 1;

    if (recipeId) {
      const recipe = await database.recipe.findUnique({
        where: { id: recipeId },
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

      /* istanbul ignore else -- @preserve recipe should exist if selected */
      if (recipe) {
        for (const step of recipe.steps) {
          for (const ingredient of step.ingredients) {
            // Check if item already exists
            const existingItem = await database.shoppingListItem.findUnique({
              where: {
                shoppingListId_unitId_ingredientRefId: {
                  shoppingListId: shoppingList.id,
                  unitId: ingredient.unitId,
                  ingredientRefId: ingredient.ingredientRefId,
                },
              },
            });

            const affordance = resolveIngredientAffordance(
              ingredient.ingredientRef.name,
              null,
              null
            );

            if (existingItem) {
              /* istanbul ignore next -- @preserve ternary branches for quantity addition */
              const scaledQuantity = ingredient.quantity ? ingredient.quantity * scaleFactor : null;
              const newQuantity = scaledQuantity
                ? (existingItem.quantity || 0) + scaledQuantity
                : existingItem.quantity;
              const shouldMoveToEnd = Boolean(existingItem.deletedAt || existingItem.checkedAt || existingItem.checked);

              await database.shoppingListItem.update({
                where: { id: existingItem.id },
                data: {
                  quantity: newQuantity,
                  checked: false,
                  checkedAt: null,
                  deletedAt: null,
                  sortIndex: shouldMoveToEnd ? await nextSortIndex(database, shoppingList.id) : existingItem.sortIndex,
                  categoryKey: existingItem.categoryKey ?? affordance.categoryKey,
                  iconKey: affordance.iconKey,
                },
              });
            } else {
              const sortIndex = await nextSortIndex(database, shoppingList.id);

              await database.shoppingListItem.create({
                data: {
                  shoppingListId: shoppingList.id,
                  quantity: ingredient.quantity ? ingredient.quantity * scaleFactor : null,
                  unitId: ingredient.unitId,
                  ingredientRefId: ingredient.ingredientRefId,
                  sortIndex,
                  categoryKey: affordance.categoryKey,
                  iconKey: affordance.iconKey,
                },
              });
            }
          }
        }
      }
    }
    return data({ success: true });
  }

  if (intent === "toggleCheck") {
    const itemId = formData.get("itemId")?.toString();
    const nextCheckedRaw = formData.get("nextChecked")?.toString();

    if (itemId) {
      const item = await database.shoppingListItem.findFirst({
        where: {
          id: itemId,
          shoppingListId: shoppingList.id,
        },
      });

      /* istanbul ignore else -- @preserve item should exist if toggling */
      if (item) {
        const willBeChecked = nextCheckedRaw ? nextCheckedRaw === "true" : !item.checked;

        await database.shoppingListItem.update({
          where: { id: itemId },
          data: {
            checked: willBeChecked,
            checkedAt: willBeChecked ? new Date() : null,
          },
        });

        await normalizeShoppingListOrdering(database, shoppingList.id);
      }
    }
    return data({ success: true });
  }

  if (intent === "removeItem") {
    const itemId = formData.get("itemId")?.toString();

    if (itemId) {
      await database.shoppingListItem.updateMany({
        where: {
          id: itemId,
          shoppingListId: shoppingList.id,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      await normalizeShoppingListOrdering(database, shoppingList.id);
    }
    return data({ success: true });
  }

  if (intent === "clearCompleted") {
    await database.shoppingListItem.updateMany({
      where: {
        shoppingListId: shoppingList.id,
        deletedAt: null,
        OR: [
          { checkedAt: { not: null } },
          { checked: true },
        ],
      },
      data: { deletedAt: new Date() },
    });
    await normalizeShoppingListOrdering(database, shoppingList.id);
    return data({ success: true });
  }

  if (intent === "clearAll") {
    await database.shoppingListItem.updateMany({
      where: { shoppingListId: shoppingList.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return data({ success: true });
  }

  return null;
}
