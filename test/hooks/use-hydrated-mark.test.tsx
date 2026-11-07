import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useHydratedMark } from "~/hooks/use-hydrated-mark";

describe("useHydratedMark", () => {
  afterEach(() => {
    delete document.documentElement.dataset.hydrated;
  });

  it("marks the document hydrated once its effect runs", () => {
    expect(document.documentElement.hasAttribute("data-hydrated")).toBe(false);
    renderHook(() => useHydratedMark());
    expect(document.documentElement.getAttribute("data-hydrated")).toBe("");
  });
});
