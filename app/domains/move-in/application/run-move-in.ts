// Runs a move-in a piece at a time. A chunk's recipes are written together, and their counts and
// report lines saved with the cursor in one write, so a Worker that stops mid-way repeats at most
// that chunk, and the SourceRecord rows make the repeat a no-op that still counts as this job's.
// A chunk a run stopped in goes again one recipe at a time, saving after each, so a recipe that
// takes the Worker down is found and passed over on its own. To tell a stop from a run that ended
// well, a save under a claim leaves the job's attempt at 1 rather than 0, and a run that ends well
// clears it as it lets the job go: the next claim reads 1 after a run that ended well, 2 or more
// after one that stopped. Only the run that
// holds the job's claim may write it, and every claim counts as an attempt until the job moves
// forward, so a job whose runs keep dying ends. The ports keep this free of D1, R2 and the request.
import type { RangeSource } from "../adapters/archive/zip";
import { openMealieBackup } from "../adapters/sources/mealie-backup/backup";
import { mealieBackupSource } from "../adapters/sources/mealie-backup/source";
import { MOVE_IN_ERROR_MESSAGES, MoveInError } from "../model/move-in-error";
import type { RecipeDraft } from "../model/recipe-draft";
import { SourceUnavailableError, type MoveInKitchen, type MoveInSource, type SourceWords } from "./source";

export type MoveInStatus = "queued" | "running" | "done" | "done-with-issues" | "failed";
export type MoveInPhase = "inspect" | "recipes" | "done";
export const FINISHED: readonly MoveInStatus[] = ["done", "done-with-issues", "failed"];
/** How many runs in a row may take the job without moving it forward before it fails with the "stuck" message. */
export const MAX_ATTEMPTS = 5;
/** How many runs in a row one recipe may stop, however it stops them, before it is reported and passed over. */
export const RECIPE_TRIES = 3;

export interface MoveInJob {
  id: string;
  ownerId: string;
  kind: string;
  sourceId: string | null;
  status: MoveInStatus;
  phase: MoveInPhase;
  cursor: string | null;
  archiveKey: string | null;
  lastError: string | null;
  /** Runs that have taken the job since it last moved forward. */
  attempt: number;
}

