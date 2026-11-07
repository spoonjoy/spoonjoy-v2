import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { NumberField } from "~/components/ouro/number-field/number-field";
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

it("is 44px tall with 16px text, and its steppers have a 44px hit area, also on a landscape phone", async () => {
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ] as const) {
    await rotate(width, height);
    const host = await render(<NumberField label="Servings" defaultValue={4} />);
    const group = host.querySelector<HTMLElement>("[data-ouro-number-field-group]")!;
    expect(group.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(parseFloat(getComputedStyle(host.querySelector("input")!).fontSize)).toBeGreaterThanOrEqual(16);
    // Each stepper takes taps over at least 44x44px around its center.
    for (const button of host.querySelectorAll("button")) {
      const rect = button.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (const [dx, dy] of [
        [0, -21.5],
        [0, 21.5],
        [-21.5, 0],
        [21.5, 0],
      ] as const) {
        expect(document.elementFromPoint(cx + dx, cy + dy)?.closest("button"), `${button.getAttribute("aria-label")} ${dx},${dy}`).toBe(button);
      }
    }
    await act(async () => root!.unmount());
  }
});

it("steps with a tap on Increase, and does not scrub from the label", async () => {
  const onValueChange = vi.fn();
  const host = await render(<NumberField label="Servings" defaultValue={4} onValueChange={onValueChange} />);
  expect(host.querySelector("[data-ouro-number-field-scrub]")).toBeNull();
  await commands.tap("button[data-ouro-increment]");
  expect(onValueChange.mock.lastCall?.[0]).toBe(5);
  expect(host.querySelector("input")!.value).toBe("5");
});
