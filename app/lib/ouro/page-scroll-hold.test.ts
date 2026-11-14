import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdPageAtPress, holdPageScroll } from "~/lib/ouro/page-scroll-hold";

// A tall page scrolled to (40, 2000), and a portal like a Base UI overlay's, its popup open.
// Performance's clock is held, so how long the person's scroll lasts is set by the test.

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const at = () => [window.scrollX, window.scrollY];
const releases: Array<() => void> = [];
let page: HTMLElement;

/** A portal holding a popup, open unless `open` is false, and the hold on it. */
function portal(open = true) {
  const element = document.body.appendChild(document.createElement("div"));
  const popup = element.appendChild(document.createElement("div"));
  popup.toggleAttribute("data-open", open);
  const release = holdPageScroll(element);
  releases.push(release);
  return { element, popup, release };
}

/** Scrolls the page as a script does, and returns where the page is once the next frame paints. */
async function scrollTo(left: number, top: number) {
  window.scrollTo({ left, top, behavior: "instant" });
  await frame();
  return at();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["performance"] });
  page = document.body.appendChild(document.createElement("div"));
  page.style.cssText = "width: 4000px; height: 5000px";
  window.scrollTo({ left: 40, top: 2000, behavior: "instant" });
  await frame();
});

afterEach(async () => {
  vi.restoreAllMocks();
  releases.splice(0).forEach((release) => release());
  // A press's hold ends on its own clock: end it, so the next test starts with nothing holding the page.
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.documentElement.removeAttribute("style");
  document.body.replaceChildren();
  window.scrollTo({ left: 0, top: 0, behavior: "instant" });
  await frame();
});

