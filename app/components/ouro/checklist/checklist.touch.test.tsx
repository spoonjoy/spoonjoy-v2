import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { Checklist, type ChecklistItemData } from "~/components/ouro/checklist/checklist";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  scrollTo(0, 0);
});

const many: ChecklistItemData[] = Array.from({ length: 24 }, (_, index) => ({ id: `item-${index}`, label: `ingredient ${index + 1}`, value: `${index + 1} g`, checked: false }));
let changes: Array<[string, boolean]> = [];

function Host() {
  const [items, setItems] = useState(many);
  return (
    <Checklist
      label="Ingredients"
      items={items}
      onCheckedChange={(id, checked) => {
        changes.push([id, checked]);
        setItems((list) => list.map((item) => (item.id === id ? { ...item, checked } : item)));
      }}
    />
  );
}

async function render() {
  changes = [];
  const host = document.createElement("div");
  host.style.padding = "16px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(<Host />));
  return host;
}

it("gives every row at least 44px to tap", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = await render();
  for (const label of host.querySelectorAll('[data-ouro-part="row"] label')) expect(label.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});

it("toggles a row with a tap anywhere on it", async () => {
  const host = await render();
  const value = host.querySelector<HTMLElement>('[data-ouro-part="value"]')!;
  const box = host.querySelector<HTMLElement>('[role="checkbox"]')!;
  const rect = value.getBoundingClientRect();
  await commands.touchStep({ type: "touchStart", x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  await commands.touchStep({ type: "touchEnd" });
  await expect.poll(() => box.getAttribute("aria-checked")).toBe("true");
  expect(changes).toEqual([["item-0", true]]);
});

it("scrolls with a vertical drag across the rows and toggles nothing", async () => {
  const host = await render();
  const rows = host.querySelector<HTMLElement>('[data-ouro-part="row"]')!.parentElement!.getBoundingClientRect();
  const x = rows.left + rows.width / 2;
  const y = Math.min(rows.bottom, innerHeight) - 60;
  await commands.touchDrag({ from: [x, y], to: [x, y - 300], steps: 12 });
  await expect.poll(() => scrollY).toBeGreaterThan(100);
  await act(async () => {});
  expect(changes).toEqual([]);
  expect(host.querySelectorAll('[aria-checked="true"]')).toHaveLength(0);
});
