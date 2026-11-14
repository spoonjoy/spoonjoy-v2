import { describe, expect, it } from "vitest";
import { computedValue } from "~/lib/ouro/testing/computed";

describe("computedValue", () => {
  it("gives the value as this browser computes it for the declaration, and leaves no probe behind", () => {
    const before = document.body.childElementCount;
    const element = document.createElement("div");
    element.style.alignItems = "flex-end";
    document.body.append(element);
    expect(computedValue("align-items", "flex-end")).toBe(getComputedStyle(element).alignItems);
    expect(computedValue("justify-content", "space-between")).toBe("space-between");
    element.remove();
    expect(document.body.childElementCount).toBe(before);
  });
});
