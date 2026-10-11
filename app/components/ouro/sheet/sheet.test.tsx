import { createRef, useState, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, server, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import {
  SheetBackdrop,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHandle,
  SheetPopup,
  SheetPortal,
  SheetRoot,
  SheetTitle,
  SheetTrigger,
  SheetViewport,
} from "~/components/ouro/sheet/sheet-parts";
import { Sheet, type SheetProps } from "~/components/ouro/sheet/sheet";
import { act } from "~/lib/ouro/testing/act";
import { pageCss } from "~/lib/ouro/testing/page-css";

// Drag and velocity tests run in Chromium only (plan amendment): WebKit drag is covered
// by the recorded feel check. Everything else runs in Chromium and WebKit at 390x844.


const FIX = "Pass trigger={<Button>…</Button>} for an uncontrolled sheet, or open and onOpenChange to control it.";
const chromiumOnly = it.skipIf(server.browser !== "chromium");

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, rerender: (next: ReactNode) => act(async () => root.render(next)) };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await page.viewport(390, 844);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

const popup = () => document.querySelector<HTMLElement>('[data-ouro="sheet"]');
const backdrop = () => document.querySelector<HTMLElement>('[data-ouro="sheet-backdrop"]');
const viewport = () => document.querySelector<HTMLElement>('[data-ouro="sheet-viewport"]');
const trigger = () => document.querySelector<HTMLElement>('[data-ouro="button"]')!;

/** The popup's translation in px, from its computed transform (0 for `none`). */
function translation(element: HTMLElement): { x: number; y: number } {
  const transform = getComputedStyle(element).transform;
  if (transform === "none") return { x: 0, y: 0 };
  const matrix = new DOMMatrix(transform);
  return { x: matrix.m41, y: matrix.m42 };
}
const isIdentity = (element: HTMLElement) => {
  const { x, y } = translation(element);
  return Math.abs(x) < 0.5 && Math.abs(y) < 0.5;
};

/** Waits until the open sheet has finished its entrance: no starting style and a position that holds still. */
async function settled() {
  let last = Number.NaN;
  await expect
    .poll(
      () => {
        const sheet = popup();
        if (!sheet || sheet.hasAttribute("data-starting-style")) return false;
        const { y, x } = translation(sheet);
        const still = Math.abs(y + x - last) < 0.01;
        last = y + x;
        return still && getAnimations(sheet) === 0;
      },
      { timeout: 3000, interval: 50 },
    )
    .toBe(true);
}
const getAnimations = (element: HTMLElement) => element.getAnimations().length;

function Body() {
  return (
    <>
      <p style={{ margin: 0, height: 220 }}>Pick a cookbook for this recipe.</p>
      <label>
        Note <input aria-label="Note" />
      </label>
    </>
  );
}

async function openUncontrolled(props: Partial<SheetProps> = {}) {
  await render(
    <Sheet title="Save to cookbook" trigger={<Button>Save</Button>} {...(props as object)}>
      <Body />
    </Sheet>,
  );
  await userEvent.click(trigger());
  await settled();
  return popup()!;
}

/**
 * Flicks the sheet by its handle area with exact event timestamps (CDP), so the
 * page measures the velocity the test asks for even on a loaded CI runner.
 */
async function flickSheet(dy: number, durationMs: number) {
  const rect = popup()!.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + 10;
  await commands.flick({ from: [x, y], to: [x, y + dy], steps: 4, durationMs });
}

/** Drags the sheet by its handle area (outside Drawer.Content, so a mouse drag swipes). */
async function dragSheet(dy: number, { durationMs = 600, steps = 12, hold = false } = {}) {
  const rect = popup()!.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + 10;
  await commands.drag({ from: [x, y], to: [x, y + dy], steps, durationMs, hold });
}

