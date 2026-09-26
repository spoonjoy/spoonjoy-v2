import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SkipLink } from "~/components/navigation/skip-link";

function renderWithMain() {
  render(
    <>
      <SkipLink />
      <main id="main" tabIndex={-1}>
        Page
      </main>
    </>,
  );
  return screen.getByRole("main");
}

describe("SkipLink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("keeps #main as its href for no-JS", () => {
    renderWithMain();

    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link).toHaveAttribute("href", "#main");
    expect(link).toHaveClass("sj-skip-link");
  });

  it("moves focus to main without adding a history entry", () => {
    const main = renderWithMain();
    const scrollIntoView = vi.fn();
    main.scrollIntoView = scrollIntoView;
    const pushState = vi.spyOn(window.history, "pushState");
    const lengthBefore = window.history.length;

    const notCancelled = fireEvent.click(screen.getByRole("link", { name: "Skip to main content" }));

    expect(notCancelled).toBe(false);
    expect(main).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(pushState).not.toHaveBeenCalled();
    expect(window.history.length).toBe(lengthBefore);
    expect(window.location.hash).toBe("");
  });

  it("leaves modified clicks to the browser", () => {
    renderWithMain();

    expect(fireEvent.click(screen.getByRole("link", { name: "Skip to main content" }), { ctrlKey: true })).toBe(true);
  });

  it("falls back to the href when there is no main element", () => {
    render(<SkipLink />);

    expect(fireEvent.click(screen.getByRole("link", { name: "Skip to main content" }))).toBe(true);
  });
});
