import { createRef, StrictMode, useRef, useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Tooltip } from "~/components/ouro/tooltip/tooltip";
import { Popover, type PopoverProps } from "~/components/ouro/popover/popover";
import {
  PopoverClose,
  PopoverDescription,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverRoot,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ouro/popover/popover-parts";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

// Runs in Chromium and WebKit.

const FIX = "Pass trigger={<Button>…</Button>} for an uncontrolled popover, or open and onOpenChange to control it.";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "200px 400px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, rerender: (next: ReactNode) => act(async () => root.render(next)) };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await page.viewport(1280, 800);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

const warnings = () => warn.mock.calls.map((call: unknown[]) => call[0]);
const popup = () => document.querySelector<HTMLElement>("[data-ouro-presentation]");
const popoverPopup = () => document.querySelector<HTMLElement>('[data-ouro="popover"]');
const trigger = () => document.querySelector<HTMLElement>('[data-ouro="button"]')!;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until the open popup has finished its entrance. */
async function settled() {
  await expect
    .poll(
      () => {
        const element = popup();
        return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
      },
      { interval: 50 },
    )
    .toBe(true);
}

async function openUncontrolled(props: Partial<PopoverProps> = {}) {
  await render(
    <Popover title="Share recipe" trigger={<Button>Share</Button>} {...(props as object)}>
      {props.children ?? <input aria-label="Link" />}
    </Popover>,
  );
  await userEvent.click(trigger());
  await settled();
  return popup()!;
}

describe("Popover", () => {
  it("opens below its trigger as a non-modal dialog named by its title", async () => {
    const element = await openUncontrolled({ description: "Anyone with the link can view it." });
    await expect.element(page.getByRole("dialog", { name: "Share recipe" })).toBeVisible();
    expect(element.getAttribute("data-ouro")).toBe("popover");
    expect(element.getAttribute("data-ouro-presentation")).toBe("popover");
    expect(element.getAttribute("aria-describedby")).toBe(document.querySelector("[data-ouro-popover-description]")!.id);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    const box = element.getBoundingClientRect();
    const anchor = trigger().getBoundingClientRect();
    expect(Math.round(box.top - anchor.bottom)).toBe(8);
    expect(Math.abs(box.left + box.width / 2 - (anchor.left + anchor.width / 2))).toBeLessThanOrEqual(1);
    // Non-modal: the page behind it stays scrollable and has no backdrop.
    expect(document.querySelector('[data-ouro="dialog-backdrop"], [data-ouro="sheet-backdrop"]')).toBeNull();
  });

  it.each([
    ["top", "start"],
    ["right", "end"],
    ["left", "center"],
  ] as const)("sits on side %s, aligned %s", async (side, align) => {
    const element = await openUncontrolled({ side, align });
    const box = element.getBoundingClientRect();
    const anchor = trigger().getBoundingClientRect();
    let diagnostic: string | undefined;
    if (side === "right" && align === "end") {
      const frames = [];
      let frameWindow: Window = window;
      for (let depth = 0; depth < 5; depth++) {
        const frame = frameWindow.frameElement;
        const parentWindow = frame?.ownerDocument.defaultView;
        frames.push({
          innerWidth: frameWindow.innerWidth,
          innerHeight: frameWindow.innerHeight,
          devicePixelRatio: frameWindow.devicePixelRatio,
          visualViewportScale: frameWindow.visualViewport?.scale,
          frameRect: frame?.getBoundingClientRect().toJSON(),
          frameTransform: frame && parentWindow ? parentWindow.getComputedStyle(frame).transform : null,
          frameZoom: frame && parentWindow ? parentWindow.getComputedStyle(frame).getPropertyValue("zoom") : null,
        });
        if (!parentWindow) break;
        frameWindow = parentWindow;
      }
      const geometry = () => {
        const positioner = element.closest<HTMLElement>('[data-ouro="popover-positioner"]');
        const style = getComputedStyle(element);
        const anchorStyle = getComputedStyle(trigger());
        return {
          box: element.getBoundingClientRect().toJSON(),
          anchor: trigger().getBoundingClientRect().toJSON(),
          popupOffsetHeight: element.offsetHeight,
          popupOffsetWidth: element.offsetWidth,
          positioner: positioner?.getBoundingClientRect().toJSON(),
          positionerStyle: positioner?.style.cssText,
          popupStyle: Object.fromEntries(
            ["height", "width", "scale", "translate", "transform", "font-size", "line-height", "box-sizing"].map((property) => [
              property, style.getPropertyValue(property),
            ]),
          ),
          anchorHeight: anchorStyle.height,
          anchorTransform: anchorStyle.transform,
          fontsStatus: document.fonts.status,
        };
      };
      const samples = [geometry()];
      await nextFrame();
      samples.push(geometry());
      await nextFrame();
      samples.push(geometry());
      diagnostic = `POPOVER_GEOMETRY ${JSON.stringify({
        originalBox: box.toJSON(),
        originalAnchor: anchor.toJSON(),
        originalEndMatches: Math.round(box.bottom) === Math.round(anchor.bottom),
        rawEndDelta: box.bottom - anchor.bottom,
        frames,
        samples,
      })}`;
    }
    if (side === "top") expect(Math.round(anchor.top - box.bottom)).toBe(8);
    if (side === "right") expect(Math.round(box.left - anchor.right)).toBe(8);
    if (side === "left") expect(Math.round(anchor.left - box.right)).toBe(8);
    if (align === "start") expect(Math.round(box.left)).toBe(Math.round(anchor.left));
    if (align === "end") expect(Math.round(box.bottom), diagnostic).toBe(Math.round(anchor.bottom));
    if (align === "center") expect(Math.abs(box.top + box.height / 2 - (anchor.top + anchor.height / 2))).toBeLessThanOrEqual(1);
    if (diagnostic) throw new Error(diagnostic);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await openUncontrolled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes from an outside press, and the trigger toggles it", async () => {
    await openUncontrolled();
    await userEvent.click(document.body, { position: { x: 5, y: 5 } });
    await expect.poll(() => popup()).toBeNull();
    await userEvent.click(trigger());
    await expect.poll(() => popup()).not.toBeNull();
    await userEvent.click(trigger());
    await expect.poll(() => popup()).toBeNull();
  });

  it("has a close button for screen readers, hidden until it has keyboard focus, labelled by closeLabel", async () => {
    const element = await openUncontrolled({ closeLabel: "Done" });
    const close = element.querySelector<HTMLElement>("[data-ouro-popover-close]")!;
    expect(close.textContent).toBe("Done");
    expect(close.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    // Focus starts on the first control; Tab reaches the close button last.
    await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Link");
    await pressTab();
    expect(document.activeElement).toBe(close);
    await expect.poll(() => close.getBoundingClientRect().width).toBeGreaterThan(1);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => popup()).toBeNull();
  });

  it("labels the close button Close by default", async () => {
    const element = await openUncontrolled();
    expect(element.querySelector("[data-ouro-popover-close]")!.textContent).toBe("Close");
  });

  it("hides the title visually with hideTitle and still names the popover", async () => {
    await openUncontrolled({ hideTitle: true });
    await expect.element(page.getByRole("dialog", { name: "Share recipe" })).toBeInTheDocument();
    expect(getComputedStyle(document.querySelector("[data-ouro-popover-title]")!).position).toBe("absolute");
  });

  it("is 18rem wide by default, and className sets layout", async () => {
    expect((await openUncontrolled()).getBoundingClientRect().width).toBe(288);
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    expect((await openUncontrolled({ className: "w-96" })).getBoundingClientRect().width).toBe(384);
  });

  it("scrolls a tall body inside the screen", async () => {
    await page.viewport(1280, 500);
    const element = await openUncontrolled({ children: <div style={{ height: 2000 }}>Tall</div> });
    expect(element.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight);
    const body = element.querySelector<HTMLElement>("[data-ouro-popover-content]")!;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
  });

  it("keeps the trigger's own ref and onClick", async () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    await render(
      <Popover
        title="Share recipe"
        trigger={
          <Button ref={ref} onClick={onClick}>
            Share
          </Button>
        }
      >
        Body
      </Popover>,
    );
    expect(ref.current).toBe(trigger());
    await userEvent.click(trigger());
    expect(onClick).toHaveBeenCalledOnce();
    await expect.poll(() => popup()).not.toBeNull();
  });
});

