import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { ToastProvider, useToast } from "~/components/ui/toast";

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

  it("renders a toast message via provider context", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastTestButton message="Recipe saved" />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "Show toast" }));

    expect(screen.getByTestId("toast-snackbar")).toBeInTheDocument();
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

    act(() => {
      vi.advanceTimersByTime(3000);
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
    fireEvent.click(screen.getByRole("button", { name: "Show second" }));

    expect(screen.queryByText("First toast")).not.toBeInTheDocument();
    expect(screen.getByText("Second toast")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.getByText("Second toast")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
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

    expect(screen.queryByTestId("toast-snackbar")).not.toBeInTheDocument();
  });

  it("default context functions are safe no-ops outside a provider", async () => {
    const user = userEvent.setup();

    render(<DefaultToastContextControls />);

    await user.click(screen.getByRole("button", { name: "Default show" }));
    await user.click(screen.getByRole("button", { name: "Default dismiss" }));

    expect(screen.queryByTestId("toast-snackbar")).not.toBeInTheDocument();
  });
});
