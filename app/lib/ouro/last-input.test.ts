import { expect, it } from "vitest";
import { lastInput } from "~/lib/ouro/last-input";

const move = (pointerType: string) => document.dispatchEvent(new PointerEvent("pointermove", { pointerType }));
const press = (pointerType: string) => document.dispatchEvent(new PointerEvent("pointerdown", { pointerType }));

it("records the pointer type of a press, and keyboard after a key press", () => {
  press("touch");
  expect(lastInput()).toBe("touch");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
  expect(lastInput()).toBe("keyboard");
});

it("counts a moving mouse or pen as in use again after a touch, but not a moving finger", () => {
  press("touch");
  move("touch");
  expect(lastInput()).toBe("touch");
  move("mouse");
  expect(lastInput()).toBe("mouse");
  press("touch");
  move("pen");
  expect(lastInput()).toBe("pen");
});

const modality = () => document.documentElement.getAttribute("data-ouro-modality");
const key = (name: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: name }));

it("marks the page's modality: pointer after a press, keyboard after a key, and not for a lone modifier", () => {
  press("mouse");
  expect(modality()).toBe("pointer");
  key("Shift");
  expect(modality()).toBe("pointer");
  key("Control");
  key("Alt");
  key("Meta");
  key("AltGraph");
  key("CapsLock");
  expect(modality()).toBe("pointer");
  key("Tab");
  expect(modality()).toBe("keyboard");
  press("touch");
  expect(modality()).toBe("pointer");
  key("ArrowDown");
  expect(modality()).toBe("keyboard");
});

it("switches to keyboard only on a key that moves focus: Tab and Shift+Tab, the arrows, Home, End, Page Up and Page Down", () => {
  for (const name of ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]) {
    press("mouse");
    key(name);
    expect(modality(), name).toBe("keyboard");
  }
  press("mouse");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
  expect(modality()).toBe("keyboard");
});

it("stays in pointer modality for Escape, Enter, Space, a command shortcut and typed characters, though lastInput() still says keyboard", () => {
  for (const name of ["Escape", "Enter", " ", "k", "a", "Backspace", "Delete", "F6"]) {
    press("mouse");
    key(name);
    expect(modality(), name).toBe("pointer");
    expect(lastInput()).toBe("keyboard");
  }
  press("mouse");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  expect(modality()).toBe("pointer");
});

it("leaves the attribute alone when the modality has not changed", () => {
  key("Tab");
  const seen: string[] = [];
  const observer = new MutationObserver((records) => records.forEach((record) => seen.push(record.attributeName ?? "")));
  observer.observe(document.documentElement, { attributes: true });
  key("ArrowDown");
  return Promise.resolve().then(() => {
    observer.disconnect();
    expect(seen).toEqual([]);
  });
});

it("sees a press or key that a handler below stops, because it listens in the capture phase", () => {
  const target = document.body.appendChild(document.createElement("button"));
  const stop = (event: Event) => event.stopPropagation();
  target.addEventListener("pointerdown", stop);
  target.addEventListener("keydown", stop);
  try {
    key("Tab");
    target.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", bubbles: true }));
    expect(modality()).toBe("pointer");
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(modality()).toBe("keyboard");
  } finally {
    target.remove();
  }
});

const pressedFocus = (element: Element) => element.hasAttribute("data-ouro-pressed-focus");

it("marks the focused element after a press and unmarks it after a key, when focus leaves, and never marks the page", () => {
  const first = document.body.appendChild(document.createElement("button"));
  const second = document.body.appendChild(document.createElement("button"));
  try {
    key("Tab");
    first.focus();
    expect(pressedFocus(first)).toBe(false);
    press("mouse");
    expect(pressedFocus(first)).toBe(true);
    second.focus();
    expect([pressedFocus(first), pressedFocus(second)]).toEqual([false, true]);
    key("ArrowDown");
    expect(pressedFocus(second)).toBe(false);
    second.blur();
    press("mouse");
    expect([pressedFocus(document.body), pressedFocus(document.documentElement)]).toEqual([false, false]);
    // A focus event an app dispatches on the document itself has no element to mark or unmark, and is let through.
    expect([document.dispatchEvent(new FocusEvent("focusin")), document.dispatchEvent(new FocusEvent("focusout"))]).toEqual([true, true]);
  } finally {
    first.remove();
    second.remove();
  }
});

it("marks and unmarks focus that a handler below stops, because it listens to focus in the capture phase", () => {
  const target = document.body.appendChild(document.createElement("button"));
  const stop = (event: Event) => event.stopPropagation();
  target.addEventListener("focusin", stop);
  target.addEventListener("focusout", stop);
  try {
    press("mouse");
    target.focus();
    expect(pressedFocus(target)).toBe(true);
    target.blur();
    expect(pressedFocus(target)).toBe(false);
  } finally {
    target.remove();
  }
});

it("marks the elements around pressed focus, up to the body, and unmarks them after a key that moves focus or when focus leaves", () => {
  const outer = document.body.appendChild(document.createElement("div"));
  const field = outer.appendChild(document.createElement("label"));
  const input = field.appendChild(document.createElement("input"));
  const within = () => [outer, field, document.body].map((element) => element.hasAttribute("data-ouro-pressed-within"));
  try {
    press("mouse");
    input.focus();
    expect(within()).toEqual([true, true, false]);
    expect(input.hasAttribute("data-ouro-pressed-within")).toBe(false);
    key("Tab");
    expect(within()).toEqual([false, false, false]);
    press("mouse");
    expect(within()).toEqual([true, true, false]);
    input.blur();
    expect(within()).toEqual([false, false, false]);
  } finally {
    outer.remove();
  }
});
