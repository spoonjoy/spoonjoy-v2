import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { act } from "~/lib/ouro/testing/act";

// Spoonjoy's stylesheet switches every element's transitions off outside a theme switch, with an
// unlayered rule that beats Tailwind's layered transition utilities. Ouro UI's dialogs, sheets and
// buttons animate with those utilities, so the rule leaves out every [data-ouro] root and its
// descendants, and so does its reduced-motion rule, since Ouro UI honours reduced motion itself.
// Spoonjoy's own controls inside an Ouro dialog can opt out with sj-instant-state where their
// colours show state. This runs in real browsers
// (vitest.ouro.config.ts loads app/styles/tailwind.css), because happy-dom cannot match the selector.

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
}

const openDialog = () =>
  render(
    <Dialog title="Save to cookbook" presentation="dialog" open onOpenChange={() => undefined}>
      Weeknights
    </Dialog>,
  );

const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);

it("switches transitions off on the app's own elements", () => {
  document.body.innerHTML = `<main><button id="app-button" class="transition-colors">Save</button></main>`;
  expect(style("#app-button").transitionProperty).toBe("none");
});

it("keeps the transitions of an Ouro UI root and everything inside it", async () => {
  await openDialog();
  // The backdrop is an Ouro root; the Close button sits inside the dialog root.
  expect(style('[data-ouro="dialog-backdrop"]').transitionProperty).toBe("opacity");
  expect(style("[data-ouro-dialog-close]").transitionProperty).toContain("background-color");
});

it("shortens the app's transitions under reduced motion but leaves Ouro UI's own", async () => {
  await commands.emulateMedia({ reducedMotion: "reduce" });
  await openDialog();
  const app = document.createElement("button");
  app.id = "app-button";
  app.style.transition = "color 300ms";
  document.body.append(app);
  expect(style("#app-button").transitionDuration).not.toBe("0.3s");
  expect(style("[data-ouro-dialog-close]").transitionDuration).not.toMatch(/^(0\.000001s|1e-06s)$/);
});
