import type { Route } from "./+types/shopping-list";
import { formatAmount } from "~/lib/quantity";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, Form, useSubmit, useFetchers, useActionData, useLocation } from "react-router";
import {
  handleShoppingListAction,
  loadShoppingList,
} from "~/lib/shopping-list.server";
import {
  __internal__,
  parseShoppingItemFallback,
  type ShoppingListActionData,
} from "~/lib/shopping-list-parser";
import { Link as OuroLink } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";
import { Button } from "~/components/button";
import { Plus } from "lucide-react";
import { Field } from "~/components/ouro/field/field";
import { FieldControl } from "~/components/ouro/field/field-parts";
import { NativeSelect } from "~/components/ouro/select/native-select";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Link } from "~/components/navigation/app-link";
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import { CookbookPage, CookbookSectionTitle, RuledEmptyState } from "~/components/cookbook/page";
import { ChecklistItem, ChecklistRoot } from "~/components/ouro/checklist/checklist-parts";
import { SegmentedControl } from "~/components/ouro/segmented-control/segmented-control";
import { useWriteToken } from "~/hooks/use-write-token";
import { SwipeActions } from "~/components/ouro/swipe-actions/swipe-actions";

export { __internal__, parseShoppingItemFallback };

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Shopping list - Spoonjoy" },
    { name: "description", content: "Your Spoonjoy shopping list." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  return loadShoppingList({ request, context });
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleShoppingListAction({ request, context });
}

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

/** The items as runs of one aisle each, in order, for one checklist per aisle. */
export function shoppingSections<T extends { categoryLabel: string }>(items: T[]) {
  const sections: Array<{ label: string; items: T[] }> = [];
  for (const item of items) {
    const last = sections.at(-1);
    if (last?.label === item.categoryLabel) last.items.push(item);
    else sections.push({ label: item.categoryLabel, items: [item] });
  }
  return sections;
}

export type PendingShoppingItemChanges = {
  checkedById: Record<string, boolean>;
  removedById: Record<string, boolean>;
};

const SHOPPING_ITEM_FETCHER_PREFIX = "shopping-item-";

// What the rows should show while their own requests are in flight. Each row's check and remove
// go through a fetcher keyed by that row (see toggleItem and removeItem below), so a tap on one
// row never cancels another row's request, and this optimistic view is read from the requests
// still in flight rather than kept in state: a reload that lands for one row can't reset what
// another row is still waiting on, and once a row's request settles, the reloaded list is the
// truth. Fetchers that aren't a row's (other keys) are ignored.
export function pendingShoppingItemChanges(
  fetchers: ReadonlyArray<{ key: string; formData?: FormData }>
): PendingShoppingItemChanges {
  const checkedById: Record<string, boolean> = {};
  const removedById: Record<string, boolean> = {};

  for (const { key, formData } of fetchers) {
    const itemId = formData?.get("itemId")?.toString();
    if (!key.startsWith(SHOPPING_ITEM_FETCHER_PREFIX) || !formData || !itemId) continue;

    const intent = formData.get("intent");
    if (intent === "toggleCheck") {
      checkedById[itemId] = formData.get("nextChecked") === "true";
    } else if (intent === "removeItem") {
      removedById[itemId] = true;
    }
  }

  return { checkedById, removedById };
}

// "⅓ cup", "2 cups", "2": the same rounding as the recipe page, with counted things rounded
// up to what a shopper can buy.
export function amountLabel(item: { quantity: number | string | null; unit?: { name: string } | null }) {
  return formatAmount(item.quantity, item.unit?.name, { roundCountsUp: true });
}

