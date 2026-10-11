import { afterEach, expect, it } from "vitest";

// Spoonjoy's stylesheet switches every element's transitions off outside a theme switch, with an
// unlayered rule that beats Tailwind's layered transition utilities. Ouro UI's dialogs, sheets and
// buttons animate with those utilities, so the rule leaves out every [data-ouro] root and its
// descendants. This runs in real browsers (vitest.ouro.config.ts loads app/styles/tailwind.css),
// because happy-dom cannot match the selector.

afterEach(() => {
  document.body.innerHTML = "";
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
