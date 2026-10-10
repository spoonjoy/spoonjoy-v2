// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";
import { expectConsoleError } from "../warning-policy";
import { photoVariantKeys } from "~/lib/photo-variants";

// Removing an upload deletes the original, then its variant objects: exactly one photo, nothing else.
function expectOneUploadRemoved(remove: ReturnType<typeof vi.fn>) {
  expect(remove).toHaveBeenCalledTimes(2);
  const [key] = remove.mock.calls[0] as [string];
  expect(remove).toHaveBeenNthCalledWith(2, photoVariantKeys(key));
}

// The recipe edit page and the step edit page with a D1 binding: each write is one D1
// batch (through the SQLite-backed fake binding) and leaves the same rows as the Prisma
// path, which still runs where there is no binding. Each case runs the same form post
// against one recipe without a binding and against an identical twin with one.

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;
let cookie: string;

const OLD = new Date("2026-01-01T00:00:00.000Z");

type Seeded = Awaited<ReturnType<typeof seedRecipe>>;

async function seedRecipe(title: string) {
  const recipe = await db.recipe.create({ data: { title, description: "Seeded", servings: "2", chefId } });
  const cup = await db.unit.upsert({ where: { name: "cup" }, update: {}, create: { name: "cup" } });
  const refs = await Promise.all(["flour", "milk", "egg"].map((name) =>
    db.ingredientRef.upsert({ where: { name }, update: {}, create: { name } })));
  const steps = [];
  for (const [stepNum, stepTitle] of [[1, "Mix"], [2, "Rest"], [3, "Bake"]] as const) {
    steps.push(await db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum, stepTitle, description: `${stepTitle} it`, duration: stepNum * 5 },
    }));
  }
  const ingredients = [];
  for (const [stepNum, ref] of [[1, 0], [1, 1], [2, 2]] as const) {
    ingredients.push(await db.ingredient.create({
      data: { recipeId: recipe.id, stepNum, quantity: stepNum, unitId: cup.id, ingredientRefId: refs[ref]!.id },
    }));
  }
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 3 } });
  const cookbook = await db.cookbook.create({ data: { title: `Book ${title}`, authorId: chefId } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: chefId } });
  await db.cookbook.update({ where: { id: cookbook.id }, data: { updatedAt: OLD } });
  await db.recipe.update({ where: { id: recipe.id }, data: { updatedAt: OLD } });
  return { recipe, steps, ingredients, cookbook };
}

