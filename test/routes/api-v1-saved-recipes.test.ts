import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";

const savedService = vi.hoisted(() => ({
  actual: undefined as typeof import("~/lib/saved-recipes.server") | undefined,
  list: vi.fn(),
  save: vi.fn(),
  unsave: vi.fn(),
}));

vi.mock("~/lib/saved-recipes.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/saved-recipes.server")>();
  savedService.actual = actual;
  return {
    ...actual,
    listSavedRecipes: savedService.list,
    saveRecipe: savedService.save,
    unsaveRecipe: savedService.unsave,
  };
});

import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import {
  hashIdempotencyRequest,
  IDEMPOTENCY_RETRY_AFTER_SECONDS,
  idempotencyClientKey,
  IDEMPOTENCY_TTL_MS,
} from "~/lib/api-idempotency.server";
import { SavedRecipeValidationError } from "~/lib/saved-recipes.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

const SAVED_AT = "2026-07-21T10:00:00.000Z";
const NOW_MS = Date.parse(SAVED_AT);

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as never;
}

function apiRequest(input: {
  path: string;
  method?: string;
  requestId: string;
  token?: string;
  body?: unknown;
  rawBody?: string;
}) {
  const headers: Record<string, string> = { "X-Request-Id": input.requestId };
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const hasBody = input.body !== undefined || input.rawBody !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";
  return new UndiciRequest(`http://localhost/api/v1/${input.path}`, {
    method: input.method ?? "GET",
    headers,
    body: input.rawBody ?? (input.body === undefined ? undefined : JSON.stringify(input.body)),
  }) as unknown as Request;
}

async function invoke(request: Request, splat: string) {
  return request.method === "GET"
    ? loader(routeArgs(request, splat))
    : action(routeArgs(request, splat));
}

async function readJson(response: Response) {
  return await response.json() as Record<string, unknown>;
}

function expectPrivateHeaders(response: Response, requestId: string) {
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
}

async function createUser(db: LocalDb) {
  return db.user.create({ data: createTestUser() });
}

async function createRecipe(db: LocalDb, chefId: string, title = "Saved API recipe") {
  return db.recipe.create({ data: { ...createTestRecipe(chefId), title } });
}

async function createCredential(db: LocalDb, userId: string, scopes: string[]) {
  return createApiCredential(db, userId, `Saved API ${scopes.join(" ")}`, { scopes });
}

async function expectError(response: Response, requestId: string, code: string, status: number) {
  expect(response.status).toBe(status);
  expectPrivateHeaders(response, requestId);
  await expect(readJson(response)).resolves.toMatchObject({
    ok: false,
    requestId,
    error: { code, status },
  });
}

