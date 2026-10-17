import { afterEach, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { act } from "~/lib/ouro/testing/act";
import { rotate } from "~/lib/ouro/testing/rotate";
import { shoppingRemovalFixture } from "./shopping-removal-fixture";
import type { ShoppingGesture } from "./native-shopping-input";

vi.mock("~/lib/shopping-list.server", () => ({
  loadShoppingList: () => { throw new Error("Browser fixture must use its real Router loader"); },
  handleShoppingListAction: () => { throw new Error("Browser fixture must use its real Router action"); },
}));

let fixture: Awaited<ReturnType<typeof shoppingRemovalFixture>> | undefined;
afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
  scrollTo(0, 0);
  await commands.emulateMedia({ reducedMotion: "no-preference" });
  await rotate(390, 844);
});
const checkbox = () => document.querySelector<HTMLElement>('[role="checkbox"][aria-label="lemons"]')!;
const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const track = () => fixture!.row().querySelector<HTMLElement>("[data-ouro-swipe-actions-track]")!;
async function mount(direction: "ltr" | "rtl" = "ltr") {
  await rotate(390, 844);
  fixture = await shoppingRemovalFixture(direction);
  await expect.poll(() => fixture!.row()).toBeTruthy();
  fixture.row().scrollIntoView({ block: "center" });
}
async function gesture(points: ShoppingGesture["points"], cancel = false) {
  let observed!: Awaited<ReturnType<typeof commands.nativeShoppingInput>>;
  await act(async () => { observed = await commands.nativeShoppingInput({
    selector: '[data-shopping-item="proof-1"]', gestures: [{ points, cancel }],
  }); });
  expect(observed).toHaveLength(1);
  expect(observed[0]!.events.every((event) => event.isTrusted)).toBe(true);
  expect(observed[0]!.events.some((event) => event.type === "pointerdown" && event.pointerType === "touch")).toBe(true);
  expect(observed[0]!.events.some((event) => event.type === (cancel ? "touchcancel" : "touchend"))).toBe(true);
  if (cancel) expect(observed[0]!.events.some((event) => event.type === "pointercancel")).toBe(true);
  return observed[0]!;
}
async function cancelAndReturn() {
  await expect.poll(() => dialog()).toBeTruthy();
  await expect.poll(() => document.activeElement?.textContent).toBe("Cancel");
  await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
  await expect.poll(() => dialog()).toBeNull();
  await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Actions for lemons");
  expect(fixture!.writes).toEqual([]);
  expect(checkbox().getAttribute("aria-checked")).toBe("false");
}

for (const duration of [100, 600]) it(`a real ${duration}ms full swipe opens one confirmation, never a checkbox/write; repeated confirm writes once`, async ({ annotate }) => {
  await mount();
  const native = await gesture([[.92, .5, 0], [.8, .5, duration / 4], [.55, .5, duration / 2], [.15, .5, duration]]);
  await expect.poll(() => dialog()).toBeTruthy();
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  expect(fixture!.writes).toEqual([]);
  expect(checkbox().getAttribute("aria-checked")).toBe("false");
  expect(fixture!.router.state.location.pathname).toBe("/shopping-list");
  await cancelAndReturn();
  await gesture([[.92, .5, 0], [.8, .5, 25], [.55, .5, 50], [.15, .5, 100]]);
  await expect.poll(() => dialog()).toBeTruthy();
  await userEvent.dblClick(page.getByRole("button", { name: "Remove", exact: true }));
  await expect.poll(() => fixture!.writes).toEqual([{ intent: "removeItem", itemId: "proof-1" }]);
  await expect.poll(() => fixture!.host.querySelector('[role="checkbox"]')).toBeNull();
  await expect.poll(() => document.activeElement?.getAttribute("tabindex")).toBe("-1");
  await act(async () => fixture!.router.revalidate());
  expect(fixture!.host.querySelector('[role="checkbox"]')).toBeNull();
  await annotate(`T21_NATIVE_FULL ${JSON.stringify({ duration, native, writes: fixture!.writes, pathname: fixture!.router.state.location.pathname })}`);
});

it("short fast reveal then row tap cancels rather than toggles; the other direction does not act", async ({ annotate }) => {
  await mount();
  await gesture([[.8, .5, 0], [.74, .5, 20], [.67, .5, 50]]);
  await expect.poll(() => fixture!.row().querySelector('[data-ouro="swipe-actions"]')?.getAttribute("data-open")).toBe("trailing");
  expect(dialog()).toBeNull();
  // Tap the actually visible row content. A locator click on the translated-offscreen
  // checkbox may auto-scroll it into view, which legitimately closes a swipe first.
  const native = await gesture([[.45, .5, 0], [.45, .5, 1]]);
  await annotate(`T21_NATIVE_ROW_TAP ${JSON.stringify(native)}`);
  expect(native.openBefore).toBe("trailing");
  await expect.poll(() => fixture!.row().querySelector('[data-ouro="swipe-actions"]')?.hasAttribute("data-open")).toBe(false);
  expect(fixture!.writes).toEqual([]);
  await gesture([[.15, .5, 0], [.3, .5, 100], [.8, .5, 600]]);
  await expect.poll(() => fixture!.row().querySelector('[data-ouro="swipe-actions"]')?.hasAttribute("data-ouro-settling")).toBe(false);
  expect(dialog()).toBeNull();
  expect(fixture!.writes).toEqual([]);
});

