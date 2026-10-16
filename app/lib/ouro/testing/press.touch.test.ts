import { afterEach, expect, test } from "vitest";
import { pressTint } from "~/lib/ouro/testing/press";

// Runs in the `touch` project: the helper proves an `:active` tint where hover is off.

const nodes: Element[] = [];
afterEach(() => {
  for (const node of nodes.splice(0)) node.remove();
});

function box(css: string): HTMLElement {
  const style = document.createElement("style");
  style.textContent = css;
  const element = document.createElement("button");
  element.textContent = "Press";
  Object.assign(element.style, { display: "block", width: "120px", height: "48px", margin: "24px" });
  document.body.append(style, element);
  nodes.push(style, element);
  return element;
}

test("reports a tint that only :active explains", async () => {
  const element = box("button { background: rgb(255, 255, 255); } button:active { background: rgb(200, 220, 255); }");
  const { rest, pressed, active } = await pressTint(element);
  expect(active).toBe(true);
  expect(rest).toBe("rgb(255, 255, 255)");
  expect(pressed).toBe("rgb(200, 220, 255)");
});

test("fails on an element with no pressed tint", async () => {
  const element = box("button { background: rgb(255, 255, 255); }");
  await expect(pressTint(element)).rejects.toThrow();
});

test("runs `during` while the button is still down", async () => {
  const element = box("button:active { background: rgb(200, 220, 255); }");
  let activeDuring = false;
  await pressTint(element, { during: () => (activeDuring = element.matches(":active")) });
  expect(activeDuring).toBe(true);
});

test("leaves no listener or data-press-target behind, even after a failure", async () => {
  const element = box("button { background: rgb(255, 255, 255); }");
  const seen: string[] = [];
  const note = (event: Event) => seen.push(event.type);
  addEventListener("pointermove", note);
  try {
    await expect(pressTint(element)).rejects.toThrow();
    expect(element.hasAttribute("data-press-target")).toBe(false);
    // The moves it blocked are delivered again.
    seen.length = 0;
    element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(seen).toEqual(["pointermove"]);
  } finally {
    removeEventListener("pointermove", note);
  }
});
