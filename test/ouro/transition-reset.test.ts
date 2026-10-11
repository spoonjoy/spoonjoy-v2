import { commands } from "vitest/browser";
import { afterEach, expect, it } from "vitest";

// Spoonjoy's stylesheet switches every element's transitions off outside a theme switch, with an
// unlayered rule that beats Tailwind's layered transition utilities. Ouro UI's dialogs, sheets and
// buttons animate with those utilities, so the rule leaves out every [data-ouro] root and its
// descendants, and so does its reduced-motion rule, since Ouro UI honours reduced motion itself.
// This runs in real browsers (vitest.ouro.config.ts loads app/styles/tailwind.css),
// because happy-dom cannot match the selector.

afterEach(async () => {
  document.body.innerHTML = "";
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

const transitionProperty = (id: string) => getComputedStyle(document.getElementById(id)!).transitionProperty;

it("switches transitions off on the app's own elements", () => {
  document.body.innerHTML = `<main><button id="app-button" class="transition-colors">Save</button></main>`;
  expect(transitionProperty("app-button")).toBe("none");
});

it("keeps the transitions of an Ouro UI root and everything inside it", () => {
  document.body.innerHTML = `
    <div data-ouro="dialog-backdrop" id="ouro-root" class="transition-opacity"></div>
    <div data-ouro="dialog"><div><button id="ouro-descendant" class="transition-colors">Weeknights</button></div></div>
  `;
  expect(transitionProperty("ouro-root")).toBe("opacity");
  expect(transitionProperty("ouro-descendant")).toContain("background-color");
});

it("shortens the app's transitions under reduced motion but leaves Ouro UI's own", async () => {
  await commands.emulateMedia({ reducedMotion: "reduce" });
  document.body.innerHTML = `
    <main><button id="app-button" style="transition: color 300ms">Save</button></main>
    <div data-ouro="dialog"><button id="ouro-descendant" class="transition-colors">Weeknights</button></div>
  `;
  const duration = (id: string) => getComputedStyle(document.getElementById(id)!).transitionDuration;
  expect(duration("app-button")).not.toBe("0.3s");
  expect(duration("ouro-descendant")).not.toMatch(/^(0\.000001s|1e-06s)$/);
});
