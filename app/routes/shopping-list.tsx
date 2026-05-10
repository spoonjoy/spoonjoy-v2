import type { Route } from "./+types/shopping-list";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLoaderData, Form, useSubmit, useFetcher, useActionData } from "react-router";
import {
  handleShoppingListAction,
  loadShoppingList,
} from "~/lib/shopping-list.server";
import {
  __internal__,
  parseShoppingItemFallback,
  type ShoppingListActionData,
} from "~/lib/shopping-list-parser";
import { Heading, Subheading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field, Label } from "~/components/ui/fieldset";
import { Select } from "~/components/ui/select";
import { Link } from "~/components/ui/link";
import { ConfirmationDialog } from "~/components/confirmation-dialog";
import { INGREDIENT_ICON_COMPONENTS, resolveIngredientAffordance } from "~/lib/ingredient-affordances";

export { __internal__, parseShoppingItemFallback };

export async function loader({ request, context }: Route.LoaderArgs) {
  return loadShoppingList({ request, context });
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleShoppingListAction({ request, context });
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
