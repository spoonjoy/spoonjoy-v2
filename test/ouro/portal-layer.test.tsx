import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Sheet } from "~/components/ouro/sheet/sheet";
import { act } from "~/lib/ouro/testing/act";

// Ouro UI's dialogs and sheets render into <body> inside an isolated portal, so without Spoonjoy's
// portal rule (app/styles/tailwind.css) their layers stack at level 0 and the phone tab bar (z-50)
// covers the bottom of a sheet. The rule lifts the portals to z-60, below Spoonjoy's toasts (z-80).
// These render the real Ouro components, so a renamed portal fails here, not only in the journey.
// This runs in real browsers (vitest.ouro.config.ts loads app/styles/tailwind.css).

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
}

const noop = () => undefined;

const overlays = [
  {
    name: "Dialog",
    portal: "dialog-portal",
    node: (
      <Dialog title="Save to cookbook" presentation="dialog" open onOpenChange={noop}>
        Weeknights
      </Dialog>
    ),
  },
  {
    name: "Sheet",
    portal: "sheet-portal",
    node: (
      <Sheet title="Save to cookbook" open onOpenChange={noop}>
        Weeknights
      </Sheet>
    ),
  },
];

const fixedStrip = (id: string, zIndex: number) => {
  const strip = document.createElement("div");
  strip.id = id;
  strip.style.cssText = `position: fixed; inset: auto 0 0 0; height: 80px; z-index: ${zIndex}`;
  return strip;
};

const atBottom = () => document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 10);

it.each(overlays)("lifts Ouro UI's $name portal to z-60, above the phone tab bar", async ({ portal, node }) => {
  document.body.append(fixedStrip("tab-bar", 50));
  await render(node);

  const rendered = document.querySelector<HTMLElement>(`[data-ouro="${portal}"]`);
  expect(rendered).not.toBeNull();
  expect(getComputedStyle(rendered!).zIndex).toBe("60");
  expect(getComputedStyle(rendered!).position).toBe("relative");
  expect(rendered!.contains(atBottom())).toBe(true);
});

it.each(overlays)("keeps Spoonjoy's toasts above Ouro UI's $name", async ({ portal, node }) => {
  await render(node);
  document.body.append(fixedStrip("toast", 80));

  expect(document.querySelector(`[data-ouro="${portal}"]`)).not.toBeNull();
  expect(atBottom()?.id).toBe("toast");
});
