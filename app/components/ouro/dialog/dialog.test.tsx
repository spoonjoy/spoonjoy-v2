import { createRef, StrictMode, useState, type ReactElement, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Dialog, type DialogProps } from "~/components/ouro/dialog/dialog";
import {
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogPortal,
  AlertDialogRoot,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "~/components/ouro/dialog/dialog-parts";
import { act } from "~/lib/ouro/testing/act";
import { pageCss } from "~/lib/ouro/testing/page-css";

// Runs in Chromium and WebKit.


const FIX = "Pass trigger={<Button>…</Button>} for an uncontrolled dialog, or open and onOpenChange to control it.";

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

const popup = () => document.querySelector<HTMLElement>("[data-ouro-presentation]");
const dialogPopup = () => document.querySelector<HTMLElement>('[data-ouro="dialog"]');
const backdrop = () => document.querySelector<HTMLElement>('[data-ouro="dialog-backdrop"]');
const trigger = () => document.querySelector<HTMLElement>('[data-ouro="button"]')!;

/** Resolves after the next frame's animation callbacks. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until the open popup has finished its entrance (no starting style, no running transitions). */
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

async function openUncontrolled(props: Partial<DialogProps> = {}) {
  const children = props.children ?? (
    <label>
      Name <input aria-label="Name" />
    </label>
  );
  await render(
    <Dialog title="Edit recipe" trigger={<Button>Edit</Button>} {...(props as object)}>
      {children}
    </Dialog>,
  );
  await userEvent.click(trigger());
  await settled();
  return popup()!;
}

/**
 * The compiled app CSS with its iOS-only rules (`@supports (-webkit-touch-callout: none)`)
 * switched on. Desktop test browsers never match that query, so the test swaps it for one
 * every browser matches, instead of the components carrying a test-only selector.
 */
function withIosRules(css: string): string {
  return css.replace(/@supports \(-webkit-touch-callout: ?none\)/g, "@supports (display: block)");
}

describe("automatic presentation", () => {
  it("renders a centered dialog at 1280px", async () => {
    const element = await openUncontrolled();
    await expect.element(page.getByRole("dialog", { name: "Edit recipe" })).toBeVisible();
    expect(element.getAttribute("role")).toBe("dialog");
    expect(element.getAttribute("data-ouro")).toBe("dialog");
    expect(element.getAttribute("data-ouro-presentation")).toBe("dialog");
    expect(backdrop()).not.toBeNull();
    const rect = element.getBoundingClientRect();
    expect(Math.abs(rect.left + rect.width / 2 - innerWidth / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.top + rect.height / 2 - innerHeight / 2)).toBeLessThanOrEqual(1);
  });

  it("renders the bottom sheet at 390px", async () => {
    await page.viewport(390, 844);
    const element = await openUncontrolled();
    expect(element.getAttribute("data-ouro-presentation")).toBe("sheet");
    expect(element.getAttribute("data-ouro")).toBe("sheet");
    expect(element.getAttribute("data-side")).toBe("bottom");
    expect(element.getAttribute("role")).toBe("dialog");
    expect(dialogPopup()).toBeNull();
    expect(Math.round(element.getBoundingClientRect().bottom)).toBe(innerHeight);
  });

  it("follows presentation over the viewport", async () => {
    expect((await openUncontrolled({ presentation: "sheet" })).getAttribute("data-ouro-presentation")).toBe("sheet");
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    await page.viewport(390, 844);
    expect((await openUncontrolled({ presentation: "dialog" })).getAttribute("data-ouro-presentation")).toBe("dialog");
  });

  it("stays open in the new presentation when a resize crosses 640px, keeping controlled state", async () => {
    const onOpenChange = vi.fn();
    function Controlled() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog
          title="Edit recipe"
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
        >
          <input aria-label="Name" />
        </Dialog>
      );
    }
    await render(<Controlled />);
    await settled();
    expect(popup()!.getAttribute("data-ouro-presentation")).toBe("dialog");
    await page.viewport(390, 844);
    await expect.poll(() => popup()?.getAttribute("data-ouro-presentation")).toBe("sheet");
    await settled();
    await expect.element(page.getByRole("dialog", { name: "Edit recipe" })).toBeVisible();
    await page.viewport(1280, 800);
    await expect.poll(() => popup()?.getAttribute("data-ouro-presentation")).toBe("dialog");
    await settled();
    expect(onOpenChange).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("keeps an uncontrolled dialog open across a resize, and its trigger still opens it afterwards", async () => {
    await openUncontrolled();
    await page.viewport(390, 844);
    await expect.poll(() => popup()?.getAttribute("data-ouro-presentation")).toBe("sheet");
    await settled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    await userEvent.click(trigger());
    await settled();
    expect(popup()!.getAttribute("data-ouro-presentation")).toBe("sheet");
  });
});

describe("Dialog server rendering", () => {
  it("renders on the server without throwing or rendering the popup", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <Dialog title="t" trigger={<Button>o</Button>}>
        x
      </Dialog>,
    );
    expect(html).toContain(">o<");
    expect(html).not.toContain("data-ouro-presentation");
    expect(error).not.toHaveBeenCalled();
  });

  it("renders a trigger that a Server Component passed as a lazy wrapper", () => {
    // What React's Flight client hands a client component for an element prop
    // (https://github.com/facebook/react/issues/32392): no `type` and no `props`.
    const fromServer = { $$typeof: Symbol.for("react.lazy"), _payload: <Button>o</Button>, _init: (payload: unknown) => payload } as unknown as ReactElement;
    const html = renderToString(
      <Dialog title="t" trigger={fromServer}>
        x
      </Dialog>,
    );
    expect(html).toContain(">o<");
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it.each([
    ["uncontrolled", () => <Dialog title="t" trigger={<Button>o</Button>}>x</Dialog>],
    ["closed and controlled", () => <Dialog title="t" open={false} onOpenChange={() => {}}>x</Dialog>],
  ])("hydrates a %s Dialog at 390px with no hydration error, then opens as a sheet", async (_name, app) => {
    await page.viewport(390, 844);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    host.innerHTML = renderToString(app());
    const serverTrigger = host.querySelector('[data-ouro="button"]');
    await act(async () => {
      roots.push(hydrateRoot(host, <StrictMode>{app()}</StrictMode>, { onRecoverableError: recoverable }));
    });
    // Let the media query settle on the phone width after hydration: React commits
    // inside act, and a frame passes, so any media change event has fired.
    await act(nextFrame);
    expect(error).not.toHaveBeenCalled();
    expect(recoverable).not.toHaveBeenCalled();
    // The server-rendered trigger node survives the switch to the sheet form.
    expect(host.querySelector('[data-ouro="button"]')).toBe(serverTrigger);
    if (serverTrigger) {
      await userEvent.click(trigger());
      await settled();
      expect(popup()!.getAttribute("data-ouro-presentation")).toBe("sheet");
    }
  });
});

describe("trigger", () => {
  it("keeps the same trigger node, and its keyboard focus, across resizes past 640px", async () => {
    await render(
      <Dialog title="Edit recipe" trigger={<Button>Edit</Button>}>
        Body
      </Dialog>,
    );
    const node = trigger();
    node.focus();
    for (const [width, height, wide] of [[390, 844, false], [1280, 800, true], [390, 844, false]] as const) {
      await page.viewport(width, height);
      await expect.poll(() => matchMedia("(min-width: 640px)").matches).toBe(wide);
      // The media change event fires before the next frame's callbacks; act commits the re-render.
      await act(nextFrame);
      expect(trigger()).toBe(node);
      expect(document.activeElement).toBe(node);
    }
    await userEvent.keyboard("{Enter}");
    await settled();
    expect(popup()!.getAttribute("data-ouro-presentation")).toBe("sheet");
    expect(node.getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    await expect.poll(() => document.activeElement).toBe(node);
    expect(node.getAttribute("aria-expanded")).toBe("false");
    expect(node.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("focuses the popup, not the first input, after a pen opens the centered dialog", async () => {
    await render(
      <Dialog title="Edit recipe" trigger={<Button>Edit</Button>}>
        <input aria-label="Name" />
      </Dialog>,
    );
    const node = trigger();
    // Separate dispatches, as a real pen press and its click are.
    await act(() => node.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "pen", bubbles: true })));
    await act(() => node.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true })));
    await settled();
    await expect.poll(() => document.activeElement).toBe(popup());
  });

  it("keeps the trigger's own ref and onClick, and stays closed when onClick prevents default", async () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    await render(
      <Dialog
        title="Edit recipe"
        trigger={
          <Button ref={ref} onClick={onClick}>
            Edit
          </Button>
        }
      >
        Body
      </Dialog>,
    );
    expect(ref.current).toBe(trigger());
    await userEvent.click(trigger());
    expect(onClick).toHaveBeenCalledOnce();
    // An open would be committed by now: the click is handled and React has flushed.
    await act(async () => {});
    expect(popup()).toBeNull();
  });

  it("opens from a trigger that a Server Component handed over as a lazy wrapper", async () => {
    const onClick = vi.fn();
    // What React's server-component client passes while the trigger's module is loading.
    const wrapper = { $$typeof: Symbol.for("react.lazy"), _payload: null, _init: () => <Button onClick={onClick}>Edit</Button> } as unknown as ReactElement;
    await render(
      <Dialog title="Edit recipe" trigger={wrapper}>
        Body
      </Dialog>,
    );
    expect(trigger().textContent).toBe("Edit");
    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    await userEvent.click(trigger());
    expect(onClick).toHaveBeenCalledOnce();
    await expect.poll(() => popup()).not.toBeNull();
  });
});

