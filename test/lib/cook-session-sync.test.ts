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
  normalizeScaleFactor,
  normalizeStepIndex,
  parseCookServerState,
  readSyncedCookCache,
  sameCookProgress,
  syncedCookProgressStorageKey,
  writeSyncedCookCache,
  type CookProgressValue,
  type CookServerSnapshot,
  type CookSessionClient,
  type CookSyncResult,
} from "~/lib/cook-session-sync";

const bounds = {
  stepCount: 3,
  ingredientIds: new Set(["rice", "stock", "lemon"]),
  stepOutputIds: new Set(["use-1"]),
};

function progress(overrides: Partial<CookProgressValue> = {}): CookProgressValue {
  return { ...DEFAULT_COOK_PROGRESS, ...overrides };
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
  patch = vi.fn(async (server: CookServerSnapshot, changes: Partial<CookProgressValue>, options?: { keepalive?: boolean }) => {
    this.patchCalls.push(options ? { server, changes, options } : { server, changes });
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

function createSync(options: { progress?: CookProgressValue; server?: CookServerSnapshot | null; visible?: () => boolean } = {}) {
  const client = new FakeClient();
  const onProgress = vi.fn();
  const onChange = vi.fn();
  const sync = new CookSessionSync({
    client,
    progress: options.progress ?? progress(),
    server: options.server ?? null,
    normalize: (value) => normalizeCookProgress(value, bounds),
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

  it("shows the server's progress when the server refuses this page's change", async () => {
    const { client, sync, onProgress } = createSync({ progress: progress({ checkedIngredientIds: ["rice"] }), server: snapshot(1) });
    client.reads.push({ kind: "state", state: snapshot(1) });
    client.patches.push({ kind: "rejected" });
    client.reads.push({ kind: "state", state: snapshot(2, { checkedIngredientIds: ["stock", "gone"] }) });

    await sync.sync(true);

    expect(onProgress).toHaveBeenLastCalledWith(progress({ checkedIngredientIds: ["stock"] }));
    expect(sync.server).toEqual(snapshot(2, { checkedIngredientIds: ["stock"] }));
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
