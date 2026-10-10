import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Prisma } from "@prisma/client";
import { db } from "~/lib/db.server";
import {
  forkRecipe,
  forkRecipeOnD1,
  readForkSourceFromD1,
  type ForkedRecipeResult,
  type ForkRecipeInput,
  ForkSourceNotFoundError,
  ForkTitleExhaustedError,
} from "~/lib/recipe-fork.server";
import {
  createTestUser,
  getOrCreateUnit,
  getOrCreateIngredientRef,
} from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

// The fork's detail as forkRecipe reads it back, for comparing the D1 fork with the Prisma one.
const forkedDetailInclude = {
  chef: { select: { id: true, email: true, username: true } },
  covers: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }] },
  steps: {
    orderBy: { stepNum: "asc" as const },
    include: { ingredients: { include: { unit: true, ingredientRef: true } } },
  },
} satisfies Prisma.RecipeInclude;

type ForkPath = "prisma" | "d1";
let d1: SqliteD1 | null = null;
let forkPath: ForkPath = "prisma";

/**
 * Forks through the path under test. The D1 fork answers only a summary, so its recipe is read
 * back here with the include forkRecipe uses, and the two paths answer the same shape.
 */
async function fork(input: ForkRecipeInput): Promise<ForkedRecipeResult> {
  if (forkPath === "prisma") return forkRecipe(db, input);
  const summary = await forkRecipeOnD1(d1!.binding, input);
  const recipe = await db.recipe.findUniqueOrThrow({ where: { id: summary.recipeId }, include: forkedDetailInclude });
  return { ...summary, recipe };
}

async function makeUser() {
  return db.user.create({ data: createTestUser() });
}

interface SeedStepInput {
  stepNum: number;
  stepTitle?: string | null;
  description: string;
  duration?: number | null;
  ingredients?: Array<{ ingredientRefName: string; unitName: string; quantity: number }>;
}

async function seedSourceRecipe(
  chefId: string,
  options: {
    title?: string;
    description?: string | null;
    servings?: string | null;
    sourceUrl?: string | null;
    steps?: SeedStepInput[];
    stepOutputUses?: Array<{ outputStepNum: number; inputStepNum: number }>;
    covers?: Array<{
      imageUrl: string;
      stylizedImageUrl?: string | null;
      sourceType?: string;
      sourceSpoonId?: string | null;
      status?: string;
      createdById?: string | null;
      sourceImageUrl?: string | null;
      generationStatus?: string;
      failureReason?: string | null;
      promptVersion?: string | null;
      styleVersion?: string | null;
      archivedAt?: Date | null;
      createdAt?: Date;
    }>;
    coverMode?: "auto" | "manual" | "none";
    activeCoverIndex?: number | null;
    activeCoverVariant?: "image" | "stylized" | null;
    deletedAt?: Date | null;
  } = {},
) {
  const recipe = await db.recipe.create({
    data: {
      title: options.title ?? "Pasta",
      description: options.description ?? null,
      servings: options.servings ?? null,
      sourceUrl: options.sourceUrl ?? null,
      chefId,
      deletedAt: options.deletedAt ?? null,
    },
  });

  for (const step of options.steps ?? []) {
    await db.recipeStep.create({
      data: {
        recipeId: recipe.id,
        stepNum: step.stepNum,
        stepTitle: step.stepTitle ?? null,
        description: step.description,
        duration: step.duration ?? null,
      },
    });

    for (const ing of step.ingredients ?? []) {
      const unit = await getOrCreateUnit(db, ing.unitName);
      const ingRef = await getOrCreateIngredientRef(db, ing.ingredientRefName);
      await db.ingredient.create({
        data: {
          recipeId: recipe.id,
          stepNum: step.stepNum,
          quantity: ing.quantity,
          unitId: unit.id,
          ingredientRefId: ingRef.id,
        },
      });
    }
  }

  for (const sou of options.stepOutputUses ?? []) {
    await db.stepOutputUse.create({
      data: {
        recipeId: recipe.id,
        outputStepNum: sou.outputStepNum,
        inputStepNum: sou.inputStepNum,
      },
    });
  }

  const createdCovers = [];
  for (const cover of options.covers ?? []) {
    const createdCover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: cover.imageUrl,
        stylizedImageUrl: cover.stylizedImageUrl ?? null,
        sourceType: cover.sourceType ?? "chef-upload",
        sourceSpoonId: cover.sourceSpoonId ?? null,
        status: cover.status ?? "ready",
        createdById: cover.createdById ?? null,
        sourceImageUrl: cover.sourceImageUrl ?? null,
        generationStatus: cover.generationStatus ?? "none",
        failureReason: cover.failureReason ?? null,
        promptVersion: cover.promptVersion ?? null,
        styleVersion: cover.styleVersion ?? null,
        archivedAt: cover.archivedAt ?? null,
        ...(cover.createdAt ? { createdAt: cover.createdAt } : {}),
      },
    });
    createdCovers.push(createdCover);
  }

  if (options.coverMode === "none") {
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: null, activeCoverVariant: null, coverMode: "none" },
    });
  } else if (options.activeCoverIndex != null) {
    const active = createdCovers[options.activeCoverIndex];
    if (active) {
      await db.recipe.update({
        where: { id: recipe.id },
        data: {
          activeCoverId: active.id,
          activeCoverVariant: options.activeCoverVariant === undefined ? "image" : options.activeCoverVariant,
          coverMode: options.coverMode ?? "manual",
        },
      });
    }
  }

  return recipe;
}

