import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Tooltip, type TooltipProps } from "~/components/ouro/tooltip/tooltip";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

// Runs in Chromium and WebKit.

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "120px 400px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await page.viewport(1280, 800);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await userEvent.unhover(document.body);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

const warnings = () => warn.mock.calls.map((call: unknown[]) => call[0]);
const tooltip = () => document.querySelector<HTMLElement>('[data-ouro="tooltip"]');
const trigger = () => document.querySelector<HTMLElement>('[data-ouro="button"]')!;

async function shown() {
  await expect
    .poll(() => {
      const element = tooltip();
      return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
    })
    .toBe(true);
  return tooltip()!;
}

async function renderTooltip(props: Partial<TooltipProps> = {}) {
  return render(
    <Tooltip content="Add to cookbook" {...(props as object)}>
      {props.children ?? <Button>Save</Button>}
    </Tooltip>,
  );
}

describe("Tooltip", () => {
  it("shows its content above the trigger on hover, and hides it when the pointer leaves", async () => {
    await renderTooltip();
    await userEvent.hover(trigger());
    const element = await shown();
    expect(element.textContent).toBe("Add to cookbook");
    const box = element.getBoundingClientRect();
    const anchor = trigger().getBoundingClientRect();
    // The trigger's edge can be fractional, and the tooltip lands on a whole pixel.
    expect(Math.abs(anchor.top - box.bottom - 6)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.left + box.width / 2 - (anchor.left + anchor.width / 2))).toBeLessThanOrEqual(1);
    await userEvent.unhover(trigger());
    await expect.poll(() => tooltip()).toBeNull();
  });

  it("shows on keyboard focus and hides on Escape", async () => {
    await renderTooltip();
    await pressTab();
    expect(document.activeElement).toBe(trigger());
    await shown();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tooltip()).toBeNull();
  });

  it.each([
    ["bottom", "start"],
    ["right", "end"],
  ] as const)("sits on side %s, aligned %s", async (side, align) => {
    await renderTooltip({ side, align });
    await userEvent.hover(trigger());
    const element = await shown();
    expect(element.getAttribute("data-side")).toBe(side);
    expect(element.getAttribute("data-align")).toBe(align);
  });

  it("never opens after a touch on the trigger, even when the touch focuses it", async () => {
    await renderTooltip();
    await act(() => trigger().dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true })));
    await act(async () => trigger().focus({ focusVisible: true } as FocusOptions));
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(tooltip()).toBeNull();
    // A later key press counts as the keyboard again.
    trigger().blur();
    await userEvent.keyboard("{Shift}");
    await act(async () => trigger().focus());
    await shown();
  });

  it("opens on mouse hover after a touch elsewhere, as on a laptop with a touchscreen", async () => {
    await render(
      <>
        <button type="button">Other</button>
        <Tooltip content="Add to cookbook">
          <Button>Save</Button>
        </Tooltip>
      </>,
    );
    const other = page.getByRole("button", { name: "Other" }).element();
    await act(() => other.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true })));
    await userEvent.hover(trigger());
    await shown();
  });

  it("keeps the trigger's own props and ref", async () => {
    const onClick = vi.fn();
    let received: HTMLElement | null = null;
    await renderTooltip({
      children: (
        <Button onClick={onClick} ref={(node) => void (received = node)}>
          Save
        </Button>
      ),
    });
    await userEvent.click(trigger());
    expect(onClick).toHaveBeenCalledOnce();
    expect(received).toBe(trigger());
  });

  it("portals at the --ouro-layer level, as its own stacking context", async () => {
    await renderTooltip();
    await userEvent.hover(trigger());
    await shown();
    const portal = document.querySelector<HTMLElement>('[data-ouro="tooltip-portal"]')!;
    const style = getComputedStyle(portal);
    expect(style.position).toBe("relative");
    expect(style.isolation).toBe("isolate");
    expect(style.zIndex).toBe(getComputedStyle(document.documentElement).getPropertyValue("--ouro-layer").trim());
  });

  it("grows from its trigger in 150ms on the ease-out token", async () => {
    await renderTooltip();
    await userEvent.hover(trigger());
    const element = await shown();
    element.style.setProperty("--transform-origin", "7px 3px");
    expect(getComputedStyle(element).transformOrigin).toBe("7px 3px");
    const style = getComputedStyle(element);
    expect(style.transitionProperty).toBe("transform, opacity");
    expect(style.transitionDuration.split(", ")[0]).toBe("0.15s");
    expect(style.transitionTimingFunction.split(/,\s(?![^(]*\))/)[0]).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
  });

  it("closes or stays put when its button is pressed, never moving against the scaled button", async () => {
    await renderTooltip();
    await userEvent.hover(trigger());
    await shown();
    const rest = JSON.stringify(document.querySelector<HTMLElement>('[data-ouro="tooltip-positioner"]')!.getBoundingClientRect());
    await commands.pointerPress({ selector: '[data-ouro="button"]', action: "down" });
    try {
      await expect.poll(() => getComputedStyle(trigger()).scale).toBe("0.97");
      // Base UI closes a tooltip on pointer-down; if it were kept, it must not have moved.
      const kept = document.querySelector<HTMLElement>('[data-ouro="tooltip-positioner"]');
      expect(kept === null || JSON.stringify(kept.getBoundingClientRect()) === rest).toBe(true);
    } finally {
      await commands.pointerPress({ selector: '[data-ouro="button"]', action: "up" });
    }
  });

  it("fades without scaling under reduced motion", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await renderTooltip();
    await userEvent.hover(trigger());
    const element = await shown();
    expect(getComputedStyle(element).transitionProperty).toBe("opacity");
  });

  it("renders only its trigger on the server", () => {
    const html = renderToString(
      <Tooltip content="Add">
        <Button>Save</Button>
      </Tooltip>,
    );
    expect(html).toContain(">Save<");
    expect(html).not.toContain("Add");
  });
});

