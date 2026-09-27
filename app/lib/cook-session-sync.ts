// Cross-device cook progress for a signed-in cook: the recipe page's checklist, scale, and current
// step are kept in the user's CookSession on the server (cook-session protocol v1) and cached in
// this browser's localStorage so the page works offline and loads instantly.
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

export type CookSyncStatus = "syncing" | "synced" | "offline";

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
  | { kind: "missing" }
  | { kind: "rejected" }
  | { kind: "unavailable" };

export interface CookSessionClient {
  read(): Promise<CookSyncResult>;
  start(): Promise<CookSyncResult>;
  patch(server: CookServerSnapshot, changes: Partial<CookProgressValue>): Promise<CookSyncResult>;
}

export function createCookSessionClient(
  recipeId: string,
  options: { fetch?: typeof fetch; mutationId?: () => string } = {},
): CookSessionClient {
  const send = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const mutationId = options.mutationId ?? (() => crypto.randomUUID());
  const path = `/api/cook-sessions/${encodeURIComponent(recipeId)}`;

  async function call(url: string, init: RequestInit): Promise<CookSyncResult> {
    let response: Response;
    let body: unknown;
    try {
      response = await send(url, {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        headers: init.body ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
      });
      body = await response.json();
    } catch {
      return { kind: "unavailable" };
    }
    if (response.ok && isRecord(body) && body.state === null) return { kind: "state", state: null };
    const state = parseCookServerState(isRecord(body) ? body.state : null);
    if (response.ok && state) return { kind: "state", state };
    const conflictState = isRecord(body) && isRecord(body.error) ? parseCookServerState(body.error.state) : null;
    if (response.status === 409 && conflictState) return { kind: "conflict", state: conflictState };
    if (response.status === 404) return { kind: "missing" };
    if (response.status === 400) return { kind: "rejected" };
    return { kind: "unavailable" };
  }

  return {
    read: () => call(path, { method: "GET" }),
    start: () => call(`${path}/start`, { method: "POST" }),
    patch: (server, changes) => call(path, {
      method: "PATCH",
      body: JSON.stringify({
        attemptId: server.attemptId,
        expectedRevision: server.revision,
        mutationId: mutationId(),
        changes,
      }),
    }),
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
}

/**
 * Keeps one recipe's progress in step with the user's CookSession. Every exchange with the
 * server runs one at a time; a request made while one is running is folded into a single rerun.
 */
export class CookSessionSync {
  private local: CookProgressValue;
  private known: CookServerSnapshot | null;
  private pulled = false;
  private failed = false;
  private disposed = false;
  private running: Promise<void> | null = null;
  private rerun = false;
  private rerunPull = false;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = FIRST_RETRY_DELAY_MS;

  constructor(private readonly options: CookSessionSyncOptions) {
    this.local = options.progress;
    this.known = options.server;
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
    if (this.pulled && !this.pending) return "synced";
    return this.failed ? "offline" : "syncing";
  }

  /** The page's progress changed (a check, a scale, a step). */
  setProgress(progress: CookProgressValue): void {
    if (this.disposed || sameCookProgress(progress, this.local)) return;
    this.local = progress;
    this.options.onChange();
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.sync(false), PUSH_DELAY_MS);
  }

  /** Exchanges progress with the server; `pull` first reads the server's latest state. */
  sync(pull: boolean): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running) {
      this.rerun = true;
      this.rerunPull ||= pull;
      return this.running;
    }
    this.running = this.drain(pull);
    return this.running;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.pushTimer);
    clearTimeout(this.retryTimer);
  }

  private async drain(pull: boolean): Promise<void> {
    let nextPull = pull;
    do {
      this.rerun = false;
      this.rerunPull = false;
      const ok = await this.reconcile(nextPull);
      if (this.disposed) break;
      this.failed = !ok;
      clearTimeout(this.retryTimer);
      if (ok) {
        this.retryDelay = FIRST_RETRY_DELAY_MS;
      } else {
        this.retryTimer = setTimeout(() => void this.sync(true), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY_MS);
      }
      this.options.onChange();
      nextPull = this.rerunPull;
    } while (this.rerun);
    this.running = null;
  }

  // Accepts `state` as the latest server state. `sent` is the page progress the exchange started
  // from; anything the cook changed since then is replayed on top so it is not lost.
  private acknowledge(state: CookServerSnapshot, sent: CookProgressValue): void {
    this.known = state;
    const next = this.options.normalize(mergeCookProgress(sent, this.local, state.progress));
    if (!sameCookProgress(next, this.local)) {
      this.local = next;
      this.options.onProgress(next);
    }
  }

  private async reconcile(pull: boolean): Promise<boolean> {
    let remote: CookServerSnapshot | null = this.known;
    if (pull || !remote) {
      const read = await this.options.client.read();
      if (this.disposed || read.kind !== "state") return false;
      this.pulled = true;
      remote = read.state;
    }

    for (let round = 0; round < MAX_SYNC_ROUNDS; round += 1) {
      if (!remote) {
        // Nothing on the server yet: only start a session once there is progress to keep.
        if (sameCookProgress(this.local, DEFAULT_COOK_PROGRESS)) {
          this.known = null;
          return true;
        }
        const started = await this.options.client.start();
        if (this.disposed || started.kind !== "state" || !started.state) return false;
        remote = started.state;
      }

      const base = this.known && this.known.attemptId === remote.attemptId ? this.known.progress : DEFAULT_COOK_PROGRESS;
      const sent = this.local;
      const merged = this.options.normalize(mergeCookProgress(base, sent, remote.progress));
      if (sameCookProgress(merged, remote.progress)) {
        this.acknowledge(remote, sent);
        return true;
      }

      const result = await this.options.client.patch(remote, cookProgressChanges(remote.progress, merged));
      if (this.disposed) return false;
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
        return false;
      }
    }
    return false;
  }

  // The server refused this page's progress (its recipe changed since the page loaded). Show the
  // server's progress instead of retrying the same refused change.
  private async adoptServerProgress(): Promise<boolean> {
    const read = await this.options.client.read();
    if (this.disposed || read.kind !== "state") return false;
    this.pulled = true;
    const adopted = this.options.normalize(read.state?.progress ?? DEFAULT_COOK_PROGRESS);
    this.known = read.state ? { ...read.state, progress: adopted } : null;
    this.local = adopted;
    this.options.onProgress(adopted);
    return true;
  }
}
