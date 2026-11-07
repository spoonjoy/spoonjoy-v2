import { describe, expect, it } from "vitest";
import { controlRef } from "~/lib/ouro/control-ref";

describe("controlRef", () => {
  it("marks the element it is given with the item and the part", () => {
    const input = document.createElement("input");
    controlRef("checkbox", "hidden-input")(input);
    expect(input.getAttribute("data-ouro-control")).toBe("checkbox");
    expect(input.getAttribute("data-ouro-part")).toBe("hidden-input");
  });

  it("does nothing when React detaches it", () => {
    expect(() => controlRef("checkbox", "hidden-input")(null)).not.toThrow();
  });
});
