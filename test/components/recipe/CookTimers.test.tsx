import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { CookStepTimer, CookTimerTray, notifyTimeUp } from "~/components/recipe/CookTimers";
import { cookTimers } from "~/lib/cook-timers";

const NOW = 5_000_000;
const [pasta, sauce] = cookTimers("cook-timers-test", [
  { stepNum: 1, stepTitle: "Boil pasta", duration: 1 },
  { stepNum: 2, stepTitle: "Make sauce", duration: 2 },
]);

function setNotification(value: unknown) {
  Object.defineProperty(window, "Notification", { configurable: true, writable: true, value });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

describe("cook-mode timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    Reflect.deleteProperty(window, "Notification");
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("renders nothing for a step without a timer", () => {
    const { container } = render(<CookStepTimer timer={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("runs a step's timer with Spoonjoy's words, and the tray follows it on another step", () => {
    const onGoToStep = vi.fn();
    render(
      <>
        <CookStepTimer timer={pasta} />
        <CookTimerTray timers={[pasta, sauce]} currentStepNum={2} onGoToStep={onGoToStep} />
      </>,
    );
    const step = screen.getByTestId("cook-mode-timer");
    expect(step).toHaveTextContent("Step 1 · Boil pasta · 1 min");
    fireEvent.click(within(step).getByRole("button", { name: "Start timer" }));
    expect(within(step).getByRole("button", { name: "Pause timer" })).toBeInTheDocument();

    const tray = screen.getByRole("region", { name: "Running timers" });
    expect(within(tray).getAllByRole("listitem")).toHaveLength(1);
    // Clicking the tray anywhere but its link does nothing; its link opens the step.
    fireEvent.click(within(tray).getByText("Step 1 · Boil pasta", { selector: "p" }));
    expect(onGoToStep).not.toHaveBeenCalled();
    fireEvent.click(within(tray).getByRole("link", { name: "Go to Step 1 · Boil pasta" }));
    expect(onGoToStep).toHaveBeenCalledWith(1);
  });

  it("lists a timer without a link on the recipe page, and says Time's up in the tab title until it is dismissed", async () => {
    document.title = "Pasta Night";
    render(
      <>
        <CookStepTimer timer={pasta} />
        <CookTimerTray timers={[pasta]} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    const tray = screen.getByRole("region", { name: "Running timers" });
    expect(within(tray).queryByRole("link")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(document.title).toBe("Time's up: Step 1 · Boil pasta");

    fireEvent.click(within(screen.getByTestId("cook-mode-timer")).getByRole("button", { name: "Dismiss" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.title).toBe("Pasta Night");
  });

  it("keeps a step timer ringing without a tray, until that timer is dismissed", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    try {
      render(<CookStepTimer timer={pasta} />);
      fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      expect(vibrate).toHaveBeenCalledTimes(3);
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(vibrate).toHaveBeenCalledTimes(3);
    } finally {
      Reflect.deleteProperty(navigator, "vibrate");
    }
  });

  it("keeps ringing every 2.5 s after a timer is up, until it is dismissed", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    render(
      <>
        <CookStepTimer timer={pasta} />
        <CookTimerTray timers={[pasta]} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(vibrate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(vibrate).toHaveBeenCalledTimes(3);

    fireEvent.click(within(screen.getByTestId("cook-mode-timer")).getByRole("button", { name: "Dismiss" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(vibrate).toHaveBeenCalledTimes(3);
    Reflect.deleteProperty(navigator, "vibrate");
  });

  it("stops ringing two minutes after a timer is up, when nobody dismisses it", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    const { unmount } = render(
      <>
        <CookStepTimer timer={pasta} />
        <CookTimerTray timers={[pasta]} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(117_500);
    });
    // At zero, then every 2.5 s through 117.5 s; the two-minute cap admits no final ring.
    expect(vibrate).toHaveBeenCalledTimes(48);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(vibrate).toHaveBeenCalledTimes(48);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(vibrate).toHaveBeenCalledTimes(48);

    // A page opened after the two minutes shows the timer up, and stays quiet.
    unmount();
    render(<CookTimerTray timers={[pasta]} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(document.title).toBe("Time's up: Step 1 · Boil pasta");
    expect(vibrate).toHaveBeenCalledTimes(48);
    Reflect.deleteProperty(navigator, "vibrate");
  });

  it("alerts from the tray when no step timer shows the timer", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    const { unmount } = render(<CookStepTimer timer={sauce} />);
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    unmount();
    render(<CookTimerTray timers={[sauce]} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(121_000);
    });
    expect(vibrate).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(navigator, "vibrate");
  });

  it("keeps sounding after the cook moves from the running timer to another step", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    try {
      const { rerender } = render(
        <>
          <CookStepTimer timer={pasta} />
          <CookTimerTray timers={[pasta, sauce]} currentStepNum={1} />
        </>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
      rerender(
        <>
          <CookStepTimer timer={sauce} />
          <CookTimerTray timers={[pasta, sauce]} currentStepNum={2} />
        </>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      expect(screen.getByTestId("cook-timer-tray")).toHaveTextContent("Time's up");
      expect(vibrate).toHaveBeenCalledTimes(3);
      fireEvent.click(within(screen.getByTestId("cook-timer-tray")).getByRole("button", { name: /^Dismiss/ }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(vibrate).toHaveBeenCalledTimes(3);
    } finally {
      Reflect.deleteProperty(navigator, "vibrate");
    }
  });

  it.each(["step", "tray"] as const)("sends one fresh background notification from the %s when a timer finishes", async (view) => {
    const Notification = Object.assign(vi.fn(), { permission: "granted" });
    setNotification(Notification);
    setVisibility("hidden");
    const { rerender } = render(
      <>
        <CookStepTimer timer={pasta} />
        <CookTimerTray timers={[pasta, sauce]} currentStepNum={1} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    if (view === "tray") {
      rerender(
        <>
          <CookStepTimer timer={sauce} />
          <CookTimerTray timers={[pasta, sauce]} currentStepNum={2} />
        </>,
      );
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    expect(Notification).toHaveBeenCalledExactlyOnceWith("Time's up", {
      body: "Step 1 · Boil pasta",
      tag: "spoonjoy-cook-timer",
    });
  });

  it("notifies a cook who allowed notifications while the tab is in the background, once and only while fresh", () => {
    const Notification = Object.assign(vi.fn(), { permission: "granted" });
    setNotification(Notification);
    setVisibility("hidden");

    notifyTimeUp("Step 2", { first: true, endedAt: NOW });
    expect(Notification).toHaveBeenCalledWith("Time's up", { body: "Step 2", tag: "spoonjoy-cook-timer" });

    notifyTimeUp("Step 2", { first: false, endedAt: NOW });
    notifyTimeUp("Step 2", { first: true, endedAt: NOW - 61_000 });
    setVisibility("visible");
    notifyTimeUp("Step 2", { first: true, endedAt: NOW });
    setVisibility("hidden");
    Notification.permission = "default";
    notifyTimeUp("Step 2", { first: true, endedAt: NOW });
    setNotification(undefined);
    notifyTimeUp("Step 2", { first: true, endedAt: NOW });
    expect(Notification).toHaveBeenCalledTimes(1);
  });

  it("tolerates a notification constructor that throws", () => {
    setNotification(Object.assign(vi.fn(function Throws() {
      throw new TypeError("Illegal constructor");
    }), { permission: "granted" }));
    setVisibility("hidden");
    expect(() => notifyTimeUp("Step 1", { first: true, endedAt: NOW })).not.toThrow();
  });
});
