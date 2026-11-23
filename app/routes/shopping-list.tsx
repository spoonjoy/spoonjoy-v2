import { Heading } from "~/components/ouro/text/heading";
import { Empty } from "~/components/ouro/empty/empty";
import type { Route } from "./+types/shopping-list";
import {
  formatAmountIn,
  parseUnitSystem,
  UNIT_SYSTEMS,
  unitSystemCookie,
  unitSystemFromCookie,
  type UnitSystem,
} from "~/domains/food-knowledge";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, Form, useSubmit, useFetchers, useActionData, useLocation, useRevalidator, type ShouldRevalidateFunctionArgs } from "react-router";
import { revalidateUnlessNetworkFailure, submitOrReportLostRequest } from "~/lib/network-failure";
import { useResendLostSubmission } from "~/hooks/use-resend-lost-submission";
import { controls } from "../../actions/generated/web";
import { browserModelContext, registerShoppingListWebMcpTools } from "~/lib/webmcp-actions";
import {
  handleShoppingListAction,
  loadShoppingList,
} from "~/lib/shopping-list.server";
import {
  __internal__,
  parseShoppingItemFallback,
  type ShoppingListActionData,
} from "~/lib/shopping-list-parser";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";
import { Button } from "~/components/ouro/button/button";
import { Ellipsis, Plus } from "lucide-react";
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem } from "~/components/ouro/menu/menu";
import { Field } from "~/components/ouro/field/field";
import { FieldControl } from "~/components/ouro/field/field-parts";
import { NativeSelect } from "~/components/ouro/select/native-select";
import { TextField } from "~/components/ouro/text-field/text-field";
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import { CookbookPage } from "~/components/cookbook/page";
import { ChecklistItem, ChecklistRoot } from "~/components/ouro/checklist/checklist-parts";
import { SegmentedControl } from "~/components/ouro/segmented-control/segmented-control";
import { useWriteToken } from "~/hooks/use-write-token";
import { SwipeActions } from "~/components/ouro/swipe-actions/swipe-actions";
import { useFlag } from "~/domains/platform";
import { mergeShoppingRows } from "~/domains/pantry-and-shopping";

export { __internal__, parseShoppingItemFallback };

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Shopping list - Spoonjoy" },
    { name: "description", content: "Your Spoonjoy shopping list." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const list = await loadShoppingList({ request, context });
  // The units the cook picked on a recipe or here; the page uses them only while unit conversion is on.
  return { ...list, unitSystem: unitSystemFromCookie(request.headers.get("Cookie")) };
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleShoppingListAction({ request, context });
}

// Clearing the list, or its checked rows, leaves the same list however many times it is applied,
// so only these are sent again when a submission got no answer (useResendLostSubmission, which
// covers the page's own submissions, not the rows' fetchers). Adding an item twice adds it twice.
const IDEMPOTENT_INTENTS = new Set(["clearAll", "clearCompleted"]);

