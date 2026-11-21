import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Field } from "~/components/ouro/field/field";
import { FieldControl } from "~/components/ouro/field/field-parts";
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

it("keeps a field's control 44px tall to a finger, even at a compact --spacing", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = await render(
    <Field label="Name">
      <FieldControl />
    </Field>,
  );
  const input = () => host.querySelector<HTMLInputElement>("input")!;
  expect(input().getBoundingClientRect().height).toBeCloseTo(44);
  host.style.setProperty("--spacing", "0.05rem");
  expect(input().getBoundingClientRect().height).toBeCloseTo(44);
});
