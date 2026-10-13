import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CookSessionSync,
  COOK_LEAVE_TIMEOUT_MS,
  DEFAULT_COOK_PROGRESS,
  MAX_COOK_SYNC_RETRIES,
  MAX_KEEPALIVE_BODY_BYTES,
  MIN_COOK_PULL_INTERVAL_MS,
  clearCookProgressCache,
  clearOtherUsersCookProgressCache,
  cookProgressChanges,
  createCookSessionClient,
  mergeCookProgress,
  normalizeCookProgress,
  normalizeCookProgressKeeping,
  normalizeScaleFactor,
  normalizeStepIndex,
  parseCookServerState,
  readSyncedCookCache,
  restoreUnknownCookProgress,
  sameCookProgress,
  syncedCookProgressStorageKey,
  writeSyncedCookCache,
  type CookProgressBounds,
  type CookProgressValue,
  type CookServerSnapshot,
  type CookSessionClient,
  type CookSyncResult,
} from "~/lib/cook-session-sync";

const STEP_IDS = ["step-1", "step-2", "step-3"];

const bounds: CookProgressBounds = {
  stepIds: STEP_IDS,
  ingredientIds: new Set(["rice", "stock", "lemon"]),
  stepOutputIds: new Set(["use-1"]),
};

// Progress on this recipe: the step's id follows its index unless a test names it.
function progress(overrides: Partial<CookProgressValue> = {}): CookProgressValue {
  const activeStepIndex = overrides.activeStepIndex ?? DEFAULT_COOK_PROGRESS.activeStepIndex;
  return { ...DEFAULT_COOK_PROGRESS, activeStepId: STEP_IDS[activeStepIndex] ?? null, ...overrides };
}

function snapshot(revision: number, overrides: Partial<CookProgressValue> = {}, attemptId = "attempt-1"): CookServerSnapshot {
  return { attemptId, revision, progress: progress(overrides) };
}

describe("cook progress values", () => {
  it("normalizes the scale and step like the recipe page", () => {
    expect(normalizeScaleFactor("2")).toBe(1);
    expect(normalizeScaleFactor(Number.NaN)).toBe(1);
    expect(normalizeScaleFactor(0.1)).toBe(0.25);
    expect(normalizeScaleFactor(99)).toBe(50);
    expect(normalizeScaleFactor(1.333)).toBe(1.33);
    expect(normalizeStepIndex("1", 3)).toBe(0);
    expect(normalizeStepIndex(Number.POSITIVE_INFINITY, 3)).toBe(0);
    expect(normalizeStepIndex(2, 0)).toBe(0);
    expect(normalizeStepIndex(9, 3)).toBe(2);
    expect(normalizeStepIndex(-2, 3)).toBe(0);
    expect(normalizeStepIndex(1.7, 3)).toBe(1);
  });

  it("keeps only ids that belong to the recipe, once each", () => {
    expect(normalizeCookProgress(progress({
      activeStepIndex: 7,
      scaleFactor: 1.5,
      checkedIngredientIds: ["rice", "gone", "rice"],
      checkedStepOutputIds: ["use-1", "use-gone"],
    }), bounds)).toEqual(progress({
      activeStepIndex: 2,
      scaleFactor: 1.5,
      checkedIngredientIds: ["rice"],
      checkedStepOutputIds: ["use-1"],
    }));
  });

  it("compares progress without regard to check order", () => {
    expect(sameCookProgress(progress({ checkedIngredientIds: ["a", "b"] }), progress({ checkedIngredientIds: ["b", "a"] }))).toBe(true);
    expect(sameCookProgress(progress({ checkedIngredientIds: ["a"] }), progress({ checkedIngredientIds: ["a", "b"] }))).toBe(false);
    expect(sameCookProgress(progress({ checkedIngredientIds: ["a", "a"] }), progress({ checkedIngredientIds: ["a", "b"] }))).toBe(false);
    expect(sameCookProgress(progress({ checkedStepOutputIds: ["u"] }), progress())).toBe(false);
    expect(sameCookProgress(progress({ scaleFactor: 2 }), progress())).toBe(false);
    expect(sameCookProgress(progress({ activeStepIndex: 1 }), progress())).toBe(false);
  });

  it("replays this device's changes on top of the server's", () => {
    const base = progress({ activeStepIndex: 1, scaleFactor: 1, checkedIngredientIds: ["rice", "stock"], checkedStepOutputIds: ["use-1"] });
    const local = progress({ activeStepIndex: 2, scaleFactor: 1, checkedIngredientIds: ["rice", "lemon"], checkedStepOutputIds: ["use-1"] });
    const remote = progress({ activeStepIndex: 0, scaleFactor: 2, checkedIngredientIds: ["rice", "stock", "salt"], checkedStepOutputIds: [] });

    expect(mergeCookProgress(base, local, remote)).toEqual({
      // This device moved the step, the other device changed the scale.
      activeStepIndex: 2,
      activeStepId: "step-3",
      scaleFactor: 2,
      // Unchecked stock here, checked lemon here, kept the other device's salt.
      checkedIngredientIds: ["rice", "salt", "lemon"],
      // Unchecked on the other device and untouched here.
      checkedStepOutputIds: [],
    });
    expect(mergeCookProgress(base, progress({ ...base, scaleFactor: 3 }), remote).scaleFactor).toBe(3);
    expect(mergeCookProgress(base, progress({ ...base, checkedIngredientIds: ["rice", "stock", "salt"] }), remote).checkedIngredientIds)
      .toEqual(["rice", "stock", "salt"]);
  });

  it("lists only the fields that changed", () => {
    expect(cookProgressChanges(progress(), progress())).toEqual({});
    expect(cookProgressChanges(progress(), progress({
      activeStepIndex: 1,
      scaleFactor: 2,
      checkedIngredientIds: ["rice"],
      checkedStepOutputIds: ["use-1"],
    }))).toEqual({
      activeStepIndex: 1,
      activeStepId: "step-2",
      scaleFactor: 2,
      checkedIngredientIds: ["rice"],
      checkedStepOutputIds: ["use-1"],
    });
  });

  it("reads the server's state and rejects anything malformed", () => {
    const state = { attemptId: "a", revision: 2, progress: progress({ checkedIngredientIds: ["rice"] }), startedAt: "x" };
    expect(parseCookServerState(state)).toEqual({ attemptId: "a", revision: 2, progress: progress({ checkedIngredientIds: ["rice"] }) });
    for (const value of [
      null,
      "state",
      { ...state, attemptId: 1 },
      { ...state, revision: "2" },
      { ...state, progress: null },
      { ...state, progress: { ...state.progress, activeStepIndex: "0" } },
      { ...state, progress: { ...state.progress, scaleFactor: null } },
      { ...state, progress: { ...state.progress, checkedIngredientIds: "rice" } },
      { ...state, progress: { ...state.progress, checkedStepOutputIds: [1] } },
    ]) {
      expect(parseCookServerState(value)).toBeNull();
    }
  });
});

