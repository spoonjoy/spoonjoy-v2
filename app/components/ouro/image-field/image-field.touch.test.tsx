import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ImageField } from "~/components/ouro/image-field/image-field";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
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

const saved = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Crect width='60' height='60' fill='%23888'/%3E%3C/svg%3E";

it("gives Change photo and Remove a 44px hit area on a phone", async () => {
  const host = await render(<ImageField label="Photo" src={saved} onRemove={() => {}} />);
  for (const part of ["choose", "remove"]) {
    const button = host.querySelector<HTMLElement>(`[data-ouro-control="image-field"][data-ouro-part="${part}"]`)!;
    const rect = button.getBoundingClientRect();
    expect(rect.height).toBeLessThan(44);
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    expect(document.elementFromPoint(cx, cy - 21)?.closest("button")).toBe(button);
    expect(document.elementFromPoint(cx, cy + 21)?.closest("button")).toBe(button);
  }
});
