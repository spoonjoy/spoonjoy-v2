// Runs a move-in a piece at a time. Each recipe's counts and report lines are saved with the cursor
// in one write, so a Worker that stops mid-way repeats at most the recipe it stopped on, and the
// SourceRecord rows make that repeat a no-op that still counts as this job's. Only the run that
// holds the job's claim may write it, and every claim counts as an attempt until the job moves
// forward, so a job whose runs keep dying ends. The ports keep this free of D1, R2 and the request.
import type { RangeSource } from "../adapters/archive/zip";
import { openMealieBackup, type MealieBackup } from "../adapters/sources/mealie-backup/backup";
import { chooseGroup, inspectGroup, listGroups, recipeDrafts } from "../adapters/sources/mealie-backup/database";
import { MOVE_IN_ERROR_MESSAGES, MoveInError } from "../model/move-in-error";
import type { RecipeDraft } from "../model/recipe-draft";

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
    ensureSource(source: { ownerId: string; kind: string; instanceKey: string; label: string; sourceVersion: string }): Promise<string>;
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
    /** Lets the job go, if this run still holds it, so the next run can take it at once. */
    release(jobId: string, token: string): Promise<void>;
  };
  openArchive(job: MoveInJob): RangeSource | Promise<RangeSource>;
  ownerEmail(ownerId: string): Promise<string | null>;
  writeRecipe(input: { sourceId: string; jobId: string; chefId: string; draft: RecipeDraft }): Promise<RecipeWriteResult>;
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
  backup: MealieBackup;
  groupKey: string;
  drafts: RecipeDraft[];
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
  const backup = await openMealieBackup(await ports.openArchive(job));
  // Once inspect has chosen the kitchen, the job keeps to it.
  const groupKey = job.sourceId
    ? await ports.store.sourceInstanceKey(job.sourceId)
    : chooseGroup(backup.database, await ports.ownerEmail(job.ownerId));
  if (!groupKey) throw new MoveInError("pick-a-group");
  cache.opened = { backup, groupKey, drafts: recipeDrafts(backup.database, groupKey) };
  return cache.opened;
}

async function inspect(run: Run, { backup, groupKey, drafts }: Opened) {
  const { job, ports: { store } } = run;
  const group = listGroups(backup.database).find((candidate) => candidate.key === groupKey) as { name: string };
  const sourceId = await store.ensureSource({
    ownerId: job.ownerId,
    kind: job.kind,
    instanceKey: groupKey,
    label: group.name,
    sourceVersion: backup.database.version.label,
  });
  const counted = inspectGroup(backup.database, groupKey);
  const photos = drafts.filter((draft) => backup.hasFile(draft.photoPath)).length;
  // A cook with organizers gets the tags, categories and tools on each recipe as it moves in; for anyone else they are
  // counted, and left for a later move-in. The choice is made here, once: the recipes follow what these counts say.
  const organizing = run.ports.organizers?.on(job.ownerId) ?? false;
  const waiting = [["tags", counted.tags, "tag"], ["categories", counted.categories, "category"], ["tools", counted.tools, "tool"]] as const;
  const left = waiting.filter(([, found]) => found).map(([, found, one]) => plural(found, one, one === "category" ? "categories" : `${one}s`));
  const report: MoveInReport = {
    // An inspect that runs again (after a stop before it saved) starts the report from nothing.
    restart: true,
    counts: [
      ["recipes", { found: drafts.length }],
      ["photos", { found: photos }],
      ...waiting.filter(([, found]) => found).map(([entity, found]) => [entity, organizing ? { found } : { found, skipped: found }] as [string, Partial<MoveInCounts>]),
    ],
    events: [
      event("phase-done", `Found ${plural(drafts.length, "recipe")}, ${photos} with a photo, in ${group.name}.`),
      ...(left.length && !organizing ? [event("item-skipped", `Spoonjoy doesn't have tags, categories or tools yet, so ${left.join(", ")} stayed in the backup.`, { entity: "tags" })] : []),
    ],
  };
  await store.updateJob(job.id, { status: "running", phase: "recipes", cursor: "0", sourceId, attempt: 0 }, run.token, report);
}

/** Brings the recipe's photo, adding what happened to the report. */
type Report = Required<Pick<MoveInReport, "counts" | "events">>;

async function bringPhoto({ job, ports }: Run, backup: MealieBackup, draft: RecipeDraft, recipeId: string, report: Report) {
  // A damaged photo loses only the photo, never the job.
  const bytes = await backup.readFile(draft.photoPath).catch(() => null);
  try {
    if (!bytes) throw new Error("the photo in the backup is damaged");
    await ports.attachPhoto({ ownerId: job.ownerId, recipeId, bytes });
    report.counts.push(["photos", { created: 1 }]);
  } catch (error) {
    report.counts.push(["photos", { failed: 1 }]);
    report.events.push(event("item-degraded", `${draft.title} moved in without its photo: ${(error as Error).message}.`, { entity: "photos", sourceKey: draft.sourceKey, targetId: recipeId }));
  }
}

