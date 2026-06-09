import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import {
  forkRecipe,
  ForkSourceNotFoundError,
  ForkTitleExhaustedError,
} from "~/lib/recipe-fork.server";
import {
  createTestUser,
  getOrCreateUnit,
  getOrCreateIngredientRef,
} from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

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

describe("recipe-fork.server", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.appliedTitle).toBe("Pasta (variation 4)");
    expect(result.titleWasSuffixed).toBe(true);
  });

  it("uses titleOverride when supplied and no collision exists", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, { title: "Pasta" });

    const result = await forkRecipe(db, {
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

    const result = await forkRecipe(db, {
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
      forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id }),
    ).rejects.toBeInstanceOf(ForkTitleExhaustedError);
  });

  it("throws ForkSourceNotFoundError when the source recipe does not exist", async () => {
    const chef = await makeUser();
    await expect(
      forkRecipe(db, { sourceRecipeId: "nonexistent-id", viewerId: chef.id }),
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
      forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id }),
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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

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

      const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.covers).toHaveLength(0);
    expect(result.recipe.activeCoverId).toBeNull();
    expect(result.recipe.activeCoverVariant).toBeNull();
    expect(result.recipe.coverMode).toBe("auto");
  });

  it("produces no covers when the source has none", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, { title: "NoCover" });

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.covers).toHaveLength(0);
  });

  it("supports forking a chef's own recipe and applies a variation suffix", async () => {
    const chefA = await makeUser();
    const source = await seedSourceRecipe(chefA.id, { title: "Pasta" });

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefA.id });

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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.sourceUrl).toBeNull();
  });

  it("handles a source recipe with zero steps", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await seedSourceRecipe(chefA.id, { title: "Empty", steps: [] });

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

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

    const result = await forkRecipe(db, { sourceRecipeId: source.id, viewerId: chefB.id });

    expect(result.recipe.description).toBe("tasty");
    expect(result.recipe.servings).toBe("4");
  });
});
