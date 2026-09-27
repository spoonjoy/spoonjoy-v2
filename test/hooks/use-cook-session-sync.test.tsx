import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCookSessionSync, type UseCookSessionSyncOptions } from "~/hooks/use-cook-session-sync";
import {
  DEFAULT_COOK_PROGRESS,
  syncedCookProgressStorageKey,
  writeSyncedCookCache,
  type CookProgressValue,
} from "~/lib/cook-session-sync";

const bounds = {
  stepCount: 2,
  ingredientIds: new Set(["rice", "stock"]),
  stepOutputIds: new Set<string>(),
};

function progress(overrides: Partial<CookProgressValue> = {}): CookProgressValue {
  return { ...DEFAULT_COOK_PROGRESS, ...overrides };
}

function serverState(revision: number, overrides: Partial<CookProgressValue> = {}) {
  return { attemptId: "attempt-1", revision, progress: progress(overrides) };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

describe("useCookSessionSync", () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    setVisibility("visible");
    fetchMock = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchMock.mockRestore();
    vi.useRealTimers();
  });

  function render(overrides: Partial<UseCookSessionSyncOptions> = {}) {
    const onRemoteProgress = vi.fn();
    const initialProps: UseCookSessionSyncOptions = {
      recipeId: "recipe-1",
      userId: "user-1",
      ready: true,
      bounds,
      progress: progress(),
      onRemoteProgress,
      ...overrides,
    };
    const hook = renderHook((props: UseCookSessionSyncOptions) => useCookSessionSync(props), { initialProps });
    return { ...hook, onRemoteProgress, initialProps };
  }

  it("stays off without a signed-in cook", () => {
    const { result } = render({ userId: null });

    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits until the page has loaded its cached progress", () => {
    const { result } = render({ ready: false });

    expect(result.current).toBe("syncing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pulls on load, applies another device's progress, and caches it for this user", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ state: serverState(2, { checkedIngredientIds: ["rice"] }) }));
    const { result, onRemoteProgress } = render();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/cook-sessions/recipe-1", expect.objectContaining({ method: "GET" }));
    expect(onRemoteProgress).toHaveBeenCalledWith(progress({ checkedIngredientIds: ["rice"] }));
    expect(result.current).toBe("synced");
    expect(JSON.parse(window.localStorage.getItem(syncedCookProgressStorageKey("user-1", "recipe-1")) ?? "{}")).toMatchObject({
      version: 1,
      progress: progress({ checkedIngredientIds: ["rice"] }),
      server: serverState(2, { checkedIngredientIds: ["rice"] }),
    });
  });

  it("resumes from the cached server state and pushes the page's changes", async () => {
    writeSyncedCookCache("user-1", "recipe-1", { progress: progress(), server: serverState(4) });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ state: serverState(4) }))
      .mockResolvedValueOnce(jsonResponse({ state: serverState(5, { scaleFactor: 2 }) }));
    const { result, rerender, initialProps } = render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    rerender({ ...initialProps, progress: progress({ scaleFactor: 2 }) });
    expect(result.current).toBe("syncing");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const patchInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(patchInit.method).toBe("PATCH");
    expect(JSON.parse(String(patchInit.body))).toMatchObject({ expectedRevision: 4, changes: { scaleFactor: 2 } });
    expect(result.current).toBe("synced");
  });

  it("pulls again on focus, on reconnect, and when shown, and never on a timer", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ state: null }));
    render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // An open, visible, idle page makes no further requests, however long it stays open.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Hiding the tab does not pull; showing it again does.
    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("stops syncing when the page unmounts", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ state: null }));
    const { unmount } = render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    unmount();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