describe("Tooltip delay group", () => {
  it("opens a neighbour instantly once one tooltip is showing, inside OuroProvider", async () => {
    await render(
      <OuroProvider>
        <Tooltip content="First">
          <Button>One</Button>
        </Tooltip>
        <Tooltip content="Second">
          <Button>Two</Button>
        </Tooltip>
      </OuroProvider>,
    );
    const [one, two] = [...document.querySelectorAll<HTMLElement>('[data-ouro="button"]')];
    await userEvent.hover(one!);
    await shown();
    await userEvent.hover(two!);
    await expect.poll(() => tooltip()?.textContent).toBe("Second");
    expect(tooltip()!.getAttribute("data-instant")).not.toBeNull();
  });
});

describe("Tooltip dev messages", () => {
  const essential = (detail: string) =>
    `[ouro-ui] Tooltip: ${detail}; a tooltip never opens on touch, so phone users never see it. Fix: move essential information out of the tooltip, into the page or a <Popover title="…">.`;

  it("warns when the content is long", async () => {
    const long = "Saving adds this recipe to the cookbook you pick, and everyone who shares that cookbook sees it.";
    await renderTooltip({ content: long });
    expect(warnings()).toEqual([essential(`content is ${long.length} characters, more than a label`)]);
  });

  it("warns when the content holds a link or a control, once it shows", async () => {
    await renderTooltip({ content: <a href="/help">Help</a> });
    expect(warnings()).toEqual([]);
    await userEvent.hover(trigger());
    await shown();
    expect(warnings()).toEqual([essential("content holds a link or control, which no one can reach")]);
  });

  it("does not count an element with tabindex -1 as a control", async () => {
    await renderTooltip({ content: <span tabIndex={-1}>Add</span> });
    await userEvent.hover(trigger());
    await shown();
    expect(warnings()).toEqual([]);
  });

  it("warns when the trigger has no name of its own", async () => {
    await renderTooltip({ children: <button type="button"><svg aria-hidden="true" width="16" height="16" /></button> });
    expect(warnings()).toEqual([
      '[ouro-ui] Tooltip: the trigger has no accessible name, and a tooltip is not one. Fix: <Button aria-label="Add to cookbook">.',
    ]);
  });

  it("names no label in the fix when the content is not text", async () => {
    await renderTooltip({ content: <strong>Add</strong>, children: <button type="button" /> });
    expect(warnings()).toEqual([
      '[ouro-ui] Tooltip: the trigger has no accessible name, and a tooltip is not one. Fix: <Button aria-label="…">.',
    ]);
  });

  it("warns once about guessed props and renders the defaults for values that are not Ouro UI's", async () => {
    await renderTooltip({ title: "x", delayDuration: 0, delay: 300, asChild: true, placement: "top", side: "above", align: "left" } as object);
    await userEvent.hover(trigger());
    const element = await shown();
    expect(element.getAttribute("data-side")).toBe("top");
    expect(element.getAttribute("data-align")).toBe("center");
    expect(warnings()).toEqual([
      '[ouro-ui] Tooltip: side="above" is not a side; use "top", "bottom", "left", "right". Fix: <Tooltip side="top">.',
      '[ouro-ui] Tooltip: align="left" is not an alignment; use "start", "center", "end" (left is "start", right is "end"). Fix: <Tooltip align="start">.',
      '[ouro-ui] Tooltip: placement is not a prop; Ouro UI splits it into side and align. Fix: <Tooltip side="bottom" align="start">.',
      '[ouro-ui] Tooltip: title is not a prop; the text is content. Fix: <Tooltip content="…">.',
      "[ouro-ui] Tooltip: delayDuration is not a prop; Ouro UI sets the delay, and OuroProvider groups tooltips. Fix: <OuroProvider><App /></OuroProvider>.",
      "[ouro-ui] Tooltip: delay is not a prop; Ouro UI sets the delay, and OuroProvider groups tooltips. Fix: <OuroProvider><App /></OuroProvider>.",
      '[ouro-ui] Tooltip: asChild is not a prop; the child is the trigger. Fix: <Tooltip content="…"><Button>…</Button></Tooltip>.',
    ]);
    expect(trigger().hasAttribute("title")).toBe(false);
  });
});