describe("REST /api/v1/saved-recipes", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    savedService.list.mockReset().mockImplementation(savedService.actual!.listSavedRecipes);
    savedService.save.mockReset().mockImplementation(savedService.actual!.saveRecipe);
    savedService.unsave.mockReset().mockImplementation(savedService.actual!.unsaveRecipe);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("requires kitchen:read, stays private, and sends exact list inputs", async () => {
    const owner = await createUser(db);
    const chef = await createUser(db);
    const recipe = await createRecipe(db, chef.id, "Private saved recipe");
    await db.recipeTag.create({
      data: { recipeId: recipe.id, label: "Weeknight", normalizedLabel: "weeknight" },
    });
    const read = await createCredential(db, owner.id, ["kitchen:read"]);
    const wrong = await createCredential(db, owner.id, ["recipes:read"]);
    const cursor = "cursor_token";
    savedService.list.mockResolvedValueOnce({
      query: "  soup  ",
      items: [{ recipeId: recipe.id, savedAt: SAVED_AT }],
      nextCursor: "next_cursor",
    });

    const anonymous = await invoke(apiRequest({
      path: "saved-recipes",
      requestId: "req_saved_list_anonymous",
    }), "saved-recipes");
    await expectError(anonymous, "req_saved_list_anonymous", "authentication_required", 401);

    const insufficient = await invoke(apiRequest({
      path: "saved-recipes",
      requestId: "req_saved_list_scope",
      token: wrong.token,
    }), "saved-recipes");
    await expectError(insufficient, "req_saved_list_scope", "insufficient_scope", 403);

    const response = await invoke(apiRequest({
      path: `saved-recipes?q=${encodeURIComponent("  soup  ")}&limit=2&cursor=${cursor}`,
      requestId: "req_saved_list",
      token: read.token,
    }), "saved-recipes");
    const payload = await readJson(response) as {
      ok: boolean;
      requestId: string;
      data: { recipes: Array<Record<string, unknown>>; nextCursor: string | null };
    };

    expect(response.status).toBe(200);
    expectPrivateHeaders(response, "req_saved_list");
    expect(Object.keys(payload.data).sort()).toEqual(["nextCursor", "recipes"]);
    expect(payload.data.nextCursor).toBe("next_cursor");
    expect(payload.data.recipes).toHaveLength(1);
    expect(payload.data.recipes[0]).toMatchObject({
      id: recipe.id,
      title: recipe.title,
      course: null,
      tags: ["Weeknight"],
      savedAt: SAVED_AT,
    });
    expect(Object.keys(payload.data.recipes[0]!).sort()).toEqual([
      "attribution", "canonicalUrl", "chef", "course", "coverImageUrl",
      "coverProvenanceLabel", "coverSourceType", "coverVariant", "createdAt",
      "description", "href", "id", "savedAt", "servings", "tags", "title", "updatedAt",
    ].sort());
    expect(savedService.list).toHaveBeenCalledTimes(1);
    const [listDatabase, listInput] = savedService.list.mock.calls[0]!;
    expect(listDatabase).toBe(db);
    expect(listInput).toEqual({
      userId: owner.id,
      query: "  soup  ",
      limit: 2,
      cursor,
    });
  });

  it("maps query, cursor, and stored-data validation to exact field errors", async () => {
    const owner = await createUser(db);
    const read = await createCredential(db, owner.id, ["kitchen:read"]);

    for (const field of ["q", "cursor", "savedAt"]) {
      savedService.list.mockRejectedValueOnce(new SavedRecipeValidationError(field, `${field} invalid`));
      const response = await invoke(apiRequest({
        path: "saved-recipes?q=test",
        requestId: `req_saved_validation_${field}`,
        token: read.token,
      }), "saved-recipes");
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        error: { code: "validation_error", details: { field } },
      });
    }

    for (const limit of ["0", "25", "1.5", "nope"]) {
      const response = await invoke(apiRequest({
        path: `saved-recipes?limit=${limit}`,
        requestId: `req_saved_limit_${encodeURIComponent(limit)}`,
        token: read.token,
      }), "saved-recipes");
      await expectError(response, `req_saved_limit_${encodeURIComponent(limit)}`, "validation_error", 400);
    }
  });

  it("uses exact PUT and DELETE bodies, service inputs, envelopes, and 200 statuses", async () => {
    const owner = await createUser(db);
    const recipe = await createRecipe(db, owner.id);
    const write = await createCredential(db, owner.id, ["kitchen:write"]);
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
    savedService.save.mockResolvedValueOnce({ recipeId: recipe.id, savedAt: SAVED_AT });
    savedService.unsave.mockResolvedValueOnce({ recipeId: recipe.id });

    const put = await invoke(apiRequest({
      path: `saved-recipes/${recipe.id}`,
      method: "PUT",
      requestId: "req_saved_put",
      token: write.token,
      body: { clientMutationId: "cm_saved_put" },
    }), `saved-recipes/${recipe.id}`);
    const putPayload = await readJson(put);
    expect(put.status).toBe(200);
    expectPrivateHeaders(put, "req_saved_put");
    expect(putPayload).toEqual({
      ok: true,
      requestId: "req_saved_put",
      data: {
        saved: true,
        recipeId: recipe.id,
        savedAt: SAVED_AT,
        mutation: { clientMutationId: "cm_saved_put", replayed: false },
      },
    });
    const [saveDatabase, saveInput] = savedService.save.mock.calls[0]!;
    expect(saveDatabase).toBe(db);
    expect(saveInput).toEqual({
      userId: owner.id,
      recipeId: recipe.id,
      nowMs: NOW_MS,
    });

    const remove = await invoke(apiRequest({
      path: `saved-recipes/${recipe.id}`,
      method: "DELETE",
      requestId: "req_saved_delete",
      token: write.token,
      body: { clientMutationId: "cm_saved_delete" },
    }), `saved-recipes/${recipe.id}`);
    expect(remove.status).toBe(200);
    expectPrivateHeaders(remove, "req_saved_delete");
    await expect(readJson(remove)).resolves.toEqual({
      ok: true,
      requestId: "req_saved_delete",
      data: {
        saved: false,
        recipeId: recipe.id,
        mutation: { clientMutationId: "cm_saved_delete", replayed: false },
      },
    });
    const [unsaveDatabase, unsaveInput] = savedService.unsave.mock.calls[0]!;
    expect(unsaveDatabase).toBe(db);
    expect(unsaveInput).toEqual({
      userId: owner.id,
      recipeId: recipe.id,
    });
  });

  it("requires kitchen:write and rejects non-exact mutation bodies before service calls", async () => {
    const owner = await createUser(db);
    const recipe = await createRecipe(db, owner.id);
    const read = await createCredential(db, owner.id, ["kitchen:read"]);
    const write = await createCredential(db, owner.id, ["kitchen:write"]);

    const anonymous = await invoke(apiRequest({
      path: `saved-recipes/${recipe.id}`,
      method: "PUT",
      requestId: "req_saved_put_anonymous",
      body: { clientMutationId: "cm_put_anonymous" },
    }), `saved-recipes/${recipe.id}`);
    await expectError(anonymous, "req_saved_put_anonymous", "authentication_required", 401);

    for (const [method, requestId] of [["PUT", "req_saved_put_scope"], ["DELETE", "req_saved_delete_scope"]] as const) {
      const response = await invoke(apiRequest({
        path: `saved-recipes/${recipe.id}`,
        method,
        requestId,
        token: read.token,
        body: { clientMutationId: `cm_${method.toLowerCase()}_scope` },
      }), `saved-recipes/${recipe.id}`);
      await expectError(response, requestId, "insufficient_scope", 403);
    }

    for (const input of [
      { method: "PUT", requestId: "req_saved_put_missing", body: {} },
      { method: "PUT", requestId: "req_saved_put_extra", body: { clientMutationId: "cm_put_extra", extra: true } },
      { method: "DELETE", requestId: "req_saved_delete_missing", body: {} },
      { method: "DELETE", requestId: "req_saved_delete_extra", body: { clientMutationId: "cm_delete_extra", extra: true } },
    ]) {
      const response = await invoke(apiRequest({
        path: `saved-recipes/${recipe.id}`,
        method: input.method,
        requestId: input.requestId,
        token: write.token,
        body: input.body,
      }), `saved-recipes/${recipe.id}`);
      await expectError(response, input.requestId, "validation_error", 400);
    }

    const invalidJson = await invoke(apiRequest({
      path: `saved-recipes/${recipe.id}`,
      method: "PUT",
      requestId: "req_saved_put_json",
      token: write.token,
      rawBody: "{",
    }), `saved-recipes/${recipe.id}`);
    await expectError(invalidJson, "req_saved_put_json", "invalid_json", 400);
    expect(savedService.save).not.toHaveBeenCalled();
    expect(savedService.unsave).not.toHaveBeenCalled();
  });

  it("maps missing and soft-deleted PUT targets to not_found while DELETE stays idempotent", async () => {
    const owner = await createUser(db);
    const write = await createCredential(db, owner.id, ["kitchen:write"]);
    const softDeleted = await createRecipe(db, owner.id, "Soft-deleted saved target");
    const hardDeleted = await createRecipe(db, owner.id, "Hard-deleted saved target");
    await db.savedRecipe.createMany({
      data: [
        { userId: owner.id, recipeId: softDeleted.id, savedAt: SAVED_AT },
        { userId: owner.id, recipeId: hardDeleted.id, savedAt: SAVED_AT },
      ],
    });
    await db.recipe.update({
      where: { id: softDeleted.id },
      data: { deletedAt: new Date(NOW_MS) },
    });
    await db.recipe.delete({ where: { id: hardDeleted.id } });
    const missingRecipeId = "missing_recipe";

    for (const recipeId of [missingRecipeId, softDeleted.id]) {
      const put = await invoke(apiRequest({
        path: `saved-recipes/${recipeId}`,
        method: "PUT",
        requestId: `req_saved_put_${recipeId}`,
        token: write.token,
        body: { clientMutationId: `cm_saved_put_${recipeId}` },
      }), `saved-recipes/${recipeId}`);
      await expectError(put, `req_saved_put_${recipeId}`, "not_found", 404);
    }

    for (const [recipeId, mutationId] of [
      [missingRecipeId, "cm_saved_delete_missing"],
      [softDeleted.id, "cm_saved_delete_soft"],
      [hardDeleted.id, "cm_saved_delete_hard"],
    ]) {
      const response = await invoke(apiRequest({
        path: `saved-recipes/${recipeId}`,
        method: "DELETE",
        requestId: `req_${mutationId}`,
        token: write.token,
        body: { clientMutationId: mutationId },
      }), `saved-recipes/${recipeId}`);
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        data: { saved: false, recipeId },
      });
    }
    await expect(db.savedRecipe.count({ where: { userId: owner.id } })).resolves.toBe(0);
  });

  it("reports exact allowed methods for the collection and item routes", async () => {
    const owner = await createUser(db);
    const recipe = await createRecipe(db, owner.id);
    const read = await createCredential(db, owner.id, ["kitchen:read"]);
    const write = await createCredential(db, owner.id, ["kitchen:write"]);

    const collection = await invoke(apiRequest({
      path: "saved-recipes",
      method: "POST",
      requestId: "req_saved_collection_method",
      token: read.token,
      body: {},
    }), "saved-recipes");
    await expectError(collection, "req_saved_collection_method", "method_not_allowed", 405);
    expect(collection.headers.get("Allow")).toBe("GET");

    const item = await invoke(apiRequest({
      path: `saved-recipes/${recipe.id}`,
      method: "PATCH",
      requestId: "req_saved_item_method",
      token: write.token,
      body: {},
    }), `saved-recipes/${recipe.id}`);
    await expectError(item, "req_saved_item_method", "method_not_allowed", 405);
    expect(item.headers.get("Allow")).toBe("PUT, DELETE");
  });

  it("replays completed PUT exactly once and rejects path or method conflicts", async () => {
    const owner = await createUser(db);
    const firstRecipe = await createRecipe(db, owner.id, "First saved replay");
    const secondRecipe = await createRecipe(db, owner.id, "Second saved replay");
    const write = await createCredential(db, owner.id, ["kitchen:write"]);
    const body = { clientMutationId: "cm_saved_replay" };

    const first = await invoke(apiRequest({
      path: `saved-recipes/${firstRecipe.id}`,
      method: "PUT",
      requestId: "req_saved_replay_first",
      token: write.token,
      body,
    }), `saved-recipes/${firstRecipe.id}`);
    const replay = await invoke(apiRequest({
      path: `saved-recipes/${firstRecipe.id}`,
      method: "PUT",
      requestId: "req_saved_replay_later",
      token: write.token,
      body,
    }), `saved-recipes/${firstRecipe.id}`);
    expect(first.status).toBe(200);
    await expect(readJson(first)).resolves.toMatchObject({
      requestId: "req_saved_replay_first",
      data: { mutation: { clientMutationId: body.clientMutationId, replayed: false } },
    });
    await expect(readJson(replay)).resolves.toMatchObject({
      requestId: "req_saved_replay_later",
      data: { mutation: { clientMutationId: body.clientMutationId, replayed: true } },
    });
    expect(savedService.save).toHaveBeenCalledTimes(1);

    const pathConflict = await invoke(apiRequest({
      path: `saved-recipes/${secondRecipe.id}`,
      method: "PUT",
      requestId: "req_saved_replay_path_conflict",
      token: write.token,
      body,
    }), `saved-recipes/${secondRecipe.id}`);
    await expectError(pathConflict, "req_saved_replay_path_conflict", "idempotency_conflict", 409);

    const methodConflict = await invoke(apiRequest({
      path: `saved-recipes/${firstRecipe.id}`,
      method: "DELETE",
      requestId: "req_saved_replay_method_conflict",
      token: write.token,
      body,
    }), `saved-recipes/${firstRecipe.id}`);
    await expectError(methodConflict, "req_saved_replay_method_conflict", "idempotency_conflict", 409);
  });

  it("returns idempotency_in_progress when an in-flight PUT has no saved row", async () => {
    const owner = await createUser(db);
    const recipe = await createRecipe(db, owner.id);
    const write = await createCredential(db, owner.id, ["kitchen:write"]);
    const body = { clientMutationId: "cm_saved_in_flight" };
    const path = `/api/v1/saved-recipes/${recipe.id}`;
    await db.apiIdempotencyKey.create({
      data: {
        userId: owner.id,
        credentialId: write.credential.id,
        clientKey: idempotencyClientKey({
          id: owner.id,
          source: "bearer",
          credentialId: write.credential.id,
        }),
        key: body.clientMutationId,
        operation: "saved-recipes.save",
        requestHash: await hashIdempotencyRequest({ method: "PUT", path, body }),
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });

    const response = await invoke(apiRequest({
      path: `saved-recipes/${recipe.id}`,
      method: "PUT",
      requestId: "req_saved_in_flight",
      token: write.token,
      body,
    }), `saved-recipes/${recipe.id}`);
    await expectError(response, "req_saved_in_flight", "idempotency_in_progress", 409);
    expect(response.headers.get("Retry-After")).toBe(String(IDEMPOTENCY_RETRY_AFTER_SECONDS));
    expect(savedService.save).not.toHaveBeenCalled();
  });

  it.each(["PUT", "DELETE"] as const)(
    "recovers a committed %s domain write in the same request and replays it later",
    async (method) => {
      const owner = await createUser(db);
      const recipe = await createRecipe(db, owner.id);
      const write = await createCredential(db, owner.id, ["kitchen:write"]);
      const clientMutationId = `cm_saved_${method.toLowerCase()}_write_recovery`;
      if (method === "DELETE") {
        await db.savedRecipe.create({ data: { userId: owner.id, recipeId: recipe.id, savedAt: SAVED_AT } });
        savedService.unsave.mockImplementationOnce(async (database, input) => {
          await savedService.actual!.unsaveRecipe(database, input);
          throw new Error("delete response failed after commit");
        });
      } else {
        savedService.save.mockImplementationOnce(async (database, input) => {
          await savedService.actual!.saveRecipe(database, input);
          throw new Error("save response failed after commit");
        });
      }

      const first = await invoke(apiRequest({
        path: `saved-recipes/${recipe.id}`,
        method,
        requestId: `req_saved_${method.toLowerCase()}_write_first`,
        token: write.token,
        body: { clientMutationId },
      }), `saved-recipes/${recipe.id}`);
      expect(first.status).toBe(200);
      await expect(readJson(first)).resolves.toMatchObject({
        requestId: `req_saved_${method.toLowerCase()}_write_first`,
        data: {
          saved: method === "PUT",
          recipeId: recipe.id,
          mutation: { clientMutationId, replayed: false },
        },
      });

      const later = await invoke(apiRequest({
        path: `saved-recipes/${recipe.id}`,
        method,
        requestId: `req_saved_${method.toLowerCase()}_write_later`,
        token: write.token,
        body: { clientMutationId },
      }), `saved-recipes/${recipe.id}`);
      expect(later.status).toBe(200);
      await expect(readJson(later)).resolves.toMatchObject({
        requestId: `req_saved_${method.toLowerCase()}_write_later`,
        data: { mutation: { clientMutationId, replayed: true } },
      });
      expect(method === "PUT" ? savedService.save : savedService.unsave).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["PUT", "DELETE"] as const)(
    "keeps a committed %s response stable across idempotency-completion failure",
    async (method) => {
      const owner = await createUser(db);
      const recipe = await createRecipe(db, owner.id);
      const write = await createCredential(db, owner.id, ["kitchen:write"]);
      const clientMutationId = `cm_saved_${method.toLowerCase()}_completion_recovery`;
      if (method === "DELETE") {
        await db.savedRecipe.create({ data: { userId: owner.id, recipeId: recipe.id, savedAt: SAVED_AT } });
      }
      const originalUpdate = db.apiIdempotencyKey.update;
      db.apiIdempotencyKey.update = vi.fn().mockRejectedValue(new Error("completion unavailable")) as typeof originalUpdate;
      let first: Response;
      try {
        first = await invoke(apiRequest({
          path: `saved-recipes/${recipe.id}`,
          method,
          requestId: `req_saved_${method.toLowerCase()}_completion_first`,
          token: write.token,
          body: { clientMutationId },
        }), `saved-recipes/${recipe.id}`);
      } finally {
        db.apiIdempotencyKey.update = originalUpdate;
      }

      expect(first.status).toBe(200);
      await expect(readJson(first)).resolves.toMatchObject({
        requestId: `req_saved_${method.toLowerCase()}_completion_first`,
        data: { mutation: { clientMutationId, replayed: false } },
      });
      const later = await invoke(apiRequest({
        path: `saved-recipes/${recipe.id}`,
        method,
        requestId: `req_saved_${method.toLowerCase()}_completion_later`,
        token: write.token,
        body: { clientMutationId },
      }), `saved-recipes/${recipe.id}`);
      expect(later.status).toBe(200);
      await expect(readJson(later)).resolves.toMatchObject({
        requestId: `req_saved_${method.toLowerCase()}_completion_later`,
        data: { mutation: { clientMutationId, replayed: true } },
      });
      expect(method === "PUT" ? savedService.save : savedService.unsave).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps owner keys separate across list, save, and unsave adapters", async () => {
    const ownerA = await createUser(db);
    const ownerB = await createUser(db);
    const recipe = await createRecipe(db, ownerA.id);
    const readA = await createCredential(db, ownerA.id, ["kitchen:read"]);
    const writeB = await createCredential(db, ownerB.id, ["kitchen:write"]);
    savedService.list.mockResolvedValueOnce({ query: "", items: [], nextCursor: null });

    await invoke(apiRequest({
      path: "saved-recipes",
      requestId: "req_saved_owner_a_list",
      token: readA.token,
    }), "saved-recipes");
    await invoke(apiRequest({
      path: `saved-recipes/${recipe.id}`,
      method: "PUT",
      requestId: "req_saved_owner_b_put",
      token: writeB.token,
      body: { clientMutationId: "cm_saved_owner_b_put" },
    }), `saved-recipes/${recipe.id}`);
    await invoke(apiRequest({
      path: `saved-recipes/${recipe.id}`,
      method: "DELETE",
      requestId: "req_saved_owner_b_delete",
      token: writeB.token,
      body: { clientMutationId: "cm_saved_owner_b_delete" },
    }), `saved-recipes/${recipe.id}`);

    expect(savedService.list).toHaveBeenCalledTimes(1);
    const [listDatabase, listInput] = savedService.list.mock.calls[0]!;
    expect(listDatabase).toBe(db);
    expect(listInput).toEqual({
      userId: ownerA.id,
      query: null,
      limit: undefined,
      cursor: null,
    });
    expect(savedService.save.mock.calls[0]?.[0]).toBe(db);
    expect(savedService.save.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ userId: ownerB.id }));
    expect(savedService.unsave.mock.calls[0]?.[0]).toBe(db);
    expect(savedService.unsave.mock.calls[0]?.[1]).toEqual({ userId: ownerB.id, recipeId: recipe.id });
    await expect(db.savedRecipe.count({ where: { userId: ownerA.id } })).resolves.toBe(0);
  });
});
