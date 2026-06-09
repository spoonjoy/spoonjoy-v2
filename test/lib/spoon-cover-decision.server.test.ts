import { describe, expect, it, vi } from "vitest";
import { deferBackgroundTask } from "~/lib/background-task.server";
import {
  decideSpoonCoverCreation,
  getSpoonCoverPromptMode,
  hasActiveRealRecipeCover,
  type ActiveCoverForSpoonDecision,
  type RecipeForSpoonCoverDecision,
} from "~/lib/spoon-cover-decision.server";

function cover(overrides: Partial<ActiveCoverForSpoonDecision> = {}): ActiveCoverForSpoonDecision {
  return {
    id: "cover-1",
    recipeId: "recipe-1",
    sourceType: "spoon",
    status: "ready",
    archivedAt: null,
    imageUrl: "https://example.com/raw.jpg",
    stylizedImageUrl: "https://example.com/editorial.jpg",
    ...overrides,
  };
}

function recipe(overrides: Partial<RecipeForSpoonCoverDecision> = {}): RecipeForSpoonCoverDecision {
  return {
    id: "recipe-1",
    chefId: "chef-1",
    coverMode: "auto",
    activeCoverId: "cover-1",
    activeCoverVariant: "image",
    activeCover: cover(),
    ...overrides,
  };
}

describe("spoon-cover-decision.server", () => {
  describe("hasActiveRealRecipeCover", () => {
    it("returns false when no active cover is selected", () => {
      expect(hasActiveRealRecipeCover(recipe({ activeCoverId: null }))).toBe(false);
    });

    it("returns false when the active cover row is missing or mismatched", () => {
      expect(hasActiveRealRecipeCover(recipe({ activeCover: null }))).toBe(false);
      expect(hasActiveRealRecipeCover(recipe({ activeCover: cover({ id: "other" }) }))).toBe(false);
      expect(hasActiveRealRecipeCover(recipe({ activeCover: cover({ recipeId: "other-recipe" }) }))).toBe(false);
    });

    it("returns false for inactive lifecycle states", () => {
      expect(hasActiveRealRecipeCover(recipe({ activeCover: cover({ status: "processing" }) }))).toBe(false);
      expect(hasActiveRealRecipeCover(recipe({ activeCover: cover({ archivedAt: new Date("2026-01-01") }) }))).toBe(false);
      expect(hasActiveRealRecipeCover(recipe({ activeCover: cover({ sourceType: "ai-placeholder" }) }))).toBe(false);
    });

    it("requires the selected variant to have a URL", () => {
      expect(hasActiveRealRecipeCover(recipe({ activeCoverVariant: "image", activeCover: cover({ imageUrl: "" }) }))).toBe(false);
      expect(hasActiveRealRecipeCover(recipe({ activeCoverVariant: "stylized", activeCover: cover({ stylizedImageUrl: null }) }))).toBe(false);
      expect(hasActiveRealRecipeCover(recipe({ activeCoverVariant: null, activeCover: cover({ imageUrl: "", stylizedImageUrl: "" }) }))).toBe(false);
    });

    it("accepts verbatim, editorialized, and fallback active URLs", () => {
      expect(hasActiveRealRecipeCover(recipe({ activeCoverVariant: "image" }))).toBe(true);
      expect(hasActiveRealRecipeCover(recipe({ activeCoverVariant: "stylized" }))).toBe(true);
      expect(hasActiveRealRecipeCover(recipe({ activeCoverVariant: null, activeCover: cover({ imageUrl: "", stylizedImageUrl: "https://example.com/editorial.jpg" }) }))).toBe(true);
    });
  });

  describe("getSpoonCoverPromptMode", () => {
    it("hides cover prompts from non-owners", () => {
      expect(getSpoonCoverPromptMode({
        isOwner: false,
        isOriginCookCandidate: true,
        coverMode: "auto",
        hasActiveRealCover: false,
      })).toBe("none");
    });

    it("asks for the first chef photo when auto mode has no real cover", () => {
      expect(getSpoonCoverPromptMode({
        isOwner: true,
        isOriginCookCandidate: true,
        coverMode: "auto",
        hasActiveRealCover: false,
      })).toBe("first-photo");
    });

    it("uses optional update mode for later or non-auto owner posts", () => {
      expect(getSpoonCoverPromptMode({
        isOwner: true,
        isOriginCookCandidate: false,
        coverMode: "auto",
        hasActiveRealCover: false,
      })).toBe("optional-update");
      expect(getSpoonCoverPromptMode({
        isOwner: true,
        isOriginCookCandidate: true,
        coverMode: "manual",
        hasActiveRealCover: false,
      })).toBe("optional-update");
      expect(getSpoonCoverPromptMode({
        isOwner: true,
        isOriginCookCandidate: true,
        coverMode: "auto",
        hasActiveRealCover: true,
      })).toBe("optional-update");
    });
  });

  describe("decideSpoonCoverCreation", () => {
    it("does not create a cover without a photo", () => {
      expect(decideSpoonCoverCreation({
        recipe: recipe({ activeCoverId: null, activeCover: null }),
        userId: "chef-1",
        isOriginCook: true,
        hasPhoto: false,
        useAsRecipeCover: true,
      })).toEqual({ shouldCreateCover: false, reason: "no-photo" });
    });

    it("does not let non-owners update the recipe cover", () => {
      expect(decideSpoonCoverCreation({
        recipe: recipe({ activeCoverId: null, activeCover: null }),
        userId: "chef-2",
        isOriginCook: true,
        hasPhoto: true,
        useAsRecipeCover: true,
      })).toEqual({ shouldCreateCover: false, reason: "not-owner" });
    });

    it("auto-seeds the first owner spoon photo only when auto mode has no real cover", () => {
      expect(decideSpoonCoverCreation({
        recipe: recipe({ activeCoverId: null, activeCover: null }),
        userId: "chef-1",
        isOriginCook: true,
        hasPhoto: true,
        useAsRecipeCover: false,
      })).toEqual({
        shouldCreateCover: true,
        reason: "auto-seed",
        coverMode: "auto",
        activeCoverVariant: null,
      });
    });

    it("uses manual image activation for explicit owner opt-in", () => {
      expect(decideSpoonCoverCreation({
        recipe: recipe(),
        userId: "chef-1",
        isOriginCook: false,
        hasPhoto: true,
        useAsRecipeCover: true,
      })).toEqual({
        shouldCreateCover: true,
        reason: "manual-opt-in",
        coverMode: "manual",
        activeCoverVariant: "image",
      });
    });

    it("leaves later owner photos alone when the owner does not opt in", () => {
      expect(decideSpoonCoverCreation({
        recipe: recipe(),
        userId: "chef-1",
        isOriginCook: false,
        hasPhoto: true,
        useAsRecipeCover: false,
      })).toEqual({ shouldCreateCover: false, reason: "not-requested" });
    });
  });
});

describe("background-task.server", () => {
  it("defers starting the task until the next timer tick", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => "done");

    const promise = deferBackgroundTask(task);
    expect(task).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBe("done");
    expect(task).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
