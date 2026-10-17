import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { SwipeActions } from "~/components/ouro/swipe-actions/swipe-actions";
import { act } from "~/lib/ouro/testing/act";
import { holdFrames } from "~/lib/ouro/testing/frames";
import { rotate } from "~/lib/ouro/testing/rotate";
import { pressTab } from "~/lib/ouro/testing/tab";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
const cleanups: Array<() => void> = [];
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Waits until a swipe's momentum has stopped scrolling the page: two frames agree. */
async function pageAtRest() {
  await expect
    .poll(async () => {
      const before = scrollY;
      await frame();
      await frame();
      return scrollY === before;
    })
    .toBe(true);
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  await commands.touchStep({ type: "touchEnd" });
  await pageAtRest();
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  scrollTo(0, 0);
  history.replaceState(null, "", location.pathname + location.search);
  await commands.emulateMedia({ reducedMotion: "no-preference" });
  await rotate(390, 844);
});

async function mount(node: ReactNode, dir?: "rtl") {
  const host = document.createElement("div");
  if (dir) host.dir = dir;
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

const spies = () => ({ pin: vi.fn(), archive: vi.fn(), remove: vi.fn() });

/** Three recipe rows between two tall blocks, so the page itself can scroll. */
async function renderList(calls = spies(), dir?: "rtl") {
  const host = await mount(
    <div style={{ padding: 16 }}>
      <div style={{ height: 200 }} />
      <ItemGroup label="Recipes">
        {["Shakshuka", "Short ribs", "Lemon tart"].map((name, index) => (
          <SwipeActions
            key={name}
            label={name}
            leading={[{ label: "Pin", tone: "primary", onClick: () => calls.pin(name) }]}
            trailing={[
              { label: "Delete", tone: "destructive", onClick: () => calls.remove(name) },
              { label: "Archive", onClick: () => calls.archive(name) },
            ]}
          >
            <Item href={`#recipe-${index}`} title={name} description="Swipe me" />
          </SwipeActions>
        ))}
      </ItemGroup>
      <div style={{ height: 1600 }} />
    </div>,
    dir,
  );
  const rows = [...host.querySelectorAll<HTMLElement>('[data-ouro="swipe-actions"]')];
  return { host, rows, calls };
}

const track = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-ouro-swipe-actions-track]")!;
const strip = (row: HTMLElement, side: "leading" | "trailing") => row.querySelector<HTMLElement>(`[data-ouro-swipe-actions-side="${side}"]`)!;
const action = (row: HTMLElement, name: string) => [...row.querySelectorAll<HTMLButtonElement>("[data-ouro-swipe-actions-side] button")].find((button) => button.textContent === name)!;
/** How far the row has slid, in px, to a hundredth: negative is toward the left. */
const offset = (row: HTMLElement) => Math.round(new DOMMatrix(getComputedStyle(track(row)).transform).m41 * 100) / 100;
/** A side's width, to a hundredth of a px. */
const stripWidth = (row: HTMLElement, side: "leading" | "trailing") => Math.round(strip(row, side).getBoundingClientRect().width * 100) / 100;

/** Waits for the row to stop moving, then returns its offset. */
async function settled(row: HTMLElement) {
  await expect.poll(() => row.hasAttribute("data-ouro-settling") || track(row).getAnimations({ subtree: true }).length > 0).toBe(false);
  return offset(row);
}

function middle(element: Element): [number, number] {
  const rect = element.getBoundingClientRect();
  return [rect.left + rect.width / 2, rect.top + rect.height / 2];
}

/** A one-finger swipe across the row's middle, by `dx` px, starting from its center. The finger lifts while it is still moving: a flick. */
async function swipe(row: HTMLElement, dx: number, dy = 0) {
  const [x, y] = middle(row);
  // 100ms from touch-down to lift, as the page's timestamps say: a flick, however busy the machine.
  await commands.touchDrag({ from: [x, y], to: [x + dx, y + dy], steps: 10, durationMs: 100 });
}

/** Keeps the finger still until it has no velocity left: longer than the 100ms a release velocity is read over. */
async function restFinger() {
  const since = performance.now();
  await expect.poll(() => performance.now() - since).toBeGreaterThan(150);
}

/**
 * The same swipe, slow enough that the distance decides: 600ms from touch-down to lift, as
 * the page's timestamps say, which is under half the flick speed. Its events are sent all
 * at once. Sent one command at a time, a busy machine could keep the finger within 10px of
 * where it went down for half a second, and that is a long press: the actions menu opened
 * over the row and took the next touches.
 */