describe("Popover presentation", () => {
  it("stays a popover on a phone by default", async () => {
    await page.viewport(390, 844);
    expect((await openUncontrolled()).getAttribute("data-ouro-presentation")).toBe("popover");
  });

  it("is a bottom sheet below 640px with presentation auto, and a popover from 640px up", async () => {
    expect((await openUncontrolled({ presentation: "auto" })).getAttribute("data-ouro-presentation")).toBe("popover");
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    await page.viewport(390, 844);
    const element = await openUncontrolled({ presentation: "auto", description: "Anyone with the link." });
    expect(element.getAttribute("data-ouro-presentation")).toBe("sheet");
    expect(element.getAttribute("data-ouro")).toBe("sheet");
    expect(Math.round(element.getBoundingClientRect().bottom)).toBe(innerHeight);
    await expect.element(page.getByRole("dialog", { name: "Share recipe" })).toBeVisible();
    expect(element.textContent).toContain("Anyone with the link.");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(popoverPopup()).toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    await expect.poll(() => document.activeElement).toBe(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("is always a sheet with presentation sheet", async () => {
    expect((await openUncontrolled({ presentation: "sheet" })).getAttribute("data-ouro-presentation")).toBe("sheet");
  });

  it("stays open, with the same trigger node, when a resize crosses 640px", async () => {
    await openUncontrolled({ presentation: "auto" });
    const node = trigger();
    await page.viewport(390, 844);
    await expect.poll(() => popup()?.getAttribute("data-ouro-presentation")).toBe("sheet");
    expect(trigger()).toBe(node);
    await page.viewport(1280, 800);
    await expect.poll(() => popup()?.getAttribute("data-ouro-presentation")).toBe("popover");
    expect(trigger()).toBe(node);
  });

  it.each([
    ["uncontrolled", () => <Popover title="t" presentation="auto" trigger={<Button>o</Button>}>x</Popover>],
  ])("hydrates a %s auto Popover at 390px with no hydration error, keeping the server's trigger node", async (_name, app) => {
    await page.viewport(390, 844);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    host.innerHTML = renderToString(app());
    const serverTrigger = host.querySelector('[data-ouro="button"]');
    expect(serverTrigger).not.toBeNull();
    await act(async () => {
      roots.push(hydrateRoot(host, <StrictMode>{app()}</StrictMode>, { onRecoverableError: recoverable }));
    });
    await act(nextFrame);
    expect(error).not.toHaveBeenCalled();
    expect(recoverable).not.toHaveBeenCalled();
    expect(host.querySelector('[data-ouro="button"]')).toBe(serverTrigger);
    await userEvent.click(trigger());
    await settled();
    expect(popup()!.getAttribute("data-ouro-presentation")).toBe("sheet");
  });
});

describe("controlled Popover", () => {
  function Controlled({ onOpenChange, presentation }: { onOpenChange?: (open: boolean) => void; presentation?: "auto" }) {
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={anchor} type="button" onClick={() => setOpen((value) => !value)}>
          Filters
        </button>
        <Popover
          title="Filters"
          open={open}
          anchor={anchor}
          presentation={presentation}
          onOpenChange={(next) => {
            onOpenChange?.(next);
            setOpen(next);
          }}
        >
          <input aria-label="Search" />
        </Popover>
      </>
    );
  }

  it("positions against anchor, and the app's own toggle closes it without reopening", async () => {
    const onOpenChange = vi.fn();
    await render(<Controlled onOpenChange={onOpenChange} />);
    const toggle = page.getByRole("button", { name: "Filters" });
    await userEvent.click(toggle);
    await settled();
    const anchor = toggle.element().getBoundingClientRect();
    expect(Math.round(popup()!.getBoundingClientRect().top - anchor.bottom)).toBe(8);
    await userEvent.click(toggle);
    await expect.poll(() => popup()).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("calls onOpenChange(false) on Escape and from an outside press", async () => {
    const onOpenChange = vi.fn();
    await render(<Controlled onOpenChange={onOpenChange} />);
    await userEvent.click(page.getByRole("button", { name: "Filters" }));
    await settled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await userEvent.click(page.getByRole("button", { name: "Filters" }));
    await settled();
    await userEvent.click(document.body, { position: { x: 5, y: 5 } });
    await expect.poll(() => popup()).toBeNull();
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("focuses its first control after a keyboard open, and its popup after a pen tap", async () => {
    await render(<Controlled />);
    const toggle = page.getByRole("button", { name: "Filters" }).element() as HTMLElement;
    toggle.focus();
    await userEvent.keyboard("{Enter}");
    await settled();
    await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Search");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    await act(() => toggle.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "pen", bubbles: true })));
    await act(() => toggle.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true })));
    await settled();
    await expect.poll(() => document.activeElement).toBe(popup());
  });

  it("returns focus to anchor after a mouse open, as a popover and as a sheet", async () => {
    // Safari does not focus a button on click, so focus must go back to anchor by name.
    for (const width of [1280, 390]) {
      await page.viewport(width, 800);
      await render(<Controlled presentation="auto" />);
      const toggle = page.getByRole("button", { name: "Filters" }).element() as HTMLElement;
      await userEvent.click(toggle);
      await settled();
      expect(popup()!.getAttribute("data-ouro-presentation")).toBe(width === 390 ? "sheet" : "popover");
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => popup()).toBeNull();
      await expect.poll(() => document.activeElement).toBe(toggle);
      await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    }
  });

  it("presents as a sheet below 640px with presentation auto", async () => {
    await page.viewport(390, 844);
    await render(<Controlled presentation="auto" />);
    await userEvent.click(page.getByRole("button", { name: "Filters" }));
    await settled();
    expect(popup()!.getAttribute("data-ouro-presentation")).toBe("sheet");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
  });
});

describe("nested overlays", () => {
  const tooltip = () => document.querySelector('[data-ouro="tooltip"]');
  const popovers = () => document.querySelectorAll('[data-ouro="popover"]').length;

  it("closes only a Popover inside a Dialog on Escape, and returns focus to its trigger", async () => {
    await render(
      <Dialog title="Edit" trigger={<Button>Edit</Button>}>
        <Popover title="Share" trigger={<Button>Share</Button>}>
          <input aria-label="Link" />
        </Popover>
      </Dialog>,
    );
    await userEvent.click(page.getByRole("button", { name: "Edit" }));
    await expect.element(page.getByRole("dialog", { name: "Edit" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Share" }));
    await settled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popoverPopup()).toBeNull();
    expect(document.querySelector('[data-ouro="dialog"]')).not.toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe("Share");
  });

  it("closes only a Tooltip open inside a Popover on Escape", async () => {
    await render(
      <Popover title="Share" trigger={<Button>Share</Button>}>
        <Tooltip content="Copy link">
          <Button aria-label="Copy">C</Button>
        </Tooltip>
      </Popover>,
    );
    await userEvent.click(page.getByRole("button", { name: "Share" }));
    await settled();
    await pressTab();
    await pressTab({ shift: true });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Copy");
    await expect.poll(() => tooltip()).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tooltip()).toBeNull();
    await act(nextFrame);
    expect(popoverPopup()).not.toBeNull();
  });

  it("keeps the outer Popover open on a press inside an inner one, and Escape closes only the inner", async () => {
    await render(
      <Popover title="Outer" trigger={<Button>Outer</Button>}>
        <Popover title="Inner" trigger={<Button>Inner</Button>}>
          Inner body
        </Popover>
      </Popover>,
    );
    await userEvent.click(page.getByRole("button", { name: "Outer" }));
    await expect.element(page.getByRole("dialog", { name: "Outer" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Inner" }));
    await expect.element(page.getByRole("dialog", { name: "Inner" })).toBeVisible();
    await userEvent.click(page.getByText("Inner body"));
    await act(nextFrame);
    expect(popovers()).toBe(2);
    await userEvent.keyboard("{Escape}");
    await expect.poll(popovers).toBe(1);
    await expect.element(page.getByRole("dialog", { name: "Outer" })).toBeVisible();
  });

  it("opens from a trigger wrapped in a Tooltip, which still shows on hover", async () => {
    await render(
      <Popover
        title="Share"
        trigger={
          <Tooltip content="Share recipe">
            <Button aria-label="Share">S</Button>
          </Tooltip>
        }
      >
        Body
      </Popover>,
    );
    const button = page.getByRole("button", { name: "Share" });
    await userEvent.hover(button);
    await expect.poll(() => tooltip()?.textContent).toBe("Share recipe");
    await userEvent.click(button);
    await settled();
    expect(button.element().getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popoverPopup()).toBeNull();
    await userEvent.unhover(document.body);
    expect(warnings()).toEqual([]);
  });

  it("warns with the fix when a Tooltip wraps a Popover, which takes no trigger props", async () => {
    await render(
      <Tooltip content="Share recipe">
        <Popover title="Share" trigger={<Button aria-label="Share">S</Button>}>
          Body
        </Popover>
      </Tooltip>,
    );
    expect(warnings()).toEqual([
      '[ouro-ui] Tooltip: the trigger never received the tooltip\'s ref, so the tooltip cannot open; the child must pass its props and ref to an element, and Popover and Dialog do not. Fix: put the Tooltip inside the trigger: trigger={<Tooltip content="…"><Button …/></Tooltip>}.',
    ]);
  });
});

describe("Popover stacking", () => {
  const layer = () => Number(getComputedStyle(document.documentElement).getPropertyValue("--ouro-layer"));

  it("puts the portal on the --ouro-layer level, as its own stacking context", async () => {
    await openUncontrolled();
    const portal = document.querySelector<HTMLElement>('[data-ouro="popover-portal"]')!;
    const style = getComputedStyle(portal);
    expect(style.position).toBe("relative");
    expect(style.isolation).toBe("isolate");
    expect(style.zIndex).toBe(String(layer()));
    expect(document.body.lastElementChild).toBe(portal);
  });
});

describe("Popover motion", () => {
  const transitionOf = (element: HTMLElement, property: string) => {
    const style = getComputedStyle(element);
    const index = style.transitionProperty.split(", ").indexOf(property);
    return index === -1
      ? undefined
      : { duration: style.transitionDuration.split(", ")[index], easing: style.transitionTimingFunction.split(/,\s(?![^(]*\))/)[index] };
  };

  it("grows from the trigger's side on the ease-out token and fades", async () => {
    const element = await openUncontrolled();
    expect(transitionOf(element, "transform")!.easing).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
    expect(transitionOf(element, "transform")!.duration).toBe("0.2s");
    element.style.setProperty("--transform-origin", "7px 3px");
    expect(getComputedStyle(element).transformOrigin).toBe("7px 3px");
    element.style.transition = "none";
    element.setAttribute("data-starting-style", "");
    expect(new DOMMatrix(getComputedStyle(element).transform).a).toBeCloseTo(0.96, 3);
    expect(getComputedStyle(element).opacity).toBe("0");
    element.removeAttribute("data-starting-style");
    element.style.transition = "";
    element.setAttribute("data-ending-style", "");
    expect(getComputedStyle(element).transitionDuration).toBe("0.15s");
    element.removeAttribute("data-ending-style");
  });

  it("drops the scale under reduced motion and keeps the fade", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const element = await openUncontrolled();
    expect(transitionOf(element, "transform")).toBeUndefined();
    expect(transitionOf(element, "opacity")!.duration).not.toBe("0s");
    element.style.transition = "none";
    element.setAttribute("data-ending-style", "");
    expect(getComputedStyle(element).transform).toBe("none");
    expect(getComputedStyle(element).opacity).toBe("0");
    element.removeAttribute("data-ending-style");
  });
});

describe("Popover server rendering", () => {
  it("renders the trigger on the server without the popup", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <Popover title="t" trigger={<Button>o</Button>}>
        x
      </Popover>,
    );
    expect(html).toContain(">o<");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("data-ouro-presentation");
    expect(error).not.toHaveBeenCalled();
  });
});

describe("Popover dev messages", () => {
  it("throws the exact fix when neither trigger nor open is passed", () => {
    // @ts-expect-error -- neither trigger nor open
    const popover = <Popover title="Share">Body</Popover>;
    expect(() => renderToString(popover)).toThrow(`[ouro-ui] Popover: needs trigger or open with onOpenChange. Fix: ${FIX}`);
  });

  it("throws the exact fix when both trigger and open are passed", () => {
    // @ts-expect-error -- both trigger and open
    const popover = <Popover title="Share" trigger={<Button>Share</Button>} open onOpenChange={() => {}}>Body</Popover>;
    expect(() => renderToString(popover)).toThrow(`[ouro-ui] Popover: takes trigger or open, not both. Fix: ${FIX}`);
  });

  it("throws the exact fix when open comes without anchor", () => {
    // @ts-expect-error -- open without anchor
    const popover = <Popover title="Share" open onOpenChange={() => {}}>Body</Popover>;
    expect(() => renderToString(popover)).toThrow(
      "[ouro-ui] Popover: open needs anchor, the element it points at. Fix: <Popover open={open} onOpenChange={setOpen} anchor={buttonRef}>.",
    );
  });

  it.each([[""], [undefined]])("warns when the title is missing (%j)", async (title) => {
    await openUncontrolled({ title } as object);
    expect(warnings()).toEqual([
      '[ouro-ui] Popover: title is required; it names the popover for screen readers. Fix: <Popover title="Share recipe">.',
    ]);
  });

  it("warns once about guessed props and drops them from the DOM", async () => {
    const element = await openUncontrolled({ isOpen: true, onClose: () => {}, placement: "bottom-start", content: "x" } as object);
    expect(warnings()).toEqual([
      '[ouro-ui] Popover: placement is not a prop; Ouro UI splits it into side and align. Fix: <Popover side="bottom" align="start">.',
      "[ouro-ui] Popover: isOpen is not a prop. Fix: <Popover open={open} onOpenChange={setOpen} anchor={buttonRef}>.",
      "[ouro-ui] Popover: onClose is not a prop. Fix: <Popover open={open} onOpenChange={setOpen} anchor={buttonRef}>.",
      '[ouro-ui] Popover: content is not a prop; the body is children. Fix: <Popover title="…" trigger={…}>…</Popover>.',
    ]);
    for (const name of ["isopen", "placement", "content"]) expect(element.hasAttribute(name)).toBe(false);
  });

  it("renders the defaults for values that are not Ouro UI's, and warns once with each fix", async () => {
    const element = await openUncontrolled({ side: "above", align: "left", presentation: "modal" } as object);
    expect(element.getAttribute("data-side")).toBe("bottom");
    expect(element.getAttribute("data-align")).toBe("center");
    expect(element.getAttribute("data-ouro-presentation")).toBe("popover");
    expect(warnings()).toEqual([
      '[ouro-ui] Popover: side="above" is not a side; use "top", "bottom", "left", "right". Fix: <Popover side="bottom">.',
      '[ouro-ui] Popover: align="left" is not an alignment; use "start", "center", "end" (left is "start", right is "end"). Fix: <Popover align="start">.',
      '[ouro-ui] Popover: presentation="modal" is not a presentation; use "auto", "popover", "sheet". Fix: <Popover presentation="auto">.',
    ]);
  });

  it.each([
    ["bg-white", ":root { --popover: …; } .dark { --popover: …; }"],
    ["text-lg", '<Popover title="…"><div className="text-lg">…</div></Popover>'],
  ])("warns about the appearance class %s once", async (token, fix) => {
    const element = await openUncontrolled({ className: `mt-4 ${token}` });
    expect(element.classList.contains("mt-4")).toBe(true);
    expect(warnings()).toEqual([`[ouro-ui] Popover: "${token}" sets appearance, and className is for layout only. Fix: ${fix}.`]);
  });
});

describe("Popover parts", () => {
  it("compose into a working popover", async () => {
    await render(
      <PopoverRoot>
        <PopoverTrigger render={<Button>Open</Button>} />
        <PopoverPortal>
          <PopoverPositioner side="top" align="start">
            <PopoverPopup className="w-60">
              <PopoverTitle>Parts</PopoverTitle>
              <PopoverDescription>Built from parts.</PopoverDescription>
              <PopoverClose render={<Button>Done</Button>} />
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </PopoverRoot>,
    );
    await userEvent.click(trigger());
    await expect.element(page.getByRole("dialog", { name: "Parts" })).toBeVisible();
    expect(popoverPopup()!.getAttribute("data-side")).toBe("top");
    await expect.poll(() => popoverPopup()!.getBoundingClientRect().width).toBe(240);
    await userEvent.click(page.getByRole("button", { name: "Done" }));
    await expect.poll(() => popoverPopup()).toBeNull();
  });

  it("PopoverTitle hides visually, and PopoverClose without render is the screen-reader close button", async () => {
    await render(
      <PopoverRoot defaultOpen>
        <PopoverPortal>
          <PopoverPositioner>
            <PopoverPopup>
              <PopoverTitle visuallyHidden>Hidden</PopoverTitle>
              <PopoverClose>Close</PopoverClose>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </PopoverRoot>,
    );
    await expect.poll(() => popoverPopup()).not.toBeNull();
    expect(document.querySelector("[data-ouro-popover-title]")!.className).toBe("sr-only");
    expect(page.getByRole("button", { name: "Close" }).element().className).toContain("sr-only");
  });

  it("PopoverPositioner renders bottom center for values that are not Ouro UI's, and warns", async () => {
    await render(
      <PopoverRoot defaultOpen>
        <PopoverPortal>
          <PopoverPositioner {...({ side: "under", align: "middle" } as object)}>
            <PopoverPopup>
              <PopoverTitle>Checked</PopoverTitle>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </PopoverRoot>,
    );
    await expect.poll(() => popoverPopup()?.getAttribute("data-side")).toBe("bottom");
    expect(popoverPopup()!.getAttribute("data-align")).toBe("center");
    expect(warnings()).toEqual([
      '[ouro-ui] PopoverPositioner: side="under" is not a side; use "top", "bottom", "left", "right". Fix: <PopoverPositioner side="bottom">.',
      '[ouro-ui] PopoverPositioner: align="middle" is not an alignment; use "start", "center", "end" (left is "start", right is "end"). Fix: <PopoverPositioner align="start">.',
    ]);
  });

  it("PopoverPopup warns about an appearance class", async () => {
    await render(
      <PopoverRoot defaultOpen>
        <PopoverPortal>
          <PopoverPositioner>
            <PopoverPopup className="bg-white">
              <PopoverTitle>Checked</PopoverTitle>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </PopoverRoot>,
    );
    await expect.poll(() => popoverPopup()).not.toBeNull();
    expect(warnings()).toEqual([
      '[ouro-ui] PopoverPopup: "bg-white" sets appearance, and className is for layout only. Fix: :root { --popover: …; } .dark { --popover: …; }.',
    ]);
  });

  const shape = (inner: string) =>
    `<PopoverRoot><PopoverTrigger render={<Button>Open</Button>} /><PopoverPortal><PopoverPositioner><PopoverPopup>${inner}</PopoverPopup></PopoverPositioner></PopoverPortal></PopoverRoot>`;

  it.each([
    ["PopoverTrigger", <PopoverTrigger key="t" />, shape("…")],
    ["PopoverPortal", <PopoverPortal key="p" />, shape("…")],
    ["PopoverPositioner", <PopoverPositioner key="pos" />, shape("…")],
    ["PopoverPopup", <PopoverPopup key="pp" />, shape("…")],
    ["PopoverTitle", <PopoverTitle key="ti">T</PopoverTitle>, shape("<PopoverTitle>…</PopoverTitle>…")],
    ["PopoverDescription", <PopoverDescription key="d">D</PopoverDescription>, shape("<PopoverTitle>…</PopoverTitle><PopoverDescription>…</PopoverDescription>…")],
    ["PopoverClose", <PopoverClose key="c" />, shape("<PopoverTitle>…</PopoverTitle><PopoverClose>Close</PopoverClose>")],
  ])("%s outside PopoverRoot throws with the correct JSX shape", (name, element, jsx) => {
    expect(() => renderToString(element)).toThrow(`[ouro-ui] ${name}: must be rendered inside <PopoverRoot>. Fix: ${jsx}.`);
  });
});

describe("Popover trigger press", () => {
  it.each([
    ["an object", { color: "rgb(255, 0, 0)" }],
    ["a function of the state", () => ({ color: "rgb(255, 0, 0)" })],
  ] as const)("keeps the style a part's trigger is given as %s, and still cancels the press scale", async (_name, style) => {
    await render(
      <PopoverRoot>
        <PopoverTrigger render={<Button>Open</Button>} style={style} />
      </PopoverRoot>,
    );
    expect(getComputedStyle(trigger()).color).toBe("rgb(255, 0, 0)");
    expect(getComputedStyle(trigger()).getPropertyValue("--ouro-press-scale")).toBe("1");
  });

  const selector = '[data-ouro="button"]';

  it("keeps the trigger's box untransformed during a press and shows Button's pressed wash instead", async () => {
    await render(
      <Popover title="Share recipe" align="start" trigger={<Button>Share this recipe with others</Button>}>
        <input aria-label="Link" />
      </Popover>,
    );
    const box = JSON.stringify(trigger().getBoundingClientRect());
    await commands.pointerPress({ selector, action: "down" });
    try {
      await expect.poll(() => getComputedStyle(trigger(), "::before").opacity).toBe("0.14");
      // Button reads --ouro-press-scale, which the trigger sets to 1, so nothing scales.
      expect(["none","1"]).toContain(getComputedStyle(trigger()).scale);
      expect(JSON.stringify(trigger().getBoundingClientRect())).toBe(box);
    } finally {
      await commands.pointerPress({ selector, action: "up" });
    }
  });

  it("places the popover once: its positioner does not move while it enters", async () => {
    await render(
      <Popover title="Share recipe" align="start" trigger={<Button>Share this recipe with others</Button>}>
        <input aria-label="Link" />
      </Popover>,
    );
    const restLeft = trigger().getBoundingClientRect().left;
    const seen: Array<{ left: number; top: number }> = [];
    let sampling = true;
    const sample = () => {
      const positioner = document.querySelector<HTMLElement>('[data-ouro="popover-positioner"]');
      if (positioner) {
        const rect = positioner.getBoundingClientRect();
        if (!seen.length || seen.at(-1)!.left !== rect.left || seen.at(-1)!.top !== rect.top) seen.push({ left: rect.left, top: rect.top });
      }
      if (sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    await commands.pointerPress({ selector, action: "down" });
    // Hold until the press has fully arrived, so a scaled trigger would be at its smallest.
    await expect.poll(() => getComputedStyle(trigger(), "::before").opacity).toBe("0.14");
    await commands.pointerPress({ selector, action: "up" });
    await settled();
    await nextFrame();
    sampling = false;
    // Base UI mounts the positioner unplaced, then places it; a scaled trigger would add a third position.
    expect(seen.length).toBeLessThanOrEqual(2);
    expect(seen.at(-1)!.left).toBeCloseTo(restLeft, 1);
  });
});
