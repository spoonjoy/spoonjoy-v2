import { afterEach, expect, it } from "vitest";

// Ouro UI's dialogs and sheets render into <body> inside an isolated portal, so without Spoonjoy's
// portal rule (app/styles/tailwind.css) their layers stack at level 0 and the phone tab bar (z-50)
// covers the bottom of a sheet. The portal is lifted to z-60, below Spoonjoy's toasts (z-80).
// This runs in real browsers (vitest.ouro.config.ts loads app/styles/tailwind.css).

afterEach(() => {
  document.body.innerHTML = "";
});

const layerAtBottom = () =>
  document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 10)?.closest("[id]")?.id;

it.each(["sheet-portal", "dialog-portal"])("puts the %s above the phone tab bar", (portal) => {
  document.body.innerHTML = `
    <nav id="tab-bar" style="position: fixed; inset: auto 0 0 0; height: 80px; z-index: 50"></nav>
    <div data-ouro="${portal}" class="isolate">
      <div id="ouro-layer" style="position: fixed; inset: 0; z-index: 1000"></div>
    </div>
  `;
  expect(layerAtBottom()).toBe("ouro-layer");
});

it("keeps Spoonjoy's toasts above an open sheet", () => {
  document.body.innerHTML = `
    <div data-ouro="sheet-portal" class="isolate">
      <div id="ouro-layer" style="position: fixed; inset: 0; z-index: 1000"></div>
    </div>
    <div id="toast" style="position: fixed; inset: auto 0 0 0; height: 80px; z-index: 80"></div>
  `;
  expect(layerAtBottom()).toBe("toast");
});
