import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { CopyButton } from "~/components/ouro/copy-button/copy-button";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

it("is at least 44px square to a finger, with or without its label", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <CopyButton value="x" />
        <CopyButton value="x" hideLabel />
      </>,
    ),
  );
  for (const button of host.querySelectorAll<HTMLElement>('[data-ouro-control="copy-button"]')) {
    const target = button.querySelector<HTMLElement>("[data-ouro-touch-target]") ?? button;
    const rect = target.getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.width).toBeGreaterThanOrEqual(44);
  }
});
