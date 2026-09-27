import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CookSessionSync,
  DEFAULT_COOK_PROGRESS,
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

  it("tolerates unavailable storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeSyncedCookCache("user-1", "recipe-1", { progress: progress(), server: null })).not.toThrow();
  });
});

describe("createCookSessionClient", () => {
  function respond(status: number, body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }));
  }

  const state = { attemptId: "attempt-1", revision: 1, progress: progress({ scaleFactor: 2 }) };

  it("reads, starts, and patches the recipe's session", async () => {
    const fetch = respond(200, { state });
    const client = createCookSessionClient("recipe 1", { fetch, mutationId: () => "m-1" });

    await expect(client.read()).resolves.toEqual({ kind: "state", state: snapshot(1, { scaleFactor: 2 }) });
    await client.start();
    await client.patch(snapshot(1), { scaleFactor: 2 });

    expect(fetch.mock.calls).toEqual([
      ["/api/cook-sessions/recipe%201", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }],
      ["/api/cook-sessions/recipe%201/start", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }],
      ["/api/cook-sessions/recipe%201", {
        method: "PATCH",
        body: JSON.stringify({ attemptId: "attempt-1", expectedRevision: 1, mutationId: "m-1", changes: { scaleFactor: 2 } }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
      }],
    ]);
  });

  it("maps each server answer to what the sync loop does next", async () => {
    const answer = (status: number, body: unknown) => createCookSessionClient("r", { fetch: respond(status, body) }).read();

    await expect(answer(200, { state: null })).resolves.toEqual({ kind: "state", state: null });
    await expect(answer(409, { error: { code: "stale_revision", state } })).resolves.toEqual({ kind: "conflict", state: snapshot(1, { scaleFactor: 2 }) });
    await expect(answer(409, { error: { code: "stale_revision" } })).resolves.toEqual({ kind: "unavailable" });
    await expect(answer(409, { error: "x" })).resolves.toEqual({ kind: "unavailable" });
    await expect(answer(404, { error: { code: "not_found" } })).resolves.toEqual({ kind: "missing" });
    await expect(answer(400, { error: { code: "invalid_request" } })).resolves.toEqual({ kind: "rejected" });
    await expect(answer(503, { error: { code: "cook_session_protocol_unavailable" } })).resolves.toEqual({ kind: "unavailable" });
    await expect(answer(200, { state: { attemptId: 1 } })).resolves.toEqual({ kind: "unavailable" });
    await expect(answer(200, "not an object")).resolves.toEqual({ kind: "unavailable" });

    const offline = createCookSessionClient("r", { fetch: vi.fn(async () => { throw new TypeError("offline"); }) });
    await expect(offline.read()).resolves.toEqual({ kind: "unavailable" });
    const notJson = createCookSessionClient("r", { fetch: vi.fn(async () => new Response("<html>", { status: 502 })) });
    await expect(notJson.read()).resolves.toEqual({ kind: "unavailable" });
  });

  it("uses the browser's fetch and random mutation ids by default", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ state })));
    await createCookSessionClient("r").patch(snapshot(1), { scaleFactor: 2 });

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
  patchCalls: Array<{ server: CookServerSnapshot; changes: Partial<CookProgressValue> }> = [];

  read = vi.fn(async () => this.next(this.reads, "read"));
  start = vi.fn(async () => this.next(this.starts, "start"));
  patch = vi.fn(async (server: CookServerSnapshot, changes: Partial<CookProgressValue>) => {
    this.patchCalls.push({ server, changes });
    return this.next(this.patches, "patch");
  });

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

