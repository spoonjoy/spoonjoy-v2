import { afterEach, describe, expect, it, vi } from "vitest";

const now = new Date("2026-06-01T00:00:00.000Z");

function principal() {
  return {
    id: "chef_1",
    email: "chef@example.com",
    username: "chef",
    source: "bearer",
    scopes: ["kitchen:write"],
    credentialId: "cred_1",
    oauthClientId: null,
    oauthResource: null,
  };
}

function recipe() {
  return {
    id: "recipe_1",
    title: "Telemetry pasta",
    chefId: "chef_1",
    activeCoverId: null,
    activeCoverVariant: null,
    coverMode: "auto",
    activeCover: null,
  };
}

function spoon() {
  return {
    id: "spoon_1",
    chefId: "chef_1",
    recipeId: "recipe_1",
    cookedAt: now,
    photoUrl: "/photos/spoons/chef_1/recipe_1/raw.png",
    note: "Cooked",
    nextTime: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function cover() {
  return {
    id: "cover_1",
    recipeId: "recipe_1",
    status: "processing",
    sourceType: "spoon",
    imageUrl: "/photos/spoons/chef_1/recipe_1/raw.png",
    stylizedImageUrl: null,
    sourceSpoonId: "spoon_1",
    createdById: "chef_1",
    archivedAt: null,
    generationStatus: "processing",
    failureReason: null,
    sourceImageUrl: "/photos/spoons/chef_1/recipe_1/raw.png",
    createdAt: now,
  };
}

async function setupMockedModule() {
  vi.resetModules();
  const { ApiAuthError } = await import("~/lib/api-auth.server");
  const validateSpoonPhotoAssignment = vi.fn(async () => ({ stylizable: true }));
  const createSpoon = vi.fn();
  const updateSpoon = vi.fn();
  const deleteSpoon = vi.fn();
  class SpoonValidationError extends Error {
    status = 400;
  }
  class SpoonAuthError extends Error {
    status = 403;
  }
  class SpoonNotFoundError extends Error {
    status = 404;
  }
  const activateSpoonCoverForDecision = vi.fn(async () => undefined);
  const scheduleSpoonCoverStylization = vi.fn(async () => undefined);
  const notifySpoonOnMyRecipe = vi.fn(async () => ({ eventId: "event_1", queuedSends: 0 }));
  const fanoutFellowChefOriginCook = vi.fn(async () => ({ recipientsNotified: 1, queuedSends: 0 }));

  vi.doMock("~/lib/recipe-image-assignment.server", () => ({
    validateSpoonPhotoAssignment,
  }));
  vi.doMock("~/lib/recipe-spoon.server", () => ({
    createSpoon,
    updateSpoon,
    deleteSpoon,
    SpoonValidationError,
    SpoonAuthError,
    SpoonNotFoundError,
  }));
  vi.doMock("~/lib/spoon-cover-activation.server", () => ({
    activateSpoonCoverForDecision,
  }));
  vi.doMock("~/lib/spoon-cover-stylization.server", () => ({
    scheduleSpoonCoverStylization,
  }));
  vi.doMock("~/lib/notification-triggers.server", () => ({
    notifySpoonOnMyRecipe,
  }));
  vi.doMock("~/lib/notification-fanout.server", () => ({
    fanoutFellowChefOriginCook,
  }));

  return {
    ApiAuthError,
    SpoonAuthError,
    SpoonNotFoundError,
    activateSpoonCoverForDecision,
    createSpoon,
    deleteSpoon,
    fanoutFellowChefOriginCook,
    module: await import("~/lib/api-v1-spoons.server"),
    notifySpoonOnMyRecipe,
    scheduleSpoonCoverStylization,
    updateSpoon,
    validateSpoonPhotoAssignment,
  };
}

function mockDb() {
  const spoonRow = spoon();
  const coverRow = cover();
  return {
    recipe: {
      findFirst: vi.fn(async () => recipe()),
      findUniqueOrThrow: vi.fn(async () => ({ activeCoverId: coverRow.id, activeCoverVariant: "image" })),
    },
    recipeCover: {
      create: vi.fn(async () => coverRow),
      findFirst: vi.fn(async () => coverRow),
      findUniqueOrThrow: vi.fn(async () => coverRow),
    },
    recipeSpoon: {
      findUnique: vi.fn(async () => spoonRow),
      findFirst: vi.fn(async () => null),
    },
    notificationEvent: {
      findMany: vi.fn(async () => []),
    },
  };
}

describe("api-v1 spoon helpers", () => {
  afterEach(() => {
    vi.doUnmock("~/lib/recipe-image-assignment.server");
    vi.doUnmock("~/lib/recipe-spoon.server");
    vi.doUnmock("~/lib/spoon-cover-activation.server");
    vi.doUnmock("~/lib/spoon-cover-stylization.server");
    vi.doUnmock("~/lib/notification-triggers.server");
    vi.doUnmock("~/lib/notification-fanout.server");
    vi.resetModules();
  });

  it("maps lower-level auth and spoon dependency failures to API v1 errors", async () => {
    const mocked = await setupMockedModule();
    const db = mockDb() as never;
    const actor = principal() as never;
    const reservation = { id: "idem_1" } as never;

    mocked.validateSpoonPhotoAssignment.mockRejectedValueOnce(new mocked.ApiAuthError("photo missing", 404));
    await expect(mocked.module.createNativeRecipeSpoon(db, null, actor, "recipe_1", {
      clientMutationId: "photo-missing",
      photoUrl: "/photos/spoons/chef_1/missing.png",
      useAsRecipeCover: false,
    }, reservation)).resolves.toMatchObject({ ok: false, code: "not_found" });

    mocked.validateSpoonPhotoAssignment.mockRejectedValueOnce(new mocked.ApiAuthError("photo forbidden", 403));
    await expect(mocked.module.createNativeRecipeSpoon(db, null, actor, "recipe_1", {
      clientMutationId: "photo-forbidden",
      photoUrl: "/photos/spoons/chef_1/forbidden.png",
      useAsRecipeCover: false,
    }, reservation)).resolves.toMatchObject({ ok: false, code: "insufficient_scope" });

    mocked.createSpoon.mockRejectedValueOnce(new mocked.SpoonNotFoundError("spoon source missing"));
    await expect(mocked.module.createNativeRecipeSpoon(db, null, actor, "recipe_1", {
      clientMutationId: "spoon-not-found",
      note: "Cooked",
      useAsRecipeCover: false,
    }, reservation)).resolves.toMatchObject({ ok: false, code: "not_found" });

    mocked.createSpoon.mockRejectedValueOnce(new mocked.SpoonAuthError("spoon forbidden"));
    await expect(mocked.module.createNativeRecipeSpoon(db, null, actor, "recipe_1", {
      clientMutationId: "spoon-auth",
      note: "Cooked",
      useAsRecipeCover: false,
    }, reservation)).resolves.toMatchObject({ ok: false, code: "insufficient_scope" });

    mocked.createSpoon.mockRejectedValueOnce(new Error("generic spoon failure"));
    await expect(mocked.module.createNativeRecipeSpoon(db, null, actor, "recipe_1", {
      clientMutationId: "spoon-generic-error",
      note: "Cooked",
      useAsRecipeCover: false,
    }, reservation)).resolves.toMatchObject({
      ok: false,
      code: "validation_error",
      message: "generic spoon failure",
    });

    mocked.deleteSpoon.mockRejectedValueOnce("non-error delete failure");
    await expect(mocked.module.deleteNativeRecipeSpoon(db, actor, "recipe_1", "spoon_1", {
      clientMutationId: "delete-non-error",
    }, reservation)).resolves.toMatchObject({
      ok: false,
      code: "validation_error",
      message: "Spoon mutation failed",
    });
  });

  it("schedules cover stylization through waitUntil and absorbs async failures", async () => {
    const mocked = await setupMockedModule();
    const db = mockDb() as never;
    const actor = principal() as never;
    const reservation = { id: "idem_2" } as never;
    const scheduled: Promise<unknown>[] = [];
    mocked.createSpoon.mockResolvedValueOnce({ spoon: spoon(), isOriginCook: true });
    mocked.scheduleSpoonCoverStylization.mockRejectedValueOnce(new Error("stylization failed"));

    const result = await mocked.module.createNativeRecipeSpoon(db, {}, actor, "recipe_1", {
      clientMutationId: "cover-stylization",
      photoUrl: "/photos/spoons/chef_1/recipe_1/raw.png",
      useAsRecipeCover: false,
    }, reservation, (promise) => scheduled.push(promise));

    expect(result).toMatchObject({
      ok: true,
      data: {
        data: {
          cover: {
            id: "cover_1",
            activeVariant: "image",
            displayUrl: "/photos/spoons/chef_1/recipe_1/raw.png",
          },
        },
      },
    });
    expect(mocked.activateSpoonCoverForDecision).toHaveBeenCalledOnce();
    expect(mocked.scheduleSpoonCoverStylization).toHaveBeenCalledOnce();
    expect(scheduled).toHaveLength(1);
    await expect(Promise.all(scheduled)).resolves.toEqual([undefined]);

    const emptyCover = {
      ...cover(),
      id: "cover_empty",
      imageUrl: "",
      stylizedImageUrl: null,
      sourceImageUrl: "",
    };
    db.recipeCover.create.mockResolvedValueOnce(emptyCover);
    db.recipe.findUniqueOrThrow.mockResolvedValueOnce({ activeCoverId: emptyCover.id, activeCoverVariant: null });
    db.recipeCover.findUniqueOrThrow.mockResolvedValueOnce(emptyCover);
    mocked.createSpoon.mockResolvedValueOnce({ spoon: spoon(), isOriginCook: true });

    await expect(mocked.module.createNativeRecipeSpoon(db, {}, actor, "recipe_1", {
      clientMutationId: "cover-without-display-url",
      photoUrl: "/photos/spoons/chef_1/recipe_1/raw.png",
      useAsRecipeCover: false,
    }, reservation)).resolves.toMatchObject({
      ok: true,
      data: {
        data: {
          cover: {
            id: "cover_empty",
            displayUrl: null,
            provenanceLabel: null,
          },
        },
      },
    });
  });

  it("keeps committed spoon creates successful when automatic cover seeding fails", async () => {
    const mocked = await setupMockedModule();
    const db = mockDb() as never;
    const actor = principal() as never;
    const reservation = { id: "idem_cover_failure" } as never;
    mocked.createSpoon.mockResolvedValueOnce({ spoon: spoon(), isOriginCook: true });
    db.recipeCover.create.mockRejectedValueOnce(new Error("cover write failed after spoon commit"));

    await expect(mocked.module.createNativeRecipeSpoon(db, {}, actor, "recipe_1", {
      clientMutationId: "cover-failure-after-spoon",
      photoUrl: "/photos/spoons/chef_1/recipe_1/raw.png",
      useAsRecipeCover: false,
    }, reservation)).resolves.toMatchObject({
      ok: true,
      status: 201,
      data: {
        data: {
          spoon: { id: "spoon_1" },
          cover: null,
          mutation: { clientMutationId: "cover-failure-after-spoon", replayed: false },
        },
      },
    });
  });

  it("normalizes null active-cover image fields while listing spoons", async () => {
    const mocked = await setupMockedModule();
    const activeCover = {
      id: "cover_null_image",
      recipeId: "recipe_1",
      sourceType: "spoon",
      status: "ready",
      generationStatus: "succeeded",
      archivedAt: null,
      imageUrl: null,
      stylizedImageUrl: null,
    };
    const db = {
      recipe: {
        findFirst: vi.fn(async () => ({
          ...recipe(),
          activeCoverId: activeCover.id,
          activeCoverVariant: null,
          activeCover,
        })),
      },
      recipeSpoon: {
        findMany: vi.fn(async () => [{
          ...spoon(),
          chef: { id: "chef_1", username: "chef", photoUrl: null },
        }]),
      },
    } as never;

    await expect(mocked.module.listNativeRecipeSpoons(db, "recipe_1", {
      limit: 1,
      cursor: null,
    })).resolves.toMatchObject({
      ok: true,
      data: {
        spoons: [{
          coverImageUrl: null,
          coverProvenanceLabel: null,
          coverVariant: null,
        }],
      },
    });

    db.recipe.findFirst.mockResolvedValueOnce({
      ...recipe(),
      activeCoverId: activeCover.id,
      activeCoverVariant: "image",
      activeCover,
    });
    await expect(mocked.module.listNativeRecipeSpoons(db, "recipe_1", {
      limit: 1,
      cursor: null,
    })).resolves.toMatchObject({
      ok: true,
      data: {
        spoons: [{
          coverImageUrl: "",
          coverVariant: "image",
        }],
      },
    });
  });

  it("reports queued notification statuses only when push sends are queued", async () => {
    const mocked = await setupMockedModule();
    const db = mockDb() as never;
    const actor = principal() as never;
    const env = {
      VAPID_PUBLIC_KEY: "test-public-key",
      VAPID_PRIVATE_KEY: "test-private-key",
      VAPID_SUBJECT: "mailto:test@spoonjoy.app",
    };

    db.recipe.findFirst.mockResolvedValueOnce({
      ...recipe(),
      chefId: "owner_2",
    });
    mocked.createSpoon.mockResolvedValueOnce({ spoon: spoon(), isOriginCook: false });
    const skippedPush = await mocked.module.createNativeRecipeSpoon(db, env, actor, "recipe_1", {
      clientMutationId: "spoon-notification-skipped-push",
      note: "Cooked",
      useAsRecipeCover: false,
    }, { id: "reservation_notify_1" } as never);
    expect(skippedPush).toMatchObject({
      ok: true,
      data: {
        data: {
          notifications: {
            spoonOnMyRecipe: "skipped",
            fellowChefOriginCook: "skipped",
          },
        },
      },
    });

    db.recipe.findFirst.mockResolvedValueOnce({
      ...recipe(),
      chefId: "owner_2",
    });
    mocked.createSpoon.mockResolvedValueOnce({ spoon: spoon(), isOriginCook: false });
    mocked.notifySpoonOnMyRecipe.mockResolvedValueOnce({ eventId: "event_queued", queuedSends: 1 });
    const queuedOwnerPush = await mocked.module.createNativeRecipeSpoon(db, env, actor, "recipe_1", {
      clientMutationId: "spoon-notification-owner-queued-push",
      note: "Cooked",
      useAsRecipeCover: false,
    }, { id: "reservation_notify_3" } as never);
    expect(queuedOwnerPush).toMatchObject({
      ok: true,
      data: {
        data: {
          notifications: {
            spoonOnMyRecipe: "queued",
            fellowChefOriginCook: "skipped",
          },
        },
      },
    });

    db.recipe.findFirst.mockResolvedValueOnce(recipe());
    mocked.createSpoon.mockResolvedValueOnce({ spoon: spoon(), isOriginCook: true });
    mocked.fanoutFellowChefOriginCook.mockResolvedValueOnce({ recipientsNotified: 1, queuedSends: 2 });
    const queuedPush = await mocked.module.createNativeRecipeSpoon(db, env, actor, "recipe_1", {
      clientMutationId: "spoon-notification-queued-push",
      note: "Cooked",
      useAsRecipeCover: false,
    }, { id: "reservation_notify_2" } as never);
    expect(queuedPush).toMatchObject({
      ok: true,
      data: {
        data: {
          notifications: {
            spoonOnMyRecipe: "skipped",
            fellowChefOriginCook: "queued",
          },
        },
      },
    });
  });

  it("recovers committed spoon mutations only when state matches the original request", async () => {
    const mocked = await setupMockedModule();
    const db = mockDb() as never;
    const reservation = {
      id: "spoon_1",
      createdAt: new Date("2026-05-31T23:59:00.000Z"),
    } as never;

    await expect(mocked.module.recoverNativeRecipeSpoonCreate(db, reservation, {
      clientMutationId: "recover-create",
      principalId: "chef_1",
      recipeId: "recipe_1",
      createInput: {
        clientMutationId: "recover-create",
        note: "Cooked",
        nextTime: null,
        cookedAt: now,
        photoUrl: "/photos/spoons/chef_1/recipe_1/raw.png",
        useAsRecipeCover: false,
      },
    })).resolves.toMatchObject({
      status: 201,
      data: {
        spoon: { id: "spoon_1" },
        isOriginCook: true,
        cover: { id: "cover_1" },
        notifications: { spoonOnMyRecipe: "skipped", fellowChefOriginCook: "skipped" },
        mutation: { clientMutationId: "recover-create", replayed: false },
      },
    });

    db.recipe.findFirst.mockResolvedValueOnce({ ...recipe(), chefId: "owner_2" });
    db.recipeSpoon.findUnique.mockResolvedValueOnce(spoon());
    db.notificationEvent.findMany.mockResolvedValueOnce([
      { payload: "not json" },
      { payload: JSON.stringify({ recipeId: "recipe_1" }) },
    ]);
    await expect(mocked.module.recoverNativeRecipeSpoonCreate(db, reservation, {
      clientMutationId: "recover-create-notified",
      principalId: "chef_1",
      recipeId: "recipe_1",
      createInput: {
        clientMutationId: "recover-create-notified",
        note: "Cooked",
        nextTime: null,
        cookedAt: now,
        photoUrl: "/photos/spoons/chef_1/recipe_1/raw.png",
        useAsRecipeCover: false,
      },
    })).resolves.toMatchObject({
      status: 201,
      data: {
        isOriginCook: false,
        notifications: { spoonOnMyRecipe: "skipped", fellowChefOriginCook: "skipped" },
      },
    });

    db.recipeSpoon.findUnique.mockResolvedValueOnce({ ...spoon(), note: "different" });
    await expect(mocked.module.recoverNativeRecipeSpoonCreate(db, reservation, {
      clientMutationId: "recover-create-mismatch",
      principalId: "chef_1",
      recipeId: "recipe_1",
      createInput: {
        clientMutationId: "recover-create-mismatch",
        note: "Cooked",
        useAsRecipeCover: false,
      },
    })).resolves.toBeNull();

    for (const [row, createInput] of [
      [{ ...spoon(), deletedAt: now }, { clientMutationId: "recover-create-deleted", note: "Cooked", useAsRecipeCover: false }],
      [{ ...spoon(), nextTime: "later" }, { clientMutationId: "recover-create-next-time", note: "Cooked", nextTime: null, useAsRecipeCover: false }],
      [{ ...spoon(), cookedAt: new Date("2026-06-02T00:00:00.000Z") }, { clientMutationId: "recover-create-cooked-at", note: "Cooked", cookedAt: now, useAsRecipeCover: false }],
      [{ ...spoon(), photoUrl: null }, { clientMutationId: "recover-create-photo-file", note: "Cooked", photoFile: new File(["x"], "x.png", { type: "image/png" }), useAsRecipeCover: false }],
    ] as const) {
      db.recipeSpoon.findUnique.mockResolvedValueOnce(row);
      await expect(mocked.module.recoverNativeRecipeSpoonCreate(db, reservation, {
        clientMutationId: createInput.clientMutationId,
        principalId: "chef_1",
        recipeId: "recipe_1",
        createInput,
      })).resolves.toBeNull();
    }

    db.recipe.findFirst.mockResolvedValueOnce(null);
    await expect(mocked.module.recoverNativeRecipeSpoonCreate(db, reservation, {
      clientMutationId: "recover-create-missing-recipe",
      principalId: "chef_1",
      recipeId: "recipe_1",
      createInput: {
        clientMutationId: "recover-create-missing-recipe",
        note: "Cooked",
        useAsRecipeCover: false,
      },
    })).resolves.toBeNull();

    await expect(mocked.module.recoverNativeRecipeSpoonUpdate(db, reservation, {
      clientMutationId: "recover-update",
      principalId: "chef_1",
      recipeId: "recipe_1",
      spoonId: "spoon_1",
      updateInput: {
        clientMutationId: "recover-update",
        note: "Cooked",
        cookedAt: now,
      },
    })).resolves.toMatchObject({
      status: 200,
      data: {
        spoon: { id: "spoon_1" },
        mutation: { clientMutationId: "recover-update", replayed: false },
      },
    });

    db.recipeSpoon.findUnique.mockResolvedValueOnce({ ...spoon(), photoUrl: "/photos/other.png" });
    await expect(mocked.module.recoverNativeRecipeSpoonUpdate(db, reservation, {
      clientMutationId: "recover-update-mismatch",
      principalId: "chef_1",
      recipeId: "recipe_1",
      spoonId: "spoon_1",
      updateInput: {
        clientMutationId: "recover-update-mismatch",
        photoUrl: "/photos/spoons/chef_1/recipe_1/raw.png",
      },
    })).resolves.toBeNull();

    for (const [row, updateInput] of [
      [{ ...spoon(), deletedAt: now }, { clientMutationId: "recover-update-deleted", note: "Cooked" }],
      [{ ...spoon(), note: "different" }, { clientMutationId: "recover-update-note", note: "Cooked" }],
      [{ ...spoon(), nextTime: "different" }, { clientMutationId: "recover-update-next-time", nextTime: "later" }],
      [{ ...spoon(), cookedAt: new Date("2026-06-02T00:00:00.000Z") }, { clientMutationId: "recover-update-cooked-at", cookedAt: now }],
    ] as const) {
      db.recipeSpoon.findUnique.mockResolvedValueOnce(row);
      await expect(mocked.module.recoverNativeRecipeSpoonUpdate(db, reservation, {
        clientMutationId: updateInput.clientMutationId,
        principalId: "chef_1",
        recipeId: "recipe_1",
        spoonId: "spoon_1",
        updateInput,
      })).resolves.toBeNull();
    }

    db.recipeSpoon.findUnique.mockResolvedValueOnce({ ...spoon(), note: null });
    await expect(mocked.module.recoverNativeRecipeSpoonUpdate(db, reservation, {
      clientMutationId: "recover-update-blank-note",
      principalId: "chef_1",
      recipeId: "recipe_1",
      spoonId: "spoon_1",
      updateInput: {
        clientMutationId: "recover-update-blank-note",
        note: "   ",
      },
    })).resolves.toMatchObject({
      status: 200,
      data: {
        spoon: { note: null },
      },
    });

    db.recipeSpoon.findUnique.mockResolvedValueOnce(null);
    await expect(mocked.module.recoverNativeRecipeSpoonUpdate(db, reservation, {
      clientMutationId: "recover-update-missing-spoon",
      principalId: "chef_1",
      recipeId: "recipe_1",
      spoonId: "missing_spoon",
      updateInput: {
        clientMutationId: "recover-update-missing-spoon",
        note: "Cooked",
      },
    })).resolves.toBeNull();

    db.recipeSpoon.findUnique.mockResolvedValueOnce({ ...spoon(), deletedAt: new Date("2026-06-01T00:01:00.000Z") });
    await expect(mocked.module.recoverNativeRecipeSpoonDelete(db, reservation, {
      clientMutationId: "recover-delete",
      principalId: "chef_1",
      recipeId: "recipe_1",
      spoonId: "spoon_1",
    })).resolves.toMatchObject({
      status: 200,
      data: {
        deleted: true,
        spoon: { id: "spoon_1" },
        mutation: { clientMutationId: "recover-delete", replayed: false },
      },
    });

    db.recipeSpoon.findUnique.mockResolvedValueOnce({ ...spoon(), deletedAt: new Date("2026-05-31T23:58:00.000Z") });
    await expect(mocked.module.recoverNativeRecipeSpoonDelete(db, reservation, {
      clientMutationId: "recover-delete-before-reservation",
      principalId: "chef_1",
      recipeId: "recipe_1",
      spoonId: "spoon_1",
    })).resolves.toBeNull();

    db.recipeSpoon.findUnique.mockResolvedValueOnce(spoon());
    await expect(mocked.module.recoverNativeRecipeSpoonDelete(db, reservation, {
      clientMutationId: "recover-delete-not-deleted",
      principalId: "chef_1",
      recipeId: "recipe_1",
      spoonId: "spoon_1",
    })).resolves.toBeNull();
  });
});
