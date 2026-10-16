import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { shoppingRemovalFixture } from "./shopping-removal-fixture";

vi.mock("~/lib/shopping-list.server", () => ({
  loadShoppingList: () => { throw new Error("Browser fixture owns the Router loader"); },
  handleShoppingListAction: () => { throw new Error("Browser fixture owns the Router action"); },
}));
let fixture: Awaited<ReturnType<typeof shoppingRemovalFixture>> | undefined;
const focusTrace: unknown[] = [];
const recordTrace = (entry: unknown) => {
  focusTrace.push(entry);
  if (focusTrace.length > 200) focusTrace.shift();
};
const describe = (element: Element | null) => element && ({
  tag: element.tagName, role: element.getAttribute("role"), text: element.textContent?.slice(0, 100),
  label: element.getAttribute("aria-label"), connected: element.isConnected,
  attributes: Object.fromEntries(Array.from(element.attributes).filter(({ name }) =>
    name.startsWith("data-") || name.startsWith("aria-") || name === "inert").map(({ name, value }) => [name, value])),
});
const snapshot = () => ({
  focused: describe(document.activeElement),
  dialogs: Array.from(document.querySelectorAll('[role="alertdialog"]')).map(describe),
  menus: Array.from(document.querySelectorAll('[role="menu"], [role="menuitem"]')).map(describe),
});
const trace = (event: Event) => {
  recordTrace({
    when: performance.now(), type: event.type, key: event instanceof KeyboardEvent ? event.key : undefined,
    trusted: event.isTrusted, target: describe(event.target instanceof Element ? event.target : null),
    ...snapshot(),
  });
  queueMicrotask(() => recordTrace({
    when: performance.now(), after: event.type, prevented: event.defaultPrevented, ...snapshot(),
  }));
};
beforeEach(() => {
  focusTrace.length = 0;
  for (const type of ["keydown", "keyup", "click", "focusin", "focusout"]) document.addEventListener(type, trace, true);
});

it("diagnostic repeated real keyboard menu-to-confirm cancellation preserves focus and performs no mutation", async ({ annotate }) => {
  fixture = await shoppingRemovalFixture();
  let cycle = 0;
  try {
    await expect.poll(() => fixture!.row()).toBeTruthy();
    fixture.host.querySelector<HTMLButtonElement>('[aria-label="Actions for lemons"]')!.focus();
    for (; cycle < 40; cycle++) {
      recordTrace({ cycle, type: "cycle-start", when: performance.now() });
      await userEvent.keyboard("{Enter}");
      await expect.poll(() => document.activeElement?.getAttribute("role")).toBe("menuitem");
      expect(document.activeElement?.textContent).toBe("Delete lemons");
      await userEvent.keyboard("{Enter}");
      await expect.poll(() => document.querySelector('[role="alertdialog"]')).toBeTruthy();
      await expect.poll(() => document.activeElement?.textContent).toBe("Cancel");
      expect(fixture.writes).toEqual([]);
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => document.querySelector('[role="alertdialog"]')).toBeNull();
      await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Actions for lemons");
      expect(fixture.writes).toEqual([]);
    }
  } finally {
    await annotate(`KEYBOARD_FOCUS_STRESS ${JSON.stringify({ cycle, trace: focusTrace, final: snapshot(), writes: fixture.writes })}`);
  }
}, 60_000);
afterEach(() => {
  for (const type of ["keydown", "keyup", "click", "focusin", "focusout"]) document.removeEventListener(type, trace, true);
});
afterEach(async () => { await fixture?.dispose(); fixture = undefined; });

it("real menu-to-modal focus, Escape, retained Remove and explicit confirmation preserve the actual row contract", async ({ annotate }) => {
  try {
  fixture = await shoppingRemovalFixture();
  await expect.poll(() => fixture!.row()).toBeTruthy();
  await userEvent.click(page.getByRole("button", { name: "Actions for lemons" }));
  await annotate(`T21_MENU_BEFORE ${JSON.stringify({
    focused: { tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute("role") },
    items: Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => ({
      text: item.textContent, box: item.getBoundingClientRect().toJSON(),
      animations: item.getAnimations({ subtree: true }).map((animation) => animation.playState),
    })),
  })}`);
  const clicks: Array<{ trusted: boolean; menuItem: string | null }> = [];
  const recordClick = (event: MouseEvent) => clicks.push({
    trusted: event.isTrusted,
    menuItem: (event.target as Element).closest('[role="menuitem"]')?.textContent ?? null,
  });
  document.addEventListener("click", recordClick, true);
  try {
    await userEvent.click(page.getByRole("menuitem", { name: "Delete lemons" }));
  } finally {
    document.removeEventListener("click", recordClick, true);
  }
  await annotate(`T21_MENU_AFTER ${JSON.stringify({
    dialog: Boolean(document.querySelector('[role="alertdialog"]')),
    focused: { tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute("role") },
    writes: fixture.writes, clicks,
  })}`);
  expect(clicks.some((click) => click.trusted && click.menuItem === "Delete lemons")).toBe(true);
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
  } finally {
    await annotate(`KEYBOARD_FOCUS_DIAGNOSTIC ${JSON.stringify({ trace: focusTrace, final: snapshot(), writes: fixture?.writes })}`);
  }
});

it("native keyboard opens the named action menu and confirms only after explicit activation", async ({ annotate }) => {
  try {
  fixture = await shoppingRemovalFixture();
  await expect.poll(() => fixture!.row()).toBeTruthy();
  fixture.host.querySelector<HTMLButtonElement>('[aria-label="Actions for lemons"]')!.focus();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => document.activeElement?.getAttribute("role")).toBe("menuitem");
  expect(document.activeElement?.textContent).toBe("Delete lemons");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => document.querySelector('[role="alertdialog"]')).toBeTruthy();
  await expect.poll(() => document.activeElement?.textContent).toBe("Cancel");
  expect(fixture.writes).toEqual([]);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.querySelector('[role="alertdialog"]')).toBeNull();
  await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Actions for lemons");
  expect(fixture.writes).toEqual([]);
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => document.activeElement?.getAttribute("role")).toBe("menuitem");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => document.activeElement?.textContent).toBe("Cancel");
  await userEvent.keyboard("{Tab}{Enter}");
  await expect.poll(() => fixture!.writes).toEqual([{ intent: "removeItem", itemId: "proof-1" }]);
  await expect.poll(() => document.activeElement?.tagName).toBe("H1");
  expect(fixture.router.state.location.pathname).toBe("/shopping-list");
  await annotate(`T21_ALL_KEYBOARD_CONFIRM ${JSON.stringify({ writes: fixture.writes, focused: document.activeElement?.tagName })}`);
  } finally {
    await annotate(`KEYBOARD_FOCUS_DIAGNOSTIC ${JSON.stringify({ trace: focusTrace, final: snapshot(), writes: fixture?.writes })}`);
  }
});
