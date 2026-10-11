import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { commands, page, userEvent } from "vitest/browser";
import { act } from "~/lib/ouro/testing/act";
import { Button } from "~/components/ouro/button/button";
import { Sheet } from "~/components/ouro/sheet/sheet";
import { Dialog } from "~/components/ouro/dialog/dialog";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(() => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  await page.viewport(390, 844);
});

const popup = () => document.querySelector<HTMLElement>('[data-ouro="dialog"]');
const anyPopup = () => document.querySelector<HTMLElement>("[data-ouro-presentation], [data-ouro='sheet']");
const TRIGGER = '[data-ouro="button"]';

async function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(() => root!.render(node));
}

/** Waits for the open popup's entrance, then for Base UI's initial focus to land in it. */
async function opened() {
  await expect
    .poll(() => {
      const element = anyPopup();
      return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
    })
    .toBe(true);
  await expect.poll(() => anyPopup()!.contains(document.activeElement)).toBe(true);
  return anyPopup()!;
}

const form = (
  <label>
    Name <input aria-label="Name" />
  </label>
);

/** What has focus, as a short label: "popup", "input", or the element's tag. */
function focusOf(popupElement: HTMLElement): string {
  const active = document.activeElement;
  if (active === popupElement) return "popup";
  if (active instanceof HTMLInputElement) return "input";
  return active?.tagName ?? "none";
}

describe("initial focus in the centered dialog (landscape phone, 844x390)", () => {
  it("focuses the popup, not the input, after a tap, so no keyboard pops up", async () => {
    await page.viewport(844, 390);
    await mount(<Dialog title="Edit recipe" trigger={<Button>Edit</Button>}>{form}</Dialog>);
    await commands.tap(TRIGGER);
    const element = await opened();
    expect(element.getAttribute("data-ouro-presentation")).toBe("dialog");
    expect(focusOf(element)).toBe("popup");
  });

  it("focuses the first tabbable element after a keyboard open (Enter on the trigger)", async () => {
    await page.viewport(844, 390);
    await mount(<Dialog title="Edit recipe" trigger={<Button>Edit</Button>}>{form}</Dialog>);
    document.querySelector<HTMLElement>(TRIGGER)!.focus();
    await userEvent.keyboard("{Enter}");
    const element = await opened();
    expect(element.getAttribute("data-ouro-presentation")).toBe("dialog");
    expect(focusOf(element)).toBe("input");
  });

  it("focuses the first tabbable element after a mouse click", async () => {
    await page.viewport(844, 390);
    await mount(<Dialog title="Edit recipe" trigger={<Button>Edit</Button>}>{form}</Dialog>);
    await userEvent.click(document.querySelector<HTMLElement>(TRIGGER)!);
    expect(focusOf(await opened())).toBe("input");
  });

  it("still runs the trigger's own onPointerDown", async () => {
    await page.viewport(844, 390);
    const types: string[] = [];
    await mount(
      <Dialog
        title="Edit recipe"
        trigger={<Button onPointerDown={(event) => types.push(event.pointerType)}>Edit</Button>}
      >
        {form}
      </Dialog>,
    );
    await commands.tap(TRIGGER);
    await opened();
    expect(types).toEqual(["touch"]);
  });
});

describe("initial focus in the sheet form matches a plain Sheet (390x844)", () => {
  async function focusAfter(open: "tap" | "keyboard", node: ReactNode) {
    await mount(node);
    if (open === "tap") await commands.tap(TRIGGER);
    else {
      document.querySelector<HTMLElement>(TRIGGER)!.focus();
      await userEvent.keyboard("{Enter}");
    }
    const focus = focusOf(await opened());
    await act(() => root!.unmount());
    for (const element of nodes.splice(0)) element.remove();
    return focus;
  }

  it.each(["tap", "keyboard"] as const)("after a %s open", async (open) => {
    const dialog = await focusAfter(open, <Dialog title="Edit recipe" trigger={<Button>Edit</Button>}>{form}</Dialog>);
    const sheet = await focusAfter(open, <Sheet title="Edit recipe" trigger={<Button>Edit</Button>}>{form}</Sheet>);
    expect(dialog).toBe(sheet);
    expect(dialog).toBe("popup");
  });
});

/** A controlled Dialog the app opens from its own button, as most apps do. */
function ControlledDialog({ presentation }: { presentation: "dialog" | "sheet" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-app-opener="" onClick={() => setOpen(true)}>
        Edit
      </button>
      <Dialog title="Edit recipe" presentation={presentation} open={open} onOpenChange={setOpen}>
        {form}
      </Dialog>
    </>
  );
}

const OPENER = "[data-app-opener]";

/** Opens with a real tap, or with Enter on the focused opener. */
async function openWith(open: "tap" | "keyboard") {
  if (open === "tap") await commands.tap(OPENER);
  else {
    document.querySelector<HTMLElement>(OPENER)!.focus();
    await userEvent.keyboard("{Enter}");
  }
  return opened();
}

describe("initial focus in a controlled dialog opened from the app's own button", () => {
  it("focuses the centered popup, not its first input, after a tap", async () => {
    await page.viewport(844, 390);
    await mount(<ControlledDialog presentation="dialog" />);
    const element = await openWith("tap");
    expect(element.getAttribute("data-ouro-presentation")).toBe("dialog");
    expect(focusOf(element)).toBe("popup");
  });

  it("focuses the centered popup's first input after a keyboard open", async () => {
    await page.viewport(844, 390);
    await mount(<ControlledDialog presentation="dialog" />);
    const element = await openWith("keyboard");
    expect(element.getAttribute("data-ouro-presentation")).toBe("dialog");
    expect(focusOf(element)).toBe("input");
  });

  it("focuses the centered popup's first input when a keyboard open follows a tap", async () => {
    await page.viewport(844, 390);
    await mount(<ControlledDialog presentation="dialog" />);
    await openWith("tap");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => anyPopup()).toBeNull();
    const element = await openWith("keyboard");
    expect(focusOf(element)).toBe("input");
  });

  it.each(["tap", "keyboard"] as const)("focuses the sheet popup after a %s, as a trigger-opened one does", async (open) => {
    await mount(<ControlledDialog presentation="sheet" />);
    const element = await openWith(open);
    expect(element.getAttribute("data-ouro-presentation")).toBe("sheet");
    expect(focusOf(element)).toBe("popup");
  });
});

it("gives the centered dialog's close button a 44px hit area on a coarse pointer", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(() =>
    root!.render(
      <Dialog title="Edit recipe" presentation="dialog" trigger={<Button>Edit</Button>}>
        Body
      </Dialog>,
    ),
  );
  await userEvent.click(host.querySelector<HTMLElement>('[data-ouro="button"]')!);
  await expect
    .poll(() => {
      const element = popup();
      return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
    })
    .toBe(true);

  const close = popup()!.querySelector<HTMLElement>("[data-ouro-dialog-close]")!;
  const rect = close.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const hits = (x: number, y: number) => document.elementFromPoint(x, y)?.closest("[data-ouro-dialog-close]") === close;

  // The visible button is smaller than 44px, so the probes below land outside it.
  expect(rect.width).toBeLessThan(44);
  expect(rect.height).toBeLessThan(44);
  // 2px outside the visible box on every side, still inside the 44px target.
  expect(hits(cx, rect.top - 2)).toBe(true);
  expect(hits(cx, rect.bottom + 2)).toBe(true);
  expect(hits(rect.left - 2, cy)).toBe(true);
  expect(hits(rect.right + 2, cy)).toBe(true);
  // Outside 44px it does not reach.
  expect(hits(cx - 23, cy)).toBe(false);
});