describe("Dialog stacking above the app's fixed bars", () => {
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
  const portal = () => document.querySelector<HTMLElement>('[data-ouro="dialog-portal"]')!;

  it("puts the portal on the --ouro-layer level, as its own stacking context", async () => {
    await render(
      <Dialog title="Edit recipe" open onOpenChange={() => {}}>
        Body
      </Dialog>,
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
      <Dialog title="Edit recipe" open onOpenChange={() => {}}>
        Body
      </Dialog>,
    );
    await settled();
    expect(document.body.lastElementChild).toBe(portal());
    expect(onTop(dialogPopup()!)).toBe(true);
  });

  it("stays above a fixed app bar added after it when the app raises --ouro-layer past the bar", async () => {
    const bar = layer();
    document.documentElement.style.setProperty("--ouro-layer", String(bar + 10));
    try {
      await render(
      <Dialog title="Edit recipe" open onOpenChange={() => {}}>
        Body
      </Dialog>,
    );
      await settled();
      // After the portal in the DOM, so at an equal level the bar would cover it.
      appBar(bar);
      expect(getComputedStyle(portal()).zIndex).toBe(String(bar + 10));
      expect(onTop(dialogPopup()!)).toBe(true);
    } finally {
      document.documentElement.style.removeProperty("--ouro-layer");
    }
  });
});

