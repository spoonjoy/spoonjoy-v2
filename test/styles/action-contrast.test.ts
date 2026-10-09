import { readFileSync } from "fs";
import { resolve } from "path";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

// Primary buttons fill with --sj-action and write in --sj-on-action. In the dark scheme the fill is
// brass, and bone text on it measured 2.6:1 (axe on /login and /recipes, 2026-10-09), failing WCAG
// 1.4.3. Every state of the fill must keep at least 4.5:1 with its text in both schemes.

const CSS = readFileSync(resolve(process.cwd(), "app/styles/tailwind.css"), "utf-8");
const BUTTON = readFileSync(resolve(process.cwd(), "app/components/ui/button.tsx"), "utf-8");

function tokens(selector: ":root" | ".dark"): Map<string, string> {
  const found = new Map<string, string>();
  postcss.parse(CSS).walkRules((rule: Rule) => {
    if (rule.selector !== selector || rule.parent?.type !== "root") return;
    rule.walkDecls(/^--sj-/, (decl) => {
      found.set(decl.prop, decl.value.trim());
    });
  });
  return found;
}

const light = tokens(":root");
const dark = new Map([...light, ...tokens(".dark")]);

function resolveColour(scheme: Map<string, string>, name: string, depth = 0): string {
  const value = scheme.get(name);
  if (!value) throw new Error(`${name} is not defined`);
  const reference = /^var\((--[a-z-]+)\)$/.exec(value);
  if (reference && depth < 10) return resolveColour(scheme, reference[1]!, depth + 1);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is ${value}, not a hex colour`);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("primary action contrast", () => {
  it("writes primary buttons in --sj-on-action", () => {
    expect(BUTTON).toContain("bg-[var(--sj-action)] text-[var(--sj-on-action)]");
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("keeps at least 4.5:1 on the %s action fill at rest, on hover and when pressed", (_scheme, scheme) => {
    const text = resolveColour(scheme, "--sj-on-action");
    expect(contrast(text, resolveColour(scheme, "--sj-action"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, resolveColour(scheme, "--sj-action-deep"))).toBeGreaterThanOrEqual(4.5);
  });

  it("measures contrast the WCAG way", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#f1e6d3", "#b9854b")).toBeCloseTo(2.61, 2);
    expect(() => resolveColour(new Map([["--x", "red"]]), "--x")).toThrow("not a hex colour");
    expect(() => resolveColour(new Map(), "--missing")).toThrow("not defined");
  });
});
