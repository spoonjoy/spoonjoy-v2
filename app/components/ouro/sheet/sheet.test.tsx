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
import { registerSheetProperties } from "~/components/ouro/sheet/sheet-styles";
import { Sheet, type SheetProps } from "~/components/ouro/sheet/sheet";
import { act } from "~/lib/ouro/testing/act";
import { pageCss } from "~/lib/ouro/testing/page-css";
import { pressTab } from "~/lib/ouro/testing/tab";

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
      { interval: 50 },
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

/** A CSS time ("0.375s", "750ms") in milliseconds. */
const ms = (time: string) => (time.trim().endsWith("ms") ? parseFloat(time) : parseFloat(time) * 1000);

/**
 * Runs a gesture, waits for the sheet to spring back to rest, and returns the longest
 * transform transition the release scheduled, in ms (0 when the sheet never moved). It is read from the transition as it
 * starts (`transitionrun`), not from the wall clock, so a loaded runner cannot change it.
 */
async function springBack(sheet: HTMLElement, gesture: () => Promise<void>): Promise<number> {
  const durations: number[] = [];
  const record = (event: TransitionEvent) => {
    if (event.target !== sheet || event.propertyName !== "transform") return;
    const style = getComputedStyle(sheet);
    const index = style.transitionProperty.split(", ").indexOf("transform");
    durations.push(ms(style.transitionDuration.split(", ")[index]!));
  };
  sheet.addEventListener("transitionrun", record);
  try {
    await gesture();
    await expect.poll(() => isIdentity(sheet)).toBe(true);
  } finally {
    sheet.removeEventListener("transitionrun", record);
  }
  return Math.max(0, ...durations);
}

