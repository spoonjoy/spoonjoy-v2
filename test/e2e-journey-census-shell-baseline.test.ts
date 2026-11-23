// The census checks page entries without the shared shell (e2e/journeys/support/census-shell-baseline.ts),
// so an entry recorded with the shell in it still passes.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isShellIdentity, withoutShell } from "../e2e/journeys/support/census-shell-baseline";

const KITCHEN_TAB = { identity: 'link "Kitchen" [tab-bar/tab] in navigation "Spoonjoy navigation"', count: 1 };
const SAVE = { identity: 'button "Save" [button/root] in main', count: 1 };

describe("withoutShell", () => {
  it("takes the shell's controls out of a page entry recorded with them, and keeps the page's", () => {
    const baseline = {
      "iphone-webkit": {
        "plan": { default: [{ identity: 'button "Log in" [button/root] in banner', count: 1 }, KITCHEN_TAB, SAVE, { identity: 'link "Roadmap" [link/root] in contentinfo', count: 1 }] },
        "shell-signed-in": { shell: [KITCHEN_TAB] },
      },
    };
    expect(withoutShell(baseline)).toEqual({ "iphone-webkit": { "plan": { default: [SAVE] }, "shell-signed-in": { shell: [KITCHEN_TAB] } } });
  });

  it("names a control by its landmark, so a page's own navigation stays", () => {
    expect(isShellIdentity('link "Rice" [link/root] in navigation "Cook steps"')).toBe(false);
    expect(isShellIdentity('link "Recipes" [link/root] in navigation "Main navigation"')).toBe(true);
  });

  it("leaves the committed baseline as it is, since page entries already leave the shell out", () => {
    const committed = JSON.parse(readFileSync("e2e/ouro-census/census.baseline.json", "utf8"));
    expect(withoutShell(committed)).toEqual(committed);
  });
});
