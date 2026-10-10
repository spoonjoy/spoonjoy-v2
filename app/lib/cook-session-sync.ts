// Cross-device cook progress for a signed-in cook: the recipe page's checklist, scale, and current
// step are kept in the user's CookSession on the server (cook-session protocol v1) and cached in
// this browser's localStorage so the page works offline and loads instantly. The cache is cleared
// on sign-out (clearCookProgressCache), so the next person on a shared browser starts clean.
//
// Merge rule: the server holds numbered revisions. The browser remembers the last server state it
// saw (the "base") and treats everything that differs from the base as its own pending changes.
// When the server has moved on, the pending changes are replayed on top of the server's state:
// a changed scale or step wins over the server's, and checks and unchecks are applied item by
// item, so two devices checking different ingredients both keep their checks.

export interface CookProgressValue {
  activeStepIndex: number;
  scaleFactor: number;
  checkedIngredientIds: string[];
  checkedStepOutputIds: string[];
}

export interface CookProgressBounds {
  stepCount: number;
  ingredientIds: ReadonlySet<string>;
  stepOutputIds: ReadonlySet<string>;
}

export interface CookServerSnapshot {
  attemptId: string;
  revision: number;
  progress: CookProgressValue;
}

export interface SyncedCookCache {
  progress: CookProgressValue;
  server: CookServerSnapshot | null;
}

/**
 * - `syncing`: an exchange is due or running.
 * - `synced`: the server has everything this page has.
 * - `offline`: the server could not be reached; changes wait here and go at the next chance.
 * - `stopped`: the server will not take this page's progress (sync switched off, the recipe is
 *   gone, access refused); progress stays on this device and nothing more is sent for this page
 *   view. Nothing is remembered: the next load of the recipe tries again.
 * - `signed_out`: the session ended (401); progress stays on this device until the cook signs in.
 * - `account_changed`: this tab's cook is no longer the browser's signed-in user; unsent changes
 *   are dropped, nothing more is sent or saved, and the page should be reloaded.
 * - `update_required`: the server needs a newer page (428); the page should be reloaded.
 */
export type CookSyncStatus =
  | "syncing"
  | "synced"
  | "offline"
  | "stopped"
  | "signed_out"
  | "account_changed"
  | "update_required";

type HaltReason = "stopped" | "signed_out" | "account_changed" | "update_required";

export const DEFAULT_COOK_PROGRESS: CookProgressValue = Object.freeze({
  activeStepIndex: 0,
  scaleFactor: 1,
  checkedIngredientIds: [],
  checkedStepOutputIds: [],
}) as CookProgressValue;

const SYNCED_CACHE_VERSION = 1;
const MAX_SYNC_ROUNDS = 4;
const PUSH_DELAY_MS = 300;
const FIRST_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
/** Automatic retries after a transient failure; after that, the next focus/visible/online event retries. */
export const MAX_COOK_SYNC_RETRIES = 5;
/** A pull within this long of the start of the last successful one is skipped (focus and visibilitychange arrive together). */
export const MIN_COOK_PULL_INTERVAL_MS = 2_000;
/** Leaving the recipe inside the app waits at most this long for the last saves before stopping. */
export const COOK_LEAVE_TIMEOUT_MS = 10_000;
/** Browsers cap a keepalive request's body at 64 KiB; the leave-time flush stays well under it. */
export const MAX_KEEPALIVE_BODY_BYTES = 32 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function normalizeScaleFactor(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }

  return Math.min(50, Math.max(0.25, Math.round(value * 100) / 100));
}

export function normalizeStepIndex(value: unknown, stepCount: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || stepCount <= 0) {
    return 0;
  }

  return Math.min(stepCount - 1, Math.max(0, Math.trunc(value)));
}

/** Keeps only ids that exist in the recipe as loaded, and puts the step and scale in range. */
export function normalizeCookProgress(progress: CookProgressValue, bounds: CookProgressBounds): CookProgressValue {
  return {
    activeStepIndex: normalizeStepIndex(progress.activeStepIndex, bounds.stepCount),
    scaleFactor: normalizeScaleFactor(progress.scaleFactor),
    checkedIngredientIds: [...new Set(progress.checkedIngredientIds)].filter((id) => bounds.ingredientIds.has(id)),
    checkedStepOutputIds: [...new Set(progress.checkedStepOutputIds)].filter((id) => bounds.stepOutputIds.has(id)),
  };
}

