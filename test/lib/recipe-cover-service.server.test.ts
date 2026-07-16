import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleAiPlaceholderCover } from "~/lib/ai-placeholder-cover.server";
import { setActiveRecipeCover } from "~/lib/recipe-cover.server";
import {
  activateRecipeCoverWithBestAvailableVariant,
  scheduleRecipePlaceholderGeneration,
} from "~/lib/recipe-cover-service.server";

vi.mock("~/lib/ai-placeholder-cover.server", () => ({
  scheduleAiPlaceholderCover: vi.fn(async () => undefined),
}));

vi.mock("~/lib/recipe-cover.server", () => ({
  setActiveRecipeCover: vi.fn(async () => undefined),
}));

describe("recipe-cover-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("awaits placeholder generation with the shared default scheduling and activation suppression", async () => {
    const db = {} as PrismaClientType;
    const logger = { error: vi.fn() };

    await scheduleRecipePlaceholderGeneration({
      db,
      env: null,
      logger,
    }, {
      userId: "user-1",
      recipeId: "recipe-1",
      coverId: "cover-1",
      title: "Weeknight pasta",
      description: null,
      promptAddition: null,
    });

    expect(scheduleAiPlaceholderCover).toHaveBeenCalledTimes(1);
    expect(scheduleAiPlaceholderCover).toHaveBeenCalledWith({
      db,
      userId: "user-1",
      recipeId: "recipe-1",
      coverId: "cover-1",
      title: "Weeknight pasta",
      description: null,
      promptAddition: null,
      env: null,
      bucket: undefined,
      runner: undefined,
      activateWhenReady: undefined,
      suppressAutoActivation: true,
      activationGuard: undefined,
      logger,
    });
  });

  it("activates the uploaded image variant when no stylized cover is available", async () => {
    const db = {
      recipeCover: {
        findUnique: vi.fn(async () => ({ stylizedImageUrl: null })),
      },
    } as unknown as PrismaClientType;

    await activateRecipeCoverWithBestAvailableVariant(db, {
      recipeId: "recipe-1",
      coverId: "cover-1",
    });

    expect(db.recipeCover.findUnique).toHaveBeenCalledWith({
      where: { id: "cover-1" },
      select: { stylizedImageUrl: true },
    });
    expect(setActiveRecipeCover).toHaveBeenCalledWith(db, {
      recipeId: "recipe-1",
      coverId: "cover-1",
      variant: "image",
    });
  });

  it("activates the stylized variant when one is available and falls back when the cover is missing", async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce({ stylizedImageUrl: "/photos/covers/stylized.png" })
      .mockResolvedValueOnce(null);
    const db = { recipeCover: { findUnique } } as unknown as PrismaClientType;

    await activateRecipeCoverWithBestAvailableVariant(db, {
      recipeId: "recipe-1",
      coverId: "stylized-cover",
    });
    await activateRecipeCoverWithBestAvailableVariant(db, {
      recipeId: "recipe-1",
      coverId: "missing-cover",
    });

    expect(setActiveRecipeCover).toHaveBeenNthCalledWith(1, db, {
      recipeId: "recipe-1",
      coverId: "stylized-cover",
      variant: "stylized",
    });
    expect(setActiveRecipeCover).toHaveBeenNthCalledWith(2, db, {
      recipeId: "recipe-1",
      coverId: "missing-cover",
      variant: "image",
    });
  });
});