describe("opening and closing", () => {
  it("opens from the trigger as a dialog named by the title", async () => {
    await render(
      <Sheet title="Save to cookbook" trigger={<Button>Save</Button>}>
        <Body />
      </Sheet>,
    );
    expect(popup()).toBeNull();
    await userEvent.click(trigger());
    await expect.element(page.getByRole("dialog", { name: "Save to cookbook" })).toBeVisible();
    expect(popup()!.getAttribute("role")).toBe("dialog");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await openUncontrolled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup(), { timeout: 3000 }).toBeNull();
    await expect.poll(() => document.activeElement).toBe(trigger());
  });

  it("sits at the bottom edge, fits its content and keeps clear of the top", async () => {
    const sheet = await openUncontrolled();
    expect(isIdentity(sheet)).toBe(true);
    const rect = sheet.getBoundingClientRect();
    expect(Math.round(rect.bottom)).toBe(innerHeight);
    expect(rect.width).toBe(innerWidth);
    expect(rect.height).toBeLessThan(innerHeight / 2);
    expect(getComputedStyle(sheet).maxHeight).toBe(`${innerHeight - 32}px`);
  });

  it("is controlled with open and onOpenChange", async () => {
    const onOpenChange = vi.fn();
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Edit</Button>
          <Sheet
            title="Edit recipe"
            open={open}
            onOpenChange={(next) => {
              onOpenChange(next);
              setOpen(next);
            }}
          >
            <Body />
          </Sheet>
        </>
      );
    }
    await render(<Controlled />);
    await userEvent.click(trigger());
    await settled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup(), { timeout: 3000 }).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes from an outside press on the backdrop area", async () => {
    await openUncontrolled();
    await userEvent.click(document.body, { position: { x: 20, y: 20 } });
    await expect.poll(() => popup(), { timeout: 3000 }).toBeNull();
  });

  it("marks the popup, backdrop and viewport with data-ouro, and the portal isolates its stacking", async () => {
    const sheet = await openUncontrolled();
    expect(sheet.getAttribute("data-side")).toBe("bottom");
    expect(backdrop()).not.toBeNull();
    expect(viewport()).not.toBeNull();
    const portal = document.querySelector<HTMLElement>('[data-ouro="sheet-portal"]')!;
    expect(getComputedStyle(portal).isolation).toBe("isolate");
  });

  it("renders on the server without throwing or rendering the popup", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <Sheet title="Save" trigger={<Button>Save</Button>}>
        Body
      </Sheet>,
    );
    expect(html).toContain("Save");
    expect(html).not.toContain('data-ouro="sheet"');
    expect(error).not.toHaveBeenCalled();
  });
});

describe("title and description", () => {
  it("hides the title visually with hideTitle and keeps it as the accessible name", async () => {
    await openUncontrolled({ hideTitle: true });
    await expect.element(page.getByRole("dialog", { name: "Save to cookbook" })).toBeVisible();
    const title = document.querySelector<HTMLElement>("[data-ouro-sheet-title]")!;
    const rect = title.getBoundingClientRect();
    expect(rect.width).toBeLessThanOrEqual(1);
    expect(rect.height).toBeLessThanOrEqual(1);
  });

  it("shows a visible title and describes the dialog with description", async () => {
    await openUncontrolled({ description: "Pick where it goes." });
    const title = document.querySelector<HTMLElement>("[data-ouro-sheet-title]")!;
    expect(title.getBoundingClientRect().height).toBeGreaterThan(10);
    const describedBy = popup()!.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)!.textContent).toBe("Pick where it goes.");
  });
});

