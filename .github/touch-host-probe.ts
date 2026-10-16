import type {} from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";

export const touchHostGeometry = (async (ctx, selector: string) => {
  const row = ctx.iframe.locator(selector);
  const physical = await row.boundingBox();
  if (!physical) throw new Error("Touch host probe row is not visible");
  const local = await row.evaluate((element) => ({
    box: element.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number },
    inner: { width: innerWidth, height: innerHeight },
    outer: { width: outerWidth, height: outerHeight },
    screen: { width: screen.width, height: screen.height, orientation: screen.orientation.type },
    dpr: devicePixelRatio,
    visual: visualViewport && {
      width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale,
      x: visualViewport.offsetLeft, y: visualViewport.offsetTop,
    },
    coarse: matchMedia("(pointer: coarse)").matches,
    landscape: matchMedia("(orientation: landscape)").matches,
    maxTouchPoints: navigator.maxTouchPoints,
  }));
  const host = await ctx.page.evaluate(() => ({
    inner: { width: innerWidth, height: innerHeight },
    outer: { width: outerWidth, height: outerHeight },
    screen: { width: screen.width, height: screen.height, orientation: screen.orientation.type },
    dpr: devicePixelRatio,
    visual: visualViewport && {
      width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale,
      x: visualViewport.offsetLeft, y: visualViewport.offsetTop,
    },
  }));
  const scale = { x: physical.width / local.box.width, y: physical.height / local.box.height };
  return {
    local, physical, host, scale,
    origin: { x: physical.x - local.box.x * scale.x, y: physical.y - local.box.y * scale.y },
  };
}) satisfies BrowserCommand<[selector: string]>;

export const touchHostWrongPoint = (async (ctx) => {
  const box = await ctx.iframe.locator("[data-host-probe-spacer]").boundingBox();
  if (!box) throw new Error("Touch host probe spacer is not visible");
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await ctx.page.touchscreen.tap(point.x, point.y);
  return point;
}) satisfies BrowserCommand<[]>;
