// The print stylesheet (product audit 2026-10-09, finding 14): a recipe printed from either theme is dark
// ink on white paper, and a cook's ticked ingredients never print as struck-through rows. Browsers apply
// these rules only under `@media print`, which happy-dom never matches, so this reads the real
// stylesheet and checks the rules and the colours they produce.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../../app/styles/tailwind.css"), "utf8");
const sheet = postcss.parse(css);

function printRules(): Rule[] {
  const rules: Rule[] = [];
  sheet.walkAtRules("media", (media: AtRule) => {
    if (media.params.trim() !== "print") return;
    media.walkRules((rule) => {
      rules.push(rule);
    });
  });
  return rules;
}

function declarations(selector: string, rules: Rule[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    rule.walkDecls((decl) => {
      values.set(decl.prop, decl.value);
    });
  }
  return values;
}

function resolveColor(name: string, values: Map<string, string>, depth = 0): string {
  const value = values.get(name);
  if (!value || depth > 8) throw new Error(`${name} is not set for print`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value.trim());
  return reference ? resolveColor(reference[1], values, depth + 1) : value.trim();
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`expected a #rrggbb colour, got ${hex}`);
  const channels = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("print stylesheet", () => {
  const rules = printRules();

  it.each([":root", ".dark"])("prints %s as dark ink on white paper", (selector) => {
    const values = declarations(selector, rules);
    const page = resolveColor("--sj-page", values);
    expect(page.toLowerCase()).toBe("#ffffff");
    expect(resolveColor("--sj-paper", values).toLowerCase()).toBe("#ffffff");
    expect(contrast(resolveColor("--sj-ink", values), page)).toBeGreaterThanOrEqual(7);
    expect(contrast(resolveColor("--sj-ink-soft", values), page)).toBeGreaterThanOrEqual(4.5);
    expect(values.get("color-scheme")).toBe("light");
  });

  it("drops screen chrome and the cook's tick marks from the printed page", () => {
    const hidden = rules
      .filter((rule) => /display:\s*none/.test(rule.toString()))
      .flatMap((rule) => rule.selectors);
    expect(hidden).toEqual(
      expect.arrayContaining([
        ".sj-skip-link",
        ".sj-desktop-topbar",
        ".sj-route-progress",
        "#steps .sj-checklist-box",
        "#steps .sj-checklist-strike",
      ]),
    );
  });

  it("prints a checklist row as one column once its tick box is gone", () => {
    // The screen row is `2rem minmax(0,1fr)` with the box in the first column; with the box hidden, the
    // name and amount would fall into that 2rem column and the name would get no width.
    expect(declarations("#steps .sj-checklist-row", rules).get("grid-template-columns")).toBe("minmax(0, 1fr)");
  });

  it("prints the masthead as one column without the screen-height minimum", () => {
    // On screen the masthead is at least 34rem tall at lg, with the title centred and the photo in a
    // column beside it; on paper that left about 200px of blank space above and below the title.
    const layout = declarations(".sj-recipe-header-layout", rules);
    expect(layout.get("display")).toBe("block");
    expect(layout.get("min-height")).toBe("0");
    expect(declarations(".sj-recipe-header-body", rules).get("min-height")).toBe("0");
    expect(declarations(".sj-recipe-hero", rules).get("height")).toBe("3in");
    expect(declarations("#steps .sj-step-ingredients", rules).get("margin-left")).toBe("0");
    expect(declarations("#steps .sj-step-card", rules).get("padding-left")).toBe("0");
  });

  it("hides print-only-hidden elements even where a component class sets display", () => {
    expect(declarations(".sj-print-hidden", rules).get("display")).toBe("none");
  });

  it("keeps the print rules unlayered, so lg: utilities and component classes cannot override them", () => {
    sheet.walkAtRules("media", (media: AtRule) => {
      if (media.params.trim() !== "print") return;
      let parent = media.parent;
      while (parent && parent.type !== "root") {
        expect(parent.type === "atrule" && (parent as AtRule).name === "layer").toBe(false);
        parent = parent.parent;
      }
    });
  });

  it("sets page margins for paper", () => {
    let margin: string | undefined;
    sheet.walkAtRules("page", (page) => {
      page.walkDecls("margin", (decl) => {
        margin = decl.value;
      });
    });
    expect(margin).toBe("0.6in");
  });
});
