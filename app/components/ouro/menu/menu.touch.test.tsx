import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { commands, page } from "vitest/browser";
import { act } from "~/lib/ouro/testing/act";
import { pressTint } from "~/lib/ouro/testing/press";
import { rotate } from "~/lib/ouro/testing/rotate";
import { pageCss } from "~/lib/ouro/testing/page-css";
import { Button } from "~/components/ouro/button/button";
import { Menu, MenuBar, MenuItem, MenuSub } from "~/components/ouro/menu/menu";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(() => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  await rotate(390, 844);
});

const menu = () => document.querySelector<HTMLElement>('[data-ouro="menu"]');
const area = () => document.querySelector<HTMLElement>("[data-testid=area]")!;

async function mount(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "120px 16px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(() => root!.render(node));
}

async function opened() {
  await expect
    .poll(() => {
      const element = menu();
      return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
    })
    .toBe(true);
  return menu()!;
}

/** A one-finger touch on the area, as the browser dispatches it. */
function touch(type: "touchstart" | "touchend", x: number, y: number) {
  const target = area();
  const point = new Touch({ identifier: 1, target, clientX: x, clientY: y });
  const touches = type === "touchend" ? [] : [point];
  target.dispatchEvent(new TouchEvent(type, { touches, targetTouches: touches, changedTouches: [point], bubbles: true, cancelable: true }));
}

describe("Menu on a phone", () => {
  it("opens a dropdown as a bottom sheet from a tap, with 44px items and 16px text", async () => {
    await mount(
      <Menu trigger={<Button>Actions</Button>}>
        <MenuItem>Edit</MenuItem>
        <MenuSub label="Share">
          <MenuItem>Copy link</MenuItem>
        </MenuSub>
      </Menu>,
    );
    await commands.tap('[data-ouro="button"]');
    const element = await opened();
    expect(element.getAttribute("data-ouro-presentation")).toBe("sheet");
    expect(Math.round(element.getBoundingClientRect().bottom)).toBe(innerHeight);
    for (const item of element.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
      expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(getComputedStyle(item).fontSize).toBe("16px");
    }
  });

  it("keeps 44px items in a landscape phone, where the width is above 640px", async () => {
    await rotate(844, 390);
    await mount(
      <Menu trigger={<Button>Actions</Button>}>
        <MenuItem>Edit</MenuItem>
      </Menu>,
    );
    await commands.tap('[data-ouro="button"]');
    const element = await opened();
    expect(element.getAttribute("data-ouro-presentation")).toBe("menu");
    const item = element.querySelector<HTMLElement>('[role="menuitem"]')!;
    expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(getComputedStyle(item).fontSize).toBe("16px");
  });

  it("gives menubar buttons a 44px height", async () => {
    await mount(
      <MenuBar>
        <Menu label="File">
          <MenuItem>New</MenuItem>
        </Menu>
      </MenuBar>,
    );
    const button = page.getByRole("menuitem", { name: "File" }).element();
    expect(button.getBoundingClientRect().height).toBe(44);
  });
});

describe("Menu long press", () => {
  it("opens the context menu at the finger without the iOS text-selection callout, only while pressing", async () => {
    const onOpenChange = vi.fn();
    await mount(
      <Menu onOpenChange={onOpenChange} contextTrigger={<div data-testid="area" style={{ height: 200 }}>Shakshuka, 4 servings</div>}>
        <MenuItem>Copy</MenuItem>
      </Menu>,
    );
    // The page's CSS turns off selection and the callout for a pressed area.
    expect(pageCss()).toMatch(/\[data-ouro-pressing\][^}]*-webkit-touch-callout: ?none/);
    expect(getComputedStyle(area()).userSelect).not.toBe("none");
    expect(area().style.getPropertyValue("-webkit-touch-callout")).toBe("");

    const box = area().getBoundingClientRect();
    touch("touchstart", box.left + 50, box.top + 40);
    expect(area().hasAttribute("data-ouro-pressing")).toBe(true);
    expect(getComputedStyle(area()).userSelect).toBe("none");
    // Base UI opens after a 500ms hold.
    const element = await opened();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(element.getAttribute("data-ouro-presentation")).toBe("menu");
    const popup = element.getBoundingClientRect();
    expect(Math.abs(popup.left - (box.left + 50))).toBeLessThanOrEqual(16);
    touch("touchend", box.left + 50, box.top + 40);
    expect(area().hasAttribute("data-ouro-pressing")).toBe(false);
    expect(getComputedStyle(area()).userSelect).not.toBe("none");
  });
});

describe("Menu items pressed on a phone", () => {
  it("tint on pointer-down, from the press alone", async () => {
    await mount(
      <Menu trigger={<Button>Actions</Button>}>
        <MenuItem>Edit</MenuItem>
        <MenuItem>Duplicate</MenuItem>
      </Menu>,
    );
    await commands.tap('[data-ouro="button"]');
    const element = await opened();
    const item = [...element.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    const { rest, pressed, active } = await pressTint(item, { clearHighlight: true });
    expect(active).toBe(true);
    expect(pressed).not.toBe(rest);
  });
});
