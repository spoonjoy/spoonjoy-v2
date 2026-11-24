import { expect, test } from "../fixtures";

// Ouro's squircle corners, read from the computed style of Spoonjoy's own stylesheet and components in
// the built Storybook. A corner is the theme's base radius (--radius times --ouro-radius-scale) times
// the token's scale (rounded-lg is 1, rounded-xl 1.4, as tailwind.css's @theme sets them), in every
// engine. The build's squircleCorners() (postcss.config.js) makes it a squircle: where the engine has
// corner-shape it sets corner-shape: squircle; where it has none (WebKit) it sets the radius as
// --sq-tl, clips the element to a squircle path at that radius, and shrinks the round border-radius
// to the circle inside it (0.543), so no plain round corner shows.
// A control (control: true) wears the theme's control radius instead (--ouro-control-radius, Cookbook's 9999px capsule),
// which stops at half the control's height.
const STORIES = [
  { name: "Button", id: "actions-button--playground", selector: "#storybook-root button", scale: 1, control: true },
  { name: "Card", id: "display-card--playground", selector: '#storybook-root [data-ouro="card"]', scale: 1.4, control: false },
] as const;
const ENCLOSING_CIRCLE = 0.543;

test.describe("Ouro corner radii", () => {
  for (const story of STORIES) {
    test(`${story.name} corners are squircles at the base radius times the token scale`, async ({ page }, testInfo) => {
      await page.goto(`iframe.html?id=${story.id}&viewMode=story&globals=theme:light;a11y.manual:!true;page:!true`);
      await page.locator(story.selector).first().waitFor();

      const measured = await page.evaluate(([selector, control]) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`no element for ${selector}`);
        const probe = document.createElement("div");
        const radius = control ? "var(--ouro-control-radius, var(--radius))" : "var(--radius)";
        probe.style.borderRadius = `min(calc(${radius} * var(--ouro-radius-scale, 1)), ${control ? element.getBoundingClientRect().height / 2 : 99999}px)`;
        document.body.append(probe);
        const base = parseFloat(getComputedStyle(probe).borderTopLeftRadius);
        probe.remove();
        const style = getComputedStyle(element);
        return {
          base,
          corner: parseFloat(style.borderTopLeftRadius),
          squircleRadius: parseFloat(style.getPropertyValue("--sq-tl")),
          cornerShape: CSS.supports("corner-shape", "squircle"),
          shownCornerShape: style.getPropertyValue("corner-top-left-shape"),
          shapeClip: CSS.supports("clip-path", "shape(from 0 0, close)"),
          clipPath: style.clipPath,
        };
      }, [story.selector, story.control] as const);

      const engine = testInfo.project.name;
      console.log(
        `${engine} ${story.name}: base ${measured.base}px, corner ${measured.corner}px, --sq-tl ${measured.squircleRadius}px, ` +
          `corner-shape ${measured.cornerShape} (${measured.shownCornerShape}), clip-path ${measured.clipPath.slice(0, 40)}`,
      );
      const radius = measured.base * story.scale;
      if (measured.cornerShape) {
        expect(measured.shownCornerShape).toBe("squircle");
        expect(measured.corner).toBeCloseTo(radius, 2);
      } else if (measured.shapeClip) {
        // A capsule stays round by intent: the plugin leaves a radius of half the height or more alone.
        if (measured.squircleRadius === 0) {
          expect(measured.corner).toBeCloseTo(radius, 2);
        } else {
          expect(measured.clipPath).toMatch(/^shape\(/);
          expect(measured.squircleRadius).toBeCloseTo(radius, 2);
          expect(measured.corner).toBeCloseTo(radius * ENCLOSING_CIRCLE, 1);
        }
      } else {
        // An engine with neither corner-shape nor clip-path: shape() can only draw a round corner.
        expect(measured.corner).toBeCloseTo(radius, 2);
      }
    });
  }
});
