import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { CheckboxGroup } from "~/components/ouro/checkbox/checkbox-group";
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

const herbs = [
  { value: "basil", label: "Basil" },
  { value: "mint", label: "Mint" },
  { value: "sage", label: "Sage" },
];

it("keeps each box's 44px hit area clear of its neighbors'", async () => {
  const host = await render(<CheckboxGroup legend="Herbs" options={herbs} />);
  const boxes = [...host.querySelectorAll<HTMLElement>('[role="checkbox"]')];
  for (const box of boxes) expect(tapTargets(box, "checkbox")).toEqual([box, box]);
});

it("keeps the rows apart on a landscape phone, past the sm breakpoint", async () => {
  await rotate(844, 390);
  const host = await render(<CheckboxGroup legend="Herbs" options={herbs} />);
  const boxes = [...host.querySelectorAll<HTMLElement>('[role="checkbox"]')];
  for (const box of boxes) expect(tapTargets(box, "checkbox")).toEqual([box, box]);
  await commands.tap('[data-ouro="checkbox"]:nth-child(2) label');
  expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
});
