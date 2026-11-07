import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { fetchCookingNow, useCookingNow } from "~/hooks/use-cooking-now";
import { COOKING_NOW_CHANGED_EVENT, COOKING_NOW_LOCAL_STORAGE_KEY, recordLocalCookingNow, type CookingNowEntry } from "~/lib/cooking-now";

const ENTRY: CookingNowEntry = {
  recipe: { id: "r1", title: "Lemon Herb Rice", coverImageUrl: null, href: "/recipes/r1" },
  activeStepId: null,
  activeStepIndex: 1,
  stepCount: 3,
  checkedCount: 1,
  totalCount: 4,
  allCheckedAt: null,
  touchedAt: "2026-10-24T12:00:00.000Z",
  expiresAt: "2026-10-27T12:00:00.000Z",
};

function answer(body: unknown, init?: ResponseInit) {
  return Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, ...init }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("fetchCookingNow", () => {
  it("reads the signed-in cook's list with their session", async () => {
    const fetcher = vi.fn(() => answer({ ok: true, data: { recipes: [ENTRY] } }));
    await expect(fetchCookingNow(fetcher as unknown as typeof fetch)).resolves.toEqual([ENTRY]);
    expect(fetcher).toHaveBeenCalledWith("/cooking-now.json", { headers: { Accept: "application/json" }, credentials: "same-origin" });
  });

  it("answers an empty list when the list cannot be read or is not one", async () => {
    await expect(fetchCookingNow((() => answer({ ok: false }, { status: 401 })) as unknown as typeof fetch)).resolves.toEqual([]);
    await expect(fetchCookingNow((() => answer({ ok: true, data: { recipes: [{ recipe: {} }] } })) as unknown as typeof fetch)).resolves.toEqual([]);
    await expect(fetchCookingNow((() => answer({ ok: true, data: { recipes: [null] } })) as unknown as typeof fetch)).resolves.toEqual([]);
    await expect(fetchCookingNow((() => answer({ ok: true })) as unknown as typeof fetch)).resolves.toEqual([]);
    await expect(fetchCookingNow((() => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).resolves.toEqual([]);
  });

  it("uses the page's fetch by default", async () => {
    vi.stubGlobal("fetch", vi.fn(() => answer({ ok: true, data: { recipes: [ENTRY] } })));
    await expect(fetchCookingNow()).resolves.toEqual([ENTRY]);
  });
});

describe("useCookingNow", () => {
  it("reads the account's list after hydration and again when the page comes back into view", async () => {
    const fetcher = vi.fn(() => answer({ ok: true, data: { recipes: [ENTRY] } }));
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender } = renderHook(({ path }) => useCookingNow(true, path), { initialProps: { path: "/" } });

    await waitFor(() => expect(result.current.entries).toEqual([ENTRY]));
    expect(result.current.now).toBeGreaterThan(0);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    rerender({ path: "/recipes" });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  });

  it("ignores an answer that lands after it is gone", async () => {
    let finish: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const { result, unmount } = renderHook(() => useCookingNow(true));
    unmount();
    await act(async () => {
      finish(new Response(JSON.stringify({ ok: true, data: { recipes: [ENTRY] } })));
    });
    expect(result.current.entries).toEqual([]);
  });

  it("reads this browser's list when signed out, and follows its changes here and in other tabs", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useCookingNow(false));
    expect(result.current.entries).toEqual([]);

    act(() => {
      recordLocalCookingNow({
        recipe: { id: "r1", title: "Lemon Herb Rice", coverImageUrl: null },
        activeStepId: null,
        activeStepIndex: 0,
        stepCount: 1,
        checkedIds: ["i1"],
        totalCount: 2,
        now: Date.now(),
      });
    });
    expect(result.current.entries.map((entry) => entry.recipe.id)).toEqual(["r1"]);

    act(() => {
      window.localStorage.removeItem(COOKING_NOW_LOCAL_STORAGE_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    });
    expect(result.current.entries).toHaveLength(1);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: COOKING_NOW_LOCAL_STORAGE_KEY }));
    });
    expect(result.current.entries).toEqual([]);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      window.dispatchEvent(new Event(COOKING_NOW_CHANGED_EVENT));
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