function sameIds(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return new Set(left).size === rightSet.size && left.every((id) => rightSet.has(id));
}

export function sameCookProgress(left: CookProgressValue, right: CookProgressValue): boolean {
  return left.activeStepIndex === right.activeStepIndex &&
    left.scaleFactor === right.scaleFactor &&
    sameIds(left.checkedIngredientIds, right.checkedIngredientIds) &&
    sameIds(left.checkedStepOutputIds, right.checkedStepOutputIds);
}

function mergeIds(base: string[], local: string[], remote: string[]): string[] {
  const baseSet = new Set(base);
  const localSet = new Set(local);
  const unchecked = new Set(base.filter((id) => !localSet.has(id)));
  const merged = remote.filter((id) => !unchecked.has(id));
  for (const id of local) {
    if (!baseSet.has(id) && !merged.includes(id)) merged.push(id);
  }
  return merged;
}

/** Replays `local`'s changes since `base` on top of `remote` (see the merge rule above). */
export function mergeCookProgress(
  base: CookProgressValue,
  local: CookProgressValue,
  remote: CookProgressValue,
): CookProgressValue {
  return {
    activeStepIndex: local.activeStepIndex !== base.activeStepIndex ? local.activeStepIndex : remote.activeStepIndex,
    scaleFactor: local.scaleFactor !== base.scaleFactor ? local.scaleFactor : remote.scaleFactor,
    checkedIngredientIds: mergeIds(base.checkedIngredientIds, local.checkedIngredientIds, remote.checkedIngredientIds),
    checkedStepOutputIds: mergeIds(base.checkedStepOutputIds, local.checkedStepOutputIds, remote.checkedStepOutputIds),
  };
}

/** The fields of `to` that differ from `from`, as a protocol PATCH `changes` object. */
export function cookProgressChanges(from: CookProgressValue, to: CookProgressValue): Partial<CookProgressValue> {
  const changes: Partial<CookProgressValue> = {};
  if (from.activeStepIndex !== to.activeStepIndex) changes.activeStepIndex = to.activeStepIndex;
  if (from.scaleFactor !== to.scaleFactor) changes.scaleFactor = to.scaleFactor;
  if (!sameIds(from.checkedIngredientIds, to.checkedIngredientIds)) changes.checkedIngredientIds = to.checkedIngredientIds;
  if (!sameIds(from.checkedStepOutputIds, to.checkedStepOutputIds)) changes.checkedStepOutputIds = to.checkedStepOutputIds;
  return changes;
}

function parseProgress(value: unknown): CookProgressValue | null {
  if (
    !isRecord(value) ||
    typeof value.activeStepIndex !== "number" ||
    typeof value.scaleFactor !== "number" ||
    !isStringList(value.checkedIngredientIds) ||
    !isStringList(value.checkedStepOutputIds)
  ) {
    return null;
  }
  return {
    activeStepIndex: value.activeStepIndex,
    scaleFactor: value.scaleFactor,
    checkedIngredientIds: value.checkedIngredientIds,
    checkedStepOutputIds: value.checkedStepOutputIds,
  };
}

/** Reads the server's `state` object (or a cached copy of it) into the part the browser keeps. */
export function parseCookServerState(value: unknown): CookServerSnapshot | null {
  if (!isRecord(value) || typeof value.attemptId !== "string" || typeof value.revision !== "number") {
    return null;
  }
  const progress = parseProgress(value.progress);
  return progress ? { attemptId: value.attemptId, revision: value.revision, progress } : null;
}

// Signed-in progress is cached under the user's id, apart from the anonymous
// `spoonjoy-cook-progress:<recipeId>` key, so one account's progress is never read or uploaded
// by another account (or by a signed-out visitor) on a shared browser.
export function syncedCookProgressStorageKey(userId: string, recipeId: string): string {
  return `spoonjoy-cook-progress:user:${userId}:${recipeId}`;
}

const COOK_PROGRESS_KEY_PREFIX = "spoonjoy-cook-progress:";
const SIGNED_IN_COOK_PROGRESS_KEY_PREFIX = "spoonjoy-cook-progress:user:";