describe("centered dialog", () => {
  it("keeps the title clear of the close button in a right-to-left page", async () => {
    document.documentElement.dir = "rtl";
    try {
      await openUncontrolled({ title: "A title long enough to run into the close button if the header left it no room" });
      const close = (page.getByRole("dialog").getByRole("button", { name: "Close" }).element() as HTMLElement).getBoundingClientRect();
      const title = page.getByRole("dialog").getByRole("heading").element().getBoundingClientRect();
      // The close button sits at the inline end, the left in right-to-left text; the title stops short of it.
      expect(close.left).toBeLessThan(title.left);
      expect(title.left).toBeGreaterThanOrEqual(close.right);
    } finally {
      document.documentElement.removeAttribute("dir");
    }
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await openUncontrolled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    await expect.poll(() => document.activeElement).toBe(trigger());
  });

  it("closes from an outside press", async () => {
    await openUncontrolled();
    await userEvent.click(document.body, { position: { x: 10, y: 10 } });
    await expect.poll(() => popup()).toBeNull();
  });

  it("has a visible, compact close button in the top corner, labelled by closeLabel", async () => {
    const element = await openUncontrolled({ closeLabel: "Dismiss" });
    const close = page.getByRole("dialog").getByRole("button", { name: "Dismiss" });
    const button = close.element() as HTMLElement;
    const rect = button.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.width).toBeLessThanOrEqual(40);
    expect(rect.height).toBe(rect.width);
    expect(box.right - rect.right).toBeLessThanOrEqual(20);
    expect(rect.top - box.top).toBeLessThanOrEqual(20);
    expect(button.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    await userEvent.click(close);
    await expect.poll(() => popup()).toBeNull();
  });

  it("labels the close button Close by default", async () => {
    await openUncontrolled();
    await expect.element(page.getByRole("dialog").getByRole("button", { name: "Close" })).toBeVisible();
  });

  it("keeps the sheet's hidden-until-focused close control in sheet presentation", async () => {
    await page.viewport(390, 844);
    await openUncontrolled({ closeLabel: "Dismiss" });
    const close = page.getByRole("dialog").getByRole("button", { name: "Dismiss" }).element();
    expect(close.hasAttribute("data-ouro-sheet-close")).toBe(true);
    expect(close.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it.each([
    ["sm", 384],
    ["md", 512],
    ["lg", 640],
  ] as const)("caps size %s at %ipx wide", async (size, max) => {
    const element = await openUncontrolled({ size, children: <div style={{ width: 2000 }} /> } as Partial<DialogProps>);
    expect(element.getAttribute("data-size")).toBe(size);
    expect(element.getBoundingClientRect().width).toBe(max);
  });

  it("defaults to md", async () => {
    expect((await openUncontrolled()).getAttribute("data-size")).toBe("md");
  });

  it("hides the title visually with hideTitle and describes the dialog with description", async () => {
    const element = await openUncontrolled({ hideTitle: true, description: "Change the name." });
    await expect.element(page.getByRole("dialog", { name: "Edit recipe" })).toBeVisible();
    const title = document.querySelector<HTMLElement>("[data-ouro-dialog-title]")!;
    expect(title.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    const describedBy = element.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)!.textContent).toBe("Change the name.");
  });

  it("fits on a phone with side margins when presentation is dialog", async () => {
    await page.viewport(390, 844);
    const element = await openUncontrolled({ presentation: "dialog" });
    const rect = element.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(16);
    expect(innerWidth - rect.right).toBeGreaterThanOrEqual(16);
  });

  it("scrolls a tall body inside the dialog and keeps clear of the screen edges", async () => {
    const element = await openUncontrolled({ children: <div style={{ height: 3000 }} /> } as Partial<DialogProps>);
    const rect = element.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(16);
    expect(innerHeight - rect.bottom).toBeGreaterThanOrEqual(16);
    const body = element.querySelector<HTMLElement>("[data-ouro-dialog-content]")!;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
  });

  it("marks the popup and backdrop with data-ouro, and the portal isolates its stacking", async () => {
    await openUncontrolled();
    expect(dialogPopup()).not.toBeNull();
    expect(backdrop()).not.toBeNull();
    const portal = document.querySelector<HTMLElement>('[data-ouro="dialog-portal"]')!;
    expect(getComputedStyle(portal).isolation).toBe("isolate");
  });
});

describe("footer", () => {
  const footer = (
    <>
      <Button variant="outline" tone="secondary">
        Cancel
      </Button>
      <Button>Save</Button>
    </>
  );

  it("lays out actions in a row at the end on wide screens", async () => {
    const element = await openUncontrolled({ footer });
    const row = element.querySelector<HTMLElement>("[data-ouro-footer]")!;
    const [cancel, save] = [...row.children].map((child) => child.getBoundingClientRect());
    expect(Math.round(cancel!.top)).toBe(Math.round(save!.top));
    expect(cancel!.right).toBeLessThan(save!.left);
    expect(Math.abs(row.getBoundingClientRect().right - 20 - save!.right)).toBeLessThanOrEqual(1);
  });

  it.each(["dialog", "sheet"] as const)("stacks actions full width on phones, the primary at the bottom (%s)", async (presentation) => {
    await page.viewport(390, 844);
    const element = await openUncontrolled({ footer, presentation });
    const row = element.querySelector<HTMLElement>("[data-ouro-footer]")!;
    const [cancel, save] = [...row.children].map((child) => child.getBoundingClientRect());
    expect(cancel!.bottom).toBeLessThanOrEqual(save!.top);
    expect(cancel!.width).toBe(save!.width);
    expect(cancel!.width).toBeGreaterThan(row.getBoundingClientRect().width - 48);
  });
});

describe("motion", () => {
  const transitionOf = (element: HTMLElement, property: string) => {
    const style = getComputedStyle(element);
    const index = style.transitionProperty.split(", ").indexOf(property);
    return index === -1
      ? undefined
      : {
          duration: style.transitionDuration.split(", ")[index],
          easing: style.transitionTimingFunction.split(/,\s(?![^(]*\))/)[index],
        };
  };

  it("scales from 0.96 on the ease-out token and fades, entering in 300ms and leaving in 200ms", async () => {
    await render(
      <Dialog title="Edit recipe" trigger={<Button>Edit</Button>}>
        Body
      </Dialog>,
    );
    const seen: Array<{ phase: string; transform: string; opacity: string }> = [];
    const observer = new MutationObserver(() => {
      const element = dialogPopup();
      if (!element) return;
      for (const phase of ["data-starting-style", "data-ending-style"]) {
        if (element.hasAttribute(phase) && !seen.some((entry) => entry.phase === phase)) {
          // A running transition reports its in-between value; pause it to read the target.
          element.style.transition = "none";
          const style = getComputedStyle(element);
          seen.push({ phase, transform: style.transform, opacity: style.opacity });
          element.style.transition = "";
        }
      }
    });
    // Watch only the state attributes: the callback's own style writes must not re-trigger it.
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-starting-style", "data-ending-style"],
      childList: true,
      subtree: true,
    });
    await userEvent.click(trigger());
    await settled();
    const element = dialogPopup()!;
    const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";
    expect(transitionOf(element, "transform")).toEqual({ duration: "0.3s", easing: easeOut });
    expect(transitionOf(element, "opacity")).toEqual({ duration: "0.3s", easing: easeOut });
    expect(transitionOf(backdrop()!, "opacity")).toEqual({ duration: "0.3s", easing: easeOut });
    element.setAttribute("data-ending-style", "");
    backdrop()!.setAttribute("data-ending-style", "");
    for (const leaving of [element, backdrop()!]) {
      const style = getComputedStyle(leaving);
      expect(style.transitionDuration).toBe("0.2s");
      expect(style.transitionTimingFunction.split(/,\s(?![^(]*\))/)[0]).toBe(easeOut);
    }
    element.removeAttribute("data-ending-style");
    backdrop()!.removeAttribute("data-ending-style");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    observer.disconnect();
    const scale = (transform: string) => new DOMMatrix(transform).a;
    const start = seen.find((entry) => entry.phase === "data-starting-style")!;
    const end = seen.find((entry) => entry.phase === "data-ending-style")!;
    expect(scale(start.transform)).toBeCloseTo(0.96, 3);
    expect(start.opacity).toBe("0");
    expect(scale(end.transform)).toBeCloseTo(0.96, 3);
    expect(end.opacity).toBe("0");
  });

  it("stays centred: the dialog scales about its own middle, not its trigger", async () => {
    const element = await openUncontrolled();
    const box = element.getBoundingClientRect();
    const [x, y] = getComputedStyle(element).transformOrigin.split(" ").map(parseFloat);
    expect(x).toBeCloseTo(box.width / 2, 0);
    expect(y).toBeCloseTo(box.height / 2, 0);
  });

  it("fades the backdrop in to --ouro-backdrop-max", async () => {
    await openUncontrolled();
    await expect.poll(() => Number(getComputedStyle(backdrop()!).opacity)).toBeCloseTo(0.4, 2);
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

describe("Dialog close button press", () => {
  /** The close button's scale once the press transition has finished. (The tint is proven in dialog.touch.test.tsx, where hover cannot give the same colour.) */
  async function pressed() {
    const close = document.querySelector<HTMLElement>("[data-ouro-dialog-close]")!;
    await commands.pointerPress({ selector: "[data-ouro-dialog-close]", action: "down" });
    try {
      let last = "";
      await expect
        .poll(
          () => {
            const now = getComputedStyle(close).scale;
            const still = now === last && close.getAnimations().length === 0;
            last = now;
            return still;
          },
          { interval: 50 },
        )
        .toBe(true);
      return { scale: last, transition: getComputedStyle(close).transitionDuration };
    } finally {
      await commands.pointerPress({ selector: "[data-ouro-dialog-close]", action: "up" });
    }
  }

  it("shrinks to the press scale on pointer-down, in the press duration", async () => {
    await openUncontrolled();
    const result = await pressed();
    expect(result.scale).toBe("0.97");
    expect(result.transition.split(", ")[0]).toBe("0.16s");
  });

  it("does not scale under reduced motion", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await openUncontrolled();
    const result = await pressed();
    expect(result.scale).toBe("none");
  });
});

describe("Dialog iOS backdrop rule", () => {
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
    // Opened without a click, which would scroll the trigger into view.
    await render(
      <Dialog title="Scrolled" open onOpenChange={() => {}}>
        Body
      </Dialog>,
    );
    await settled();
    const layer = backdrop()!;
    expect(getComputedStyle(layer).position).toBe("absolute");
    await expect
      .poll(() => {
        const rect = layer.getBoundingClientRect();
        return rect.top <= 0 && rect.bottom >= innerHeight;
      })
      .toBe(true);
    expect(window.scrollY).toBe(2000);
    window.scrollTo(0, 0);
  });
});

describe("Dialog dev messages", () => {
  it("throws the exact fix when neither trigger nor open is passed", () => {
    // @ts-expect-error -- neither trigger nor open
    const dialog = <Dialog title="Edit">Body</Dialog>;
    expect(() => renderToString(dialog)).toThrow(`[ouro-ui] Dialog: needs trigger or open with onOpenChange. Fix: ${FIX}`);
  });

  it("throws the exact fix when both trigger and open are passed", () => {
    const dialog = (
      // @ts-expect-error -- both trigger and open
      <Dialog title="Edit" trigger={<Button>Edit</Button>} open onOpenChange={() => {}}>
        Body
      </Dialog>
    );
    expect(() => renderToString(dialog)).toThrow(`[ouro-ui] Dialog: takes trigger or open, not both. Fix: ${FIX}`);
  });

  it("throws the exact fix when open comes without onOpenChange", () => {
    // @ts-expect-error -- open without onOpenChange
    const dialog = <Dialog title="Edit" open>Body</Dialog>;
    expect(() => renderToString(dialog)).toThrow(`[ouro-ui] Dialog: open needs onOpenChange. Fix: ${FIX}`);
  });

  it.each([[""], [undefined]])("warns when the title is missing (%j): it names the dialog for screen readers", async (title) => {
    await openUncontrolled({ title } as object);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] Dialog: title is required; it names the dialog for screen readers. Fix: <Dialog title="Edit recipe">.',
    ]);
  });

  it("warns once about guessed props and drops them from the DOM", async () => {
    const guessed = { isOpen: true, onClose: () => {}, position: "bottom", side: "left", snapPoints: [0.5] } as object;
    const element = await openUncontrolled(guessed);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      "[ouro-ui] Dialog: isOpen is not a prop. Fix: <Dialog open={open} onOpenChange={setOpen}>.",
      "[ouro-ui] Dialog: onClose is not a prop. Fix: <Dialog open={open} onOpenChange={setOpen}>.",
      "[ouro-ui] Dialog: position is not a prop; a Dialog is centered, or a bottom sheet on phones. Fix: <Sheet side=\"bottom\">.",
      "[ouro-ui] Dialog: side is not a prop; a Dialog is centered, or a bottom sheet on phones. Fix: <Sheet side=\"left\">.",
      "[ouro-ui] Dialog: snapPoints is not a prop; a Dialog fits its content. Fix: <Sheet snapPoints={[0.5, 1]}>.",
    ]);
    for (const name of ["isopen", "position", "side", "snappoints"]) expect(element.hasAttribute(name)).toBe(false);
  });

  it("renders the md size and auto presentation for values that are not Ouro UI's, and warns once with each fix", async () => {
    const element = await openUncontrolled({ size: "xl", presentation: "modal" } as object);
    expect(element.getAttribute("data-size")).toBe("md");
    expect(element.getAttribute("data-ouro-presentation")).toBe("dialog");
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] Dialog: size="xl" is not a size; use "sm", "md", "lg". Fix: <Dialog size="md">.',
      '[ouro-ui] Dialog: presentation="modal" is not a presentation; use "auto", "dialog", "sheet". Fix: <Dialog presentation="auto">.',
    ]);
  });

  it.each([
    ["bg-white", ":root { --popover: …; } .dark { --popover: …; }"],
    ["rounded-none", ":root { --radius: 0px }"],
    ["text-lg", '<Dialog title="…"><div className="text-lg">…</div></Dialog>'],
  ])("warns about the appearance class %s once, as Dialog, in either presentation", async (token, fix) => {
    const element = await openUncontrolled({ className: `mt-4 ${token}` });
    expect(element.classList.contains("mt-4")).toBe(true);
    await page.viewport(390, 844);
    await expect.poll(() => popup()?.getAttribute("data-ouro-presentation")).toBe("sheet");
    expect(popup()!.classList.contains("mt-4")).toBe(true);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      `[ouro-ui] Dialog: "${token}" sets appearance, and className is for layout only. Fix: ${fix}.`,
    ]);
  });
});