function createSync(options: { progress?: CookProgressValue; server?: CookServerSnapshot | null } = {}) {
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

  it("pushes a change after a short pause, straight from the known revision", async () => {
    const { client, sync } = createSync({ server: snapshot(2) });
    client.patches.push({ kind: "state", state: snapshot(3, { scaleFactor: 2 }) });

    sync.setProgress(progress({ scaleFactor: 2 }));
    sync.setProgress(progress({ scaleFactor: 2 }));
    expect(sync.status).toBe("syncing");
    await vi.advanceTimersByTimeAsync(300);

    expect(client.read).not.toHaveBeenCalled();
    expect(client.patchCalls).toEqual([{ server: snapshot(2), changes: { scaleFactor: 2 } }]);
    expect(sync.server?.revision).toBe(3);
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
    const firstPatch = deferred();
    client.patches.push(firstPatch.promise);
    client.patches.push({ kind: "state", state: snapshot(3, { scaleFactor: 2, checkedIngredientIds: ["rice"] }) });

    const running = sync.sync(false);
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
    const queued = sync.sync(true);
    void sync.sync(false);
    expect(queued).toBe(running);
    firstRead.resolve({ kind: "state", state: null });
    await running;

    expect(client.read).toHaveBeenCalledTimes(2);
  });

  it("starts over when the server no longer has the session", async () => {
    const { client, sync } = createSync({ progress: progress({ scaleFactor: 2 }), server: snapshot(5) });
    client.patches.push({ kind: "missing" });
    client.starts.push({ kind: "state", state: snapshot(0, {}, "attempt-2") });
    client.patches.push({ kind: "state", state: snapshot(1, { scaleFactor: 2 }, "attempt-2") });

    await sync.sync(false);

    expect(client.patchCalls[1]).toEqual({ server: snapshot(0, {}, "attempt-2"), changes: { scaleFactor: 2 } });
    expect(sync.server?.attemptId).toBe("attempt-2");
  });

  it("shows the server's progress when the server refuses this page's change", async () => {
    const { client, sync, onProgress } = createSync({ progress: progress({ checkedIngredientIds: ["rice"] }), server: snapshot(1) });
    client.patches.push({ kind: "rejected" });
    client.reads.push({ kind: "state", state: snapshot(2, { checkedIngredientIds: ["stock", "gone"] }) });

    await sync.sync(false);

    expect(onProgress).toHaveBeenLastCalledWith(progress({ checkedIngredientIds: ["stock"] }));
    expect(sync.server).toEqual(snapshot(2, { checkedIngredientIds: ["stock"] }));
    expect(sync.status).toBe("synced");
  });

  it("clears to nothing when a refused change meets an empty server", async () => {
    const { client, sync, onProgress } = createSync({ progress: progress({ checkedIngredientIds: ["rice"] }), server: snapshot(1) });
    client.patches.push({ kind: "rejected" });
    client.reads.push({ kind: "state", state: null });

    await sync.sync(false);

    expect(onProgress).toHaveBeenLastCalledWith(progress());
    expect(sync.server).toBeNull();
  });

  it("retries with growing delays while the server is unreachable, then recovers", async () => {
    const { client, sync } = createSync({ progress: progress({ scaleFactor: 2 }) });
    client.reads.push({ kind: "unavailable" });

    await sync.sync(true);
    expect(sync.status).toBe("offline");

    client.reads.push({ kind: "unavailable" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.read).toHaveBeenCalledTimes(2);

    client.reads.push({ kind: "state", state: snapshot(0) });
    client.patches.push({ kind: "state", state: snapshot(1, { scaleFactor: 2 }) });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(client.read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.read).toHaveBeenCalledTimes(3);
    expect(sync.status).toBe("synced");
  });

  it("caps the retry delay", async () => {
    const { client, sync } = createSync();
    for (let attempt = 0; attempt < 8; attempt += 1) client.reads.push({ kind: "unavailable" });

    await sync.sync(true);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000 + 16_000 + 30_000 + 30_000);

    expect(client.read).toHaveBeenCalledTimes(8);
  });

  it.each<[string, (client: FakeClient) => void]>([
    ["a failed start", (client) => {
      client.reads.push({ kind: "state", state: null });
      client.starts.push({ kind: "unavailable" });
    }],
    ["a start without state", (client) => {
      client.reads.push({ kind: "state", state: null });
      client.starts.push({ kind: "state", state: null });
    }],
    ["a failed patch", (client) => {
      client.reads.push({ kind: "state", state: snapshot(0) });
      client.patches.push({ kind: "unavailable" });
    }],
    ["a patch without state", (client) => {
      client.reads.push({ kind: "state", state: snapshot(0) });
      client.patches.push({ kind: "state", state: null });
    }],
    ["a failed read after a refusal", (client) => {
      client.reads.push({ kind: "state", state: snapshot(0) });
      client.patches.push({ kind: "rejected" });
      client.reads.push({ kind: "unavailable" });
    }],
    ["endless conflicts", (client) => {
      client.reads.push({ kind: "state", state: snapshot(0) });
      for (let round = 1; round <= 4; round += 1) {
        client.patches.push({ kind: "conflict", state: snapshot(round) });
      }
    }],
  ])("reports offline after %s", async (_name, arrange) => {
    const { client, sync } = createSync({ progress: progress({ scaleFactor: 2 }) });
    arrange(client);

    await sync.sync(true);

    expect(sync.status).toBe("offline");
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
      sync.dispose();
      pending.resolve({ kind: "state", state: snapshot(9, { scaleFactor: 2 }) });
      await running;
      onChange.mockClear();

      sync.setProgress(progress({ scaleFactor: 3 }));
      await sync.sync(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onChange).not.toHaveBeenCalled();
      expect(sync.progress).toEqual(progress({ scaleFactor: 2 }));
    }
  });
});
