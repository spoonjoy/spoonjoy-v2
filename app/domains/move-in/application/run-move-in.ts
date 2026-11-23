// Runs a move-in a chunk at a time. Each call loads the job, does one bounded piece of work and
// saves where it got to, so a Worker that stops mid-way loses at most one chunk: the next call
// picks up from the cursor, and the SourceRecord rows make a repeated recipe a no-op. The ports
// keep this free of D1, R2 and the request.
import type { RangeSource } from "../adapters/archive/zip";
import { openMealieBackup, type MealieBackup } from "../adapters/sources/mealie-backup/backup";
import { chooseGroup, inspectGroup, listGroups, recipeDrafts } from "../adapters/sources/mealie-backup/database";
import { MOVE_IN_ERROR_MESSAGES, MoveInError } from "../model/move-in-error";
import type { RecipeDraft } from "../model/recipe-draft";

export type MoveInStatus = "queued" | "running" | "done" | "done-with-issues" | "failed";
export type MoveInPhase = "inspect" | "recipes" | "done";
export const FINISHED: readonly MoveInStatus[] = ["done", "done-with-issues", "failed"];

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
  kind: "phase-done" | "item-degraded" | "item-skipped" | "item-failed" | "job-done" | "job-failed";
  entity: string | null;
  sourceKey: string | null;
  targetId: string | null;
  message: string;
}

export type RecipeWriteResult =
  | { outcome: "created"; recipeId: string; title: string; warnings: string[] }
  | { outcome: "unchanged"; recipeId: string }
  | { outcome: "skipped"; recipeId: string; reason: string };

export interface MoveInPorts {
  store: {
    loadJob(id: string): Promise<MoveInJob | null>;
    updateJob(id: string, patch: Partial<MoveInJob>): Promise<void>;
    ensureSource(source: { ownerId: string; kind: string; instanceKey: string; label: string; sourceVersion: string }): Promise<string>;
    addCounts(jobId: string, entity: string, delta: Partial<MoveInCounts>): Promise<void>;
    addEvent(jobId: string, event: MoveInEvent): Promise<void>;
    /** Whether the job has logged a warning or an error. */
    hasIssues(jobId: string): Promise<boolean>;
  };
  openArchive(job: MoveInJob): RangeSource | Promise<RangeSource>;
  ownerEmail(ownerId: string): Promise<string | null>;
  writeRecipe(input: { sourceId: string; jobId: string; chefId: string; draft: RecipeDraft }): Promise<RecipeWriteResult>;
  attachPhoto(input: { ownerId: string; recipeId: string; bytes: Uint8Array }): Promise<void>;
  /** Deletes the uploaded backup; it holds the other app's accounts, so it is kept no longer than the job needs it. */
  discardArchive(job: MoveInJob): Promise<void>;
  now(): Date;
}

export const DEFAULT_CHUNK_SIZE = 10;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function event(kind: MoveInEvent["kind"], message: string, more: Partial<MoveInEvent> = {}): MoveInEvent {
  const level = kind === "item-failed" || kind === "job-failed" ? "error" : kind.startsWith("item-") ? "warn" : "info";
  return { level, kind, entity: null, sourceKey: null, targetId: null, message, ...more };
}

interface Opened {
  backup: MealieBackup;
  groupKey: string;
  drafts: RecipeDraft[];
}

async function open(job: MoveInJob, ports: MoveInPorts): Promise<Opened> {
  const backup = await openMealieBackup(await ports.openArchive(job));
  const groupKey = chooseGroup(backup.database, await ports.ownerEmail(job.ownerId));
  if (!groupKey) throw new MoveInError("pick-a-group");
  return { backup, groupKey, drafts: recipeDrafts(backup.database, groupKey) };
}

async function inspect(job: MoveInJob, ports: MoveInPorts, { backup, groupKey, drafts }: Opened) {
  const { store } = ports;
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
  await store.addCounts(job.id, "recipes", { found: drafts.length });
  await store.addCounts(job.id, "photos", { found: photos });
  // Spoonjoy has no tags, categories or tools yet; they are counted, and left for a later move-in.
  const waiting = [["tags", counted.tags, "tag"], ["categories", counted.categories, "category"], ["tools", counted.tools, "tool"]] as const;
  for (const [entity, found] of waiting) if (found) await store.addCounts(job.id, entity, { found, skipped: found });
  const left = waiting.filter(([, found]) => found).map(([, found, one]) => plural(found, one, one === "category" ? "categories" : `${one}s`));
  await store.addEvent(job.id, event("phase-done", `Found ${plural(drafts.length, "recipe")}, ${photos} with a photo, in ${group.name}.`));
  if (left.length) {
    await store.addEvent(job.id, event("item-skipped", `Spoonjoy doesn't have tags, categories or tools yet, so ${left.join(", ")} stayed in the backup.`, { entity: "tags" }));
  }
  await store.updateJob(job.id, { status: "running", phase: "recipes", cursor: "0", sourceId });
}