describe("feel", () => {
  it("fades the backdrop with --drawer-swipe-progress up to --ouro-backdrop-max", async () => {
    await openUncontrolled();
    const layer = backdrop()!;
    await expect.poll(() => Number(getComputedStyle(layer).opacity), { timeout: 3000 }).toBeCloseTo(0.4, 2);
    layer.style.transition = "none";
    layer.style.setProperty("--drawer-swipe-progress", "0.5");
    expect(Number(getComputedStyle(layer).opacity)).toBeCloseTo(0.2, 2);
  });

  it("releases with the theme spring scaled by --drawer-swipe-strength", async () => {
    const sheet = await openUncontrolled();
    const style = getComputedStyle(sheet);
    const index = style.transitionProperty.split(", ").indexOf("transform");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(style.transitionDuration.split(", ")[index]).toBe("0.75s");
    expect(style.transitionTimingFunction.split(", ")[index]).toMatch(/^linear\(/);
    sheet.style.setProperty("--drawer-swipe-strength", "0.5");
    const scaled = getComputedStyle(sheet);
    expect(scaled.transitionDuration.split(", ")[index]).toBe("0.375s");
  });

  it("drops transform motion under reduced motion and keeps an opacity fade", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await render(
      <Sheet title="Save to cookbook" trigger={<Button>Save</Button>}>
        <Body />
      </Sheet>,
    );
    await userEvent.click(trigger());
    await expect.poll(() => popup()).not.toBeNull();
    const style = getComputedStyle(popup()!);
    const properties = style.transitionProperty.split(", ");
    const durations = style.transitionDuration.split(", ");
    expect(durations[properties.indexOf("transform")]).toBe("0s");
    expect(durations[properties.indexOf("opacity")]).not.toBe("0s");
  });

  it("pads the popup bottom by var(--drawer-keyboard-inset, 0px) so the keyboard never covers inputs", async () => {
    expect(pageCss()).toMatch(/var\(--drawer-keyboard-inset, ?0px\)/);
    const sheet = await openUncontrolled();
    const before = Number.parseFloat(getComputedStyle(sheet).paddingBottom);
    viewport()!.style.setProperty("--drawer-keyboard-inset", "300px");
    expect(Number.parseFloat(getComputedStyle(sheet).paddingBottom)).toBe(before + 300);
  });

  it("opens at the first snap point, as a fraction of the viewport", async () => {
    const sheet = await openUncontrolled({ snapPoints: [0.5, 1] });
    expect(sheet.hasAttribute("data-snap-points")).toBe(true);
    expect(Math.abs(innerHeight - sheet.getBoundingClientRect().top - innerHeight / 2)).toBeLessThanOrEqual(2);
  });

  it("gives a top sheet with snap points the full height less the gap, and fits a top sheet without them", async () => {
    const fitted = await openUncontrolled({ side: "top" });
    const fittedHeight = fitted.getBoundingClientRect().height;
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    const snapped = await openUncontrolled({ side: "top", snapPoints: [0.5, 1] });
    expect(snapped.getBoundingClientRect().height).toBeGreaterThan(fittedHeight);
    // --ouro-sheet-gap is 2rem.
    expect(Math.abs(snapped.getBoundingClientRect().height - (innerHeight - 32))).toBeLessThanOrEqual(2);
  });
});

