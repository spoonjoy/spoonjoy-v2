import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { createTestRoutesStub } from "../utils";

vi.mock("framer-motion", () => {
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
    motion: { div: MotionDiv },
  };
});

import ShoppingList, {
  getShoppingSectionLabel,
  orderShoppingItemsForMarket,
  resolveSwipeAction,
  shouldDeleteOnSwipe,
} from "~/routes/shopping-list";

function swipeRow(row: Element, offsetX: number) {
  row.setAttribute("data-drag-offset-x", String(offsetX));
  fireEvent.pointerUp(row);
}

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

  it("orders the market list by aisle while keeping checked items at the bottom", () => {
    const ordered = orderShoppingItemsForMarket([
      { id: "checked-produce", checked: true, categoryLabel: "Produce" },
      { id: "pantry", checked: false, categoryLabel: "Pantry" },
      { id: "mystery", checked: false, categoryLabel: "Mystery" },
      { id: "produce", checked: false, categoryLabel: "Produce" },
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      "produce",
      "pantry",
      "mystery",
      "checked-produce",
    ]);
  });

  it("labels checked items as one basket section in all view", () => {
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
    )).toBe("In basket");
    expect(getShoppingSectionLabel(
      { checked: true, categoryLabel: "Dairy" },
      { checked: true, categoryLabel: "Produce" },
      "all"
    )).toBeNull();
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
      "In basket",
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

  it("resolves swipe actions for reveal, confirm, dismiss, and no-op states", () => {
    expect(resolveSwipeAction(-80, false)).toBe("reveal");
    expect(resolveSwipeAction(-120, true)).toBe("confirmDelete");
    expect(resolveSwipeAction(40, true)).toBe("dismiss");
    expect(resolveSwipeAction(-30, false)).toBe("none");
    expect(shouldDeleteOnSwipe(-120, true)).toBe(true);
    expect(shouldDeleteOnSwipe(-120, false)).toBe(false);
    expect(shouldDeleteOnSwipe(-120)).toBe(false);
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

    fireEvent.change(await screen.findByLabelText("Item"), { target: { value: "2 apples" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Review the parsed item before adding.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("whole")).toBeInTheDocument();
    expect(screen.getByDisplayValue("apples")).toBeInTheDocument();
  });

  it("requires two actions to delete and allows row-tap or right-swipe cancel", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => singleItemData,
        action: async () => ({ success: true }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    const itemLabel = await screen.findByText("chicken thigh");
    const row = itemLabel.closest("[data-motion-x]");
    expect(row).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove chicken thigh" })).toBeInTheDocument();

    swipeRow(row!, -80);
    await waitFor(() => expect(row).toHaveAttribute("data-motion-x", "-104"));
    expect(screen.getByRole("button", { name: "Delete chicken thigh" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "chicken thigh" })).toBeInTheDocument();

    swipeRow(row!, -30);
    await waitFor(() => expect(row).toHaveAttribute("data-motion-x", "-104"));

    fireEvent.click(screen.getByRole("checkbox", { name: "chicken thigh" }));
    await waitFor(() => expect(row).toHaveAttribute("data-motion-x", "0"));
    expect(screen.getByRole("checkbox", { name: "chicken thigh" })).toBeInTheDocument();

    swipeRow(row!, -80);
    await waitFor(() => expect(row).toHaveAttribute("data-motion-x", "-104"));
    swipeRow(row!, 40);
    await waitFor(() => expect(row).toHaveAttribute("data-motion-x", "0"));

    swipeRow(row!, -80);
    await waitFor(() => expect(row).toHaveAttribute("data-motion-x", "-104"));
    swipeRow(row!, -120);
    await waitFor(() => {
      expect(screen.queryByText("chicken thigh")).not.toBeInTheDocument();
    });
  });

  it("deletes a revealed row when the delete button is clicked", async () => {
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

    const itemLabel = await screen.findByText("chicken thigh");
    const row = itemLabel.closest("[data-motion-x]");
    expect(row).toBeInTheDocument();

    swipeRow(row!, -80);
    await waitFor(() => expect(row).toHaveAttribute("data-motion-x", "-104"));
    fireEvent.click(screen.getByRole("button", { name: "Delete chicken thigh" }));

    await waitFor(() => {
      expect(screen.queryByText("chicken thigh")).not.toBeInTheDocument();
    });
  });

  it("deletes a row when the accessible remove button is clicked", async () => {
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

    expect(await screen.findByText("chicken thigh")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove chicken thigh" }));

    await waitFor(() => {
      expect(screen.queryByText("chicken thigh")).not.toBeInTheDocument();
    });
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

    fireEvent.change(await screen.findByLabelText("Recipe"), { target: { value: "recipe-1" } });
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

  it("uses ruled receipt rows and closes all reveals when check-off reorders rows", async () => {
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
    const seamContainer = container.querySelector(".relative.overflow-hidden");
    const rowShell = container.querySelector(".relative.z-10.bg-\\[var\\(--sj-page\\)\\]");
    expect(seamContainer).toBeInTheDocument();
    expect(rowShell).toBeInTheDocument();

    const bananasLabel = await screen.findByText("bananas");
    const bananasRow = bananasLabel.closest("[data-motion-x]");
    expect(bananasRow).toBeInTheDocument();

    swipeRow(bananasRow!, -80);
    await waitFor(() => expect(bananasRow).toHaveAttribute("data-motion-x", "-104"));

    const applesRow = screen.getByText("apples").closest("[data-motion-x]");
    const applesCheck = within(applesRow!).getByRole("checkbox", { name: "apples" });
    fireEvent.click(applesCheck);

    await waitFor(() => {
      expect(screen.getAllByRole("checkbox").map((checkbox) => checkbox.getAttribute("aria-label"))).toEqual([
        "bananas",
        "apples",
      ]);
    });
    await waitFor(() => expect(bananasRow).toHaveAttribute("data-motion-x", "0"));
  });
});
