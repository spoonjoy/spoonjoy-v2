import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useSectionFocus } from "~/hooks/use-section-focus";

function Page({ withTabIndex = false }: { withTabIndex?: boolean }) {
  useSectionFocus(["blocked-chefs"]);
  return (
    <div id="blocked-chefs" tabIndex={withTabIndex ? 0 : undefined}>
      Blocked chefs
    </div>
  );
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("useSectionFocus", () => {
  it("scrolls to and focuses the named section", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.history.replaceState(null, "", "/account/settings?section=blocked-chefs");
    const { container } = render(<Page />);
    const section = container.querySelector("#blocked-chefs")!;
    expect(section).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(section);
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  });

  it("keeps a section's own tab order", () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.history.replaceState(null, "", "/account/settings?section=blocked-chefs");
    const { container } = render(<Page withTabIndex />);
    expect(container.querySelector("#blocked-chefs")).toHaveAttribute("tabindex", "0");
  });

  it("ignores a missing, unknown or absent section", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Page />);
    cleanup();
    window.history.replaceState(null, "", "/account/settings?section=elsewhere");
    render(<Page />);
    cleanup();
    window.history.replaceState(null, "", "/account/settings?section=blocked-chefs");
    function Empty() {
      useSectionFocus(["blocked-chefs"]);
      return null;
    }
    render(<Empty />);
    expect(scroll).not.toHaveBeenCalled();
  });
});
