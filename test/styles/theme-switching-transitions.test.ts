import { readFileSync } from "fs";
import { resolve } from "path";
import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

// A global colour fade on every element made state-coloured controls (checked, pressed,
// selected) pass through low-contrast mid-fade colours right after a tap; axe measured
// the shopping list's view buttons at 1.72:1. The fade belongs only to the moment the
// theme switches, which the theme provider marks with data-theme-switching on <html>.

const CSS = readFileSync(resolve(process.cwd(), "app/styles/tailwind.css"), "utf-8");
const root = postcss.parse(CSS);

const COLOUR_PROPERTIES = /\b(color|background-color|background|border-color|all)\b/;

function enclosingAtRules(rule: Rule): AtRule[] {
  const chain: AtRule[] = [];
  let parent = rule.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule") chain.push(parent as AtRule);
    parent = parent.parent;
  }
  return chain;
}

function transitionValue(rule: Rule): string | null {
  let value: string | null = null;
  rule.walkDecls(/^transition(-property)?$/, (decl) => {
    value = decl.value;
  });
  return value;
}

// Rules that can reach arbitrary elements: universal or bare element selectors with no
// class, id or attribute of their own (for example `html *` or `html *:where(button)`).
function isGlobalSelector(selector: string): boolean {
  const withoutWhere = selector.replace(/:where\(([^()]*)\)/g, " ");
  return !/[.#]/.test(withoutWhere) && /(^|\s)(\*|html|body|button|input|select|textarea)\b|\*/.test(selector);
}

const globalColourTransitionRules = (() => {
  const found: { selector: string; value: string; atRules: string[] }[] = [];
  root.walkRules((rule) => {
    const value = transitionValue(rule);
    if (!value || value === "none" || !COLOUR_PROPERTIES.test(value)) return;
    for (const selector of rule.selectors) {
      if (!isGlobalSelector(selector)) continue;
      found.push({
        selector,
        value,
        atRules: enclosingAtRules(rule).map((atRule) => `@${atRule.name} ${atRule.params}`),
      });
    }
  });
  return found;
})();

describe("theme-switching colour transitions", () => {
  it("fades colours globally only while <html> carries data-theme-switching", () => {
    expect(globalColourTransitionRules.length).toBeGreaterThan(0);
    for (const { selector } of globalColourTransitionRules) {
      expect(selector, `${selector} fades colours outside a theme switch`).toMatch(
        /^(:where\()?html\[data-theme-switching\]/,
      );
    }
  });

  it("gives reduced-motion users no theme fade", () => {
    for (const { selector, atRules } of globalColourTransitionRules) {
      expect(atRules, `${selector} must sit inside a no-preference motion query`).toContain(
        "@media (prefers-reduced-motion: no-preference)",
      );
    }
  });

  it("switches every element's transitions off outside the switching window, so state colours change instantly", () => {
    const resets: string[] = [];
    root.walkRules((rule) => {
      if (enclosingAtRules(rule).length > 0) return;
      if (transitionValue(rule) === "none") resets.push(...rule.selectors);
    });
    expect(resets).toEqual(expect.arrayContaining([":where(html, html *)"]));
  });

  it("keeps the switching rules unlayered and with zero specificity, so component rules still win", () => {
    for (const { selector, atRules } of globalColourTransitionRules) {
      expect(atRules.some((atRule) => atRule.startsWith("@layer")), `${selector} is layered`).toBe(false);
      expect(selector, `${selector} should be wrapped in :where()`).toMatch(/^:where\(.*\)$/);
    }
  });
});
