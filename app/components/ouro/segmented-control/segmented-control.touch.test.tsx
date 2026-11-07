import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { SegmentedControl } from "~/components/ouro/segmented-control/segmented-control";
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

const items = [
  { value: "a", label: "A" },
  { value: "b", label: "Grid" },
];

it("keeps 44px segments with 16px text on a phone, also in landscape", async () => {
  const host = await render(<SegmentedControl label="View" items={items} />);
  // The track is 44px; each segment inside it reaches 44px through its touch target.
  await expectTouchSize(host, '[role="radiogroup"]');
  for (const segment of host.querySelectorAll<HTMLElement>("[data-ouro-segment]")) {
    const rect = segment.getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(parseFloat(getComputedStyle(segment).fontSize)).toBeGreaterThanOrEqual(16);
    const cx = rect.left + rect.width / 2;
    for (const y of [rect.top + rect.height / 2 - 21, rect.top + rect.height / 2 + 21]) {
      expect(document.elementFromPoint(cx, y)?.closest("[data-ouro-segment]")).toBe(segment);
    }
  }
});

it("presses a segment on tap", async () => {
  const host = await render(<SegmentedControl label="View" items={items} />);
  await commands.tap("[data-ouro-segment]:nth-of-type(2)");
  expect(host.querySelectorAll("[data-ouro-segment]")[1]!.getAttribute("aria-checked")).toBe("true");
});