describe("signed-in progress cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps each user's progress under its own key", () => {
    expect(syncedCookProgressStorageKey("user-1", "recipe-1")).toBe("spoonjoy-cook-progress:user:user-1:recipe-1");
  });

  it("round-trips progress and the last server state, filtered to the recipe", () => {
    writeSyncedCookCache("user-1", "recipe-1", {
      progress: progress({ scaleFactor: 1.5, checkedIngredientIds: ["rice", "gone"] }),
      server: snapshot(3, { checkedIngredientIds: ["gone"] }),
    });

    expect(readSyncedCookCache("user-1", "recipe-1", bounds)).toEqual({
      progress: progress({ scaleFactor: 1.5, checkedIngredientIds: ["rice"] }),
      server: snapshot(3, { checkedIngredientIds: ["gone"] }),
    });
    expect(readSyncedCookCache("user-2", "recipe-1", bounds)).toBeNull();
    expect(window.localStorage.getItem("spoonjoy-cook-progress:recipe-1")).toBeNull();
  });

  it("ignores missing, stale, and corrupt entries", () => {
    const key = syncedCookProgressStorageKey("user-1", "recipe-1");
    for (const value of ["{", JSON.stringify({ version: 0 }), JSON.stringify({ version: 1, progress: null })]) {
      window.localStorage.setItem(key, value);
      expect(readSyncedCookCache("user-1", "recipe-1", bounds)).toBeNull();
    }
    window.localStorage.setItem(key, JSON.stringify({ version: 1, progress: progress(), server: "bad" }));
    expect(readSyncedCookCache("user-1", "recipe-1", bounds)).toEqual({ progress: progress(), server: null });
  });

  function seedCookProgressKeys() {
    for (const key of [
      "spoonjoy-cook-progress:recipe-1",
      "spoonjoy-cook-progress:user:user-1:recipe-1",
      "spoonjoy-cook-progress:user:user-1:recipe-2",
      "spoonjoy-cook-progress:user:user-10:recipe-1",
      "spoonjoy-cook-progress:user:user-2:recipe-1",
      "spoonjoy-theme",
      "ingredient-input-mode",
    ]) {
      window.localStorage.setItem(key, "{}");
    }
  }

  function storedKeys() {
    return Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).sort();
  }

  it("clears every cook progress entry on sign-out and nothing else", () => {
    seedCookProgressKeys();

    clearCookProgressCache();

    expect(storedKeys()).toEqual(["ingredient-input-mode", "spoonjoy-theme"]);
  });

  it("keeps only the current user's signed-in entries, and all signed-out progress", () => {
    seedCookProgressKeys();

    clearOtherUsersCookProgressCache("user-1");
    expect(storedKeys()).toEqual([
      "ingredient-input-mode",
      "spoonjoy-cook-progress:recipe-1",
      "spoonjoy-cook-progress:user:user-1:recipe-1",
      "spoonjoy-cook-progress:user:user-1:recipe-2",
      "spoonjoy-theme",
    ]);

    clearOtherUsersCookProgressCache(null);
    expect(storedKeys()).toEqual(["ingredient-input-mode", "spoonjoy-cook-progress:recipe-1", "spoonjoy-theme"]);
  });

  it("clears nothing, and does not throw, when storage is unavailable", () => {
    const localStorage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => clearCookProgressCache()).not.toThrow();
    expect(() => clearOtherUsersCookProgressCache(null)).not.toThrow();
    localStorage.mockRestore();
  });

  it("tolerates unavailable storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeSyncedCookCache("user-1", "recipe-1", { progress: progress(), server: null })).not.toThrow();
  });
});

describe("createCookSessionClient", () => {
  function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));
  }

  const state = { attemptId: "attempt-1", revision: 1, progress: progress({ scaleFactor: 2 }) };

  it("reads, starts, and patches the recipe's session as the expected cook", async () => {
    const fetch = respond(200, { state });
    const client = createCookSessionClient("recipe 1", "user-1", { fetch, mutationId: () => "m-1" });

    await expect(client.read()).resolves.toEqual({ kind: "state", state: snapshot(1, { scaleFactor: 2 }) });
    await client.start();
    await client.patch(snapshot(1), { scaleFactor: 2 });

    const readHeaders = { Accept: "application/json", "X-Spoonjoy-Cook-User": "user-1" };
    expect(fetch.mock.calls).toEqual([
      ["/api/cook-sessions/recipe%201", { method: "GET", cache: "no-store", credentials: "same-origin", headers: readHeaders }],
      ["/api/cook-sessions/recipe%201/start", { method: "POST", cache: "no-store", credentials: "same-origin", headers: readHeaders }],
      ["/api/cook-sessions/recipe%201", {
        method: "PATCH",
        body: JSON.stringify({ attemptId: "attempt-1", expectedRevision: 1, mutationId: "m-1", changes: { scaleFactor: 2 } }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { ...readHeaders, "Content-Type": "application/json" },
      }],
    ]);
  });

  it("passes an abort signal to the request, and an aborted request is not reported as a server answer", async () => {
    const controller = new AbortController();
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const client = createCookSessionClient("r", "user-1", { fetch: fetch as unknown as typeof globalThis.fetch, mutationId: () => "m-1" });

    const read = client.read({ signal: controller.signal });
    const start = client.start({ signal: controller.signal });
    const patch = client.patch(snapshot(1), { scaleFactor: 2 }, { signal: controller.signal });
    expect(fetch.mock.calls.map(([, init]) => init.signal)).toEqual([controller.signal, controller.signal, controller.signal]);
    controller.abort();

    await expect(Promise.all([read, start, patch])).resolves.toEqual([{ kind: "transient" }, { kind: "transient" }, { kind: "transient" }]);
  });

  it("sends a leave-time flush with keepalive, and only while the body is well under the keepalive limit", async () => {
    expect(MAX_KEEPALIVE_BODY_BYTES).toBeLessThanOrEqual(64 * 1024 / 2);
    const fetch = respond(200, { state });
    const client = createCookSessionClient("r", "user-1", { fetch, mutationId: () => "m-1" });

    await client.patch(snapshot(1), { scaleFactor: 2 }, { keepalive: true });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect(new TextEncoder().encode(String(init.body)).byteLength).toBeLessThan(MAX_KEEPALIVE_BODY_BYTES);

    // A realistic big recipe's full checklist (100 ids of 64 characters) still fits.
    const manyIds = Array.from({ length: 100 }, (_, index) => `${"i".repeat(60)}${String(index).padStart(4, "0")}`);
    await client.patch(snapshot(1), { checkedIngredientIds: manyIds }, { keepalive: true });
    expect(fetch).toHaveBeenCalledTimes(2);

    // An oversized flush is not sent; the change stays queued in the browser's cache.
    const hugeIds = Array.from({ length: 500 }, (_, index) => `${"i".repeat(120)}${String(index).padStart(4, "0")}`);
    await expect(client.patch(snapshot(1), { checkedIngredientIds: hugeIds }, { keepalive: true })).resolves.toEqual({ kind: "transient" });
    expect(fetch).toHaveBeenCalledTimes(2);
    // The same change without keepalive is sent normally.
    await client.patch(snapshot(1), { checkedIngredientIds: hugeIds });
    expect((fetch.mock.calls[2][1] as RequestInit).keepalive).toBeUndefined();
  });

  it("sorts each server answer into what the sync loop does next", async () => {
    const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      createCookSessionClient("r", "user-1", { fetch: respond(status, body, headers) }).read();

    await expect(answer(200, { state: null })).resolves.toEqual({ kind: "state", state: null });
    await expect(answer(409, { error: { code: "stale_revision", state } })).resolves.toEqual({ kind: "conflict", state: snapshot(1, { scaleFactor: 2 }) });
    await expect(answer(412, { error: { code: "user_mismatch" } })).resolves.toEqual({ kind: "wrong_user" });
    await expect(answer(404, { error: { code: "not_found" } })).resolves.toEqual({ kind: "missing" });
    await expect(answer(400, { error: { code: "invalid_request" } })).resolves.toEqual({ kind: "rejected" });
    // Never retried.
    await expect(answer(401, { error: { code: "authentication_required" } })).resolves.toEqual({ kind: "unauthenticated" });
    await expect(answer(428, { error: { code: "user_header_required" } })).resolves.toEqual({ kind: "outdated" });
    await expect(answer(403, { error: { code: "origin_forbidden" } })).resolves.toEqual({ kind: "stopped" });
    await expect(answer(409, { error: { code: "stale_revision" } })).resolves.toEqual({ kind: "stopped" });
    await expect(answer(409, { error: "x" })).resolves.toEqual({ kind: "stopped" });
    await expect(answer(412, { error: { code: "other" } })).resolves.toEqual({ kind: "stopped" });
    await expect(answer(503, { error: { code: "cook_session_protocol_unavailable" } }, { "Retry-After": "1" })).resolves.toEqual({ kind: "stopped" });
    // Retried.
    await expect(answer(429, { error: { code: "rate_limited" } }, { "Retry-After": "7" })).resolves.toEqual({ kind: "transient", retryAfterMs: 7_000 });
    await expect(answer(503, { error: { code: "projection_unavailable" } })).resolves.toEqual({ kind: "transient", retryAfterMs: undefined });
    await expect(answer(500, "boom")).resolves.toEqual({ kind: "transient", retryAfterMs: undefined });
    await expect(answer(503, "down for maintenance")).resolves.toEqual({ kind: "transient", retryAfterMs: undefined });
    await expect(answer(200, { state: { attemptId: 1 } })).resolves.toEqual({ kind: "transient" });

    const offline = createCookSessionClient("r", "user-1", { fetch: vi.fn(async () => { throw new TypeError("offline"); }) });
    await expect(offline.read()).resolves.toEqual({ kind: "transient" });
    const notJson = createCookSessionClient("r", "user-1", { fetch: vi.fn(async () => new Response("<html>", { status: 502 })) });
    await expect(notJson.read()).resolves.toEqual({ kind: "transient", retryAfterMs: undefined });
  });

  it("reads Retry-After as seconds or as a date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T00:00:00.000Z"));
    const answer = (retryAfter: string) =>
      createCookSessionClient("r", "user-1", { fetch: respond(429, {}, { "Retry-After": retryAfter }) }).read();

    await expect(answer("Sun, 27 Sep 2026 00:00:30 GMT")).resolves.toEqual({ kind: "transient", retryAfterMs: 30_000 });
    await expect(answer("Sat, 26 Sep 2026 23:00:00 GMT")).resolves.toEqual({ kind: "transient", retryAfterMs: 0 });
    await expect(answer("soon")).resolves.toEqual({ kind: "transient", retryAfterMs: undefined });
    vi.useRealTimers();
  });

  it("uses the browser's fetch and random mutation ids by default", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ state })));
    await createCookSessionClient("r", "user-1").patch(snapshot(1), { scaleFactor: 2 });

    const body = JSON.parse(String((fetch.mock.calls[0][1] as RequestInit).body)) as { mutationId: string };
    expect(body.mutationId).toMatch(/^[0-9a-f-]{36}$/);
    fetch.mockRestore();
  });
});

