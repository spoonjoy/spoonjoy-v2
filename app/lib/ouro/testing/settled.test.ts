import { afterEach, expect, it } from "vitest";
import { settled } from "~/lib/ouro/testing/settled";

let mounted: HTMLElement[] = [];
afterEach(() => {
  for (const node of mounted) node.remove();
  mounted = [];
});

/** A fixed box whose top edge sits at 100px, so a `translate` moves it by a known amount. */
function mount(className = ""): HTMLDivElement {
  const element = document.createElement("div");
  element.className = className;
  element.style.cssText = "position: fixed; top: 100px; left: 0; width: 100px; height: 50px";
  document.body.append(element);
  mounted.push(element);
  return element;
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
/** Several frames, longer than the poll's interval, so `settled` has read the element while it is held. */
async function frames(count: number) {
  for (let i = 0; i < count; i++) await frame();
}

it("waits for a transition to end, and for the box to hold still before it resolves", async () => {
  const card = mount();
  card.style.transition = "translate 300ms linear";
  await frame();
  card.style.translate = "0 200px";
  await settled(card);
  expect(card.getAnimations()).toHaveLength(0);
  expect(card.getBoundingClientRect().top).toBe(300);
});

it("waits for an element that mounts later, found by a function", async () => {
  let resolved = false;
  const done = settled(() => document.querySelector<HTMLElement>(".mounts-later")).then(() => {
    resolved = true;
  });
  await frames(5);
  expect(resolved).toBe(false);
  mount("mounts-later");
  await done;
  expect(document.querySelector(".mounts-later")).not.toBeNull();
});

it("waits while data-starting-style is set, and resolves once it is removed", async () => {
  const panel = mount();
  panel.setAttribute("data-starting-style", "");
  let resolved = false;
  const done = settled(panel).then(() => {
    resolved = true;
  });
  await frames(5);
  expect(resolved).toBe(false);
  panel.removeAttribute("data-starting-style");
  await done;
  expect(panel.hasAttribute("data-starting-style")).toBe(false);
});

it("does not wait on an infinite animation, such as a spinner", async () => {
  const spinner = mount();
  const animation = spinner.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 1000, iterations: Infinity });
  await settled(spinner);
  expect(animation.playState).toBe("running");
});

it("waits for an animation on a child, although the element's own box does not move", async () => {
  const card = mount();
  const child = document.createElement("span");
  card.append(child);
  child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  await settled(card);
  expect(child.getAnimations()).toHaveLength(0);
});
