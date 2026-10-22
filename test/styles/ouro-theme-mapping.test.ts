// Ouro UI (app/components/ouro) reads shadcn's theme variables. app/styles/tailwind.css maps them
// onto Spoonjoy's --sj-* palette in one block, so Ouro components look like the rest of the app and
// follow dark mode. This checks that block: every colour is a --sj-* variable, and every text colour
// Ouro UI puts on a surface passes WCAG AA 4.5:1 in both themes.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(resolve(__dirname, "../..", "app/styles/tailwind.css"), "utf8");

// The custom properties declared in the first block that opens with `selector {`.
function block(selector: string, pattern: RegExp): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} block in tailwind.css`).toBeGreaterThanOrEqual(0);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries(Array.from(body.matchAll(pattern), (match) => [match[1], match[2].trim()]));
}

const SPOONJOY_VARIABLE = /(--sj-[\w-]+):\s*([^;]+);/g;
const LIGHT = block(":root", SPOONJOY_VARIABLE);
const DARK = { ...LIGHT, ...block(".dark", SPOONJOY_VARIABLE) };
const MAPPING = block(":root,\n.dark", /(--[\w-]+):\s*([^;]+);/g);

const TAB_BAR = block(".sj-tab-bar", /(--[\w-]+):\s*([^;]+);/g);
const ON_CHARCOAL = block(".sj-on-charcoal", /(--[\w-]+):\s*([^;]+);/g);

// A variable's colour in a theme, following var() references through the mapping and the palette,
// and mixing a color-mix(in srgb, …) channel by channel.
function color(theme: Record<string, string>, name: string, mapping = MAPPING): string {
  const value = mapping[name] ?? MAPPING[name] ?? theme[name];
  expect(value, `${name} is declared`).toBeDefined();
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference) return color(theme, reference[1], mapping);
  const mix = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\)$/.exec(value);
  if (mix) {
    const [a, b] = [color(theme, mix[1], mapping), color(theme, mix[3], mapping)];
    const weight = Number(mix[2]) / 100;
    const channel = (hex: string, index: number) => Number.parseInt(hex.slice(index, index + 2), 16);
    return `#${[1, 3, 5]
      .map((index) => Math.round(channel(a, index) * weight + channel(b, index) * (1 - weight)).toString(16).padStart(2, "0"))
      .join("")}`;
  }
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

// Each text colour Ouro UI uses (text-*) and the surfaces it sits on.
const PAIRS = [
  ["--foreground", "--background"],
  ["--popover-foreground", "--popover"],
  ["--muted-foreground", "--popover"],
  ["--muted-foreground", "--background"],
  ["--muted-foreground", "--muted"],
  ["--primary-foreground", "--primary"],
  ["--secondary-foreground", "--secondary"],
  ["--accent-foreground", "--accent"],
  ["--destructive-foreground", "--destructive"],
  ["--success-foreground", "--success"],
  ["--primary", "--popover"],
  ["--destructive", "--popover"],
  ["--success", "--popover"],
] as const;

describe("Ouro UI's theme mapping onto Spoonjoy's palette", () => {
  it("maps every shadcn token Ouro UI reads to a Spoonjoy variable", () => {
    expect(MAPPING).toEqual({
      "--background": "var(--sj-paper)",
      "--foreground": "var(--sj-ink)",
      "--popover": "var(--sj-panel-solid)",
      "--popover-foreground": "var(--sj-ink)",
      "--primary": "var(--sj-brass)",
      "--primary-foreground": "var(--sj-paper)",
      "--secondary": "var(--sj-flour)",
      "--secondary-foreground": "var(--sj-ink)",
      "--muted": "var(--sj-flour)",
      "--muted-foreground": "var(--sj-ink-soft)",
      "--accent": "var(--sj-flour)",
      "--accent-foreground": "var(--sj-ink)",
      "--destructive": "var(--sj-tomato)",
      "--destructive-foreground": "var(--sj-paper)",
      "--success": "var(--sj-herb)",
      "--success-foreground": "var(--sj-paper)",
      "--border": "var(--sj-border)",
      "--input": "var(--sj-border-strong)",
      "--ring": "var(--sj-brass)",
      "--radius": "var(--sj-radius-control)",
      "--font-heading": "var(--font-sj-display)",
    });
  });

  it("rebinds the phone tab bar alone to charcoal under photo-white text", () => {
    expect(TAB_BAR).toEqual({
      "--popover": "var(--sj-photo-charcoal)",
      "--foreground": "var(--sj-on-photo)",
      "--muted-foreground": "color-mix(in srgb, var(--sj-on-photo) 62%, var(--sj-photo-charcoal))",
      "--accent": "color-mix(in srgb, var(--sj-on-photo) 14%, var(--sj-photo-charcoal))",
      "--accent-foreground": "var(--sj-on-photo)",
      "--border": "var(--sj-photo-line)",
      "--ring": "var(--sj-on-photo)",
    });
  });

  it("rebinds HX controls on a charcoal panel to photo-white, through tokens alone", () => {
    expect(ON_CHARCOAL).toEqual({
      "--foreground": "var(--sj-on-photo)",
      "--border": "var(--sj-photo-line)",
      "--ring": "var(--sj-on-photo)",
    });
  });

  it("declares the mapping after the .dark palette, so it wins over ouro-base's defaults there", () => {
    expect(CSS.indexOf(":root,\n.dark {")).toBeGreaterThan(CSS.indexOf(".dark {"));
  });

  for (const [themeName, theme] of Object.entries({ light: LIGHT, dark: DARK })) {
    for (const [text, surface] of PAIRS) {
      it(`passes 4.5:1 for ${text} on ${surface} in the ${themeName} theme`, () => {
        expect(contrast(color(theme, text), color(theme, surface))).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const [text, surface] of [
      ["--muted-foreground", "--popover"],
      ["--foreground", "--popover"],
      ["--accent-foreground", "--accent"],
    ] as const) {
      it(`passes 4.5:1 for the tab bar's ${text} on ${surface} in the ${themeName} theme`, () => {
        expect(contrast(color(theme, text, TAB_BAR), color(theme, surface, TAB_BAR))).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`passes 4.5:1 for a control's text on a charcoal panel, and 3:1 for its focus ring, in the ${themeName} theme`, () => {
      const panel = color(theme, "--sj-photo-charcoal");
      expect(contrast(color(theme, "--foreground", ON_CHARCOAL), panel)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color(theme, "--ring", ON_CHARCOAL), panel)).toBeGreaterThanOrEqual(3);
    });
  }
});