type Step = CookSyncResult | Promise<CookSyncResult>;

class FakeClient implements CookSessionClient {
  reads: Step[] = [];
  starts: Step[] = [];
  patches: Step[] = [];
  patchCalls: Array<{ server: CookServerSnapshot; changes: Partial<CookProgressValue>; options?: { keepalive?: boolean } }> = [];

  read = vi.fn(async () => this.next(this.reads, "read"));
  start = vi.fn(async () => this.next(this.starts, "start"));
  patch = vi.fn(async (server: CookServerSnapshot, changes: Partial<CookProgressValue>, options?: { keepalive?: boolean; signal?: AbortSignal }) => {
    this.patchCalls.push(options?.keepalive ? { server, changes, options: { keepalive: true } } : { server, changes });
    return this.next(this.patches, "patch");
  });

  get requests() {
    return this.read.mock.calls.length + this.start.mock.calls.length + this.patch.mock.calls.length;
  }

  private next(queue: Step[], name: string): Step {
    const step = queue.shift();
    if (!step) throw new Error(`unexpected ${name}`);
    return step;
  }
}

function deferred() {
  let resolve!: (value: CookSyncResult) => void;
  const promise = new Promise<CookSyncResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createSync(options: {
  progress?: CookProgressValue;
  server?: CookServerSnapshot | null;
  visible?: () => boolean;
  bounds?: CookProgressBounds;
} = {}) {
  const client = new FakeClient();
  const onProgress = vi.fn();
  const onChange = vi.fn();
  const sync = new CookSessionSync({
    client,
    progress: options.progress ?? progress(),
    server: options.server ?? null,
    bounds: () => options.bounds ?? bounds,
    onProgress,
    onChange,
    ...(options.visible ? { isVisible: options.visible } : {}),
  });
  return { client, sync, onProgress, onChange };
}

describe("CookSessionSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start a session for a recipe with no progress", async () => {
    const { client, sync, onChange } = createSync();
    client.reads.push({ kind: "state", state: null });

    expect(sync.status).toBe("syncing");
    await sync.sync(true);

    expect(client.start).not.toHaveBeenCalled();
    expect(sync.status).toBe("synced");
    expect(sync.server).toBeNull();
    expect(onChange).toHaveBeenCalled();
  });

  it("adopts another device's progress on load", async () => {
    const { client, sync, onProgress } = createSync();
    client.reads.push({ kind: "state", state: snapshot(4, { checkedIngredientIds: ["rice"], scaleFactor: 1.5 }) });

    await sync.sync(true);

    expect(onProgress).toHaveBeenCalledWith(progress({ checkedIngredientIds: ["rice"], scaleFactor: 1.5 }));
    expect(sync.progress).toEqual(progress({ checkedIngredientIds: ["rice"], scaleFactor: 1.5 }));
    expect(sync.server).toEqual(snapshot(4, { checkedIngredientIds: ["rice"], scaleFactor: 1.5 }));
    expect(client.patch).not.toHaveBeenCalled();
    expect(sync.status).toBe("synced");
  });

  it("starts a session and uploads progress made before the first sync", async () => {
    const { client, sync } = createSync({ progress: progress({ checkedIngredientIds: ["rice"] }) });
    client.reads.push({ kind: "state", state: null });
    client.starts.push({ kind: "state", state: snapshot(0) });
    client.patches.push({ kind: "state", state: snapshot(1, { checkedIngredientIds: ["rice"] }) });

    await sync.sync(true);

    expect(client.patchCalls).toEqual([{ server: snapshot(0), changes: { checkedIngredientIds: ["rice"] } }]);
    expect(sync.server).toEqual(snapshot(1, { checkedIngredientIds: ["rice"] }));
    expect(sync.status).toBe("synced");
  });

  it("replays progress queued by an earlier visit from the cached server state", async () => {
    // The cache holds the last server state and the unsent change (checked rice).
    const { client, sync } = createSync({ progress: progress({ checkedIngredientIds: ["rice"] }), server: snapshot(3) });
    client.reads.push({ kind: "state", state: snapshot(3) });
    client.patches.push({ kind: "state", state: snapshot(4, { checkedIngredientIds: ["rice"] }) });

    await sync.sync(true);

    expect(client.patchCalls).toEqual([{ server: snapshot(3), changes: { checkedIngredientIds: ["rice"] } }]);
    expect(sync.status).toBe("synced");
  });

  it("pushes a change after a short pause, straight from the known revision", async () => {
    const { client, sync } = createSync({ server: snapshot(2) });
    client.reads.push({ kind: "state", state: snapshot(2) });
    await sync.sync(true);
    client.patches.push({ kind: "state", state: snapshot(3, { scaleFactor: 2 }) });

    sync.setProgress(progress({ scaleFactor: 2 }));
    sync.setProgress(progress({ scaleFactor: 2 }));
    expect(sync.status).toBe("syncing");
    await vi.advanceTimersByTimeAsync(300);

    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.patchCalls).toEqual([{ server: snapshot(2), changes: { scaleFactor: 2 } }]);
    expect(sync.server?.revision).toBe(3);
  });

  it("skips a pull that comes right after the last one", async () => {
    const { client, sync } = createSync();
    client.reads.push({ kind: "state", state: null });
    await sync.sync(true);

    // focus and visibilitychange arrive together when a tab is shown again.
    await sync.sync(true);
    expect(client.read).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MIN_COOK_PULL_INTERVAL_MS);
    client.reads.push({ kind: "state", state: null });
    await sync.sync(true);
    expect(client.read).toHaveBeenCalledTimes(2);
  });

  it("replays a change onto a newer server revision after a conflict", async () => {
    const { client, sync, onProgress } = createSync({ progress: progress({ checkedIngredientIds: ["rice"] }), server: snapshot(1) });
    client.reads.push({ kind: "state", state: snapshot(1) });
    client.patches.push({ kind: "conflict", state: snapshot(2, { checkedIngredientIds: ["stock"] }) });
    client.patches.push({ kind: "state", state: snapshot(3, { checkedIngredientIds: ["stock", "rice"] }) });

    await sync.sync(true);

    expect(client.patchCalls[1]).toEqual({
      server: snapshot(2, { checkedIngredientIds: ["stock"] }),
      changes: { checkedIngredientIds: ["stock", "rice"] },
    });
    expect(onProgress).toHaveBeenCalledWith(progress({ checkedIngredientIds: ["stock", "rice"] }));
    expect(sync.status).toBe("synced");
  });

  it("keeps a change made while a request was in flight and sends it next", async () => {
    const { client, sync } = createSync({ progress: progress({ scaleFactor: 2 }), server: snapshot(1) });
    client.reads.push({ kind: "state", state: snapshot(1) });
    const firstPatch = deferred();
    client.patches.push(firstPatch.promise);
    client.patches.push({ kind: "state", state: snapshot(3, { scaleFactor: 2, checkedIngredientIds: ["rice"] }) });

    const running = sync.sync(true);
    await vi.advanceTimersByTimeAsync(0);
    sync.setProgress(progress({ scaleFactor: 2, checkedIngredientIds: ["rice"] }));
    firstPatch.resolve({ kind: "state", state: snapshot(2, { scaleFactor: 2 }) });
    await running;

    expect(sync.progress).toEqual(progress({ scaleFactor: 2, checkedIngredientIds: ["rice"] }));
    expect(client.patchCalls[1].changes).toEqual({ checkedIngredientIds: ["rice"] });
    expect(sync.server?.revision).toBe(3);
  });

  it("folds requests made while running into one rerun that pulls", async () => {
    const { client, sync } = createSync();
    const firstRead = deferred();
    client.reads.push(firstRead.promise);
    client.reads.push({ kind: "state", state: null });

    const running = sync.sync(false);
    await vi.advanceTimersByTimeAsync(MIN_COOK_PULL_INTERVAL_MS);
    const queued = sync.sync(true);
    void sync.sync(false);
    expect(queued).toBe(running);
    firstRead.resolve({ kind: "state", state: null });
    await running;

    expect(client.read).toHaveBeenCalledTimes(2);
  });

  it("starts over when the server no longer has the session", async () => {
    const { client, sync } = createSync({ progress: progress({ scaleFactor: 2 }), server: snapshot(5) });
    client.reads.push({ kind: "state", state: snapshot(5) });
    client.patches.push({ kind: "missing" });
    client.starts.push({ kind: "state", state: snapshot(0, {}, "attempt-2") });
    client.patches.push({ kind: "state", state: snapshot(1, { scaleFactor: 2 }, "attempt-2") });

    await sync.sync(true);

    expect(client.patchCalls[1]).toEqual({ server: snapshot(0, {}, "attempt-2"), changes: { scaleFactor: 2 } });
    expect(sync.server?.attemptId).toBe("attempt-2");
  });

  // This used to remember the server's state trimmed to this page's recipe, so the next exchange
  // read the trimmed ids as unchecks and erased them. The server's state is now kept as it is;
  // only the page's copy is fitted to the recipe.
  it("shows the server's progress when the server refuses this page's change, and remembers the server's state as it is", async () => {
    const { client, sync, onProgress } = createSync({ progress: progress({ checkedIngredientIds: ["rice"] }), server: snapshot(1) });
    client.reads.push({ kind: "state", state: snapshot(1) });
    client.patches.push({ kind: "rejected" });
    client.reads.push({ kind: "state", state: snapshot(2, { checkedIngredientIds: ["stock", "gone"] }) });

    await sync.sync(true);

    expect(onProgress).toHaveBeenLastCalledWith(progress({ checkedIngredientIds: ["stock"] }));
    expect(sync.server).toEqual(snapshot(2, { checkedIngredientIds: ["stock", "gone"] }));
    expect(sync.status).toBe("synced");
  });

  it("clears to nothing when a refused change meets an empty server", async () => {
    const { client, sync, onProgress } = createSync({ progress: progress({ checkedIngredientIds: ["rice"] }), server: snapshot(1) });
    client.reads.push({ kind: "state", state: snapshot(1) });
    client.patches.push({ kind: "rejected" });
    client.reads.push({ kind: "state", state: null });

    await sync.sync(true);

    expect(onProgress).toHaveBeenLastCalledWith(progress());
    expect(sync.server).toBeNull();
  });

  it("retries a transient failure with growing delays, honouring Retry-After, then recovers", async () => {
    const { client, sync } = createSync({ progress: progress({ scaleFactor: 2 }) });
    client.reads.push({ kind: "transient", retryAfterMs: 5_000 });

    await sync.sync(true);
    expect(sync.status).toBe("offline");

    // Retry-After (5 s) outranks the first backoff step (1 s).
    await vi.advanceTimersByTimeAsync(4_999);
    expect(client.read).toHaveBeenCalledTimes(1);
    client.reads.push({ kind: "transient" });
    await vi.advanceTimersByTimeAsync(1);
    expect(client.read).toHaveBeenCalledTimes(2);

    client.reads.push({ kind: "state", state: snapshot(0) });
    client.patches.push({ kind: "state", state: snapshot(1, { scaleFactor: 2 }) });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(client.read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.read).toHaveBeenCalledTimes(3);
    expect(sync.status).toBe("synced");
  });

  it("stops retrying after the cap, and a page event starts a fresh round", async () => {
    const { client, sync } = createSync();
    for (let attempt = 0; attempt <= MAX_COOK_SYNC_RETRIES; attempt += 1) client.reads.push({ kind: "transient" });

    await sync.sync(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(client.read).toHaveBeenCalledTimes(MAX_COOK_SYNC_RETRIES + 1);
    expect(sync.status).toBe("offline");

    client.reads.push({ kind: "state", state: null });
    await sync.sync(true);
    expect(client.read).toHaveBeenCalledTimes(MAX_COOK_SYNC_RETRIES + 2);
    expect(sync.status).toBe("synced");
  });

  it("caps each retry delay at 30 seconds, even for a longer Retry-After", async () => {
    const { client, sync } = createSync();
    client.reads.push({ kind: "transient", retryAfterMs: 120_000 });
    client.reads.push({ kind: "state", state: null });

    await sync.sync(true);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(client.read).toHaveBeenCalledTimes(2);
  });

  it("sends nothing while the page is hidden, and does not retry until it is visible again", async () => {
    let visible = true;
    const { client, sync } = createSync({ progress: progress({ scaleFactor: 2 }), visible: () => visible });
    client.reads.push({ kind: "transient" });
    await sync.sync(true);
    expect(client.requests).toBe(1);

    // Hidden before the retry fires: the retry sends nothing.
    visible = false;
    await vi.advanceTimersByTimeAsync(60_000);
    // Hidden when a failure happens: no retry is even scheduled; pushes and pulls send nothing.
    sync.setProgress(progress({ scaleFactor: 3 }));
    await vi.advanceTimersByTimeAsync(60_000);
    await sync.sync(true);
    expect(client.requests).toBe(1);

    visible = true;
    client.reads.push({ kind: "state", state: snapshot(0) });
    client.patches.push({ kind: "state", state: snapshot(1, { scaleFactor: 3 }) });
    await sync.sync(true);
    expect(client.requests).toBe(3);
    expect(sync.status).toBe("synced");
  });

  it("does not schedule a retry when a failure lands after the page was hidden", async () => {
    let visible = true;
    const { client, sync } = createSync({ visible: () => visible });
    const read = deferred();
    client.reads.push(read.promise);

    const running = sync.sync(true);
    visible = false;
    read.resolve({ kind: "transient" });
    await running;
    visible = true;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(client.read).toHaveBeenCalledTimes(1);
    expect(sync.status).toBe("offline");
  });

  it.each<[string, string, (client: FakeClient) => void]>([
    ["a 401 on read", "signed_out", (client) => {
      client.reads.push({ kind: "unauthenticated" });
    }],
    ["a 428 on patch", "update_required", (client) => {
      client.reads.push({ kind: "state", state: snapshot(0) });
      client.patches.push({ kind: "outdated" });
    }],
    ["a 404 on read", "stopped", (client) => {
      client.reads.push({ kind: "missing" });
    }],
    ["a 404 on start (the recipe is gone)", "stopped", (client) => {
      client.reads.push({ kind: "state", state: null });
      client.starts.push({ kind: "missing" });
    }],
    ["a start without state", "stopped", (client) => {
      client.reads.push({ kind: "state", state: null });
      client.starts.push({ kind: "state", state: null });
    }],
    ["a 403 or protocol-unavailable 503 on patch", "stopped", (client) => {
      client.reads.push({ kind: "state", state: snapshot(0) });
      client.patches.push({ kind: "stopped" });
    }],
    ["a patch without state", "stopped", (client) => {
      client.reads.push({ kind: "state", state: snapshot(0) });
      client.patches.push({ kind: "state", state: null });
    }],
    ["a refused read after a refused change", "stopped", (client) => {
      client.reads.push({ kind: "state", state: snapshot(0) });
      client.patches.push({ kind: "rejected" });
      client.reads.push({ kind: "stopped" });
    }],
  ])("stops for this page view after %s: status %s, no retries, no further requests", async (_name, status, arrange) => {
    const { client, sync, onChange } = createSync({ progress: progress({ scaleFactor: 2 }) });
    arrange(client);

    await sync.sync(true);
    const requests = client.requests;
    expect(sync.status).toBe(status);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await vi.advanceTimersByTimeAsync(MIN_COOK_PULL_INTERVAL_MS);
    await sync.sync(true);
    sync.setProgress(progress({ scaleFactor: 3 }));
    await vi.advanceTimersByTimeAsync(60_000);
    sync.flush();
    await sync.leave();
    expect(client.requests).toBe(requests);
    // Local changes are still kept (and cached) on this device.
    expect(sync.progress).toEqual(progress({ scaleFactor: 3 }));
    expect(onChange).toHaveBeenCalled();
  });

  it("stops only for this page view: a new engine for the next load of the recipe syncs again", async () => {
    const first = createSync({ progress: progress({ scaleFactor: 2 }) });
    first.client.reads.push({ kind: "stopped" });
    await first.sync.sync(true);
    expect(first.sync.status).toBe("stopped");

    const next = createSync({ progress: progress({ scaleFactor: 2 }) });
    next.client.reads.push({ kind: "state", state: snapshot(1, { scaleFactor: 2 }) });
    await next.sync.sync(true);
    expect(next.sync.status).toBe("synced");
  });

  it("reports offline after endless conflicts", async () => {
    const { client, sync } = createSync({ progress: progress({ scaleFactor: 2 }) });
    client.reads.push({ kind: "state", state: snapshot(0) });
    for (let round = 1; round <= 4; round += 1) {
      client.patches.push({ kind: "conflict", state: snapshot(round) });
    }

    await sync.sync(true);

    expect(sync.status).toBe("offline");
  });

  it("stops without writing when another account owns the session, and drops this tab's pending changes from the page", async () => {
    const { client, sync, onProgress } = createSync({ progress: progress({ checkedIngredientIds: ["rice"] }), server: snapshot(2) });
    client.reads.push({ kind: "wrong_user" });

    await sync.sync(true);

    expect(sync.status).toBe("account_changed");
    expect(sync.progress).toEqual(snapshot(2).progress);
    expect(onProgress).toHaveBeenLastCalledWith(snapshot(2).progress);
    expect(client.start).not.toHaveBeenCalled();
    expect(client.patch).not.toHaveBeenCalled();

    sync.setProgress(progress({ scaleFactor: 3 }));
    await vi.advanceTimersByTimeAsync(60_000);
    await sync.sync(true);
    sync.dispose();
    expect(client.requests).toBe(1);
    expect(sync.progress).toEqual(snapshot(2).progress);
  });

  it("stops on a user mismatch from start or patch too", async () => {
    const fromStart = createSync({ progress: progress({ scaleFactor: 2 }) });
    fromStart.client.reads.push({ kind: "state", state: null });
    fromStart.client.starts.push({ kind: "wrong_user" });
    await fromStart.sync.sync(true);
    expect(fromStart.sync.status).toBe("account_changed");
    // Nothing was ever saved: the page clears its unsent progress.
    expect(fromStart.sync.progress).toEqual(progress());
    expect(fromStart.onProgress).toHaveBeenLastCalledWith(progress());

    const fromPatch = createSync({ progress: progress({ scaleFactor: 2 }), server: snapshot(1) });
    fromPatch.client.reads.push({ kind: "state", state: snapshot(1) });
    fromPatch.client.patches.push({ kind: "wrong_user" });
    await fromPatch.sync.sync(true);
    expect(fromPatch.sync.status).toBe("account_changed");
    expect(fromPatch.client.patch).toHaveBeenCalledTimes(1);
  });

  describe("leaving the recipe inside the app", () => {
    it("sends a change still waiting on the push delay, then stops", async () => {
      const { client, sync, onChange } = createSync({ server: snapshot(2) });
      client.reads.push({ kind: "state", state: snapshot(2) });
      await sync.sync(true);
      client.patches.push({ kind: "state", state: snapshot(3, { checkedIngredientIds: ["rice"] }) });

      sync.setProgress(progress({ checkedIngredientIds: ["rice"] }));
      await vi.advanceTimersByTimeAsync(100);
      await sync.leave();

      expect(client.patchCalls).toEqual([{ server: snapshot(2), changes: { checkedIngredientIds: ["rice"] } }]);
      expect(sync.server).toEqual(snapshot(3, { checkedIngredientIds: ["rice"] }));
      expect(sync.status).toBe("synced");

      onChange.mockClear();
      sync.setProgress(progress({ scaleFactor: 2 }));
      await sync.sync(true);
      sync.flush();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(client.requests).toBe(2);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("lets a save in flight land, then sends the later change from the new revision: both reach the server", async () => {
      const { client, sync } = createSync({ server: snapshot(1) });
      client.reads.push({ kind: "state", state: snapshot(1) });
      await sync.sync(true);
      const firstSave = deferred();
      client.patches.push(firstSave.promise);
      client.patches.push({ kind: "state", state: snapshot(3, { checkedIngredientIds: ["stock", "rice"] }) });

      sync.setProgress(progress({ checkedIngredientIds: ["stock"] }));
      await vi.advanceTimersByTimeAsync(300);
      expect(client.patch).toHaveBeenCalledTimes(1);
      sync.setProgress(progress({ checkedIngredientIds: ["stock", "rice"] }));

      const leaving = sync.leave();
      // No keepalive flush from the old revision: it could only be refused as stale.
      expect(client.patch).toHaveBeenCalledTimes(1);
      firstSave.resolve({ kind: "state", state: snapshot(2, { checkedIngredientIds: ["stock"] }) });
      await leaving;

      expect(client.patchCalls).toEqual([
        { server: snapshot(1), changes: { checkedIngredientIds: ["stock"] } },
        { server: snapshot(2, { checkedIngredientIds: ["stock"] }), changes: { checkedIngredientIds: ["stock", "rice"] } },
      ]);
      expect(sync.server?.revision).toBe(3);
    });

    it("never changes the page while leaving, even when the server answers with other progress", async () => {
      const { client, sync, onProgress } = createSync({ server: snapshot(1) });
      client.reads.push({ kind: "state", state: snapshot(1) });
      await sync.sync(true);
      onProgress.mockClear();
      const save = deferred();
      client.patches.push(save.promise);
      client.patches.push({ kind: "conflict", state: snapshot(3, { scaleFactor: 2, checkedIngredientIds: ["stock"] }) });
      client.patches.push({ kind: "rejected" });
      client.reads.push({ kind: "state", state: snapshot(4, { checkedIngredientIds: ["lemon"] }) });

      sync.setProgress(progress({ checkedIngredientIds: ["rice"] }));
      await vi.advanceTimersByTimeAsync(300);
      const leaving = sync.leave();
      save.resolve({ kind: "state", state: snapshot(2, { checkedIngredientIds: ["rice", "stock"] }) });
      await leaving;

      expect(onProgress).not.toHaveBeenCalled();
    });

    it("never changes the page after an account switch found while leaving", async () => {
      const { client, sync, onProgress } = createSync({ server: snapshot(1) });
      client.reads.push({ kind: "state", state: snapshot(1) });
      await sync.sync(true);
      onProgress.mockClear();
      client.patches.push({ kind: "wrong_user" });

      sync.setProgress(progress({ checkedIngredientIds: ["rice"] }));
      await sync.leave();

      expect(sync.status).toBe("account_changed");
      expect(onProgress).not.toHaveBeenCalled();
    });

    it("replays a conflict while leaving", async () => {
      const { client, sync } = createSync({ server: snapshot(1) });
      client.reads.push({ kind: "state", state: snapshot(1) });
      await sync.sync(true);
      client.patches.push({ kind: "conflict", state: snapshot(2, { scaleFactor: 2 }) });
      client.patches.push({ kind: "state", state: snapshot(3, { scaleFactor: 2, checkedIngredientIds: ["rice"] }) });

      sync.setProgress(progress({ checkedIngredientIds: ["rice"] }));
      await sync.leave();

      expect(client.patchCalls[1]).toEqual({ server: snapshot(2, { scaleFactor: 2 }), changes: { checkedIngredientIds: ["rice"] } });
      expect(sync.server?.revision).toBe(3);
    });

    it("starts the session for a recipe never cooked before, then saves", async () => {
      const { client, sync } = createSync();
      client.reads.push({ kind: "state", state: null });
      await sync.sync(true);
      client.starts.push({ kind: "state", state: snapshot(0) });
      client.patches.push({ kind: "state", state: snapshot(1, { scaleFactor: 2 }) });

      sync.setProgress(progress({ scaleFactor: 2 }));
      // Hiding the tab first cannot send a start and a PATCH that outlive the page: nothing goes.
      sync.flush();
      expect(client.requests).toBe(1);
      await sync.leave();

      expect(client.start).toHaveBeenCalledTimes(1);
      expect(client.patchCalls).toEqual([{ server: snapshot(0), changes: { scaleFactor: 2 } }]);
    });

    it("gives up after the leave timeout, leaving the change for the next visit", async () => {
      const { client, sync, onChange } = createSync({ server: snapshot(1) });
      client.reads.push({ kind: "state", state: snapshot(1) });
      await sync.sync(true);
      const stuck = deferred();
      client.patches.push(stuck.promise);

      sync.setProgress(progress({ scaleFactor: 2 }));
      await vi.advanceTimersByTimeAsync(300);
      const leaving = sync.leave();
      await vi.advanceTimersByTimeAsync(COOK_LEAVE_TIMEOUT_MS - 1);
      expect(client.requests).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      await leaving;
      onChange.mockClear();

      stuck.resolve({ kind: "state", state: snapshot(2, { scaleFactor: 2 }) });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onChange).not.toHaveBeenCalled();
      expect(client.requests).toBe(2);
    });

    it("sends nothing while hidden, and never schedules a retry", async () => {
      let visible = true;
      const { client, sync } = createSync({ server: snapshot(1), visible: () => visible });
      client.reads.push({ kind: "state", state: snapshot(1) });
      await sync.sync(true);

      sync.setProgress(progress({ scaleFactor: 2 }));
      visible = false;
      await sync.leave();
      expect(client.requests).toBe(1);

      const failing = createSync({ server: snapshot(1) });
      failing.client.reads.push({ kind: "state", state: snapshot(1) });
      await failing.sync.sync(true);
      failing.client.patches.push({ kind: "transient" });
      failing.sync.setProgress(progress({ scaleFactor: 2 }));
      await failing.sync.leave();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(failing.client.requests).toBe(2);
    });

    it("does nothing when leaving twice or after being disposed", async () => {
      const { client, sync } = createSync({ progress: progress({ scaleFactor: 2 }), server: snapshot(1) });
      sync.dispose();
      await sync.leave();
      expect(client.requests).toBe(0);

      // Progress made before the first sync: leaving reads, starts, and saves it, once.
      const twice = createSync({ progress: progress({ scaleFactor: 2 }) });
      twice.client.reads.push({ kind: "state", state: null });
      twice.client.starts.push({ kind: "state", state: snapshot(0) });
      twice.client.patches.push({ kind: "state", state: snapshot(1, { scaleFactor: 2 }) });
      const first = twice.sync.leave();
      await twice.sync.leave();
      await first;
      expect(twice.client.requests).toBe(3);
      expect(twice.sync.server?.revision).toBe(1);
    });
  });

  it("does not flush while a save is in flight", async () => {
    const { client, sync } = createSync({ server: snapshot(1) });
    client.reads.push({ kind: "state", state: snapshot(1) });
    await sync.sync(true);
    const save = deferred();
    client.patches.push(save.promise);

    sync.setProgress(progress({ scaleFactor: 2 }));
    await vi.advanceTimersByTimeAsync(300);
    sync.setProgress(progress({ scaleFactor: 3 }));
    sync.flush();

    expect(client.patch).toHaveBeenCalledTimes(1);
    expect(client.patchCalls[0].options).toBeUndefined();
    sync.dispose();
    save.resolve({ kind: "state", state: snapshot(2, { scaleFactor: 2 }) });
  });

  it("flushes on leave without stopping, and sends nothing when there is nothing to flush", async () => {
    const { client, sync } = createSync({ progress: progress({ scaleFactor: 2 }) });
    // Nothing known from the server yet: nothing to patch against.
    sync.flush();
    expect(client.requests).toBe(0);

    client.reads.push({ kind: "state", state: snapshot(1, { scaleFactor: 2 }) });
    await sync.sync(true);
    // In step with the server: nothing to send.
    sync.flush();
    expect(client.requests).toBe(1);

    // Hidden with a pending change: one keepalive PATCH; the engine keeps running afterwards.
    client.patches.push({ kind: "state", state: snapshot(2, { scaleFactor: 3 }) });
    sync.setProgress(progress({ scaleFactor: 3 }));
    sync.flush();
    expect(client.patchCalls).toEqual([{ server: snapshot(1, { scaleFactor: 2 }), changes: { scaleFactor: 3 }, options: { keepalive: true } }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(client.requests).toBe(2);
  });

  it("stops quietly once disposed, whatever is in flight", async () => {
    for (const stage of ["read", "start", "patch", "refusal"] as const) {
      const { client, sync, onChange } = createSync({ progress: progress({ scaleFactor: 2 }) });
      const pending = deferred();
      if (stage === "read") {
        client.reads.push(pending.promise);
      } else if (stage === "start") {
        client.reads.push({ kind: "state", state: null });
        client.starts.push(pending.promise);
      } else if (stage === "patch") {
        client.reads.push({ kind: "state", state: snapshot(0) });
        client.patches.push(pending.promise);
      } else {
        client.reads.push({ kind: "state", state: snapshot(0) });
        client.patches.push({ kind: "rejected" });
        client.reads.push(pending.promise);
      }

      const running = sync.sync(true);
      await vi.advanceTimersByTimeAsync(0);
      client.patches.push({ kind: "transient" });
      sync.dispose();
      pending.resolve({ kind: "state", state: snapshot(9, { scaleFactor: 2 }) });
      await running;
      onChange.mockClear();
      const requests = client.requests;

      sync.setProgress(progress({ scaleFactor: 3 }));
      await sync.sync(true);
      sync.flush();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onChange).not.toHaveBeenCalled();
      expect(sync.progress).toEqual(progress({ scaleFactor: 2 }));
      expect(client.requests).toBe(requests);
    }
  });
});

// Audit finding data 14: a device that loaded an older version of a recipe erased progress
// another device made on the newer version. These tests follow the native fix
// (spoonjoy-apple #108): a device keeps ids and a step it cannot show instead of dropping them.
describe("devices on different versions of the recipe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The recipe as the old device loaded it: three steps, no salt.
  const oldRecipe: CookProgressBounds = bounds;
  // The recipe after an edit the newer device loaded: salt added to a new fourth step.
  const newRecipe: CookProgressBounds = {
    stepIds: [...STEP_IDS, "step-4"],
    ingredientIds: new Set(["rice", "stock", "lemon", "salt"]),
    stepOutputIds: new Set(["use-1", "use-2"]),
  };

  // The cook-session server in memory: revision-checked writes, checked ids the recipe as it is
  // now does not have dropped, a step it does not have refused, and the step kept by id with its
  // index derived from it, the way the Worker and the CookSession Durable Object do it.
  class MemoryServer {
    state: CookServerSnapshot | null = null;
    patches: Array<Partial<CookProgressValue>> = [];

    constructor(public recipe: CookProgressBounds) {}

    client(): CookSessionClient {
      return {
        read: async () => ({ kind: "state", state: this.state }),
        start: async () => {
          this.state ??= { attemptId: "attempt-1", revision: 0, progress: { ...DEFAULT_COOK_PROGRESS } };
          return { kind: "state", state: this.state };
        },
        patch: async (server, changes) => {
          this.patches.push(changes);
          if (!this.state) return { kind: "missing" };
          if (server.revision !== this.state.revision) return { kind: "conflict", state: this.state };
          if (changes.activeStepId != null && !this.recipe.stepIds.includes(changes.activeStepId)) {
            return { kind: "rejected" };
          }
          const fitted = (ids: string[] | undefined, known: ReadonlySet<string>) => ids && ids.filter((id) => known.has(id));
          const checks = {
            ...(changes.checkedIngredientIds ? { checkedIngredientIds: fitted(changes.checkedIngredientIds, this.recipe.ingredientIds) } : {}),
            ...(changes.checkedStepOutputIds ? { checkedStepOutputIds: fitted(changes.checkedStepOutputIds, this.recipe.stepOutputIds) } : {}),
          };
          const step = changes.activeStepId != null
            ? { activeStepId: changes.activeStepId, activeStepIndex: this.recipe.stepIds.indexOf(changes.activeStepId) }
            : changes.activeStepIndex !== undefined
              ? { activeStepIndex: changes.activeStepIndex, activeStepId: this.recipe.stepIds[changes.activeStepIndex] ?? null }
              : {};
          this.state = {
            attemptId: this.state.attemptId,
            revision: this.state.revision + 1,
            progress: { ...this.state.progress, ...changes, ...checks, ...step },
          };
          return { kind: "state", state: this.state };
        },
      };
    }
  }

  function device(server: MemoryServer, recipe: CookProgressBounds, start: CookProgressValue = progress()) {
    // Every pull is a fresh one: these tests are about the merge, not about skipping pulls.
    let clock = 0;
    const sync = new CookSessionSync({
      now: () => (clock += MIN_COOK_PULL_INTERVAL_MS),
      client: server.client(),
      progress: start,
      server: null,
      bounds: () => recipe,
      onProgress: vi.fn(),
      onChange: vi.fn(),
    });
    return sync;
  }

  it("two devices on different recipe versions both keep their progress after merging", async () => {
    const server = new MemoryServer(newRecipe);
    const web = device(server, newRecipe);
    const phone = device(server, oldRecipe);
    await web.sync(true);
    await phone.sync(true);

    // The newer device checks salt, which the old device's recipe does not have, and moves to step 4.
    web.setProgress({ ...web.progress, activeStepIndex: 3, activeStepId: "step-4", checkedIngredientIds: ["salt"] });
    await web.sync(false);
    expect(server.state?.progress.checkedIngredientIds).toEqual(["salt"]);

    // The old device checks rice. Its merge must not trim salt or pull the step back.
    await phone.sync(true);
    phone.setProgress({ ...phone.progress, checkedIngredientIds: [...phone.progress.checkedIngredientIds, "rice"] });
    await phone.sync(false);

    expect([...server.state!.progress.checkedIngredientIds].sort()).toEqual(["rice", "salt"]);
    expect(server.state?.progress.activeStepId).toBe("step-4");
    expect(server.patches.at(-1)).toEqual({ checkedIngredientIds: ["salt", "rice"] });
    expect(phone.status).toBe("synced");
    // The old device shows what its recipe has, and still treats itself as in step with the server.
    expect(phone.progress.checkedIngredientIds).toEqual(["rice"]);

    // Another exchange from the old device changes nothing on the server.
    const revision = server.state?.revision;
    await phone.sync(true);
    expect(server.state?.revision).toBe(revision);

    // The newer device sees both checks.
    await web.sync(true);
    expect([...web.progress.checkedIngredientIds].sort()).toEqual(["rice", "salt"]);
    expect(web.progress.activeStepId).toBe("step-4");
    expect(web.status).toBe("synced");
  });

  it("a check an edit removed does not cost another device's checks or step", async () => {
    // Version 2 added salt and step 4, version 3 removed lemon. Another device checked lemon and
    // salt and moved to step 4 before version 3. This page still has version 1 (lemon, no salt).
    const v3: CookProgressBounds = {
      stepIds: [...STEP_IDS, "step-4"],
      ingredientIds: new Set(["rice", "stock", "salt"]),
      stepOutputIds: new Set(["use-1"]),
    };
    const server = new MemoryServer(v3);
    server.state = {
      attemptId: "attempt-1",
      revision: 5,
      progress: progress({ activeStepIndex: 3, activeStepId: "step-4", checkedIngredientIds: ["lemon", "salt"] }),
    };
    const page = device(server, oldRecipe);
    await page.sync(true);
    expect(page.progress).toEqual(progress({ activeStepIndex: 2, checkedIngredientIds: ["lemon"] }));

    page.setProgress({ ...page.progress, checkedIngredientIds: ["lemon", "rice"] });
    await page.sync(false);

    // The server drops lemon (its recipe no longer has it) and keeps salt and step 4.
    expect(server.state.progress).toMatchObject({ activeStepIndex: 3, activeStepId: "step-4", checkedIngredientIds: ["salt", "rice"] });
    expect(page.status).toBe("synced");
    // This page shows what the server kept that its recipe has.
    expect(page.progress.checkedIngredientIds).toEqual(["rice"]);
  });

  it("ids and a step this page cannot show are not read as the cook undoing them", async () => {
    // The server is on step 4 of the newer recipe with salt checked; this page has three steps,
    // so it shows step 3 and no salt. The cook here checks stock.
    const known = snapshot(4, { activeStepIndex: 3, activeStepId: "step-4", checkedIngredientIds: ["salt"] });
    const shown = progress({ activeStepIndex: 2, checkedIngredientIds: ["stock"] });
    const { client, sync } = createSync({ progress: shown, server: known });
    client.reads.push({ kind: "state", state: known });
    client.patches.push({ kind: "state", state: snapshot(5, { activeStepIndex: 3, activeStepId: "step-4", checkedIngredientIds: ["salt", "stock"] }) });

    await sync.sync(true);
    expect(client.patchCalls.map(({ changes }) => changes)).toEqual([{ checkedIngredientIds: ["salt", "stock"] }]);

    // Moving to another step here is a real change and is sent, as this page's step.
    const moved = createSync({ progress: progress({ activeStepIndex: 1 }), server: known });
    moved.client.reads.push({ kind: "state", state: known });
    moved.client.patches.push({ kind: "state", state: snapshot(5, { activeStepIndex: 1, checkedIngredientIds: ["salt"] }) });
    await moved.sync.sync(true);
    expect(moved.client.patchCalls.map(({ changes }) => changes)).toEqual([{ activeStepIndex: 1, activeStepId: "step-2" }]);
  });

  it("when the server refuses ids this page kept, sends the change again fitted to this page's recipe", async () => {
    // Pepper was checked, then the recipe was edited to remove it. The server still holds the
    // pepper check, and a server that refuses any list naming it (the current Worker drops such
    // ids instead) must not leave this page stuck. This page has the edited recipe.
    const known = snapshot(2, { checkedIngredientIds: ["pepper"] });
    const { client, sync } = createSync({ progress: progress({ checkedIngredientIds: ["rice"] }), server: known });
    client.reads.push({ kind: "state", state: known });
    client.patches.push({ kind: "rejected" });
    client.patches.push({ kind: "state", state: snapshot(3, { checkedIngredientIds: ["rice"] }) });

    await sync.sync(true);
    expect(client.patchCalls.map(({ changes }) => changes)).toEqual([
      { checkedIngredientIds: ["pepper", "rice"] },
      { checkedIngredientIds: ["rice"] },
    ]);
    expect(sync.server).toEqual(snapshot(3, { checkedIngredientIds: ["rice"] }));
    expect(sync.status).toBe("synced");

    // Refused again once fitted: the page shows the server's progress, as before.
    const refused = createSync({ progress: progress({ checkedIngredientIds: ["rice"] }), server: known });
    refused.client.reads.push({ kind: "state", state: known });
    refused.client.patches.push({ kind: "rejected" }, { kind: "rejected" });
    refused.client.reads.push({ kind: "state", state: known });
    await refused.sync.sync(true);
    expect(refused.client.patch).toHaveBeenCalledTimes(2);
    expect(refused.client.read).toHaveBeenCalledTimes(2);
    expect(refused.sync.server).toEqual(known);
  });

  it("a leave-time flush keeps what the server holds that this page cannot show", async () => {
    const known = snapshot(1, { checkedIngredientIds: ["salt"] });
    const { client, sync } = createSync({ server: known });
    client.reads.push({ kind: "state", state: known });
    await sync.sync(true);
    expect(sync.status).toBe("synced");

    client.patches.push({ kind: "state", state: snapshot(2, { checkedIngredientIds: ["salt", "rice"] }) });
    sync.setProgress(progress({ checkedIngredientIds: ["rice"] }));
    sync.flush();
    expect(client.patchCalls).toEqual([{ server: known, changes: { checkedIngredientIds: ["salt", "rice"] }, options: { keepalive: true } }]);
    sync.dispose();
  });

  it("keeps and restores only what this page cannot show", () => {
    const server = progress({ activeStepIndex: 6, activeStepId: "step-7", scaleFactor: 2, checkedIngredientIds: ["salt"], checkedStepOutputIds: ["use-9"] });
    expect(normalizeCookProgressKeeping(
      progress({ activeStepIndex: 6, activeStepId: "step-7", scaleFactor: 2, checkedIngredientIds: ["salt", "rice", "zzz", "rice"], checkedStepOutputIds: ["use-9", "x"] }),
      bounds,
      server,
    )).toEqual(progress({ activeStepIndex: 6, activeStepId: "step-7", scaleFactor: 2, checkedIngredientIds: ["salt", "rice"], checkedStepOutputIds: ["use-9"] }));
    expect(normalizeCookProgressKeeping(progress({ activeStepIndex: 9, activeStepId: null, scaleFactor: 99 }), bounds, server))
      .toEqual(progress({ activeStepIndex: 2, scaleFactor: 50 }));

    expect(restoreUnknownCookProgress(progress({ activeStepIndex: 2, checkedIngredientIds: ["rice"] }), server, bounds))
      .toEqual(progress({ activeStepIndex: 6, activeStepId: "step-7", checkedIngredientIds: ["rice", "salt"], checkedStepOutputIds: ["use-9"] }));
    // A step the cook moved to here stays.
    expect(restoreUnknownCookProgress(progress({ activeStepIndex: 1 }), server, bounds).activeStepId).toBe("step-2");
    // A step from before steps were kept by id, beyond this recipe's steps, is put back too.
    const legacy = progress({ activeStepIndex: 7, activeStepId: null });
    expect(restoreUnknownCookProgress(progress({ activeStepIndex: 2 }), legacy, bounds)).toMatchObject({ activeStepIndex: 7, activeStepId: null });
    // Ids this page knows are this page's to keep or drop.
    expect(restoreUnknownCookProgress(progress({ checkedIngredientIds: ["rice"] }), progress({ checkedIngredientIds: ["stock"] }), bounds))
      .toEqual(progress({ checkedIngredientIds: ["rice"] }));
  });
});

