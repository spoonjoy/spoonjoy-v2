import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { RadioGroup } from "~/components/ouro/radio-group/radio-group";
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

const sizes = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

it("keeps each radio's 44px hit area clear of its neighbors'", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = await render(<RadioGroup legend="Size" options={sizes} />);
  const radios = [...host.querySelectorAll<HTMLElement>('[role="radio"]')];
  for (const radio of radios) {
    expect(radio.getBoundingClientRect().height).toBe(20);
    expect(tapTargets(radio, "radio")).toEqual([radio, radio]);
  }
});

it("picks on a tap on a label, and keeps the phone size on a landscape phone", async () => {
  await rotate(844, 390);
  const host = await render(<RadioGroup legend="Size" options={sizes} />);
  await commands.tap('[data-ouro="radio"]:nth-child(3) label');
  const radios = [...host.querySelectorAll<HTMLElement>('[role="radio"]')];
  expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
  expect(radios[0]!.getBoundingClientRect().height).toBe(20);
  expect(getComputedStyle(host.querySelector("label")!).fontSize).toBe("16px");
});
