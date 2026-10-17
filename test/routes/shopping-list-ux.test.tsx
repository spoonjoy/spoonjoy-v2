import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, useNavigate, useRevalidator } from "react-router";
import React from "react";
import { createTestRoutesStub, requiredLabel } from "../utils";

vi.mock("motion/react", () => {
  const MotionDiv = ({
    children,
    onDragEnd,
    animate,
    layout,
    drag: _drag,
    dragConstraints: _dragConstraints,
    dragElastic: _dragElastic,
    dragMomentum: _dragMomentum,
    dragDirectionLock: _dragDirectionLock,
    initial: _initial,
    exit: _exit,
    transition: _transition,
    ...props
  }: {
    children: React.ReactNode;
    onDragEnd?: (_event: unknown, info: { offset: { x: number; y: number } }) => void;
    animate?: { x?: number };
    layout?: boolean | "position";
    [key: string]: unknown;
  }) => (
    <div
      {...props}
      data-motion-x={String(animate?.x ?? 0)}
      data-layout={layout ? String(layout) : undefined}
      onPointerUp={(event) => {
        const offsetX = Number(
          (event.currentTarget as HTMLDivElement).dataset.dragOffsetX ?? "0"
        );
        onDragEnd?.(event, { offset: { x: offsetX, y: 0 } });
      }}
    >
      {children}
    </div>
  );

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    LayoutGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    LazyMotion: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    m: { div: MotionDiv },
  };
});

import ShoppingList, {
  getShoppingSectionLabel,
  orderShoppingItemsForMarket,
} from "~/routes/shopping-list";

