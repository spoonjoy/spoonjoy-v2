// Colour contrast on the shopping list, from the QA journey's axe scans (run 36310125579):
//   - a checked row was dimmed to 72% opacity on top of its soft ink, which put its quantity and
//     "already in basket" note at 3.32:1 (#8e8981 on #fbfaf4), under WCAG AA's 4.5:1;
//   - the Need / Basket / All view buttons animated their text and background colours, so for a
//     moment after each tap the label sat on a near-identical grey (as low as 1.19:1). Removing
//     Tailwind's `transition` class was not enough (run 36320246349 still measured 1.72:1 and
//     2.07:1 on iPhone): tailwind.css's unlayered theme rule fades every button's colour and
//     background, so these controls opt out with `sj-instant-state`.
// Axe can't compute colours in happy-dom, so these tests check the causes: the theme's soft ink
// passes on the page in both themes, a checked row adds no dimming on top of it, and the view
// buttons change colour instantly.
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { compile } from "tailwindcss";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ChecklistRow } from "~/components/shopping/checklist-row";
import { createTestRoutesStub } from "../../utils";

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  LayoutGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  LazyMotion: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  m: {
    div: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  },
}));

import ShoppingList from "~/routes/shopping-list";

const CSS = readFileSync(resolve(__dirname, "../../../app/styles/tailwind.css"), "utf8");

// The custom properties declared in the first block that opens with `selector {`.
function themeBlock(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} block in tailwind.css`).toBeGreaterThanOrEqual(0);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries(Array.from(body.matchAll(/(--sj-[\w-]+):\s*([^;]+);/g), (match) => [match[1], match[2].trim()]));
}

function resolveColor(tokens: Record<string, string>, fallback: Record<string, string>, name: string): string {
  const value = tokens[name] ?? fallback[name];
  const reference = /^var\((--sj-[\w-]+)\)$/.exec(value);
  return reference ? resolveColor(tokens, fallback, reference[1]) : value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// The view buttons and category chips: an active button is paper on ink, an inactive one is soft
// ink (inherited) on the page, and a hovered inactive one is ink on the page.
const STATE_PAIRS = {
  inactive: ["--sj-ink-soft", "--sj-page"],
  "inactive, hovered": ["--sj-ink", "--sj-page"],
  active: ["--sj-paper", "--sj-ink"],
  "active, hovered (no hover style on the active branch)": ["--sj-paper", "--sj-ink"],
} as const;

function cssRuleIndex(pattern: RegExp): number {
  const match = pattern.exec(CSS);
  expect(match, String(pattern)).not.toBeNull();
  return match!.index;
}

describe("shopping list colour contrast", () => {
  it("keeps every view-button state at 4.5:1 or better, in both themes", () => {
    const light = themeBlock(":root");
    const dark = themeBlock(".dark");
    for (const [theme, tokens] of [["light", light], ["dark", { ...light, ...dark }]] as const) {
      for (const [state, [foreground, background]] of Object.entries(STATE_PAIRS)) {
        const ratio = contrast(resolveColor(tokens, light, foreground), resolveColor(tokens, light, background));
        expect(ratio, `${theme}, ${state}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("applies hover colours only on devices that really hover, so a tap on a phone can't leave one stuck", async () => {
    // Tailwind 4 puts every hover: utility behind @media (hover: hover); the repo must not
    // redefine the hover variant.
    expect(CSS).not.toMatch(/@custom-variant\s+hover\b/);
    const compiled = await compile("@tailwind utilities;", {
      base: process.cwd(),
      loadStylesheet: async () => ({ content: "", base: process.cwd() }),
    });
    expect(compiled.build(["hover:text-[var(--sj-ink)]"])).toMatch(/&:hover\s*{\s*@media \(hover: hover\)/);
  });

  it("lets state controls opt out of the theme fade: .sj-instant-state has no transition and outranks the global rule", () => {
    // The theme fade only runs while <html> carries data-theme-switching; its control rule is wrapped
    // in :where(), so it has zero specificity.
    const globalButtonRule = cssRuleIndex(/:where\(html\[data-theme-switching\] :is\(input, textarea, select, button\)\)\s*{[^}]*transition:/);
    const instant = cssRuleIndex(/\.sj-instant-state\s*{\s*transition:\s*none;?\s*}/);
    // Both are unlayered, so the class wins on specificity (0,1,0 over 0,0,0) and comes later.
    expect(instant).toBeGreaterThan(globalButtonRule);
    expect(CSS.slice(0, instant)).not.toMatch(/@layer[^{]*{[^}]*$/);
  });


  it("soft ink on the page passes WCAG AA for small text in both themes, with no room for extra dimming", () => {
    const light = themeBlock(":root");
    const dark = themeBlock(".dark");
    for (const tokens of [light, { ...light, ...dark }]) {
      const inkSoft = resolveColor(tokens, light, "--sj-ink-soft");
      const page = resolveColor(tokens, light, "--sj-page");
      expect(inkSoft).toMatch(/^#[0-9a-f]{6}$/i);
      expect(page).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(inkSoft, page)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("does not dim a checked row with opacity; soft ink and the strike show it is checked", () => {
    const { container } = render(
      <ChecklistRow checked name="lemons" quantity="2 whole" note="already in basket" onToggle={() => undefined} action={<button type="button">Remove lemons</button>} />,
    );

    expect(screen.getByRole("checkbox", { name: "lemons" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("checklist-row-strike")).toBeInTheDocument();
    for (const element of Array.from(container.querySelectorAll("*"))) {
      expect(element.getAttribute("class") ?? "").not.toMatch(/(^|\s)opacity-(?!100\b)\S+/);
    }
    expect(screen.getByText("already in basket")).toHaveClass("text-[var(--sj-ink-soft)]");
    expect(screen.getByText("2 whole")).toHaveClass("text-[var(--sj-ink-soft)]");
  });

  it("changes the view buttons', category chips' and row checkboxes' colours instantly, never mid-fade", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/shopping-list",
        Component: ShoppingList,
        loader: () => ({
          shoppingList: {
            id: "list-1",
            items: [{ id: "item-1", quantity: 2, checked: false, unit: { name: "whole" }, ingredientRef: { name: "lemons" }, categoryKey: "produce", iconKey: "lemon" }],
          },
          recipes: [],
        }),
      },
    ]);

    render(<Stub initialEntries={["/shopping-list"]} />);

    const controls = [
      ...[/^Need 1$/, /^Basket 0$/, /^All 1$/].map((name) => screen.findByRole("button", { name })),
      screen.findByRole("button", { name: "all" }),
      screen.findByRole("button", { name: "Produce" }),
    ];
    for (const control of await Promise.all(controls)) {
      expect(control).toHaveClass("sj-instant-state");
      expect(control.className).not.toMatch(/(^|\s)(transition|transition-all|transition-colors)(\s|$)/);
    }
    const checkbox = screen.getByRole("checkbox", { name: "lemons" });
    expect(checkbox.querySelector("[aria-hidden='true']")).toHaveClass("sj-instant-state");
  });
});
