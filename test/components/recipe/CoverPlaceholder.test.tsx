import { describe, expect, it } from "vitest";
import { THEME_CSS } from "../../styles/theme-css";

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(THEME_CSS);
  if (!match) throw new Error(`No rule for ${selector}`);
  return match[1]!.replace(/\s+/g, " ").trim();
}

describe("the cover tokens", () => {
  it("draw Ouro UI's Cover on native's wash, vellum to brass at 32%", () => {
    const tokens = /:root,\n\.dark \{\n  --ouro-cover-from[^}]*\}/.exec(THEME_CSS)?.[0] ?? "";
    expect(tokens).toContain("--ouro-cover-from: var(--sj-vellum);");
    expect(tokens).toContain("--ouro-cover-to: color-mix(in srgb, var(--sj-brass) 32%, transparent);");
  });

  it("leave the letter in Cover's own ink, which reads at 4.5:1 on the wash where plain brass does not", () => {
    expect(THEME_CSS).not.toContain("--ouro-cover-ink");
  });

  it("give the counter card's Cover the page's ink, not the card's on-photo white", () => {
    expect(rule('.sj-counter-card [data-ouro="cover"]')).toBe("--foreground: var(--sj-ink);");
  });

  it("give the counter card four control radii as its squircle radius, never a round corner shape", () => {
    const card = rule(".sj-counter-card");
    expect(card).toContain("--ouro-sq-r: calc(var(--radius) * var(--ouro-radius-scale, 1) * 4);");
    expect(card).toContain("border-radius: calc(var(--ouro-sq-r) * var(--ouro-corner-fallback, 1));");
    expect(card).not.toMatch(/corner-shape:\s*round/);
  });

  it("set Cover's letter in the display serif", () => {
    expect(THEME_CSS).toMatch(/--font-heading: var\(--font-sj-display\);/);
  });
});

describe("the sj-type-step role", () => {
  it("takes ouro-ui-core's sj-type-step token: Fraunces 600, 1.5rem, line height 1.25, no tracking", () => {
    // A Tailwind utility, so a breakpoint can switch to it (cook mode's md:sj-type-display).
    const step = rule("@utility sj-type-step");
    expect(step).toContain("font-family: var(--font-sj-display);");
    expect(step).toContain("font-weight: 600;");
    expect(step).toContain("font-size: 1.5rem;");
    expect(step).toContain("line-height: 1.25;");
    expect(step).toContain("letter-spacing: 0;");
  });
});

describe("the sj-type-instruction role", () => {
  it("takes ouro-ui-core's sj-type-instruction token: Fraunces 400, 1.25rem, line height 1.4, no tracking", () => {
    const instruction = rule("@utility sj-type-instruction");
    expect(instruction).toContain("font-family: var(--font-sj-display);");
    expect(instruction).toContain("font-weight: 400;");
    expect(instruction).toContain("font-size: 1.25rem;");
    expect(instruction).toContain("line-height: 1.4;");
    expect(instruction).toContain("letter-spacing: 0;");
  });
});

describe("the sj-type-display role", () => {
  it("takes ouro-ui-core's sj-type-display token: Fraunces 600, 3rem, line height 1.1, no tracking", () => {
    const display = rule("@utility sj-type-display");
    expect(display).toContain("font-family: var(--font-sj-display);");
    expect(display).toContain("font-weight: 600;");
    expect(display).toContain("font-size: 3rem;");
    expect(display).toContain("line-height: 1.1;");
    expect(display).toContain("letter-spacing: 0;");
  });
});