// A submission that got no answer shows a message where the cook acted, instead of the error page
// (spoonjoy-v2#771: a reset Clear all replaced the list with "That's on our side").
export async function clientAction({ request, serverAction }: Route.ClientActionArgs) {
  const formData = await request.clone().formData();
  const intent = formData.get("intent");
  const name = typeof intent === "string" ? intent : null;
  const resend = name !== null && IDEMPOTENT_INTENTS.has(name)
    ? Object.fromEntries([...formData].filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : null;
  return submitOrReportLostRequest(serverAction, { intent: name, resend });
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return revalidateUnlessNetworkFailure(args, args.defaultShouldRevalidate);
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
// up to what a shopper can buy, in the cook's unit system.
export function amountLabel(
  item: { quantity: number | string | null; unit?: { name: string } | null },
  system: UnitSystem = "original",
) {
  return formatAmountIn(system, item.quantity, item.unit?.name, { roundCountsUp: true });
}

export default function ShoppingList() {
  const actionData = useActionData<ShoppingListActionData>();
  const resendingLostSubmission = useResendLostSubmission(actionData);
  const { shoppingList, recipes, unitSystem } = useLoaderData<typeof loader>();
  const mergeUnits = useFlag("shopping-merge-units");
  const [units, setUnits] = useState<UnitSystem>(unitSystem);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [viewMode, setViewMode] = useState<ShoppingListViewMode>("all");
  const submit = useSubmit();
  const fetchers = useFetchers();
  const location = useLocation();
  const addItemFormRef = useRef<HTMLFormElement>(null);
  const addItemInputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  type Removal = { id: string; rowIds: string[]; name: string; locationKey: string };
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

  // An agent in the person's browser adds with the same declared action as the Add to list button.
  const revalidator = useRevalidator();
  const revalidate = useRef(revalidator.revalidate);
  revalidate.current = revalidator.revalidate;
  useEffect(
    () =>
      registerShoppingListWebMcpTools(browserModelContext(navigator), {
        fetch: (...args) => fetch(...args),
        newMutationId: () => crypto.randomUUID(),
        onAdded: () => void revalidate.current(),
      }),
    []
  );

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

    const lines = mergeUnits ? mergeShoppingRows(withOptimistic) : withOptimistic.map((item) => ({ ...item, rowIds: [item.id] }));
    return orderShoppingItemsForMarket(lines);
  }, [shoppingList.items, optimisticCheckedById, optimisticRemovedById, mergeUnits]);

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
  const filteredItems = visibleItems;

  // A hidden/deleted selection or a different Router entry has no remaining authority.
  // Keep its descriptor for the released dialog's exit animation; never retarget it.
  useLayoutEffect(() => {
    if (removalOpen && (removal!.locationKey !== location.key || !filteredItems.some((item) => item.id === removal!.id))) {
      removalAuthority.current = null;
      setRemovalOpen(false);
    }
  }, [removalOpen, removal, location.key, filteredItems]);

  const handleClearAllConfirm = () => {
    setShowClearDialog(false);
    submit({ intent: "clearAll" }, { method: "post" });
  };

  // Each row has its own fetchers (one for checking, one for removing), so rapid taps on
  // different rows each reach the server instead of the later tap cancelling the earlier one.
  // A merged line checks each of its rows.
  const toggleItem = (item: (typeof displayItems)[number]) => {
    for (const itemId of item.rowIds) {
      submit(
        {
          intent: "toggleCheck",
          itemId,
          nextChecked: String(!item.checked),
        },
        { method: "post", navigate: false, fetcherKey: `${SHOPPING_ITEM_FETCHER_PREFIX}toggle-${itemId}` }
      );
    }
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
    const selected = { id: item.id, rowIds: item.rowIds, name: item.ingredientRef.name, locationKey: location.key };
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
    for (const itemId of selected.rowIds) removeItem(itemId);
  };

  return (
    <CookbookPage>
      <div className="mx-auto max-w-4xl">
        <header className="pb-6" data-testid="shopping-list-page-header">
          <div className="flex min-h-11 items-center justify-between gap-4 font-sj-ui text-sm font-bold">
            <Link href="/" tone="secondary">Kitchen</Link>
            {/* Clearing lives in the list's menu, as on the Apple app (one-book target, Shopping). */}
            {/* istanbul ignore next -- @preserve */ displayItems.length > 0 ? (
              <Menu trigger={<Button variant="outline" tone="secondary" aria-label="List actions"><Ellipsis /></Button>}>
                {checkedCount > 0 ? (
                  <MenuItem onClick={() => submit({ intent: "clearCompleted" }, { method: "post" })}>Clear checked</MenuItem>
                ) : null}
                <MenuItem tone="destructive" onClick={() => setShowClearDialog(true)}>Clear all</MenuItem>
                <MenuRadioGroup
                  label="Units"
                  value={units}
                  onValueChange={(value) => {
                    const next = parseUnitSystem(value);
                    setUnits(next);
                    document.cookie = unitSystemCookie(next);
                  }}
                >
                  {UNIT_SYSTEMS.map((system) => (
                    <MenuRadioItem key={system.value} value={system.value}>{system.label}</MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </Menu>
            ) : null}
          </div>
          <h1 ref={headingRef} tabIndex={-1} className="sj-type-display mt-5 text-[var(--sj-ink)]">
            <span className="sr-only">Shopping list</span>
            <span aria-hidden="true">Shopping List</span>
          </h1>
          <Text tone="muted" size="sm" className="mt-1">
            <span>{displayItems.length} {displayItems.length === 1 ? "item" : "items"}</span>
            {checkedCount > 0 ? <span>{" · "}<span>{`${checkedCount} checked, ${uncheckedCount} remaining`}</span></span> : null}
          </Text>
          {/* The add field leads the page, with its + circle beside it, as on the Apple app. */}
          <Form method="post" className="mt-6" ref={addItemFormRef} id="add-item">
            <input type="hidden" name="intent" value="addItem" />
            <input type="hidden" name="writeToken" value={addItemToken} />
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextField
                  ref={addItemInputRef}
                  label="Item"
                  hideLabel
                  name="ingredientText"
                  required
                  placeholder="Add an item"
                  defaultValue={actionData?.parseDraft?.originalText || ""}
                />
              </div>
              <Button type="submit" {...controls["add-shopping-list-item"].props} aria-label={controls["add-shopping-list-item"].label}>
                <Plus />
              </Button>
            </div>
            {actionData?.parseDraft && (
              <div className="mt-4 border-y border-[var(--sj-border)] py-4">
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
          </Form>
          {actionData?.error && !resendingLostSubmission ? (
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

        {/* Empty State */}
        {displayItems.length === 0 ? (
          // "Add from recipe" below only lists the user's own recipes, so a new user gets a way
          // to the public recipes, where any recipe's ingredients can be added. The link sits in
          // the sentence, not in a button row, so the Add button still clears the dock on a phone.
          <Empty headingLevel={2} align="start" description={<>
            <Text tone="muted" className="mt-2">
              <Link href="/recipes">Explore recipes</Link> to add a recipe&apos;s ingredients, or add items one at a time below.
            </Text>
          </>} title="Your shopping list is empty" />
        ) : filteredItems.length === 0 ? (
          <Empty headingLevel={2} align="start" description={<>
            <Text tone="muted" className="mt-2">
              Switch views or categories to see the rest of your shopping list.
            </Text>
          </>} title={viewMode === "basket" ? "Nothing in the basket yet" : "Nothing left in this view"} />
        ) : (
          /* One checklist per aisle; each row swipes (or opens its actions menu) to delete. */
          <div ref={boardRef} className="mt-6 grid gap-6">
            {shoppingSections(filteredItems).map((section) => (
              <div key={section.label}>
                {/* The aisle's name in Fraunces with its count beside it, as on the Apple app. */}
                <h2 className="font-sj-display flex items-baseline gap-2 text-2xl/8 font-semibold text-[var(--sj-ink)]" aria-hidden="true">
                  {section.label}
                  <span className="font-sj-ui text-xs font-semibold text-[var(--sj-ink-soft)]">{section.items.length}</span>
                </h2>
                <ChecklistRoot label={section.label} hideLabel className="mt-2">
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
                        value={amountLabel(item, units) || undefined}
                        checked={item.checked}
                        onCheckedChange={() => toggleItem(item)}
                      />
                    </SwipeActions>
                  </div>
                ))}
                </ChecklistRoot>
              </div>
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

      {/* Add from Recipe */}
      {/* istanbul ignore next -- @preserve */ recipes.length > 0 && (
        <div className="border-b border-[var(--sj-border)] py-6">
          <Heading className="my-5" level={2} size="xl">Add from recipe</Heading>
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
