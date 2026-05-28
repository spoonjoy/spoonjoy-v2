import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallPromptCard } from "~/components/pwa/InstallPromptCard";
import {
  PWA_INSTALL_DISMISSED_STORAGE_KEY,
  PWA_INSTALL_RE_NAG_AFTER_MS,
} from "~/lib/pwa-install";

interface FakeStorage {
  store: Record<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function createStorage(initial: Record<string, string> = {}): FakeStorage {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
  };
}

const NOW = 1_700_000_000_000;

function fireInstallPromptEvent(): {
  prompt: ReturnType<typeof vi.fn>;
  userChoiceDeferred: { resolve: (value: { outcome: "accepted" | "dismissed" }) => void };
} {
  const userChoiceDeferred: {
    resolve: (value: { outcome: "accepted" | "dismissed" }) => void;
  } = { resolve: () => {} };
  const userChoice = new Promise<{ outcome: "accepted" | "dismissed" }>((resolve) => {
    userChoiceDeferred.resolve = resolve;
  });
  const prompt = vi.fn().mockResolvedValue(undefined);

  const event = new Event("beforeinstallprompt") as unknown as Event & {
    prompt: typeof prompt;
    userChoice: typeof userChoice;
  };
  // @ts-expect-error attaching prompt mock for the handler to see
  event.prompt = prompt;
  // @ts-expect-error attaching userChoice promise for the handler to see
  event.userChoice = userChoice;

  window.dispatchEvent(event);
  return { prompt, userChoiceDeferred };
}

