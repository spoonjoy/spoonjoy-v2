import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { Tabs } from "~/components/ouro/tabs/tabs";
import { act } from "~/lib/ouro/testing/act";
import { rotate } from "~/lib/ouro/testing/rotate";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await rotate(390, 844);
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

/** Every target is at least 44px tall with 16px text, in portrait and in landscape past the sm breakpoint. */
async function expectTouchSize(host: HTMLElement, selector: string) {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ] as const) {
    await rotate(width, height);
    await expect.poll(() => innerWidth).toBe(width);
    const targets = [...host.querySelectorAll<HTMLElement>(selector)];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(parseFloat(getComputedStyle(target).fontSize)).toBeGreaterThanOrEqual(16);
    }
  }
}

it("keeps 44px tabs with 16px text on a phone, also in landscape", async () => {
  const host = await render(
    <Tabs
      label="Recipe"
      items={[
        { value: "a", label: "A", content: "Panel A" },
        { value: "b", label: "Method", content: "Panel B" },
      ]}
    />,
  );
  await expectTouchSize(host, '[role="tab"]');
  for (const tab of host.querySelectorAll('[role="tab"]')) expect(tab.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
});

it("selects a tab on tap", async () => {
  const host = await render(
    <Tabs
      label="Recipe"
      items={[
        { value: "a", label: "Ingredients", content: "Panel A" },
        { value: "b", label: "Method", content: "Panel B" },
      ]}
    />,
  );
  await commands.tap('[role="tab"]:nth-child(2)');
  expect(host.querySelectorAll('[role="tab"]')[1]!.getAttribute("aria-selected")).toBe("true");
});

it("keeps the selected tab in view in a row that scrolls, with the indicator under it and an edge fade", async () => {
  await rotate(390, 844);
  const items = Array.from({ length: 8 }, (_, index) => ({ value: `s${index}`, label: `Section ${index + 1}`, content: `Panel ${index + 1}` }));
  const host = await render(<Tabs label="Recipe" items={items} defaultValue="s7" />);
  const list = host.querySelector<HTMLElement>('[role="tablist"]')!;
  const tab = host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
  expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
  await expect.poll(() => list.scrollLeft).toBeGreaterThan(0);
  const listBox = list.getBoundingClientRect();
  const tabBox = tab.getBoundingClientRect();
  expect(tabBox.left).toBeGreaterThanOrEqual(listBox.left - 1);
  expect(tabBox.right).toBeLessThanOrEqual(listBox.right + 1);
  const indicator = host.querySelector<HTMLElement>("[data-ouro-tabs-indicator]")!;
  await expect.poll(() => Math.abs(indicator.getBoundingClientRect().left - tab.getBoundingClientRect().left)).toBeLessThanOrEqual(1);
  await expect.poll(() => list.getAttribute("data-fade")).toMatch(/left|both/);
});

it("stacks vertical tabs in a row on a phone", async () => {
  const host = await render(
    <Tabs
      label="Recipe"
      orientation="vertical"
      items={[
        { value: "a", label: "Ingredients", content: "Panel A" },
        { value: "b", label: "Method", content: "Panel B" },
      ]}
    />,
  );
  await rotate(390, 844);
  await expect.poll(() => host.querySelector('[role="tablist"]')!.getAttribute("data-orientation")).toBe("horizontal");
});
