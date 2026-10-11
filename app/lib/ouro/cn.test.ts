import { expect, it } from "vitest";
import { cn } from "~/lib/ouro/cn";

it("joins classes and skips falsy values", () => {
  expect(cn("m-0", false, undefined, "flex", null, "")).toBe("m-0 flex");
});

it("lets a later class win over an earlier one that sets the same property", () => {
  expect(cn("h-11 px-4", "h-20")).toBe("px-4 h-20");
  expect(cn("max-w-[32rem]", "max-w-lg")).toBe("max-w-lg");
});

it("keeps classes that set different properties, or the same property under another variant", () => {
  expect(cn("m-0", "mt-4")).toBe("m-0 mt-4");
  expect(cn("h-11 sm:h-9", "h-20")).toBe("sm:h-9 h-20");
  // So Button sets its density through variables, with one unprefixed h-* and px-*.
  expect(cn("h-(--ouro-button-h) px-(--ouro-button-px) sm:[--ouro-button-h:2rem]", "h-20 px-8")).toBe(
    "sm:[--ouro-button-h:2rem] h-20 px-8",
  );
  expect(cn("text-base text-primary", "text-sm")).toBe("text-primary text-sm");
});
