import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useResumeStepScroll } from "~/hooks/use-resume-step-scroll";

function addStep(stepNum: number) {
  const element = document.createElement("div");
  element.id = `step-${stepNum}`;
  element.scrollIntoView = vi.fn();
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  window.scrollTo(0, 0);
});

describe("useResumeStepScroll", () => {
  it("brings the cook's step into view once per step", () => {
    const two = addStep(2);
    const three = addStep(3);
    const { rerender } = renderHook(({ step }) => useResumeStepScroll(step, false), { initialProps: { step: 2 as number | null } });

    expect(two.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    rerender({ step: 2 });
    expect(two.scrollIntoView).toHaveBeenCalledTimes(1);
    rerender({ step: 3 });
    expect(three.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("leaves the page alone with no step, in cook mode, after a # link or once the reader has scrolled", () => {
    const step = addStep(2);
    renderHook(() => useResumeStepScroll(null, false));
    renderHook(() => useResumeStepScroll(2, true));
    window.history.replaceState(null, "", "/#steps");
    renderHook(() => useResumeStepScroll(2, false));
    window.history.replaceState(null, "", "/");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 400 });
    renderHook(() => useResumeStepScroll(2, false));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });

    expect(step.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does nothing when the step is not on the page", () => {
    expect(() => renderHook(() => useResumeStepScroll(9, false))).not.toThrow();
  });
});