describe("holdPageScroll", () => {
  it("undoes a page scroll while a popup is open, before the next frame paints it", async () => {
    portal();
    expect(await scrollTo(0, 4200)).toEqual([40, 2000]);
    expect(await scrollTo(300, 2000)).toEqual([40, 2000]);
  });

  it("undoes a smooth scroll on its first frame, under scroll-behavior: smooth", async () => {
    document.documentElement.style.scrollBehavior = "smooth";
    portal();
    const seen: number[][] = [];
    window.scrollBy({ top: 1500 });
    for (let index = 0; index < 10; index++) {
      await frame();
      seen.push(at());
    }
    expect(seen).toEqual(Array.from({ length: 10 }, () => [40, 2000]));
  });

  it("leaves a scroll that follows the wheel, a touch, the scroll bar, a key nothing handled or a click in the popup", async () => {
    const { popup } = portal();
    // A second, closed popup: a click counts in any of them. And a popup that stops these events
    // stops them too late: the hold sees them as they go down to it.
    portal(false);
    for (const type of ["wheel", "touchmove", "pointerdown", "click"]) {
      for (const element of [page, popup]) element.addEventListener(type, (event) => event.stopPropagation());
    }
    const intents: Array<[string, () => void]> = [
      ["wheel", () => page.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }))],
      ["touch", () => page.dispatchEvent(new Event("touchmove", { bubbles: true }))],
      ["scroll bar", () => document.documentElement.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))],
      ["middle button", () => page.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 1 }))],
      ...[" ", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].map(
        (key) => [`key ${key}`, () => page.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }))] as [string, () => void],
      ),
      ["click in the popup", () => popup.dispatchEvent(new MouseEvent("click", { bubbles: true }))],
    ];
    let top = 2000;
    for (const [name, act] of intents) {
      top += 10;
      act();
      expect([name, await scrollTo(40, top)]).toEqual([name, [40, top]]);
      // Its place is the page's place now: once the person's scroll is over, a script's goes back to it.
      vi.advanceTimersByTime(1000);
      expect([name, await scrollTo(40, 100)]).toEqual([name, [40, top]]);
    }
  });

  it("does not take a letter, a key a popup handled, or a click or press elsewhere for the person scrolling", async () => {
    portal();
    for (const act of [
      () => page.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" })),
      () => {
        page.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
        page.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }));
      },
      () => page.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      () => page.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })),
    ]) {
      act();
      expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
    }
  });

  it("ends the person's scroll at a key a popup handles, such as an arrow moving through a menu", async () => {
    portal();
    page.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    page.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    page.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }));
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
  });

  it("keeps the page free while the person's scroll goes on, and holds it again once it stops", async () => {
    portal();
    page.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    vi.advanceTimersByTime(900);
    expect(await scrollTo(40, 2100)).toEqual([40, 2100]);
    // Past the second since the wheel, but the scroll was still going 150ms ago.
    vi.advanceTimersByTime(150);
    expect(await scrollTo(40, 2200)).toEqual([40, 2200]);
    vi.advanceTimersByTime(199);
    expect(await scrollTo(40, 2300)).toEqual([40, 2300]);
    vi.advanceTimersByTime(201);
    expect(await scrollTo(40, 2400)).toEqual([40, 2300]);
  });

  it("holds the page again when a popup opens, whatever the person did just before", async () => {
    const { element } = portal();
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    portal();
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
  });

  it("lets the page go while no popup is open, and holds it where the page then is once one opens", async () => {
    const { popup } = portal(false);
    expect(await scrollTo(40, 2500)).toEqual([40, 2500]);
    popup.setAttribute("data-open", "");
    expect(await scrollTo(40, 3000)).toEqual([40, 2500]);
    // A closing popup, which Base UI marks closed while it animates out, holds nothing.
    popup.removeAttribute("data-open");
    popup.setAttribute("data-closed", "");
    expect(await scrollTo(40, 2600)).toEqual([40, 2600]);
    // One open popup among closed ones holds the page.
    portal();
    expect(await scrollTo(40, 3000)).toEqual([40, 2600]);
  });

  it("keeps the first popup's place while a second opens over it, and holds until the last lets go", async () => {
    const first = portal();
    const second = portal();
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
    second.release();
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
    first.release();
    expect(await scrollTo(40, 3000)).toEqual([40, 3000]);
    // Gone for good: an open popup no longer registered holds nothing.
    expect(await scrollTo(40, 2400)).toEqual([40, 2400]);
    // The next hold starts where the page is then.
    portal();
    expect(await scrollTo(40, 100)).toEqual([40, 2400]);
  });

  it("stops listening once the last popup lets go", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const removeFromWindow = vi.spyOn(window, "removeEventListener");
    const first = portal();
    const second = portal();
    // One set of listeners, however many popups hold the page.
    expect(add).toHaveBeenCalledTimes(5);
    second.release();
    expect(remove).not.toHaveBeenCalled();
    expect(removeFromWindow).not.toHaveBeenCalled();
    first.release();
    expect(remove.mock.calls.map(([type, , options]) => [type, options])).toEqual([
      ["wheel", { capture: true, passive: true }],
      ["touchmove", { capture: true, passive: true }],
      ["pointerdown", { capture: true, passive: true }],
      ["click", { capture: true, passive: true }],
      ["scroll", undefined],
    ]);
    expect(removeFromWindow.mock.calls.map(([type]) => type)).toEqual(["keydown"]);
  });

  it("makes the page's scrolls instant while it holds the page, and gives back its own scroll-behavior after", async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = "smooth";
    const first = portal();
    expect(html.style.scrollBehavior).toBe("auto");
    // The person's scroll glides as the page sets it, until a popup handles a key again.
    page.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(html.style.scrollBehavior).toBe("smooth");
    for (let press = 0; press < 2; press++) {
      page.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
      page.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }));
      expect(html.style.scrollBehavior).toBe("auto");
    }
    const second = portal();
    second.release();
    expect(html.style.scrollBehavior).toBe("auto");
    first.release();
    expect(html.style.scrollBehavior).toBe("smooth");
  });

  it("leaves scroll-behavior to whatever set it since, and keeps a page's own inline auto", async () => {
    const html = document.documentElement;
    const { release } = portal();
    // Base UI's scroll lock saves and restores this style too; what it put back stands.
    html.style.scrollBehavior = "unset";
    release();
    expect(html.style.scrollBehavior).toBe("unset");
    html.style.scrollBehavior = "auto";
    const again = portal();
    page.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    again.release();
    expect(html.style.scrollBehavior).toBe("auto");
  });
});