export interface MoveInCounts {
  found: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

export interface MoveInEvent {
  level: "info" | "warn" | "error";
  /** `item-renamed` and `item-kept` are for the record, not for the cook to look over. */
  kind: "phase-done" | "item-degraded" | "item-renamed" | "item-kept" | "item-skipped" | "item-failed" | "job-done" | "job-failed";
  entity: string | null;
  sourceKey: string | null;
  targetId: string | null;
  message: string;
  /** What the system said, kept for support and never shown as the message. */
  detail?: string | null;
}

export type RecipeWriteResult =
  /** `renamedFrom` is the backup's name when the cook already had a recipe by that name. */
  | { outcome: "created"; recipeId: string; title: string; renamedFrom?: string; warnings: string[] }
  /** `jobId` is the job that first brought the recipe in. */
  | { outcome: "unchanged"; recipeId: string; jobId: string }
  /** The backup changed a recipe that moved in before, and it changed in place. */
  | { outcome: "updated"; recipeId: string }
  /** The backup and the cook both changed it: the cook's version stays. */
  | { outcome: "kept"; recipeId: string; reason: string }
  | { outcome: "skipped"; recipeId: string; reason: string };

export interface RecipeWriteInput {
  sourceId: string;
  jobId: string;
  chefId: string;
  draft: RecipeDraft;
}

/** Counts to add and report lines to log, saved with the job in one write. */
export interface MoveInReport {
  counts?: Array<[entity: string, delta: Partial<MoveInCounts>]>;
  events?: MoveInEvent[];
  /** Clears the counts and report lines first, for an inspect that runs again. */
  restart?: boolean;
  /** Changes the job only if it has neither moved nor been taken by a run after this time (ISO). */
  quietSince?: string;
}

/** The job's claim passed to another run: this run must stop writing. */
export class LostClaimError extends Error {
  constructor() {
    super("Another run has taken this move-in over");
    this.name = "LostClaimError";
  }
}

export interface MoveInPorts {
  store: {
    loadJob(id: string): Promise<MoveInJob | null>;
    /**
     * Saves the job and its report in one write, only while the job is unfinished and, with a token, only while that
     * claim holds: LostClaimError otherwise, with nothing written. Resolves to how many jobs it changed (0 or 1).
     */
    updateJob(id: string, patch: Partial<MoveInJob>, token?: string, report?: MoveInReport): Promise<number>;
    ensureSource(source: { ownerId: string; kind: string; instanceKey: string; label: string; serverUrl: string | null; sourceVersion: string }): Promise<string>;
    /** The kitchen's key in the backup, as inspect chose it. */
    sourceInstanceKey(sourceId: string): Promise<string | null>;
    /** Whether the job has logged a warning or an error. */
    hasIssues(jobId: string): Promise<boolean>;
    /** Whether inspect chose to bring the job's tags, categories and tools: it counted some, and left none in the backup. */
    organizing(jobId: string): Promise<boolean>;
    /**
     * Takes the job for this run, counting an attempt, unless another run has shown signs of life lately: the claim's
     * token, or null.
     */
    claim(jobId: string, at: Date): Promise<string | null>;
    /**
     * Takes back the attempt this run's claim counted. A run that found the source out of reach did nothing wrong, so
     * it never brings a recipe nearer to being passed over; a job whose source stays away a day is stopped as expired.
     */
    forgiveAttempt(jobId: string, token: string): Promise<void>;
    /**
     * Lets the job go, if this run still holds it, so the next run can take it at once. With `endedWell`, it also sets
     * the job's attempt back to 0, clearing the 1 this run's saves left.
     */
    release(jobId: string, token: string, endedWell?: boolean): Promise<void>;
  };
  openArchive(job: MoveInJob): RangeSource | Promise<RangeSource>;
  /** Where the job's recipes come from, when it isn't the uploaded backup that openArchive reads. */
  openSource?(job: MoveInJob): Promise<MoveInSource>;
  ownerEmail(ownerId: string): Promise<string | null>;
  writeRecipe(input: RecipeWriteInput): Promise<RecipeWriteResult>;
  /**
   * Writes several new recipes in one go, for a chunk: each result in the inputs' order, or null for a recipe to write
   * alone with writeRecipe (one that moved in before, say). A Worker without it writes every recipe alone.
   */
  writeRecipes?(inputs: RecipeWriteInput[]): Promise<Array<RecipeWriteResult | null>>;
  attachPhoto(input: { ownerId: string; recipeId: string; bytes: Uint8Array }): Promise<void>;
  /** Whether the recipe already has a cover that moved in. */
  hasMovedInPhoto(recipeId: string): Promise<boolean>;
  /**
   * Puts a recipe's tags, categories and tools on it, adding to any it has, for a cook who has organizers. A Worker
   * without it leaves them in the backup.
   */
  organizers?: {
    on(ownerId: string): boolean;
    attach(input: { ownerId: string; recipeId: string; sourceId: string; jobId: string; tags: string[]; categories: string[]; tools: string[] }): Promise<void>;
  };
  /** Deletes the uploaded backup; it holds the other app's accounts, so it is kept no longer than the job needs it. */
  discardArchive(job: MoveInJob): Promise<void>;
  now(): Date;
}

export const DEFAULT_CHUNK_SIZE = 10;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function event(kind: MoveInEvent["kind"], message: string, more: Partial<MoveInEvent> = {}): MoveInEvent {
  const level = kind === "item-failed" || kind === "job-failed" ? "error" : kind === "item-degraded" || kind === "item-skipped" ? "warn" : "info";
  return { level, kind, entity: null, sourceKey: null, targetId: null, message, ...more };
}

interface Opened {
  source: MoveInSource;
  kitchen: MoveInKitchen;
}

/**
 * The attempt a save leaves: 1 under a claim, so a run that stops after it shows as one more to the next claim than a
 * run that ended well (whose release clears it); 0 without a claim, which has no release.
 */
function moved(token: string | undefined): number {
  return token === undefined ? 0 : 1;
}

/**
 * How many runs in a row have stopped since the job last moved. Under a claim that is the claims before this one: the
 * attempt less this claim's own count, since a run that ended well left 0 and one that stopped after a save left 1.
 * Without a claim it is the attempt, as the caller counts it.
 */
function stops(job: MoveInJob, token: string | undefined): number {
  return job.phase === "recipes" ? job.attempt - moved(token) : job.attempt;
}

/** One chunk's context: the job, the ports, the claim it writes under. */
interface Run {
  job: MoveInJob;
  ports: MoveInPorts;
  token: string | undefined;
  /** Where the recipes' tags, categories and tools go, when inspect chose to bring them. */
  organizers?: NonNullable<MoveInPorts["organizers"]>;
}

/** What one run keeps between its chunks, so the backup is read and parsed once. */
export interface RunCache {
  opened?: Opened;
  /** Whether inspect chose to bring the tags, categories and tools, asked once a run. */
  organizing?: boolean;
}

async function open({ job, ports }: Run, cache: RunCache): Promise<Opened> {
  if (cache.opened) return cache.opened;
  const source = ports.openSource
    ? await ports.openSource(job)
    : mealieBackupSource(await openMealieBackup(await ports.openArchive(job)));
  // Once inspect has chosen the kitchen, the job keeps to it.
  const key = job.sourceId
    ? await ports.store.sourceInstanceKey(job.sourceId)
    : await source.chooseKitchen(await ports.ownerEmail(job.ownerId));
  const kitchen = key ? await source.openKitchen(key) : null;
  if (!kitchen) throw new MoveInError("pick-a-group");
  cache.opened = { source, kitchen };
  return cache.opened;
}

async function inspect(run: Run, { source, kitchen }: Opened) {
  const { job, ports: { store } } = run;
  const sourceId = await store.ensureSource({
    ownerId: job.ownerId,
    kind: source.kind,
    instanceKey: kitchen.key,
    label: kitchen.name,
    serverUrl: source.serverUrl,
    sourceVersion: source.version,
  });
  const counted = await kitchen.count();
  const { photos } = counted;
  // A cook with organizers gets the tags, categories and tools on each recipe as it moves in; for anyone else they are
  // counted, and left for a later move-in. The choice is made here, once: the recipes follow what these counts say.
  const organizing = run.ports.organizers?.on(job.ownerId) ?? false;
  const waiting = [["tags", counted.tags, "tag"], ["categories", counted.categories, "category"], ["tools", counted.tools, "tool"]] as const;
  const left = waiting.filter(([, found]) => found).map(([, found, one]) => plural(found, one, one === "category" ? "categories" : `${one}s`));
  const report: MoveInReport = {
    // An inspect that runs again (after a stop before it saved) starts the report from nothing.
    restart: true,
    counts: [
      ["recipes", { found: kitchen.size }],
      ["photos", { found: photos }],
      ...waiting.filter(([, found]) => found).map(([entity, found]) => [entity, organizing ? { found } : { found, skipped: found }] as [string, Partial<MoveInCounts>]),
    ],
    events: [
      event("phase-done", `Found ${plural(kitchen.size, "recipe")}, ${photos} with a photo, in ${kitchen.name}.`),
      ...(left.length && !organizing ? [event("item-skipped", `Spoonjoy doesn't have tags, categories or tools yet, so ${left.join(", ")} stayed ${source.words.there}.`, { entity: "tags" })] : []),
    ],
  };
  await store.updateJob(job.id, { status: "running", phase: "recipes", cursor: "0", sourceId, attempt: moved(run.token) }, run.token, report);
}

/** Brings the recipe's photo, adding what happened to the report. */
type Report = Required<Pick<MoveInReport, "counts" | "events">>;

async function bringPhoto({ job, ports }: Run, kitchen: MoveInKitchen, draft: RecipeDraft, recipeId: string, report: Report) {
  // A photo that can't be read loses only the photo, never the job.
  try {
    const bytes = await kitchen.readPhoto(draft);
    await ports.attachPhoto({ ownerId: job.ownerId, recipeId, bytes });
    report.counts.push(["photos", { created: 1 }]);
  } catch (error) {
    if (stopsTheRun(error)) throw error;
    report.counts.push(["photos", { failed: 1 }]);
    report.events.push(event("item-degraded", `${draft.title} moved in without its photo: ${(error as Error).message}.`, { entity: "photos", sourceKey: draft.sourceKey, targetId: recipeId }));
  }
}

/** Puts the recipe's tags, categories and tools on it, when inspect chose to bring them; if that fails, the recipe stays and says so. */
async function bringOrganizers({ job, organizers }: Run, words: SourceWords, draft: RecipeDraft, recipeId: string, report: Report) {
  const { tags, categories, tools } = draft;
  if (!organizers || !(tags.length || categories.length || tools.length)) return;
  try {
    await organizers.attach({ ownerId: job.ownerId, recipeId, sourceId: job.sourceId as string, jobId: job.id, tags, categories, tools });
  } catch (error) {
    const message = `${draft.title} moved in without some of its tags, categories and tools. ${words.again} adds them.`;
    report.events.push(event("item-degraded", message, { entity: "recipes", sourceKey: draft.sourceKey, targetId: recipeId, detail: describeError(error) }));
  }
}

/** Brings one recipe, its photo and its organizers, and returns what to report; writes nothing to the job itself. */
async function bringRecipe(run: Run, opened: Opened, draft: RecipeDraft): Promise<Report> {
  const { job, ports } = run;
  // An error here is passed on, for bringOrPassOver to try the recipe again or pass it over.
  const result = await ports.writeRecipe({ sourceId: job.sourceId as string, jobId: job.id, chefId: job.ownerId, draft });
  return afterWrite(run, opened, draft, result);
}

/** Brings a written recipe's photo and organizers, and returns what to report. */
async function afterWrite(run: Run, { source, kitchen }: Opened, draft: RecipeDraft, result: RecipeWriteResult): Promise<Report> {
  const { job, ports } = run;
  const report: Report = { counts: [], events: [] };
  const at = { entity: "recipes", sourceKey: draft.sourceKey };
  const hasPhoto = kitchen.hasPhoto(draft);
  const target = { ...at, targetId: result.recipeId };
  if (result.outcome === "skipped") {
    report.counts.push(["recipes", { skipped: 1 }]);
    report.events.push(event("item-skipped", result.reason, target));
    return report;
  }
  if (result.outcome === "kept") {
    report.counts.push(["recipes", { unchanged: 1 }]);
    report.events.push(event("item-kept", result.reason, target));
    return report;
  }
  if (result.outcome === "unchanged" || result.outcome === "updated") {
    // This job wrote it before a stop that came before the save: it is still this job's new recipe.
    const ours = result.outcome === "unchanged" && result.jobId === job.id;
    report.counts.push(["recipes", ours ? { created: 1 } : result.outcome === "updated" ? { updated: 1 } : { unchanged: 1 }]);
    // Adding only, so a recipe already here gets any it lacks and keeps the ones the cook gave it.
    await bringOrganizers(run, source.words, draft, result.recipeId, report);
    if (!hasPhoto) return report;
    // A run that stopped between the recipe and its photo left the photo out; bring it now.
    if (await ports.hasMovedInPhoto(result.recipeId)) report.counts.push(["photos", ours ? { created: 1 } : { unchanged: 1 }]);
    else await bringPhoto(run, kitchen, draft, result.recipeId, report);
    return report;
  }
  report.counts.push(["recipes", { created: 1 }]);
  if (result.renamedFrom) {
    report.events.push(event("item-renamed", `You already had a recipe called "${result.renamedFrom}", so this one is "${result.title}".`, target));
  }
  for (const warning of result.warnings) report.events.push(event("item-degraded", warning, target));
  await bringOrganizers(run, source.words, draft, result.recipeId, report);
  if (hasPhoto) await bringPhoto(run, kitchen, draft, result.recipeId, report);
  return report;
}

/**
 * Brings the recipes from `start` up to `end` and returns what to report for all of them: the new ones written in one
 * go, and any the chunk's write left out, or that failed with it, one at a time as bringOrPassOver brings them.
 */
async function bringChunk(run: Run, opened: Opened, start: number, end: number, writeRecipes: NonNullable<MoveInPorts["writeRecipes"]>): Promise<Report> {
  const { job } = run;
  const drafts: Array<RecipeDraft | null> = [];
  for (let i = start; i < end; i++) {
    try {
      drafts.push(await opened.kitchen.draft(i));
    } catch (error) {
      if (stopsTheRun(error)) throw error;
      // A recipe the source can't give is tried, and reported, on its own.
      drafts.push(null);
    }
  }
  const ready = drafts.flatMap((draft) => (draft ? [{ sourceId: job.sourceId as string, jobId: job.id, chefId: job.ownerId, draft }] : []));
  let written: Array<RecipeWriteResult | null> = [];
  try {
    written = await writeRecipes(ready);
  } catch (error) {
    if (stopsTheRun(error)) throw error;
    // Each goes on its own instead, so one recipe's error is that recipe's alone.
  }
  const chunk: Report = { counts: [], events: [] };
  let next = 0;
  for (let i = start; i < end; i++) {
    const draft = drafts[i - start];
    const result = draft ? (written[next++] ?? null) : null;
    const report = draft && result ? await afterWrite(run, opened, draft, result) : await bringOrPassOver(run, opened, i);
    chunk.counts.push(...report.counts);
    chunk.events.push(...report.events);
  }
  return chunk;
}

/**
 * An error that is about the source, not the recipe: it can't be reached right now, which the queue tries again later,
 * or it refused the move-in, which stops the job with its fix-it message. Either way the recipe isn't to blame.
 */
function stopsTheRun(error: unknown): boolean {
  return error instanceof SourceUnavailableError || error instanceof MoveInError;
}

/** How a passed-over recipe's error reads in its report line: its kind and the start of its message. */
const ERROR_DETAIL_CHARS = 200;

function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, ERROR_DETAIL_CHARS);
}

