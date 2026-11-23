import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet } from "react-router";
import { createTestRoutesStub } from "../utils";
import ShoppingList from "~/routes/shopping-list";
import { mergeShoppingRows } from "~/domains/pantry-and-shopping";

type Row = { id: string; ingredientRefId: string; quantity: number | null; unit: { name: string } | null; checked: boolean };
const row = (id: string, ingredientRefId: string, quantity: number | null, unit: string | null, checked = false): Row => ({
  id,
  ingredientRefId,
  quantity,
  unit: unit === null ? null : { name: unit },
  checked,
});

describe("mergeShoppingRows", () => {
  it("makes one line of a food's rows whose amounts add up, in the first row's unit", () => {
    const [rice, ...rest] = mergeShoppingRows([row("a", "rice", 1, "cup"), row("b", "lemon", 2, null), row("c", "rice", 100, "ml")]);
    expect(rice.rowIds).toEqual(["a", "c"]);
    expect(rice.id).toBe("a");
    expect(rice.unit).toEqual({ name: "cup" });
    expect(rice.quantity).toBeCloseTo(1 + 100 / 236.5882365);
    expect(rest.map((line) => line.rowIds)).toEqual([["b"]]);
  });

  it("keeps rows apart when their amounts can't be added", () => {
    const lines = mergeShoppingRows([row("a", "rice", 1, "cup"), row("b", "rice", 200, "g"), row("c", "rice", 100, "ml"), row("d", "rice", null, "bag")]);
    expect(lines.map((line) => line.rowIds)).toEqual([["a", "c"], ["b"], ["d"]]);
    expect(lines[1].quantity).toBe(200);
  });

  it("adds up counted rows of one food", () => {
    const [eggs] = mergeShoppingRows([row("a", "egg", 2, null), row("b", "egg", 1, null)]);
    expect(eggs).toMatchObject({ rowIds: ["a", "b"], quantity: 3, unit: null });
  });

  it("checks a line only when all its rows are checked", () => {
    expect(mergeShoppingRows([row("a", "rice", 1, "cup", true), row("b", "rice", 1, "cup")])[0].checked).toBe(false);
    expect(mergeShoppingRows([row("a", "rice", 1, "cup", true), row("b", "rice", 1, "cup", true)])[0].checked).toBe(true);
  });
});

const items = [
  { id: "item-1", ingredientRefId: "ref-rice", quantity: 1, checked: false, unit: { name: "cup" }, ingredientRef: { name: "jasmine rice" }, categoryKey: "pantry", iconKey: null },
  { id: "item-2", ingredientRefId: "ref-rice", quantity: 100, checked: false, unit: { name: "ml" }, ingredientRef: { name: "jasmine rice" }, categoryKey: "pantry", iconKey: null },
];

function renderList(flags: string[], submissions: FormData[] = []) {
  const Stub = createTestRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ flags }),
      Component: Outlet,
      children: [
        {
          path: "shopping-list",
          Component: ShoppingList,
          loader: () => ({ shoppingList: { id: "list-1", items }, recipes: [], unitSystem: "metric" }),
          action: async ({ request }: { request: Request }) => {
            submissions.push(await request.formData());
            return { success: true };
          },
        },
      ],
    },
  ]);
  return render(<Stub initialEntries={["/shopping-list"]} />);
}

afterEach(cleanup);

describe("shopping list merging across units", () => {
  it("shows a food added in two units as one line in the cook's units", async () => {
    renderList(["shopping-merge-units"]);
    const rice = await screen.findAllByRole("checkbox", { name: "jasmine rice" });
    expect(rice).toHaveLength(1);
    expect(rice[0]).toHaveAccessibleDescription(/335 ml$/);
  });

  it("keeps the rows apart while merging is off", async () => {
    renderList([]);
    expect(await screen.findAllByRole("checkbox", { name: "jasmine rice" })).toHaveLength(2);
  });

  it("checks every row of a merged line", async () => {
    const submissions: FormData[] = [];
    const user = userEvent.setup();
    renderList(["shopping-merge-units"], submissions);
    await user.click(await screen.findByRole("checkbox", { name: "jasmine rice" }));
    await waitFor(() => expect(submissions).toHaveLength(2));
    expect(submissions.map((form) => [form.get("intent"), form.get("itemId"), form.get("nextChecked")])).toEqual([
      ["toggleCheck", "item-1", "true"],
      ["toggleCheck", "item-2", "true"],
    ]);
  });

  it("removes every row of a merged line", async () => {
    const submissions: FormData[] = [];
    const user = userEvent.setup();
    renderList(["shopping-merge-units"], submissions);
    await screen.findByRole("checkbox", { name: "jasmine rice" });
    const line = document.querySelector<HTMLElement>('[data-shopping-item="item-1"]')!;
    await user.click(within(line).getByRole("button", { name: /actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete jasmine rice" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(submissions).toHaveLength(2));
    expect(submissions.map((form) => [form.get("intent"), form.get("itemId")])).toEqual([
      ["removeItem", "item-1"],
      ["removeItem", "item-2"],
    ]);
  });
});
