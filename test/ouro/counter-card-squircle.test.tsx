// The kitchen's On the counter card is a squircle in every engine, never a round arc (Ari, 2026-11-20:
// squircle only). It is Ouro UI's Card with a backdrop: where the engine has corner-shape, the card and its
// picture draw Ouro's corner shape; where it does not (WebKit), the build's squircleCorners() (postcss.config.js)
// clips the card to the squircle at its --ouro-sq-r, cutting only the slivers outside the squircle's corners, so
// the card's text and capsules are never cut. Read from the engine's computed styles under the app's compiled
// stylesheet, so each browser project proves its own path.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Button } from "~/components/ouro/button/button";
import { Card } from "~/components/ouro/card/card";

afterEach(cleanup);

const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

function renderCard() {
  const { container } = render(
    <Card
      as="section"
      backdrop={
        <>
          <img src={PIXEL} alt="" />
          <div aria-hidden="true" className="sj-counter-shade" />
        </>
      }
      className="sj-on-charcoal sj-counter-card min-h-[22rem] justify-end"
    >
      <p>Lemon Herb Rice</p>
      <Button href="/recipes/1#cook">Start cooking</Button>
    </Card>,
  );
  const card = container.querySelector<HTMLElement>("section")!;
  return { card, backdrop: card.querySelector<HTMLElement>("[data-card-backdrop]")! };
}

/** The card's squircle radius in px: four of the theme's control radii, as the Apple app's 24pt card. */
function squircleRadius(card: HTMLElement): number {
  const probe = document.createElement("div");
  probe.style.width = "var(--ouro-sq-r)";
  probe.style.position = "absolute";
  card.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

/** The rules the build keeps for an engine without corner-shape, applied here unconditionally, as that engine would. */
function applyFallback(): () => void {
  const rules: string[] = [];
  for (const sheet of document.styleSheets) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    const walk = (items: CSSRuleList) => {
      for (const rule of items) {
        if (rule instanceof CSSSupportsRule && /not\s*\(corner-shape/.test(rule.conditionText)) {
          for (const inner of rule.cssRules) rules.push(inner.cssText);
        } else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    walk(list);
  }
  const style = document.createElement("style");
  style.textContent = rules.join("\n");
  document.head.append(style);
  return () => style.remove();
}

describe("the On the counter card", () => {
  it("draws its corner and its picture's as a squircle where the engine has corner-shape", () => {
    const { card, backdrop } = renderCard();
    expect(squircleRadius(card)).toBeGreaterThan(16);
    if (CSS.supports("corner-shape: squircle")) {
      expect(Number.parseFloat(getComputedStyle(card).borderTopLeftRadius)).toBeCloseTo(squircleRadius(card), 1);
      // Engines name the squircle by its keyword or as the superellipse it is.
      for (const element of [card, backdrop]) {
        expect(["squircle", "superellipse(2)"]).toContain(getComputedStyle(element).getPropertyValue("corner-shape"));
      }
      expect(getComputedStyle(backdrop).borderTopLeftRadius).toBe(getComputedStyle(card).borderTopLeftRadius);
    }
  });

  it("clips the card to Ouro's squircle at its own radius where the engine has no corner-shape, and nothing inside it", () => {
    const remove = applyFallback();
    try {
      const { card } = renderCard();
      const radius = squircleRadius(card);
      const style = getComputedStyle(card);
      // squircleCorners() hands the clip path the card's radius, and shrinks the round corner under it to the
      // circle inside the squircle (0.543 of the radius), so no circular arc shows past the squircle.
      expect(Number.parseFloat(style.getPropertyValue("--sq-tl"))).toBeCloseTo(radius, 1);
      expect(Number.parseFloat(style.borderTopLeftRadius)).toBeCloseTo(radius * 0.543, 1);
      // The squircle's outline: a rectangle far outside the card, the card's box, then the squircle at its radius,
      // drawn in Bezier curves, not an inset rounded by circular arcs.
      const clip = style.clipPath;
      expect(clip).toMatch(/^shape\(from -9999px -9999px/);
      expect(clip).toContain(`move to 0px ${radius}px`);
      expect(clip).toContain("curve by");
      expect(clip).not.toMatch(/round|circle|ellipse|arc /);
      // Nothing between the card and its capsule clips the capsule or the text; the capsule's own clip only
      // shapes its own corners.
      const link = card.querySelector("a")!;
      for (let node: Element | null = link.parentElement; node && node !== card; node = node.parentElement) {
        expect(getComputedStyle(node).clipPath).toBe("none");
      }
    } finally {
      remove();
    }
  });
});