async function slowSwipe(row: HTMLElement, dx: number) {
  const [x, y] = middle(row);
  await commands.touchDrag({ from: [x, y], to: [x + dx, y], steps: 10, durationMs: 600 });
  noMenu();
}

/** No long press opened the actions menu: a held finger in these tests always moves on in time. */
function noMenu() {
  expect(document.querySelector('[role="menu"]'), "a long press opened the actions menu").toBeNull();
}

/** Whether a tap at (x, y) lands on `target`. */
const hits = (target: Element, x: number, y: number) => target.contains(document.elementFromPoint(x, y));

describe("SwipeActions on a phone", () => {
  it("lets a vertical swipe that starts on a row scroll the page", async () => {
    const { rows } = await renderList();
    const row = rows[1]!;
    expect(getComputedStyle(row).touchAction).toBe("pan-y");
    let prevented = false;
    let startedOnRow = false;
    const start = (event: PointerEvent) => {
      startedOnRow = event.isTrusted && event.pointerType === "touch" && row.contains(event.target as Node);
    };
    const listener = (event: TouchEvent) => {
      if (event.defaultPrevented) prevented = true;
    };
    addEventListener("pointerdown", start, true);
    addEventListener("touchmove", listener);
    cleanups.push(() => {
      removeEventListener("pointerdown", start, true);
      removeEventListener("touchmove", listener);
    });
    const [x, y] = middle(row);
    // A serial protocol round trip must not turn the start of this swipe into a long press.
    await commands.touchDrag({ from: [x, y], to: [x + 12, y - 200], steps: 12, durationMs: 200 });
    expect(startedOnRow).toBe(true);
    noMenu();
    await expect.poll(() => document.scrollingElement!.scrollTop).toBeGreaterThan(50);
    expect(prevented).toBe(false);
    expect(row.hasAttribute("data-open")).toBe(false);
    expect(offset(row)).toBe(0);
  });

  it("opens the trailing actions with a swipe toward the start, without scrolling the page", async () => {
    const { rows } = await renderList();
    const row = rows[1]!;
    await swipe(row, -120, 20);
    await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
    expect(await settled(row)).toBe(-stripWidth(row, "trailing"));
    expect(scrollY).toBe(0);
    // The primary action is at the outer edge, and both take taps.
    const remove = action(row, "Delete");
    const archive = action(row, "Archive");
    expect(remove.getBoundingClientRect().left).toBeGreaterThan(archive.getBoundingClientRect().left);
    expect(Math.round(remove.getBoundingClientRect().right)).toBe(Math.round(row.getBoundingClientRect().right));
    expect(hits(remove, ...middle(remove)) && hits(archive, ...middle(archive))).toBe(true);
    // The other side stays out of reach.
    expect(strip(row, "leading").inert).toBe(true);
    expect(strip(row, "trailing").inert).toBe(false);
  });

  it("opens the leading actions with a swipe toward the end", async () => {
    const { rows } = await renderList();
    const row = rows[0]!;
    await swipe(row, 90);
    await expect.poll(() => row.getAttribute("data-open")).toBe("leading");
    expect(await settled(row)).toBe(stripWidth(row, "leading"));
    const pin = action(row, "Pin");
    expect(Math.round(pin.getBoundingClientRect().left)).toBe(Math.round(row.getBoundingClientRect().left));
  });

  it("springs back from a slow swipe shorter than half the actions, and opens on a flick just as short", async () => {
    const { rows, calls } = await renderList();
    const row = rows[1]!;
    await slowSwipe(row, -40);
    await act(async () => {});
    expect(row.hasAttribute("data-open")).toBe(false);
    expect(await settled(row)).toBe(0);
    expect(strip(row, "trailing").inert).toBe(true);
    // The same 40px with the finger lifting mid-move: the flick opens the row.
    await swipe(row, -40);
    await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
    expect(await settled(row)).toBe(-stripWidth(row, "trailing"));
    // And a flick back closes it, although it has not come half way back.
    await swipe(row, 40);
    await expect.poll(() => row.hasAttribute("data-open")).toBe(false);
    expect(await settled(row)).toBe(0);
    expect(calls.remove).not.toHaveBeenCalled();
  });

  it("writes the transform on the row's track and springs to rest without a CSS transition", async () => {
    const { rows } = await renderList();
    const row = rows[1]!;
    // The spring's frames are the test's to step, so it is seen at every one of them on any machine.
    const frames = holdFrames();
    cleanups.push(() => frames.release());
    await swipe(row, -100);
    await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
    const seen = [offset(row)];
    while (row.hasAttribute("data-ouro-settling")) {
      frames.step(16);
      seen.push(offset(row));
    }
    frames.release();
    const open = await settled(row);
    expect(open).toBe(-stripWidth(row, "trailing"));
    expect(track(row).style.transform).toMatch(/^translateX\(-[\d.]+px\)$/);
    expect(getComputedStyle(track(row)).transitionDuration).toBe("0s");
    expect(track(row).getAnimations().length).toBe(0);
    // Many frames between the release and rest, the last exactly on the open position.
    expect(seen.length).toBeGreaterThan(12);
    expect(seen.at(-1)).toBe(open);
    // The flick carried the row a little past open before it came back.
    expect(Math.min(...seen)).toBeLessThan(open);
  });

  it("can be caught by a finger while it springs to rest", async () => {
    const { rows } = await renderList();
    const row = rows[1]!;
    const [x, y] = middle(row);
    // Frames stand still, so the row is mid-spring for as long as the second touch takes to arrive.
    const frames = holdFrames();
    cleanups.push(() => frames.release());
    await swipe(row, -100);
    await expect.poll(() => row.hasAttribute("data-ouro-settling")).toBe(true);
    for (let step = 0; step < 3; step++) frames.step(16);
    const flying = offset(row);
    expect(row.hasAttribute("data-ouro-settling")).toBe(true);
    try {
      // Command latency is not a held finger: keep the long-press clock still until movement cancels it.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        await commands.touchStep({ type: "touchStart", x, y });
        for (const dx of [12, 20]) await commands.touchStep({ type: "touchMove", x: x + dx, y });
      } finally {
        vi.useRealTimers();
      }
      noMenu();
      await expect.poll(() => row.hasAttribute("data-dragging")).toBe(true);
      expect(row.hasAttribute("data-ouro-settling")).toBe(false);
      // It was taken from where the spring had it, and moves the finger's 20px from there once the last move arrives.
      await expect.poll(() => Math.abs(offset(row) - (flying + 20))).toBeLessThan(0.05);
      const held = offset(row);
      frames.step(32);
      expect(offset(row)).toBe(held);
      frames.release();
      // And it follows the finger 1:1 from there.
      for (let step = 5; step <= 8; step++) await commands.touchStep({ type: "touchMove", x: x + step * 5, y });
      await expect.poll(() => Math.abs(offset(row) - (held + 20))).toBeLessThan(0.05);
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    await settled(row);
  });

  it("commits the primary action with a full swipe, once, and closes the row", async () => {
    const { rows, calls } = await renderList();
    const row = rows[2]!;
    await swipe(row, -300);
    await expect.poll(() => calls.remove.mock.calls).toEqual([["Lemon tart"]]);
    expect(calls.archive).not.toHaveBeenCalled();
    expect(row.hasAttribute("data-open")).toBe(false);
    expect(await settled(row)).toBe(0);
    // The leading side's primary action, with a full swipe the other way.
    await swipe(row, 300);
    await expect.poll(() => calls.pin.mock.calls).toEqual([["Lemon tart"]]);
    expect(calls.remove).toHaveBeenCalledTimes(1);
  });

  it("follows a held finger, and past the full-swipe point shows only the primary action", async () => {
    const { rows, calls } = await renderList();
    const row = rows[1]!;
    const [x, y] = middle(row);
    try {
      await commands.touchStep({ type: "touchStart", x, y });
      for (let step = 1; step <= 6; step++) await commands.touchStep({ type: "touchMove", x: x - step * 15, y });
      // 90px in: the row is under the finger, with no transition behind it.
      await expect.poll(() => offset(row)).toBe(-90);
      expect(track(row).getAnimations().length).toBe(0);
      expect(row.hasAttribute("data-full")).toBe(false);
      expect(getComputedStyle(action(row, "Archive")).opacity).toBe("1");
      for (let step = 7; step <= 18; step++) await commands.touchStep({ type: "touchMove", x: x - step * 15, y });
      await expect.poll(() => row.hasAttribute("data-full")).toBe(true);
      await expect.poll(() => getComputedStyle(action(row, "Archive")).opacity).toBe("0");
      // The gap past the buttons is filled with the primary action's color.
      const filler = getComputedStyle(strip(row, "trailing"), "::after");
      expect(filler.backgroundColor).toBe(getComputedStyle(action(row, "Delete")).backgroundColor);
      expect(calls.remove).not.toHaveBeenCalled();
      // The user changes their mind and drags back: releasing no longer commits.
      for (let step = 17; step >= 6; step--) await commands.touchStep({ type: "touchMove", x: x - step * 15, y });
      await expect.poll(() => row.hasAttribute("data-full")).toBe(false);
      // The finger rests at 90px, past half the actions, so the row stays open.
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
    expect(calls.remove).not.toHaveBeenCalled();
  });

  it("does not follow the link on a swipe, closes an open row on a tap, and follows the link on the next tap", async () => {
    const { rows } = await renderList();
    const row = rows[0]!;
    row.id = "first-row";
    await swipe(row, -120);
    await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
    await settled(row);
    expect(location.hash).toBe("");
    // A tap on the open row closes it and is not a navigation.
    await commands.tap("#first-row [data-ouro-swipe-actions-content]");
    await expect.poll(() => row.hasAttribute("data-open")).toBe(false);
    await settled(row);
    expect(location.hash).toBe("");
    // A short swipe that springs back is not a tap either.
    await slowSwipe(row, -30);
    await settled(row);
    expect(location.hash).toBe("");
    await commands.tap("#first-row [data-ouro-swipe-actions-content]");
    await expect.poll(() => location.hash).toBe("#recipe-0");
    // Two swipes, an 11-step held gesture (each step waits for the page to handle the touch) and two taps:
    // 15s, the default, is too tight on a loaded runner.
  }, 30_000);

  it("keeps only one row open: swiping another closes the first", async () => {
    const { rows } = await renderList();
    await swipe(rows[0]!, -120);
    await expect.poll(() => rows[0]!.getAttribute("data-open")).toBe("trailing");
    await swipe(rows[2]!, -120);
    await expect.poll(() => rows[2]!.getAttribute("data-open")).toBe("trailing");
    expect(rows[0]!.hasAttribute("data-open")).toBe(false);
    expect(await settled(rows[0]!)).toBe(0);
    expect(document.querySelectorAll('[data-ouro="swipe-actions"][data-open]').length).toBe(1);
  });

  it("closes the open row on a tap outside it, when the page scrolls and on Escape", async () => {
    const { rows, host } = await renderList();
    const row = rows[1]!;
    const open = async () => {
      await swipe(row, -120);
      await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
      await settled(row);
    };
    const closed = async () => {
      await expect.poll(() => row.hasAttribute("data-open")).toBe(false);
      expect(await settled(row)).toBe(0);
    };
    const outside = host.querySelector<HTMLElement>("div[style]")!;
    outside.id = "outside";
    await open();
    await commands.tap("#outside");
    await closed();

    await open();
    await act(async () => scrollTo(0, 120));
    await closed();
    await act(async () => scrollTo(0, 0));
    await pageAtRest();

    await open();
    await userEvent.keyboard("{Escape}");
    await closed();
  });

  it("runs an action from a tap on its button and closes the row", async () => {
    const { rows, calls } = await renderList();
    const row = rows[1]!;
    row.id = "second-row";
    let taken = 0;
    const listener = (event: TouchEvent) => {
      if (event.defaultPrevented) taken++;
    };
    addEventListener("touchmove", listener);
    cleanups.push(() => removeEventListener("touchmove", listener));
    // A flick, then a tap as soon as the row is open. Chromium would start a fling when a
    // fast swipe ends, although nothing scrolls, and the tap that stops a fling gets no
    // click: the row takes the swipe's touch moves, so there is no fling.
    await swipe(row, -120);
    expect(taken).toBeGreaterThan(0);
    await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
    await settled(row);
    await commands.tap('#second-row [data-ouro-swipe-actions-side="trailing"] button:first-child');
    await expect.poll(() => calls.archive.mock.calls).toEqual([["Short ribs"]]);
    expect(calls.remove).not.toHaveBeenCalled();
    await expect.poll(() => row.hasAttribute("data-open")).toBe(false);
    expect(location.hash).toBe("");
  });

  it("flips the sides in a right-to-left page", async () => {
    const { rows, calls } = await renderList(spies(), "rtl");
    const row = rows[1]!;
    // Toward the start is to the right: the trailing actions come in from the left edge.
    await swipe(row, 120);
    await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
    expect(await settled(row)).toBe(stripWidth(row, "trailing"));
    const remove = action(row, "Delete");
    expect(Math.round(remove.getBoundingClientRect().left)).toBe(Math.round(row.getBoundingClientRect().left));
    expect(hits(remove, ...middle(remove))).toBe(true);
    await swipe(rows[0]!, -90);
    await expect.poll(() => rows[0]!.getAttribute("data-open")).toBe("leading");
    expect(row.hasAttribute("data-open")).toBe(false);
    await swipe(rows[2]!, 300);
    await expect.poll(() => calls.remove.mock.calls).toEqual([["Lemon tart"]]);
  });

  it("follows the finger with reduced motion too, and jumps to rest when it lifts", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const { rows } = await renderList();
    const row = rows[1]!;
    const [x, y] = middle(row);
    // The actions are in sight as soon as the row uncovers them: nothing fades in.
    expect(getComputedStyle(strip(row, "trailing")).opacity).toBe("1");
    try {
      await commands.touchStep({ type: "touchStart", x, y });
      for (let step = 1; step <= 8; step++) await commands.touchStep({ type: "touchMove", x: x - step * 15, y });
      // Following a finger is not an animation: the row is under it, 120px along.
      await expect.poll(() => offset(row)).toBe(-120);
      expect(track(row).getAnimations({ subtree: true }).length).toBe(0);
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
    // Open at once: no spring and no transition carries it there.
    expect(row.hasAttribute("data-ouro-settling")).toBe(false);
    expect(offset(row)).toBe(-stripWidth(row, "trailing"));
    expect(track(row).getAnimations({ subtree: true }).length).toBe(0);
  });

  it("opens the actions as a menu on a long press, for a touch that cannot swipe", async () => {
    const { rows, calls } = await renderList();
    const row = rows[1]!;
    const content = row.querySelector<HTMLElement>("[data-ouro-swipe-actions-content]")!;
    const [x, y] = middle(content);
    try {
      await commands.touchStep({ type: "touchStart", x, y });
      // While the finger is down, text selection and the iOS callout are off, as on a Menu's own long-press area.
      await expect.poll(() => content.hasAttribute("data-ouro-pressing")).toBe(true);
      expect(getComputedStyle(content).userSelect).toBe("none");
      // The finger stays where it is. After half a second the menu opens there, with every action.
      await expect.element(page.getByRole("menu")).toBeVisible();
      expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(["Pin", "Delete", "Archive"]);
      expect(document.querySelector('[data-ouro="menu"]')!.getAttribute("data-ouro-presentation")).toBe("menu");
      expect(row.hasAttribute("data-dragging")).toBe(false);
      // The finger rests on the menu a moment before it lifts, longer than the half second after
      // opening in which Base UI ignores a press outside the menu.
      const openedAt = performance.now();
      await expect.poll(() => performance.now() - openedAt).toBeGreaterThan(600);
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    await expect.poll(() => content.hasAttribute("data-ouro-pressing")).toBe(false);
    expect(getComputedStyle(content).userSelect).not.toBe("none");
    // Lifting the finger is not a tap on the row's link, and the menu stays for the next tap.
    await pageAtRest();
    expect(location.hash).toBe("");
    const archive = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "Archive")!;
    archive.setAttribute("data-test-action", "archive");
    await commands.tap('[data-test-action="archive"]');
    await expect.poll(() => calls.archive.mock.calls).toEqual([["Short ribs"]]);
    expect(calls.remove).not.toHaveBeenCalled();
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
    expect(row.hasAttribute("data-open")).toBe(false);
    expect(location.hash).toBe("");
  });

  it("keeps the actions button for screen readers without showing it, and shows it for keyboard focus", async () => {
    const { rows } = await renderList();
    const row = rows[0]!;
    const button = row.querySelector<HTMLButtonElement>("[data-ouro-swipe-actions-menu] button")!;
    expect(button.getAttribute("aria-label")).toBe("Actions for Shakshuka");
    const wrapper = button.parentElement!;
    // Visually hidden: one clipped pixel that takes no tap from the row.
    expect(wrapper.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    const [x, y] = middle(row);
    expect(hits(button, row.getBoundingClientRect().right - 24, y)).toBe(false);
    expect(hits(row.querySelector("[data-ouro-swipe-actions-content]")!, x, y)).toBe(true);
    // An external keyboard reaches it after the row's link, and then it shows, 44px to touch.
    row.querySelector<HTMLElement>("a")!.focus();
    await pressTab();
    expect(document.activeElement).toBe(button);
    const rect = button.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(20);
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    expect(hits(button, cx, cy - 21) && hits(button, cx, cy + 21)).toBe(true);
    expect(hits(button, cx - 21, cy) && hits(button, cx + 21, cy)).toBe(true);
  });

  it.each([
    ["portrait", 390, 844],
    ["landscape", 844, 390],
  ])("gives each action a 44px target with 16px text in %s", async (_name, width, height) => {
    await rotate(width, height);
    const { rows } = await renderList();
    const row = rows[1]!;
    await swipe(row, -120);
    await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
    await settled(row);
    for (const name of ["Delete", "Archive"]) {
      const rect = action(row, name).getBoundingClientRect();
      expect(Math.min(rect.width, rect.height), name).toBeGreaterThanOrEqual(44);
      expect(getComputedStyle(action(row, name)).fontSize, name).toBe("16px");
    }
  });
});
