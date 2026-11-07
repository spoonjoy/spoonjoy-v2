import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useViewportTopVar } from "~/hooks/use-viewport-top-var";

function Probe({ attach = true }: { attach?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useViewportTopVar(ref, "--probe-top");
  return <section>{attach ? <div ref={ref} data-testid="probe" /> : null}</section>;
}

describe("useViewportTopVar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("publishes the element's viewport top and re-measures when its parent resizes", () => {
    let top = 80;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top }) as DOMRect);
    let fire = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          fire = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );

    const { getByTestId, unmount } = render(<Probe />);
    const probe = getByTestId("probe");
    expect(probe.style.getPropertyValue("--probe-top")).toBe("80px");
    expect(observe).toHaveBeenCalledWith(probe.parentElement);

    top = 132;
    fire();
    expect(probe.style.getPropertyValue("--probe-top")).toBe("132px");

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("measures once without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top: 12 }) as DOMRect);
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("probe").style.getPropertyValue("--probe-top")).toBe("12px");
  });

  it("does nothing without an element", () => {
    expect(() => render(<Probe attach={false} />)).not.toThrow();
  });
});