async function graph(seeded: Seeded) {
  const recipe = await db.recipe.findUniqueOrThrow({
    where: { id: seeded.recipe.id },
    include: {
      steps: { orderBy: { stepNum: "asc" }, include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
      covers: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  const uses = await db.stepOutputUse.findMany({ where: { recipeId: recipe.id } });
  const cookbook = await db.cookbook.findUniqueOrThrow({ where: { id: seeded.cookbook.id } });
  return {
    title: recipe.title.replace(/^Twin \S+ (Prisma|D1)/, "Twin"),
    description: recipe.description,
    servings: recipe.servings,
    coverMode: recipe.coverMode,
    activeCoverVariant: recipe.activeCoverVariant,
    activeCover: recipe.covers.findIndex((cover) => cover.id === recipe.activeCoverId),
    touched: recipe.updatedAt.getTime() > OLD.getTime(),
    cookbookTouched: cookbook.updatedAt.getTime() > OLD.getTime(),
    steps: recipe.steps.map((step) => ({
      position: seeded.steps.findIndex((seededStep) => seededStep.id === step.id),
      stepNum: step.stepNum,
      stepTitle: step.stepTitle,
      description: step.description,
      ingredients: step.ingredients.map((ingredient) => `${ingredient.quantity} ${ingredient.unit.name} ${ingredient.ingredientRef.name}`).sort(),
    })),
    uses: uses.map((use) => `${use.outputStepNum}->${use.inputStepNum}`).sort(),
    covers: recipe.covers.map((cover) => ({
      sourceType: cover.sourceType,
      status: cover.status,
      createdById: cover.createdById,
      generationStatus: cover.generationStatus,
      failureReason: cover.failureReason,
      hasImage: cover.imageUrl.length > 0,
      sourceIsImage: cover.sourceImageUrl === cover.imageUrl,
    })),
  };
}

async function withD1Routes<T>(run: () => Promise<T>) {
  vi.resetModules();
  const actual = await vi.importActual<typeof import("~/lib/route-platform.server")>("~/lib/route-platform.server");
  // Reads and the non-batched writes still run through Prisma on the unit-test database.
  vi.doMock("~/lib/route-platform.server", () => ({ ...actual, getRequestDb: vi.fn(async () => getLocalDb()) }));
  return run();
}

function form(fields: Record<string, string | File>) {
  const body = new UndiciFormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return body;
}

function responseStatus(response: unknown) {
  if (response instanceof Response) return response.status;
  const init = (response as { init?: { status?: number } } | null)?.init;
  return init?.status ?? 200;
}

type Page = "edit" | "step";

async function post(page: Page, seeded: Seeded, fields: (seeded: Seeded) => Record<string, string | File>, env: Record<string, unknown> | null, stepIndex = 0) {
  return responseStatus(await act(page, seeded, fields, env, stepIndex));
}

async function act(page: Page, seeded: Seeded, fields: (seeded: Seeded) => Record<string, string | File>, env: Record<string, unknown> | null, stepIndex = 0) {
  const params = page === "edit"
    ? { id: seeded.recipe.id }
    : { id: seeded.recipe.id, stepId: seeded.steps[stepIndex]!.id };
  const module = page === "edit"
    ? await import("~/routes/recipes.$id.edit")
    : await import("~/routes/recipes.$id.steps.$stepId.edit");
  return module.action({
    request: new UndiciRequest(`http://localhost:3000/recipes/${seeded.recipe.id}/edit`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form(fields(seeded)),
    }) as never,
    context: { cloudflare: { env } },
    params,
  } as never);
}

/** The fake binding, with `before` run once just ahead of the first batch: another request. */
function racing(before: () => Promise<unknown>) {
  let pending = true;
  return {
    prepare: (sql: string) => d1.binding.prepare(sql),
    async batch(statements: never) {
      if (pending) {
        pending = false;
        await before();
      }
      return d1.binding.batch(statements);
    },
  };
}

/** Runs one form post against a racing binding and answers its status and errors. */
async function lostRace(page: Page, seeded: Seeded, fields: Record<string, string | File>, before: () => Promise<unknown>, stepIndex = 0) {
  const result = await withD1Routes(() => act(page, seeded, () => fields, { DB: racing(before), PHOTOS: photos() }, stepIndex));
  return { status: responseStatus(result), errors: (result as { data?: { errors?: unknown } }).data?.errors };
}

const CHANGED = "This recipe changed while you were editing it. Reload the page and try again.";

const photos = () => ({ put: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) });

/** Posts the same form without and with a D1 binding to twin recipes; both must end the same. */
async function expectParity(page: Page, fields: (seeded: Seeded) => Record<string, string | File>, stepIndex = 0) {
  const viaPrisma = await seedRecipe(`Twin ${crypto.randomUUID()} Prisma`);
  const viaD1 = await seedRecipe(`Twin ${crypto.randomUUID()} D1`);
  const statuses = await withD1Routes(async () => [
    await post(page, viaPrisma, fields, { PHOTOS: photos() }, stepIndex),
    await post(page, viaD1, fields, { DB: d1.binding, PHOTOS: photos() }, stepIndex),
  ]);
  expect(statuses[1]).toBe(statuses[0]);
  // The D1 twin's write went to the binding, not through Prisma.
  expect(d1.statements.some((statement) => /^\s*(INSERT|UPDATE|DELETE)/.test(statement.sql))).toBe(true);
  expect(await graph(viaD1)).toEqual(await graph(viaPrisma));
  return { statuses, viaPrisma, viaD1 };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

/**
 * Runs `run` with stylization scheduling failing, as a failure after the save batch would, and
 * expects the failure to be logged once.
 */
async function withFailingStylization<T>(surface: "recipe_create" | "recipe_edit", run: () => Promise<T>) {
  const failure = new Error("Stylization queue unavailable");
  expectConsoleError("recipe save follow-up failed", { surface, error: failure });
  vi.doMock("~/lib/spoon-cover-stylization.server", async (importOriginal) => ({
    ...(await importOriginal<typeof import("~/lib/spoon-cover-stylization.server")>()),
    scheduleSpoonCoverStylization: vi.fn().mockRejectedValue(failure),
  }));
  try {
    return await run();
  } finally {
    vi.doUnmock("~/lib/spoon-cover-stylization.server");
  }
}

describe("recipe editor routes on a D1 binding", () => {
  // The first import of each route transforms its whole module graph, which under coverage
  // instrumentation on a busy CI runner took about 5 s and timed out whichever test ran first.
  // Paying it here, under its own budget, leaves every test timing only its own work; the
  // per-test vi.resetModules() re-evaluates the modules but keeps the transformed code cached.
  beforeAll(async () => {
    await import("~/routes/recipes.$id.edit");
    await import("~/routes/recipes.$id.steps.$stepId.edit");
    await import("~/routes/recipes.new");
  }, 60_000);

  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    chefId = (await db.user.create({ data: createTestUser() })).id;
    cookie = (await createUserSessionCookie(chefId)).split(";")[0]!;
  });

  afterEach(async () => {
    d1.close();
    vi.doUnmock("~/lib/route-platform.server");
    vi.resetModules();
    await cleanupDatabase();
  });

  describe("recipe edit page", () => {
    it("moves a step up as the Prisma path does", async () => {
      const { statuses } = await expectParity("edit", ({ steps }) => ({ intent: "reorderStep", stepId: steps[1]!.id, direction: "up" }));
      expect(statuses).toEqual([200, 200]);
    });

    it("deletes a step as the Prisma path does", async () => {
      await expectParity("edit", ({ steps }) => ({ intent: "deleteStep", stepId: steps[1]!.id }));
    });

    it("saves fields as the Prisma path does", async () => {
      const { statuses } = await expectParity("edit", ({ recipe }) => ({ title: `${recipe.title} saved`, description: "", servings: "6" }));
      expect(statuses).toEqual([302, 302]);
    });

    it("saves fields and an uploaded cover as the Prisma path does", async () => {
      await expectParity("edit", ({ recipe }) => ({
        title: recipe.title, description: "With photo", servings: "", image: new File([PNG], "cover.png", { type: "image/png" }),
      }));
    });

    it("clears the cover as the Prisma path does", async () => {
      await expectParity("edit", ({ recipe }) => ({ title: recipe.title, clearImage: "true" }));
    });

    it("answers a save that lost its title with the title error, and removes the upload", async () => {
      const mine = await seedRecipe("Mine");
      const bucket = photos();
      const racing = {
        prepare: (sql: string) => d1.binding.prepare(sql),
        async batch(statements: never) {
          await db.recipe.create({ data: { title: "Wanted", chefId } });
          return d1.binding.batch(statements);
        },
      };
      const status = await withD1Routes(() => post("edit", mine, () => ({
        title: "Wanted", image: new File([PNG], "cover.png", { type: "image/png" }),
      }), { DB: racing, PHOTOS: bucket }));

      expect(status).toBe(400);
      expectOneUploadRemoved(bucket.delete);
      await expect(graph(mine)).resolves.toMatchObject({ title: "Mine", touched: false, covers: [] });
    });

    it("answers a save whose recipe was deleted in between with 404, and removes the upload", async () => {
      const mine = await seedRecipe("Deleted while saving");
      const bucket = photos();
      const deleting = racing(() => db.recipe.update({ where: { id: mine.recipe.id }, data: { deletedAt: new Date() } }));
      const result = await withD1Routes(() => act("edit", mine, () => ({
        title: "Deleted while saving", image: new File([PNG], "cover.png", { type: "image/png" }),
      }), { DB: deleting, PHOTOS: bucket })).catch((error: unknown) => error);

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(404);
      expectOneUploadRemoved(bucket.delete);
      await expect(db.recipeCover.count({ where: { recipeId: mine.recipe.id } })).resolves.toBe(0);
    });
  });

  describe("recipe edit page save precondition", () => {
    const LATER = new Date("2026-02-01T00:00:00.000Z");
    const CONFLICT = "This recipe changed after you opened it, maybe in another tab or the app. Nothing was saved. Save again to keep your version, or reload the page to see the other changes.";

    /** Someone else's save after this page loaded the recipe at OLD. */
    const otherSave = (seeded: Seeded) => db.recipe.update({
      where: { id: seeded.recipe.id },
      data: { description: "Their description", updatedAt: LATER },
    });

    it.each([
      ["Prisma", () => ({ PHOTOS: photos() })],
      ["a D1 binding", () => ({ DB: d1.binding, PHOTOS: photos() })],
    ])("answers a stale save with 409 and the current updatedAt on %s, writing nothing; saving again applies", async (_label, env) => {
      const mine = await seedRecipe(`Stale ${crypto.randomUUID()}`);
      await otherSave(mine);
      const fields = (expectedUpdatedAt: string) => () => ({ title: "My title", description: "Mine", servings: "4", expectedUpdatedAt });

      const stale = await withD1Routes(() => act("edit", mine, fields(OLD.toISOString()), env()));

      expect(responseStatus(stale)).toBe(409);
      expect((stale as { data: unknown }).data).toEqual({ errors: { general: CONFLICT }, currentUpdatedAt: LATER.toISOString() });
      await expect(graph(mine)).resolves.toMatchObject({ description: "Their description", cookbookTouched: false });

      const again = await withD1Routes(() => act("edit", mine, fields(LATER.toISOString()), env()));
      expect(responseStatus(again)).toBe(302);
      await expect(graph(mine)).resolves.toMatchObject({ title: "My title", description: "Mine", servings: "4" });
    });

    it("saves when the recipe is unchanged since the page loaded it", async () => {
      const { statuses } = await expectParity("edit", ({ recipe }) => ({
        title: `${recipe.title} saved`, description: "Fresh", servings: "6", expectedUpdatedAt: OLD.toISOString(),
      }));
      expect(statuses).toEqual([302, 302]);
    });

    it("saves as before when the form sends no or an unreadable expectedUpdatedAt", async () => {
      for (const expectedUpdatedAt of [undefined, "", "yesterday"]) {
        const mine = await seedRecipe(`Legacy ${crypto.randomUUID()}`);
        await otherSave(mine);
        const status = await withD1Routes(() => post("edit", mine, () => ({
          title: "Last write wins", description: "Mine", ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
        }), { DB: d1.binding, PHOTOS: photos() }));
        expect(status).toBe(302);
        await expect(graph(mine)).resolves.toMatchObject({ description: "Mine" });
        await db.recipe.update({ where: { id: mine.recipe.id }, data: { title: `Done ${crypto.randomUUID()}` } });
      }
    });

    it("answers 409 and removes the upload when another save lands between the check and the batch", async () => {
      const mine = await seedRecipe("Raced save");
      const bucket = photos();
      const result = await withD1Routes(() => act("edit", mine, () => ({
        title: "Raced save", description: "Mine", expectedUpdatedAt: OLD.toISOString(),
        image: new File([PNG], "cover.png", { type: "image/png" }),
      }), { DB: racing(() => otherSave(mine)), PHOTOS: bucket }));

      expect(responseStatus(result)).toBe(409);
      expect((result as { data: unknown }).data).toEqual({ errors: { general: CONFLICT }, currentUpdatedAt: LATER.toISOString() });
      expect(bucket.delete).toHaveBeenCalledTimes(1);
      await expect(graph(mine)).resolves.toMatchObject({ description: "Their description", covers: [] });
    });
  });

  describe("after the save batch commits", () => {
    /** The fake binding, answering an error after its first batch has committed. */
    function committedThenThrows() {
      let pending = true;
      return {
        prepare: (sql: string) => d1.binding.prepare(sql),
        async batch(statements: never) {
          const result = await d1.binding.batch(statements);
          if (pending) {
            pending = false;
            throw new Error("D1 reply lost after commit");
          }
          return result;
        },
      };
    }

    it("keeps the edit page's upload and redirects when the save batch commits but answers an error", async () => {
      const mine = await seedRecipe("Committed then errored");
      const bucket = photos();
      const result = await withD1Routes(() => act("edit", mine, () => ({
        title: "Committed then errored", description: "Landed", image: new File([PNG], "cover.png", { type: "image/png" }),
      }), { DB: committedThenThrows(), PHOTOS: bucket }));

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(302);
      expect((result as Response).headers.get("Location")).toBe(`/recipes/${mine.recipe.id}`);
      expect(bucket.delete).not.toHaveBeenCalled();
      const recipe = await db.recipe.findUniqueOrThrow({ where: { id: mine.recipe.id }, include: { activeCover: true } });
      expect(recipe.description).toBe("Landed");
      expect(recipe.activeCover?.imageUrl).toBe(`/photos/${bucket.put.mock.calls[0]![0]}`);
    });

    it("keeps the new recipe page's upload and redirects when the create batch commits but answers an error", async () => {
      const bucket = photos();
      const body = form({ title: "Created then errored", steps: "[]", image: new File([PNG], "cover.png", { type: "image/png" }) });
      const result = await withD1Routes(async () => {
        const { action } = await import("~/routes/recipes.new");
        return action({
          request: new UndiciRequest("http://localhost:3000/recipes/new", { method: "POST", headers: { Cookie: cookie }, body }) as never,
          context: { cloudflare: { env: { DB: committedThenThrows(), PHOTOS: bucket } } },
          params: {},
        } as never);
      });

      const recipe = await db.recipe.findFirstOrThrow({ where: { title: "Created then errored" }, include: { activeCover: true } });
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(302);
      expect((result as Response).headers.get("Location")).toBe(`/recipes/${recipe.id}`);
      expect(bucket.delete).not.toHaveBeenCalled();
      expect(recipe.activeCover?.imageUrl).toBe(`/photos/${bucket.put.mock.calls[0]![0]}`);
    });

    it("keeps the edit page's upload the committed cover points at, and redirects, when stylization fails", async () => {
      const mine = await seedRecipe("Saved then stylized");
      const bucket = photos();
      const result = await withFailingStylization("recipe_edit", () => withD1Routes(() => act("edit", mine, () => ({
        title: "Saved then stylized", description: "New photo", image: new File([PNG], "cover.png", { type: "image/png" }),
      }), { DB: d1.binding, PHOTOS: bucket })));

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(302);
      expect((result as Response).headers.get("Location")).toBe(`/recipes/${mine.recipe.id}`);
      expect(bucket.delete).not.toHaveBeenCalled();
      const recipe = await db.recipe.findUniqueOrThrow({ where: { id: mine.recipe.id }, include: { activeCover: true } });
      expect(recipe.description).toBe("New photo");
      expect(recipe.activeCover?.imageUrl).toBe(`/photos/${bucket.put.mock.calls[0]![0]}`);
    });

    it("keeps the new recipe page's upload the committed cover points at, and redirects, when stylization fails", async () => {
      const bucket = photos();
      const body = form({ title: "Created then stylized", steps: "[]", image: new File([PNG], "cover.png", { type: "image/png" }) });
      const result = await withFailingStylization("recipe_create", () => withD1Routes(async () => {
        const { action } = await import("~/routes/recipes.new");
        return action({
          request: new UndiciRequest("http://localhost:3000/recipes/new", { method: "POST", headers: { Cookie: cookie }, body }) as never,
          context: { cloudflare: { env: { DB: d1.binding, PHOTOS: bucket } } },
          params: {},
        } as never);
      }));

      const recipe = await db.recipe.findFirstOrThrow({ where: { title: "Created then stylized" }, include: { activeCover: true } });
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(302);
      expect((result as Response).headers.get("Location")).toBe(`/recipes/${recipe.id}`);
      expect(bucket.delete).not.toHaveBeenCalled();
      expect(recipe.activeCover?.imageUrl).toBe(`/photos/${bucket.put.mock.calls[0]![0]}`);
    });
  });

  describe("step edit page", () => {
    it("deletes a step as the Prisma path does", async () => {
      await expectParity("step", () => ({ intent: "delete" }), 1);
    });

    it("adds a batch of ingredients as the Prisma path does", async () => {
      await expectParity("step", () => ({
        intent: "addIngredients",
        ingredientsJson: JSON.stringify([{ quantity: 2, unit: "Tbsp", ingredientName: "Honey" }, { quantity: 1, unit: "cup", ingredientName: "Oats" }]),
      }), 2);
    });

    it("adds one ingredient as the Prisma path does", async () => {
      await expectParity("step", () => ({ intent: "addIngredient", quantity: "3", unitName: "Pinch", ingredientName: "Salt" }), 2);
    });

    it("deletes an ingredient as the Prisma path does, and nothing for another step's", async () => {
      await expectParity("step", ({ ingredients }) => ({ intent: "deleteIngredient", ingredientId: ingredients[0]!.id }), 0);
      await expectParity("step", ({ ingredients }) => ({ intent: "deleteIngredient", ingredientId: ingredients[2]!.id }), 0);
    });

    it.each([
      ["with a title", "Bake hot"],
      ["without a title", "  "],
    ])("saves a step %s and its output uses as the Prisma path does", async (_label, stepTitle) => {
      const { statuses } = await expectParity("step", () => ({ stepTitle, description: "Bake it hot", usesSteps: "2" }), 2);
      expect(statuses).toEqual([302, 302]);
    });
  });

  describe("lost races", () => {
    it("answers a step swap whose steps moved with the changed-recipe message", async () => {
      const seeded = await seedRecipe("Swap race");
      const moveTarget = () => db.recipeStep.update({ where: { id: seeded.steps[0]!.id }, data: { stepNum: 9 } });
      await expect(lostRace("edit", seeded, { intent: "reorderStep", stepId: seeded.steps[1]!.id, direction: "up" }, moveTarget))
        .resolves.toEqual({ status: 409, errors: { reorder: CHANGED } });
      expect((await graph(seeded)).steps.map((step) => [step.position, step.stepNum])).toEqual([[1, 2], [2, 3], [0, 9]]);
    });

    it("answers a step swap whose step gained an output dependency in between with the dependency error", async () => {
      const seeded = await seedRecipe("Swap dependency race");
      const dependOnTarget = () => db.stepOutputUse.create({ data: { recipeId: seeded.recipe.id, outputStepNum: 1, inputStepNum: 2 } });
      await expect(lostRace("edit", seeded, { intent: "reorderStep", stepId: seeded.steps[1]!.id, direction: "up" }, dependOnTarget))
        .resolves.toEqual({ status: 400, errors: { reorder: "Cannot move Step 2 to position 1 because it uses output from Step 1" } });
      const unchanged = await graph(seeded);
      expect(unchanged.steps.map((step) => [step.position, step.stepNum])).toEqual([[0, 1], [1, 2], [2, 3]]);
      expect(unchanged.touched).toBe(false);
    });

    it("answers a step moved down whose next step started using its output in between with the dependency error", async () => {
      const seeded = await seedRecipe("Swap down dependency race");
      const nextUsesStep = () => db.stepOutputUse.create({ data: { recipeId: seeded.recipe.id, outputStepNum: 2, inputStepNum: 3 } });
      await expect(lostRace("edit", seeded, { intent: "reorderStep", stepId: seeded.steps[1]!.id, direction: "down" }, nextUsesStep))
        .resolves.toEqual({ status: 400, errors: { reorder: "Cannot move Step 2 to position 3 because Step 3 uses its output" } });
      const unchanged = await graph(seeded);
      expect(unchanged.steps.map((step) => [step.position, step.stepNum])).toEqual([[0, 1], [1, 2], [2, 3]]);
      expect(unchanged.touched).toBe(false);
    });

    it("answers a step swap whose step went away in between with the changed-recipe message", async () => {
      const seeded = await seedRecipe("Swap gone race");
      const deleteStep = () => db.recipeStep.delete({ where: { id: seeded.steps[1]!.id } });
      await expect(lostRace("edit", seeded, { intent: "reorderStep", stepId: seeded.steps[1]!.id, direction: "down" }, deleteStep))
        .resolves.toEqual({ status: 409, errors: { reorder: CHANGED } });
      expect((await graph(seeded)).steps.map((step) => [step.position, step.stepNum])).toEqual([[0, 1], [2, 3]]);
    });

    it.each([
      ["gained a dependent step", "Cannot delete Step 2 because it is used by Step 3", 400,
        (seeded: Seeded) => db.stepOutputUse.create({ data: { recipeId: seeded.recipe.id, outputStepNum: 2, inputStepNum: 3 } })],
      ["was deleted", "Step not found", 404, (seeded: Seeded) => db.recipeStep.delete({ where: { id: seeded.steps[1]!.id } })],
      ["moved", CHANGED, 409, (seeded: Seeded) => db.recipeStep.update({ where: { id: seeded.steps[1]!.id }, data: { stepNum: 9 } })],
    ])("answers a step delete whose step %s as the checks do", async (_label, error, status, before) => {
      const seeded = await seedRecipe(`Delete race ${status}`);
      await expect(lostRace("edit", seeded, { intent: "deleteStep", stepId: seeded.steps[1]!.id }, () => before(seeded)))
        .resolves.toEqual({ status, errors: { stepDeletion: error } });
      const stepPage = await seedRecipe(`Step page delete race ${status}`);
      await expect(lostRace("step", stepPage, { intent: "delete" }, () => before(stepPage), 1))
        .resolves.toEqual({ status, errors: { stepDeletion: error } });
    });

    it("answers ingredient adds that lost a race as the checks do", async () => {
      const seeded = await seedRecipe("Add race");
      const addHoney = async () => {
        const honey = await db.ingredientRef.upsert({ where: { name: "honey" }, update: {}, create: { name: "honey" } });
        const cup = await db.unit.findUniqueOrThrow({ where: { name: "cup" } });
        await db.ingredient.create({ data: { recipeId: seeded.recipe.id, stepNum: 2, quantity: 1, unitId: cup.id, ingredientRefId: honey.id } });
      };
      const moveStep = (stepNum: number) => () => db.recipeStep.update({ where: { id: seeded.steps[2]!.id }, data: { stepNum } });
      const batch = { intent: "addIngredients", ingredientsJson: JSON.stringify([{ quantity: 1, unit: "cup", ingredientName: "Honey" }]) };
      const single = { intent: "addIngredient", quantity: "1", unitName: "cup", ingredientName: "Oats" };

      await expect(lostRace("step", seeded, batch, addHoney, 2))
        .resolves.toEqual({ status: 400, errors: { ingredientName: "honey is already in the recipe" } });
      await expect(lostRace("step", seeded, { ...batch, ingredientsJson: JSON.stringify([{ quantity: 1, unit: "cup", ingredientName: "Rice" }]) }, moveStep(8), 2))
        .resolves.toEqual({ status: 409, errors: { general: CHANGED } });
      await db.recipeStep.update({ where: { id: seeded.steps[2]!.id }, data: { stepNum: 3 } });
      await expect(lostRace("step", seeded, single, async () => {
        const oats = await db.ingredientRef.upsert({ where: { name: "oats" }, update: {}, create: { name: "oats" } });
        const cup = await db.unit.findUniqueOrThrow({ where: { name: "cup" } });
        await db.ingredient.create({ data: { recipeId: seeded.recipe.id, stepNum: 1, quantity: 1, unitId: cup.id, ingredientRefId: oats.id } });
      }, 2)).resolves.toEqual({ status: 400, errors: { ingredientName: "This ingredient is already in the recipe" } });
      await expect(lostRace("step", seeded, { ...single, ingredientName: "Barley" }, moveStep(8), 2))
        .resolves.toEqual({ status: 409, errors: { general: CHANGED } });
    });

    it("leaves no new unit or ingredient name behind when an ingredient add is refused, loses a race or fails", async () => {
      // Units and ingredient names are shared lookup rows. An add that writes nothing must not
      // create them either: they used to be upserted one by one before the checks and the batch.
      const seeded = await seedRecipe("Lookup residue");
      const tag = crypto.randomUUID().slice(0, 8);
      const lookupRows = async () => ({
        units: await db.unit.count({ where: { name: { startsWith: `residue ${tag}` } } }),
        names: await db.ingredientRef.count({ where: { name: { startsWith: `residue ${tag}` } } }),
      });
      const none = { units: 0, names: 0 };
      const fresh = (n: number) => ({ quantity: 1, unit: `Residue ${tag} unit ${n}`, ingredientName: `Residue ${tag} name ${n}` });
      const batch = (...rows: unknown[]) => ({ intent: "addIngredients", ingredientsJson: JSON.stringify(rows) });
      const single = (n: number, ingredientName = fresh(n).ingredientName) =>
        ({ intent: "addIngredient", quantity: "1", unitName: fresh(n).unit, ingredientName });
      const down = { prepare: (sql: string) => d1.binding.prepare(sql), batch: async () => { throw new Error("D1 is down"); } };
      const moveStep = () => db.recipeStep.update({ where: { id: seeded.steps[2]!.id }, data: { stepNum: 8 } });

      // Refused by the checks: a later row is already in the recipe. With and without a binding.
      for (const env of [{ DB: d1.binding }, null]) {
        const refused = await withD1Routes(() => act("step", seeded, () => batch(fresh(1), { quantity: 1, unit: "cup", ingredientName: "Flour" }), env, 2));
        expect(responseStatus(refused)).toBe(400);
        const refusedOne = await withD1Routes(() => act("step", seeded, () => single(2, "Flour"), env, 2));
        expect(responseStatus(refusedOne)).toBe(400);
        expect(await lookupRows()).toEqual(none);
      }

      // Stopped in the batch: the step moved in between.
      await expect(lostRace("step", seeded, batch(fresh(3)), moveStep, 2)).resolves.toEqual({ status: 409, errors: { general: CHANGED } });
      await db.recipeStep.update({ where: { id: seeded.steps[2]!.id }, data: { stepNum: 3 } });
      await expect(lostRace("step", seeded, single(4), moveStep, 2)).resolves.toEqual({ status: 409, errors: { general: CHANGED } });
      await db.recipeStep.update({ where: { id: seeded.steps[2]!.id }, data: { stepNum: 3 } });
      expect(await lookupRows()).toEqual(none);

      // The batch itself fails.
      for (const fields of [batch(fresh(5)), single(6)]) {
        const failed = await withD1Routes(() => act("step", seeded, () => fields, { DB: down }, 2)).catch((error: unknown) => error);
        expect(failed).toEqual(new Error("D1 is down"));
      }
      expect(await lookupRows()).toEqual(none);

      // A successful add on the binding creates each name once, in its batch.
      const added = await withD1Routes(() => act("step", seeded, () => batch(fresh(7), { ...fresh(8), unit: fresh(7).unit }), { DB: d1.binding }, 2));
      expect(responseStatus(added)).toBe(200);
      expect(await lookupRows()).toEqual({ units: 1, names: 2 });
      const successNames = [`residue ${tag} unit 7`, `residue ${tag} name 7`, `residue ${tag} name 8`];
      expect(d1.statements
        .filter((statement) => /INSERT INTO "(Unit|IngredientRef)"/.test(statement.sql))
        .map((statement) => statement.params[1])).toEqual(successNames);
    });

    it("answers step saves that lost a race as the checks do", async () => {
      const seeded = await seedRecipe("Save race");
      await expect(lostRace("step", seeded, { stepTitle: "Mixed", description: "Mix it" }, () =>
        db.ingredient.deleteMany({ where: { recipeId: seeded.recipe.id, stepNum: 1 } }), 0))
        .resolves.toEqual({ status: 400, errors: { usesSteps: "Add at least 1 ingredient or 1 step output use before saving this step." } });
      await expect(lostRace("step", seeded, { stepTitle: "Rested", description: "Rest it" }, () =>
        db.recipeStep.update({ where: { id: seeded.steps[1]!.id }, data: { stepNum: 9 } }), 1))
        .resolves.toEqual({ status: 409, errors: { general: CHANGED } });
      const gone = await seedRecipe("Save race gone");
      await expect(lostRace("step", gone, { stepTitle: "Mixed", description: "Mix it" }, () =>
        db.recipeStep.delete({ where: { id: gone.steps[0]!.id } }), 0))
        .resolves.toEqual({ status: 404, errors: { general: "Step not found" } });
    });

    it("rethrows other D1 failures from the editor batches", async () => {
      const seeded = await seedRecipe("Editor down");
      const down = { prepare: (sql: string) => d1.binding.prepare(sql), batch: async () => { throw new Error("D1 is down"); } };
      const run = (page: Page, fields: Record<string, string>, stepIndex = 0) =>
        withD1Routes(() => act(page, seeded, () => fields, { DB: down }, stepIndex)).catch((error: unknown) => error);
      await expect(run("edit", { intent: "reorderStep", stepId: seeded.steps[1]!.id, direction: "up" })).resolves.toEqual(new Error("D1 is down"));
      await expect(run("edit", { intent: "deleteStep", stepId: seeded.steps[1]!.id })).resolves.toEqual(new Error("D1 is down"));
      await expect(run("step", { intent: "delete" }, 1)).resolves.toEqual(new Error("D1 is down"));
      await expect(run("step", { intent: "addIngredients", ingredientsJson: JSON.stringify([{ quantity: 1, unit: "cup", ingredientName: "Rye" }]) }, 2))
        .resolves.toEqual(new Error("D1 is down"));
      await expect(run("step", { intent: "addIngredient", quantity: "1", unitName: "cup", ingredientName: "Spelt" }, 2))
        .resolves.toEqual(new Error("D1 is down"));
      const saved = await run("step", { stepTitle: "Down", description: "Down" }, 0);
      expect(responseStatus(saved)).toBe(500);
    });
  });

  describe("new recipe page", () => {
    async function create(title: string, env: Record<string, unknown>, image?: File) {
      const body = form({ title, description: "Fresh", servings: "2", steps: JSON.stringify([{ description: "Stir", ingredients: [{ quantity: 1, unit: "cup", ingredientName: "Rice" }] }]), ...(image ? { image } : {}) });
      const { action } = await import("~/routes/recipes.new");
      return action({
        request: new UndiciRequest("http://localhost:3000/recipes/new", { method: "POST", headers: { Cookie: cookie }, body }) as never,
        context: { cloudflare: { env } },
        params: {},
      } as never);
    }

    async function coverState(title: string) {
      const recipe = await db.recipe.findFirstOrThrow({ where: { title }, include: { covers: true } });
      return {
        coverMode: recipe.coverMode,
        activeCoverVariant: recipe.activeCoverVariant,
        activeIsTheCover: recipe.activeCoverId === (recipe.covers[0]?.id ?? null),
        covers: recipe.covers.map((cover) => ({
          sourceType: cover.sourceType,
          status: cover.status,
          generationStatus: cover.generationStatus,
          failureReason: cover.failureReason,
          createdById: cover.createdById,
          hasImage: cover.imageUrl.length > 0,
        })),
        steps: await db.recipeStep.count({ where: { recipeId: recipe.id } }),
      };
    }

    it.each([
      ["with an uploaded cover", true],
      ["with a placeholder cover", false],
    ])("creates a recipe %s in one batch, as the Prisma path does", async (_label, withImage) => {
      const image = () => (withImage ? new File([PNG], "cover.png", { type: "image/png" }) : undefined);
      await withD1Routes(async () => {
        expect(responseStatus(await create("Via Prisma", { PHOTOS: photos() }, image()))).toBe(302);
        expect(responseStatus(await create("Via D1", { DB: d1.binding, PHOTOS: photos() }, image()))).toBe(302);
      });
      expect(await coverState("Via D1")).toEqual(await coverState("Via Prisma"));
      expect((await coverState("Via D1")).covers).toHaveLength(1);
    });

    it("writes nothing when the cover insert fails, and removes the upload", async () => {
      await db.$executeRawUnsafe(`CREATE TRIGGER "RecipeEditorD1_cover_abort" BEFORE INSERT ON "RecipeCover"
        BEGIN SELECT RAISE(ABORT, 'cover_insert_failed'); END`);
      const bucket = photos();
      try {
        const result = await withD1Routes(() => create("Broken cover", { DB: d1.binding, PHOTOS: bucket }, new File([PNG], "cover.png", { type: "image/png" })));
        expect(responseStatus(result)).toBe(500);
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "RecipeEditorD1_cover_abort"`);
      }
      await expect(db.recipe.count({ where: { title: "Broken cover" } })).resolves.toBe(0);
      expectOneUploadRemoved(bucket.delete);
    });

    it("answers a create that lost its title with the title error, removing the upload and capturing nothing", async () => {
      const bucket = photos();
      const posted: string[] = [];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        posted.push(String(init?.body ?? ""));
        return new Response("ok");
      });
      const result = await withD1Routes(() => create("Taken title", {
        DB: racing(() => db.recipe.create({ data: { title: "Taken title", chefId } })),
        PHOTOS: bucket,
        POSTHOG_KEY: "ph_test",
      }, new File([PNG], "cover.png", { type: "image/png" }))).finally(() => fetchSpy.mockRestore());
      expect(posted.filter((body) => body.includes("$exception"))).toEqual([]);
      expect(responseStatus(result)).toBe(400);
      expect((result as { data: { errors: unknown } }).data.errors).toEqual({ title: "You already have an active recipe with this title" });
      expectOneUploadRemoved(bucket.delete);
      await expect(db.recipe.count({ where: { title: "Taken title" } })).resolves.toBe(1);
    });
  });
});
