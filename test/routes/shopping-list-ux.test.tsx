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
    layout: _layout,
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
    [key: string]: unknown;
  }) => (
    <div
      {...props}
      data-motion-x={String(animate?.x ?? 0)}
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
    motion: { div: MotionDiv },
  };
});

import ShoppingList, {
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

    swipeRow(row!, -80);
    await waitFor(() => expect(row).toHaveAttribute("data-motion-x", "-104"));
    expect(screen.getByRole("button", { name: "Delete chicken thigh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check item" })).toBeInTheDocument();

    swipeRow(row!, -30);
    await waitFor(() => expect(row).toHaveAttribute("data-motion-x", "-104"));

    fireEvent.click(screen.getByRole("button", { name: "Check item" }));
    await waitFor(() => expect(row).toHaveAttribute("data-motion-x", "0"));
    expect(screen.getByRole("button", { name: "Check item" })).toBeInTheDocument();

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
    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear it all" }));

    await waitFor(() => expect(submittedIntents).toContain("clearAll"));
  });

  it("uses straight seam classes and closes all reveals when check-off reorders rows", async () => {
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
    const seamContainer = container.querySelector(".relative.overflow-hidden.rounded-lg.border");
    const rowShell = container.querySelector(".relative.z-10.px-3.py-2");
    expect(seamContainer).toBeInTheDocument();
    expect(rowShell?.className).not.toContain("rounded");

    const bananasLabel = await screen.findByText("bananas");
    const bananasRow = bananasLabel.closest("[data-motion-x]");
    expect(bananasRow).toBeInTheDocument();

    swipeRow(bananasRow!, -80);
    await waitFor(() => expect(bananasRow).toHaveAttribute("data-motion-x", "-104"));

    const applesRow = screen.getByText("apples").closest("[data-motion-x]");
    const applesCheck = within(applesRow!).getByRole("button", { name: "Check item" });
    fireEvent.click(applesCheck);

    await waitFor(() => expect(bananasRow).toHaveAttribute("data-motion-x", "0"));
  });
});
