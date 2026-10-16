import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { commands, page } from "vitest/browser";
import { NativeSelect } from "~/components/ouro/select/native-select";
import { Select } from "~/components/ouro/select/select";
import { act } from "~/lib/ouro/testing/act";
import { pressTint } from "~/lib/ouro/testing/press";
import { rotate } from "~/lib/ouro/testing/rotate";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer
// (Review Focus 3: pickers are usable with one thumb).

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await rotate(390, 844);
  await commands.emulateMedia({ reducedMotion: "no-preference" });
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

const ingredients = Array.from({ length: 40 }, (_, index) => ({ value: `i${index}`, label: `Ingredient ${index + 1}` }));
const popup = () => document.querySelector<HTMLElement>('[data-ouro="select-popup"]')!;
const isOpen = () => document.querySelector('[data-ouro="select-popup"]')?.hasAttribute("data-open") ?? false;

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/**
 * Resolves once the popup has finished opening: Base UI holds transitions off for the first
 * frame, so wait until they are back on, nothing runs, and two reads of its box agree.
 */
async function settled(element: HTMLElement) {
  await expect
    .poll(async () => {
      const before = JSON.stringify(element.getBoundingClientRect());
      await frame();
      return (
        getComputedStyle(element).transitionProperty !== "none" &&
        element.getAnimations({ subtree: true }).length === 0 &&
        JSON.stringify(element.getBoundingClientRect()) === before
      );
    })
    .toBe(true);
}

it("opens the list as a bottom sheet below sm, headed by the label", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  await render(<Select label="Ingredient" name="ingredient" options={ingredients} />);
  await commands.tap('[role="combobox"]');
  await expect.poll(isOpen).toBe(true);
  await settled(popup());
  expect(popup().getAttribute("data-ouro-presentation")).toBe("sheet");
  const rect = popup().getBoundingClientRect();
  expect(rect.left).toBe(0);
  expect(rect.width).toBe(390);
  expect(Math.round(rect.bottom)).toBe(844);
  expect(rect.height).toBeLessThanOrEqual(844 * 0.7 + 1);
  expect(popup().querySelector('[aria-hidden="true"]')!.textContent).toBe("Ingredient");
  expect(document.querySelector('[data-ouro="select-backdrop"]')).not.toBeNull();
});

it("scrolls the list with a thumb without closing it or choosing", async () => {
  const host = await render(<Select label="Ingredient" name="ingredient" options={ingredients} />);
  await commands.tap('[role="combobox"]');
  await expect.poll(isOpen).toBe(true);
  await settled(popup());
  const list = popup().querySelector<HTMLElement>('[role="listbox"]')!;
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  const box = list.getBoundingClientRect();
  const x = box.left + box.width / 2;
  // The finger starts on an option and lifts on another: a scroll, not a choice.
  await commands.touchDrag({ from: [x, box.bottom - 30], to: [x, box.top + 30], steps: 10 });
  await expect.poll(() => list.scrollTop).toBeGreaterThan(100);
  await act(async () => {});
  expect(isOpen()).toBe(true);
  expect(host.querySelector<HTMLInputElement>('input[name="ingredient"]')!.value).toBe("");
});

it("chooses an option with a tap and closes, with 44px rows", async () => {
  const host = await render(<Select label="Ingredient" name="ingredient" options={ingredients.slice(0, 5)} />);
  await commands.tap('[role="combobox"]');
  await expect.poll(isOpen).toBe(true);
  await settled(popup());
  const row = [...popup().querySelectorAll<HTMLElement>('[role="option"]')][2]!;
  expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  row.setAttribute("data-test-row", "");
  await commands.tap("[data-test-row]");
  await expect.poll(isOpen).toBe(false);
  expect(host.querySelector('[role="combobox"]')!.textContent).toBe("Ingredient 3");
});

it("closes the sheet when the backdrop is tapped", async () => {
  await render(<Select label="Ingredient" options={ingredients.slice(0, 5)} />);
  await commands.tap('[role="combobox"]');
  await expect.poll(isOpen).toBe(true);
  await settled(popup());
  await page.elementLocator(document.body).click({ position: { x: 195, y: 40 } });
  await expect.poll(isOpen).toBe(false);
});

it("only fades the sheet with reduced motion", async () => {
  await commands.emulateMedia({ reducedMotion: "reduce" });
  await render(<Select label="Ingredient" options={ingredients.slice(0, 5)} />);
  await commands.tap('[role="combobox"]');
  await expect.poll(isOpen).toBe(true);
  await settled(popup());
  expect(getComputedStyle(popup()).transitionProperty).toBe("opacity");
});