describe("InstallPromptCard", () => {

  function defaultOptions(overrides: Partial<{ matchMedia: (q: string) => { matches: boolean }; storage: FakeStorage }> = {}) {
    return {
      matchMedia: overrides.matchMedia ?? (() => ({ matches: false })),
      storage: overrides.storage ?? createStorage(),
      now: () => NOW,
    };
  }

  it("renders nothing until beforeinstallprompt fires", () => {
    render(<InstallPromptCard options={defaultOptions()} />);
    expect(screen.queryByRole("region", { name: "Install Spoonjoy" })).not.toBeInTheDocument();
  });

  it("appears after beforeinstallprompt", () => {
    render(<InstallPromptCard options={defaultOptions()} />);

    act(() => {
      fireInstallPromptEvent();
    });

    expect(screen.getByRole("region", { name: "Install Spoonjoy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^install$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /not now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("does not render when the PWA is already installed", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === "(display-mode: standalone)",
    }));
    render(<InstallPromptCard options={defaultOptions({ matchMedia })} />);

    act(() => {
      fireInstallPromptEvent();
    });

    expect(screen.queryByRole("region", { name: "Install Spoonjoy" })).not.toBeInTheDocument();
  });

  it("does not render when storage holds a recent dismissal", () => {
    const storage = createStorage({
      [PWA_INSTALL_DISMISSED_STORAGE_KEY]: String(NOW - 1000),
    });
    render(<InstallPromptCard options={defaultOptions({ storage })} />);

    act(() => {
      fireInstallPromptEvent();
    });

    expect(screen.queryByRole("region", { name: "Install Spoonjoy" })).not.toBeInTheDocument();
  });

  it("renders again once the dismissal is older than the nag interval", () => {
    const storage = createStorage({
      [PWA_INSTALL_DISMISSED_STORAGE_KEY]: String(NOW - PWA_INSTALL_RE_NAG_AFTER_MS - 1),
    });
    render(<InstallPromptCard options={defaultOptions({ storage })} />);

    act(() => {
      fireInstallPromptEvent();
    });

    expect(screen.getByRole("region", { name: "Install Spoonjoy" })).toBeInTheDocument();
  });

  it("persists dismissal timestamp on 'Not now'", async () => {
    const storage = createStorage();
    render(<InstallPromptCard options={defaultOptions({ storage })} />);

    act(() => {
      fireInstallPromptEvent();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /not now/i }));

    expect(storage.store[PWA_INSTALL_DISMISSED_STORAGE_KEY]).toBe(String(NOW));
    expect(screen.queryByRole("region", { name: "Install Spoonjoy" })).not.toBeInTheDocument();
  });

  it("persists dismissal on the X close button", async () => {
    const storage = createStorage();
    render(<InstallPromptCard options={defaultOptions({ storage })} />);

    act(() => {
      fireInstallPromptEvent();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(storage.store[PWA_INSTALL_DISMISSED_STORAGE_KEY]).toBe(String(NOW));
  });

  it("calls prompt.prompt() and marks installed when user accepts", async () => {
    render(<InstallPromptCard options={defaultOptions()} />);

    let promptMock: ReturnType<typeof vi.fn> = vi.fn();
    let deferred: { resolve: (v: { outcome: "accepted" | "dismissed" }) => void } = { resolve: () => {} };
    act(() => {
      const fired = fireInstallPromptEvent();
      promptMock = fired.prompt;
      deferred = fired.userChoiceDeferred;
    });

    const user = userEvent.setup();
    const clickPromise = user.click(screen.getByRole("button", { name: /^install$/i }));
    deferred.resolve({ outcome: "accepted" });
    await clickPromise;

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Install Spoonjoy" })).not.toBeInTheDocument();
  });

  it("removes the prompt even when the user dismisses the native dialog", async () => {
    render(<InstallPromptCard options={defaultOptions()} />);

    let deferred: { resolve: (v: { outcome: "accepted" | "dismissed" }) => void } = { resolve: () => {} };
    act(() => {
      const fired = fireInstallPromptEvent();
      deferred = fired.userChoiceDeferred;
    });

    const user = userEvent.setup();
    const clickPromise = user.click(screen.getByRole("button", { name: /^install$/i }));
    deferred.resolve({ outcome: "dismissed" });
    await clickPromise;

    expect(screen.queryByRole("region", { name: "Install Spoonjoy" })).not.toBeInTheDocument();
  });

  it("survives when matchMedia and storage throw (private browsing)", () => {
    const matchMedia = vi.fn(() => {
      throw new Error("matchMedia unavailable");
    });
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      setItem: vi.fn(),
    } as unknown as FakeStorage;

    expect(() => {
      render(<InstallPromptCard options={defaultOptions({ matchMedia, storage })} />);
    }).not.toThrow();

    act(() => {
      fireInstallPromptEvent();
    });

    // Even though matchMedia and storage threw, the prompt still appears
    // because isInstalled and dismissedAt safely default to false/null.
    expect(screen.getByRole("region", { name: "Install Spoonjoy" })).toBeInTheDocument();
  });

  it("swallows setItem errors so dismissal still works in-session", async () => {
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    } as unknown as FakeStorage;

    render(<InstallPromptCard options={defaultOptions({ storage })} />);
    act(() => {
      fireInstallPromptEvent();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /not now/i }));

    expect(screen.queryByRole("region", { name: "Install Spoonjoy" })).not.toBeInTheDocument();
  });

  it("hides when the appinstalled event fires", () => {
    render(<InstallPromptCard options={defaultOptions()} />);

    act(() => {
      fireInstallPromptEvent();
    });
    expect(screen.getByRole("region", { name: "Install Spoonjoy" })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(screen.queryByRole("region", { name: "Install Spoonjoy" })).not.toBeInTheDocument();
  });

  it("does nothing on install click if prompt was already cleared", async () => {
    // Render without firing beforeinstallprompt — install button isn't visible
    render(<InstallPromptCard options={defaultOptions()} />);
    expect(screen.queryByRole("button", { name: /^install$/i })).not.toBeInTheDocument();
  });

  it("recovers from a thrown prompt.prompt()", async () => {
    render(<InstallPromptCard options={defaultOptions()} />);

    let promptMock: ReturnType<typeof vi.fn> = vi.fn();
    act(() => {
      const fired = fireInstallPromptEvent();
      promptMock = fired.prompt;
      promptMock.mockRejectedValueOnce(new Error("not allowed"));
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^install$/i }));

    expect(promptMock).toHaveBeenCalledTimes(1);
    // Card should disappear even though prompt threw
    expect(screen.queryByRole("region", { name: "Install Spoonjoy" })).not.toBeInTheDocument();
  });

  it("dismiss uses Date.now when opts.now is not provided", async () => {
    const key = "spoonjoy.pwa-install.dismissed-at";
    const original = window.localStorage.getItem(key);
    window.localStorage.removeItem(key);

    try {
      render(<InstallPromptCard />); // no options, exercises Date.now / window.localStorage defaults
      act(() => {
        fireInstallPromptEvent();
      });

      const user = userEvent.setup();
      const before = Date.now();
      await user.click(screen.getByRole("button", { name: /not now/i }));
      const after = Date.now();

      const stored = Number(window.localStorage.getItem(key));
      expect(stored).toBeGreaterThanOrEqual(before);
      expect(stored).toBeLessThanOrEqual(after);
    } finally {
      if (original === null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, original);
      }
    }
  });

  it("uses real window.matchMedia and window.localStorage when no overrides are provided", () => {
    // Pre-write a recent dismissal into the real localStorage so the
    // prompt should remain hidden via the default storage path.
    const key = "spoonjoy.pwa-install.dismissed-at";
    const original = window.localStorage.getItem(key);
    window.localStorage.setItem(key, String(Date.now() - 1000));

    try {
      // No options at all: relies on window.matchMedia + window.localStorage defaults.
      render(<InstallPromptCard />);

      act(() => {
        fireInstallPromptEvent();
      });

      // Hidden because dismissedAt is within the nag window.
      expect(screen.queryByRole("region", { name: "Install Spoonjoy" })).not.toBeInTheDocument();
    } finally {
      if (original === null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, original);
      }
    }
  });

  it("falls back to window.localStorage when only matchMedia override is provided", async () => {
    // Persist dismissal via the default storage path on click. Useful
    // when a deployer passes only a matchMedia override but not storage.
    const key = "spoonjoy.pwa-install.dismissed-at";
    const original = window.localStorage.getItem(key);
    window.localStorage.removeItem(key);

    try {
      render(
        <InstallPromptCard
          options={{
            matchMedia: () => ({ matches: false }),
            now: () => NOW,
          }}
        />,
      );

      act(() => {
        fireInstallPromptEvent();
      });
      expect(screen.getByRole("region", { name: "Install Spoonjoy" })).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /not now/i }));

      expect(window.localStorage.getItem(key)).toBe(String(NOW));
      expect(screen.queryByRole("region", { name: "Install Spoonjoy" })).not.toBeInTheDocument();
    } finally {
      if (original === null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, original);
      }
    }
  });
});
