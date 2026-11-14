import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Moment } from "~/components/ouro/moment/moment";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

it("gives the close button a target at least 44px square to a finger, in every layout", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <Moment kind="welcome" title="Welcome in" onDismiss={() => {}} />
        <Moment quiet title="No drafts" onDismiss={() => {}} />
        <Moment size="inline" title="Syncing" onDismiss={() => {}} />
      </>,
    ),
  );
  const buttons = host.querySelectorAll<HTMLElement>('[data-ouro-control="moment"]');
  expect(buttons).toHaveLength(3);
  for (const button of buttons) {
    const target = button.querySelector<HTMLElement>("[data-ouro-touch-target]") ?? button;
    const rect = target.getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.width).toBeGreaterThanOrEqual(44);
  }
});
