import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { FileField } from "~/components/ouro/file-field/file-field";
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

it("keeps 16px prompt text and a remove button with a 44px hit area on a landscape phone", async () => {
  await rotate(844, 390);
  const host = await render(<FileField label="Files" multiple />);
  const zone = host.querySelector<HTMLElement>("[data-ouro-drop-zone]")!;
  expect(parseFloat(getComputedStyle(zone.querySelector("span")!).fontSize)).toBe(16);
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "a.txt", { type: "text/plain" }));
    input.files = data.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const remove = [...host.querySelectorAll<HTMLElement>("[data-ouro-file-remove]")].find((button) => button.textContent === "Remove a.txt")!;
  const rect = remove.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  expect(document.elementFromPoint(cx, cy - 21)?.closest("button")).toBe(remove);
  expect(document.elementFromPoint(cx, cy + 21)?.closest("button")).toBe(remove);
});