/** Puts the recipe's tags, categories and tools on it, when inspect chose to bring them; if that fails, the recipe stays and says so. */
async function bringOrganizers({ job, organizers }: Run, draft: RecipeDraft, recipeId: string, report: Report) {
  const { tags, categories, tools } = draft;
  if (!organizers || !(tags.length || categories.length || tools.length)) return;
  try {
    await organizers.attach({ ownerId: job.ownerId, recipeId, sourceId: job.sourceId as string, jobId: job.id, tags, categories, tools });
  } catch (error) {
    const message = `${draft.title} moved in without some of its tags, categories and tools. Moving the same backup in again adds them.`;
    report.events.push(event("item-degraded", message, { entity: "recipes", sourceKey: draft.sourceKey, targetId: recipeId, detail: describeError(error) }));
  }
}

/** Brings one recipe, its photo and its organizers, and returns what to report; writes nothing to the job itself. */
async function bringRecipe(run: Run, backup: MealieBackup, draft: RecipeDraft): Promise<Report> {
  const { job, ports } = run;
  const report: Report = { counts: [], events: [] };
  const at = { entity: "recipes", sourceKey: draft.sourceKey };
  const hasPhoto = backup.hasFile(draft.photoPath);
  // An error here is passed on, for bringOrPassOver to try the recipe again or pass it over.
  const result: RecipeWriteResult = await ports.writeRecipe({ sourceId: job.sourceId as string, jobId: job.id, chefId: job.ownerId, draft });
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
    await bringOrganizers(run, draft, result.recipeId, report);
    if (!hasPhoto) return report;
    // A run that stopped between the recipe and its photo left the photo out; bring it now.
    if (await ports.hasMovedInPhoto(result.recipeId)) report.counts.push(["photos", ours ? { created: 1 } : { unchanged: 1 }]);
    else await bringPhoto(run, backup, draft, result.recipeId, report);
    return report;
  }
  report.counts.push(["recipes", { created: 1 }]);
  if (result.renamedFrom) {
    report.events.push(event("item-renamed", `You already had a recipe called "${result.renamedFrom}", so this one is "${result.title}".`, target));
  }
  for (const warning of result.warnings) report.events.push(event("item-degraded", warning, target));
  await bringOrganizers(run, draft, result.recipeId, report);
  if (hasPhoto) await bringPhoto(run, backup, draft, result.recipeId, report);
  return report;
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
async function bringOrPassOver(run: Run, backup: MealieBackup, draft: RecipeDraft): Promise<Report> {
  let failure: unknown;
  for (let tries = 0; tries < 2; tries++) {
    try {
      return await bringRecipe(run, backup, draft);
    } catch (error) {
      failure = error;
    }
  }
  // A database that can't be reached throws here, and the segment goes back to the queue with the recipe still next.
  await run.ports.store.loadJob(run.job.id);
  return {
    counts: [["recipes", { failed: 1 }]],
    events: [event("item-failed", `${draft.title} didn't move in this time. Moving the same backup in again tries it once more.`, {
      entity: "recipes",
      sourceKey: draft.sourceKey,
      detail: describeError(failure),
    })],
  };
}

async function recipes(run: Run, { backup, drafts }: Opened, chunkSize: number, cache: RunCache) {
  const { job, ports } = run;
  const { store } = ports;
  if (ports.organizers && (cache.organizing ??= await store.organizing(job.id))) run.organizers = ports.organizers;
  let start = Number(job.cursor);
  // The recipe at the cursor has stopped every run since the job last moved, whether it threw or took the Worker down:
  // report it and move past it, so it never holds the rest back.
  if (job.attempt >= RECIPE_TRIES && start < drafts.length) {
    const draft = drafts[start];
    await store.updateJob(job.id, { cursor: String(++start), attempt: 0 }, run.token, {
      counts: [["recipes", { failed: 1 }]],
      events: [event("item-failed", `${draft.title} didn't move in this time. Moving the same backup in again tries it once more.`, {
        entity: "recipes",
        sourceKey: draft.sourceKey,
        detail: `It stopped the move-in ${RECIPE_TRIES} times in a row.`,
      })],
    });
    job.attempt = 0;
  }
  const end = Math.min(start + chunkSize, drafts.length);
  for (let i = start; i < end; i++) {
    const report = await bringOrPassOver(run, backup, drafts[i]);
    await store.updateJob(job.id, { cursor: String(i + 1), attempt: 0 }, run.token, report);
    job.attempt = 0;
  }
  if (end < drafts.length) return;
  const status = (await store.hasIssues(job.id)) ? "done-with-issues" : "done";
  await store.updateJob(job.id, { status, phase: "done", cursor: null }, run.token, { events: [event("job-done", `${plural(drafts.length, "recipe")} moved in.`)] });
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
  if (job.attempt > MAX_ATTEMPTS) {
    await fail(run, "stuck");
    return store.loadJob(jobId);
  }
  if (job.status === "queued") await store.updateJob(job.id, { status: "running" }, token);
  try {
    const opened = await open(run, cache);
    if (job.phase === "inspect") await inspect(run, opened);
    else await recipes(run, opened, chunkSize, cache);
  } catch (error) {
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
        await ports.store.release(jobId, token);
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
