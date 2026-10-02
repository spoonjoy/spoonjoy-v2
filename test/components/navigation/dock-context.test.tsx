import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DockContextProvider, useDockContext, useDockSuppressed } from "~/components/navigation";

function Probe() {
  const { isSuppressed } = useDockContext();
  return <p>{isSuppressed ? "hidden" : "shown"}</p>;
}

function Suppressor({ suppressed }: { suppressed: boolean }) {
  useDockSuppressed(suppressed);
  return null;
}

describe("useDockSuppressed", () => {
  it("shows the tab bar by default and outside a provider", () => {
    render(<Probe />);
    expect(screen.getByText("shown")).toBeInTheDocument();
  });

  it("hides the tab bar while a page asks, and shows it again when the page stops asking", () => {
    const { rerender } = render(
      <DockContextProvider>
        <Suppressor suppressed />
        <Probe />
      </DockContextProvider>,
    );
    expect(screen.getByText("hidden")).toBeInTheDocument();

    rerender(
      <DockContextProvider>
        <Suppressor suppressed={false} />
        <Probe />
      </DockContextProvider>,
    );
    expect(screen.getByText("shown")).toBeInTheDocument();
  });

  it("shows the tab bar again when the suppressing page unmounts", () => {
    const { rerender } = render(
      <DockContextProvider>
        <Suppressor suppressed />
        <Probe />
      </DockContextProvider>,
    );
    rerender(
      <DockContextProvider>
        <Probe />
      </DockContextProvider>,
    );
    expect(screen.getByText("shown")).toBeInTheDocument();
  });
});