describe("shopping list UX updates", () => {
  const singleItemData = {
    shoppingList: {
      id: "list-1",
      items: [
        {
          id: "item-1",
          quantity: 2,
          checked: false,
          unit: { name: "lbs" },
          ingredientRef: { name: "chicken thigh" },
          categoryKey: "protein",
          iconKey: "beef",
        },
      ],
    },
    recipes: [],
  };

  it("returns Escape cancellation to the surviving row action without submitting", async () => {
    let writes = 0;
    const Stub = createTestRoutesStub([{ path: "/shopping-list", Component: ShoppingList,
      loader: () => singleItemData, action: () => { writes++; return { success: true }; },
    }]);
    render(<Stub initialEntries={["/shopping-list"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove chicken thigh" }));
    const dialog = await screen.findByRole("alertdialog", { name: 'Remove "chicken thigh"?' });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for chicken thigh" })).toHaveFocus());
    expect(writes).toBe(0);
    expect(screen.getByRole("checkbox", { name: "chicken thigh" })).toHaveAttribute("aria-checked", "false");
  });

  it.each(["disappearance", "new Router entry"] as const)("invalidates a selected item on %s without a stale removal", async (change) => {
    let items = [...singleItemData.shoppingList.items];
    let refresh!: ReturnType<typeof useRevalidator>["revalidate"];
    let navigate!: ReturnType<typeof useNavigate>;
    let writes = 0;
    function Shell() {
      refresh = useRevalidator().revalidate;
      navigate = useNavigate();
      return <Outlet />;
    }
    const Stub = createTestRoutesStub([{ path: "/", Component: Shell, children: [{
      path: "shopping-list", Component: ShoppingList,
      loader: () => ({ ...singleItemData, shoppingList: { ...singleItemData.shoppingList, items } }),
      action: () => { writes++; return { success: true }; },
    }] }]);
    render(<Stub initialEntries={["/shopping-list"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove chicken thigh" }));
    const dialog = await screen.findByRole("alertdialog", { name: 'Remove "chicken thigh"?' });
    const oldConfirm = within(dialog).getByRole("button", { name: "Remove" });
    await act(async () => {
      if (change === "disappearance") { items = []; await refresh(); }
      else await navigate("/shopping-list?changed=1");
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    fireEvent.click(oldConfirm);
    expect(writes).toBe(0);
  });

  it("allows another explicit attempt after a failed confirmed mutation revalidates the same item", async () => {
    const writes: string[] = [];
    const Stub = createTestRoutesStub([{ path: "/shopping-list", Component: ShoppingList,
      loader: () => singleItemData,
      action: async ({ request }: { request: Request }) => {
        writes.push(String((await request.formData()).get("itemId")));
        return { error: "Could not remove item" };
      },
    }]);
    render(<Stub initialEntries={["/shopping-list"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove chicken thigh" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "chicken thigh" })).toBeInTheDocument());
    expect(writes).toEqual(["item-1"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove chicken thigh" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(writes).toEqual(["item-1", "item-1"]));
  });

  it("orders the market list by aisle without jumping checked items out of their category", () => {
    const ordered = orderShoppingItemsForMarket([
      { id: "checked-produce", checked: true, categoryLabel: "Produce" },
      { id: "pantry", checked: false, categoryLabel: "Pantry" },
      { id: "mystery", checked: false, categoryLabel: "Mystery" },
      { id: "produce", checked: false, categoryLabel: "Produce" },
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      "checked-produce",
      "produce",
      "pantry",
      "mystery",
    ]);
  });

  it("labels sections by aisle even when items are checked", () => {
    expect(getShoppingSectionLabel(
      { checked: false, categoryLabel: "Produce" },
      null,
      "need"
    )).toBe("Produce");
    expect(getShoppingSectionLabel(
      { checked: false, categoryLabel: "Produce" },
      { checked: false, categoryLabel: "Produce" },
      "need"
    )).toBeNull();
    expect(getShoppingSectionLabel(
      { checked: true, categoryLabel: "Produce" },
      { checked: false, categoryLabel: "Other" },
      "all"
    )).toBe("Produce");
    expect(getShoppingSectionLabel(
      { checked: true, categoryLabel: "Dairy" },
      { checked: true, categoryLabel: "Produce" },
      "all"
    )).toBe("Dairy");
    expect(getShoppingSectionLabel(
      { checked: true, categoryLabel: "Produce" },
      null,
      "basket"
    )).toBe("Produce");
  });

  it("removes inline remove buttons and per-item category chips", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => singleItemData,
        action: async () => ({ success: true }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    expect(await screen.findByText("chicken thigh")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("shopping-list-category")).toHaveLength(1);
  });

  it("shows a retryable message and keeps the typed item when the add could not be saved", async () => {
    const message = "Spoonjoy couldn't save that just now. Please try again in a moment.";
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => singleItemData,
        action: async () => ({ intent: "addItem", error: message, errorCode: "temporarily_unavailable", retryable: true }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);
    const input = (await screen.findByTestId("shopping-list-checklist-board"), document.querySelector("input[name='ingredientText']") as HTMLInputElement);
    fireEvent.change(input, { target: { value: "2 lemons" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByTestId("shopping-list-action-error")).toHaveTextContent(message);
    expect(input.value).toBe("2 lemons");
  });

  it("sends the same write token for a resubmit after a 503, and a fresh one after each success", async () => {
    const message = "Spoonjoy couldn't save that just now. Please try again in a moment.";
    const tokens: Array<{ intent: string; token: string }> = [];
    const answers = [
      { intent: "addItem", error: message, errorCode: "temporarily_unavailable", retryable: true },
      { success: true, intent: "addItem" },
      { success: true, intent: "addItem" },
      { success: true, intent: "addFromRecipe" },
      { success: true, intent: "addFromRecipe" },
    ];
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({ ...singleItemData, recipes: [{ id: "recipe-1", title: "Sunday Sauce" }] }),
        action: async ({ request }) => {
          const formData = await request.formData();
          tokens.push({ intent: String(formData.get("intent")), token: String(formData.get("writeToken")) });
          return answers[tokens.length - 1];
        },
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);
    await screen.findByTestId("shopping-list-checklist-board");
    const input = document.querySelector("input[name='ingredientText']") as HTMLInputElement;
    const addItem = async (count: number) => {
      fireEvent.change(input, { target: { value: "2 lemons" } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() => expect(tokens).toHaveLength(count));
    };
    await addItem(1);
    await screen.findByTestId("shopping-list-action-error");
    await addItem(2);
    await waitFor(() => expect(input.value).toBe(""));
    await addItem(3);

    fireEvent.change(screen.getByLabelText(requiredLabel("Recipe")), { target: { value: "recipe-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add ingredients" }));
    await waitFor(() => expect(tokens).toHaveLength(4));
    await waitFor(() => expect((document.querySelectorAll("input[name='writeToken']")[1] as HTMLInputElement).value).not.toBe(tokens[3]!.token));
    fireEvent.click(screen.getByRole("button", { name: "Add ingredients" }));
    await waitFor(() => expect(tokens).toHaveLength(5));

    const [failed, resubmitted, next, recipeFirst, recipeNext] = tokens.map(({ token }) => token);
    expect(failed).toMatch(/^[\w-]{8,}$/);
    // The resubmit after the 503 is the same add.
    expect(resubmitted).toBe(failed);
    // After a success, the next submit is a new add.
    expect(next).not.toBe(resubmitted);
    expect(recipeFirst).toMatch(/^[\w-]{8,}$/);
    expect(recipeFirst).not.toBe(next);
    expect(recipeNext).not.toBe(recipeFirst);
  });

  it("keeps the market checklist narrower than the shopping-list header on desktop", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => singleItemData,
        action: async () => ({ success: true }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    expect(await screen.findByText("chicken thigh")).toBeInTheDocument();
    expect(screen.getByTestId("shopping-list-page-header")).not.toHaveClass("lg:max-w-[40rem]");
    expect(screen.getByTestId("shopping-list-checklist-board")).toHaveClass("lg:max-w-[40rem]");
  });

  it("writes amounts the way the recipe does: fractions, plural units, whole things rounded up", async () => {
    // A scaled recipe add used to show the raw float ("0.3125 cup", "1.25 whole").
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({
          shoppingList: {
            id: "list-amounts",
            items: [
              { id: "item-stock", quantity: 0.3125, checked: false, unit: { name: "cup" }, ingredientRef: { name: "chicken stock" }, categoryKey: "pantry", iconKey: "droplets" },
              { id: "item-rice", quantity: 2.5, checked: false, unit: { name: "cup" }, ingredientRef: { name: "jasmine rice" }, categoryKey: "pantry", iconKey: "wheat" },
              { id: "item-lemon", quantity: 1.25, checked: false, unit: { name: "whole" }, ingredientRef: { name: "lemon" }, categoryKey: "produce", iconKey: "citrus" },
              { id: "item-garlic", quantity: 2.5, checked: false, unit: { name: "clove" }, ingredientRef: { name: "garlic" }, categoryKey: "produce", iconKey: "carrot" },
              { id: "item-salt", quantity: null, checked: false, unit: null, ingredientRef: { name: "salt" }, categoryKey: "spices", iconKey: "pot" },
            ],
          },
          recipes: [],
        }),
        action: async () => ({ success: true }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    const amountOf = async (name: string) => {
      const item = await screen.findByRole("checkbox", { name: new RegExp(`^${name}`) });
      return item.textContent ?? "";
    };
    expect(await amountOf("chicken stock")).toContain("⅓ cup");
    expect(await amountOf("chicken stock")).not.toContain("0.3125");
    expect(await amountOf("jasmine rice")).toContain("2 ½ cups");
    // A counted thing shows its number alone: "whole" is a stored unit, not a word a cook writes.
    expect(await amountOf("lemon")).toMatch(/lemon2$/);
    expect(await amountOf("garlic")).toContain("3 cloves");
    expect(await amountOf("salt")).not.toMatch(/\d/);
  });

  it("filters the list by needed, basket, and all item views", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({
          shoppingList: {
            id: "list-filter",
            items: [
              {
                id: "item-need",
                quantity: 1,
                checked: false,
                unit: null,
                ingredientRef: { name: "lemons" },
                categoryKey: "produce",
                iconKey: "lemon",
              },
              {
                id: "item-basket",
                quantity: 2,
                checked: true,
                checkedAt: "2026-05-24T18:00:00.000Z",
                unit: null,
                ingredientRef: { name: "limes" },
                categoryKey: "produce",
                iconKey: "lime",
              },
            ],
          },
          recipes: [],
        }),
        action: async () => ({ success: true }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    expect(await screen.findByText("lemons")).toBeInTheDocument();
    expect(screen.getByText("limes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Need 1/i }));
    expect(screen.getByText("lemons")).toBeInTheDocument();
    expect(screen.queryByText("limes")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Basket 1/i }));
    expect(screen.queryByText("lemons")).not.toBeInTheDocument();
    expect(screen.getByText("limes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /All 2/i }));
    expect(screen.getByText("lemons")).toBeInTheDocument();
    expect(screen.getByText("limes")).toBeInTheDocument();
  });

  it("shows checked items under one in-basket section in all view", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({
          shoppingList: {
            id: "list-all-basket",
            items: [
              {
                id: "item-need",
                quantity: 1,
                checked: false,
                unit: null,
                ingredientRef: { name: "tomatoes" },
                categoryKey: "produce",
                iconKey: "carrot",
              },
              {
                id: "item-basket-a",
                quantity: 1,
                checked: true,
                checkedAt: "2026-05-24T18:00:00.000Z",
                unit: null,
                ingredientRef: { name: "limes" },
                categoryKey: "produce",
                iconKey: "citrus",
              },
              {
                id: "item-basket-b",
                quantity: 1,
                checked: true,
                checkedAt: "2026-05-24T18:01:00.000Z",
                unit: null,
                ingredientRef: { name: "butter" },
                categoryKey: "dairy",
                iconKey: "milk",
              },
            ],
          },
          recipes: [],
        }),
        action: async () => ({ success: true }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    expect(await screen.findByText("tomatoes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /All 3/i }));

    expect(screen.getAllByTestId("shopping-list-category").map((category) => category.textContent)).toEqual([
      "Produce",
      "Dairy",
    ]);
    expect(screen.getByText("limes")).toBeInTheDocument();
    expect(screen.getByText("butter")).toBeInTheDocument();
  });

  it("uses a specific empty state for an empty basket view", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({
          shoppingList: {
            id: "list-empty-basket",
            items: [
              {
                id: "item-need",
                quantity: 1,
                checked: false,
                unit: null,
                ingredientRef: { name: "tomatoes" },
                categoryKey: "produce",
                iconKey: "carrot",
              },
            ],
          },
          recipes: [],
        }),
        action: async () => ({ success: true }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    expect(await screen.findByText("tomatoes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Basket 0/i }));

    expect(screen.getByRole("heading", { name: "Nothing in the basket yet" })).toBeInTheDocument();
  });

  it("groups repeated category headings into one aisle section", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({
          shoppingList: {
            id: "list-grouped",
            items: [
              {
                id: "item-pantry",
                quantity: 1,
                checked: false,
                unit: null,
                ingredientRef: { name: "flour" },
                categoryKey: "pantry",
                iconKey: "wheat",
              },
              {
                id: "item-produce-a",
                quantity: 1,
                checked: false,
                unit: null,
                ingredientRef: { name: "tomatoes" },
                categoryKey: "produce",
                iconKey: "carrot",
              },
              {
                id: "item-produce-b",
                quantity: 1,
                checked: false,
                unit: null,
                ingredientRef: { name: "basil" },
                categoryKey: "produce",
                iconKey: "leaf",
              },
            ],
          },
          recipes: [],
        }),
        action: async () => ({ success: true }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    expect(await screen.findByText("tomatoes")).toBeInTheDocument();
    expect(screen.getAllByTestId("shopping-list-category").map((category) => category.textContent)).toEqual([
      "Produce",
      "Pantry",
    ]);
  });

  it("renders the parse review panel from action data after a failed add", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({ shoppingList: { id: "list-empty", items: [] }, recipes: [] }),
        action: async () => ({
          errors: { parse: "" },
          parseDraft: {
            quantity: "2",
            unitName: "whole",
            ingredientName: "apples",
            originalText: "2 apples",
          },
        }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    fireEvent.change(await screen.findByLabelText(requiredLabel("Item")), { target: { value: "2 apples" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Review the parsed item before adding.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("whole")).toBeInTheDocument();
    expect(screen.getByDisplayValue("apples")).toBeInTheDocument();
  });

  it("offers the same delete operation through the keyboard actions menu exactly once", async () => {
    let items = [...singleItemData.shoppingList.items];
    const writes: Array<Record<string, FormDataEntryValue>> = [];
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({ ...singleItemData, shoppingList: { ...singleItemData.shoppingList, items } }),
        action: async ({ request }: { request: Request }) => {
          writes.push(Object.fromEntries(await request.formData()));
          items = [];
          return { success: true };
        },
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    await screen.findByText("chicken thigh");
    expect(screen.getByRole("button", { name: "Remove chicken thigh" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actions for chicken thigh" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete chicken thigh" }));
    const dialog = await screen.findByRole("alertdialog", { name: 'Remove "chicken thigh"?' });
    expect(writes).toEqual([]);
    expect(screen.getByRole("checkbox", { name: "chicken thigh", hidden: true })).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Remove" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(screen.queryByText("chicken thigh")).not.toBeInTheDocument();
    });
    expect(writes).toEqual([{ intent: "removeItem", itemId: "item-1" }]);
  });

  it("keeps the non-gesture delete route after migrating the row", async () => {
    const mutableData = {
      shoppingList: {
        ...singleItemData.shoppingList,
        items: [...singleItemData.shoppingList.items],
      },
      recipes: [],
    };

    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => mutableData,
        action: async () => {
          mutableData.shoppingList.items = [];
          return { success: true };
        },
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    await screen.findByText("chicken thigh");
    fireEvent.click(screen.getByRole("button", { name: "Remove chicken thigh" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.queryByText("chicken thigh")).not.toBeInTheDocument();
    });
  });

  it("does not remove or submit when accessible removal is cancelled then reopened", async () => {
    let writes = 0;
    const mutableData = {
      shoppingList: {
        ...singleItemData.shoppingList,
        items: [...singleItemData.shoppingList.items],
      },
      recipes: [],
    };

    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => mutableData,
        action: async () => {
          writes += 1;
          mutableData.shoppingList.items = [];
          return { success: true };
        },
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    expect(await screen.findByText("chicken thigh")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove chicken thigh" }));
    const dialog = await screen.findByRole("alertdialog", { name: 'Remove "chicken thigh"?' });
    expect(writes).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "chicken thigh" })).toBeInTheDocument();
    expect(writes).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove chicken thigh" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByText("chicken thigh")).not.toBeInTheDocument());
    expect(writes).toBe(1);
  });

  it("submits clearAll after the confirmation dialog is confirmed", async () => {
    const submittedIntents: string[] = [];
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => singleItemData,
        action: async ({ request }) => {
          const formData = await request.formData();
          submittedIntents.push(String(formData.get("intent")));
          return { success: true };
        },
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    expect(await screen.findByText("chicken thigh")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear all" }));

    await waitFor(() => expect(submittedIntents).toContain("clearAll"));
  });

  it("submits a recipe scale when adding ingredients from a recipe", async () => {
    const submitted: Array<{ intent: string | null; recipeId: string | null; scaleFactor: string | null }> = [];
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({
          shoppingList: { id: "list-empty", items: [] },
          recipes: [{ id: "recipe-1", title: "Sunday Sauce" }],
        }),
        action: async ({ request }) => {
          const formData = await request.formData();
          submitted.push({
            intent: formData.get("intent")?.toString() ?? null,
            recipeId: formData.get("recipeId")?.toString() ?? null,
            scaleFactor: formData.get("scaleFactor")?.toString() ?? null,
          });
          return { success: true };
        },
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    fireEvent.change(await screen.findByLabelText(requiredLabel("Recipe")), { target: { value: "recipe-1" } });
    fireEvent.change(screen.getByLabelText("Scale"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add ingredients" }));

    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "addFromRecipe",
        recipeId: "recipe-1",
        scaleFactor: "1.5",
      });
    });
  });

  it("keeps ruled receipt rows in place when an item is checked", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({
          shoppingList: {
            id: "list-2",
            items: [
              {
                id: "item-1",
                quantity: 1,
                checked: false,
                unit: null,
                ingredientRef: { name: "apples" },
                categoryKey: "produce",
                iconKey: "apple",
              },
              {
                id: "item-2",
                quantity: 1,
                checked: false,
                unit: null,
                ingredientRef: { name: "bananas" },
                categoryKey: "produce",
                iconKey: "banana",
              },
            ],
          },
          recipes: [],
        }),
        action: async () => ({ success: true }),
      },
    ]);

    const { container } = render(<Stub initialEntries={["/shopping-list"]} />);

    expect(await screen.findByText("apples")).toBeInTheDocument();
    expect(screen.getAllByTestId("shopping-list-motion-item")).toHaveLength(2);
    for (const listItem of screen.getAllByTestId("shopping-list-motion-item")) {
      expect(listItem).toHaveAttribute("data-layout", "position");
    }
    expect(container.querySelectorAll('[data-ouro="swipe-actions"]')).toHaveLength(2);
    const applesRow = screen.getByText("apples").closest('[data-ouro="swipe-actions"]');
    const applesCheck = within(applesRow!).getByRole("checkbox", { name: "apples" });
    fireEvent.click(applesCheck);

    await waitFor(() => {
      expect(screen.getAllByRole("checkbox").map((checkbox) => checkbox.getAttribute("aria-label"))).toEqual([
        "apples",
        "bananas",
      ]);
    });
  });
});