describe.each<ForkPath>(["prisma", "d1"])("recipe-fork.server (%s)", (path) => {
  beforeEach(async () => {
    await cleanupDatabase();
    forkPath = path;
    d1 = path === "d1" ? sqliteD1() : null;
  });

  afterEach(async () => {
    d1?.close();
    d1 = null;
    await cleanupDatabase();
  });

  it("clones a simple 2-step recipe with ingredients into the viewer's kitchen", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, {
      title: "Pasta",
      description: "tasty",
      servings: "4",
      steps: [
        {
          stepNum: 1,
          stepTitle: "Boil",
          description: "Boil water",
          duration: 5,
          ingredients: [
            { ingredientRefName: "flour-1a", unitName: "cup-1a", quantity: 2 },
            { ingredientRefName: "salt-1a", unitName: "tsp-1a", quantity: 1 },
          ],
        },
        {
          stepNum: 2,
          stepTitle: "Cook",
          description: "Add pasta",
          duration: 10,
          ingredients: [
            { ingredientRefName: "pasta-1a", unitName: "g-1a", quantity: 250 },
          ],
        },
      ],
    });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.id).not.toBe(source.id);
    expect(result.recipe.chefId).toBe(chefB.id);
    expect(result.recipe.sourceRecipeId).toBe(source.id);
    expect(result.recipe.title).toBe("Pasta");
    expect(result.recipe.description).toBe("tasty");
    expect(result.recipe.servings).toBe("4");
    expect(result.recipe.steps).toHaveLength(2);

    const cloneStep1 = result.recipe.steps.find((s) => s.stepNum === 1)!;
    const cloneStep2 = result.recipe.steps.find((s) => s.stepNum === 2)!;
    expect(cloneStep1.stepTitle).toBe("Boil");
    expect(cloneStep1.description).toBe("Boil water");
    expect(cloneStep1.duration).toBe(5);
    expect(cloneStep1.ingredients).toHaveLength(2);
    expect(cloneStep2.ingredients).toHaveLength(1);

    const sourceFlour = await db.ingredientRef.findUnique({ where: { name: "flour-1a" } });
    const sourcePasta = await db.ingredientRef.findUnique({ where: { name: "pasta-1a" } });
    const cloneIngRefIds = cloneStep1.ingredients.map((i) => i.ingredientRefId).sort();
    expect(cloneIngRefIds).toContain(sourceFlour!.id);
    expect(cloneStep2.ingredients[0].ingredientRefId).toBe(sourcePasta!.id);

    expect(result.attribution.sourceRecipeId).toBe(source.id);
    expect(result.attribution.sourceChef.username).toBe(chefA.username);
    expect(result.appliedTitle).toBe("Pasta");
    expect(result.titleWasSuffixed).toBe(false);
  });

  it("clones the step-output-use graph", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, {
      title: "Sou Pasta",
      steps: [
        { stepNum: 1, description: "step1" },
        { stepNum: 2, description: "step2" },
        { stepNum: 3, description: "combine" },
      ],
      stepOutputUses: [
        { outputStepNum: 1, inputStepNum: 3 },
        { outputStepNum: 2, inputStepNum: 3 },
      ],
    });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    const sous = await db.stepOutputUse.findMany({
      where: { recipeId: result.recipe.id },
      orderBy: [{ outputStepNum: "asc" }, { inputStepNum: "asc" }],
    });
    expect(sous).toHaveLength(2);
    expect(sous[0].outputStepNum).toBe(1);
    expect(sous[0].inputStepNum).toBe(3);
    expect(sous[1].outputStepNum).toBe(2);
    expect(sous[1].inputStepNum).toBe(3);
  });

  it("appends '(variation 2)' on a single title collision", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    await seedSourceRecipe(chefB.id, { title: "Pasta" });
    const source = await seedSourceRecipe(chefA.id, { title: "Pasta" });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.appliedTitle).toBe("Pasta (variation 2)");
    expect(result.titleWasSuffixed).toBe(true);
    expect(result.recipe.title).toBe("Pasta (variation 2)");
  });

  it("appends '(variation 4)' when several variations already exist", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    await seedSourceRecipe(chefB.id, { title: "Pasta" });
    await seedSourceRecipe(chefB.id, { title: "Pasta (variation 2)" });
    await seedSourceRecipe(chefB.id, { title: "Pasta (variation 3)" });
    const source = await seedSourceRecipe(chefA.id, { title: "Pasta" });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.appliedTitle).toBe("Pasta (variation 4)");
    expect(result.titleWasSuffixed).toBe(true);
  });

  it("uses titleOverride when supplied and no collision exists", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, { title: "Pasta" });

    const result = await fork({
      sourceRecipeId: source.id,
      viewerId: chefB.id,
      titleOverride: "My Fork",
    });

    expect(result.appliedTitle).toBe("My Fork");
    expect(result.titleWasSuffixed).toBe(false);
    expect(result.recipe.title).toBe("My Fork");
  });

  it("suffixes titleOverride when it collides", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    await seedSourceRecipe(chefB.id, { title: "My Fork" });
    const source = await seedSourceRecipe(chefA.id, { title: "Pasta" });

    const result = await fork({
      sourceRecipeId: source.id,
      viewerId: chefB.id,
      titleOverride: "My Fork",
    });

    expect(result.appliedTitle).toBe("My Fork (variation 2)");
    expect(result.titleWasSuffixed).toBe(true);
  });

  it("throws ForkTitleExhaustedError when 100 variations are taken", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    await seedSourceRecipe(chefB.id, { title: "X" });
    for (let n = 2; n <= 100; n++) {
      await seedSourceRecipe(chefB.id, { title: `X (variation ${n})` });
    }
    const source = await seedSourceRecipe(chefA.id, { title: "X" });

    await expect(
      fork({ sourceRecipeId: source.id, viewerId: chefB.id }),
    ).rejects.toBeInstanceOf(ForkTitleExhaustedError);
  });

  it("throws ForkSourceNotFoundError when the source recipe does not exist", async () => {
    const chef = await makeUser();
    await expect(
      fork({ sourceRecipeId: "nonexistent-id", viewerId: chef.id }),
    ).rejects.toBeInstanceOf(ForkSourceNotFoundError);
  });

  it("throws ForkSourceNotFoundError when the source recipe is soft-deleted", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, {
      title: "Old",
      deletedAt: new Date(),
    });

    await expect(
      fork({ sourceRecipeId: source.id, viewerId: chefB.id }),
    ).rejects.toBeInstanceOf(ForkSourceNotFoundError);
  });

  it("copies the source active cover with provenance and active variant", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, {
      title: "WithCover",
      covers: [
        {
          imageUrl: "https://r2/cover.jpg",
          stylizedImageUrl: "https://r2/stylized.jpg",
          sourceType: "import",
          sourceImageUrl: "https://source.example.com/cover.jpg",
          generationStatus: "succeeded",
          promptVersion: "import-v1",
          styleVersion: "editorial-v2",
        },
      ],
      activeCoverIndex: 0,
      activeCoverVariant: "stylized",
      coverMode: "manual",
    });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.covers).toHaveLength(1);
    const cover = result.recipe.covers[0];
    expect(cover.imageUrl).toBe("https://r2/cover.jpg");
    expect(cover.stylizedImageUrl).toBe("https://r2/stylized.jpg");
    expect(cover.sourceType).toBe("import");
    expect(cover.sourceSpoonId).toBeNull();
    expect(cover.sourceImageUrl).toBe("https://source.example.com/cover.jpg");
    expect(cover.generationStatus).toBe("succeeded");
    expect(cover.promptVersion).toBe("import-v1");
    expect(cover.styleVersion).toBe("editorial-v2");
    expect(result.recipe.activeCoverId).toBe(cover.id);
    expect(result.recipe.activeCoverVariant).toBe("stylized");
    expect(result.recipe.coverMode).toBe("manual");
  });

  it("copies the explicit active cover instead of the latest source cover", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-02-01T00:00:00Z");
    const source = await seedSourceRecipe(chefA.id, {
      title: "MultiCover",
      covers: [
        { imageUrl: "https://r2/old.jpg", createdAt: older },
        { imageUrl: "https://r2/new.jpg", createdAt: newer },
      ],
      activeCoverIndex: 0,
      activeCoverVariant: "image",
      coverMode: "auto",
    });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.covers).toHaveLength(1);
    expect(result.recipe.covers[0].imageUrl).toBe("https://r2/old.jpg");
    expect(result.recipe.activeCoverId).toBe(result.recipe.covers[0].id);
    expect(result.recipe.activeCoverVariant).toBe("image");
    expect(result.recipe.coverMode).toBe("auto");
  });

  it("preserves an intentional no-cover source state", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, {
      title: "NoCoverMode",
      covers: [{ imageUrl: "https://r2/history.jpg" }],
      coverMode: "none",
    });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.covers).toHaveLength(0);
    expect(result.recipe.activeCoverId).toBeNull();
    expect(result.recipe.activeCoverVariant).toBeNull();
    expect(result.recipe.coverMode).toBe("none");
    expect(result.attribution.sourceRecipeId).toBe(source.id);
  });

  it("falls back to a displayable stylized variant when the source active variant is missing", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, {
      title: "StylizedFallback",
      covers: [
        {
          imageUrl: "",
          stylizedImageUrl: "https://r2/editorial.jpg",
          sourceType: "chef-upload",
        },
      ],
      activeCoverIndex: 0,
      activeCoverVariant: null,
      coverMode: "auto",
    });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.covers).toHaveLength(1);
    expect(result.recipe.covers[0].stylizedImageUrl).toBe("https://r2/editorial.jpg");
    expect(result.recipe.activeCoverId).toBe(result.recipe.covers[0].id);
    expect(result.recipe.activeCoverVariant).toBe("stylized");
    expect(result.recipe.coverMode).toBe("auto");
  });

  it("falls back to the raw image variant when stylized is unavailable", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, {
      title: "RawFallback",
      covers: [{ imageUrl: "https://r2/raw.jpg" }],
      activeCoverIndex: 0,
      activeCoverVariant: null,
      coverMode: "auto",
    });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.covers).toHaveLength(1);
    expect(result.recipe.covers[0].imageUrl).toBe("https://r2/raw.jpg");
    expect(result.recipe.activeCoverVariant).toBe("image");
  });

  it("does not copy failed archived or empty active covers", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();

    for (const cover of [
      { title: "FailedCover", status: "failed", imageUrl: "https://r2/failed.jpg" },
      { title: "ArchivedCover", status: "ready", imageUrl: "https://r2/archived.jpg", archivedAt: new Date() },
      { title: "EmptyCover", status: "ready", imageUrl: "" },
    ]) {
      const source = await seedSourceRecipe(chefA.id, {
        title: cover.title,
        covers: [cover],
        activeCoverIndex: 0,
        activeCoverVariant: "image",
        coverMode: "manual",
      });

      const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

      expect(result.recipe.covers).toHaveLength(0);
      expect(result.recipe.activeCoverId).toBeNull();
      expect(result.recipe.activeCoverVariant).toBeNull();
      expect(result.recipe.coverMode).toBe("auto");
    }
  });

  it("does not copy a cross-recipe active cover pointer", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const foreign = await seedSourceRecipe(chefA.id, {
      title: "ForeignCoverOwner",
      covers: [{ imageUrl: "https://r2/foreign.jpg" }],
      activeCoverIndex: 0,
      activeCoverVariant: "image",
    });
    const foreignCover = await db.recipeCover.findFirstOrThrow({
      where: { recipeId: foreign.id },
    });
    const source = await seedSourceRecipe(chefA.id, { title: "CorruptActiveCover" });
    await db.recipe.update({
      where: { id: source.id },
      data: {
        activeCoverId: foreignCover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      },
    });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.covers).toHaveLength(0);
    expect(result.recipe.activeCoverId).toBeNull();
    expect(result.recipe.activeCoverVariant).toBeNull();
    expect(result.recipe.coverMode).toBe("auto");
  });

  it("produces no covers when the source has none", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, { title: "NoCover" });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.covers).toHaveLength(0);
  });

  it("supports forking a chef's own recipe and applies a variation suffix", async () => {
    const chefA = await makeUser();
    const source = await seedSourceRecipe(chefA.id, { title: "Pasta" });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefA.id });

    expect(result.recipe.chefId).toBe(chefA.id);
    expect(result.recipe.sourceRecipeId).toBe(source.id);
    expect(result.appliedTitle).toBe("Pasta (variation 2)");
    expect(result.titleWasSuffixed).toBe(true);
  });

  it("does not propagate sourceUrl from the source recipe", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, {
      title: "FromUrl",
      sourceUrl: "https://example.com/recipe",
    });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.sourceUrl).toBeNull();
  });

  it("handles a source recipe with zero steps", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, { title: "Empty", steps: [] });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.steps).toHaveLength(0);
  });

  it("handles a step with zero ingredients", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, {
      title: "NoIng",
      steps: [
        { stepNum: 1, description: "Just instructions", ingredients: [] },
      ],
    });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.steps).toHaveLength(1);
    expect(result.recipe.steps[0].ingredients).toHaveLength(0);
  });

  it("preserves description and servings from the source", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, {
      title: "DescTest",
      description: "tasty",
      servings: "4",
    });

    const result = await fork({ sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.description).toBe("tasty");
    expect(result.recipe.servings).toBe("4");
  });
});

