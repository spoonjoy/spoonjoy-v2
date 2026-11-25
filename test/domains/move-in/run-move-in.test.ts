import { describe, expect, it, vi } from "vitest";
import { bytesSource } from "~/domains/move-in/adapters/archive/zip";
import {
  LostClaimError,
  MAX_ATTEMPTS,
  RECIPE_TRIES,
  runForAWhile,
  runMoveInSegment,
  runNextChunk,
  type MoveInCounts,
  type MoveInEvent,
  type MoveInJob,
  type MoveInPorts,
  type RecipeWriteInput,
  type RecipeWriteResult,
} from "~/domains/move-in/application/run-move-in";
import { openMealieBackup } from "~/domains/move-in/adapters/sources/mealie-backup/backup";
import { mealieBackupSource } from "~/domains/move-in/adapters/sources/mealie-backup/source";
import { mealieApiSource } from "~/domains/move-in/adapters/sources/mealie-api/source";
import { SourceUnavailableError, type MoveInKitchen } from "~/domains/move-in/application/source";
import { MoveInError } from "~/domains/move-in/model/move-in-error";
import type { RecipeDraft } from "~/domains/move-in/model/recipe-draft";
import { makeZip } from "./support/make-zip";
import { guid, mealieDatabase } from "./support/mealie-database";

const { tables, keys } = mealieDatabase();
const photo = new Uint8Array([82, 73, 70, 70]);

function backup(json: unknown = tables) {
  return makeZip([
    { name: "database.json", data: JSON.stringify(json) },
    { name: `data/recipes/${keys.pancakes}/images/original.webp`, data: photo, store: true },
  ]);
}

type Organized = Parameters<NonNullable<MoveInPorts["organizers"]>["attach"]>[0];

