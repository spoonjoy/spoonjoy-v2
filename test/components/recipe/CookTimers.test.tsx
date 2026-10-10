import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { CookStepTimer, CookTimerTray } from "~/components/recipe/CookTimers";
import type { CookTimerEntry, CookTimersController } from "~/hooks/use-cook-timers";

function controller(entries: CookTimerEntry[], announcement = ""): CookTimersController {
  return {
    timers: new Map(entries.map((entry) => [entry.stepNum, entry])),
    active: entries.filter((entry) => entry.stored !== null),
    announcement,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    clear: vi.fn(),
  };
}

const NOW = 5_000_000;

describe("cook-mode timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing for a step without a timer", () => {
    const { container } = render(<CookStepTimer stepNum={4} controller={controller([])} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Start on an idle step and labels fractional minutes", () => {
    const timers = controller([{ stepNum: 1, label: "", durationSeconds: 90, stored: null, ringing: false }]);
    render(<CookStepTimer stepNum={1} controller={timers} />);
    expect(screen.getByText("1.5 min timer")).toBeInTheDocument();
    expect(screen.getByText("01:30")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    expect(timers.start).toHaveBeenCalledWith(1);
  });

  it("counts down a running timer from its end time and offers Pause and Cancel", () => {
    const timers = controller([
      { stepNum: 1, label: "Boil", durationSeconds: 600, stored: { status: "running", durationSeconds: 600, endsAt: NOW + 600_000 }, ringing: false },
    ]);
    render(<CookStepTimer stepNum={1} controller={timers} />);
    expect(screen.getByText("10:00")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByText("08:59")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause timer" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel timer" }));
    expect(timers.pause).toHaveBeenCalledWith(1);
    expect(timers.clear).toHaveBeenCalledWith(1);
  });

  it("offers Resume on a paused timer", () => {
    const timers = controller([
      { stepNum: 2, label: "", durationSeconds: 60, stored: { status: "paused", durationSeconds: 60, remainingMs: 30_000 }, ringing: false },
    ]);
    render(<CookStepTimer stepNum={2} controller={timers} />);
    expect(screen.getByText("00:30")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume timer" }));
    expect(timers.resume).toHaveBeenCalledWith(2);
  });

  it.each([
    [true, "Stop alarm"],
    [false, "Dismiss"],
  ])("shows Time's up on a finished timer (ringing %s) with %s and Restart", (ringing, action) => {
    const timers = controller([
      { stepNum: 3, label: "", durationSeconds: 60, stored: { status: "done", durationSeconds: 60, endedAt: NOW }, ringing },
    ]);
    render(<CookStepTimer stepNum={3} controller={timers} />);
    const timer = screen.getByTestId("cook-mode-timer");
    expect(timer).toHaveAttribute("data-status", "done");
    expect(within(timer).getByText("Time's up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: action }));
    fireEvent.click(screen.getByRole("button", { name: "Restart timer" }));
    expect(timers.clear).toHaveBeenCalledWith(3);
    expect(timers.start).toHaveBeenCalledWith(3);
  });

  it("lists the other steps' timers, skipping the one in view", () => {
    const onGoToStep = vi.fn();
    const timers = controller(
      [
        { stepNum: 1, label: "Boil pasta", durationSeconds: 600, stored: { status: "running", durationSeconds: 600, endsAt: NOW + 300_000 }, ringing: false },
        { stepNum: 2, label: "", durationSeconds: 60, stored: { status: "paused", durationSeconds: 60, remainingMs: 20_000 }, ringing: false },
        { stepNum: 3, label: "Rest", durationSeconds: 60, stored: { status: "done", durationSeconds: 60, endedAt: NOW }, ringing: true },
        { stepNum: 4, label: "Bake", durationSeconds: 60, stored: { status: "done", durationSeconds: 60, endedAt: NOW - 999_999 }, ringing: false },
        { stepNum: 5, label: "Here", durationSeconds: 60, stored: { status: "running", durationSeconds: 60, endsAt: NOW + 5_000 }, ringing: false },
      ],
      "Time's up: Step 3, Rest",
    );
    render(<CookTimerTray controller={timers} currentStepNum={5} onGoToStep={onGoToStep} />);
    const tray = screen.getByRole("region", { name: "Running timers" });
    expect(within(tray).queryByText(/Here/)).not.toBeInTheDocument();
    expect(within(tray).getByText("Step 1 · Boil pasta")).toBeInTheDocument();
    expect(within(tray).getByText("05:00")).toBeInTheDocument();
    expect(within(tray).getByText("Step 2")).toBeInTheDocument();
    expect(within(tray).getByText("00:20 paused")).toBeInTheDocument();
    expect(within(tray).getAllByText("Time's up")).toHaveLength(2);
    expect(screen.getByTestId("cook-timer-announcement")).toHaveTextContent("Time's up: Step 3, Rest");

    fireEvent.click(within(tray).getByRole("button", { name: "Go to step 1" }));
    fireEvent.click(within(tray).getByRole("button", { name: "Cancel timer for step 2" }));
    fireEvent.click(within(tray).getByRole("button", { name: "Stop alarm for step 3" }));
    fireEvent.click(within(tray).getByRole("button", { name: "Dismiss timer for step 4" }));
    expect(onGoToStep).toHaveBeenCalledWith(1);
    expect(timers.clear.mock.calls).toEqual([[2], [3], [4]]);
  });

  it("shows only the live announcement when no other timer is active, and no step links without a handler", () => {
    const { rerender } = render(<CookTimerTray controller={controller([])} />);
    expect(screen.queryByTestId("cook-timer-tray")).not.toBeInTheDocument();
    expect(screen.getByTestId("cook-timer-announcement")).toBeEmptyDOMElement();
    rerender(
      <CookTimerTray
        controller={controller([
          { stepNum: 1, label: "", durationSeconds: 60, stored: { status: "running", durationSeconds: 60, endsAt: NOW + 1_000 }, ringing: false },
        ])}
      />,
    );
    expect(screen.queryByRole("button", { name: /Go to step/ })).not.toBeInTheDocument();
  });
});
