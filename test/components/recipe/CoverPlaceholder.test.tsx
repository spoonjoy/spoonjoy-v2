import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CoverPlaceholder } from "~/components/recipe/CoverPlaceholder";
import { THEME_CSS } from "../../styles/theme-css";

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(THEME_CSS);
  if (!match) throw new Error(`No rule for ${selector}`);
  return match[1]!.replace(/\s+/g, " ").trim();
}

describe("CoverPlaceholder", () => {
  it("is native's initial tile: the title's first letter, in the display serif and brass", () => {
    render(<CoverPlaceholder title="  lemon herb rice" data-testid="tile" />);

    const tile = screen.getByTestId("tile");
    expect(tile).toHaveClass("sj-cover-placeholder");
    const initial = tile.querySelector(".sj-cover-placeholder-initial");
    expect(initial).toHaveTextContent("L");
    expect(initial).toHaveAttribute("aria-hidden", "true");
  });

  it("falls back to S for a title with no letters, as native does", () => {
    render(<CoverPlaceholder title="   " data-testid="tile" />);
    expect(screen.getByTestId("tile")).toHaveTextContent("S");
  });

  it("takes the first character whole, so an emoji title keeps its emoji", () => {
    render(<CoverPlaceholder title="🍋 Lemon tart" data-testid="tile" />);
    expect(screen.getByTestId("tile").querySelector(".sj-cover-placeholder-initial")).toHaveTextContent("🍋");
  });

  it("keeps a label for screen readers only", () => {
    render(<CoverPlaceholder title="Toast" label="Cover coming soon" data-testid="tile" />);
    expect(screen.getByText("Cover coming soon")).toHaveClass("sr-only");
  });

  it("has no border class, whatever layout the caller passes", () => {
    render(<CoverPlaceholder title="Toast" className="aspect-[3/2] w-full" data-testid="tile" />);
    const tokens = Array.from(screen.getByTestId("tile").classList);
    expect(tokens.filter((token) => /^border(-|$)/.test(token))).toEqual([]);
  });

  it("bleeds square where a cover photo would, keeping the gradient and the initial", () => {
    render(<CoverPlaceholder title="Toast" shape="bleed" data-testid="tile" />);
    const tile = screen.getByTestId("tile");
    expect(tile).toHaveClass("sj-cover-placeholder", "sj-cover-placeholder-bleed");
    expect(tile).toHaveTextContent("T");
    expect(rule(".sj-cover-placeholder.sj-cover-placeholder-bleed")).toContain("border-radius: 0;");
  });

  it("is a photo-radius tile unless asked to bleed", () => {
    render(<CoverPlaceholder title="Toast" data-testid="tile" />);
    expect(screen.getByTestId("tile")).not.toHaveClass("sj-cover-placeholder-bleed");
  });

  it("is a photo-radius tile in native's vellum-to-brass gradient, with no border", () => {
    const tile = rule(".sj-cover-placeholder");
    expect(tile).toContain("border-radius: var(--sj-radius-photo);");
    expect(tile).toContain(
      "background: linear-gradient(135deg, var(--sj-vellum), color-mix(in srgb, var(--sj-brass) 32%, transparent));",
    );
    expect(tile).toContain("border: 0;");
  });

  it("sets the initial in Fraunces and brass, sized to the tile as native's is", () => {
    const initial = rule(".sj-cover-placeholder-initial");
    expect(initial).toContain("font-family: var(--font-sj-display);");
    expect(initial).toContain("color: var(--sj-brass);");
    // RecipeInitialTile scales the letter to 42% of the tile's height.
    expect(initial).toContain("font-size: 42cqh;");
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

describe("the cook timer ring", () => {
  it("draws a vellum track, a brass arc and light tabular digits", () => {
    expect(rule(".sj-cook-timer-track")).toContain("stroke: var(--sj-vellum);");
    expect(rule(".sj-cook-timer-progress")).toContain("stroke: var(--sj-brass);");
    const digits = rule('.sj-cook-timer [role="timer"]');
    expect(digits).toContain("font-weight: 300;");
    expect(digits).toContain("font-variant-numeric: tabular-nums;");
  });

  it("moves the arc without a transition under reduced motion", () => {
    expect(THEME_CSS.replace(/\s+/g, " ")).toContain(
      "@media (prefers-reduced-motion: reduce) { .sj-cook-timer-progress { transition: none; } }",
    );
  });
});
