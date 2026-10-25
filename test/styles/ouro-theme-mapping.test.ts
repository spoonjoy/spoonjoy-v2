// Ouro UI (app/components/ouro) reads shadcn's theme variables. app/styles/tailwind.css maps them
// onto Spoonjoy's --sj-* palette in one block, so Ouro components look like the rest of the app and
// follow dark mode. This checks that block: every colour is a --sj-* variable, and every text colour
// Ouro UI puts on a surface passes WCAG AA 4.5:1 in both themes.
import { readdirSync, readFileSync } from "node:fs";
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
const LANDING_ACTIONS = block(".sj-landing-hero-actions", /(--[\w-]+):\s*([^;]+);/g);

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

// `top` at `weight` over `bottom`, channel by channel.
function mixHex(top: string, bottom: string, weight: number): string {
  const channel = (hex: string, index: number) => Number.parseInt(hex.slice(index, index + 2), 16);
  return `#${[1, 3, 5]
    .map((index) => Math.round(channel(top, index) * weight + channel(bottom, index) * (1 - weight)).toString(16).padStart(2, "0"))
    .join("")}`;
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
  ["--card-foreground", "--card"],
  ["--muted-foreground", "--card"],
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
  ["--ouro-action-foreground", "--ouro-action"],
  ["--ouro-action-foreground", "--ouro-action-hover"],
  ["--ouro-action-foreground", "--ouro-action-active"],
  ["--ouro-action-disabled-foreground", "--ouro-action-disabled"],
] as const;

describe("Ouro UI's theme mapping onto Spoonjoy's palette", () => {
  it("maps every shadcn token Ouro UI reads to a Spoonjoy variable", () => {
    expect(MAPPING).toEqual({
      "--background": "var(--sj-paper)",
      "--foreground": "var(--sj-ink)",
      "--card": "var(--sj-panel-solid)",
      "--card-foreground": "var(--sj-ink)",
      "--popover": "var(--sj-panel-solid)",
      "--popover-foreground": "var(--sj-ink)",
      "--primary": "var(--sj-brass)",
      "--primary-foreground": "var(--sj-paper)",
      "--ouro-action": "var(--sj-action)",
      "--ouro-action-foreground": "var(--sj-on-action)",
      "--ouro-action-hover": "var(--sj-action-hover)",
      "--ouro-action-active": "var(--sj-action-hover)",
      "--ouro-action-disabled": "var(--sj-action-disabled)",
      "--ouro-action-disabled-foreground": "var(--sj-on-action-disabled)",
      "--ouro-action-disabled-opacity": "1",
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

  it("gives the landing hero's actions a stronger photo line and a light amber main action, through tokens alone", () => {
    expect(LANDING_ACTIONS).toEqual({
      "--border": "var(--sj-on-photo-muted)",
      "--ouro-action": "var(--sj-photo-action)",
      "--ouro-action-foreground": "var(--sj-on-photo-action)",
      "--ouro-action-hover": "var(--sj-photo-action-hover)",
      "--ouro-action-active": "var(--sj-photo-action-hover)",
    });
    // After sj-on-charcoal, so its --border wins on the row that carries both classes.
    expect(CSS.indexOf(".sj-landing-hero-actions {")).toBeGreaterThan(CSS.indexOf(".sj-on-charcoal {"));
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
    // HX Button paints a state layer in the label colour over the fill: 8% on hover, 14% pressed.
    for (const [state, fill, layer] of [
      ["at rest", "--ouro-action", 0],
      ["on hover", "--ouro-action-hover", 0.08],
      ["pressed", "--ouro-action-active", 0.14],
    ] as const) {
      it(`passes 4.5:1 for the landing hero's main action label ${state}, under its state layer, in the ${themeName} theme`, () => {
        const label = color(theme, "--ouro-action-foreground", LANDING_ACTIONS);
        expect(contrast(label, mixHex(label, color(theme, fill, LANDING_ACTIONS), layer))).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`passes 4.5:1 for a control's text on a charcoal panel, and 3:1 for its focus ring, in the ${themeName} theme`, () => {
      const panel = color(theme, "--sj-photo-charcoal");
      expect(contrast(color(theme, "--foreground", ON_CHARCOAL), panel)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color(theme, "--ring", ON_CHARCOAL), panel)).toBeGreaterThanOrEqual(3);
    });
  }
});

// Tailwind emits nothing for a colour utility whose --color-* token is missing, so a missed token
// leaves an HX surface transparent with no error (the install card's bg-card did exactly that).
// Every theme colour an HX component's source names must therefore resolve through @theme inline
// to a token in the mapping above.
describe("theme colours Ouro UI's components use", () => {
  const ROOT = resolve(__dirname, "../..");
  const sources = (directory: string): string[] =>
    readdirSync(resolve(ROOT, directory), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file) && !/\.(test|stories)\.|\.test-d\./.test(file))
      .map((file) => readFileSync(resolve(ROOT, directory, file), "utf8"));
  const THEME = CSS.slice(CSS.indexOf("@theme inline {"));
  const SHADCN_COLOURS = new Set(
    Object.keys(MAPPING)
      .concat(["--warning", "--warning-foreground"])
      .map((name) => name.slice(2))
      // Not colours: the radius and heading font, and the action fills HX reads as bg-(--ouro-action).
      .filter((name) => name !== "radius" && name !== "font-heading" && !name.startsWith("ouro-")),
  );
  const UTILITY = /(?<![\w-])(?:bg|text|border|ring|outline|fill|stroke|divide|placeholder|caret|decoration)-([a-z]+(?:-[a-z]+)*)(?=[\s"'`/:)\]]|$)/g;
  const used = new Set<string>();
  for (const source of [...sources("app/components/ouro"), ...sources("app/lib/ouro")]) {
    for (const match of source.matchAll(UTILITY)) {
      const name = match[1];
      if (SHADCN_COLOURS.has(name) || ["card", "card-foreground", "sidebar", "chart"].some((token) => name === token || name.startsWith(`${token}-`))) used.add(name);
    }
  }

  it("finds the card colours the install card relies on", () => {
    expect(used).toContain("card");
    expect(used).toContain("card-foreground");
  });

  for (const name of [...used].sort()) {
    it(`defines --color-${name} and its --${name} mapping`, () => {
      expect(THEME, `--color-${name} in @theme inline`).toMatch(new RegExp(`--color-${name}:\\s*var\\(--${name}\\);`));
      expect(MAPPING[`--${name}`] ?? (name.startsWith("warning") ? "ouro-base" : undefined), `--${name} is mapped`).toBeDefined();
    });
  }
});