/**
 * Brings one recipe, trying it once more in place if it fails. A recipe that fails twice is reported, with why, and
 * passed over, so one bad recipe never holds the rest back or sends the move-in through the queue's backoff. Only when
 * the database itself can't be reached is the error passed on, for the queue to try the whole segment again later.
 */
async function bringOrPassOver(run: Run, opened: Opened, index: number): Promise<Report> {
  const { source, kitchen } = opened;
  let failure: unknown;
  for (let tries = 0; tries < 2; tries++) {
    try {
      return await bringRecipe(run, opened, await kitchen.draft(index));
    } catch (error) {
      if (stopsTheRun(error)) throw error;
      failure = error;
    }
  }
  // A database that can't be reached throws here, and the segment goes back to the queue with the recipe still next.
  await run.ports.store.loadJob(run.job.id);
  const entry = kitchen.entry(index);
  return {
    counts: [["recipes", { failed: 1 }]],
    events: [event("item-failed", `${entry.title} didn't move in this time. ${source.words.again} tries it once more.`, {
      entity: "recipes",
      sourceKey: entry.sourceKey,
      detail: describeError(failure),
    })],
  };
}

async function recipes(run: Run, opened: Opened, chunkSize: number, cache: RunCache) {
  const { source, kitchen } = opened;
  const { job, ports } = run;
  const { store } = ports;
  if (ports.organizers && (cache.organizing ??= await store.organizing(job.id))) run.organizers = ports.organizers;
  let start = Number(job.cursor);
  // The recipe at the cursor has stopped every run since the job last moved, whether it threw or took the Worker down:
  // report it and move past it, so it never holds the rest back.
  if (stops(job, run.token) >= RECIPE_TRIES && start < kitchen.size) {
    const entry = kitchen.entry(start);
    await store.updateJob(job.id, { cursor: String(++start), attempt: moved(run.token) }, run.token, {
      counts: [["recipes", { failed: 1 }]],
      events: [event("item-failed", `${entry.title} didn't move in this time. ${source.words.again} tries it once more.`, {
        entity: "recipes",
        sourceKey: entry.sourceKey,
        detail: `It stopped the move-in ${RECIPE_TRIES} times in a row.`,
      })],
    });
    job.attempt = moved(run.token);
  }
  const end = Math.min(start + chunkSize, kitchen.size);
  // Together only while no run has stopped since the job last moved, so a recipe that stops runs is found on its own.
  // Without a claim, the caller has counted this run in the attempt already.
  if (ports.writeRecipes && stops(job, run.token) <= 1 - moved(run.token) && end - start > 1) {
    const report = await bringChunk(run, opened, start, end, ports.writeRecipes);
    await store.updateJob(job.id, { cursor: String(end), attempt: moved(run.token) }, run.token, report);
    job.attempt = moved(run.token);
  } else {
    for (let i = start; i < end; i++) {
      const report = await bringOrPassOver(run, opened, i);
      await store.updateJob(job.id, { cursor: String(i + 1), attempt: moved(run.token) }, run.token, report);
      job.attempt = moved(run.token);
    }
  }
  if (end < kitchen.size) return;
  const status = (await store.hasIssues(job.id)) ? "done-with-issues" : "done";
  await store.updateJob(job.id, { status, phase: "done", cursor: null }, run.token, { events: [event("job-done", `${plural(kitchen.size, "recipe")} moved in.`)] });
  await discard(job, ports);
}