describe("Dialog parts", () => {
  it("mark the buttons they render as the dialog's, and leave a rendered Button its own marker", async () => {
    await render(
      <DialogRoot>
        <DialogTrigger>Edit</DialogTrigger>
        <DialogTrigger render={<Button>Rename</Button>} />
        <DialogPortal>
          <DialogViewport>
            <DialogPopup>
              <DialogTitle>Parts</DialogTitle>
              <DialogContent>Body</DialogContent>
              <DialogClose>Close</DialogClose>
              <DialogClose render={<Button>Done</Button>} />
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </DialogRoot>,
    );
    const marks = () => [...document.querySelectorAll("button")].map((element) => `${element.getAttribute("data-ouro-control")}/${element.getAttribute("data-ouro-part")}`);
    expect(marks()).toEqual(["dialog/trigger", "button/root"]);
    await userEvent.click(page.getByRole("button", { name: "Edit" }));
    await expect.element(page.getByRole("dialog", { name: "Parts" })).toBeVisible();
    expect(marks()).toEqual(["dialog/trigger", "button/root", "dialog/close", "button/root"]);
    expect(document.querySelector("[data-ouro-dialog-content]")!.getAttribute("data-ouro-part")).toBe("content");
  });

  it("renders an md DialogPopup for a size that is not one of Ouro UI's, and warns once with the fix", async () => {
    await render(
      <DialogRoot open>
        <DialogPortal>
          <DialogViewport>
            <DialogPopup {...({ size: "xl" } as object)}>
              <DialogTitle>Parts</DialogTitle>
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </DialogRoot>,
    );
    await expect.poll(() => dialogPopup()?.getAttribute("data-size")).toBe("md");
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] DialogPopup: size="xl" is not a size; use "sm", "md", "lg". Fix: <DialogPopup size="md">.',
    ]);
  });

  it("AlertDialogRoot, the root ConfirmDialog uses, opens the same parts as an alert dialog", async () => {
    await render(
      <AlertDialogRoot open>
        <DialogPortal>
          <DialogViewport>
            <DialogPopup>
              <DialogTitle>Delete the recipe?</DialogTitle>
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </AlertDialogRoot>,
    );
    await expect.element(page.getByRole("alertdialog", { name: "Delete the recipe?" })).toBeVisible();
  });

  it("compose into a working dialog", async () => {
    const ref = createRef<HTMLDivElement>();
    await render(
      <DialogRoot>
        <DialogTrigger render={<Button>Open</Button>} />
        <DialogPortal>
          <DialogBackdrop ref={ref} />
          <DialogViewport>
            <DialogPopup className="mt-4" size="sm">
              <DialogTitle>Parts</DialogTitle>
              <DialogDescription>Built from parts.</DialogDescription>
              <DialogContent className="mt-2">Body</DialogContent>
              <DialogFooter>
                <DialogClose render={<Button>Done</Button>} />
              </DialogFooter>
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </DialogRoot>,
    );
    await userEvent.click(trigger());
    await expect.element(page.getByRole("dialog", { name: "Parts" })).toBeVisible();
    expect(dialogPopup()!.getAttribute("data-size")).toBe("sm");
    expect(ref.current).toBe(backdrop());
    await userEvent.click(page.getByRole("button", { name: "Done" }));
    await expect.poll(() => dialogPopup()).toBeNull();
  });

  it.each([
    ["DialogPopup", "bg-white", ":root { --popover: …; } .dark { --popover: …; }"],
    ["DialogContent", "text-lg", '<DialogContent><div className="text-lg">…</div></DialogContent>'],
  ])("%s warns about the appearance class %s", async (part, token, fix) => {
    await render(
      <DialogRoot defaultOpen>
        <DialogPortal>
          <DialogViewport>
            <DialogPopup className={part === "DialogPopup" ? token : undefined}>
              <DialogTitle>Checked</DialogTitle>
              <DialogContent className={part === "DialogContent" ? token : undefined}>Body</DialogContent>
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </DialogRoot>,
    );
    await expect.poll(() => dialogPopup()).not.toBeNull();
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      `[ouro-ui] ${part}: "${token}" sets appearance, and className is for layout only. Fix: ${fix}.`,
    ]);
  });

  const shape = (inner: string) =>
    `<DialogRoot><DialogTrigger render={<Button>Open</Button>} /><DialogPortal><DialogBackdrop /><DialogViewport><DialogPopup>${inner}</DialogPopup></DialogViewport></DialogPortal></DialogRoot>`;

  it.each([
    ["DialogTrigger", <DialogTrigger key="t" />, shape("…")],
    ["DialogPortal", <DialogPortal key="p" />, shape("…")],
    ["DialogBackdrop", <DialogBackdrop key="b" />, shape("…")],
    ["DialogViewport", <DialogViewport key="v" />, shape("…")],
    ["DialogPopup", <DialogPopup key="pp" />, shape("…")],
    ["DialogTitle", <DialogTitle key="ti">T</DialogTitle>, shape("<DialogTitle>…</DialogTitle>…")],
    ["DialogDescription", <DialogDescription key="d">D</DialogDescription>, shape("<DialogTitle>…</DialogTitle><DialogDescription>…</DialogDescription>…")],
    ["DialogContent", <DialogContent key="c" />, shape("<DialogTitle>…</DialogTitle><DialogContent>…</DialogContent>")],
    ["DialogFooter", <DialogFooter key="f" />, shape("<DialogTitle>…</DialogTitle><DialogContent>…</DialogContent><DialogFooter>…</DialogFooter>")],
    ["DialogClose", <DialogClose key="cl" />, shape("<DialogTitle>…</DialogTitle><DialogFooter><DialogClose>…</DialogClose></DialogFooter>")],
  ])("%s outside DialogRoot throws with the correct JSX shape", (name, element, jsx) => {
    expect(() => renderToString(element)).toThrow(`[ouro-ui] ${name}: must be rendered inside <DialogRoot>. Fix: ${jsx}.`);
  });
});
