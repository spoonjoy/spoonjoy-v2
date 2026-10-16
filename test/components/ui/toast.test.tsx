import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { StrictMode, useEffect } from "react";
import { ToastProvider, useToast } from "~/components/feedback/toast";

type ShowToast = ReturnType<typeof useToast>["showToast"];

function CaptureFeedback({ capture }: { capture: (show: ShowToast) => void }) {
  const { showToast } = useToast();
  useEffect(() => capture(showToast), [capture, showToast]);
  return null;
}

function InitialFeedback() {
  const { showToast } = useToast();
  useEffect(() => showToast({ message: "Committed child feedback" }), [showToast]);
  return null;
}

function ToastTestButton(props: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}) {
  const { showToast } = useToast();

  return (
    <button
      type="button"
      onClick={() =>
        showToast({
          message: props.message,
          durationMs: props.durationMs,
          action: props.actionLabel && props.onAction
            ? { label: props.actionLabel, onClick: props.onAction }
            : undefined,
        })
      }
    >
      Show toast
    </button>
  );
}

function ToastControls() {
  const { showToast, dismissToast } = useToast();

  return (
    <>
      <button
        type="button"
        onClick={() => showToast({ message: "First toast" })}
      >
        Show first
      </button>
      <button
        type="button"
        onClick={() => showToast({ message: "Second toast" })}
      >
        Show second
      </button>
      <button type="button" onClick={dismissToast}>
        Dismiss toast
      </button>
    </>
  );
}

function DefaultToastContextControls() {
  const { showToast, dismissToast } = useToast();

  return (
    <>
      <button type="button" onClick={() => showToast({ message: "No provider" })}>
        Default show
      </button>
      <button type="button" onClick={dismissToast}>
        Default dismiss
      </button>
    </>
  );
}

describe("Toast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["before", "after"] as const)(
    "revokes retained async feedback when the old provider unmounts, resolving %s a replacement mounts",
    async (when) => {
      let retained: ShowToast | undefined;
      const old = render(
        <ToastProvider>
          <CaptureFeedback capture={(show) => { retained = show; }} />
        </ToastProvider>
      );
      expect(retained).toBeTypeOf("function");
      const publishFromOldProvider = retained!;
      let finish!: () => void;
      const completion = new Promise<void>((resolve) => { finish = resolve; })
        .then(() => publishFromOldProvider({ message: "Stale operation finished" }));

      old.unmount();
      if (when === "before") {
        await act(async () => { finish(); await completion; });
      }
      render(<ToastProvider><ToastControls /></ToastProvider>);
      fireEvent.click(screen.getByRole("button", { name: "Show first" }));
      if (when === "after") {
        await act(async () => { finish(); await completion; });
      }

      expect(screen.queryByText("Stale operation finished")).not.toBeInTheDocument();
      expect(screen.getByText("First toast")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss toast" }));
      await waitFor(() => expect(screen.queryByText("First toast")).not.toBeInTheDocument());
    }
  );

  it.each(["ordinary", "StrictMode"] as const)(
    "accepts initial child-effect publication in a committed %s provider",
    async (mode) => {
      const provider = <ToastProvider><InitialFeedback /><ToastControls /></ToastProvider>;
      render(mode === "StrictMode" ? <StrictMode>{provider}</StrictMode> : provider);
      await waitFor(() => expect(screen.getAllByText("Committed child feedback")).toHaveLength(1));
      expect(screen.getByRole("region", { name: "Notifications" })).toHaveAttribute("aria-live", "polite");
      fireEvent.click(screen.getByRole("button", { name: "Show first" }));
      await waitFor(() => expect(screen.queryByText("Committed child feedback")).not.toBeInTheDocument());
      expect(screen.getByText("First toast")).toBeInTheDocument();
    }
  );

  it("offers an accessible dismiss control without a second app announcement", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastTestButton message="Recipe saved" />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Show toast" }));
    const liveMessages = [...document.querySelectorAll('[aria-live="polite"], [role="status"]')]
      .filter((element) => element.textContent?.includes("Recipe saved"));
    // Count announcement authorities, not both selectors on the same element.
    expect(liveMessages).toHaveLength(1);
    await user.keyboard("{F6}");
    await user.click(screen.getByRole("button", { name: "Dismiss", exact: true }));
    await waitFor(() => expect(screen.queryByText("Recipe saved")).not.toBeInTheDocument());
  });

  it("renders a toast message via provider context", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastTestButton message="Recipe saved" />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "Show toast" }));

    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByText("Recipe saved")).toBeInTheDocument();
  });

  it("auto-dismisses the toast after three seconds by default", async () => {
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <ToastTestButton message="Added to list" />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    expect(screen.getByText("Added to list")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("Added to list").closest('[data-ouro="toast"]')).toHaveAttribute("data-ending-style");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32);
    });

    expect(screen.queryByText("Added to list")).not.toBeInTheDocument();
  });

  it("renders action button and runs action callback when clicked", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastTestButton message="2 items added at 1x" actionLabel="Undo" onAction={onAction} />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "Show toast" }));

    const actionButton = screen.getByRole("button", { name: "Undo" });
    expect(actionButton).toBeInTheDocument();

    await user.click(actionButton);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("2 items added at 1x")).not.toBeInTheDocument();
  });

  it("replaces an existing toast and resets timer", async () => {
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <ToastControls />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Show first" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Show second" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("First toast").closest('[data-ouro="toast"]')).toHaveAttribute("data-ending-style");
    expect(screen.getByText("Second toast")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(screen.getByText("Second toast")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText("Second toast").closest('[data-ouro="toast"]')).toHaveAttribute("data-ending-style");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(screen.queryByText("Second toast")).not.toBeInTheDocument();
  });

  it("dismisses toast immediately via context API", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastControls />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "Show first" }));
    expect(screen.getByText("First toast")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss toast" }));
    expect(screen.queryByText("First toast")).not.toBeInTheDocument();
  });

  it("dismisses safely when no toast timer is active", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastControls />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "Dismiss toast" }));

    expect(screen.getByRole("region", { name: "Notifications" })).toBeEmptyDOMElement();
  });

  it("default context functions are safe no-ops outside a provider", async () => {
    const user = userEvent.setup();

    render(<DefaultToastContextControls />);

    await user.click(screen.getByRole("button", { name: "Default show" }));
    await user.click(screen.getByRole("button", { name: "Default dismiss" }));

    expect(screen.queryByRole("region", { name: "Notifications" })).not.toBeInTheDocument();
  });
});