describe("the current step is kept by id", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const reordered: CookProgressBounds = { ...bounds, stepIds: ["step-2", "step-1", "step-3"] };

  it("finds the current step after the steps are reordered", () => {
    // Saved on step 2 (index 1); step 2 is now first.
    expect(normalizeCookProgress(progress({ activeStepIndex: 1 }), reordered)).toEqual(progress({ activeStepIndex: 0, activeStepId: "step-2" }));
    // A step id this page does not have falls back to the index, kept in range.
    expect(normalizeCookProgress(progress({ activeStepIndex: 9, activeStepId: "gone" }), reordered)).toEqual(progress({ activeStepIndex: 2, activeStepId: "step-3" }));
    // Progress saved before steps were kept by id uses the index.
    expect(normalizeCookProgress(progress({ activeStepIndex: 1, activeStepId: null }), reordered)).toEqual(progress({ activeStepIndex: 1, activeStepId: "step-1" }));
    expect(normalizeCookProgress(progress({ activeStepIndex: 1 }), { ...bounds, stepIds: [] })).toEqual(progress({ activeStepIndex: 0, activeStepId: null }));
  });

  it("compares a step saved before ids by index, even after a reorder", () => {
    // The server's session predates step ids: index 1. This page's recipe was reordered, and it
    // shows step-1 at index 1. Without an id on both sides only the index can be compared.
    const legacy = progress({ activeStepIndex: 1, activeStepId: null });
    const shown = progress({ activeStepIndex: 1, activeStepId: "step-1" });
    expect(sameCookProgress(legacy, shown)).toBe(true);
    expect(cookProgressChanges(legacy, shown)).toEqual({});
    expect(mergeCookProgress(legacy, shown, progress({ activeStepIndex: 2, activeStepId: null }))).toMatchObject({ activeStepIndex: 2, activeStepId: null });
    expect(mergeCookProgress(legacy, progress({ activeStepIndex: 0, activeStepId: "step-2" }), legacy)).toMatchObject({ activeStepIndex: 0, activeStepId: "step-2" });
  });

  it("treats the same step at a new position as the same step", () => {
    expect(sameCookProgress(progress({ activeStepIndex: 1 }), progress({ activeStepIndex: 0, activeStepId: "step-2" }))).toBe(true);
    expect(sameCookProgress(progress({ activeStepIndex: 1, activeStepId: null }), progress({ activeStepIndex: 1 }))).toBe(true);
    expect(sameCookProgress(progress({ activeStepIndex: 1, activeStepId: null }), progress({ activeStepIndex: 0 }))).toBe(false);
    expect(cookProgressChanges(progress({ activeStepIndex: 1 }), progress({ activeStepIndex: 0, activeStepId: "step-2" }))).toEqual({});
    expect(cookProgressChanges(progress(), progress({ activeStepIndex: 1, activeStepId: null }))).toEqual({ activeStepIndex: 1 });
  });

  it("keeps the current step when the recipe's steps are reordered between visits", async () => {
    // The server saved step 2 at index 1. The recipe was then reordered so step 2 is first, and
    // this page loaded the reordered recipe from its cache, showing step 2 at index 0.
    const saved = snapshot(3, { activeStepIndex: 1, activeStepId: "step-2", checkedIngredientIds: ["rice"] });
    const cached = normalizeCookProgress(saved.progress, reordered);
    expect(cached).toEqual(progress({ activeStepIndex: 0, activeStepId: "step-2", checkedIngredientIds: ["rice"] }));
    const { client, sync, onProgress } = createSync({ progress: cached, server: saved, bounds: reordered });
    client.reads.push({ kind: "state", state: saved });

    await sync.sync(true);

    expect(client.patch).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(sync.progress.activeStepId).toBe("step-2");
    expect(sync.status).toBe("synced");
  });

  it("follows another device to its step by id, wherever that step sits in this page's recipe", async () => {
    // This page shows the reordered recipe's first step, step 2.
    const { client, sync, onProgress } = createSync({ progress: progress({ activeStepId: "step-2" }), bounds: reordered });
    client.reads.push({ kind: "state", state: snapshot(2, { activeStepIndex: 0, activeStepId: "step-1" }) });

    await sync.sync(true);

    expect(onProgress).toHaveBeenLastCalledWith(progress({ activeStepIndex: 1, activeStepId: "step-1" }));
  });

  it("reads progress saved before steps were kept by id", () => {
    const { activeStepId: _omitted, ...legacy } = progress({ activeStepIndex: 1 });
    expect(parseCookServerState({ attemptId: "a", revision: 1, progress: legacy })?.progress).toEqual(progress({ activeStepIndex: 1, activeStepId: null }));
    expect(parseCookServerState({ attemptId: "a", revision: 1, progress: { ...legacy, activeStepId: 4 } })).toBeNull();
  });
});
