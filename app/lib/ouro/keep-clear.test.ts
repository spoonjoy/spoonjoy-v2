import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { keepClear } from "~/lib/ouro/keep-clear";

// An element fixed at the bottom end of the window, as the toasts' viewport is: at 1280px wide its
// column runs from 896px to 1256px, 24px above the window's bottom. Its resting place comes from a
// style sheet, so taking its inline `bottom` away puts it back.

const added: Element[] = [];
const releases: (() => void)[] = [];
let element: HTMLElement;

function add<T extends Element>(node: T, parent: Element = document.body): T {
  parent.append(node);
  if (parent === document.body) added.push(node);
  return node;
}

/** A control fixed near the bottom end of the window, such as a call's Join button, inside a part of the page. */
function control(css = "") {
  const part = add(document.createElement("section"));
  const button = add(document.createElement("button"), part);
  button.textContent = "Join";
  button.setAttribute("data-keep-clear", "");
  button.style.cssText = `position: fixed; bottom: 16px; right: 16px; width: 140px; height: 44px; ${css}`;
  return button;
}

function start(selector = "[data-keep-clear]") {
  const release = keepClear(element, selector);
  releases.push(release);
  return release;
}

/** How far the element's bottom sits above the window's. */
const bottom = () => Math.round(document.documentElement.clientHeight - element.getBoundingClientRect().bottom);
/** How far the element's bottom sits above a control's top. */
const above = (button: HTMLElement) => Math.round(button.getBoundingClientRect().top - element.getBoundingClientRect().bottom);

beforeEach(async () => {
  await page.viewport(1280, 800);
  const sheet = add(document.createElement("style"));
  sheet.textContent = ".kept { position: fixed; bottom: 24px; right: 24px; width: 360px; height: 60px; }";
  element = add(document.createElement("div"));
  element.className = "kept";
});

afterEach(() => {
  for (const release of releases.splice(0)) release();
  for (const node of added.splice(0)) node.remove();
});

describe("keepClear", () => {
  it("lifts the element above a matched control under it, and lets it back down when the control goes", async () => {
    const join = control();
    start();
    expect(above(join)).toBe(8);
    join.style.display = "none";
    await expect.poll(bottom).toBe(24);
    join.style.display = "";
    await expect.poll(() => above(join)).toBe(8);
    join.parentElement!.remove();
    await expect.poll(bottom).toBe(24);
    const late = control();
    await expect.poll(() => above(late)).toBe(8);
  });

  it("sits above the highest of the matched controls under it", async () => {
    control();
    const high = control("bottom: 120px");
    start();
    expect(above(high)).toBe(8);
  });

  it("measures to the pixel: a control that ends where the column starts, starts where it ends, can't be seen or sits in the window's top half is clear of it, and one at the window's middle is under it", async () => {
    const clear = [
      control("right: auto; left: 756px"),
      control("right: 0; width: 24px"),
      control("visibility: hidden"),
      control("opacity: 0"),
      control("bottom: auto; top: 399px"),
    ];
    start();
    expect(bottom()).toBe(24);
    for (const button of clear) button.parentElement!.remove();
    const middle = control("bottom: auto; top: 400px");
    await expect.poll(() => above(middle)).toBe(8);
  });

  it("leaves the element where it is for selectors nothing matches", async () => {
    control();
    start("[data-call]");
    expect(bottom()).toBe(24);
  });

  it("measures when the page changes in the same moment as the element does", async () => {
    const join = control("display: none");
    start();
    element.setAttribute("data-seen", "");
    join.style.display = "";
    await expect.poll(() => above(join)).toBe(8);
  });

  it("measures again when the window resizes", async () => {
    const join = control("right: auto; left: 16px");
    start();
    expect(bottom()).toBe(24);
    await page.viewport(390, 844);
    // At 390px the column runs from 6px to 366px, over the control.
    await expect.poll(() => above(join)).toBe(8);
  });

  it("lets go of the page and the window when released", async () => {
    const join = control("display: none");
    const release = start();
    release();
    join.style.display = "";
    const wide = control("right: auto; left: 16px");
    await page.viewport(390, 844);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(bottom()).toBe(24);
    expect(above(wide)).toBeLessThan(8);
  });
});