describe("holdPageAtPress", () => {
  // The press's hold ends on the timer clock, held here too.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
  });

  /** Presses a trigger with the primary button, or another, as React hands the press to it. */
  type Kind = keyof typeof holdPageAtPress;
  const pointerDown = (button = 0, kind: Kind = "listButton", nativeEvent = new PointerEvent("pointerdown", { button })) =>
    holdPageAtPress[kind].onPointerDown({ button, currentTarget: page, nativeEvent } as unknown as ReactPointerEvent<HTMLElement>);
  /** Presses a key on a trigger: a real keydown that reaches the window after the trigger's handler. */
  const keyDown = (key: string, kind: Kind = "listButton") => {
    const trigger = page.appendChild(document.createElement("button"));
    trigger.setAttribute("aria-expanded", page.getAttribute("aria-expanded") ?? "false");
    trigger.addEventListener("keydown", (event) => holdPageAtPress[kind].onKeyDown({ key, currentTarget: trigger, nativeEvent: event } as unknown as ReactKeyboardEvent<HTMLElement>), { once: true });
    trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
    trigger.remove();
  };

  it("stops a smooth scroll in flight where it is, at a press of the primary button or an opening key", async () => {
    document.documentElement.style.scrollBehavior = "smooth";
    for (const [name, act] of [
      ["pointer", () => pointerDown()],
      ...["Enter", " ", "ArrowDown", "ArrowUp"].map((key) => [`key ${key}`, () => keyDown(key)] as const),
    ] as const) {
      window.scrollBy({ top: 1500 });
      await frame();
      act();
      const stopped = at();
      const scrolls: number[][] = [];
      const record = () => scrolls.push(at());
      window.addEventListener("scroll", record);
      const seen: number[][] = [];
      for (let index = 0; index < 10; index++) {
        await frame();
        seen.push(at());
      }
      window.removeEventListener("scroll", record);
      expect([name, seen]).toEqual([name, Array.from({ length: 10 }, () => stopped)]);
      // Stopped at once, not taken back a step at a time: the page never moved again.
      expect([name, scrolls]).toEqual([name, []]);
      vi.advanceTimersByTime(1000);
      await scrollTo(40, 2000);
    }
  });

  it("makes the page's scrolls instant and holds the page from the press, until a second passes with no popup", async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = "smooth";
    pointerDown();
    expect(html.style.scrollBehavior).toBe("auto");
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
    // A second press starts the second again.
    vi.advanceTimersByTime(600);
    keyDown("Enter");
    vi.advanceTimersByTime(999);
    expect(html.style.scrollBehavior).toBe("auto");
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
    vi.advanceTimersByTime(1);
    expect(html.style.scrollBehavior).toBe("smooth");
    expect(await scrollTo(40, 3000)).toEqual([40, 3000]);
  });

  it("hands the press's hold to the popup that opens from it, from where the press stopped the page", async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = "smooth";
    const add = vi.spyOn(document, "addEventListener");
    pointerDown();
    const { popup, release } = portal();
    // One set of listeners for the press and the popup.
    expect(add).toHaveBeenCalledTimes(5);
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
    // The popup alone holds the page now: once it is closing, nothing does, though the press was just now.
    popup.removeAttribute("data-open");
    expect(await scrollTo(40, 2600)).toEqual([40, 2600]);
    popup.setAttribute("data-open", "");
    vi.advanceTimersByTime(1000);
    expect(html.style.scrollBehavior).toBe("auto");
    expect(await scrollTo(40, 3000)).toEqual([40, 2600]);
    release();
    expect(html.style.scrollBehavior).toBe("smooth");
  });

  it("holds the page while a press is pending, though the popup that was open closes", async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = "smooth";
    const { release } = portal();
    // The person scrolls, then presses a trigger: the press ends their scroll.
    page.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    pointerDown();
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
    release();
    expect(html.style.scrollBehavior).toBe("auto");
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
    vi.advanceTimersByTime(1000);
    expect(html.style.scrollBehavior).toBe("smooth");
    expect(await scrollTo(40, 3000)).toEqual([40, 3000]);
  });

  it("holds the page only at the keys that open each kind of trigger's popup", async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = "smooth";
    for (const [kind, opening, others] of [
      ["button", ["Enter", " "], ["ArrowDown", "ArrowUp"]],
      ["listButton", ["Enter", " ", "ArrowDown", "ArrowUp"], []],
      ["listInput", ["ArrowDown", "ArrowUp"], ["Enter", " "]],
    ] as const) {
      for (const key of others) {
        keyDown(key, kind);
        expect([kind, key, html.style.scrollBehavior]).toEqual([kind, key, "smooth"]);
      }
      for (const key of opening) {
        keyDown(key, kind);
        expect([kind, key, html.style.scrollBehavior]).toEqual([kind, key, "auto"]);
        vi.advanceTimersByTime(1000);
      }
      pointerDown(0, kind);
      expect([kind, "pointer", html.style.scrollBehavior]).toEqual([kind, "pointer", "auto"]);
      vi.advanceTimersByTime(1000);
    }
  });

  it("holds the page from a dialog trigger's press until its click, leaving scroll-behavior alone", async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = "smooth";
    pointerDown(0, "dialog");
    expect(html.style.scrollBehavior).toBe("smooth");
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
    // The click opens the dialog, whose scroll lock holds the page from then: the hold stops listening.
    const remove = vi.spyOn(document, "removeEventListener");
    page.click();
    expect(remove.mock.calls.map(([type]) => type)).toContain("scroll");
    expect(await scrollTo(40, 3000)).toEqual([40, 3000]);
    // A key: only Enter and Space click a button.
    keyDown("ArrowDown", "dialog");
    keyDown("ArrowUp", "dialog");
    expect(await scrollTo(40, 3100)).toEqual([40, 3100]);
    for (const key of ["Enter", " "]) {
      keyDown(key, "dialog");
      expect([key, html.style.scrollBehavior, await scrollTo(40, 3500)]).toEqual([key, "smooth", [40, 3100]]);
      // No click came (the key's button is gone): the press lets go a second later.
      vi.advanceTimersByTime(1000);
      expect([key, await scrollTo(40, 3200)]).toEqual([key, [40, 3200]]);
      await scrollTo(40, 3100);
    }
  });

  it("leaves a press to the first handler that takes it, and a dialog trigger's click to its own press", async () => {
    // An Ouro Button that opens a dialog, under a popover's trigger: one press, the popover's.
    const event = new PointerEvent("pointerdown");
    pointerDown(0, "listButton", event);
    pointerDown(0, "dialog", event);
    page.click();
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
    vi.advanceTimersByTime(1000);
    // A dialog trigger's press that no click ended leaves no click behind it to end a later press.
    pointerDown(0, "dialog");
    vi.advanceTimersByTime(1000);
    pointerDown();
    page.click();
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
  });

  it("does not take a press of another button, or another key, for a press that opens a popup", async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = "smooth";
    pointerDown(2);
    expect(html.style.scrollBehavior).toBe("smooth");
    expect(await scrollTo(40, 3000)).toEqual([40, 3000]);
    keyDown("a");
    keyDown("Escape");
    expect(html.style.scrollBehavior).toBe("smooth");
    expect(await scrollTo(40, 2500)).toEqual([40, 2500]);
  });

  it("leaves the page to the open popup's hold at a press on its trigger, which closes it", async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = "smooth";
    page.setAttribute("aria-expanded", "true");
    pointerDown();
    keyDown("Enter");
    expect(html.style.scrollBehavior).toBe("smooth");
    expect(await scrollTo(40, 3000)).toEqual([40, 3000]);
    page.setAttribute("aria-expanded", "false");
    pointerDown();
    expect(html.style.scrollBehavior).toBe("auto");
  });

  it("holds the page from a context area's right-button press, not its primary press or a touch, which may start a scroll", async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = "smooth";
    const press = (init: PointerEventInit) =>
      holdPageAtPress.contextMenu.onPointerDown({ button: init.button, pointerType: init.pointerType, currentTarget: page, nativeEvent: new PointerEvent("pointerdown", init) } as unknown as ReactPointerEvent<HTMLElement>);
    press({ button: 0, pointerType: "mouse" });
    expect(html.style.scrollBehavior).toBe("smooth");
    keyDown("Enter", "contextMenu");
    expect(html.style.scrollBehavior).toBe("smooth");
    press({ button: 2, pointerType: "mouse" });
    expect(html.style.scrollBehavior).toBe("auto");
    vi.advanceTimersByTime(1000);
    expect(html.style.scrollBehavior).toBe("smooth");
    press({ button: 0, pointerType: "touch" });
    expect(html.style.scrollBehavior).toBe("smooth");
  });

  it("does not take the key that pressed a trigger for the person scrolling, though nothing handled it", async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = "smooth";
    keyDown(" ");
    expect(html.style.scrollBehavior).toBe("auto");
    expect(await scrollTo(40, 3000)).toEqual([40, 2000]);
    // The next Space nothing handles is theirs.
    page.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    expect(await scrollTo(40, 3000)).toEqual([40, 3000]);
  });
});
