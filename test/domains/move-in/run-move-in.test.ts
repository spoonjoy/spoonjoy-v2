import { describe, expect, it } from "vitest";
import { bytesSource } from "~/domains/move-in/adapters/archive/zip";
import {
  LostClaimError,
  MAX_ATTEMPTS,
  runForAWhile,
  runNextChunk,
  type MoveInCounts,
  type MoveInEvent,
  type MoveInJob,
  type MoveInPorts,
} from "~/domains/move-in/application/run-move-in";
import type { RecipeDraft } from "~/domains/move-in/model/recipe-draft";
import { makeZip } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";

const { tables, keys } = mealieDatabase();
const photo = new Uint8Array([82, 73, 70, 70]);

function backup(json: unknown = tables) {
  return makeZip([
    { name: "database.json", data: JSON.stringify(json) },
    { name: `data/recipes/${keys.pancakes}/images/original.webp`, data: photo, store: true },
  ]);
}

function harness({ zip = backup(), email = "cook@example.com", write }: { zip?: Uint8Array; email?: string | null; write?: MoveInPorts["writeRecipe"] } = {}) {
  const jobs = new Map<string, MoveInJob>([["job-1", {
    id: "job-1", ownerId: "chef-1", kind: "mealie-backup", sourceId: null, status: "queued", phase: "inspect", cursor: null, archiveKey: "uploads/job-1.zip", lastError: null, attempt: 0,
  }]]);
  const counts = new Map<string, MoveInCounts>();
  const events: MoveInEvent[] = [];
  const sources: Array<Record<string, unknown>> = [];
  const written = new Map<string, string>();
  const photos: Array<{ recipeId: string; bytes: Uint8Array }> = [];
  const discarded: string[] = [];
  let holder: string | null = null;
  let tokens = 0;
  let opens = 0;
  const ports: MoveInPorts = {
    store: {
      loadJob: async (id) => jobs.get(id) ?? null,
      updateJob: async (id, patch, token) => {
        if (token !== undefined && token !== holder) throw new LostClaimError();
        jobs.set(id, { ...(jobs.get(id) as MoveInJob), ...patch });
      },
      resetCounts: async () => counts.clear(),
      sourceInstanceKey: async () => (sources.at(-1)?.instanceKey as string | undefined) ?? null,
      ensureSource: async (source) => (sources.push(source), "source-1"),
      addCounts: async (_jobId, entity, delta) => {
        const now = counts.get(entity) ?? { found: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
        counts.set(entity, Object.fromEntries(Object.entries(now).map(([key, value]) => [key, value + (delta[key as keyof MoveInCounts] ?? 0)])) as MoveInCounts);
      },
      addEvent: async (_jobId, event) => void events.push(event),
      hasIssues: async () => events.some((event) => event.level !== "info"),
      claim: async () => (holder ? null : (holder = `token-${++tokens}`)),
      release: async (_id, token) => void (holder === token && (holder = null)),
    },
    openArchive: () => (opens++, bytesSource(zip)),
    ownerEmail: async () => email,
    writeRecipe: write ?? (async ({ draft }: { draft: RecipeDraft }) => {
      const existing = written.get(draft.sourceKey);
      if (existing) return { outcome: "unchanged", recipeId: existing };
      written.set(draft.sourceKey, `spoonjoy-${draft.sourceKey}`);
      return { outcome: "created", recipeId: `spoonjoy-${draft.sourceKey}`, title: draft.title, warnings: draft.warnings };
    }),
    attachPhoto: async ({ recipeId, bytes }) => void photos.push({ recipeId, bytes }),
    hasMovedInPhoto: async (recipeId) => photos.some((photo) => photo.recipeId === recipeId),
    discardArchive: async (job) => void discarded.push(job.archiveKey as string),
    now: () => new Date("2026-11-23T12:00:00.000Z"),
  };
  const job = () => jobs.get("job-1") as MoveInJob;
  const runAll = async (chunkSize = 2) => {
    for (let i = 0; i < 20 && !["done", "done-with-issues", "failed"].includes(job().status); i++) await runNextChunk("job-1", ports, { chunkSize });
    return job();
  };
  return {
    ports, jobs, job, counts, events, sources, photos, discarded, written, runAll,
    isClaimed: () => holder !== null,
    steal: () => void (holder = "another-run"),
    opens: () => opens,
  };
}

describe("runNextChunk", () => {
  it("inspects the backup first and counts what it found before writing anything", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    expect(h.job()).toMatchObject({ status: "running", phase: "recipes", cursor: "0", sourceId: "source-1" });
    expect(h.sources).toEqual([{ ownerId: "chef-1", kind: "mealie-backup", instanceKey: keys.group, label: "Home", sourceVersion: "v3.31.0" }]);
    expect(h.counts.get("recipes")).toMatchObject({ found: 3, created: 0 });
    expect(h.counts.get("photos")).toMatchObject({ found: 1 });
    expect(h.counts.get("tags")).toMatchObject({ found: 1, skipped: 1 });
    expect(h.events[0]).toMatchObject({ kind: "phase-done", entity: null, message: "Found 3 recipes, 1 with a photo, in Home." });
    expect(h.photos).toEqual([]);
  });

  it("brings the recipes in chunks, with their photos, and finishes", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    await runNextChunk("job-1", h.ports, { chunkSize: 2 });
    expect(h.job()).toMatchObject({ phase: "recipes", cursor: "2" });
    expect(await h.runAll()).toMatchObject({ status: "done-with-issues", phase: "done", cursor: null });
    expect(h.counts.get("recipes")).toMatchObject({ found: 3, created: 3, failed: 0 });
    expect(h.counts.get("photos")).toMatchObject({ found: 1, created: 1 });
    expect(h.photos).toEqual([{ recipeId: `spoonjoy-${keys.pancakes}`, bytes: photo }]);
    expect(h.events.filter((event) => event.kind === "item-degraded").map((event) => event.message)).toEqual([
      "An ingredient line had no text, so it was left out.",
      "This recipe had no name, so it's called \"Untitled recipe\".",
    ]);
    expect(h.events.at(-1)).toMatchObject({ kind: "job-done", message: "3 recipes moved in." });
    expect(h.discarded).toEqual(["uploads/job-1.zip"]);
  });

  it("calls a move-in with nothing to note done", async () => {
    const clean = mealieDatabase().tables;
    clean.recipes = clean.recipes.slice(0, 1);
    for (const table of ["tags", "categories", "tools", "recipes_to_tags", "recipes_to_categories", "recipes_to_tools", "ingredient_foods", "ingredient_units"]) clean[table] = [];
    const h = harness({ zip: backup(clean) });
    expect(await h.runAll()).toMatchObject({ status: "done" });
  });

  it("adds nothing when the same backup moves in again", async () => {
    const h = harness();
    await h.runAll();
    h.jobs.set("job-1", { ...h.job(), status: "queued", phase: "inspect", cursor: null });
    h.counts.clear();
    await h.runAll();
    expect(h.counts.get("recipes")).toMatchObject({ found: 3, created: 0, unchanged: 3 });
    expect(h.photos).toHaveLength(1);
  });

  it("counts a recipe it leaves alone as skipped, with the reason", async () => {
    const h = harness({ write: async ({ draft }) => ({ outcome: "skipped", recipeId: `x-${draft.sourceKey}`, reason: "You deleted this recipe in Spoonjoy after it moved in." }) });
    await h.runAll();
    expect(h.counts.get("recipes")).toMatchObject({ skipped: 3 });
    expect(h.events.filter((event) => event.kind === "item-skipped" && event.entity === "recipes")).toHaveLength(3);
    expect(h.events.find((event) => event.entity === "tags")).toMatchObject({
      level: "warn",
      message: "Spoonjoy doesn't have tags, categories or tools yet, so 1 tag, 1 category, 1 tool stayed in the backup.",
    });
  });

  it("counts a recipe that fails, reports it and carries on", async () => {
    const h = harness({ write: async ({ draft }) => { if (draft.title === "Soup") throw new Error("D1 said no"); return { outcome: "created", recipeId: "r", title: draft.title, warnings: [] }; } });
    expect(await h.runAll()).toMatchObject({ status: "done-with-issues" });
    expect(h.counts.get("recipes")).toMatchObject({ created: 2, failed: 1 });
    expect(h.events.find((event) => event.kind === "item-failed")).toMatchObject({
      message: "Soup didn't move in this time. Moving the same backup in again tries it once more.",
      detail: "D1 said no",
      level: "error",
    });
  });

  it("stops with the fix-it message when the file is not a backup", async () => {
    const h = harness({ zip: new TextEncoder().encode("this is not a zip file at all") });
    expect(await h.runAll()).toMatchObject({ status: "failed", lastError: "broken-zip" });
    expect(h.events.at(-1)).toMatchObject({ level: "error", kind: "job-failed" });
    expect(h.discarded).toEqual(["uploads/job-1.zip"]);
  });

  it("finishes even when the upload can't be deleted", async () => {
    const h = harness();
    h.ports.discardArchive = () => Promise.reject(new Error("R2 is down"));
    expect(await h.runAll()).toMatchObject({ status: "done-with-issues", phase: "done" });
  });

  it("asks which kitchen when the backup holds several and the email matches none", async () => {
    const h = harness({ email: null });
    expect(await h.runAll()).toMatchObject({ status: "failed", lastError: "pick-a-group" });
  });

  it("does nothing for a job that is finished or missing", async () => {
    const h = harness();
    await h.runAll();
    const events = h.events.length;
    expect(await runNextChunk("job-1", h.ports)).toMatchObject({ status: "done-with-issues" });
    expect(await runNextChunk("nope", h.ports)).toBeNull();
    expect(h.events).toHaveLength(events);
  });

  it("moves a recipe in without its photo when the photo can't be stored, and says why", async () => {
    const h = harness();
    h.ports.attachPhoto = () => Promise.reject(new Error("the photo store is full"));
    await h.runAll();
    expect(h.counts.get("photos")).toMatchObject({ found: 1, created: 0, failed: 1 });
    expect(h.events.find((event) => event.entity === "photos")).toMatchObject({
      level: "warn",
      message: "Pancakes moved in without its photo: the photo store is full.",
      targetId: `spoonjoy-${keys.pancakes}`,
    });
  });

  it("says so when the photo in the backup is damaged", async () => {
    const zip = makeZip([
      { name: "database.json", data: JSON.stringify(tables) },
      { name: `data/recipes/${keys.pancakes}/images/original.webp`, data: "x", method: 12 },
    ]);
    const h = harness({ zip });
    await h.runAll();
    expect(h.events.find((event) => event.entity === "photos")?.message).toBe("Pancakes moved in without its photo: the photo in the backup is damaged.");
  });

  it("moves the cursor past each recipe, so a stop mid-chunk repeats only the recipe it stopped on", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    const addCounts = h.ports.store.addCounts;
    let created = 0;
    h.ports.store.addCounts = async (jobId, entity, delta) => {
      if (delta.created && entity === "recipes" && ++created === 2) throw new Error("the Worker stopped");
      return addCounts(jobId, entity, delta);
    };
    await expect(runNextChunk("job-1", h.ports, { chunkSize: 3 })).rejects.toThrow("the Worker stopped");
    expect(h.job()).toMatchObject({ phase: "recipes", cursor: "1" });
  });

  it("brings the photo of a recipe that moved in before without it", async () => {
    const h = harness();
    h.written.set(keys.pancakes, "already-here");
    await h.runAll();
    expect(h.photos).toEqual([{ recipeId: "already-here", bytes: photo }]);
    expect(h.counts.get("photos")).toMatchObject({ found: 1, created: 1, unchanged: 0 });
  });

  it("counts afresh when the inspect phase runs again", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    h.jobs.set("job-1", { ...h.job(), phase: "inspect" });
    await runNextChunk("job-1", h.ports);
    expect(h.counts.get("recipes")).toMatchObject({ found: 3 });
  });

  it("keeps to the kitchen it chose when it started", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    h.ports.ownerEmail = async () => null;
    expect(await h.runAll()).toMatchObject({ status: "done-with-issues" });
  });

  it("stops for good after the same outage stops it again and again", async () => {
    const h = harness();
    h.ports.openArchive = () => Promise.reject(new Error("blob store down"));
    for (let i = 1; i < MAX_ATTEMPTS; i++) await expect(runNextChunk("job-1", h.ports)).rejects.toThrow("blob store down");
    expect(await runNextChunk("job-1", h.ports)).toMatchObject({ status: "failed", lastError: "stuck" });
    expect(h.events.at(-1)?.message).toMatch(/^The move-in hit the same problem/);
  });

  it("starts counting outages again once a recipe moves in", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    h.jobs.set("job-1", { ...h.job(), attempt: MAX_ATTEMPTS - 1 });
    await runNextChunk("job-1", h.ports, { chunkSize: 1 });
    expect(h.job()).toMatchObject({ attempt: 0, cursor: "1" });
  });

  it("passes on an outage so the next chunk tries again", async () => {
    const h = harness();
    h.ports.openArchive = () => ({ size: 100, read: () => Promise.reject(new Error("blob store down")) });
    await expect(runNextChunk("job-1", h.ports)).rejects.toThrow("blob store down");
    expect(h.job()).toMatchObject({ status: "running", phase: "inspect" });
  });
});

