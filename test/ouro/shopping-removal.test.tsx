import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { shoppingRemovalFixture } from "./shopping-removal-fixture";

vi.mock("~/lib/shopping-list.server", () => ({
  loadShoppingList: () => { throw new Error("Browser fixture owns the Router loader"); },
  handleShoppingListAction: () => { throw new Error("Browser fixture owns the Router action"); },
}));
let fixture: Awaited<ReturnType<typeof shoppingRemovalFixture>> | undefined;
afterEach(async () => { await fixture?.dispose(); fixture = undefined; });

it("real menu-to-modal focus, Escape, retained Remove and explicit confirmation preserve the actual row contract", async ({ annotate }) => {
  fixture = await shoppingRemovalFixture();
  await expect.poll(() => fixture!.row()).toBeTruthy();
  await userEvent.click(page.getByRole("button", { name: "Actions for lemons" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Delete lemons" }));
  await expect.poll(() => document.querySelector('[role="alertdialog"]')).toBeTruthy();
  await expect.poll(() => document.activeElement?.textContent).toBe("Cancel");
  expect(fixture.writes).toEqual([]);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.querySelector('[role="alertdialog"]')).toBeNull();
  await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Actions for lemons");
  expect(fixture.writes).toEqual([]);
  fixture.host.querySelector<HTMLButtonElement>('[aria-label="Remove lemons"]')!.focus();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => document.querySelector('[role="alertdialog"]')).toBeTruthy();
  expect(fixture.writes).toEqual([]);
  await userEvent.click(page.getByRole("button", { name: "Remove", exact: true }));
  await expect.poll(() => fixture!.writes).toEqual([{ intent: "removeItem", itemId: "proof-1" }]);
  await expect.poll(() => document.activeElement?.tagName).toBe("H1");
  expect(fixture.router.state.location.pathname).toBe("/shopping-list");
  await annotate(`T21_KEYBOARD_CONFIRM ${JSON.stringify({ writes: fixture.writes, focused: document.activeElement?.tagName })}`);
});
