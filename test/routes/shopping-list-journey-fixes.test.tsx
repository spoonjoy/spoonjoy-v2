// Shopping list fixes proven while writing the shopping list journey (milestone 3, task 3):
// the Item field clears after a successful add (R-M3-3, ui-map bug 10), rapid taps on
// different rows never undo each other (ui-map bug 11), and the dock's "Add" (a link to
// /shopping-list#add-item) focuses the Item field, not only scrolls to it.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { Link } from "react-router";
import { createTestRoutesStub } from "../utils";

vi.mock("framer-motion", () => {
  const MotionDiv = ({
    children,
    onDragEnd: _onDragEnd,
    animate: _animate,
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
    [key: string]: unknown;
  }) => <div {...props}>{children}</div>;

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    LayoutGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: { div: MotionDiv },
  };
});

import ShoppingList, { pendingShoppingItemChanges } from "~/routes/shopping-list";

type ServerItem = {
  id: string;
  quantity: number;
  checked: boolean;
  deleted: boolean;
  unit: { name: string } | null;
  ingredientRef: { name: string };
  categoryKey: string;
  iconKey: string;
};

function serverItem(id: string, name: string): ServerItem {
  return {
    id,
    quantity: 1,
    checked: false,
    deleted: false,
    unit: { name: "whole" },
    ingredientRef: { name },
    categoryKey: "produce",
    iconKey: "apple",
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// A stand-in for the shopping list's server: the loader reads the current rows, and the action
// applies toggleCheck / removeItem after `delayFor(itemId)` — unless the browser aborted the
// request first, in which case the write never happens (the request never reached the server).
function shoppingListServer(items: ServerItem[], delayFor: (itemId: string) => Promise<void>) {
  const state = { items, loaderCalls: 0, writes: [] as string[] };
  const loader = () => {
    state.loaderCalls += 1;
    return {
      shoppingList: {
        id: "list-1",
        items: state.items.filter((item) => !item.deleted).map((item) => ({ ...item })),
      },
      recipes: [],
    };
  };
  const action = async ({ request }: { request: Request }) => {
    const formData = await request.formData();
    const intent = String(formData.get("intent"));
    const itemId = String(formData.get("itemId"));
    await delayFor(itemId);
    if (request.signal.aborted) return { success: false };
    const item = state.items.find((candidate) => candidate.id === itemId)!;
    if (intent === "toggleCheck") item.checked = formData.get("nextChecked") === "true";
    if (intent === "removeItem") item.deleted = true;
    state.writes.push(`${intent}:${itemId}`);
    return { success: true };
  };
  return { state, loader, action };
}

function checkbox(name: string) {
  return screen.getByRole("checkbox", { name });
}

describe("shopping list: the Item field clears after a successful add (R-M3-3, bug 10)", () => {
  it("clears the typed item once the add succeeds, so a second Add can't add it again", async () => {
    const submitted: string[] = [];
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({ shoppingList: { id: "list-1", items: [] }, recipes: [] }),
        action: async ({ request }) => {
          const formData = await request.formData();
          submitted.push(String(formData.get("ingredientText")));
          return { success: true, intent: "addItem" };
        },
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    const field = await screen.findByLabelText("Item");
    fireEvent.change(field, { target: { value: "2 lemons" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(submitted).toEqual(["2 lemons"]));
    await waitFor(() => expect(field).toHaveValue(""));
  });

  it("keeps the text for review after an ambiguous add, then clears it once the reviewed item is added", async () => {
    let calls = 0;
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({ shoppingList: { id: "list-1", items: [] }, recipes: [] }),
        action: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              errors: { parse: "Couldn't confidently parse one item. Review and correct before adding." },
              parseDraft: { quantity: "", unitName: "", ingredientName: "salt", isAmbiguous: true, originalText: "salt" },
            };
          }
          return { success: true, intent: "addItem" };
        },
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    const field = await screen.findByLabelText("Item");
    fireEvent.change(field, { target: { value: "salt" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Couldn't confidently parse one item. Review and correct before adding.")).toBeInTheDocument();
    expect(field).toHaveValue("salt");
    // (Quantity stays empty: happy-dom misjudges "1" against the field's step="0.01".)
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "pinch" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(calls).toBe(2));
    await waitFor(() => expect(screen.queryByLabelText("Quantity")).not.toBeInTheDocument());
    expect(field).toHaveValue("");
  });

  it("leaves a half-typed item alone when another form on the page succeeds", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({ shoppingList: { id: "list-1", items: [] }, recipes: [{ id: "recipe-1", title: "Soup" }] }),
        action: async () => ({ success: true }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    const field = await screen.findByLabelText("Item");
    fireEvent.change(field, { target: { value: "3 carrots" } });
    fireEvent.change(screen.getByLabelText("Recipe"), { target: { value: "recipe-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add ingredients" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Add ingredients" })).toBeEnabled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(field).toHaveValue("3 carrots");
  });
});

describe("shopping list: rapid taps on different rows never undo each other (bug 11)", () => {
  it("checks two rows tapped back to back, on the server and on screen", async () => {
    const server = shoppingListServer(
      [serverItem("item-1", "apples"), serverItem("item-2", "bananas")],
      () => new Promise((resolve) => setTimeout(resolve, 10)),
    );
    const Stub = createTestRoutesStub([
      { path: "/shopping-list", Component: ShoppingList, loader: server.loader, action: server.action },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    await screen.findByText("apples");
    fireEvent.click(checkbox("apples"));
    fireEvent.click(checkbox("bananas"));

    await waitFor(() => expect(server.state.writes).toHaveLength(2));
    expect(server.state.items.map((item) => item.checked)).toEqual([true, true]);
    await waitFor(() => expect(checkbox("apples")).toHaveAttribute("aria-checked", "true"));
    expect(checkbox("bananas")).toHaveAttribute("aria-checked", "true");
  });

  it("keeps a row checked while its own request is still in flight, even after another row's reload lands", async () => {
    const bananasGate = deferred();
    const server = shoppingListServer(
      [serverItem("item-1", "apples"), serverItem("item-2", "bananas")],
      (itemId) => (itemId === "item-2" ? bananasGate.promise : Promise.resolve()),
    );
    const Stub = createTestRoutesStub([
      { path: "/shopping-list", Component: ShoppingList, loader: server.loader, action: server.action },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    await screen.findByText("apples");
    const loaderCallsBefore = server.state.loaderCalls;
    fireEvent.click(checkbox("bananas"));
    fireEvent.click(checkbox("apples"));

    // Apples' write and the reload after it land while bananas' request is still open. That
    // reload says bananas is unchecked; the screen must keep showing the tap.
    await waitFor(() => expect(server.state.writes).toEqual(["toggleCheck:item-1"]));
    await waitFor(() => expect(server.state.loaderCalls).toBeGreaterThan(loaderCallsBefore));
    await waitFor(() => expect(checkbox("apples")).toHaveAttribute("aria-checked", "true"));
    expect(checkbox("bananas")).toHaveAttribute("aria-checked", "true");

    await act(async () => {
      bananasGate.resolve();
    });
    await waitFor(() => expect(server.state.writes).toEqual(["toggleCheck:item-1", "toggleCheck:item-2"]));
    await waitFor(() => expect(checkbox("bananas")).toHaveAttribute("aria-checked", "true"));
    expect(checkbox("apples")).toHaveAttribute("aria-checked", "true");
  });

  it("removes two rows tapped back to back, on the server and on screen", async () => {
    const server = shoppingListServer(
      [serverItem("item-1", "apples"), serverItem("item-2", "bananas")],
      () => new Promise((resolve) => setTimeout(resolve, 10)),
    );
    const Stub = createTestRoutesStub([
      { path: "/shopping-list", Component: ShoppingList, loader: server.loader, action: server.action },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    await screen.findByText("apples");
    fireEvent.click(screen.getByRole("button", { name: "Remove apples" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove bananas" }));

    await waitFor(() => expect(server.state.writes).toHaveLength(2));
    expect(server.state.items.map((item) => item.deleted)).toEqual([true, true]);
    await waitFor(() => expect(screen.getByText("Your shopping list is empty")).toBeInTheDocument());
    expect(screen.queryByText("apples")).not.toBeInTheDocument();
  });

  it("reads pending checks and removals from in-flight row requests only", () => {
    const form = (fields: Record<string, string>) => {
      const formData = new FormData();
      for (const [key, value] of Object.entries(fields)) formData.append(key, value);
      return formData;
    };

    expect(
      pendingShoppingItemChanges([
        { key: "shopping-item-toggle-idle", formData: undefined },
        { key: "shopping-item-toggle-a", formData: form({ intent: "toggleCheck", itemId: "a", nextChecked: "true" }) },
        { key: "shopping-item-toggle-b", formData: form({ intent: "toggleCheck", itemId: "b", nextChecked: "false" }) },
        { key: "shopping-item-remove-c", formData: form({ intent: "removeItem", itemId: "c" }) },
        { key: "shopping-item-toggle-none", formData: form({ intent: "toggleCheck" }) },
        { key: "shopping-item-other-d", formData: form({ intent: "addFromRecipe", itemId: "d" }) },
        { key: "some-other-fetcher", formData: form({ intent: "toggleCheck", itemId: "e", nextChecked: "true" }) },
      ]),
    ).toEqual({ checkedById: { a: true, b: false }, removedById: { c: true } });
  });
});

describe("shopping list: the dock's Add focuses the Item field", () => {
  function DockAdd() {
    return <Link to="/shopping-list#add-item">Dock Add</Link>;
  }

  function PageWithDock() {
    return (
      <>
        <ShoppingList />
        <DockAdd />
      </>
    );
  }

  it("focuses the Item field when the page is opened at #add-item", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({ shoppingList: { id: "list-1", items: [] }, recipes: [] }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list#add-item"]} />);

    await waitFor(() => expect(screen.getByLabelText("Item")).toHaveFocus());
  });

  it("focuses the Item field each time the dock's Add link is followed, and not before", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: PageWithDock,
        loader: () => ({ shoppingList: { id: "list-1", items: [] }, recipes: [] }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    const field = await screen.findByLabelText("Item");
    expect(field).not.toHaveFocus();

    fireEvent.click(screen.getByRole("link", { name: "Dock Add" }));
    await waitFor(() => expect(field).toHaveFocus());

    act(() => field.blur());
    expect(field).not.toHaveFocus();
    fireEvent.click(screen.getByRole("link", { name: "Dock Add" }));
    await waitFor(() => expect(field).toHaveFocus());
  });
});