// A backup a failed delete leaves behind is cleared by sweepMoveInArchives, so it never holds the job up.
async function discard(job: MoveInJob, ports: MoveInPorts) {
  await ports.discardArchive(job).catch(() => undefined);
}

async function fail(run: Run, code: keyof typeof MOVE_IN_ERROR_MESSAGES) {
  const { job, ports } = run;
  await ports.store.updateJob(job.id, { status: "failed", lastError: code }, run.token, { events: [event("job-failed", MOVE_IN_ERROR_MESSAGES[code])] });
  await discard(job, ports);
}

/**
 * Does the job's next piece of work and returns the job as it then stands, or null when there is no such job.
 * `token` is the claim it writes under (runForAWhile takes one); `cache` carries the parsed backup between chunks.
 * An outage is passed on: the next run tries again.
 */
export async function runNextChunk(
  jobId: string,
  ports: MoveInPorts,
  { chunkSize = DEFAULT_CHUNK_SIZE, token, cache = {} }: { chunkSize?: number; token?: string; cache?: RunCache } = {},
): Promise<MoveInJob | null> {
  const { store } = ports;
  const job = await store.loadJob(jobId);
  if (!job || FINISHED.includes(job.status)) return job;
  const run: Run = { job, ports, token };
  if (stops(job, token) > MAX_ATTEMPTS) {
    await fail(run, "stuck");
    return store.loadJob(jobId);
  }
  if (job.status === "queued") await store.updateJob(job.id, { status: "running" }, token);
  try {
    const opened = await open(run, cache);
    if (job.phase === "inspect") await inspect(run, opened);
    else await recipes(run, opened, chunkSize, cache);
  } catch (error) {
    if (error instanceof SourceUnavailableError && token) await store.forgiveAttempt(job.id, token);
    if (!(error instanceof MoveInError)) throw error;
    await fail(run, error.code);
  }
  return store.loadJob(jobId);
}

