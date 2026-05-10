import type { Route } from "./+types/shopping-list";
import type { PrismaClient } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLoaderData, Form, data, useSubmit, useFetcher, useActionData } from "react-router";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { Heading, Subheading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field, Label } from "~/components/ui/fieldset";
import { Select } from "~/components/ui/select";
import { Link } from "~/components/ui/link";
import { ConfirmationDialog } from "~/components/confirmation-dialog";
import { INGREDIENT_ICON_COMPONENTS, resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import { IngredientParseError, parseIngredients } from "~/lib/ingredient-parse.server";

type ShoppingListItemState = {
  id: string;
  checkedAt: Date | null;
  sortIndex: number;
};

type ParsedItemDraft = {
  quantity: string;
  unitName: string;
  ingredientName: string;
  isAmbiguous: boolean;
  originalText: string;
};

type ShoppingListActionData = {
  success?: boolean;
  errors?: {
    parse?: string;
  };
  parseDraft?: ParsedItemDraft;
};

function parseFractionToken(token: string): number | null {
  const trimmed = token.trim();
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number.parseFloat(mixed[1]);
    const numerator = Number.parseFloat(mixed[2]);
    const denominator = Number.parseFloat(mixed[3]);
    return denominator > 0 ? whole + numerator / denominator : null;
  }

  const fraction = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const numerator = Number.parseFloat(fraction[1]);
    const denominator = Number.parseFloat(fraction[2]);
    return denominator > 0 ? numerator / denominator : null;
  }

  const numeric = Number.parseFloat(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

export const __internal__ = { parseFractionToken };

export function parseShoppingItemFallback(text: string): ParsedItemDraft {
  const normalized = text.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return {
      quantity: "",
      unitName: "",
      ingredientName: "",
      isAmbiguous: true,
      originalText: text,
    };
  }

  const dozenMatch = normalized.match(/^(a|an)\s+dozen\s+(.+)$/i);
  if (dozenMatch) {
    return {
      quantity: "12",
      unitName: "whole",
      ingredientName: dozenMatch[2].trim(),
      isAmbiguous: false,
      originalText: text,
    };
  }

  const amountMatch = normalized.match(/^((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?)\s+(.+)$/);
  if (!amountMatch) {
    return {
      quantity: "",
      unitName: "",
      ingredientName: normalized,
      isAmbiguous: true,
      originalText: text,
    };
  }

  const parsedQuantity = parseFractionToken(amountMatch[1]);
  const remainder = amountMatch[2].trim();
  const [first, ...rest] = remainder.split(" ");

  if (!parsedQuantity || !remainder) {
    return {
      quantity: "",
      unitName: "",
      ingredientName: normalized,
      isAmbiguous: true,
      originalText: text,
    };
  }

  if (rest.length === 0) {
    return {
      quantity: String(parsedQuantity),
      unitName: "whole",
      ingredientName: first,
      isAmbiguous: false,
      originalText: text,
    };
  }

  return {
    quantity: String(parsedQuantity),
    unitName: first,
    ingredientName: rest.join(" "),
    isAmbiguous: false,
    originalText: text,
  };
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

export async function loader({ request, context }: Route.LoaderArgs) {
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

export async function action({ request, context }: Route.ActionArgs) {
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
      const apiKey =
        getCloudflareEnv(context)?.OPENAI_API_KEY ||
        process.env.OPENAI_API_KEY ||
        "";

      if (apiKey) {
        try {
          const parsedIngredients = await parseIngredients(ingredientText, apiKey);
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

        await database.shoppingListItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: newQuantity,
            categoryKey: affordance.categoryKey,
            iconKey: affordance.iconKey,
            deletedAt: null,
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

              await database.shoppingListItem.update({
                where: { id: existingItem.id },
                data: {
                  quantity: newQuantity,
                  checked: false,
                  checkedAt: null,
                  deletedAt: null,
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
      const item = await database.shoppingListItem.findUnique({
        where: { id: itemId },
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
      await database.shoppingListItem.update({
        where: { id: itemId },
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
        checkedAt: { not: null },
        deletedAt: null,
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

const SWIPE_REVEAL_OFFSET = 104;
const SWIPE_REVEAL_THRESHOLD = 56;
const SWIPE_CONFIRM_THRESHOLD = 56;
const SWIPE_DISMISS_THRESHOLD = 28;

export type SwipeAction = "reveal" | "confirmDelete" | "dismiss" | "none";

export function resolveSwipeAction(offsetX: number, isRevealed: boolean): SwipeAction {
  if (isRevealed && offsetX <= -SWIPE_CONFIRM_THRESHOLD) {
    return "confirmDelete";
  }

  if (!isRevealed && offsetX <= -SWIPE_REVEAL_THRESHOLD) {
    return "reveal";
  }

  if (isRevealed && offsetX >= SWIPE_DISMISS_THRESHOLD) {
    return "dismiss";
  }

  return "none";
}

export function shouldDeleteOnSwipe(offsetX: number, isRevealed = false) {
  return resolveSwipeAction(offsetX, isRevealed) === "confirmDelete";
}

export default function ShoppingList() {
  const actionData = useActionData<ShoppingListActionData>();
  const { shoppingList, recipes } = useLoaderData<typeof loader>();
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [optimisticCheckedById, setOptimisticCheckedById] = useState<Record<string, boolean>>({});
  const [optimisticRemovedById, setOptimisticRemovedById] = useState<Record<string, boolean>>({});
  const [revealedItemId, setRevealedItemId] = useState<string | null>(null);
  const submit = useSubmit();
  const toggleFetcher = useFetcher();
  const removeFetcher = useFetcher();

  useEffect(() => {
    setOptimisticCheckedById({});
    setOptimisticRemovedById({});
    setRevealedItemId(null);
  }, [shoppingList.items]);

  const displayItems = useMemo(() => {
    const withOptimistic = shoppingList.items
      .filter((item) => !optimisticRemovedById[item.id])
      .map((item) => {
        const optimisticChecked = optimisticCheckedById[item.id];
        const checked = optimisticChecked ?? Boolean(item.checkedAt ?? item.checked);
        const affordance = resolveIngredientAffordance(
          item.ingredientRef.name,
          item.categoryKey,
          null
        );

        return {
          ...item,
          checked,
          categoryLabel: affordance.categoryLabel,
          iconKey: affordance.iconKey,
        };
      });

    const unchecked = withOptimistic.filter((item) => !item.checked);
    const checked = withOptimistic.filter((item) => item.checked);
    return [...unchecked, ...checked];
  }, [shoppingList.items, optimisticCheckedById, optimisticRemovedById]);

  const checkedCount = displayItems.filter((item) => item.checked).length;
  const uncheckedCount = displayItems.length - checkedCount;
  const displayOrderKey = displayItems.map((item) => item.id).join("|");

  useEffect(() => {
    setRevealedItemId(null);
  }, [displayOrderKey]);

  const handleClearAllConfirm = () => {
    setShowClearDialog(false);
    submit({ intent: "clearAll" }, { method: "post" });
  };

  const toggleItem = (item: (typeof displayItems)[number]) => {
    setRevealedItemId(null);
    const nextChecked = !item.checked;
    setOptimisticCheckedById((current) => ({ ...current, [item.id]: nextChecked }));

    toggleFetcher.submit(
      {
        intent: "toggleCheck",
        itemId: item.id,
        nextChecked: String(nextChecked),
      },
      { method: "post" }
    );
  };

  const removeItem = (itemId: string) => {
    setRevealedItemId(null);
    setOptimisticRemovedById((current) => ({ ...current, [itemId]: true }));

    removeFetcher.submit(
      {
        intent: "removeItem",
        itemId,
      },
      { method: "post" }
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <Heading level={1}>Shopping List</Heading>
          <Text className="mt-1">
            {displayItems.length} {displayItems.length === 1 ? "item" : "items"}
            {/* istanbul ignore next -- @preserve */ checkedCount > 0 && (
              <span> ({checkedCount} checked, {uncheckedCount} remaining)</span>
            )}
          </Text>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/">Home</Link>
          {/* istanbul ignore next -- @preserve */ checkedCount > 0 && (
            <Form method="post">
              <input type="hidden" name="intent" value="clearCompleted" />
              <Button type="submit" plain>
                Clear Completed
              </Button>
            </Form>
          )}
          {/* istanbul ignore next -- @preserve */ displayItems.length > 0 && (
            <>
              <Button
                variant="destructive"
                onClick={() => setShowClearDialog(true)}
              >
                Clear All
              </Button>
              <ConfirmationDialog
                open={showClearDialog}
                onClose={() => setShowClearDialog(false)}
                onConfirm={handleClearAllConfirm}
                title="Start fresh?"
                description="All items will be cleared from your shopping list. Your cart will be squeaky clean!"
                confirmLabel="Clear it all"
                cancelLabel="Keep my stuff"
                destructive
              />
            </>
          )}
        </div>
      </div>

      {/* Add Item Form */}
      <div className="border border-zinc-200 bg-zinc-50/70 p-6 dark:border-zinc-700 dark:bg-zinc-800/30 mb-6">
        <Subheading level={2}>Add Item</Subheading>
        <Form method="post" className="mt-4">
          <input type="hidden" name="intent" value="addItem" />
          <div className="space-y-4">
            <Field>
              <Label>Item</Label>
              <Input
                type="text"
                name="ingredientText"
                required
                placeholder="e.g., 2 lbs chicken breast or a dozen eggs"
                defaultValue={actionData?.parseDraft?.originalText || ""}
                className="before:rounded-none after:rounded-none [&_input]:rounded-none"
              />
            </Field>
            {actionData?.parseDraft && (
              <div className="border border-zinc-300 p-3 dark:border-zinc-700">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {actionData?.errors?.parse || "Review the parsed item before adding."}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mt-3">
                  <Field>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      name="quantity"
                      step="0.01"
                      placeholder="2"
                      defaultValue={actionData.parseDraft.quantity}
                      className="before:rounded-none after:rounded-none [&_input]:rounded-none"
                    />
                  </Field>
                  <Field>
                    <Label>Unit</Label>
                    <Input
                      type="text"
                      name="unitName"
                      placeholder="lb"
                      defaultValue={actionData.parseDraft.unitName}
                      className="before:rounded-none after:rounded-none [&_input]:rounded-none"
                    />
                  </Field>
                  <Field>
                    <Label>Ingredient</Label>
                    <Input
                      type="text"
                      name="ingredientName"
                      required
                      placeholder="chicken breast"
                      defaultValue={actionData.parseDraft.ingredientName}
                      className="before:rounded-none after:rounded-none [&_input]:rounded-none"
                    />
                  </Field>
                </div>
              </div>
            )}
            <Button type="submit">Add</Button>
          </div>
        </Form>
      </div>

      {/* Add from Recipe */}
      {/* istanbul ignore next -- @preserve */ recipes.length > 0 && (
        <div className="rounded-lg bg-blue-50 p-6 dark:bg-blue-900/20 mb-6">
          <Subheading level={2}>Add All Ingredients from Recipe</Subheading>
          <Form method="post" className="mt-4 flex flex-col sm:flex-row gap-4">
            <input type="hidden" name="intent" value="addFromRecipe" />
            <Select name="recipeId" required className="flex-1">
              <option value="">Select a recipe...</option>
              {recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.title}
                </option>
              ))}
            </Select>
            <Button type="submit">
              Add Ingredients
            </Button>
          </Form>
        </div>
      )}

      {/* Empty State */}
      {displayItems.length === 0 ? (
        <div className="rounded-lg bg-zinc-50 p-8 dark:bg-zinc-800/50 text-center">
          <Subheading level={2} className="text-zinc-500 dark:text-zinc-400">
            Your shopping list is empty
          </Subheading>
          <Text className="mt-2">
            Add items manually or add all ingredients from a recipe
          </Text>
        </div>
      ) : (
        /* Item List */
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {displayItems.map((item, index) => {
              const affordance = resolveIngredientAffordance(
                item.ingredientRef.name,
                item.categoryKey,
                null
              );
              const Icon = INGREDIENT_ICON_COMPONENTS[affordance.iconKey];
              const prev = index > 0 ? resolveIngredientAffordance(
                displayItems[index - 1].ingredientRef.name,
                displayItems[index - 1].categoryKey,
                null
              ) : null;
              const showCategoryHeader = !prev || prev.categoryLabel !== affordance.categoryLabel;

              return (
                <div key={item.id} className="space-y-1">
                  {showCategoryHeader && (
                    <div className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400" data-testid="shopping-list-category">
                      {affordance.categoryLabel}
                    </div>
                  )}
                  <div className="relative overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                    {revealedItemId === item.id && (
                      <div className="absolute inset-y-0 right-0 w-28 bg-red-600 text-white pointer-events-auto">
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="flex h-full w-full items-center justify-center text-xs font-semibold uppercase tracking-wide"
                          aria-label={`Delete ${item.ingredientRef.name}`}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                    <motion.div
                      layout
                      drag="x"
                      animate={{
                        opacity: 1,
                        y: 0,
                        x: revealedItemId === item.id ? -SWIPE_REVEAL_OFFSET : 0,
                      }}
                      dragConstraints={{ left: -168, right: 0 }}
                      dragElastic={0}
                      dragMomentum={false}
                      dragDirectionLock
                      onDragEnd={(_, info) => {
                        const action = resolveSwipeAction(info.offset.x, revealedItemId === item.id);

                        if (action === "confirmDelete") {
                          removeItem(item.id);
                          return;
                        }

                        if (action === "reveal") {
                          setRevealedItemId(item.id);
                          return;
                        }

                        if (action === "dismiss") {
                          setRevealedItemId(null);
                        }
                      }}
                      initial={{ opacity: 0, y: -8 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.5 }}
                      className={`
                        relative z-10 min-h-11 px-3 py-2
                        flex items-center bg-white dark:bg-zinc-800
                        ${item.checked ? "opacity-60" : ""}
                      `}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (revealedItemId === item.id) {
                            setRevealedItemId(null);
                            return;
                          }
                          toggleItem(item);
                        }}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                        aria-label={item.checked ? "Uncheck item" : "Check item"}
                      >
                        <span
                          className={`
                            h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center
                            transition-colors cursor-pointer text-xs font-bold
                            ${item.checked
                              ? "bg-blue-600 border-blue-600 text-white dark:bg-blue-500 dark:border-blue-500"
                              : "bg-white border-zinc-300 dark:bg-zinc-800 dark:border-zinc-600"}
                          `}
                        >
                          {item.checked && "✓"}
                        </span>
                        <Icon
                          className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400"
                          aria-hidden="true"
                        />
                        <span className={`truncate text-base ${item.checked ? "line-through text-zinc-400 dark:text-zinc-500" : "text-zinc-900 dark:text-zinc-100"}`}>
                          {item.quantity && <strong>{item.quantity}</strong>}
                          {item.quantity && item.unit && " "}
                          {item.unit?.name && <span>{item.unit.name}</span>}
                          {(item.quantity || item.unit) && " "}
                          {item.ingredientRef.name}
                        </span>
                      </button>
                    </motion.div>
                  </div>
                </div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
