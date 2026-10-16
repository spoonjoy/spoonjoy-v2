import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { Collapsible } from "~/components/ouro/collapsible/collapsible";
import { ShowMore } from "~/components/ouro/collapsible/show-more";
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

it("keeps a 44px title with 16px text on a phone, also in landscape, and opens on tap", async () => {
  const host = await render(<Collapsible title="Facts">420 calories</Collapsible>);
  await expectTouchSize(host, "button[aria-expanded]");
  await commands.tap("button[aria-expanded]");
  expect(host.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("true");
});

it("gives Show more a 44px hit area and moves focus to the first new item on tap", async () => {
  const host = await render(<ShowMore initialCount={1} items={[<a key="a" href="#a">A</a>, <a key="b" href="#b">B</a>]} />);
  const button = host.querySelector<HTMLElement>("[data-ouro-show-more-toggle]")!;
  const rect = button.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  for (const y of [rect.top + rect.height / 2 - 21, rect.top + rect.height / 2 + 21]) {
    expect(document.elementFromPoint(cx, y)?.closest("[data-ouro-show-more-toggle]")).toBe(button);
  }
  await commands.tap("[data-ouro-show-more-toggle]");
  expect(document.activeElement).toBe(host.querySelectorAll("a")[1]);
});