describe("dragging (Chromium)", () => {
  chromiumOnly("closes after a drag down past 60% of the sheet's height", async () => {
    const sheet = await openUncontrolled();
    await dragSheet(sheet.offsetHeight * 0.6, { durationMs: 1200, steps: 24 });
    await expect.poll(() => popup(), { timeout: 3000 }).toBeNull();
  });

  chromiumOnly("springs back after a 10% drag and settles at identity within 1s", async () => {
    const sheet = await openUncontrolled();
    await dragSheet(sheet.offsetHeight * 0.1, { durationMs: 400, steps: 8 });
    expect(popup()).toBe(sheet);
    await expect.poll(() => isIdentity(sheet), { timeout: 1000 }).toBe(true);
  });

  chromiumOnly("dismisses on a quick flick even over a short distance", async () => {
    const sheet = await openUncontrolled();
    await flickSheet(sheet.offsetHeight * 0.2, 40);
    await expect.poll(() => popup(), { timeout: 3000 }).toBeNull();
  });

  chromiumOnly("springs back from the same distance moved slowly (the flick test's control)", async () => {
    const sheet = await openUncontrolled();
    await flickSheet(sheet.offsetHeight * 0.2, 400);
    expect(popup()).toBe(sheet);
    await expect.poll(() => isIdentity(sheet), { timeout: 1500 }).toBe(true);
    expect(popup()).toBe(sheet);
  });

  chromiumOnly("never moves the sheet further than the finger when pulled past the edge", async () => {
    const sheet = await openUncontrolled();
    for (const pull of [1, 2, 5, 12, 40, 80]) {
      await dragSheet(-pull, { durationMs: 200, steps: Math.max(2, Math.min(pull, 10)), hold: true });
      const lift = -translation(sheet).y;
      await commands.pointerPress({ action: "up" });
      expect(lift, `lift for a ${pull}px pull`).toBeLessThanOrEqual(pull + 0.01);
      await expect.poll(() => isIdentity(sheet), { timeout: 1500 }).toBe(true);
    }
  });

  chromiumOnly("fades the backdrop out quickly when a flick dismisses the sheet", async () => {
    const sheet = await openUncontrolled();
    const layer = backdrop()!;
    const durations: string[] = [];
    const observer = new MutationObserver(() => {
      if (layer.hasAttribute("data-swipe-dismiss") && layer.hasAttribute("data-ending-style")) {
        durations.push(getComputedStyle(layer).transitionDuration);
      }
    });
    observer.observe(layer, { attributes: true });
    await flickSheet(sheet.offsetHeight * 0.2, 40);
    await expect.poll(() => popup(), { timeout: 3000 }).toBeNull();
    observer.disconnect();
    expect(durations.length).toBeGreaterThan(0);
    expect(durations.at(-1)).toBe("0.1s");
  });

  chromiumOnly("keeps Tab inside the sheet, wrapping from the last control to the first", async () => {
    await render(
      <Sheet title="Pick" trigger={<Button>Open</Button>}>
        <Button>First</Button>
        <Button>Second</Button>
      </Sheet>,
    );
    await userEvent.click(trigger());
    await settled();
    const sheet = popup()!;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await userEvent.keyboard("{Tab}");
      expect(sheet.contains(document.activeElement)).toBe(true);
      seen.push(document.activeElement!.textContent ?? "");
    }
    // Close is the last control; Tab from it wraps back to the first.
    // A mouse open focuses the popup itself, so Tab starts at the first control.
    expect(seen).toEqual(["First", "Second", "Close", "First"]);
  });

  chromiumOnly("stretches when pulled past the open edge, with the bleed filling the gap", async () => {
    const sheet = await openUncontrolled();
    await dragSheet(-80, { durationMs: 400, steps: 8, hold: true });
    const lift = -translation(sheet).y;
    await commands.pointerPress({ action: "up" });
    expect(lift).toBeGreaterThanOrEqual(24);
    expect(lift).toBeLessThan(80);
    await expect.poll(() => isIdentity(sheet), { timeout: 1000 }).toBe(true);
  });

  chromiumOnly("lightens the backdrop in step with a drag down", async () => {
    const sheet = await openUncontrolled();
    const layer = backdrop()!;
    await expect.poll(() => Number(getComputedStyle(layer).opacity), { timeout: 3000 }).toBeCloseTo(0.4, 2);
    await dragSheet(sheet.offsetHeight * 0.4, { durationMs: 800, steps: 16, hold: true });
    const progress = Number(layer.style.getPropertyValue("--drawer-swipe-progress"));
    const opacity = Number(getComputedStyle(layer).opacity);
    await commands.pointerPress({ action: "up" });
    expect(progress).toBeGreaterThan(0.2);
    expect(opacity).toBeCloseTo(0.4 * (1 - progress), 2);
  });

  chromiumOnly("reopens fully after a partial drag, release and Escape (review focus 3)", async () => {
    const sheet = await openUncontrolled();
    const openTop = sheet.getBoundingClientRect().top;
    await dragSheet(sheet.offsetHeight * 0.3, { durationMs: 900, steps: 18 });
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup(), { timeout: 3000 }).toBeNull();
    await userEvent.click(trigger());
    await settled();
    const reopened = popup()!;
    expect(isIdentity(reopened)).toBe(true);
    expect(reopened.style.transform).toBe("");
    expect(Math.round(reopened.getBoundingClientRect().top)).toBe(Math.round(openTop));
  });
});

describe("sides", () => {
  it.each([
    ["top", (r: DOMRect) => Math.round(r.top) === 0 && Math.round(r.width) === innerWidth],
    ["left", (r: DOMRect) => Math.round(r.left) === 0 && Math.round(r.height) === innerHeight],
    ["right", (r: DOMRect) => Math.round(r.right) === innerWidth && Math.round(r.height) === innerHeight],
  ] as const)("slides in from the %s edge", async (side, atEdge) => {
    const sheet = await openUncontrolled({ side });
    expect(sheet.getAttribute("data-side")).toBe(side);
    expect(atEdge(sheet.getBoundingClientRect())).toBe(true);
    expect(sheet.getBoundingClientRect().width).toBeLessThanOrEqual(innerWidth);
  });
});

