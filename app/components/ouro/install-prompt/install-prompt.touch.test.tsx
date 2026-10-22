import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { InstallPrompt } from "~/components/ouro/install-prompt/install-prompt";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

it("gives Install and Not now targets at least 44px square to a finger", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(<InstallPrompt />));
  await act(async () =>
    void window.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: "dismissed" }) }),
    ),
  );
  const buttons = host.querySelectorAll<HTMLElement>('[data-ouro-control="install-prompt"]');
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    const target = button.querySelector<HTMLElement>("[data-ouro-touch-target]") ?? button;
    const rect = target.getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.width).toBeGreaterThanOrEqual(44);
  }
});
