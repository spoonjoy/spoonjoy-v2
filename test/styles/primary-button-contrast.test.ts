// The primary button's colours, in every state and both themes, from the chef-profile journey's
// axe scan (run 37935560293): in dark mode the header's Sign Up button put its light label
// (#f1e6d3) on the amber action colour (#b9854b) at 2.61:1, under WCAG AA's 4.5:1, and the
// deeper amber on hover measured 3.94:1. Disabled buttons faded to 50% opacity, which blends
// the label into the page.
//
// Axe can't compute colours in happy-dom, so this checks the tokens themselves: each state's
// label against its fill in both themes, the focus ring against the page, and that the
// component uses exactly these tokens and no opacity fade.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const CSS = readFileSync(resolve(ROOT, "app/styles/tailwind.css"), "utf8");
const BUTTON = readFileSync(resolve(ROOT, "app/components/ui/button.tsx"), "utf8");
const MCP = readFileSync(resolve(ROOT, "app/routes/mcp.tsx"), "utf8");

// The custom properties declared in the first block that opens with `selector {`.
function themeBlock(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} block in tailwind.css`).toBeGreaterThanOrEqual(0);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries(Array.from(body.matchAll(/(--sj-[\w-]+):\s*([^;]+);/g), (match) => [match[1], match[2].trim()]));
}

const LIGHT = themeBlock(":root");
const DARK = { ...LIGHT, ...themeBlock(".dark") };
const THEMES = { light: LIGHT, dark: DARK } as const;

// A token's colour in a theme, following var() references within that theme.
function color(theme: Record<string, string>, name: string): string {
  const value = theme[name];
  expect(value, `${name} is declared`).toBeDefined();
  const reference = /^var\((--sj-[\w-]+)\)$/.exec(value);
  if (reference) return color(theme, reference[1]);
  expect(value, `${name} is a plain hex colour`).toMatch(/^#[0-9a-f]{6}$/i);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Each state: the label token and the fill token behind it. Focus keeps the rest colours and adds
// the ring, checked separately below.
const STATES = [
  { state: "rest and focus", label: "--sj-on-action", fill: "--sj-action" },
  { state: "hover", label: "--sj-on-action", fill: "--sj-action-hover" },
  { state: "pressed", label: "--sj-on-action", fill: "--sj-action-hover" },
  { state: "disabled", label: "--sj-on-action-disabled", fill: "--sj-action-disabled" },
] as const;

// The primary variant's class strings in button.tsx.
function primaryClasses(): string {
  const match = /\n {2}default: \[([\s\S]*?)\n {2}\],/.exec(BUTTON);
  expect(match, "default variant in button.tsx").not.toBeNull();
  return match![1];
}

describe("primary button contrast", () => {
  for (const [themeName, theme] of Object.entries(THEMES)) {
    describe(`${themeName} theme`, () => {
      for (const { state, label, fill } of STATES) {
        it(`${state}: the label passes WCAG AA 4.5:1 on its fill`, () => {
          expect(contrast(color(theme, label), color(theme, fill))).toBeGreaterThanOrEqual(4.5);
        });
      }

      it("focus: the brass ring passes 3:1 against the page and a panel", () => {
        // The ring sits 2px outside the button, on whatever is behind it (WCAG 1.4.11).
        expect(contrast(color(theme, "--sj-brass"), color(theme, "--sj-paper"))).toBeGreaterThanOrEqual(3);
        expect(contrast(color(theme, "--sj-brass"), color(theme, "--sj-panel-solid"))).toBeGreaterThanOrEqual(3);
      });
    });
  }

  it("the dark theme uses a dark label on the amber, as the 2.61:1 light label failed", () => {
    expect(luminance(color(DARK, "--sj-on-action"))).toBeLessThan(luminance(color(DARK, "--sj-action")));
  });

  it("button.tsx colours each primary state with exactly the checked tokens", () => {
    const classes = primaryClasses();
    const checked = new Set(STATES.flatMap(({ label, fill }) => [label, fill]));
    const used = new Set(Array.from(classes.matchAll(/var\((--sj-[\w-]+)\)/g), (match) => match[1]));
    expect([...used].sort()).toEqual([...checked].sort());
    expect(classes).toContain("text-[var(--sj-on-action)]");
    expect(classes).toContain("data-hover:bg-[var(--sj-action-hover)]");
    expect(classes).toContain("data-active:bg-[var(--sj-action-hover)]");
    expect(classes).toContain("data-disabled:bg-[var(--sj-action-disabled)]");
    expect(classes).toContain("data-disabled:text-[var(--sj-on-action-disabled)]");
  });

  it("a disabled primary button keeps its colours instead of fading", () => {
    expect(primaryClasses()).not.toMatch(/opacity/);
    const base = /\n {2}base: \[([\s\S]*?)\n {2}\],/.exec(BUTTON)![1];
    expect(base).not.toMatch(/opacity/);
  });

  it("the focus ring is the brass outline, offset onto the page", () => {
    const base = /\n {2}base: \[([\s\S]*?)\n {2}\],/.exec(BUTTON)![1];
    expect(base).toContain("data-focus:outline-2");
    expect(base).toContain("data-focus:outline-offset-2");
    expect(base).toContain("data-focus:outline-[var(--sj-brass)]");
  });

  it("the MCP page's primary link uses the same label and hover tokens", () => {
    expect(MCP).toContain("text-[var(--sj-on-action)] hover:border-[var(--sj-action-hover)] hover:bg-[var(--sj-action-hover)]");
    expect(MCP).not.toContain("bg-[var(--sj-action)] text-[var(--sj-on-photo)]");
  });
});