/** The theme's sheet duration, the longest a release may take (--drawer-swipe-strength is at most 1). */
const springDuration = () => ms(getComputedStyle(document.documentElement).getPropertyValue("--ouro-duration-sheet"));

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
    await expect.poll(() => popup()).toBeNull();
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

  it("stays on the bottom edge after something scrolls a control into view while the sheet is off it", async () => {
    // Scrolling a control into view while the sheet sits lower than its resting place (as it
    // does while it enters) must not scroll the full-screen viewport: the offset would stay
    // once the sheet came to rest, and the sheet would float mid-screen above a blank strip.
    const sheet = await openUncontrolled();
    sheet.style.translate = "0 400px";
    page.getByRole("textbox", { name: "Note" }).element().scrollIntoView({ block: "center" });
    sheet.style.translate = "";
    expect(viewport()!.scrollTop).toBe(0);
    expect(Math.round(sheet.getBoundingClientRect().bottom)).toBe(innerHeight);
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
    await expect.poll(() => popup()).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes from an outside press on the backdrop area", async () => {
    await openUncontrolled();
    await userEvent.click(document.body, { position: { x: 20, y: 20 } });
    await expect.poll(() => popup()).toBeNull();
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

describe("Sheet stacking above the app's fixed bars", () => {
  /** The app's `--ouro-layer`: 50 from ouro-base, unless the app raised it. */
  const layer = () => Number(getComputedStyle(document.documentElement).getPropertyValue("--ouro-layer"));
  /** A fixed, full-screen app layer at the given z-index, like a tab bar or a header. */
  function appBar(zIndex: number): HTMLElement {
    const bar = document.createElement("div");
    Object.assign(bar.style, { position: "fixed", inset: "0", zIndex: String(zIndex) });
    document.body.append(bar);
    mounted.push(bar);
    return bar;
  }
  /** Whether the popup is what a press at its center lands on. */
  const onTop = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  };
  const portal = () => document.querySelector<HTMLElement>('[data-ouro="sheet-portal"]')!;

  it("puts the portal on the --ouro-layer level, as its own stacking context", async () => {
    await render(
      <Sheet title="Save to cookbook" open onOpenChange={() => {}}>
        <Body />
      </Sheet>,
    );
    await settled();
    const style = getComputedStyle(portal());
    expect(style.position).toBe("relative");
    expect(layer()).toBeGreaterThanOrEqual(50);
    expect(style.zIndex).toBe(String(layer()));
    expect(style.isolation).toBe("isolate");
  });

  it("stays above a fixed app bar at the same level: a tie, which the portal wins as the last child of body", async () => {
    appBar(layer());
    await render(
      <Sheet title="Save to cookbook" open onOpenChange={() => {}}>
        <Body />
      </Sheet>,
    );
    await settled();
    expect(document.body.lastElementChild).toBe(portal());
    expect(onTop(popup()!)).toBe(true);
  });

  it("stays above a fixed app bar added after it when the app raises --ouro-layer past the bar", async () => {
    const bar = layer();
    document.documentElement.style.setProperty("--ouro-layer", String(bar + 10));
    try {
      await render(
      <Sheet title="Save to cookbook" open onOpenChange={() => {}}>
        <Body />
      </Sheet>,
    );
      await settled();
      // After the portal in the DOM, so at an equal level the bar would cover it.
      appBar(bar);
      expect(getComputedStyle(portal()).zIndex).toBe(String(bar + 10));
      expect(onTop(popup()!)).toBe(true);
    } finally {
      document.documentElement.style.removeProperty("--ouro-layer");
    }
  });
});

describe("footer", () => {
  it("renders footer as the actions row after the body, and closes from an action wrapped in SheetClose", async () => {
    const element = await openUncontrolled({
      footer: (
        <>
          <Button variant="soft">Send to a friend</Button>
          <SheetClose render={<Button>Copy link</Button>} />
        </>
      ),
    });
    const footer = element.querySelector<HTMLElement>("[data-ouro-footer]")!;
    expect(footer).not.toBeNull();
    expect(footer.textContent).toBe("Send to a friend" + "Copy link");
    // After the body, before the hidden close button.
    expect(element.querySelector("[data-ouro-sheet-content]")!.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Stacked full width on a phone.
    const buttons = [...footer.querySelectorAll<HTMLElement>('[data-ouro="button"]')];
    expect(buttons.map((button) => Math.round(button.getBoundingClientRect().width))).toEqual(
      buttons.map(() => Math.round(footer.getBoundingClientRect().width - parseFloat(getComputedStyle(footer).paddingLeft) - parseFloat(getComputedStyle(footer).paddingRight))),
    );
    await userEvent.click(page.getByRole("button", { name: "Copy link" }));
    await expect.poll(() => popup()).toBeNull();
  });

  it("renders no actions row without footer", async () => {
    const element = await openUncontrolled();
    expect(element.querySelector("[data-ouro-footer]")).toBeNull();
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
    await expect.poll(() => Number(getComputedStyle(layer).opacity)).toBeCloseTo(0.4, 2);
    layer.style.transition = "none";
    layer.style.setProperty("--drawer-swipe-progress", "0.5");
    expect(Number(getComputedStyle(layer).opacity)).toBeCloseTo(0.2, 2);
  });

  it("releases on the drawer curve over the sheet duration, scaled by --drawer-swipe-strength", async () => {
    const sheet = await openUncontrolled();
    const style = getComputedStyle(sheet);
    const index = style.transitionProperty.split(", ").indexOf("transform");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(style.transitionDuration.split(", ")[index]).toBe("0.5s");
    // The curve has no overshoot: a sheet that is let go comes to rest without a bounce.
    expect(style.transitionTimingFunction).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
    sheet.style.setProperty("--drawer-swipe-strength", "0.5");
    const scaled = getComputedStyle(sheet);
    expect(scaled.transitionDuration.split(", ")[index]).toBe("0.25s");
  });

  it("fades the backdrop in step with the sheet: the same duration and curve", async () => {
    await openUncontrolled();
    const style = getComputedStyle(backdrop()!);
    expect(style.transitionProperty).toBe("opacity");
    expect(style.transitionDuration).toBe("0.5s");
    expect(style.transitionTimingFunction).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
  });

  it("keeps the variables a drag rewrites out of the sheet's content", async () => {
    const sheet = await openUncontrolled();
    const inside = sheet.querySelector<HTMLElement>("[data-ouro-sheet-content]")!;
    sheet.style.setProperty("--drawer-swipe-movement-y", "40px");
    expect(getComputedStyle(sheet).getPropertyValue("--ouro-sheet-y")).toBe("40px");
    // Not inherited: the content's value is the registered initial one, so a drag frame restyles the sheet alone.
    for (const name of ["--ouro-sheet-y", "--ouro-sheet-x", "--ouro-sheet-grab"]) {
      expect(getComputedStyle(inside).getPropertyValue(name), name).toBe("0px");
    }
    expect(getComputedStyle(inside).getPropertyValue("--ouro-sheet-transform")).toBe("");
  });

  it("registers its variables once: a second copy of the module finds them registered and does nothing", () => {
    expect(() => registerSheetProperties()).not.toThrow();
  });

  it("pads a sheet at a lower snap point by the part below the screen, and holds that padding through a drag", async () => {
    const sheet = await openUncontrolled({ snapPoints: [0.5, 1] });
    const offset = Number.parseFloat(getComputedStyle(sheet).getPropertyValue("--drawer-snap-point-offset"));
    expect(offset).toBeGreaterThan(100);
    const padding = Number.parseFloat(getComputedStyle(sheet).paddingBottom);
    expect(padding).toBeGreaterThanOrEqual(offset);
    // A drag moves the sheet, not its layout: the padding follows the snap point, never the finger.
    sheet.style.setProperty("--drawer-swipe-movement-y", "60px");
    expect(Number.parseFloat(getComputedStyle(sheet).paddingBottom)).toBe(padding);
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
    await expect.poll(() => popup()).toBeNull();
  });

  chromiumOnly("springs back after a 10% drag and settles at identity within the theme spring", async () => {
    const sheet = await openUncontrolled();
    const duration = await springBack(sheet, async () => {
      await dragSheet(sheet.offsetHeight * 0.1, { durationMs: 400, steps: 8 });
      expect(popup()).toBe(sheet);
    });
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(springDuration());
  });

  chromiumOnly("dismisses on a quick flick even over a short distance", async () => {
    const sheet = await openUncontrolled();
    await flickSheet(sheet.offsetHeight * 0.2, 40);
    await expect.poll(() => popup()).toBeNull();
  });

  chromiumOnly("springs back from the same distance moved slowly (the flick test's control)", async () => {
    const sheet = await openUncontrolled();
    const duration = await springBack(sheet, async () => {
      await flickSheet(sheet.offsetHeight * 0.2, 400);
      expect(popup()).toBe(sheet);
    });
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(springDuration());
    expect(popup()).toBe(sheet);
  });

  chromiumOnly("never moves the sheet further than the finger when pulled past the edge", async () => {
    const sheet = await openUncontrolled();
    for (const pull of [1, 2, 5, 12, 40, 80]) {
      let lift = 0;
      // The sheet is taken where it stands, which may be a fraction of a pixel short of rest.
      const from = translation(sheet).y;
      const duration = await springBack(sheet, async () => {
        await dragSheet(-pull, { durationMs: 200, steps: Math.max(2, Math.min(pull, 10)), hold: true });
        lift = from - translation(sheet).y;
        await commands.pointerPress({ action: "up" });
      });
      expect(lift, `lift for a ${pull}px pull`).toBeLessThanOrEqual(pull + 0.01);
      expect(duration, `release after a ${pull}px pull`).toBeLessThanOrEqual(springDuration());
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
    await expect.poll(() => popup()).toBeNull();
    observer.disconnect();
    expect(durations.length).toBeGreaterThan(0);
    expect(durations.at(-1)).toBe("0.15s");
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
    for (const name of ["First", "Second", "Close", "First"]) {
      await pressTab();
      await expect.poll(() => document.activeElement?.textContent).toBe(name);
      expect(sheet.contains(document.activeElement)).toBe(true);
      seen.push(document.activeElement!.textContent ?? "");
    }
    // Close is the last control; Tab from it wraps back to the first.
    // A mouse open focuses the popup itself, so Tab starts at the first control.
    expect(seen).toEqual(["First", "Second", "Close", "First"]);
  });

  chromiumOnly("stretches when pulled past the open edge, with the bleed filling the gap", async () => {
    const sheet = await openUncontrolled();
    let lift = 0;
    const duration = await springBack(sheet, async () => {
      await dragSheet(-80, { durationMs: 400, steps: 8, hold: true });
      lift = -translation(sheet).y;
      await commands.pointerPress({ action: "up" });
    });
    expect(lift).toBeGreaterThanOrEqual(24);
    expect(lift).toBeLessThan(80);
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(springDuration());
  });

  chromiumOnly("lightens the backdrop in step with a drag down", async () => {
    const sheet = await openUncontrolled();
    const layer = backdrop()!;
    await expect.poll(() => Number(getComputedStyle(layer).opacity)).toBeCloseTo(0.4, 2);
    await dragSheet(sheet.offsetHeight * 0.4, { durationMs: 800, steps: 16, hold: true });
    const progress = Number(layer.style.getPropertyValue("--drawer-swipe-progress"));
    const opacity = Number(getComputedStyle(layer).opacity);
    await commands.pointerPress({ action: "up" });
    expect(progress).toBeGreaterThan(0.2);
    expect(opacity).toBeCloseTo(0.4 * (1 - progress), 2);
  });

  chromiumOnly("stays under the mouse when it is caught on its way back to rest, and follows from there", async () => {
    const sheet = await openUncontrolled();
    // A long settle, stopped part-way: the sheet stands off its rest position, as it does for a moment after any release.
    document.documentElement.style.setProperty("--ouro-duration-sheet", "20s");
    try {
      await dragSheet(100, { durationMs: 600, steps: 12 });
      await expect.poll(() => getAnimations(sheet)).toBeGreaterThan(0);
      for (const animation of sheet.getAnimations()) animation.pause();
      const frozen = translation(sheet).y;
      expect(frozen).toBeGreaterThan(40);
      // Base UI measures from the first of the four moves, so the sheet moves 30px of the 40.
      await dragSheet(40, { durationMs: 200, steps: 4, hold: true });
      expect(sheet.hasAttribute("data-swiping")).toBe(true);
      expect(Math.abs(translation(sheet).y - (frozen + 30))).toBeLessThan(1);
    } finally {
      document.documentElement.style.removeProperty("--ouro-duration-sheet");
      await commands.pointerPress({ action: "up" });
    }
    await expect.poll(() => isIdentity(sheet)).toBe(true);
  });

  chromiumOnly("reopens fully after a partial drag, release and Escape (review focus 3)", async () => {
    const sheet = await openUncontrolled();
    const openTop = sheet.getBoundingClientRect().top;
    await dragSheet(sheet.offsetHeight * 0.3, { durationMs: 900, steps: 18 });
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    await userEvent.click(trigger());
    await settled();
    const reopened = popup()!;
    expect(isIdentity(reopened)).toBe(true);
    expect(reopened.style.transform).toBe("");
    expect(Math.round(reopened.getBoundingClientRect().top)).toBe(Math.round(openTop));
  });
});

describe("sides", () => {
  for (const direction of ["ltr", "rtl"]) {
    it.each([
      ["top", (r: DOMRect) => Math.round(r.top) === 0 && Math.round(r.width) === innerWidth],
      ["left", (r: DOMRect) => Math.round(r.left) === 0 && Math.round(r.height) === innerHeight],
      ["right", (r: DOMRect) => Math.round(r.right) === innerWidth && Math.round(r.height) === innerHeight],
    ] as const)(`slides in from the %s edge in ${direction}`, async (side, atEdge) => {
      const previous = document.documentElement.getAttribute("dir");
      document.documentElement.dir = direction;
      try {
        const sheet = await openUncontrolled({ side });
        expect(sheet.getAttribute("data-side")).toBe(side);
        expect(atEdge(sheet.getBoundingClientRect())).toBe(true);
        expect(sheet.getBoundingClientRect().width).toBeLessThanOrEqual(innerWidth);
      } finally {
        if (previous === null) document.documentElement.removeAttribute("dir");
        else document.documentElement.setAttribute("dir", previous);
      }
    });
  }
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
    await expect.poll(() => popup()).toBeNull();
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

describe("Sheet iOS backdrop rule", () => {
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

describe("Sheet dev messages", () => {
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

  it.each([[""], [undefined]])("warns when the title is missing (%j): it names the sheet for screen readers", async (title) => {
    await openUncontrolled({ title } as object);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] Sheet: title is required; it names the sheet for screen readers. Fix: <Sheet title="Share">.',
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

describe("Sheet parts", () => {
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
    await expect.poll(() => popup()).toBeNull();
  });

  it("forwards a ref passed to SheetViewport", async () => {
    const ref = createRef<HTMLDivElement>();
    await render(
      <SheetRoot defaultOpen>
        <SheetPortal>
          <SheetViewport ref={ref}>
            <SheetPopup>
              <SheetTitle>Ref</SheetTitle>
            </SheetPopup>
          </SheetViewport>
        </SheetPortal>
      </SheetRoot>,
    );
    await expect.poll(() => viewport()).not.toBeNull();
    expect(ref.current).toBe(viewport());
  });

  it("measures where the sheet is only for a press inside its viewport, and not once it is let go", async () => {
    await render(
      <SheetRoot defaultOpen>
        <SheetPortal>
          <SheetViewport>
            <SheetPopup>
              <SheetTitle>Grab</SheetTitle>
            </SheetPopup>
          </SheetViewport>
        </SheetPortal>
      </SheetRoot>,
    );
    await settled();
    const sheet = popup()!;
    const grab = () => sheet.style.getPropertyValue("--ouro-sheet-grab");
    const fire = (target: Element, type: string) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7 }));
    // A press elsewhere on the page, then a move: nothing is measured.
    fire(document.body, "pointerdown");
    fire(document.body, "pointermove");
    expect(grab()).toBe("");
    // A move with nothing pressed: nothing either.
    fire(document.body, "pointerup");
    fire(sheet, "pointermove");
    expect(grab()).toBe("");
    // A press on the sheet at rest: it is 0px from rest, and stays so for that press.
    fire(sheet, "pointerdown");
    expect(grab()).toBe("0px");
    fire(sheet, "pointerup");
    // A press while the sheet is still moving: each move measures again.
    const moving = sheet.animate([{ transform: "translateY(25px)" }, { transform: "translateY(25px)" }], { duration: 60_000 });
    fire(sheet, "pointerdown");
    expect(grab()).toBe("25px");
    moving.effect!.updateTiming({ duration: 60_001 });
    (moving.effect as KeyframeEffect).setKeyframes([{ transform: "translateY(20px)" }, { transform: "translateY(20px)" }]);
    fire(sheet, "pointermove");
    expect(grab()).toBe("20px");
    // Once a move finds it standing still, the measuring stops for the rest of the press: no style is read on later moves.
    moving.cancel();
    fire(sheet, "pointermove");
    expect(grab()).toBe("0px");
    const read = vi.spyOn(window, "getComputedStyle");
    sheet.style.transform = "translateY(50px)";
    fire(sheet, "pointermove");
    fire(sheet, "pointermove");
    expect(read).not.toHaveBeenCalled();
    expect(grab()).toBe("0px");
    read.mockRestore();
    sheet.style.transform = "";
    // A new press measures afresh, and the end of a press stops it too.
    const again = sheet.animate([{ transform: "translateY(25px)" }, { transform: "translateY(25px)" }], { duration: 60_000 });
    fire(sheet, "pointerdown");
    expect(grab()).toBe("25px");
    fire(sheet, "pointercancel");
    again.cancel();
    fire(sheet, "pointermove");
    expect(grab()).toBe("25px");
    // Released, the measurement no longer moves the sheet.
    expect(getComputedStyle(sheet).getPropertyValue("--ouro-sheet-grab")).toBe("0px");
  });

  it("measures nothing in a viewport that holds no popup, and stops listening when it unmounts", async () => {
    await render(
      <SheetRoot defaultOpen>
        <SheetPortal>
          <SheetViewport>
            <p>No popup yet</p>
          </SheetViewport>
        </SheetPortal>
      </SheetRoot>,
    );
    await expect.poll(() => viewport()).not.toBeNull();
    const layer = viewport()!;
    expect(() => layer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))).not.toThrow();
    const removed = vi.spyOn(window, "removeEventListener");
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    expect(removed.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(["pointercancel", "pointerdown", "pointermove", "pointerup"]));
    removed.mockRestore();
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