async function bringPhoto(job: MoveInJob, ports: MoveInPorts, backup: MealieBackup, draft: RecipeDraft, recipeId: string) {
  const { store } = ports;
  // A damaged photo loses only the photo, never the job.
  const bytes = await backup.readFile(draft.photoPath).catch(() => null);
  try {
    if (!bytes) throw new Error("the photo in the backup is damaged");
    await ports.attachPhoto({ ownerId: job.ownerId, recipeId, bytes });
    await store.addCounts(job.id, "photos", { created: 1 });
  } catch (error) {
    await store.addCounts(job.id, "photos", { failed: 1 });
    await store.addEvent(job.id, event("item-degraded", `${draft.title} moved in without its photo: ${(error as Error).message}.`, { entity: "photos", sourceKey: draft.sourceKey, targetId: recipeId }));
  }
}

async function bringRecipe(job: MoveInJob, ports: MoveInPorts, backup: MealieBackup, draft: RecipeDraft) {
  const { store } = ports;
  const at = { entity: "recipes", sourceKey: draft.sourceKey };
  const hasPhoto = backup.hasFile(draft.photoPath);
  let result: RecipeWriteResult;
  try {
    result = await ports.writeRecipe({ sourceId: job.sourceId as string, jobId: job.id, chefId: job.ownerId, draft });
  } catch (error) {
    await store.addCounts(job.id, "recipes", { failed: 1 });
    await store.addEvent(job.id, event("item-failed", `${draft.title} didn't move in: ${(error as Error).message}`, at));
    return;
  }
  const target = { ...at, targetId: result.recipeId };
  if (result.outcome === "skipped") {
    await store.addCounts(job.id, "recipes", { skipped: 1 });
    await store.addEvent(job.id, event("item-skipped", result.reason, target));
    return;
  }
  if (result.outcome === "unchanged") {
    await store.addCounts(job.id, "recipes", { unchanged: 1 });
    if (hasPhoto) await store.addCounts(job.id, "photos", { unchanged: 1 });
    return;
  }
  await store.addCounts(job.id, "recipes", { created: 1 });
  for (const warning of result.warnings) await store.addEvent(job.id, event("item-degraded", warning, target));
  if (hasPhoto) await bringPhoto(job, ports, backup, draft, result.recipeId);
}

async function recipes(job: MoveInJob, ports: MoveInPorts, { backup, drafts }: Opened, chunkSize: number) {
  const { store } = ports;
  const start = Number(job.cursor);
  for (const draft of drafts.slice(start, start + chunkSize)) await bringRecipe(job, ports, backup, draft);
  const next = start + chunkSize;
  if (next < drafts.length) {
    await store.updateJob(job.id, { cursor: String(next) });
    return;
  }
  const status = (await store.hasIssues(job.id)) ? "done-with-issues" : "done";
  await store.addEvent(job.id, event("job-done", `${plural(drafts.length, "recipe")} moved in.`));
  await store.updateJob(job.id, { status, phase: "done", cursor: null });
  await discard(job, ports);
}

// A backup left behind is swept with other unused uploads, so a failed delete never holds the job up.
async function discard(job: MoveInJob, ports: MoveInPorts) {
  await ports.discardArchive(job).catch(() => undefined);
}

/** Does the job's next piece of work and returns the job as it then stands, or null when there is no such job. */
export async function runNextChunk(jobId: string, ports: MoveInPorts, { chunkSize = DEFAULT_CHUNK_SIZE } = {}): Promise<MoveInJob | null> {
  const { store } = ports;
  const job = await store.loadJob(jobId);
  if (!job || FINISHED.includes(job.status)) return job;
  if (job.status === "queued") await store.updateJob(job.id, { status: "running" });
  try {
    const opened = await open(job, ports);
    if (job.phase === "inspect") await inspect(job, ports, opened);
    else await recipes(job, ports, opened, chunkSize);
  } catch (error) {
    if (!(error instanceof MoveInError)) throw error;
    await store.addEvent(job.id, event("job-failed", MOVE_IN_ERROR_MESSAGES[error.code]));
    await store.updateJob(job.id, { status: "failed", lastError: error.code });
    await discard(job, ports);
  }
  return store.loadJob(jobId);
}

/**
 * Runs chunks until the job finishes or `budgetMs` has passed, checked after each chunk, and returns the job as it
 * then stands. A Worker gives a request's waitUntil about 30 seconds, so the budget stays well inside that.
 */
export async function runForAWhile(jobId: string, ports: MoveInPorts, { budgetMs, chunkSize }: { budgetMs: number; chunkSize?: number }): Promise<MoveInJob | null> {
  const started = ports.now().getTime();
  for (;;) {
    const job = await runNextChunk(jobId, ports, { chunkSize });
    if (!job || FINISHED.includes(job.status) || ports.now().getTime() - started >= budgetMs) return job;
  }
}
