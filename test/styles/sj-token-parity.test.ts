// Spoonjoy's tokens come from ouro-ui-core's Cookbook theme (scripts/sync-sj-tokens.mjs), the same
// source the native app reads. Moving them there must not change a single value the app paints:
// every --sj-* and --font-sj-* below is declared exactly as tailwind.css declared it before the
// move (sj-tokens.snapshot.json), in light and dark.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { build, declarations } from "../../scripts/sync-sj-tokens.mjs";
import snapshot from "./sj-tokens.snapshot.json";

const ROOT = resolve(__dirname, "../..");
const TOKENS = readFileSync(resolve(ROOT, "app/styles/sj-tokens.css"), "utf8");
const TAILWIND = readFileSync(resolve(ROOT, "app/styles/tailwind.css"), "utf8");

describe("Spoonjoy's tokens from ouro-ui-core", () => {
  it("declares every light token exactly as before", () => {
    expect(declarations(TOKENS, ":root")).toEqual(snapshot.light);
  });

  it("declares every dark token exactly as before", () => {
    expect(declarations(TOKENS, ".dark")).toEqual(snapshot.dark);
  });

  it("is what the sync script writes from the pinned core file", () => {
    expect(TOKENS).toBe(build());
  });

  it("is imported by tailwind.css, which declares no Spoonjoy token of its own", () => {
    expect(TAILWIND).toContain('@import "./sj-tokens.css";');
    for (const selector of [":root", ".dark"]) {
      const start = TAILWIND.indexOf(`\n${selector} {`);
      const body = start < 0 ? "" : TAILWIND.slice(start, TAILWIND.indexOf("}", start));
      expect(body, `tailwind.css ${selector}`).not.toMatch(/--(?:sj|font-sj)-[\w-]+\s*:/);
    }
  });
});