function removeLocalStorageKeys(shouldRemove: (key: string) => boolean): void {
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (key !== null && shouldRemove(key)) storage.removeItem(key);
    }
  } catch {
    // Unavailable storage holds nothing to clear.
  }
}

/**
 * Sign-out: removes every cached cook progress entry in this browser, signed-in and signed-out
 * alike, so the next person to use it starts clean. Signed-in progress is still on the server.
 */
export function clearCookProgressCache(): void {
  removeLocalStorageKeys((key) => key.startsWith(COOK_PROGRESS_KEY_PREFIX));
}

/**
 * Removes signed-in cook progress cached for anyone but `currentUserId` (everyone when signed
 * out). This covers the ways a session ends without the logout form: "Sign out everywhere" or a
 * password change on another device, and session expiry. Signed-out progress stays: it belongs to
 * whoever is using the browser now.
 */
export function clearOtherUsersCookProgressCache(currentUserId: string | null): void {
  const keep = currentUserId === null ? null : `${SIGNED_IN_COOK_PROGRESS_KEY_PREFIX}${currentUserId}:`;
  removeLocalStorageKeys((key) =>
    key.startsWith(SIGNED_IN_COOK_PROGRESS_KEY_PREFIX) && (keep === null || !key.startsWith(keep)),
  );
}

export function readSyncedCookCache(
  userId: string,
  recipeId: string,
  bounds: CookProgressBounds,
): SyncedCookCache | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(syncedCookProgressStorageKey(userId, recipeId)) ?? "null") as unknown;
    if (!isRecord(parsed) || parsed.version !== SYNCED_CACHE_VERSION) return null;
    const progress = parseProgress(parsed.progress);
    if (!progress) return null;
    return {
      progress: normalizeCookProgress(progress, bounds),
      server: parseCookServerState(parsed.server),
    };
  } catch {
    return null;
  }
}

/** Removes one signed-in cook's cached progress for one recipe. */
export function removeSyncedCookCache(userId: string, recipeId: string): void {
  const key = syncedCookProgressStorageKey(userId, recipeId);
  removeLocalStorageKeys((candidate) => candidate === key);
}

export function writeSyncedCookCache(userId: string, recipeId: string, cache: SyncedCookCache): void {
  try {
    window.localStorage.setItem(syncedCookProgressStorageKey(userId, recipeId), JSON.stringify({
      version: SYNCED_CACHE_VERSION,
      progress: cache.progress,
      server: cache.server,
      updatedAt: new Date().toISOString(),
    }));
  } catch {
    // Unavailable storage only costs the offline cache; the server still has the progress.
  }
}

export type CookSyncResult =
  | { kind: "state"; state: CookServerSnapshot | null }
  | { kind: "conflict"; state: CookServerSnapshot }
  /** 404: the session is gone (PATCH), or the recipe is (start, read). */
  | { kind: "missing" }
  /** 400: the server refused this request's content. */
  | { kind: "rejected" }
  /** 412 user_mismatch: the browser's signed-in user is not this tab's cook. */
  | { kind: "wrong_user" }
  /** 428 user_header_required: this page's code predates what the server needs. */
  | { kind: "outdated" }
  /** 401: the session ended. */
  | { kind: "unauthenticated" }
  /** Will not succeed by retrying: 403, 503 protocol unavailable, and other 4xx. */
  | { kind: "stopped" }
  /** May succeed later: network failure, 429, and 5xx other than 503 protocol unavailable. */
  | { kind: "transient"; retryAfterMs?: number };

