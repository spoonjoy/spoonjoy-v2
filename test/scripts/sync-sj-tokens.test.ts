import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { build, declarations, render } from "../../scripts/sync-sj-tokens.mjs";

const THEME = `/* core's Cookbook theme */
@font-face { font-family: Geist; }
:root {
  --sj-paper: #fffaf3;
  --font-sj-display: "Fraunces", serif;
  --shadow-sm: 0 1px 2px black;
}
.dark {
  --sj-paper: #1a1612;
}
@media (prefers-color-scheme: dark) {
  :root { --sj-paper: #000; }
}`;

describe("declarations", () => {
  it("takes only the Spoonjoy tokens of a top-level rule, not core's other scales or its media blocks", () => {
    expect(declarations(THEME, ":root")).toEqual({ "--sj-paper": "#fffaf3", "--font-sj-display": '"Fraunces", serif' });
    expect(declarations(THEME, ".dark")).toEqual({ "--sj-paper": "#1a1612" });
  });

  it("fails when a rule holds no Spoonjoy tokens", () => {
    expect(() => declarations(":root { --shadow-sm: none; }", ":root")).toThrow('no Spoonjoy tokens in a ":root {" rule');
  });
});

describe("render", () => {
  it("writes the light and dark tokens and names no core release, so a release with the same tokens changes nothing", () => {
    const output = render(THEME);
    expect(output).toContain(":root {\n  color-scheme: light;\n  --sj-paper: #fffaf3;\n  --font-sj-display: \"Fraunces\", serif;\n}");
    expect(output).toContain(".dark {\n  color-scheme: dark;\n  --sj-paper: #1a1612;\n}");
    expect(output).not.toMatch(/v\d+\.\d+\.\d+/);
    expect(output).toContain("vendor/ouro-ui-core/pin.json pins");
  });

  it("matches the committed app/styles/sj-tokens.css, built from the pinned theme", () => {
    expect(build()).toBe(readFileSync("app/styles/sj-tokens.css", "utf8"));
  });
});