describe("runForAWhile", () => {
  it("runs chunks until the move-in finishes", async () => {
    const h = harness();
    h.ports.openArchive = async () => bytesSource(backup());
    expect(await runForAWhile("job-1", h.ports, { budgetMs: 60_000, chunkSize: 1 })).toMatchObject({ status: "done-with-issues" });
  });

  it("stops when its time is up and leaves the job to resume", async () => {
    const h = harness();
    let ms = 0;
    h.ports.now = () => new Date((ms += 1000));
    expect(await runForAWhile("job-1", h.ports, { budgetMs: 2500, chunkSize: 1 })).toMatchObject({ status: "running", phase: "recipes", cursor: "2" });
  });

  it("returns null for a job that isn't there", async () => {
    expect(await runForAWhile("nope", harness().ports, { budgetMs: 1000 })).toBeNull();
  });

  it("leaves a job another run is working on alone, and lets it go when done", async () => {
    const h = harness();
    const token = await h.ports.store.claim("job-1", new Date());
    expect(await runForAWhile("job-1", h.ports, { budgetMs: 1000 })).toMatchObject({ status: "queued", phase: "inspect" });
    await h.ports.store.release("job-1", token as string);
    await runForAWhile("job-1", h.ports, { budgetMs: 60_000 });
    expect(h.isClaimed()).toBe(false);
  });

  it("reads the backup once for all the chunks of a run", async () => {
    const h = harness();
    await runForAWhile("job-1", h.ports, { budgetMs: 60_000, chunkSize: 1 });
    expect(h.opens()).toBe(1);
  });

  it("stops writing as soon as another run has taken the job", async () => {
    const h = harness();
    const write = h.ports.writeRecipe;
    h.ports.writeRecipe = async (input) => (h.steal(), write(input));
    expect(await runForAWhile("job-1", h.ports, { budgetMs: 60_000, chunkSize: 1 })).toMatchObject({ phase: "recipes", cursor: "0" });
    expect(h.isClaimed()).toBe(true);
  });

  it("lets the job go when a chunk fails", async () => {
    const h = harness();
    h.ports.openArchive = () => Promise.reject(new Error("blob store down"));
    await expect(runForAWhile("job-1", h.ports, { budgetMs: 1000 })).rejects.toThrow("blob store down");
    expect(h.isClaimed()).toBe(false);
  });
});

