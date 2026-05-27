import type { Route } from "./+types/shopping-list";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
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
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field, Label } from "~/components/ui/fieldset";
import { Select } from "~/components/ui/select";
import { Link } from "~/components/ui/link";
import { ConfirmationDialog } from "~/components/confirmation-dialog";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import { CookbookPage, CookbookSectionTitle, RuledEmptyState } from "~/components/cookbook/page";
import { ChecklistRow } from "~/components/shopping/checklist-row";

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
export type ShoppingListViewMode = "all" | "need" | "basket";

const SHOPPING_CATEGORY_SORT_RANK: Record<string, number> = {
  Produce: 1,
  Protein: 2,
  Dairy: 3,
  Bakery: 4,
  Pantry: 5,
  Spices: 6,
  Frozen: 7,
  Other: 8,
};

export function orderShoppingItemsForMarket<T extends { checked: boolean; categoryLabel: string }>(
  items: T[]
) {
  return items
    .map((item, index) => ({
      item,
      index,
      categoryRank: SHOPPING_CATEGORY_SORT_RANK[item.categoryLabel] ?? 99,
    }))
    .sort((a, b) =>
      a.categoryRank - b.categoryRank ||
      a.index - b.index
    )
    .map(({ item }) => item);
}

export function getShoppingSectionLabel(
  item: { checked: boolean; categoryLabel: string },
  previousItem: { checked: boolean; categoryLabel: string } | null,
  _viewMode: ShoppingListViewMode
) {
  const label = item.categoryLabel;
  const previousLabel = previousItem ? previousItem.categoryLabel : null;

  return previousLabel === label ? null : label;
}

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

function amountLabel(item: { quantity: number | string | null; unit?: { name: string } | null }) {
  return [item.quantity, item.unit?.name].filter(Boolean).join(" ").trim();
}