describe("forkRecipeOnD1", () => {
  let binding: SqliteD1;

  beforeEach(async () => {
    await cleanupDatabase();
    binding = sqliteD1();
  });

  afterEach(async () => {
    binding.close();
    await cleanupDatabase();
  });

  async function richSource(chefId: string, title = "Braised Short Ribs") {
    return seedSourceRecipe(chefId, {
      title,
      description: "Low and slow",
      servings: "6",
      steps: [
        { stepNum: 1, stepTitle: "Sear", description: "Brown the ribs", duration: 15, ingredients: [
          { ingredientRefName: "short ribs", unitName: "lb", quantity: 3 },
          { ingredientRefName: "salt", unitName: "tsp", quantity: 2 },
        ] },
        { stepNum: 2, description: "Make the braise", ingredients: [{ ingredientRefName: "red wine", unitName: "cup", quantity: 2 }] },
        { stepNum: 3, stepTitle: "Braise", description: "Combine and braise", duration: 180 },
      ],
      stepOutputUses: [{ outputStepNum: 1, inputStepNum: 3 }, { outputStepNum: 2, inputStepNum: 3 }],
      covers: [
        { imageUrl: "https://img.example/old.jpg", createdAt: new Date("2026-01-01T00:00:00Z") },
        { imageUrl: "https://img.example/active.jpg", stylizedImageUrl: "https://img.example/active-s.jpg", promptVersion: "p1" },
      ],
      activeCoverIndex: 1,
      activeCoverVariant: "stylized",
    });
  }

  it("reads the source exactly as the Prisma read does, in one round trip", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await richSource(chefA.id);
    const viaPrisma = await db.recipe.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        chef: { select: { id: true, username: true } },
        activeCover: true,
        steps: { orderBy: { stepNum: "asc" }, include: { ingredients: true } },
      },
    });
    const prismaUses = await db.stepOutputUse.findMany({ where: { recipeId: source.id }, select: { outputStepNum: true, inputStepNum: true } });
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

    const before = binding.roundTrips();
    const read = await readForkSourceFromD1(binding.binding, { sourceRecipeId: source.id, viewerId: chefB.id });
    expect(binding.roundTrips() - before).toBe(1);

    const sorted = <T extends { steps: Array<{ ingredients: Array<{ id: string }> }> }>(recipe: T) => ({
      ...recipe,
      steps: recipe.steps.map((step) => ({ ...step, ingredients: [...step.ingredients].sort(byId) })),
    });
    expect(sorted(read!.source)).toEqual(sorted(viaPrisma));
    expect(read!.stepOutputUses).toEqual(expect.arrayContaining(prismaUses));
    expect(read!.stepOutputUses).toHaveLength(prismaUses.length);
    await expect(readForkSourceFromD1(binding.binding, { sourceRecipeId: "missing", viewerId: chefB.id })).resolves.toBeNull();
  });

  it("forks in two round trips however many variations the chef already has", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await richSource(chefA.id, "Stew");
    await seedSourceRecipe(chefB.id, { title: "Stew" });
    for (let n = 2; n <= 6; n++) await seedSourceRecipe(chefB.id, { title: `Stew (variation ${n})` });

    const before = binding.roundTrips();
    const result = await forkRecipeOnD1(binding.binding, { sourceRecipeId: source.id, viewerId: chefB.id });

    expect(binding.roundTrips() - before).toBe(2);
    expect(result).toEqual({
      recipeId: expect.any(String),
      attribution: { sourceRecipeId: source.id, sourceChef: { id: chefA.id, username: chefA.username } },
      appliedTitle: "Stew (variation 7)",
      titleWasSuffixed: true,
    });
  });

  it("matches titles exactly, whatever characters they hold", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const other = await makeUser();
    const cases: Array<{ base: string; taken: string[]; deleted?: string[]; others?: string[]; expected: string }> = [
      // LIKE and GLOB wildcards in a title must not match other titles.
      { base: "50% Rye_Loaf", taken: ["50% Rye_Loaf", "50X Rye-Loaf (variation 2)", "50% Rye_Loaf (variation 3)"], expected: "50% Rye_Loaf (variation 2)" },
      { base: "Crème brûlée", taken: ["Crème brûlée", "Crème brûlée (variation 2)"], expected: "Crème brûlée (variation 3)" },
      { base: "Pie", taken: ["pie", "Pie (Variation 2)", "Pie (variation 2) deluxe"], expected: "Pie" },
      { base: "Soup", taken: [], deleted: ["Soup"], others: ["Soup"], expected: "Soup" },
      { base: "Bread's \"best\"", taken: ["Bread's \"best\""], expected: "Bread's \"best\" (variation 2)" },
    ];
    for (const { base, taken, deleted = [], others = [], expected } of cases) {
      await cleanupForChef(chefB.id);
      for (const title of taken) await seedSourceRecipe(chefB.id, { title });
      for (const title of deleted) {
        const gone = await seedSourceRecipe(chefB.id, { title });
        await db.recipe.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
      }
      for (const title of others) await seedSourceRecipe(other.id, { title });
      const source = await seedSourceRecipe(chefA.id, { title: base });

      const onD1 = await forkRecipeOnD1(binding.binding, { sourceRecipeId: source.id, viewerId: chefB.id });
      expect(onD1.appliedTitle).toBe(expected);
      await db.recipe.update({ where: { id: onD1.recipeId }, data: { deletedAt: new Date() } });
      const viaPrisma = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });
      expect(viaPrisma.appliedTitle).toBe(expected);
    }
  });

  async function cleanupForChef(chefId: string) {
    await db.recipe.deleteMany({ where: { chefId } });
  }

  it("uses the title override, trimmed, and falls back to the source title when it is blank", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await richSource(chefA.id, "Ribs");
    await seedSourceRecipe(chefB.id, { title: "My Ribs" });

    await expect(forkRecipeOnD1(binding.binding, { sourceRecipeId: source.id, viewerId: chefB.id, titleOverride: "  My Ribs  " }))
      .resolves.toMatchObject({ appliedTitle: "My Ribs (variation 2)", titleWasSuffixed: true });
    await expect(forkRecipeOnD1(binding.binding, { sourceRecipeId: source.id, viewerId: chefB.id, titleOverride: "   " }))
      .resolves.toMatchObject({ appliedTitle: "Ribs", titleWasSuffixed: false });
  });

  it("picks the next free title when another recipe takes it while the fork writes", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await richSource(chefA.id, "Stew");
    let raced = 0;
    const racing = racingBinding(binding, async () => {
      raced++;
      if (raced <= 1) await seedSourceRecipe(chefB.id, { title: "Stew" });
    });

    const before = binding.roundTrips();
    const result = await forkRecipeOnD1(racing as never, { sourceRecipeId: source.id, viewerId: chefB.id });

    // Read, refused write, titles read again, write.
    expect(binding.roundTrips() - before).toBe(4);
    expect(result).toMatchObject({ appliedTitle: "Stew (variation 2)", titleWasSuffixed: true });
    const titles = (await db.recipe.findMany({ where: { chefId: chefB.id }, select: { title: true } })).map((r) => r.title).sort();
    expect(titles).toEqual(["Stew", "Stew (variation 2)"]);
  });

  it("gives up after three races for the title", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await richSource(chefA.id, "Stew");
    let raced = 0;
    const racing = racingBinding(binding, async () => {
      raced++;
      await seedSourceRecipe(chefB.id, { title: raced === 1 ? "Stew" : `Stew (variation ${raced})` });
    });

    await expect(forkRecipeOnD1(racing as never, { sourceRecipeId: source.id, viewerId: chefB.id }))
      .rejects.toBeInstanceOf(ForkTitleExhaustedError);
    expect(raced).toBe(3);
    expect(await db.recipe.count({ where: { chefId: chefB.id, sourceRecipeId: source.id } })).toBe(0);
  });
});

/** A binding that runs `beforeWrite` before each batch that inserts a recipe. */
function racingBinding(d1: SqliteD1, beforeWrite: () => Promise<void>) {
  return {
    prepare: d1.binding.prepare.bind(d1.binding),
    batch: async (statements: Parameters<SqliteD1["binding"]["batch"]>[0]) => {
      if (statements.some((statement) => /^\s*INSERT INTO "Recipe"/.test(statement.sql))) await beforeWrite();
      return d1.binding.batch(statements);
    },
  };
}