describe("close control", () => {
  it("renders a Close button last in the sheet, hidden until keyboard focus, that closes it", async () => {
    await render(
      <Sheet title="Save to cookbook" trigger={<Button>Save</Button>}>
        <Button>Weeknight dinners</Button>
      </Sheet>,
    );
    await userEvent.click(trigger());
    await settled();
    const close = page.getByRole("dialog").getByRole("button", { name: "Close" });
    const element = close.element() as HTMLElement;
    const focusable = popup()!.querySelectorAll("button, [href], input, [tabindex]:not([tabindex='-1'])");
    expect(focusable[focusable.length - 1]).toBe(element);
    expect(element.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement!.textContent).toBe("Weeknight dinners");
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(element);
    expect(element.getBoundingClientRect().width).toBeGreaterThan(20);
    await userEvent.click(close);
    await expect.poll(() => popup(), { timeout: 3000 }).toBeNull();
  });

  it("takes its label from closeLabel and closes a controlled sheet through onOpenChange", async () => {
    const onOpenChange = vi.fn();
    await render(
      <Sheet title="Filters" open onOpenChange={onOpenChange} closeLabel="Done">
        Body
      </Sheet>,
    );
    await settled();
    const done = page.getByRole("dialog").getByRole("button", { name: "Done" }).element();
    for (let i = 0; i < 5 && document.activeElement !== done; i++) await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(done);
    await userEvent.keyboard("{Enter}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

/**
 * The compiled app CSS with its iOS-only rules (`@supports (-webkit-touch-callout: none)`)
 * switched on. Desktop test browsers never match that query, so the test swaps it for one
 * every browser matches, instead of the components carrying a test-only selector.
 */
function withIosRules(css: string): string {
  return css.replace(/@supports \(-webkit-touch-callout: ?none\)/g, "@supports (display: block)");
}

describe("iOS backdrop rule", () => {
  it("ships no test-only selector", () => {
    expect(pageCss()).not.toContain("data-ouro-test-ios");
    expect(pageCss()).toMatch(/@supports \(-webkit-touch-callout: ?none\)/);
    expect(withIosRules(pageCss())).not.toBe(pageCss());
  });

  // The rule applies under @supports (-webkit-touch-callout: none), which only iOS
  // matches, so the test switches the shipped rule on (withIosRules).
  it("covers the visible screen on a page scrolled 2000px", async () => {
    const ios = document.createElement("style");
    ios.textContent = withIosRules(pageCss());
    document.head.append(ios);
    mounted.push(ios);
    const tall = document.createElement("div");
    tall.style.height = "5000px";
    document.body.append(tall);
    mounted.push(tall);
    window.scrollTo(0, 2000);
    expect(window.scrollY).toBe(2000);
    await render(
      <SheetRoot defaultOpen>
        <SheetPortal>
          <SheetBackdrop />
          <SheetViewport>
            <SheetPopup>
              <SheetTitle>Scrolled</SheetTitle>
            </SheetPopup>
          </SheetViewport>
        </SheetPortal>
      </SheetRoot>,
    );
    const layer = backdrop()!;
    expect(getComputedStyle(layer).position).toBe("absolute");
    await expect
      .poll(() => {
        const rect = layer.getBoundingClientRect();
        return rect.top <= 0 && rect.bottom >= innerHeight && rect.left <= 0 && rect.right >= innerWidth;
      })
      .toBe(true);
    expect(window.scrollY).toBe(2000);
    window.scrollTo(0, 0);
  });
});

describe("dev messages", () => {
  it("throws the exact fix when neither trigger nor open is passed", () => {
    // @ts-expect-error -- neither trigger nor open
    const sheet = <Sheet title="Save">Body</Sheet>;
    expect(() => renderToString(sheet)).toThrow(`[ouro-ui] Sheet: needs trigger or open with onOpenChange. Fix: ${FIX}`);
  });

  it("throws the exact fix when both trigger and open are passed", () => {
    const sheet = (
      // @ts-expect-error -- both trigger and open
      <Sheet title="Save" trigger={<Button>Save</Button>} open onOpenChange={() => {}}>
        Body
      </Sheet>
    );
    expect(() => renderToString(sheet)).toThrow(`[ouro-ui] Sheet: takes trigger or open, not both. Fix: ${FIX}`);
  });

  it("throws the exact fix when open comes without onOpenChange", () => {
    // @ts-expect-error -- open without onOpenChange
    const sheet = <Sheet title="Save" open>Body</Sheet>;
    expect(() => renderToString(sheet)).toThrow(`[ouro-ui] Sheet: open needs onOpenChange. Fix: ${FIX}`);
  });

  it("warns once about guessed props and drops them", async () => {
    const guessed = { isOpen: true, onClose: () => {}, position: "bottom", size: 400 } as object;
    await render(
      <Sheet title="Save" trigger={<Button>Save</Button>} {...guessed}>
        Body
      </Sheet>,
    );
    const messages = warn.mock.calls.map((call: unknown[]) => call[0]);
    expect(messages).toEqual([
      "[ouro-ui] Sheet: isOpen is not a prop. Fix: <Sheet open={open} onOpenChange={setOpen}>.",
      "[ouro-ui] Sheet: onClose is not a prop. Fix: <Sheet open={open} onOpenChange={setOpen}>.",
      '[ouro-ui] Sheet: position is not a prop. Fix: <Sheet side="bottom">.',
      "[ouro-ui] Sheet: size is not a prop; a sheet fits its content. Fix: <Sheet snapPoints={[0.5, 1]}>.",
    ]);
  });

  it("renders a bottom sheet for a side that is not one of the four, and warns once with the fix", async () => {
    const element = await openUncontrolled({ side: "left-ish" } as object);
    expect(element.getAttribute("data-side")).toBe("bottom");
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] Sheet: side="left-ish" is not a side; use "bottom", "top", "left", "right". Fix: <Sheet side="bottom">.',
    ]);
  });

  it.each([
    ["bg-white", ":root { --popover: …; } .dark { --popover: …; }"],
    ["rounded-none", ":root { --radius: 0px }"],
    ["rounded-3xl", ":root { --radius: 0.75rem }"],
    ["text-lg", '<Sheet title="…"><div className="text-lg">…</div></Sheet>'],
  ])("warns about the appearance class %s on the popup", async (token, fix) => {
    await openUncontrolled({ className: `mx-auto ${token}` });
    expect(popup()!.classList.contains("mx-auto")).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      `[ouro-ui] Sheet: "${token}" sets appearance, and className is for layout only. Fix: ${fix}.`,
    );
  });
});

describe("parts", () => {
  it("renders a bottom SheetRoot for a side that is not one of the four, and warns once with the fix", async () => {
    await render(
      <SheetRoot {...({ side: "left-ish" } as object)} defaultOpen>
        <SheetPortal>
          <SheetViewport>
            <SheetPopup>
              <SheetTitle>Parts</SheetTitle>
            </SheetPopup>
          </SheetViewport>
        </SheetPortal>
      </SheetRoot>,
    );
    await expect.poll(() => popup()?.getAttribute("data-side")).toBe("bottom");
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] SheetRoot: side="left-ish" is not a side; use "bottom", "top", "left", "right". Fix: <SheetRoot side="bottom">.',
    ]);
  });

  it("compose into a working sheet", async () => {
    await render(
      <SheetRoot>
        <SheetTrigger render={<Button>Open</Button>} />
        <SheetPortal>
          <SheetBackdrop />
          <SheetViewport>
            <SheetPopup className="mx-auto">
              <SheetHandle />
              <SheetTitle>Parts</SheetTitle>
              <SheetDescription>Built from parts.</SheetDescription>
              <SheetContent>
                <SheetClose render={<Button>Done</Button>} />
              </SheetContent>
            </SheetPopup>
          </SheetViewport>
        </SheetPortal>
      </SheetRoot>,
    );
    await userEvent.click(trigger());
    await expect.element(page.getByRole("dialog", { name: "Parts" })).toBeVisible();
    expect(popup()!.getAttribute("data-side")).toBe("bottom");
    expect(document.querySelector("[data-ouro-sheet-handle]")!.getAttribute("aria-hidden")).toBe("true");
    await userEvent.click(page.getByRole("button", { name: "Done" }));
    await expect.poll(() => popup(), { timeout: 3000 }).toBeNull();
  });

  it("forwards a ref passed to SheetBackdrop, as an object or a callback", async () => {
    const objectRef = createRef<HTMLDivElement>();
    const callbackRef = vi.fn();
    const sheet = (ref: Ref<HTMLDivElement>) => (
      <SheetRoot defaultOpen>
        <SheetPortal>
          <SheetBackdrop ref={ref} />
          <SheetViewport>
            <SheetPopup>
              <SheetTitle>Ref</SheetTitle>
            </SheetPopup>
          </SheetViewport>
        </SheetPortal>
      </SheetRoot>
    );
    await render(sheet(objectRef));
    await expect.poll(() => backdrop()).not.toBeNull();
    expect(objectRef.current).toBe(backdrop());
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    expect(objectRef.current).toBeNull();
    await render(sheet(callbackRef));
    await expect.poll(() => backdrop()).not.toBeNull();
    expect(callbackRef).toHaveBeenLastCalledWith(backdrop());
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    expect(callbackRef).toHaveBeenLastCalledWith(null);
    const cleanup = vi.fn();
    const withCleanup = vi.fn(() => cleanup);
    await render(sheet(withCleanup));
    await expect.poll(() => backdrop()).not.toBeNull();
    expect(withCleanup).toHaveBeenCalledExactlyOnceWith(backdrop());
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    expect(cleanup).toHaveBeenCalledOnce();
    expect(withCleanup).toHaveBeenCalledOnce();
  });

  it("does not draw a handle on a side sheet", async () => {
    await render(
      <SheetRoot side="left" defaultOpen>
        <SheetPortal>
          <SheetViewport>
            <SheetPopup>
              <SheetHandle />
              <SheetTitle>Side</SheetTitle>
            </SheetPopup>
          </SheetViewport>
        </SheetPortal>
      </SheetRoot>,
    );
    await expect.poll(() => popup()).not.toBeNull();
    expect(document.querySelector("[data-ouro-sheet-handle]")).toBeNull();
  });

  it.each([
    ["SheetPopup", "bg-white", ":root { --popover: …; } .dark { --popover: …; }"],
    ["SheetContent", "text-lg", '<SheetContent><div className="text-lg">…</div></SheetContent>'],
  ])("%s warns about the appearance class %s", async (part, token, fix) => {
    await render(
      <SheetRoot defaultOpen>
        <SheetPortal>
          <SheetViewport>
            <SheetPopup className={part === "SheetPopup" ? token : undefined}>
              <SheetTitle>Checked</SheetTitle>
              <SheetContent className={part === "SheetContent" ? token : undefined}>Body</SheetContent>
            </SheetPopup>
          </SheetViewport>
        </SheetPortal>
      </SheetRoot>,
    );
    await expect.poll(() => popup()).not.toBeNull();
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      `[ouro-ui] ${part}: "${token}" sets appearance, and className is for layout only. Fix: ${fix}.`,
    ]);
  });

  it("warns once, as Sheet, when Sheet passes an appearance class to its popup", async () => {
    await openUncontrolled({ className: "bg-white" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  const shape = (inner: string) =>
    `<SheetRoot><SheetTrigger render={<Button>Open</Button>} /><SheetPortal><SheetBackdrop /><SheetViewport><SheetPopup>${inner}</SheetPopup></SheetViewport></SheetPortal></SheetRoot>`;

  it.each([
    ["SheetTrigger", <SheetTrigger key="t" />, shape("…")],
    ["SheetPortal", <SheetPortal key="p" />, shape("…")],
    ["SheetBackdrop", <SheetBackdrop key="b" />, shape("…")],
    ["SheetViewport", <SheetViewport key="v" />, shape("…")],
    ["SheetPopup", <SheetPopup key="pp" />, shape("…")],
    ["SheetHandle", <SheetHandle key="h" />, shape("<SheetHandle />…")],
    ["SheetTitle", <SheetTitle key="ti">T</SheetTitle>, shape("<SheetTitle>…</SheetTitle>…")],
    ["SheetDescription", <SheetDescription key="d">D</SheetDescription>, shape("<SheetDescription>…</SheetDescription>…")],
    ["SheetContent", <SheetContent key="c" />, shape("<SheetContent>…</SheetContent>")],
    ["SheetClose", <SheetClose key="cl" />, shape("<SheetContent><SheetClose>…</SheetClose></SheetContent>")],
  ])("%s outside SheetRoot throws with the correct JSX shape", (name, element, jsx) => {
    expect(() => renderToString(element)).toThrow(`[ouro-ui] ${name}: must be rendered inside <SheetRoot>. Fix: ${jsx}.`);
  });
});
