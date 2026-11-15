import { expect, test } from "../fixtures";

// Ouro's corner radii, read from the computed style of Spoonjoy's own stylesheet and components in
// the built Storybook. A corner is the theme's base radius (--radius times --ouro-radius-scale)
// times the token's scale (rounded-lg is 1, rounded-xl 1.4, as tailwind.css's @theme sets them) times
// the Safari factor the engine applies: 1 where it draws corner-shape, and Ouro's 0.7 where it has
// none (ouro-base's @supports not (corner-shape: squircle), copied into app/styles/tailwind.css).
const STORIES = [
  { name: "Button", id: "actions-button--playground", selector: "#storybook-root button", scale: 1 },
  { name: "Card", id: "display-card--playground", selector: '#storybook-root [data-ouro="card"]', scale: 1.4 },
] as const;

test.describe("Ouro corner radii", () => {
  for (const story of STORIES) {
    test(`${story.name} corners are the base radius times the token scale and the engine's Safari factor`, async ({ page }, testInfo) => {
      await page.goto(`iframe.html?id=${story.id}&viewMode=story&globals=theme:light;a11y.manual:!true;page:!true`);
      await page.locator(story.selector).first().waitFor();

      const measured = await page.evaluate((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`no element for ${selector}`);
        const probe = document.createElement("div");
        probe.style.borderRadius = "calc(var(--radius) * var(--ouro-radius-scale, 1))";
        document.body.append(probe);
        const base = parseFloat(getComputedStyle(probe).borderTopLeftRadius);
        probe.remove();
        return {
          base,
          corner: parseFloat(getComputedStyle(element).borderTopLeftRadius),
          fallback: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ouro-corner-fallback")),
          cornerShape: CSS.supports("corner-shape", "squircle"),
          userAgent: navigator.userAgent,
        };
      }, story.selector);

      const factor = measured.cornerShape ? 1 : 0.7;
      const engine = testInfo.project.name;
      console.log(
        `${engine} ${story.name}: base ${measured.base}px, corner ${measured.corner}px, ` +
          `--ouro-corner-fallback ${measured.fallback}, corner-shape ${measured.cornerShape}`,
      );
      expect(measured.fallback).toBe(factor);
      expect(measured.corner).toBeCloseTo(measured.base * story.scale * factor, 2);
    });
  }
});
