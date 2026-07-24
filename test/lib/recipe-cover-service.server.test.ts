import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleAiPlaceholderCover } from "~/lib/ai-placeholder-cover.server";
import {
  scheduleRecipePlaceholderGeneration,
} from "~/lib/recipe-cover-service.server";

vi.mock("~/lib/ai-placeholder-cover.server", () => ({
  scheduleAiPlaceholderCover: vi.fn(async () => undefined),
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

});