export default function ShoppingList() {
  const actionData = useActionData<ShoppingListActionData>();
  const { shoppingList, recipes } = useLoaderData<typeof loader>();
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [optimisticCheckedById, setOptimisticCheckedById] = useState<Record<string, boolean>>({});
  const [optimisticRemovedById, setOptimisticRemovedById] = useState<Record<string, boolean>>({});
  const [revealedItemId, setRevealedItemId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [viewMode, setViewMode] = useState<ShoppingListViewMode>("all");
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

    return orderShoppingItemsForMarket(withOptimistic);
  }, [shoppingList.items, optimisticCheckedById, optimisticRemovedById]);

  const checkedCount = displayItems.filter((item) => item.checked).length;
  const uncheckedCount = displayItems.length - checkedCount;
  const displayOrderKey = displayItems.map((item) => item.id).join("|");
  const visibleItems = useMemo(() => {
    if (viewMode === "need") {
      return displayItems.filter((item) => !item.checked);
    }

    if (viewMode === "basket") {
      return displayItems.filter((item) => item.checked);
    }

    return displayItems;
  }, [displayItems, viewMode]);
  const viewOptions: Array<{ mode: ShoppingListViewMode; label: string }> = [
    { mode: "need", label: `Need ${uncheckedCount}` },
    { mode: "basket", label: `Basket ${checkedCount}` },
    { mode: "all", label: `All ${displayItems.length}` },
  ];
  const categoryOptions = useMemo(() => {
    const uniqueLabels = Array.from(new Set(visibleItems.map((item) => item.categoryLabel)));
    return ["all", ...uniqueLabels];
  }, [visibleItems]);
  const filteredItems = activeCategory === "all"
    ? visibleItems
    : visibleItems.filter((item) => item.categoryLabel === activeCategory);

  useEffect(() => {
    setRevealedItemId(null);
  }, [displayOrderKey]);

  useEffect(() => {
    if (!categoryOptions.includes(activeCategory)) {
      setActiveCategory("all");
    }
  }, [activeCategory, categoryOptions]);

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
    <CookbookPage>
      <div className="mx-auto max-w-4xl">
        <header className="pb-6" data-testid="shopping-list-page-header">
          <div className="flex items-center justify-between gap-4 font-sj-ui text-sm font-bold">
            <Link href="/" className="inline-flex min-h-11 items-center text-[var(--sj-ink)] no-underline">Kitchen</Link>
            <span className="text-[var(--sj-ink-soft)]">
              {displayItems.length} {displayItems.length === 1 ? "item" : "items"}
            </span>
          </div>
          <h1 className="font-sj-display mt-7 text-5xl/12 font-extrabold text-[var(--sj-ink)]">
            <span className="sr-only">Shopping list</span>
            <span aria-hidden="true">Market run.</span>
          </h1>
          <Text className="mt-3">
            {checkedCount > 0 ? `${checkedCount} checked, ${uncheckedCount} remaining` : "Grouped for the aisle, built for one thumb."}
          </Text>
        </header>
      </div>

      <div className="mx-auto lg:max-w-[40rem]" data-testid="shopping-list-checklist-board">
        <div className="grid grid-cols-3 border-y border-[var(--sj-border)] font-sj-ui text-xs font-bold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)]">
          {viewOptions.map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => setViewMode(option.mode)}
              className={[
                "min-h-11 px-3 transition first:text-left last:text-right",
                viewMode === option.mode
                  ? "bg-[var(--sj-ink)] text-[var(--sj-paper)]"
                  : "bg-transparent hover:text-[var(--sj-ink)]",
              ].join(" ")}
              aria-pressed={viewMode === option.mode}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {categoryOptions.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={[
                "font-sj-ui min-h-11 shrink-0 rounded-[var(--sj-radius-control)] border px-4 py-2 text-sm font-bold capitalize",
                activeCategory === category
                  ? "border-[var(--sj-ink)] bg-[var(--sj-ink)] text-[var(--sj-paper)]"
                  : "border-[var(--sj-border)] text-[var(--sj-ink)]",
              ].join(" ")}
            >
              {category}
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {/* istanbul ignore next -- @preserve */ checkedCount > 0 && (
            <Form method="post">
              <input type="hidden" name="intent" value="clearCompleted" />
              <Button type="submit" plain>
                Clear checked
              </Button>
            </Form>
          )}
          {/* istanbul ignore next -- @preserve */ displayItems.length > 0 && (
            <>
              <Button
                variant="destructive"
                onClick={() => setShowClearDialog(true)}
              >
                Clear all
              </Button>
              <ConfirmationDialog
                open={showClearDialog}
                onClose={() => setShowClearDialog(false)}
                onConfirm={handleClearAllConfirm}
                title="Start fresh?"
                description="All items will be cleared from your shopping list."
                confirmLabel="Clear all"
                cancelLabel="Keep list"
                destructive
              />
            </>
          )}
        </div>

        {/* Empty State */}
        {displayItems.length === 0 ? (
          <RuledEmptyState title="Your shopping list is empty">
            <Text className="mt-2">
              Add items manually or add all ingredients from a recipe
            </Text>
          </RuledEmptyState>
        ) : filteredItems.length === 0 ? (
          <RuledEmptyState title={viewMode === "basket" ? "Nothing in the basket yet" : "Nothing left in this view"}>
            <Text className="mt-2">
              Switch views or categories to see the rest of the market run.
            </Text>
          </RuledEmptyState>
        ) : (
          /* Item List */
          <LayoutGroup id="shopping-list-items">
            <div className="sj-list-ruled mt-6">
              <AnimatePresence initial={false}>
                {filteredItems.map((item, index) => {
                  const previousItem = index > 0 ? filteredItems[index - 1] : null;
                  const sectionLabel = getShoppingSectionLabel(item, previousItem, viewMode);

                  return (
                    <motion.div
                      key={item.id}
                      layout="position"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{
                        layout: { type: "spring", stiffness: 360, damping: 34, mass: 0.75 },
                        opacity: { duration: 0.16 },
                        y: { type: "spring", stiffness: 460, damping: 38, mass: 0.55 },
                      }}
                      className="space-y-1"
                      data-testid="shopping-list-motion-item"
                    >
                      {sectionLabel && (
                        <div className="font-sj-ui pt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-brass)]" data-testid="shopping-list-category">
                          {sectionLabel}
                        </div>
                      )}
                      <div className="relative overflow-hidden">
                        {revealedItemId === item.id && (
                          <div className="pointer-events-auto absolute inset-y-0 right-0 w-28 bg-[var(--sj-tomato)] text-[var(--sj-paper)]">
                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              className="font-sj-ui flex h-full w-full items-center justify-center text-xs font-semibold uppercase tracking-wide"
                              aria-label={`Delete ${item.ingredientRef.name}`}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                        <motion.div
                          drag="x"
                          animate={{
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
                          transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.5 }}
                          className="relative z-10 bg-[var(--sj-page)]"
                        >
                          <ChecklistRow
                            checked={item.checked}
                            name={item.ingredientRef.name}
                            quantity={amountLabel(item)}
                            note={item.checked ? "already in basket" : null}
                            onToggle={() => toggleItem(item)}
                            action={(
                              <button
                                type="button"
                                onClick={() => removeItem(item.id)}
                                className="sr-only"
                                aria-label={`Remove ${item.ingredientRef.name}`}
                              >
                                Remove
                              </button>
                            )}
                          />
                        </motion.div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </LayoutGroup>
        )}

      {/* Add Item Form */}
      <div id="add-item" className="border-b border-[var(--sj-border)] py-6">
        <CookbookSectionTitle>Add item</CookbookSectionTitle>
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
                className="[&_input]:rounded-[var(--sj-radius-small)]"
              />
            </Field>
            {actionData?.parseDraft && (
              <div className="border-y border-[var(--sj-border)] py-4">
                <p className="text-sm text-[var(--sj-ink-soft)]">
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
                      className="[&_input]:rounded-[var(--sj-radius-small)]"
                    />
                  </Field>
                  <Field>
                    <Label>Unit</Label>
                    <Input
                      type="text"
                      name="unitName"
                      placeholder="lb"
                      defaultValue={actionData.parseDraft.unitName}
                      className="[&_input]:rounded-[var(--sj-radius-small)]"
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
                      className="[&_input]:rounded-[var(--sj-radius-small)]"
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
        <div className="border-b border-[var(--sj-border)] py-6">
          <CookbookSectionTitle>Add from recipe</CookbookSectionTitle>
          <Form method="post" className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end">
            <input type="hidden" name="intent" value="addFromRecipe" />
            <Field>
              <Label htmlFor="shopping-recipe-id">Recipe</Label>
              <Select id="shopping-recipe-id" name="recipeId" required>
                <option value="">Select a recipe...</option>
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label htmlFor="shopping-recipe-scale">Scale</Label>
              <Input
                id="shopping-recipe-scale"
                type="number"
                name="scaleFactor"
                min="0.25"
                step="0.25"
                defaultValue="1"
                inputMode="decimal"
              />
            </Field>
            <Button type="submit">
              Add ingredients
            </Button>
          </Form>
        </div>
      )}

      </div>
    </CookbookPage>
  );
}
