import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { commands } from "vitest/browser";
import { act } from "~/lib/ouro/testing/act";
import { Button } from "~/components/ouro/button/button";
import { Popover } from "~/components/ouro/popover/popover";
import { rotate } from "~/lib/ouro/testing/rotate";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(() => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  await rotate(390, 844);
});

const popup = () => document.querySelector<HTMLElement>("[data-ouro-presentation]");
const TRIGGER = '[data-ouro="button"]';

async function mount(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "120px 16px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(() => root!.render(node));
}

/** Waits for the open popup's entrance, then for the initial focus to land in it. */
async function opened() {
  await expect
    .poll(() => {
      const element = popup();
      return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
    })
    .toBe(true);
  await expect.poll(() => popup()!.contains(document.activeElement)).toBe(true);
  return popup()!;
}

describe("Popover on a phone", () => {
  it("opens as a bottom sheet from a tap with presentation auto, and the sheet scrolls without closing", async () => {
    await mount(
      <Popover title="Filters" presentation="auto" trigger={<Button>Filters</Button>}>
        <div style={{ height: 2000 }}>Long list</div>
      </Popover>,
    );
    await commands.tap(TRIGGER);
    const element = await opened();
    expect(element.getAttribute("data-ouro-presentation")).toBe("sheet");
    expect(Math.round(element.getBoundingClientRect().bottom)).toBe(innerHeight);
    const content = element.querySelector<HTMLElement>("[data-ouro-sheet-content]") ?? element;
    content.scrollTop = 400;
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(popup()).toBe(element);
  });

  it("stays a popover beside the trigger by default, and focuses the popup, not its input, after a tap", async () => {
    await mount(
      <Popover title="Share recipe" trigger={<Button>Share</Button>}>
        <input aria-label="Link" />
      </Popover>,
    );
    await commands.tap(TRIGGER);
    const element = await opened();
    expect(element.getAttribute("data-ouro-presentation")).toBe("popover");
    expect(document.activeElement).toBe(element);
    // Fits the phone with 8px to spare at the edges.
    const box = element.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.right).toBeLessThanOrEqual(innerWidth - 8);
  });

  it("closes from a tap outside", async () => {
    await mount(
      <Popover title="Share recipe" trigger={<Button>Share</Button>}>
        Body
      </Popover>,
    );
    // On the page before the popover opens: Base UI ignores presses on elements added after it.
    const outside = document.createElement("div");
    Object.assign(outside.style, { position: "fixed", left: "0", bottom: "0", width: "100%", height: "80px" });
    outside.id = "outside";
    document.body.append(outside);
    nodes.push(outside);
    await commands.tap(TRIGGER);
    await opened();
    await commands.tap("#outside");
    await expect.poll(() => popup()).toBeNull();
  });
});