function harness({ zip = backup(), email = "cook@example.com", write, writeMany, organizers }: {
  zip?: Uint8Array;
  email?: string | null;
  write?: MoveInPorts["writeRecipe"];
  /** A chunk writer: true for one that writes each recipe as writeRecipe would; left out, the Worker writes each alone. */
  writeMany?: true | ((inputs: RecipeWriteInput[], one: MoveInPorts["writeRecipe"]) => Promise<Array<RecipeWriteResult | null>>);
  /** Whether the cook has organizers, and how putting them on a recipe goes; left out, the Worker has no organizers port. */
  organizers?: { on: boolean; attach?: (input: Organized) => Promise<void> };
} = {}) {
  const jobs = new Map<string, MoveInJob>([["job-1", {
    id: "job-1", ownerId: "chef-1", kind: "mealie-backup", sourceId: null, status: "queued", phase: "inspect", cursor: null, archiveKey: "uploads/job-1.zip", lastError: null, attempt: 0,
  }]]);
  const counts = new Map<string, MoveInCounts>();
  const events: MoveInEvent[] = [];
  const sources: Array<Record<string, unknown>> = [];
  // Each recipe written, by source key: its Spoonjoy id and the job that wrote it.
  const written = new Map<string, { recipeId: string; jobId: string }>();
  const photos: Array<{ recipeId: string; bytes: Uint8Array }> = [];
  const discarded: string[] = [];
  const organized: Organized[] = [];
  // Each chunk write, as the source keys it was given.
  const chunkWrites: string[][] = [];
  let holder: string | null = null;
  let tokens = 0;
  let opens = 0;
  const add = (entity: string, delta: Partial<MoveInCounts>) => {
    const now = counts.get(entity) ?? { found: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
    counts.set(entity, Object.fromEntries(Object.entries(now).map(([key, value]) => [key, value + (delta[key as keyof MoveInCounts] ?? 0)])) as MoveInCounts);
  };
  const ports: MoveInPorts = {
    store: {
      loadJob: async (id) => (jobs.has(id) ? { ...(jobs.get(id) as MoveInJob) } : null),
      updateJob: async (id, patch, token, report = {}) => {
        const job = jobs.get(id) as MoveInJob;
        const lost = (token !== undefined && token !== holder) || ["done", "done-with-issues", "failed"].includes(job.status);
        if (lost) {
          if (token !== undefined) throw new LostClaimError();
          return 0;
        }
        if (report.restart) {
          counts.clear();
          events.length = 0;
        }
        for (const [entity, delta] of report.counts ?? []) add(entity, delta);
        events.push(...(report.events ?? []));
        jobs.set(id, { ...job, ...patch });
        return 1;
      },
      forgiveAttempt: async (id, token) => void (token === holder && jobs.set(id, { ...(jobs.get(id) as MoveInJob), attempt: Math.max((jobs.get(id) as MoveInJob).attempt - 1, 0) })),
      sourceInstanceKey: async () => (sources.at(-1)?.instanceKey as string | undefined) ?? null,
      ensureSource: async (source) => (sources.push(source), "source-1"),
      hasIssues: async () => events.some((event) => event.level !== "info"),
      organizing: async () => ["tags", "categories", "tools"].some((entity) => {
        const count = counts.get(entity);
        return count !== undefined && count.found > 0 && count.skipped === 0;
      }),
      claim: async (id) => {
        if (holder) return null;
        const job = jobs.get(id);
        if (job) jobs.set(id, { ...job, attempt: job.attempt + 1 });
        return (holder = `token-${++tokens}`);
      },
      release: async (id, token, endedWell) => {
        if (holder !== token) return;
        holder = null;
        if (endedWell) jobs.set(id, { ...(jobs.get(id) as MoveInJob), attempt: 0 });
      },
    },
    openArchive: () => (opens++, bytesSource(zip)),
    ownerEmail: async () => email,
    writeRecipe: write ?? (async ({ draft, jobId }: { draft: RecipeDraft; jobId: string }) => {
      const existing = written.get(draft.sourceKey);
      if (existing) return { outcome: "unchanged", ...existing };
      written.set(draft.sourceKey, { recipeId: `spoonjoy-${draft.sourceKey}`, jobId });
      return { outcome: "created", recipeId: `spoonjoy-${draft.sourceKey}`, title: draft.title, warnings: draft.warnings };
    }),
    ...(writeMany ? {
      writeRecipes: async (inputs: RecipeWriteInput[]) => {
        chunkWrites.push(inputs.map((input) => input.draft.sourceKey));
        return writeMany === true ? Promise.all(inputs.map((input) => ports.writeRecipe(input))) : writeMany(inputs, ports.writeRecipe);
      },
    } : {}),
    attachPhoto: async ({ recipeId, bytes }) => void photos.push({ recipeId, bytes }),
    hasMovedInPhoto: async (recipeId) => photos.some((photo) => photo.recipeId === recipeId),
    discardArchive: async (job) => void discarded.push(job.archiveKey as string),
    now: () => new Date("2026-11-23T12:00:00.000Z"),
    ...(organizers ? {
      organizers: {
        on: (ownerId: string) => ownerId === "chef-1" && organizers.on,
        attach: organizers.attach ?? (async (input: Organized) => void organized.push(input)),
      },
    } : {}),
  };
  const job = () => jobs.get("job-1") as MoveInJob;
  /** Runs chunks as the page's polls would: each takes the job (an attempt) and an outage waits for the next. */
  const runAll = async (chunkSize = 2) => {
    for (let i = 0; i < 30 && !["done", "done-with-issues", "failed"].includes(job().status); i++) {
      jobs.set("job-1", { ...job(), attempt: job().attempt + 1 });
      await runNextChunk("job-1", ports, { chunkSize }).catch(() => undefined);
    }
    return job();
  };
  return {
    ports, jobs, job, counts, events, sources, photos, discarded, written, organized, chunkWrites, runAll,
    isClaimed: () => holder !== null,
    steal: () => void (holder = "another-run"),
    /** The claim's time runs out, as if a while had passed. */
    expire: () => void (holder = null),
    opens: () => opens,
  };
}

describe("runNextChunk", () => {
  it("inspects the backup first and counts what it found before writing anything", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    expect(h.job()).toMatchObject({ status: "running", phase: "recipes", cursor: "0", sourceId: "source-1" });
    expect(h.sources).toEqual([{ ownerId: "chef-1", kind: "mealie-backup", instanceKey: keys.group, label: "Home", serverUrl: null, sourceVersion: "v3.31.0" }]);
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
    // A second job: the recipes are another job's now.
    for (const [key, record] of h.written) h.written.set(key, { ...record, jobId: "job-0" });
    h.jobs.set("job-1", { ...h.job(), status: "queued", phase: "inspect", cursor: null });
    await h.runAll();
    expect(h.counts.get("recipes")).toMatchObject({ found: 3, created: 0, unchanged: 3 });
    expect(h.counts.get("photos")).toMatchObject({ found: 1, created: 0, unchanged: 1 });
    expect(h.photos).toHaveLength(1);
  });

  it("counts what it brought before a stop as its own when it runs the recipes again", async () => {
    const h = harness();
    await h.runAll();
    // The same job, back at its first recipe, as after a stop before its saves.
    h.jobs.set("job-1", { ...h.job(), status: "running", phase: "recipes", cursor: "0" });
    for (const entity of ["recipes", "photos"]) h.counts.set(entity, { ...(h.counts.get(entity) as never), created: 0, unchanged: 0 });
    await h.runAll();
    expect(h.counts.get("recipes")).toMatchObject({ created: 3, unchanged: 0 });
    expect(h.counts.get("photos")).toMatchObject({ created: 1, unchanged: 0 });
    expect(h.photos).toHaveLength(1);
  });

  it("counts a recipe the backup changed as updated, and brings a photo it lacks", async () => {
    const h = harness({ write: async ({ draft }) => ({ outcome: "updated", recipeId: `x-${draft.sourceKey}` }) });
    await h.runAll();
    expect(h.counts.get("recipes")).toMatchObject({ found: 3, created: 0, updated: 3 });
    expect(h.counts.get("photos")).toMatchObject({ created: 1 });
    expect(h.photos).toHaveLength(1);
  });

  it("counts a recipe whose cook's version stays as already here, with the reason", async () => {
    const h = harness({ write: async ({ draft }) => ({ outcome: "kept", recipeId: `x-${draft.sourceKey}`, reason: `${draft.title} stays yours.` }) });
    await h.runAll();
    expect(h.counts.get("recipes")).toMatchObject({ unchanged: 3, updated: 0 });
    expect(h.events.filter((event) => event.kind === "item-kept")).toHaveLength(3);
    expect(h.events.find((event) => event.kind === "item-kept")).toMatchObject({ level: "info", entity: "recipes", message: expect.stringMatching(/ stays yours\.$/) });
  });

  it("reports a recipe that got a number on its own, apart from other notes", async () => {
    const h = harness({ write: async ({ draft }) => ({ outcome: "created", recipeId: `x-${draft.sourceKey}`, title: `${draft.title} (2)`, renamedFrom: draft.title, warnings: [] }) });
    await h.runAll();
    const renamed = h.events.filter((event) => event.kind === "item-renamed");
    expect(renamed).toHaveLength(3);
    expect(renamed[0]).toMatchObject({ level: "info", entity: "recipes", targetId: expect.stringMatching(/^x-/) });
    expect(renamed[0].message).toMatch(/^You already had a recipe called ".+", so this one is ".+ \(2\)"\.$/);
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

  it("tries a recipe that fails once more in place, then reports it with why and carries on in the same pass", async () => {
    const tried: string[] = [];
    const h = harness({ write: async ({ draft }) => {
      tried.push(draft.title);
      if (draft.title === "Soup") throw new TypeError("D1 said no");
      return { outcome: "created", recipeId: `r-${draft.sourceKey}`, title: draft.title, warnings: [] };
    } });
    await runNextChunk("job-1", h.ports);
    expect(await runNextChunk("job-1", h.ports, { chunkSize: 3 })).toMatchObject({ status: "done-with-issues" });
    expect(tried.filter((title) => title === "Soup")).toHaveLength(2);
    expect(h.counts.get("recipes")).toMatchObject({ created: 2, failed: 1 });
    expect(h.events.find((event) => event.kind === "item-failed")).toMatchObject({
      message: "Soup didn't move in this time. Moving the same backup in again tries it once more.",
      detail: "TypeError: D1 said no",
      level: "error",
    });
  });

  it("keeps the first lines of a long error", async () => {
    const h = harness({ write: async () => { throw new Error("x".repeat(500)); } });
    await runNextChunk("job-1", h.ports);
    await runNextChunk("job-1", h.ports, { chunkSize: 1 });
    expect(h.events.find((event) => event.kind === "item-failed")?.detail).toBe(`Error: ${"x".repeat(193)}`);
  });

  it("reports a thrown value that isn't an error by what it says", async () => {
    const h = harness({ write: async () => { throw "the store said no"; } });
    await runNextChunk("job-1", h.ports);
    await runNextChunk("job-1", h.ports, { chunkSize: 1 });
    expect(h.events.find((event) => event.kind === "item-failed")?.detail).toBe("the store said no");
  });

  it("brings a recipe that fails once on its second try", async () => {
    let fails = 1;
    const h = harness({ write: async ({ draft }) => {
      if (draft.title === "Soup" && fails-- > 0) throw new Error("a blip");
      return { outcome: "created", recipeId: `r-${draft.sourceKey}`, title: draft.title, warnings: [] };
    } });
    await runNextChunk("job-1", h.ports);
    // Its tags staying behind is the only issue.
    expect(await runNextChunk("job-1", h.ports, { chunkSize: 3 })).toMatchObject({ phase: "done" });
    expect(h.counts.get("recipes")).toMatchObject({ created: 3, failed: 0 });
    expect(h.events.some((event) => event.kind === "item-failed")).toBe(false);
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

  it("stops rather than guess when the kitchen it chose before isn't in the backup", async () => {
    const h = harness();
    h.jobs.set("job-1", { ...h.job(), sourceId: "source-1", phase: "recipes", cursor: "0" });
    h.ports.store.sourceInstanceKey = async () => "not-a-kitchen";
    expect(await h.runAll()).toMatchObject({ status: "failed", lastError: "pick-a-group" });
    expect(h.written.size).toBe(0);
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

  it("saves after each recipe, so a stop mid-chunk repeats only that recipe and counts it once", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    const updateJob = h.ports.store.updateJob;
    let saves = 0;
    h.ports.store.updateJob = async (...args) => {
      if (args[1].cursor === "2" && ++saves === 1) throw new Error("the Worker stopped");
      return updateJob(...args);
    };
    await expect(runNextChunk("job-1", h.ports, { chunkSize: 3 })).rejects.toThrow("the Worker stopped");
    expect(h.job()).toMatchObject({ phase: "recipes", cursor: "1" });
    expect(h.counts.get("recipes")).toMatchObject({ created: 1 });
    expect(await h.runAll()).toMatchObject({ status: "done-with-issues" });
    expect(h.counts.get("recipes")).toMatchObject({ found: 3, created: 3, unchanged: 0 });
    expect(h.counts.get("photos")).toMatchObject({ found: 1, created: 1, unchanged: 0 });
  });

  it("brings the photo of a recipe that moved in before without it", async () => {
    const h = harness();
    h.written.set(keys.pancakes, { recipeId: "already-here", jobId: "job-0" });
    await h.runAll();
    expect(h.photos).toEqual([{ recipeId: "already-here", bytes: photo }]);
    expect(h.counts.get("photos")).toMatchObject({ found: 1, created: 1, unchanged: 0 });
  });

  it("reports afresh when the inspect phase runs again", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    h.jobs.set("job-1", { ...h.job(), phase: "inspect" });
    await runNextChunk("job-1", h.ports);
    expect(h.counts.get("recipes")).toMatchObject({ found: 3 });
    expect(h.events.filter((event) => event.kind === "phase-done")).toHaveLength(1);
  });

  it("keeps to the kitchen it chose when it started", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    h.ports.ownerEmail = async () => null;
    expect(await h.runAll()).toMatchObject({ status: "done-with-issues" });
  });

  it("stops for good once runs keep taking the job without moving it forward", async () => {
    const h = harness();
    h.ports.openArchive = () => Promise.reject(new Error("blob store down"));
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await expect(runForAWhile("job-1", h.ports, { budgetMs: 1000 })).rejects.toThrow("blob store down");
      h.expire();
    }
    expect(await runForAWhile("job-1", h.ports, { budgetMs: 1000 })).toMatchObject({ status: "failed", lastError: "stuck" });
    expect(h.events.at(-1)?.message).toMatch(/^The move-in tried five times in a row/);
    expect(h.discarded).toEqual(["uploads/job-1.zip"]);
  });

  it("passes a recipe's error on, and the recipe with it, when the database can't be reached either", async () => {
    const h = harness({ write: async () => { throw new Error("D1 said no"); } });
    await runNextChunk("job-1", h.ports);
    const load = h.ports.store.loadJob;
    let loads = 0;
    // The chunk's own read works; the look after the recipe fails twice doesn't.
    h.ports.store.loadJob = async (id) => {
      if (++loads > 1) throw new Error("D1 is down");
      return load(id);
    };
    await expect(runNextChunk("job-1", h.ports)).rejects.toThrow("D1 is down");
    h.ports.store.loadJob = load;
    expect(h.job()).toMatchObject({ cursor: "0" });
    expect(h.counts.get("recipes")).toMatchObject({ failed: 0 });
  });

  it("starts counting attempts again once a recipe moves in", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    h.jobs.set("job-1", { ...h.job(), attempt: RECIPE_TRIES - 1 });
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

/** The backup as a source, with some of its kitchen's answers changed, as another source's would be. */
function changedSource(h: ReturnType<typeof harness>, change: (kitchen: MoveInKitchen) => Partial<MoveInKitchen>) {
  h.ports.openSource = async (job) => {
    const source = mealieBackupSource(await openMealieBackup(await h.ports.openArchive(job)));
    return {
      ...source,
      openKitchen: async (key) => {
        const kitchen = await source.openKitchen(key);
        return kitchen && { ...kitchen, ...change(kitchen) };
      },
    };
  };
}

describe("a chunk written together", () => {
  /** The cursors each save of the job carried. */
  function saves(h: ReturnType<typeof harness>) {
    const cursors: Array<string | null | undefined> = [];
    const updateJob = h.ports.store.updateJob;
    h.ports.store.updateJob = async (...args) => (cursors.push(args[1].cursor), updateJob(...args));
    return cursors;
  }

  it("writes the chunk's recipes in one go and saves the chunk once, counting as writing each alone would", async () => {
    const h = harness({ writeMany: true });
    await runNextChunk("job-1", h.ports);
    const cursors = saves(h);
    await runNextChunk("job-1", h.ports, { chunkSize: 3 });
    expect(h.chunkWrites).toHaveLength(1);
    expect(h.chunkWrites[0]).toHaveLength(3);
    expect(cursors[0]).toBe("3");
    expect(h.job()).toMatchObject({ status: "done-with-issues", phase: "done" });
    expect(h.counts.get("recipes")).toMatchObject({ found: 3, created: 3, failed: 0 });
    expect(h.counts.get("photos")).toMatchObject({ found: 1, created: 1 });
    expect(h.photos).toHaveLength(1);
  });

  it("writes alone each recipe the chunk write leaves out", async () => {
    const alone: string[] = [];
    const h = harness({
      writeMany: async (inputs, one) => Promise.all(inputs.map((input, i) => (i === 1 ? null : one(input)))),
      write: async ({ draft }) => (alone.push(draft.sourceKey), { outcome: "created", recipeId: `spoonjoy-${draft.sourceKey}`, title: draft.title, warnings: [] }),
    });
    await runNextChunk("job-1", h.ports);
    alone.length = 0;
    await runNextChunk("job-1", h.ports, { chunkSize: 3 });
    expect(alone).toHaveLength(3);
    expect(h.counts.get("recipes")).toMatchObject({ created: 3 });
  });

  it("writes each recipe alone when the chunk write fails, so one recipe's error is that recipe's alone", async () => {
    const h = harness({ writeMany: async () => Promise.reject(new Error("too many statements")) });
    await runNextChunk("job-1", h.ports);
    await runNextChunk("job-1", h.ports, { chunkSize: 3 });
    expect(h.counts.get("recipes")).toMatchObject({ found: 3, created: 3, failed: 0 });
  });

  it("passes an outage in the chunk write on, with the chunk still next", async () => {
    const h = harness({ writeMany: async () => Promise.reject(new SourceUnavailableError("the server didn't answer")) });
    await runNextChunk("job-1", h.ports);
    await expect(runNextChunk("job-1", h.ports, { chunkSize: 3 })).rejects.toThrow("the server didn't answer");
    expect(h.job()).toMatchObject({ phase: "recipes", cursor: "0" });
  });

  it("goes one recipe at a time after a run that stopped in a later chunk of its segment, and together again after one that ended well", async () => {
    // Three more recipes in the kitchen, for six: three chunks of two.
    const more = [110, 111, 112].map((n) => ({ ...tables.recipes[1], id: guid(n, "sqlite"), slug: `soup-${n}`, name: `Soup ${n}` }));
    const h = harness({ writeMany: true, zip: backup({ ...tables, recipes: [...tables.recipes, ...more] }) });
    const segment = () => runMoveInSegment("job-1", h.ports, { budgetMs: 60_000, chunkSize: 2 });
    await runNextChunk("job-1", h.ports);
    expect(h.job().cursor).toBe("0");
    const updateJob = h.ports.store.updateJob;
    let stopAt: string | null = "4";
    h.ports.store.updateJob = async (...args) => {
      if (args[1].cursor === stopAt) {
        stopAt = null;
        throw new Error("the Worker stopped");
      }
      return updateJob(...args);
    };
    // The first chunk is written together and saved; the Worker stops on the second, keeping its claim until it lapses.
    await expect(segment()).rejects.toThrow("the Worker stopped");
    expect(h.job()).toMatchObject({ cursor: "2", attempt: 1 });
    expect(h.chunkWrites).toHaveLength(2);
    h.expire();
    const saves: Array<string | null | undefined> = [];
    h.ports.store.updateJob = async (...args) => (saves.push(args[1].cursor), updateJob(...args));
    expect((await segment()).job).toMatchObject({ status: "done-with-issues" });
    // The chunk it stopped in goes one recipe at a time; once that has moved, the next is written together again.
    expect(saves.slice(0, 3)).toEqual(["3", "4", "6"]);
    expect(h.chunkWrites).toHaveLength(3);
    expect(h.job().attempt).toBe(0);
  });

  it("writes a chunk together again in the next segment after one that ended well", async () => {
    const h = harness({ writeMany: true });
    await runNextChunk("job-1", h.ports);
    await runMoveInSegment("job-1", h.ports, { budgetMs: 0, chunkSize: 2 });
    expect(h.job()).toMatchObject({ cursor: "2", attempt: 0 });
    await runMoveInSegment("job-1", h.ports, { budgetMs: 0, chunkSize: 2 });
    expect(h.chunkWrites).toHaveLength(1);
    expect(h.job()).toMatchObject({ status: "done-with-issues" });
  });

  it("tries a recipe the source can't give on its own, and writes the rest together", async () => {
    const h = harness({ writeMany: true });
    let tries = 0;
    changedSource(h, (kitchen) => ({ draft: async (index) => (index === 1 && ++tries <= 2 ? Promise.reject(new Error("bad row")) : kitchen.draft(index)) }));
    await runNextChunk("job-1", h.ports);
    await runNextChunk("job-1", h.ports, { chunkSize: 3 });
    expect(h.chunkWrites[0]).toHaveLength(2);
    expect(h.counts.get("recipes")).toMatchObject({ found: 3, created: 3, failed: 0 });
  });

  it("passes an outage on when the source can't give a recipe of the chunk", async () => {
    const h = harness({ writeMany: true });
    changedSource(h, (kitchen) => ({ draft: async (index) => (index === 1 ? Promise.reject(new SourceUnavailableError("server down")) : kitchen.draft(index)) }));
    await runNextChunk("job-1", h.ports);
    await expect(runNextChunk("job-1", h.ports, { chunkSize: 3 })).rejects.toThrow("server down");
    expect(h.chunkWrites).toEqual([]);
    expect(h.job()).toMatchObject({ cursor: "0" });
  });

  it("goes one recipe at a time, saving after each, through a chunk a run stopped in", async () => {
    const h = harness({ writeMany: true });
    await runNextChunk("job-1", h.ports);
    h.jobs.set("job-1", { ...h.job(), attempt: 2 });
    const cursors = saves(h);
    await runNextChunk("job-1", h.ports, { chunkSize: 3 });
    expect(h.chunkWrites).toEqual([]);
    expect(cursors.slice(0, 3)).toEqual(["1", "2", "3"]);
    expect(h.counts.get("recipes")).toMatchObject({ created: 3 });
  });

  it("counts a chunk repeated after a stop before its save as this job's, once", async () => {
    const h = harness({ writeMany: true });
    await runNextChunk("job-1", h.ports);
    const updateJob = h.ports.store.updateJob;
    let stopped = false;
    h.ports.store.updateJob = async (...args) => {
      if (args[1].cursor === "3" && !stopped) {
        stopped = true;
        throw new Error("the Worker stopped");
      }
      return updateJob(...args);
    };
    await expect(runNextChunk("job-1", h.ports, { chunkSize: 3 })).rejects.toThrow("the Worker stopped");
    expect(h.job()).toMatchObject({ cursor: "0" });
    expect(await h.runAll(3)).toMatchObject({ status: "done-with-issues" });
    expect(h.counts.get("recipes")).toMatchObject({ found: 3, created: 3, unchanged: 0 });
    expect(h.counts.get("photos")).toMatchObject({ found: 1, created: 1, unchanged: 0 });
  });
});

describe("a source other than a backup", () => {
  it("moves in through the source it is given", async () => {
    const h = harness();
    changedSource(h, () => ({}));
    const given = h.ports.openSource as NonNullable<MoveInPorts["openSource"]>;
    let opens = 0;
    h.ports.openSource = (job) => (opens++, given(job));
    expect(await h.runAll()).toMatchObject({ status: "done-with-issues", phase: "done" });
    expect(opens).toBeGreaterThan(0);
    expect(h.written.size).toBe(3);
  });

  it("records the source's app and address, and words its notes for where the kitchen is", async () => {
    const h = harness({ write: async ({ draft }) => { if (draft.title === "Soup") throw new Error("no"); return { outcome: "created", recipeId: draft.sourceKey, title: draft.title, warnings: [] }; } });
    const words = { there: "on your recipe server", again: "Moving in from your server again" };
    const given = h.ports;
    changedSource(h, () => ({}));
    const open = given.openSource as NonNullable<MoveInPorts["openSource"]>;
    h.ports.openSource = async (job) => ({ ...(await open(job)), kind: "the-app", serverUrl: "https://recipes.example.com", words });
    await h.runAll();
    expect(h.sources[0]).toMatchObject({ kind: "the-app", serverUrl: "https://recipes.example.com" });
    expect(h.events.map((event) => event.message)).toEqual(expect.arrayContaining([
      "Spoonjoy doesn't have tags, categories or tools yet, so 1 tag, 1 category, 1 tool stayed on your recipe server.",
      "Soup didn't move in this time. Moving in from your server again tries it once more.",
    ]));
  });

  it("passes an outage on, with the recipe still next, rather than counting the recipe as failed", async () => {
    const h = harness();
    changedSource(h, (kitchen) => ({ draft: async (index) => (index === 1 ? Promise.reject(new SourceUnavailableError("server down")) : kitchen.draft(index)) }));
    await runNextChunk("job-1", h.ports);
    await expect(runNextChunk("job-1", h.ports)).rejects.toBeInstanceOf(SourceUnavailableError);
    // The first recipe moved in and was kept; the second is next again.
    expect(h.job()).toMatchObject({ status: "running", cursor: "1" });
    expect(h.counts.get("recipes")).toMatchObject({ failed: 0 });
  });

  it("waits out a long outage without passing any recipe over or calling the move-in stuck", async () => {
    const h = harness();
    let down = true;
    changedSource(h, (kitchen) => ({ draft: async (index) => (down && index === 1 ? Promise.reject(new SourceUnavailableError("server down")) : kitchen.draft(index)) }));
    // Each run under its claim, as the queue runs them; the claim counts an attempt.
    const runClaimed = async () => {
      for (let i = 0; i < 30 && !["done", "done-with-issues", "failed"].includes(h.job().status); i++) {
        const token = (await h.ports.store.claim("job-1", new Date())) as string;
        await runNextChunk("job-1", h.ports, { chunkSize: 1, token }).catch(() => undefined);
        await h.ports.store.release("job-1", token);
      }
      return h.job();
    };
    // 1 is the mark the first recipe's save left under its claim: the outages counted no stop.
    expect(await runClaimed()).toMatchObject({ status: "running", cursor: "1", attempt: 1 });
    expect(h.counts.get("recipes")).toMatchObject({ failed: 0 });
    // A run that holds no claim counted no attempt, so it takes none back.
    await expect(runNextChunk("job-1", h.ports)).rejects.toBeInstanceOf(SourceUnavailableError);
    h.jobs.set("job-1", { ...h.job(), attempt: 2 });
    await expect(runNextChunk("job-1", h.ports)).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(h.job().attempt).toBe(2);
    h.jobs.set("job-1", { ...h.job(), attempt: 0 });
    down = false;
    expect(await runClaimed()).toMatchObject({ status: "done-with-issues" });
    expect(h.counts.get("recipes")).toMatchObject({ failed: 0, created: 3 });
  });

  it("passes an outage on while reading a photo, rather than moving the recipe in without it", async () => {
    const h = harness();
    changedSource(h, () => ({ readPhoto: () => Promise.reject(new SourceUnavailableError("server down")) }));
    await runNextChunk("job-1", h.ports);
    await expect(runNextChunk("job-1", h.ports)).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(h.counts.get("photos")).toMatchObject({ failed: 0 });
    expect(h.events.some((event) => event.kind === "item-degraded")).toBe(false);
  });

  it("stops with the fix-it message when the source refuses partway, as when the cook's token is revoked", async () => {
    const h = harness();
    changedSource(h, () => ({ draft: () => Promise.reject(new MoveInError("server-token")) }));
    expect(await h.runAll()).toMatchObject({ status: "failed", lastError: "server-token" });
    expect(h.counts.get("recipes")).toMatchObject({ failed: 0 });
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

  it("keeps hold of the job when a chunk fails, so the next try waits out the claim", async () => {
    const h = harness();
    h.ports.openArchive = () => Promise.reject(new Error("blob store down"));
    await expect(runForAWhile("job-1", h.ports, { budgetMs: 1000 })).rejects.toThrow("blob store down");
    expect(h.isClaimed()).toBe(true);
    expect(await runForAWhile("job-1", h.ports, { budgetMs: 1000 })).toMatchObject({ attempt: 1 });
  });

  it("lets the job go when a chunk fails, for a caller whose retries are paced already, even if the release fails too", async () => {
    const h = harness();
    h.ports.openArchive = () => Promise.reject(new Error("blob store down"));
    await expect(runMoveInSegment("job-1", h.ports, { budgetMs: 1000, releaseOnError: true })).rejects.toThrow("blob store down");
    expect(h.isClaimed()).toBe(false);

    h.ports.store.release = () => Promise.reject(new Error("D1 down"));
    await expect(runMoveInSegment("job-1", h.ports, { budgetMs: 1000, releaseOnError: true })).rejects.toThrow("blob store down");
    expect(h.isClaimed()).toBe(true);
  });

  it("says whether the run held the job", async () => {
    const h = harness();
    expect(await runMoveInSegment("job-1", h.ports, { budgetMs: 0, chunkSize: 1 })).toMatchObject({ claimed: true, job: { phase: "recipes" } });
    await h.ports.store.claim("job-1", new Date());
    expect(await runMoveInSegment("job-1", h.ports, { budgetMs: 0 })).toMatchObject({ claimed: false, job: { phase: "recipes" } });
  });

  it("passes over a recipe whose runs died before it could fail, and moves the rest in", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    // Each run that took the job died on the recipe at the cursor, as when it takes the Worker down.
    h.jobs.set("job-1", { ...h.job(), attempt: RECIPE_TRIES });
    expect(await runForAWhile("job-1", h.ports, { budgetMs: 60_000, chunkSize: 1 })).toMatchObject({ status: "done-with-issues" });
    expect(h.counts.get("recipes")).toMatchObject({ found: 3, created: 2, failed: 1 });
    expect(h.events.find((event) => event.kind === "item-failed")).toMatchObject({
      level: "error",
      message: expect.stringMatching(/ didn't move in this time\. Moving the same backup in again tries it once more\.$/),
      detail: `It stopped the move-in ${RECIPE_TRIES} times in a row.`,
    });
  });

  it("moves the rest of a kitchen in, in one segment and without the queue's backoff, when one recipe always throws", async () => {
    const tried: string[] = [];
    const h = harness({ write: async ({ draft }) => {
      tried.push(draft.title);
      if (draft.title === "Soup") throw new Error("LIKE or GLOB pattern too complex");
      return { outcome: "created", recipeId: `r-${draft.sourceKey}`, title: draft.title, warnings: [] };
    } });
    const { job, claimed } = await runMoveInSegment("job-1", h.ports, { budgetMs: 60_000, chunkSize: 1, releaseOnError: true });
    expect(claimed).toBe(true);
    expect(job).toMatchObject({ status: "done-with-issues" });
    expect(h.counts.get("recipes")).toMatchObject({ created: 2, failed: 1 });
    expect(tried.filter((title) => title === "Soup")).toHaveLength(2);
    expect(h.events.find((event) => event.kind === "item-failed")?.detail).toBe("Error: LIKE or GLOB pattern too complex");
  });
});

describe("a backup's tags, categories and tools", () => {
  const at = { ownerId: "chef-1", sourceId: "source-1", jobId: "job-1" };
  const pancakes = { ...at, recipeId: `spoonjoy-${keys.pancakes}`, tags: ["Quick"], categories: ["Dinner"], tools: [] };
  const soup = { ...at, recipeId: `spoonjoy-${keys.soup}`, tags: [], categories: [], tools: ["Skillet"] };

  it("go onto their recipes when the cook has organizers, counted as found and with no note that they stayed behind", async () => {
    const h = harness({ organizers: { on: true } });
    await h.runAll();
    expect(h.organized).toEqual([pancakes, soup]);
    for (const entity of ["tags", "categories", "tools"]) expect(h.counts.get(entity)).toMatchObject({ found: 1, skipped: 0 });
    expect(h.events.some((event) => event.entity === "tags")).toBe(false);
  });

  it("go onto a recipe already here or changed in place, and leave a recipe the cook changed or deleted alone", async () => {
    const already = harness({
      organizers: { on: true },
      write: async ({ draft }) => (draft.title === "Pancakes"
        ? { outcome: "kept", recipeId: `spoonjoy-${draft.sourceKey}`, reason: "You changed this recipe in Spoonjoy, so your version stays." }
        : { outcome: "unchanged", recipeId: `spoonjoy-${draft.sourceKey}`, jobId: "an-earlier-job" }),
    });
    await already.runAll();
    expect(already.organized).toEqual([soup]);

    const changed = harness({
      organizers: { on: true },
      write: async ({ draft }) => (draft.title === "Pancakes"
        ? { outcome: "updated", recipeId: `spoonjoy-${draft.sourceKey}` }
        : { outcome: "skipped", recipeId: `spoonjoy-${draft.sourceKey}`, reason: "You deleted this recipe in Spoonjoy after it moved in." }),
    });
    await changed.runAll();
    expect(changed.organized).toEqual([pancakes]);
  });

  it("leave a recipe moved in without them, with a note, when they can't be put on it", async () => {
    const tried: string[] = [];
    const h = harness({ organizers: { on: true, attach: async ({ recipeId }) => {
      tried.push(recipeId);
      throw new Error("D1 said no");
    } } });
    await h.runAll();
    expect(tried).toEqual([pancakes.recipeId, soup.recipeId]);
    expect(h.counts.get("recipes")).toMatchObject({ created: 3, failed: 0 });
    expect(h.events.find((event) => event.targetId === pancakes.recipeId && event.kind === "item-degraded")).toMatchObject({
      level: "warn",
      entity: "recipes",
      message: "Pancakes moved in without some of its tags, categories and tools. Moving the same backup in again adds them.",
      detail: "Error: D1 said no",
    });
  });

  it("follow what inspect decided, even when the cook's flag changes during the move-in", async () => {
    const turnedOff = { on: true };
    const off = harness({ organizers: turnedOff });
    await runNextChunk("job-1", off.ports);
    turnedOff.on = false;
    await off.runAll();
    expect(off.organized).toEqual([pancakes, soup]);

    const turnedOn = { on: false };
    const on = harness({ organizers: turnedOn });
    await runNextChunk("job-1", on.ports);
    turnedOn.on = true;
    await on.runAll();
    expect(on.organized).toEqual([]);
    expect(on.counts.get("tags")).toMatchObject({ found: 1, skipped: 1 });
  });

  it("ask once a run whether inspect chose to bring them", async () => {
    const h = harness({ organizers: { on: true } });
    const asked = vi.spyOn(h.ports.store, "organizing");
    await runNextChunk("job-1", h.ports);
    await runForAWhile("job-1", h.ports, { budgetMs: 10_000, chunkSize: 1 });
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("stay in the backup, as before, when the cook doesn't have organizers", async () => {
    const h = harness({ organizers: { on: false } });
    await h.runAll();
    expect(h.organized).toEqual([]);
    expect(h.counts.get("tags")).toMatchObject({ found: 1, skipped: 1 });
    expect(h.events.find((event) => event.entity === "tags")?.message).toBe(
      "Spoonjoy doesn't have tags, categories or tools yet, so 1 tag, 1 category, 1 tool stayed in the backup.",
    );
  });
});

describe("a kitchen on its own server, which changes while it moves in", () => {
  /** The cook's server: its recipe list is `listed`, which the test changes between runs, as the cook would. */
  function serverKitchen(h: ReturnType<typeof harness>) {
    const recipe = (n: number) => ({
      id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
      slug: `recipe-${n}`,
      name: `Recipe ${n}`,
      createdAt: `2026-11-20T10:${String(n).padStart(2, "0")}:00Z`,
      recipeIngredient: [{ note: "salt" }],
    });
    const all = Array.from({ length: 7 }, (_, n) => recipe(n));
    const listed = all.slice(0, 6);
    const fetch: typeof globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/app/about") return Response.json({ version: "v3.31.0" });
      if (path === "/api/users/self") return Response.json({ group: "Juniper Street", groupId: "092b8ed0-4f72-43b4-9ba2-dffc05dc8d47" });
      if (path === "/api/recipes") return Response.json({ items: listed.map(({ recipeIngredient: _lines, ...summary }) => summary) });
      if (path.startsWith("/api/organizers/")) return Response.json({ items: [] });
      const found = listed.find((one) => path === `/api/recipes/${one.slug}`);
      return found ? Response.json(found) : new Response("not found", { status: 404 });
    };
    h.ports.openSource = () => mealieApiSource({ address: "https://recipes.example.com/", token: "token", fetch });
    return { all, listed };
  }

  it.each([["one at a time", false], ["a chunk together", true]] as const)("brings every recipe still there when the cook deletes one already moved in, and one added meanwhile, passing none over, writing %s", async (_way, together) => {
    const h = harness(together ? { writeMany: true } : {});
    const { all, listed } = serverKitchen(h);
    await runNextChunk("job-1", h.ports);
    expect(h.counts.get("recipes")).toMatchObject({ found: 6 });
    await runNextChunk("job-1", h.ports, { chunkSize: 2 });
    expect([...h.written.keys()]).toEqual([all[0].id, all[1].id]);

    // A count of 2 would now start at Recipe 3 and pass Recipe 2 over; the cursor holds Recipe 1's place instead.
    listed.splice(0, 1);
    listed.push(all[6]);
    expect(await h.runAll(2)).toMatchObject({ status: "done", phase: "done", cursor: null });
    expect([...h.written.keys()]).toEqual(all.map((one) => one.id));
    expect(h.counts.get("recipes")).toMatchObject({ created: 7, failed: 0 });
  });

  it("carries on after the recipe its cursor names, when the cook deletes that recipe", async () => {
    const h = harness();
    const { all, listed } = serverKitchen(h);
    await runNextChunk("job-1", h.ports);
    await runNextChunk("job-1", h.ports, { chunkSize: 2 });
    expect(h.job().cursor).toBe(`after:${Date.parse(all[1].createdAt)}:${all[1].id}`);

    listed.splice(1, 1);
    await h.runAll(2);
    expect([...h.written.keys()]).toEqual(all.slice(0, 6).map((one) => one.id));
  });

  it("carries on from a count saved before the kitchen had places, and keeps its place from then on", async () => {
    const h = harness();
    const { all, listed } = serverKitchen(h);
    await runNextChunk("job-1", h.ports);
    h.jobs.set("job-1", { ...h.job(), cursor: "3" });
    await runNextChunk("job-1", h.ports, { chunkSize: 1 });
    // From here the cursor holds a place, so a recipe deleted before it passes none over.
    expect(h.job().cursor).toBe(`after:${Date.parse(all[3].createdAt)}:${all[3].id}`);
    listed.splice(0, 1);
    await h.runAll(2);
    expect([...h.written.keys()]).toEqual([all[3].id, all[4].id, all[5].id]);
  });

  it("passes over by its place a recipe that keeps stopping the move-in, and goes on with the next", async () => {
    const h = harness();
    const { all } = serverKitchen(h);
    await runNextChunk("job-1", h.ports);
    await runNextChunk("job-1", h.ports, { chunkSize: 2 });
    h.jobs.set("job-1", { ...h.job(), attempt: RECIPE_TRIES + 1 });
    await runNextChunk("job-1", h.ports, { chunkSize: 1 });
    expect(h.events.find((event) => event.kind === "item-failed")?.sourceKey).toBe(all[2].id);
    expect(h.job().cursor).toBe(`after:${Date.parse(all[3].createdAt)}:${all[3].id}`);
    expect([...h.written.keys()]).toEqual([all[0].id, all[1].id, all[3].id]);
  });

  it("stops rather than ending as done when the cursor holds a place the kitchen can't read", async () => {
    const h = harness();
    await runNextChunk("job-1", h.ports);
    h.jobs.set("job-1", { ...h.job(), cursor: "after:0:somewhere" });
    await expect(runNextChunk("job-1", h.ports)).rejects.toThrow("the move-in's place, after:0:somewhere, isn't one this kitchen can read");
    expect(h.job()).toMatchObject({ status: "running", phase: "recipes" });
  });
});
