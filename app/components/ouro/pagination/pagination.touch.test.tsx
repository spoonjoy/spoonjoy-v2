import type { ComponentProps, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { commands, page } from "vitest/browser";
import { Pagination } from "~/components/ouro/pagination/pagination";
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
  host.style.height = "100dvh";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(<OuroProvider linkComponent={StayLink}>{node}</OuroProvider>));
  return host;
}

/** Every target is at least 44px in both directions, with 16px text. */
function expectTouchSize(targets: Element[], count: number) {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  expect(targets.length).toBe(count);
  for (const target of targets) {
    const box = target.getBoundingClientRect();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(parseFloat(getComputedStyle(target).fontSize)).toBeGreaterThanOrEqual(16);
  }
}

describe("Pagination on a phone", () => {
  it("keeps 44px targets with 16px text, in portrait and with the page numbers in landscape", async () => {
    const host = await render(<Pagination page={6} pageCount={12} href="?page={page}" />);
    const shown = () => [...host.querySelectorAll<HTMLElement>("a")].filter((link) => link.getBoundingClientRect().width > 0);
    expectTouchSize(shown(), 2);
    expect(parseFloat(getComputedStyle(host.querySelector("[data-ouro-pagination-summary]")!).fontSize)).toBeGreaterThanOrEqual(16);
    expect(host.querySelector("nav")!.scrollWidth).toBeLessThanOrEqual(host.querySelector("nav")!.clientWidth);
    await rotate(844, 390);
    await expect.poll(() => innerWidth).toBe(844);
    await expect.element(page.getByRole("link", { name: "Page 12", exact: true })).toBeVisible();
    expectTouchSize(shown(), 7);
  });

  it("calls onPageChange on tap", async () => {
    let chosen = 0;
    await render(<Pagination page={1} pageCount={3} onPageChange={(next) => (chosen = next)} />);
    await commands.tap("[data-ouro-pagination-next]");
    expect(chosen).toBe(2);
  });
});