export interface CookSessionClient {
  read(): Promise<CookSyncResult>;
  start(): Promise<CookSyncResult>;
  patch(
    server: CookServerSnapshot,
    changes: Partial<CookProgressValue>,
    options?: { keepalive?: boolean },
  ): Promise<CookSyncResult>;
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function errorCode(body: unknown): unknown {
  return isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
}

function classifyFailure(response: Response, body: unknown): CookSyncResult {
  const conflictState = isRecord(body) && isRecord(body.error) ? parseCookServerState(body.error.state) : null;
  if (response.status === 409 && conflictState) return { kind: "conflict", state: conflictState };
  if (response.status === 412 && errorCode(body) === "user_mismatch") return { kind: "wrong_user" };
  if (response.status === 428) return { kind: "outdated" };
  if (response.status === 401) return { kind: "unauthenticated" };
  if (response.status === 404) return { kind: "missing" };
  if (response.status === 400) return { kind: "rejected" };
  if (response.status === 429) return { kind: "transient", retryAfterMs: retryAfterMs(response) };
  if (response.status === 503 && errorCode(body) === "cook_session_protocol_unavailable") return { kind: "stopped" };
  if (response.status >= 500) return { kind: "transient", retryAfterMs: retryAfterMs(response) };
  return { kind: "stopped" };
}

export function createCookSessionClient(
  recipeId: string,
  userId: string,
  options: { fetch?: typeof fetch; mutationId?: () => string } = {},
): CookSessionClient {
  const send = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const mutationId = options.mutationId ?? (() => crypto.randomUUID());
  const path = `/api/cook-sessions/${encodeURIComponent(recipeId)}`;

  async function call(url: string, init: RequestInit): Promise<CookSyncResult> {
    let response: Response;
    try {
      response = await send(url, {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          // Tabs share one session cookie: the server refuses the request if it is no longer this cook's.
          "X-Spoonjoy-Cook-User": userId,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      return { kind: "transient" };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (response.ok && isRecord(body) && body.state === null) return { kind: "state", state: null };
    const state = parseCookServerState(isRecord(body) ? body.state : null);
    if (response.ok && state) return { kind: "state", state };
    return response.ok ? { kind: "transient" } : classifyFailure(response, body);
  }

  return {
    read: () => call(path, { method: "GET" }),
    start: () => call(`${path}/start`, { method: "POST" }),
    patch: (server, changes, patchOptions = {}) => {
      const body = JSON.stringify({
        attemptId: server.attemptId,
        expectedRevision: server.revision,
        mutationId: mutationId(),
        changes,
      });
      if (patchOptions.keepalive && new TextEncoder().encode(body).byteLength > MAX_KEEPALIVE_BODY_BYTES) {
        // Too big to outlive the page; the change stays queued in this browser's cache instead.
        return Promise.resolve({ kind: "transient" });
      }
      return call(path, { method: "PATCH", body, ...(patchOptions.keepalive ? { keepalive: true } : {}) });
    },
  };
}

export interface CookSessionSyncOptions {
  client: CookSessionClient;
  progress: CookProgressValue;
  server: CookServerSnapshot | null;
  normalize: (progress: CookProgressValue) => CookProgressValue;
  /** The server's progress (merged with anything still pending here) should replace the page's. */
  onProgress: (progress: CookProgressValue) => void;
  /** Progress, the known server state, or the status changed: persist and re-render. */
  onChange: () => void;
  /** Whether the page is visible; nothing is sent or retried while it is hidden. */
  isVisible?: () => boolean;
  now?: () => number;
}

type Outcome =
  | { kind: "ok" }
  | { kind: "transient"; retryAfterMs?: number }
  | { kind: "halt"; reason: HaltReason };

/**
 * Keeps one recipe's progress in step with the user's CookSession. Every exchange with the
 * server runs one at a time; a request made while one is running is folded into a single rerun.
 * Transient failures retry a few times while the page is visible; answers that cannot change by
 * retrying stop the engine for good.
 */
export class CookSessionSync {
  private local: CookProgressValue;
  private known: CookServerSnapshot | null;
  private pulled = false;
  private failed = false;
  private disposed = false;
  private leaving = false;
  private halted: HaltReason | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  private rerunPull = false;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = FIRST_RETRY_DELAY_MS;
  private retries = 0;
  private lastPullAt = Number.NEGATIVE_INFINITY;
  private readonly isVisible: () => boolean;
  private readonly now: () => number;

  constructor(private readonly options: CookSessionSyncOptions) {
    this.local = options.progress;
    this.known = options.server;
    this.isVisible = options.isVisible ?? (() => true);
    this.now = options.now ?? (() => Date.now());
  }

  get progress(): CookProgressValue {
    return this.local;
  }

  get server(): CookServerSnapshot | null {
    return this.known;
  }

  private get pending(): boolean {
    return !sameCookProgress(this.local, this.known?.progress ?? DEFAULT_COOK_PROGRESS);
  }

  get status(): CookSyncStatus {
    if (this.halted) return this.halted;
    if (this.pulled && !this.pending) return "synced";
    return this.failed ? "offline" : "syncing";
  }

  /** The page's progress changed (a check, a scale, a step). */
  setProgress(progress: CookProgressValue): void {
    if (this.disposed || this.leaving || this.halted === "account_changed" || sameCookProgress(progress, this.local)) {
      return;
    }
    this.local = progress;
    this.options.onChange();
    if (this.halted) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.sync(false), PUSH_DELAY_MS);
  }

  /**
   * Exchanges progress with the server; `pull` first reads the server's latest state. Called for
   * page events (load, visible, focus, online) and local changes, it also restarts the retry
   * budget. Does nothing while the page is hidden or after the engine has stopped.
   */
  sync(pull: boolean): Promise<void> {
    this.retries = 0;
    this.retryDelay = FIRST_RETRY_DELAY_MS;
    clearTimeout(this.retryTimer);
    return this.run(pull);
  }

  /**
   * The page may be going away for good (pagehide, tab hidden): sends pending changes once with
   * `keepalive` so the request outlives the page, without waiting for the answer. It sends nothing
   * while a save is in flight (a flush from the old revision could only be refused as stale) or
   * before the session exists (a start and a PATCH cannot both outlive the page). Either way the
   * changes are already in this browser's cache, and the next visit sends them.
   */
  flush(): void {
    if (this.disposed || this.leaving || this.halted || this.running || !this.known) return;
    const changes = cookProgressChanges(this.known.progress, this.local);
    if (Object.keys(changes).length === 0) return;
    clearTimeout(this.pushTimer);
    void this.options.client.patch(this.known, changes, { keepalive: true });
  }

  /**
   * Leaving the recipe inside the app (the document stays alive): takes no new changes or pulls,
   * lets a save in flight finish, sends whatever is still pending (replaying conflicts, starting
   * the session if needed), then stops. Bounded by `timeoutMs` and only while the page is
   * visible; anything unsent by then stays in the cache for the next visit.
   */
  async leave(timeoutMs = COOK_LEAVE_TIMEOUT_MS): Promise<void> {
    if (this.disposed || this.leaving) return;
    this.leaving = true;
    clearTimeout(this.pushTimer);
    clearTimeout(this.retryTimer);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    const finish = async () => {
      while (this.running) await this.running;
      if (this.pending) await this.run(false);
    };
    await Promise.race([finish(), timedOut]);
    clearTimeout(timer);
    this.dispose();
  }

  /** Stops at once: no more requests, retries, or callbacks. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.pushTimer);
    clearTimeout(this.retryTimer);
  }

  private run(pull: boolean): Promise<void> {
    if (this.disposed || this.halted || !this.isVisible()) return Promise.resolve();
    if (this.running) {
      this.rerun = true;
      this.rerunPull ||= pull;
      return this.running;
    }
    this.running = this.drain(pull);
    return this.running;
  }

  private async drain(pull: boolean): Promise<void> {
    let nextPull = pull;
    do {
      this.rerun = false;
      this.rerunPull = false;
      const outcome = await this.reconcile(nextPull && this.now() - this.lastPullAt >= MIN_COOK_PULL_INTERVAL_MS);
      if (this.disposed) break;
      clearTimeout(this.retryTimer);
      this.failed = outcome.kind === "transient";
      if (outcome.kind === "transient") {
        this.scheduleRetry(outcome.retryAfterMs);
      } else if (outcome.kind === "halt") {
        this.halted = outcome.reason;
        if (outcome.reason === "account_changed") {
          // Another account owns the browser's session now: drop this tab's unsent changes, show
          // only what was saved, and never send or save anything more.
          this.show(this.options.normalize(this.known?.progress ?? DEFAULT_COOK_PROGRESS));
        }
      } else {
        this.retries = 0;
        this.retryDelay = FIRST_RETRY_DELAY_MS;
      }
      this.options.onChange();
      nextPull = this.rerunPull;
    } while (this.rerun && !this.halted);
    this.running = null;
  }

  private scheduleRetry(retryAfter: number | undefined): void {
    if (this.leaving || this.retries >= MAX_COOK_SYNC_RETRIES || !this.isVisible()) return;
    this.retries += 1;
    const delay = Math.min(Math.max(retryAfter ?? 0, this.retryDelay), MAX_RETRY_DELAY_MS);
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY_MS);
    this.retryTimer = setTimeout(() => void this.run(true), delay);
  }

  // Replaces this engine's progress and, unless it is leaving, the page's. A leaving engine's
  // recipe is no longer on the page (the route may already show another recipe), so it only
  // finishes delivering its own queue and never touches page state.
  private show(progress: CookProgressValue): void {
    this.local = progress;
    if (!this.leaving) this.options.onProgress(progress);
  }

  // Accepts `state` as the latest server state. `sent` is the page progress the exchange started
  // from; anything the cook changed since then is replayed on top so it is not lost.
  private acknowledge(state: CookServerSnapshot, sent: CookProgressValue): void {
    this.known = state;
    const next = this.options.normalize(mergeCookProgress(sent, this.local, state.progress));
    if (!sameCookProgress(next, this.local)) this.show(next);
  }

  private failure(result: CookSyncResult): Outcome {
    if (result.kind === "transient") return { kind: "transient", retryAfterMs: result.retryAfterMs };
    if (result.kind === "wrong_user") return { kind: "halt", reason: "account_changed" };
    if (result.kind === "outdated") return { kind: "halt", reason: "update_required" };
    if (result.kind === "unauthenticated") return { kind: "halt", reason: "signed_out" };
    return { kind: "halt", reason: "stopped" };
  }

  private async reconcile(pull: boolean): Promise<Outcome> {
    let remote: CookServerSnapshot | null = this.known;
    if (pull || !this.pulled) {
      const startedAt = this.now();
      const read = await this.options.client.read();
      if (this.disposed) return { kind: "ok" };
      if (read.kind !== "state") return this.failure(read);
      this.pulled = true;
      this.lastPullAt = startedAt;
      remote = read.state;
    }

    for (let round = 0; round < MAX_SYNC_ROUNDS; round += 1) {
      if (!remote) {
        // Nothing on the server yet: only start a session once there is progress to keep.
        if (sameCookProgress(this.local, DEFAULT_COOK_PROGRESS)) {
          this.known = null;
          return { kind: "ok" };
        }
        const started = await this.options.client.start();
        if (this.disposed) return { kind: "ok" };
        if (started.kind !== "state" || !started.state) return this.failure(started);
        remote = started.state;
      }

      const base = this.known && this.known.attemptId === remote.attemptId ? this.known.progress : DEFAULT_COOK_PROGRESS;
      const sent = this.local;
      const merged = this.options.normalize(mergeCookProgress(base, sent, remote.progress));
      if (sameCookProgress(merged, remote.progress)) {
        this.acknowledge(remote, sent);
        return { kind: "ok" };
      }

      const result = await this.options.client.patch(remote, cookProgressChanges(remote.progress, merged));
      if (this.disposed) return { kind: "ok" };
      if (result.kind === "state" && result.state) {
        this.acknowledge(result.state, sent);
        remote = result.state;
      } else if (result.kind === "conflict") {
        remote = result.state;
      } else if (result.kind === "missing") {
        this.known = null;
        remote = null;
      } else if (result.kind === "rejected") {
        return this.adoptServerProgress();
      } else {
        return this.failure(result);
      }
    }
    return { kind: "transient" };
  }

  // The server refused this page's progress (its recipe changed since the page loaded). Show the
  // server's progress instead of retrying the same refused change.
  private async adoptServerProgress(): Promise<Outcome> {
    const startedAt = this.now();
    const read = await this.options.client.read();
    if (this.disposed) return { kind: "ok" };
    if (read.kind !== "state") return this.failure(read);
    this.pulled = true;
    this.lastPullAt = startedAt;
    const adopted = this.options.normalize(read.state?.progress ?? DEFAULT_COOK_PROGRESS);
    this.known = read.state ? { ...read.state, progress: adopted } : null;
    this.show(adopted);
    return { kind: "ok" };
  }
}
