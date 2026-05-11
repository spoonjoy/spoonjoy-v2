import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "~/lib/db.server";
import {
  createSpoon,
  updateSpoon,
  deleteSpoon,
  listSpoonsForRecipe,
  listSpoonsByChef,
  isOriginCookCandidate,
  SpoonValidationError,
  SpoonAuthError,
  SpoonNotFoundError,
} from "~/lib/recipe-spoon.server";
import { createTestUser, createTestRecipe } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

async function makeUser() {
  return db.user.create({ data: createTestUser() });
}

async function makeRecipe(chefId: string) {
  return db.recipe.create({ data: { ...createTestRecipe(chefId), chefId } });
}

function makePhotoFile(name = "photo.png", size = 1024, type = "image/png"): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("recipe-spoon.server", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("createSpoon", () => {
    it("creates a spoon with only a note for a non-owner cook", async () => {
      const chef = await makeUser();
      const cook = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const result = await createSpoon(db, {
        chefId: cook.id,
        recipeId: recipe.id,
        note: "tasted great",
      });
      expect(result.spoon.recipeId).toBe(recipe.id);
      expect(result.spoon.chefId).toBe(cook.id);
      expect(result.spoon.note).toBe("tasted great");
      expect(result.spoon.photoUrl).toBeNull();
      expect(result.spoon.nextTime).toBeNull();
      expect(result.spoon.deletedAt).toBeNull();
      expect(result.isOriginCook).toBe(false);
    });

    it("creates a spoon with only nextTime when chef is not recipe owner", async () => {
      const chef = await makeUser();
      const cook = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const result = await createSpoon(db, {
        chefId: cook.id,
        recipeId: recipe.id,
        nextTime: "add more salt",
      });
      expect(result.spoon.nextTime).toBe("add more salt");
      expect(result.isOriginCook).toBe(false);
    });

    it("uploads photo via storeImage when photoFile provided", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const fakeBucket = {
        put: vi.fn().mockResolvedValue(undefined),
      } as unknown as R2Bucket;
      const result = await createSpoon(
        db,
        {
          chefId: chef.id,
          recipeId: recipe.id,
          photoFile: makePhotoFile("a.png", 4, "image/png"),
          note: "cooked",
        },
        { bucket: fakeBucket, now: () => 1234567 }
      );
      expect(fakeBucket.put).toHaveBeenCalledTimes(1);
      const [keyArg] = (fakeBucket.put as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(keyArg).toBe(`spoons/${chef.id}/${recipe.id}/1234567.png`);
      expect(result.spoon.photoUrl).toBe(`/photos/spoons/${chef.id}/${recipe.id}/1234567.png`);
    });

    it("falls back to data URL when no bucket provided", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const result = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile("a.png", 2, "image/png"),
      });
      expect(result.spoon.photoUrl?.startsWith("data:image/png;base64,")).toBe(true);
    });

    it("throws SpoonValidationError when all content fields empty", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const cook = await makeUser();
      await expect(
        createSpoon(db, { chefId: cook.id, recipeId: recipe.id })
      ).rejects.toBeInstanceOf(SpoonValidationError);
    });

    it("treats whitespace-only note and nextTime as empty (validation triggers)", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const cook = await makeUser();
      await expect(
        createSpoon(db, {
          chefId: cook.id,
          recipeId: recipe.id,
          note: "   ",
          nextTime: "\t\n",
        })
      ).rejects.toBeInstanceOf(SpoonValidationError);
    });

    it("trims note/nextTime; stores trimmed values", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const cook = await makeUser();
      const result = await createSpoon(db, {
        chefId: cook.id,
        recipeId: recipe.id,
        note: "  hi  ",
        nextTime: " add cheese ",
      });
      expect(result.spoon.note).toBe("hi");
      expect(result.spoon.nextTime).toBe("add cheese");
    });

    it("origin-cook with no photoFile throws SpoonValidationError", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      await expect(
        createSpoon(db, {
          chefId: chef.id,
          recipeId: recipe.id,
          note: "looks great",
        })
      ).rejects.toBeInstanceOf(SpoonValidationError);
    });

    it("origin-cook with photoFile succeeds and reports isOriginCook=true", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const result = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      expect(result.isOriginCook).toBe(true);
      expect(result.spoon.photoUrl).toBeTruthy();
    });

    it("origin-cook flag is false on the chef's second cook of their own recipe", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      const second = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        note: "again",
      });
      expect(second.isOriginCook).toBe(false);
    });

    it("origin-cook flag re-applies after the first spoon is soft-deleted", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const first = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      await deleteSpoon(db, first.spoon.id, chef.id);
      const second = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      expect(second.isOriginCook).toBe(true);
    });

    it("respects an explicit cookedAt date", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const when = new Date("2025-06-01T12:00:00Z");
      const result = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
        cookedAt: when,
      });
      expect(result.spoon.cookedAt.toISOString()).toBe(when.toISOString());
    });
  });

  describe("updateSpoon", () => {
    it("updates note/nextTime/cookedAt/photoUrl", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      const when = new Date("2026-01-01T00:00:00Z");
      const updated = await updateSpoon(db, created.spoon.id, chef.id, {
        note: "after edit",
        nextTime: "salt earlier",
        cookedAt: when,
        photoUrl: "/photos/spoons/x/y/123.png",
      });
      expect(updated.note).toBe("after edit");
      expect(updated.nextTime).toBe("salt earlier");
      expect(updated.cookedAt.toISOString()).toBe(when.toISOString());
      expect(updated.photoUrl).toBe("/photos/spoons/x/y/123.png");
    });

    it("rejects update from a non-owner with SpoonAuthError", async () => {
      const chef = await makeUser();
      const cook = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      await expect(
        updateSpoon(db, created.spoon.id, cook.id, { note: "evil" })
      ).rejects.toBeInstanceOf(SpoonAuthError);
    });

    it("rejects update on a soft-deleted spoon with SpoonNotFoundError", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      await deleteSpoon(db, created.spoon.id, chef.id);
      await expect(
        updateSpoon(db, created.spoon.id, chef.id, { note: "late" })
      ).rejects.toBeInstanceOf(SpoonNotFoundError);
    });

    it("rejects update against missing spoon with SpoonNotFoundError", async () => {
      const chef = await makeUser();
      await expect(
        updateSpoon(db, "does-not-exist", chef.id, { note: "x" })
      ).rejects.toBeInstanceOf(SpoonNotFoundError);
    });

    it("rejects an update that empties all content fields", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
        note: "ok",
      });
      await expect(
        updateSpoon(db, created.spoon.id, chef.id, {
          note: "",
          nextTime: "",
          photoUrl: null,
        })
      ).rejects.toBeInstanceOf(SpoonValidationError);
    });

    it("leaves note alone when patch.note is undefined", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
        note: "keep me",
      });
      const updated = await updateSpoon(db, created.spoon.id, chef.id, {
        nextTime: "salt more",
      });
      expect(updated.note).toBe("keep me");
      expect(updated.nextTime).toBe("salt more");
    });

    it("leaves nextTime alone when patch.nextTime is undefined", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
        nextTime: "keep next-time",
      });
      const updated = await updateSpoon(db, created.spoon.id, chef.id, {
        note: "fresh note",
      });
      expect(updated.note).toBe("fresh note");
      expect(updated.nextTime).toBe("keep next-time");
    });

    it("trims string patches and treats empty strings as nulls", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      const updated = await updateSpoon(db, created.spoon.id, chef.id, {
        note: "  trimmed  ",
        nextTime: "",
      });
      expect(updated.note).toBe("trimmed");
      expect(updated.nextTime).toBeNull();
    });
  });

  describe("deleteSpoon", () => {
    it("soft-deletes a spoon owned by requesting user", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      const before = new Date();
      const deleted = await deleteSpoon(db, created.spoon.id, chef.id);
      expect(deleted.deletedAt).not.toBeNull();
      expect(deleted.deletedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });

    it("rejects delete from non-owner with SpoonAuthError", async () => {
      const chef = await makeUser();
      const cook = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      await expect(
        deleteSpoon(db, created.spoon.id, cook.id)
      ).rejects.toBeInstanceOf(SpoonAuthError);
    });

    it("rejects re-delete on a soft-deleted spoon with SpoonNotFoundError", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      await deleteSpoon(db, created.spoon.id, chef.id);
      await expect(
        deleteSpoon(db, created.spoon.id, chef.id)
      ).rejects.toBeInstanceOf(SpoonNotFoundError);
    });

    it("rejects delete against missing spoon with SpoonNotFoundError", async () => {
      const chef = await makeUser();
      await expect(
        deleteSpoon(db, "nope", chef.id)
      ).rejects.toBeInstanceOf(SpoonNotFoundError);
    });
  });

  describe("listSpoonsForRecipe", () => {
    it("returns non-deleted spoons ordered by cookedAt desc, id desc", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const cook = await makeUser();
      const first = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
        cookedAt: new Date("2025-01-01T00:00:00Z"),
      });
      const second = await createSpoon(db, {
        chefId: cook.id,
        recipeId: recipe.id,
        note: "later",
        cookedAt: new Date("2025-02-01T00:00:00Z"),
      });
      const list = await listSpoonsForRecipe(db, recipe.id);
      expect(list.map((s) => s.id)).toEqual([second.spoon.id, first.spoon.id]);
    });

    it("excludes soft-deleted by default", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      await deleteSpoon(db, created.spoon.id, chef.id);
      const list = await listSpoonsForRecipe(db, recipe.id);
      expect(list).toHaveLength(0);
    });

    it("includes soft-deleted when includeDeleted=true", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      await deleteSpoon(db, created.spoon.id, chef.id);
      const list = await listSpoonsForRecipe(db, recipe.id, { includeDeleted: true });
      expect(list).toHaveLength(1);
    });

    it("respects limit and offset", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const cooks = await Promise.all([makeUser(), makeUser(), makeUser()]);
      const created = [];
      for (let i = 0; i < cooks.length; i++) {
        const s = await createSpoon(db, {
          chefId: cooks[i].id,
          recipeId: recipe.id,
          note: `note-${i}`,
          cookedAt: new Date(2025, 0, i + 1),
        });
        created.push(s.spoon.id);
      }
      const limited = await listSpoonsForRecipe(db, recipe.id, { limit: 1 });
      expect(limited).toHaveLength(1);
      const paged = await listSpoonsForRecipe(db, recipe.id, { limit: 1, offset: 1 });
      expect(paged).toHaveLength(1);
      expect(paged[0].id).toBe(created[1]);
    });

    it("clamps limit above the max", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const list = await listSpoonsForRecipe(db, recipe.id, { limit: 9999 });
      expect(list.length).toBeLessThanOrEqual(50);
    });

    it("defaults limit when below 1", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const cook = await makeUser();
      await createSpoon(db, { chefId: cook.id, recipeId: recipe.id, note: "x" });
      const list = await listSpoonsForRecipe(db, recipe.id, { limit: 0 });
      expect(list.length).toBe(1);
    });

    it("includes chef relation with id, username, photoUrl", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const cook = await makeUser();
      await createSpoon(db, { chefId: cook.id, recipeId: recipe.id, note: "y" });
      const list = await listSpoonsForRecipe(db, recipe.id);
      expect(list[0].chef).toMatchObject({ id: cook.id, username: cook.username });
      expect(list[0].chef).toHaveProperty("photoUrl");
    });
  });

  describe("listSpoonsByChef", () => {
    it("resolves chef by id", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      const list = await listSpoonsByChef(db, chef.id);
      expect(list).toHaveLength(1);
      expect(list[0].recipe).toMatchObject({ id: recipe.id, title: recipe.title });
      expect(list[0].recipe.covers).toBeDefined();
    });

    it("resolves chef by username", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      const list = await listSpoonsByChef(db, chef.username);
      expect(list).toHaveLength(1);
    });

    it("throws SpoonNotFoundError when chef does not exist", async () => {
      await expect(
        listSpoonsByChef(db, "ghost-user-zzz-no-such")
      ).rejects.toBeInstanceOf(SpoonNotFoundError);
    });

    it("excludes soft-deleted spoons by default", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      await deleteSpoon(db, created.spoon.id, chef.id);
      const list = await listSpoonsByChef(db, chef.id);
      expect(list).toHaveLength(0);
    });

    it("includes soft-deleted spoons when includeDeleted=true", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const created = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      await deleteSpoon(db, created.spoon.id, chef.id);
      const list = await listSpoonsByChef(db, chef.id, { includeDeleted: true });
      expect(list).toHaveLength(1);
    });

    it("respects limit and offset; orders by cookedAt desc", async () => {
      const chef = await makeUser();
      const r1 = await makeRecipe(chef.id);
      const r2 = await makeRecipe(chef.id);
      const first = await createSpoon(db, {
        chefId: chef.id,
        recipeId: r1.id,
        photoFile: makePhotoFile(),
        cookedAt: new Date("2025-01-01T00:00:00Z"),
      });
      const second = await createSpoon(db, {
        chefId: chef.id,
        recipeId: r2.id,
        photoFile: makePhotoFile(),
        cookedAt: new Date("2025-02-01T00:00:00Z"),
      });
      const list = await listSpoonsByChef(db, chef.id, { limit: 10 });
      expect(list.map((s) => s.id)).toEqual([second.spoon.id, first.spoon.id]);
      const paged = await listSpoonsByChef(db, chef.id, { limit: 1, offset: 1 });
      expect(paged.map((s) => s.id)).toEqual([first.spoon.id]);
    });
  });

  describe("isOriginCookCandidate", () => {
    it("true when chef owns the recipe and has no prior non-deleted spoon", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      expect(await isOriginCookCandidate(db, chef.id, recipe.id)).toBe(true);
    });

    it("false when chef does not own the recipe", async () => {
      const chef = await makeUser();
      const cook = await makeUser();
      const recipe = await makeRecipe(chef.id);
      expect(await isOriginCookCandidate(db, cook.id, recipe.id)).toBe(false);
    });

    it("false when chef has a prior non-deleted spoon", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      expect(await isOriginCookCandidate(db, chef.id, recipe.id)).toBe(false);
    });

    it("true again after the prior spoon is soft-deleted", async () => {
      const chef = await makeUser();
      const recipe = await makeRecipe(chef.id);
      const first = await createSpoon(db, {
        chefId: chef.id,
        recipeId: recipe.id,
        photoFile: makePhotoFile(),
      });
      await deleteSpoon(db, first.spoon.id, chef.id);
      expect(await isOriginCookCandidate(db, chef.id, recipe.id)).toBe(true);
    });

    it("false when recipe does not exist", async () => {
      const chef = await makeUser();
      expect(await isOriginCookCandidate(db, chef.id, "missing-recipe")).toBe(false);
    });
  });

  describe("error class metadata", () => {
    it("SpoonValidationError carries status 400", () => {
      const err = new SpoonValidationError("bad");
      expect(err.status).toBe(400);
      expect(err.name).toBe("SpoonValidationError");
    });
    it("SpoonAuthError carries status 403", () => {
      const err = new SpoonAuthError("nope");
      expect(err.status).toBe(403);
      expect(err.name).toBe("SpoonAuthError");
    });
    it("SpoonNotFoundError carries status 404", () => {
      const err = new SpoonNotFoundError("gone");
      expect(err.status).toBe(404);
      expect(err.name).toBe("SpoonNotFoundError");
    });
  });
});
