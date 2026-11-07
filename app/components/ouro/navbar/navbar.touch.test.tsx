import type { ComponentProps, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { commands, page } from "vitest/browser";
import { Navbar } from "~/components/ouro/navbar/navbar";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";
import { rotate } from "~/lib/ouro/testing/rotate";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  await rotate(390, 844);
});

const StayLink: OuroLinkComponent = ({ onClick, ...props }: ComponentProps<OuroLinkComponent>) => (
  <a
    {...props}
    onClick={(event) => {
      event.preventDefault();
      onClick?.(event);
    }}
  />
);

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(<OuroProvider linkComponent={StayLink}>{node}</OuroProvider>));
  return host;
}

const items = [
  { label: "Recipes", href: "/recipes" },
  { label: "Cookbooks", href: "/cookbooks" },
];

describe("Navbar on a phone", () => {
  it("opens the sheet on tap, with 44px links in 16px text, and closes on a link", async () => {
    const host = await render(<Navbar label="Main" items={items} currentPath="/recipes" />);
    expect(matchMedia("(pointer: coarse)").matches).toBe(true);
    const button = host.querySelector<HTMLElement>("[data-ouro-navbar-menu]")!;
    const target = button.querySelector<HTMLElement>("[data-ouro-touch-target]")!;
    expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(target.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    await commands.tap("[data-ouro-navbar-menu]");
    await expect.element(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await expect.poll(() => document.getAnimations().length).toBe(0);
    const links = page.getByRole("dialog").getByRole("link").elements();
    expect(links.length).toBe(2);
    for (const link of links) {
      expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(parseFloat(getComputedStyle(link).fontSize)).toBeGreaterThanOrEqual(16);
    }
    await commands.tap('[role="dialog"] a[href="/cookbooks"]');
    await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
  });

  it("keeps 44px links in 16px text in the bar in landscape, past the sm breakpoint", async () => {
    const host = await render(<Navbar label="Main" items={items} />);
    await rotate(844, 390);
    await expect.poll(() => innerWidth).toBe(844);
    await expect.element(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    const links = [...host.querySelectorAll<HTMLElement>("nav a")];
    expect(links.length).toBe(2);
    for (const link of links) {
      expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(link.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(parseFloat(getComputedStyle(link).fontSize)).toBeGreaterThanOrEqual(16);
    }
  });
});
