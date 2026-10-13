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