export default function ShoppingList() {
  const actionData = useActionData<ShoppingListActionData>();
  const { shoppingList, recipes } = useLoaderData<typeof loader>();
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const [viewMode, setViewMode] = useState<ShoppingListViewMode>("all");
  const submit = useSubmit();
  const fetchers = useFetchers();
  const location = useLocation();
  const addItemFormRef = useRef<HTMLFormElement>(null);
  const addItemInputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  type Removal = { id: string; name: string; locationKey: string };
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [removalOpen, setRemovalOpen] = useState(false);
  const removalAuthority = useRef<Removal | null>(null);
  useEffect(() => () => { removalAuthority.current = null; }, []);
  // One add per submission of each form: a resubmit after a 503, or a double tap, adds once.
  const [addItemToken, renewAddItemToken] = useWriteToken();
  const [addRecipeToken, renewAddRecipeToken] = useWriteToken();
  const { checkedById: optimisticCheckedById, removedById: optimisticRemovedById } = useMemo(
    () => pendingShoppingItemChanges(fetchers),
    [fetchers]
  );

  // A successful add clears the Item field (R-M3-3), so pressing Add again can't add the same
  // item twice. The field is uncontrolled, so reset() puts it back to its default, which is
  // empty once the add has succeeded (no parse draft to review).
  useEffect(() => {
    if (actionData?.success && actionData.intent === "addItem") {
      addItemFormRef.current?.reset();
      renewAddItemToken();
    }
    if (actionData?.success && actionData.intent === "addFromRecipe") renewAddRecipeToken();
  }, [actionData, renewAddItemToken, renewAddRecipeToken]);

  // "Add item" at the top is a link to #add-item: bring the Item field into view with focus, ready
  // to type. Keyed on the location, so following the link again focuses it again.
  useEffect(() => {
    if (location.hash === "#add-item") {
      addItemInputRef.current?.focus();
    }
  }, [location.key, location.hash]);

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
  const visibleItems = useMemo(() => {
    if (viewMode === "need") {
      return displayItems.filter((item) => !item.checked);
    }

    if (viewMode === "basket") {
      return displayItems.filter((item) => item.checked);
    }

    return displayItems;
  }, [displayItems, viewMode]);
  const viewOptions: Array<{ value: ShoppingListViewMode; label: string }> = [
    { value: "need", label: `Need ${uncheckedCount}` },
    { value: "basket", label: `Basket ${checkedCount}` },
    { value: "all", label: `All ${displayItems.length}` },
  ];
  const categoryOptions = useMemo(() => {
    const uniqueLabels = Array.from(new Set(visibleItems.map((item) => item.categoryLabel)));
    return ["all", ...uniqueLabels];
  }, [visibleItems]);
  // A chosen aisle with nothing left in this view falls back to every aisle.
  const selectedCategory = categoryOptions.includes(activeCategory) ? activeCategory : "all";
  const filteredItems = selectedCategory === "all"
    ? visibleItems
    : visibleItems.filter((item) => item.categoryLabel === selectedCategory);

  // A hidden/deleted selection or a different Router entry has no remaining authority.
  // Keep its descriptor for the released dialog's exit animation; never retarget it.
  useLayoutEffect(() => {
    if (removalOpen && (removal!.locationKey !== location.key || !filteredItems.some((item) => item.id === removal!.id))) {
      removalAuthority.current = null;
      setRemovalOpen(false);
    }
  }, [removalOpen, removal, location.key, filteredItems]);

  useEffect(() => {
    if (!categoryOptions.includes(activeCategory)) {
      setActiveCategory("all");
    }
  }, [activeCategory, categoryOptions]);

  const handleClearAllConfirm = () => {
    setShowClearDialog(false);
    submit({ intent: "clearAll" }, { method: "post" });
  };

  // Each row has its own fetchers (one for checking, one for removing), so rapid taps on
  // different rows each reach the server instead of the later tap cancelling the earlier one.
  const toggleItem = (item: (typeof displayItems)[number]) => {
    submit(
      {
        intent: "toggleCheck",
        itemId: item.id,
        nextChecked: String(!item.checked),
      },
      { method: "post", navigate: false, fetcherKey: `${SHOPPING_ITEM_FETCHER_PREFIX}toggle-${item.id}` }
    );
  };

  const removeItem = (itemId: string) => {
    submit(
      {
        intent: "removeItem",
        itemId,
      },
      { method: "post", navigate: false, fetcherKey: `${SHOPPING_ITEM_FETCHER_PREFIX}remove-${itemId}` }
    );
  };

  const requestRemoval = (item: (typeof displayItems)[number]) => {
    // All entry points capture the same surviving row control, including menu and touch.
    // Base UI then restores cancellation focus to that control, not a disappearing menu item.
    const row = Array.from(boardRef.current!.querySelectorAll<HTMLElement>("[data-shopping-item]"))
      .find((element) => element.dataset.shoppingItem === item.id)!;
    row.querySelector<HTMLButtonElement>(`[data-ouro-control="swipe-actions"][data-ouro-part="menu"]`)!.focus();
    const selected = { id: item.id, name: item.ingredientRef.name, locationKey: location.key };
    removalAuthority.current = selected;
    setRemoval(selected);
    setRemovalOpen(true);
  };

  const closeRemoval = () => {
    removalAuthority.current = null;
    setRemovalOpen(false);
  };

  const confirmRemoval = (selected: Removal) => {
    if (removalAuthority.current !== selected) return;
    // useSubmit returns void. Consume authority synchronously rather than inventing a
    // promise or allowing repeated clicks to start the existing mutation twice.
    removalAuthority.current = null;
    removeItem(selected.id);
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
          <h1 ref={headingRef} tabIndex={-1} className="font-sj-display mt-7 text-5xl/12 font-extrabold text-[var(--sj-ink)]">
            <span className="sr-only">Shopping list</span>
            <span aria-hidden="true">Shopping List</span>
          </h1>
          <Text tone="muted" className="mt-3">
            {checkedCount > 0 ? `${checkedCount} checked, ${uncheckedCount} remaining` : "Grouped for the aisle, built for one thumb."}
          </Text>
          {/* The Item field sits below the list, so a long list needs a way straight to it. */}
          <Button href="#add-item" className="mt-5" data-testid="shopping-list-add-item-link">
            <Plus data-slot="icon" className="size-4" />
            New item
          </Button>
          {actionData?.error ? (
            <p role="alert" className="mt-4 text-sm text-[var(--sj-tomato)]" data-testid="shopping-list-action-error">
              {actionData.error}
            </p>
          ) : null}
        </header>
      </div>

      <div className="mx-auto lg:max-w-[40rem]" data-testid="shopping-list-checklist-board">
        <SegmentedControl
          label="View"
          hideLabel
          fullWidth
          items={viewOptions}
          value={viewMode}
          onValueChange={(mode) => setViewMode(mode as ShoppingListViewMode)}
        />
        {/* A long list has more aisles than a phone is wide: the aisles scroll sideways. */}
        <div className="mt-5 overflow-x-auto pb-1">
          <SegmentedControl
            label="Aisle"
            hideLabel
            items={categoryOptions.map((category) => ({ value: category, label: category === "all" ? "All aisles" : category }))}
            value={selectedCategory}
            onValueChange={setActiveCategory}
          />
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
              <ConfirmDialog
                open={showClearDialog}
                onOpenChange={() => setShowClearDialog(false)}
                onConfirm={handleClearAllConfirm}
                title="Start fresh?"
                description="All items will be cleared from your shopping list."
                confirmLabel="Clear all"
                cancelLabel="Keep list"
                tone="destructive"
              />
            </>
          )}
        </div>

        {/* Empty State */}
        {displayItems.length === 0 ? (
          // "Add from recipe" below only lists the user's own recipes, so a new user gets a way
          // to the public recipes, where any recipe's ingredients can be added. The link sits in
          // the sentence, not in a button row, so the Add button still clears the dock on a phone.
          <RuledEmptyState title="Your shopping list is empty">
            <Text tone="muted" className="mt-2">
              <OuroLink href="/recipes">Explore recipes</OuroLink> to add a recipe&apos;s ingredients, or add items one at a time below.
            </Text>
          </RuledEmptyState>
        ) : filteredItems.length === 0 ? (
          <RuledEmptyState title={viewMode === "basket" ? "Nothing in the basket yet" : "Nothing left in this view"}>
            <Text tone="muted" className="mt-2">
              Switch views or categories to see the rest of your shopping list.
            </Text>
          </RuledEmptyState>
        ) : (
          /* One checklist per aisle; each row swipes (or opens its actions menu) to delete. */
          <div ref={boardRef} className="mt-6 grid gap-6">
            {shoppingSections(filteredItems).map((section) => (
              <ChecklistRoot key={section.label} label={section.label}>
                {section.items.map((item) => (
                  <div key={item.id} data-testid="shopping-list-item" data-shopping-item={item.id}>
                    <SwipeActions
                      label={item.ingredientRef.name}
                      trailing={[{
                        label: `Delete ${item.ingredientRef.name}`,
                        tone: "destructive",
                        onClick: () => requestRemoval(item),
                      }]}
                    >
                      <ChecklistItem
                        label={item.ingredientRef.name}
                        value={amountLabel(item) || undefined}
                        checked={item.checked}
                        onCheckedChange={() => toggleItem(item)}
                      />
                    </SwipeActions>
                  </div>
                ))}
              </ChecklistRoot>
            ))}
          </div>
        )}

      {removal && (
        <ConfirmDialog
          open={removalOpen}
          onOpenChange={closeRemoval}
          title={`Remove "${removal.name}"?`}
          description="It will be removed from your shopping list. This cannot be undone."
          confirmLabel="Remove"
          tone="destructive"
          finalFocus={headingRef}
          onConfirm={() => confirmRemoval(removal)}
        />
      )}

      {/* Add Item Form */}
      <div id="add-item" className="border-b border-[var(--sj-border)] py-6">
        <CookbookSectionTitle>Add item</CookbookSectionTitle>
        <Form method="post" className="mt-4" ref={addItemFormRef}>
          <input type="hidden" name="intent" value="addItem" />
          <input type="hidden" name="writeToken" value={addItemToken} />
          <div className="grid gap-4">
            <TextField
              ref={addItemInputRef}
              label="Item"
              name="ingredientText"
              required
              placeholder="e.g., 2 lbs chicken breast or a dozen eggs"
              defaultValue={actionData?.parseDraft?.originalText || ""}
            />
            {actionData?.parseDraft && (
              <div className="border-y border-[var(--sj-border)] py-4">
                <p className="text-sm text-[var(--sj-ink-soft)]">
                  {actionData?.errors?.parse || "Review the parsed item before adding."}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mt-3">
                  {/* Ouro UI's TextField has no number type, so the quantity is its Field and control. */}
                  <Field label="Quantity" name="quantity">
                    <FieldControl
                      type="number"
                      step="0.01"
                      placeholder="2"
                      defaultValue={actionData.parseDraft.quantity}
                    />
                  </Field>
                  <TextField
                    label="Unit"
                    name="unitName"
                    placeholder="lb"
                    defaultValue={actionData.parseDraft.unitName}
                  />
                  <TextField
                    label="Ingredient"
                    name="ingredientName"
                    required
                    placeholder="chicken breast"
                    defaultValue={actionData.parseDraft.ingredientName}
                  />
                </div>
              </div>
            )}
            <Button type="submit" className="justify-self-start">Add</Button>
          </div>
        </Form>
      </div>

      {/* Add from Recipe */}
      {/* istanbul ignore next -- @preserve */ recipes.length > 0 && (
        <div className="border-b border-[var(--sj-border)] py-6">
          <CookbookSectionTitle>Add from recipe</CookbookSectionTitle>
          <Form method="post" className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end">
            <input type="hidden" name="intent" value="addFromRecipe" />
            <input type="hidden" name="writeToken" value={addRecipeToken} />
            <NativeSelect
              label="Recipe"
              name="recipeId"
              required
              placeholder="Select a recipe..."
              options={recipes.map((recipe) => ({ value: recipe.id, label: recipe.title }))}
            />
            <Field label="Scale" name="scaleFactor">
              <FieldControl type="number" min="0.25" step="0.25" defaultValue="1" inputMode="decimal" />
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
