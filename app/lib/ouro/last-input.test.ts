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
