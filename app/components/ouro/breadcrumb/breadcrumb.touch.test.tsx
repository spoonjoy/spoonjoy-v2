import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { commands, page } from "vitest/browser";
import { Breadcrumb } from "~/components/ouro/breadcrumb/breadcrumb";
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
  host.style.padding = "16px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

const long = [
  { label: "Home", href: "/" },
  { label: "Cookbooks", href: "/cookbooks" },
  { label: "Winter", href: "/cookbooks/winter" },
  { label: "Braises", href: "/cookbooks/winter/braises" },
  { label: "Short ribs", href: "/cookbooks/winter/braises/short-ribs" },
  { label: "Edit" },
];

describe("Breadcrumb on a phone", () => {
  it("keeps 44px targets with 16px text, also in landscape", async () => {
    const host = await render(<Breadcrumb items={long} />);
    expect(matchMedia("(pointer: coarse)").matches).toBe(true);
    for (const [width, height] of [
      [390, 844],
      [844, 390],
    ] as const) {
      await rotate(width, height);
      await expect.poll(() => innerWidth).toBe(width);
      const targets = [...host.querySelectorAll<HTMLElement>("a, button")];
      expect(targets.length).toBe(3);
      for (const target of targets) {
        expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(target.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
        expect(parseFloat(getComputedStyle(target).fontSize)).toBeGreaterThanOrEqual(16);
      }
      expect(parseFloat(getComputedStyle(host.querySelector('[aria-current="page"]')!).fontSize)).toBeGreaterThanOrEqual(16);
    }
  });

  it("opens the hidden crumbs as a bottom sheet on tap", async () => {
    await render(<Breadcrumb items={long} />);
    await commands.tap('[data-ouro="breadcrumb"] button');
    await expect.element(page.getByRole("menuitem", { name: "Winter" })).toBeVisible();
    const popup = page.getByRole("menu").element();
    // The sheet rises into place: wait for where it ends up, not for a moment without animations.
    await expect.poll(() => Math.round(popup.getBoundingClientRect().bottom)).toBe(innerHeight);
    await expect.poll(() => popup.getAnimations({ subtree: true }).length).toBe(0);
    await commands.tap('[role="menuitem"]:last-child');
    await expect.poll(() => page.getByRole("menu").elements().length).toBe(0);
  });
});
