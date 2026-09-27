import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCookProgressCacheOwner, useCookSessionSync, type UseCookSessionSyncOptions } from "~/hooks/use-cook-session-sync";
import {
  DEFAULT_COOK_PROGRESS,
  MIN_COOK_PULL_INTERVAL_MS,
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

  async function settle(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("pulls again on focus, on reconnect, and when shown, never on a timer, and at most once per burst", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ state: null }));
    render();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Returning to a tab fires focus and visibilitychange together: one pull.
    await settle(MIN_COOK_PULL_INTERVAL_MS);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await settle(MIN_COOK_PULL_INTERVAL_MS);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // An open, visible, idle page makes no further requests, however long it stays open.
    await settle(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sends nothing while the page is hidden, and pulls once it is shown", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ state: null }));
    setVisibility("hidden");
    const { rerender, initialProps } = render();
    await settle();

    rerender({ ...initialProps, progress: progress({ scaleFactor: 2 }) });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/cook-sessions/recipe-1", expect.objectContaining({ method: "GET" }));
  });

  it("makes no request after a 401, whatever happens next", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: { code: "authentication_required" } }, 401));
    const { result, rerender, initialProps, unmount } = render();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current).toBe("signed_out");

    rerender({ ...initialProps, progress: progress({ scaleFactor: 2 }) });
    await settle(MIN_COOK_PULL_INTERVAL_MS);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    unmount();
    await settle(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The change is still kept on this device for the next visit.
    expect(JSON.parse(window.localStorage.getItem(syncedCookProgressStorageKey("user-1", "recipe-1")) ?? "{}").progress.scaleFactor).toBe(2);
  });

  it("stops without saving when another account now owns the browser's session, and clears the unsent changes", async () => {
    writeSyncedCookCache("user-1", "recipe-1", { progress: progress({ scaleFactor: 2 }), server: serverState(3) });
    fetchMock.mockImplementation(async () => jsonResponse({ error: { code: "user_mismatch" } }, 412));
    const { result, onRemoteProgress } = render({ progress: progress({ scaleFactor: 2 }) });
    await settle();

    expect(result.current).toBe("account_changed");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "X-Spoonjoy-Cook-User": "user-1" });
    // The page falls back to what was saved; this tab's cached entry for the recipe is gone.
    expect(onRemoteProgress).toHaveBeenLastCalledWith(progress());
    expect(window.localStorage.getItem(syncedCookProgressStorageKey("user-1", "recipe-1"))).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flushes a pending change with keepalive when the page is hidden or closed", async () => {
    writeSyncedCookCache("user-1", "recipe-1", { progress: progress(), server: serverState(4) });
    fetchMock.mockImplementation(async () => jsonResponse({ state: serverState(4) }));
    const { rerender, initialProps } = render();
    await settle();
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => new Promise<Response>(() => undefined));

    const keepalivePatches = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).keepalive === true);

    rerender({ ...initialProps, progress: progress({ scaleFactor: 2 }) });
    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(keepalivePatches()).toHaveLength(1);
    expect(JSON.parse(String((keepalivePatches()[0][1] as RequestInit).body))).toMatchObject({ expectedRevision: 4, changes: { scaleFactor: 2 } });

    rerender({ ...initialProps, progress: progress({ scaleFactor: 3 }) });
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(keepalivePatches()).toHaveLength(2);
    // Nothing else went out while hidden, and the queue is still cached for the next visit.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(window.localStorage.getItem(syncedCookProgressStorageKey("user-1", "recipe-1")) ?? "{}")).toMatchObject({
      progress: progress({ scaleFactor: 3 }),
      server: serverState(4),
    });
  });

  it("leaving the recipe in the app lets a save in flight land and then sends the later change", async () => {
    writeSyncedCookCache("user-1", "recipe-1", { progress: progress(), server: serverState(1) });
    let finishFirstSave!: () => void;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ state: serverState(1) }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        finishFirstSave = () => resolve(jsonResponse({ state: serverState(2, { checkedIngredientIds: ["stock"] }) }));
      }))
      .mockResolvedValueOnce(jsonResponse({ state: serverState(3, { checkedIngredientIds: ["stock", "rice"] }) }));
    const { rerender, initialProps, unmount } = render();
    await settle();

    rerender({ ...initialProps, progress: progress({ checkedIngredientIds: ["stock"] }) });
    await settle(300);
    rerender({ ...initialProps, progress: progress({ checkedIngredientIds: ["stock", "rice"] }) });
    unmount();
    await act(async () => {
      finishFirstSave();
      await vi.advanceTimersByTimeAsync(0);
    });

    const patches = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === "PATCH").map(([, init]) => init as RequestInit);
    expect(patches).toHaveLength(2);
    expect(patches.every((init) => init.keepalive === undefined)).toBe(true);
    expect(JSON.parse(String(patches[1].body))).toMatchObject({ expectedRevision: 2, changes: { checkedIngredientIds: ["stock", "rice"] } });
    expect(JSON.parse(window.localStorage.getItem(syncedCookProgressStorageKey("user-1", "recipe-1")) ?? "{}").server.revision).toBe(3);
  });

  it("moving to another recipe with a save in flight keeps the first recipe's checks and leaves the new page alone", async () => {
    // Recipe X (rice, stock) is on the page; the route then shows recipe Y (flour) in the same mount.
    writeSyncedCookCache("user-1", "recipe-x", { progress: progress(), server: serverState(1) });
    let finishFirstSave!: () => void;
    const requests: Array<{ url: string; init: RequestInit }> = [];
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url === "/api/cook-sessions/recipe-x" && init.method === "GET") return jsonResponse({ state: serverState(1) });
      if (url === "/api/cook-sessions/recipe-x" && init.method === "PATCH" && requests.filter((r) => r.init.method === "PATCH").length === 1) {
        return new Promise<Response>((resolve) => {
          // The server answers with a newer revision that also holds another device's lemon check.
          finishFirstSave = () => resolve(jsonResponse({ state: serverState(2, { checkedIngredientIds: ["stock", "lemon"] }) }));
        });
      }
      if (init.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { expectedRevision: number; changes: { checkedIngredientIds: string[] } };
        return jsonResponse({ state: serverState(body.expectedRevision + 1, { checkedIngredientIds: body.changes.checkedIngredientIds }) });
      }
      if (url === "/api/cook-sessions/recipe-y/start") return jsonResponse({ state: serverState(0) }, 201);
      return jsonResponse({ state: null });
    });
    const xBounds = { stepCount: 2, ingredientIds: new Set(["rice", "stock", "lemon"]), stepOutputIds: new Set<string>() };
    const yBounds = { stepCount: 1, ingredientIds: new Set(["flour"]), stepOutputIds: new Set<string>() };
    const { rerender, initialProps, onRemoteProgress } = render({ recipeId: "recipe-x", bounds: xBounds });
    await settle();

    rerender({ ...initialProps, recipeId: "recipe-x", bounds: xBounds, progress: progress({ checkedIngredientIds: ["stock"] }) });
    await settle(300);
    rerender({ ...initialProps, recipeId: "recipe-x", bounds: xBounds, progress: progress({ checkedIngredientIds: ["stock", "rice"] }) });
    onRemoteProgress.mockClear();

    // The route moves on to recipe Y: first render before Y's progress loads, then ready with Y's.
    rerender({ ...initialProps, recipeId: "recipe-y", bounds: yBounds, ready: false, progress: progress({ checkedIngredientIds: ["stock", "rice"] }) });
    rerender({ ...initialProps, recipeId: "recipe-y", bounds: yBounds, ready: true, progress: progress({ checkedIngredientIds: ["flour"] }) });
    await act(async () => {
      finishFirstSave();
      await vi.advanceTimersByTimeAsync(0);
    });
    await settle(300);

    const xPatches = requests.filter((r) => r.url === "/api/cook-sessions/recipe-x" && r.init.method === "PATCH");
    expect(xPatches).toHaveLength(2);
    // X's follow-up save keeps X's own ids: stock and lemon from the server, plus the queued rice.
    expect(JSON.parse(String(xPatches[1].init.body))).toMatchObject({
      expectedRevision: 2,
      changes: { checkedIngredientIds: ["stock", "lemon", "rice"] },
    });
    expect(JSON.parse(window.localStorage.getItem(syncedCookProgressStorageKey("user-1", "recipe-x")) ?? "{}").progress)
      .toEqual(progress({ checkedIngredientIds: ["stock", "lemon", "rice"] }));
    // Y's page never received X's progress, and Y saved only Y's own flour check.
    expect(onRemoteProgress).not.toHaveBeenCalled();
    const yPatches = requests.filter((r) => r.url === "/api/cook-sessions/recipe-y" && r.init.method === "PATCH");
    expect(yPatches.map((r) => JSON.parse(String(r.init.body)).changes)).toEqual([{ checkedIngredientIds: ["flour"] }]);
  });

  it("a new page for the same recipe stops the old one at once, without re-sending or caching stale checks", async () => {
    writeSyncedCookCache("user-1", "recipe-1", { progress: progress(), server: serverState(1) });
    let finishOldSave!: () => void;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ state: serverState(1) }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        finishOldSave = () => resolve(jsonResponse({ error: { code: "stale_revision", state: serverState(2) } }, 409));
      }));
    const old = render();
    await settle();
    old.rerender({ ...old.initialProps, progress: progress({ checkedIngredientIds: ["rice"] }) });
    await settle(300);
    old.unmount();

    // The cook comes straight back and unchecks rice on the new page.
    fetchMock.mockImplementation(async () => jsonResponse({ state: serverState(2) }));
    const next = render({ progress: progress() });
    await settle();
    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => {
      finishOldSave();
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // The old engine neither replays "rice checked" nor overwrites the cache.
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(JSON.parse(window.localStorage.getItem(syncedCookProgressStorageKey("user-1", "recipe-1")) ?? "{}").progress).toEqual(progress());
    expect(next.result.current).toBe("synced");
  });

  it("closing the tab with a save in flight sends no stale flush, and the next visit replays the queue", async () => {
    writeSyncedCookCache("user-1", "recipe-1", { progress: progress(), server: serverState(1) });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ state: serverState(1) }))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const first = render();
    await settle();
    first.rerender({ ...first.initialProps, progress: progress({ checkedIngredientIds: ["stock"] }) });
    await settle(300);
    first.rerender({ ...first.initialProps, progress: progress({ checkedIngredientIds: ["stock", "rice"] }) });

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    // Only the load and the save in flight: no keepalive flush from the old revision.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(window.localStorage.getItem(syncedCookProgressStorageKey("user-1", "recipe-1")) ?? "{}").progress)
      .toEqual(progress({ checkedIngredientIds: ["stock", "rice"] }));
    setVisibility("hidden");
    first.unmount();
    setVisibility("visible");

    // Next visit: the save in flight had landed (revision 2, stock); the queued rice goes now.
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ state: serverState(2, { checkedIngredientIds: ["stock"] }) }))
      .mockResolvedValueOnce(jsonResponse({ state: serverState(3, { checkedIngredientIds: ["stock", "rice"] }) }));
    const next = render({ progress: progress({ checkedIngredientIds: ["stock", "rice"] }) });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({
      expectedRevision: 2,
      changes: { checkedIngredientIds: ["stock", "rice"] },
    });
    expect(next.result.current).toBe("synced");
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

describe("useCookProgressCacheOwner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("spoonjoy-cook-progress:recipe-1", "{}");
    window.localStorage.setItem(syncedCookProgressStorageKey("user-1", "recipe-1"), "{}");
    window.localStorage.setItem(syncedCookProgressStorageKey("user-2", "recipe-1"), "{}");
  });

  it("drops other accounts' cached progress when a user is signed in, and all of it once signed out", () => {
    const { rerender } = renderHook(({ userId }: { userId: string | null }) => useCookProgressCacheOwner(userId), {
      initialProps: { userId: "user-1" as string | null },
    });

    expect(window.localStorage.getItem(syncedCookProgressStorageKey("user-1", "recipe-1"))).toBe("{}");
    expect(window.localStorage.getItem(syncedCookProgressStorageKey("user-2", "recipe-1"))).toBeNull();

    rerender({ userId: null });

    expect(window.localStorage.getItem(syncedCookProgressStorageKey("user-1", "recipe-1"))).toBeNull();
    expect(window.localStorage.getItem("spoonjoy-cook-progress:recipe-1")).toBe("{}");
  });
});
