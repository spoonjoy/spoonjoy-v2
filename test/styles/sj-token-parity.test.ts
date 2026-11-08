// Spoonjoy's tokens come from ouro-ui-core's Cookbook theme (scripts/sync-sj-tokens.mjs), the same
// source the native app reads. Taking a new core release must not change a value the app paints
// unless that change is meant: every --sj-* and --font-sj-* is held to sj-tokens.snapshot.json, in
// light and dark.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { build, declarations } from "../../scripts/sync-sj-tokens.mjs";
import snapshot from "./sj-tokens.snapshot.json";

const ROOT = resolve(__dirname, "../..");
const TOKENS = readFileSync(resolve(ROOT, "app/styles/sj-tokens.css"), "utf8");
const TAILWIND = readFileSync(resolve(ROOT, "app/styles/tailwind.css"), "utf8");
const SJ_TOKEN = /^--(?:sj|font-sj)-/;

const REGENERATE =
  "Spoonjoy's tokens no longer match test/styles/sj-tokens.snapshot.json. If the new ouro-ui-core " +
  "release is meant to change them, run `node scripts/sync-sj-tokens.mjs --snapshot` and commit the " +
  "snapshot; otherwise change the Cookbook theme in Ouro, not here.";

// Each token added, removed or changed against the snapshot, as one line.
function drift(actual: Record<string, string>, expected: Record<string, string>): string[] {
  const names = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  return [...names].flatMap((name) => {
    if (!(name in expected)) return [`added ${name}: ${actual[name]}`];
    if (!(name in actual)) return [`removed ${name}: ${expected[name]}`];
    return actual[name] === expected[name] ? [] : [`changed ${name}: ${expected[name]} → ${actual[name]}`];
  });
}

// Inside `@media print`: print forces ink-on-paper values on purpose, so its --sj-* literals stay
// in tailwind.css. Ruled in the 1.2 parity ledger (desk: spoonjoy/web-native-visual-parity/
// spoonjoy-apple/2026-11-07-parity-1-2/ledger.md, "the print block … is exempt").
function inPrint(rule: Rule): boolean {
  for (let node = rule.parent; node; node = node.parent) {
    if (node.type === "atrule" && (node as AtRule).name === "media" && (node as AtRule).params.trim() === "print") return true;
  }
  return false;
}

describe("Spoonjoy's tokens from ouro-ui-core", () => {
  it("declares every light token as the snapshot does", () => {
    expect(drift(declarations(TOKENS, ":root"), snapshot.light), REGENERATE).toEqual([]);
  });

  it("declares every dark token as the snapshot does", () => {
    expect(drift(declarations(TOKENS, ".dark"), snapshot.dark), REGENERATE).toEqual([]);
  });

  it("is what the sync script writes from the pinned core file", () => {
    expect(TOKENS).toBe(build());
  });

  it("is imported by tailwind.css, whose :root and .dark rules declare no Spoonjoy token, print aside", () => {
    expect(TAILWIND).toContain('@import "./sj-tokens.css";');
    const offenders: string[] = [];
    let rules = 0;
    postcss.parse(TAILWIND).walkRules((rule) => {
      if (!rule.selectors.some((selector) => selector.trim() === ":root" || selector.trim() === ".dark")) return;
      if (inPrint(rule)) return;
      rules += 1;
      rule.walkDecls(SJ_TOKEN, (decl) => {
        offenders.push(`${rule.selector.replace(/\s+/g, " ")} (line ${decl.source?.start?.line}): ${decl.prop}`);
      });
    });
    expect(rules).toBeGreaterThan(2);
    expect(offenders).toEqual([]);
  });
});