it("the actually revealed action shares confirmation, cancellation focus and the exact-once remove payload", async () => {
  await mount();
  const reveal = async () => {
    await gesture([[.8, .5, 0], [.74, .5, 20], [.67, .5, 50]]);
    await expect.poll(() => fixture!.row().querySelector('[data-ouro="swipe-actions"]')?.getAttribute("data-open")).toBe("trailing");
    await expect.poll(() => fixture!.row().querySelector('[data-ouro="swipe-actions"]')?.hasAttribute("data-ouro-settling")).toBe(false);
    await act(async () => commands.tap('[data-shopping-item="proof-1"] [data-ouro-swipe-actions-side="trailing"] button'));
  };
  await reveal();
  await cancelAndReturn();
  await reveal();
  await expect.poll(() => dialog()).toBeTruthy();
  expect(fixture!.writes).toEqual([]);
  await userEvent.click(page.getByRole("button", { name: "Remove", exact: true }));
  await expect.poll(() => fixture!.writes).toEqual([{ intent: "removeItem", itemId: "proof-1" }]);
  expect(fixture!.router.state.location.pathname).toBe("/shopping-list");
});

it("native release reversal and native touchCancel cannot invoke destructive confirmation", async () => {
  await mount();
  await gesture([[.92, .5, 0], [.7, .5, 25], [.15, .5, 100], [.12, .5, 400], [.3, .5, 420], [.4, .5, 440]]);
  await expect.poll(() => fixture!.row().querySelector('[data-ouro="swipe-actions"]')?.hasAttribute("data-ouro-settling")).toBe(false);
  expect(dialog()).toBeNull();
  expect(fixture!.writes).toEqual([]);
  await gesture([[.92, .5, 0], [.7, .5, 25], [.15, .5, 100]], true);
  await expect.poll(() => fixture!.row().querySelector('[data-ouro="swipe-actions"]')?.hasAttribute("data-ouro-settling")).toBe(false);
  expect(dialog()).toBeNull();
  expect(fixture!.writes).toEqual([]);
});

it("vertical native input scrolls the real page and cancels the row recognizer", async ({ annotate }) => {
  await mount();
  const before = scrollY;
  // The fixture must actually have forward scroll room; test-only Tailwind
  // utilities are not compiled by this app's app/stories-only source scanner.
  expect(document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight).toBeGreaterThan(before);
  const box = await commands.shoppingInputBounds('[data-shopping-item="proof-1"] [data-ouro="swipe-actions"]');
  await annotate(`T21_NATIVE_SCROLL_BEFORE ${JSON.stringify({ before, box })}`);
  // Observe the actual target and delivery too, not just the driver's protocol
  // ACK. The compositor-paced path uses native time, never a product clock.
  let native!: Awaited<ReturnType<typeof commands.nativeShoppingInput>>;
  await act(async () => { native = await commands.nativeShoppingInput({
    selector: '[data-shopping-item="proof-1"] [data-ouro="swipe-actions"]',
    gestures: [{
      sequential: true,
      points: Array.from({ length: 13 }, (_, step) => [
        .5 + (12 / box.width) * step / 12,
        .5 - (160 / box.height) * step / 12, 0,
      ] as const),
    }],
  }); });
  await annotate(`T21_NATIVE_SCROLL ${JSON.stringify({
    before, after: scrollY, box, native,
    afterBounds: await commands.shoppingInputBounds('[data-shopping-item="proof-1"] [data-ouro="swipe-actions"]'),
  })}`);
  expect(native[0]!.events.some((event) => event.type === "pointerdown" && event.isTrusted && event.targetInRow)).toBe(true);
  await expect.poll(() => scrollY).toBeGreaterThan(before);
  expect(dialog()).toBeNull();
  expect(fixture!.writes).toEqual([]);
});

it("reading-direction RTL and reduced motion preserve the same confirmation/cancel contract", async () => {
  await mount("rtl");
  await commands.emulateMedia({ reducedMotion: "reduce" });
  await gesture([[.08, .5, 0], [.25, .5, 25], [.85, .5, 100]]);
  await cancelAndReturn();
  expect(getComputedStyle(fixture!.row()).direction).toBe("rtl");
});

it("a real second gesture interrupts a settling reveal without toggling or invoking an action", async ({ annotate }) => {
  await mount();
  let observed!: Awaited<ReturnType<typeof commands.nativeShoppingInput>>;
  await act(async () => { observed = await commands.nativeShoppingInput({
    selector: '[data-shopping-item="proof-1"]',
    gestures: [
      { points: [[.8, .5, 0], [.65, .5, 50], [.5, .5, 100]] },
      { points: [[.45, .5, 0], [.6, .5, 30], [.8, .5, 60]] },
    ],
  }); });
  await annotate(`T21_NATIVE_INTERRUPTION ${JSON.stringify(observed)}`);
  expect(observed).toHaveLength(2);
  for (const observation of observed) {
    expect(observation.events.every((event) => event.isTrusted)).toBe(true);
    expect(observation.events.some((event) => event.type === "pointerdown" && event.pointerType === "touch" && event.targetInRow)).toBe(true);
    expect(observation.events.some((event) => event.type === "touchend")).toBe(true);
  }
  expect(observed[0]!.settlingAfter).toBe(true);
  expect(observed[1]!.settlingBefore).toBe(true);
  expect(observed[0]!.events.find((event) => event.type === "touchend")?.settling).toBe(true);
  expect(observed[1]!.events.find((event) => event.type === "pointerdown")?.settling).toBe(true);
  await expect.poll(() => fixture!.row().querySelector('[data-ouro="swipe-actions"]')?.hasAttribute("data-ouro-settling")).toBe(false);
  expect(new DOMMatrix(getComputedStyle(track()).transform).m41).toBe(0);
  expect(checkbox().getAttribute("aria-checked")).toBe("false");
  expect(dialog()).toBeNull();
  expect(fixture!.writes).toEqual([]);
});