/**
 * Runs chunks under one claim until the job finishes, another run takes it, or `budgetMs` has passed (checked after
 * each chunk), and returns the job as it then stands. A Worker gives a request's waitUntil about 30 seconds, so the
 * budget stays well inside that.
 */
export async function runForAWhile(jobId: string, ports: MoveInPorts, options: { budgetMs: number; chunkSize?: number }): Promise<MoveInJob | null> {
  return (await runMoveInSegment(jobId, ports, options)).job;
}

/**
 * Runs the move-in for a while, as runForAWhile does, and says whether this run held it: `claimed` is false when
 * another run had it, or took it over, so whatever moved meanwhile was that run's work. With `releaseOnError`, a run
 * that stops with an error lets the job go at once, for a caller whose retries are paced already.
 */
export async function runMoveInSegment(
  jobId: string,
  ports: MoveInPorts,
  { budgetMs, chunkSize, releaseOnError = false }: { budgetMs: number; chunkSize?: number; releaseOnError?: boolean },
): Promise<{ job: MoveInJob | null; claimed: boolean }> {
  const started = ports.now();
  const token = await ports.store.claim(jobId, started);
  if (!token) return { job: await ports.store.loadJob(jobId), claimed: false };
  const cache: RunCache = {};
  try {
    for (;;) {
      const job = await runNextChunk(jobId, ports, { chunkSize, token, cache });
      if (!job || FINISHED.includes(job.status) || ports.now().getTime() - started.getTime() >= budgetMs) {
        await ports.store.release(jobId, token, true);
        return { job, claimed: true };
      }
    }
  } catch (error) {
    if (error instanceof LostClaimError) return { job: await ports.store.loadJob(jobId), claimed: false };
    // Otherwise an outage keeps hold of the job, so the next poll waits out the claim instead of spending an attempt.
    // A release that fails too leaves the claim to lapse on its own.
    if (releaseOnError) await ports.store.release(jobId, token).catch(() => undefined);
    throw error;
  }
}