it("slides the sheet up from the bottom edge in 500ms on the drawer curve, and leaves in 200ms", async () => {
  await render(<Select label="Ingredient" options={ingredients.slice(0, 5)} />);
  const tops: number[] = [];
  let sampling = true;
  const sample = () => {
    const element = document.querySelector<HTMLElement>('[data-ouro="select-popup"]');
    if (element) tops.push(element.getBoundingClientRect().top);
    if (sampling) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  await commands.tap('[role="combobox"]');
  await expect.poll(isOpen).toBe(true);
  await settled(popup());
  sampling = false;
  const style = getComputedStyle(popup());
  expect(style.transitionProperty).toBe("translate, opacity");
  expect(style.transitionDuration).toBe("0.5s, 0.15s");
  expect(style.transitionTimingFunction).toBe("cubic-bezier(0.32, 0.72, 0, 1), cubic-bezier(0.23, 1, 0.32, 1)");
  const rest = popup().getBoundingClientRect().top;
  // It starts below the screen and passes through positions on the way to rest.
  expect(Math.max(...tops)).toBeGreaterThanOrEqual(844);
  expect(tops.some((top) => top > rest + 1 && top < 844 - 1)).toBe(true);
  popup().setAttribute("data-ending-style", "");
  expect(getComputedStyle(popup()).transitionDuration).toBe("0.2s");
  popup().removeAttribute("data-ending-style");
});

describe("Select on a phone, pressed", () => {
  it("tints the trigger under a held finger, without moving or transforming it", async () => {
    const host = await render(<Select label="Course" options={[{ value: "a", label: "Starter" }]} />);
    const trigger = host.querySelector<HTMLElement>('[role="combobox"]')!;
    const box = JSON.stringify(trigger.getBoundingClientRect());
    // A mouse opens the list on pointer-down, and the open list is its feedback. A finger
    // opens it on release (the browser sends mousedown then), so for the whole hold the
    // trigger is pressed with the list closed and the tint is the only feedback; holding the
    // open back models that hold.
    const hold = (event: Event) => event.stopImmediatePropagation();
    const types = ["pointerdown", "mousedown", "click"];
    for (const type of types) window.addEventListener(type, hold, true);
    try {
      const { rest, pressed, active } = await pressTint(trigger, {
        during: () => {
          const style = getComputedStyle(trigger);
          expect([style.scale, style.transform]).toEqual(["none", "none"]);
          expect(JSON.stringify(trigger.getBoundingClientRect())).toBe(box);
        },
      });
      expect(active).toBe(true);
      expect(pressed).not.toBe(rest);
    } finally {
      for (const type of types) window.removeEventListener(type, hold, true);
    }
  });

  const options = [
    { value: "a", label: "Starter" },
    { value: "b", label: "Main" },
    { value: "c", label: "Dessert", disabled: true },
  ];

  async function openSheet() {
    await render(<Select label="Course" options={options} />);
    await commands.tap('[role="combobox"]');
    await expect.poll(isOpen).toBe(true);
    await settled(popup());
    return [...popup().querySelectorAll<HTMLElement>('[role="option"]')];
  }

  it("tints an option on pointer-down, from the press alone", async () => {
    const [, main] = await openSheet();
    const { rest, pressed, active } = await pressTint(main!, { clearHighlight: true });
    expect(active).toBe(true);
    expect(pressed).not.toBe(rest);
  });

  it("does not tint a disabled option, and stays open", async () => {
    const [, , dessert] = await openSheet();
    const rest = getComputedStyle(dessert!).backgroundColor;
    dessert!.setAttribute("data-press-target", "");
    await commands.pointerPress({ selector: "[data-press-target]", action: "down" });
    try {
      await expect.poll(() => dessert!.matches(":active")).toBe(true);
      // Base UI may highlight the row under the pointer; only the press itself is in question.
      dessert!.removeAttribute("data-highlighted");
      expect(getComputedStyle(dessert!).backgroundColor).toBe(rest);
    } finally {
      await commands.pointerPress({ selector: "[data-press-target]", action: "up" });
    }
    expect(isOpen()).toBe(true);
  });
});

it("keeps 44px controls and 16px text on a landscape phone, where the list opens by the trigger", async () => {
  await rotate(844, 390);
  const host = await render(
    <>
      <Select label="Ingredient" options={ingredients.slice(0, 5)} />
      <NativeSelect label="Country" options={[{ value: "nz", label: "New Zealand" }]} />
    </>,
  );
  const trigger = host.querySelector<HTMLElement>('[role="combobox"]')!;
  const select = host.querySelector<HTMLSelectElement>("select")!;
  for (const control of [trigger, select]) {
    expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(parseFloat(getComputedStyle(control).fontSize)).toBeGreaterThanOrEqual(16);
  }
  await commands.tap('[role="combobox"]');
  await expect.poll(isOpen).toBe(true);
  await settled(popup());
  expect(popup().hasAttribute("data-ouro-presentation")).toBe(false);
  expect(popup().querySelector<HTMLElement>('[role="option"]')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});

it("leaves NativeSelect to the operating system's picker, at 16px so iOS does not zoom", async () => {
  const host = await render(<NativeSelect label="Country" name="country" options={[{ value: "nz", label: "New Zealand" }]} />);
  const select = host.querySelector("select")!;
  expect(select.multiple).toBe(false);
  expect(select.size).toBe(0);
  expect(parseFloat(getComputedStyle(select).fontSize)).toBeGreaterThanOrEqual(16);
  expect(select.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});
