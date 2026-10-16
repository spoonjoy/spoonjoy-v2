import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";
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

/** The element a tap at 21px above and below the control's center lands on, by role. */
function tapTargets(control: HTMLElement, role: string): (Element | null | undefined)[] {
  const rect = control.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return [cy - 21, cy + 21].map((y) => document.elementFromPoint(cx, y)?.closest(`[role="${role}"]`));
}

it("gives the box a 44px hit area, though it is 20px", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = await render(<Checkbox label="Basil" />);
  const box = host.querySelector<HTMLElement>('[role="checkbox"]')!;
  expect(box.getBoundingClientRect().height).toBe(20);
  expect(tapTargets(box, "checkbox")).toEqual([box, box]);
});

it("toggles on a tap on the box or the label", async () => {
  const host = await render(<Checkbox label="Basil" />);
  const box = host.querySelector<HTMLElement>('[role="checkbox"]')!;
  await commands.tap('[role="checkbox"]');
  expect(box.getAttribute("aria-checked")).toBe("true");
  await commands.tap("label");
  expect(box.getAttribute("aria-checked")).toBe("false");
});

it("keeps the 20px box and 16px label on a landscape phone, past the sm breakpoint", async () => {
  await rotate(844, 390);
  expect(matchMedia("(min-width: 640px)").matches).toBe(true);
  const host = await render(<Checkbox label="Basil" />);
  expect(host.querySelector<HTMLElement>('[role="checkbox"]')!.getBoundingClientRect().height).toBe(20);
  expect(getComputedStyle(host.querySelector("label")!).fontSize).toBe("16px");
});

it("toggles from a tap between two lines of a wrapped label", async () => {
  const host = await render(
    <div style={{ width: 200 }}>
      <Checkbox label="Send me the weekly shopping list and the recipe digest" />
    </div>,
  );
  const label = host.querySelector("label")!;
  const box = host.querySelector<HTMLElement>('[role="checkbox"]')!;
  const lines = [...label.getClientRects()];
  expect(lines.length).toBeGreaterThan(1);
  // The middle of the band between the first two lines of text.
  const x = lines[0]!.left + 10;
  const y = (lines[0]!.bottom + lines[1]!.top) / 2;
  expect(document.elementFromPoint(x, y)).toBe(label);
  // Every point down the label, from its first line to its last, is the label.
  const frame = label.closest<HTMLElement>("[data-ouro-label]")!.getBoundingClientRect();
  for (let at = Math.ceil(frame.top); at < frame.bottom; at += 1) expect(document.elementFromPoint(x, at)).toBe(label);
  await commands.touchStep({ type: "touchStart", x, y });
  await commands.touchStep({ type: "touchEnd" });
  await expect.poll(() => box.getAttribute("aria-checked")).toBe("true");
});
