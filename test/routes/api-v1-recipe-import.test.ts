import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { hashIdempotencyRequest, idempotencyClientKey, IDEMPOTENCY_TTL_MS } from "~/lib/api-idempotency.server";
import { API_V1_RESOURCES, API_V1_SCOPE_REQUIREMENTS } from "~/lib/api-v1-contract.server";
import * as recipeImport from "~/lib/recipe-import.server";
import { ImportRecipeError } from "~/lib/recipe-import.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

function routeArgs(request: Request, splat: string, context = { cloudflare: { env: { OPENAI_API_KEY: "test-key" } } }) {
  return { request, params: { "*": splat }, context } as any;
}

function mutationRequest(token: string, requestId: string, body: Record<string, unknown>, env = { OPENAI_API_KEY: "test-key" }) {
  return routeArgs(new UndiciRequest("http://localhost/api/v1/recipes/import", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
    body: JSON.stringify(body),
  }) as unknown as Request, "recipes/import", { cloudflare: { env } });
}

async function readJson(response: Response) {
  return await response.json() as any;
}

function expectEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, PUT, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
}

async function createImportFixture(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const user = await db.user.create({ data: createTestUser() });
  const writer = await createApiCredential(db, user.id, "Native import writer", { scopes: ["kitchen:write"] });
  const reader = await createApiCredential(db, user.id, "Native import reader", { scopes: ["recipes:read"] });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(user.id),
      title: `Native Import ${faker.string.alphanumeric(8)}`,
      description: "Imported from a native capture source",
      servings: "4",
      sourceUrl: "https://capture.example/native-import",
    },
  });
  const step = await db.recipeStep.create({
    data: {
      recipeId: recipe.id,
      stepNum: 1,
      stepTitle: "Mix",
      description: "Mix the imported batter.",
      duration: 5,
    },
  });
  const unit = await getOrCreateUnit(db, "cup");
  const ingredientRef = await getOrCreateIngredientRef(db, `flour ${faker.string.alphanumeric(6)}`);
  await db.ingredient.create({
    data: {
      recipeId: recipe.id,
      stepNum: step.stepNum,
      quantity: 1,
      unitId: unit.id,
      ingredientRefId: ingredientRef.id,
    },
  });

  return { user, writer, reader, recipe };
}

describe("API v1 recipe import", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("registers POST /api/v1/recipes/import with kitchen write scope", async () => {
    expect(API_V1_RESOURCES).toContainEqual({
      name: "recipe-import",
      path: "/api/v1/recipes/import",
      methods: ["POST"],
      auth: "bearer",
      scopes: ["kitchen:write"],
    });
    expect(API_V1_SCOPE_REQUIREMENTS).toContainEqual({
      path: "/api/v1/recipes/import",
      method: "POST",
      auth: "bearer",
      scopes: ["kitchen:write"],
    });
  });

  it("imports native text capture sources through the real importer contract and returns API recipe detail", async () => {
    const fixture = await createImportFixture(db);
    const importSpy = vi.spyOn(recipeImport, "importRecipeFromSource")
      .mockResolvedValueOnce({
        recipeId: fixture.recipe.id,
        recipe: fixture.recipe,
        confidence: "low",
        source: "llm",
        existingRecipeId: null,
        coverPending: false,
      });
    const body = {
      clientMutationId: "cm_native_text_import",
      source: {
        type: "text",
        text: "Grandma sauce\n2 tomatoes",
        url: "https://capture.example/card",
        capture: {
          source: "photo-library",
          assetIdentifier: "asset_1",
        },
      },
    };

    const response = await action(mutationRequest(fixture.writer.token, "req_native_text_import", body));
    const payload = await readJson(response);

    expect(response.status).toBe(201);
    expectEnvelopeHeaders(response, "req_native_text_import");
    expect(importSpy).toHaveBeenCalledWith({
      chefId: fixture.user.id,
      recipeId: expect.any(String),
      source: {
        type: "text",
        text: "Grandma sauce\n2 tomatoes",
        sourceUrl: "https://capture.example/card",
        capture: {
          source: "photo-library",
          assetIdentifier: "asset_1",
        },
      },
    }, expect.objectContaining({
      db,
      env: expect.objectContaining({ OPENAI_API_KEY: "test-key" }),
    }));
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_native_text_import",
      data: {
        recipe: {
          id: fixture.recipe.id,
          title: fixture.recipe.title,
          description: "Imported from a native capture source",
          servings: "4",
          href: `/recipes/${fixture.recipe.id}`,
          canonicalUrl: `https://spoonjoy.app/recipes/${fixture.recipe.id}`,
          attribution: {
            sourceUrl: "https://capture.example/native-import",
            sourceHost: "capture.example",
          },
          steps: [{
            stepNum: 1,
            stepTitle: "Mix",
            description: "Mix the imported batter.",
            duration: 5,
            ingredients: [expect.objectContaining({ quantity: 1, unit: "cup" })],
          }],
        },
        importCode: null,
        blockers: [],
        mutation: { clientMutationId: "cm_native_text_import", replayed: false },
      },
    });
  });

  it("recovers in-flight imported recipes without duplicating provider work", async () => {
    const fixture = await createImportFixture(db);
    const importSpy = vi.spyOn(recipeImport, "importRecipeFromSource").mockRejectedValue(new Error("should not import"));
    const body = {
      clientMutationId: "cm_native_import_recover",
      source: { type: "text", text: "Recovered soup\n1 cup stock" },
    };
    const idempotencyId = "idem_native_import_recover";
    await db.apiIdempotencyKey.create({
      data: {
        id: idempotencyId,
        userId: fixture.user.id,
        credentialId: fixture.writer.credential.id,
        clientKey: idempotencyClientKey({
          id: fixture.user.id,
          source: "bearer",
          credentialId: fixture.writer.credential.id,
        }),
        key: body.clientMutationId,
        operation: "recipes.import",
        requestHash: await hashIdempotencyRequest({
          method: "POST",
          path: "/api/v1/recipes/import",
          body,
        }),
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
    await db.recipe.create({
      data: {
        ...createTestRecipe(fixture.user.id),
        id: idempotencyId,
        title: `Recovered Native Import ${faker.string.alphanumeric(8)}`,
        sourceUrl: "https://capture.example/recovered-import",
      },
    });

    const response = await action(mutationRequest(fixture.writer.token, "req_native_import_recover", body));
    const payload = await readJson(response);
    const completed = await db.apiIdempotencyKey.findUniqueOrThrow({ where: { id: idempotencyId } });

    expect(response.status).toBe(201);
    expectEnvelopeHeaders(response, "req_native_import_recover");
    expect(importSpy).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_native_import_recover",
      data: {
        recipe: {
          id: idempotencyId,
          canonicalUrl: `https://spoonjoy.app/recipes/${idempotencyId}`,
          attribution: {
            sourceUrl: "https://capture.example/recovered-import",
            sourceHost: "capture.example",
          },
        },
        importCode: null,
        blockers: [],
        confidence: null,
        source: null,
        existingRecipeId: null,
        coverPending: false,
        mutation: { clientMutationId: "cm_native_import_recover", replayed: true },
      },
    });
    expect(completed.responseStatus).toBe(201);
    expect(JSON.parse(completed.responseBody!)).toMatchObject({
      ok: true,
      data: {
        recipe: { id: idempotencyId },
        mutation: { clientMutationId: "cm_native_import_recover", replayed: false },
      },
    });
  });

  it("supports dry-run imports that return draft metadata without a persisted recipe", async () => {
    const fixture = await createImportFixture(db);
    const bucket = { put: vi.fn() };
    const waitUntil = vi.fn();
    const imageGenRunner = vi.fn();
    const importSpy = vi.spyOn(recipeImport, "importRecipeFromSource")
      .mockResolvedValueOnce({
        recipeId: null,
        recipe: null,
        confidence: "low",
        source: "llm",
        existingRecipeId: null,
        coverPending: false,
      });
    const body = {
      clientMutationId: "cm_native_text_import_dry_run",
      dryRun: true,
      source: {
        type: "text",
        text: "Preview only soup\n1 cup broth",
      },
    };
    const context = {
      cloudflare: {
        env: { OPENAI_API_KEY: "test-key", PHOTOS: bucket },
        ctx: { waitUntil },
      },
      imageGenRunner,
    };

    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes/import", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.writer.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": "req_native_text_import_dry_run",
      },
      body: JSON.stringify(body),
    }) as unknown as Request, "recipes/import", context as any));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(importSpy).toHaveBeenCalledWith({
      chefId: fixture.user.id,
      dryRun: true,
      source: {
        type: "text",
        text: "Preview only soup\n1 cup broth",
        sourceUrl: null,
        capture: null,
      },
    }, expect.objectContaining({
      db,
      env: expect.objectContaining({ OPENAI_API_KEY: "test-key", PHOTOS: bucket }),
    }));
    expect(importSpy.mock.calls[0]![1]).toMatchObject({
      bucket,
      waitUntil: expect.any(Function),
      imageGenRunner,
    });
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_native_text_import_dry_run",
      data: {
        recipe: null,
        importCode: null,
        blockers: [],
        confidence: "low",
        source: "llm",
        existingRecipeId: null,
        coverPending: false,
        mutation: { clientMutationId: "cm_native_text_import_dry_run", replayed: false },
      },
    });
  });

  it("checks idempotency conflicts before provider/import work", async () => {
    const fixture = await createImportFixture(db);
    const importSpy = vi.spyOn(recipeImport, "importRecipeFromSource").mockRejectedValue(new Error("should not import"));
    const originalBody = {
      clientMutationId: "cm_native_import_conflict",
      source: { type: "url", url: "https://example.com/original" },
    };
    const changedBody = {
      clientMutationId: "cm_native_import_conflict",
      source: { type: "url", url: "https://example.com/changed" },
    };
    await db.apiIdempotencyKey.create({
      data: {
        userId: fixture.user.id,
        credentialId: fixture.writer.credential.id,
        clientKey: idempotencyClientKey({
          id: fixture.user.id,
          source: "bearer",
          credentialId: fixture.writer.credential.id,
        }),
        key: originalBody.clientMutationId,
        operation: "recipes.import",
        requestHash: await hashIdempotencyRequest({
          method: "POST",
          path: "/api/v1/recipes/import",
          body: originalBody,
        }),
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });

    const response = await action(mutationRequest(fixture.writer.token, "req_native_import_conflict", changedBody));
    const payload = await readJson(response);

    expect(response.status).toBe(409);
    expectEnvelopeHeaders(response, "req_native_import_conflict");
    expect(importSpy).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      ok: false,
      requestId: "req_native_import_conflict",
      error: { code: "idempotency_conflict", status: 409 },
    });
  });

  it("returns a durable ProviderSecret blocker when import providers are not configured", async () => {
    const fixture = await createImportFixture(db);
    const importSpy = vi.spyOn(recipeImport, "importRecipeFromSource").mockRejectedValue(new Error("should not import"));
    const response = await action(mutationRequest(
      fixture.writer.token,
      "req_native_import_provider_blocker",
      {
        clientMutationId: "cm_native_provider_blocker",
        source: { type: "json-ld", jsonLd: { "@type": "Recipe", name: "No Key Soup" }, url: null },
      },
      {},
    ));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_native_import_provider_blocker");
    expect(importSpy).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_native_import_provider_blocker",
      data: {
        recipe: null,
        importCode: "provider_secret_required",
        blockers: [{
          capability: "ProviderSecret",
          provider: "openai",
          resource: "recipe-import",
        }],
        mutation: { clientMutationId: "cm_native_provider_blocker", replayed: false },
      },
    });
  });

  it("does not synthesize ProviderSecret blockers for unrelated in-flight imports", async () => {
    const fixture = await createImportFixture(db);
    const importSpy = vi.spyOn(recipeImport, "importRecipeFromSource").mockRejectedValue(new Error("should not import"));
    const body = {
      clientMutationId: "cm_native_provider_blocker_in_flight",
      source: { type: "text", text: "No provider key soup" },
    };
    await db.apiIdempotencyKey.create({
      data: {
        id: "idem_native_provider_blocker_in_flight",
        userId: fixture.user.id,
        credentialId: fixture.writer.credential.id,
        clientKey: idempotencyClientKey({
          id: fixture.user.id,
          source: "bearer",
          credentialId: fixture.writer.credential.id,
        }),
        key: body.clientMutationId,
        operation: "recipes.import",
        requestHash: await hashIdempotencyRequest({
          method: "POST",
          path: "/api/v1/recipes/import",
          body,
        }),
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });

    const response = await action(mutationRequest(
      fixture.writer.token,
      "req_native_provider_blocker_in_flight",
      body,
      {},
    ));
    const payload = await readJson(response);

    expect(response.status).toBe(409);
    expect(importSpy).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      ok: false,
      requestId: "req_native_provider_blocker_in_flight",
      error: {
        code: "idempotency_in_progress",
        status: 409,
        details: { retryAfterSeconds: 2 },
      },
    });
  });

  it("keeps genuinely in-flight imports retryable when no recoverable recipe exists", async () => {
    const fixture = await createImportFixture(db);
    const importSpy = vi.spyOn(recipeImport, "importRecipeFromSource").mockRejectedValue(new Error("should not import"));
    const body = {
      clientMutationId: "cm_native_import_still_in_flight",
      source: { type: "text", text: "Still processing soup" },
    };
    await db.apiIdempotencyKey.create({
      data: {
        id: "idem_native_import_still_in_flight",
        userId: fixture.user.id,
        credentialId: fixture.writer.credential.id,
        clientKey: idempotencyClientKey({
          id: fixture.user.id,
          source: "bearer",
          credentialId: fixture.writer.credential.id,
        }),
        key: body.clientMutationId,
        operation: "recipes.import",
        requestHash: await hashIdempotencyRequest({
          method: "POST",
          path: "/api/v1/recipes/import",
          body,
        }),
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });

    const response = await action(mutationRequest(fixture.writer.token, "req_native_import_still_in_flight", body));
    const payload = await readJson(response);

    expect(response.status).toBe(409);
    expect(importSpy).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      ok: false,
      requestId: "req_native_import_still_in_flight",
      error: {
        code: "idempotency_in_progress",
        status: 409,
        details: { retryAfterSeconds: 2 },
      },
    });
  });

  it("maps retryable import failures to upstream API errors without collapsing them to validation_error", async () => {
    const fixture = await createImportFixture(db);
    vi.spyOn(recipeImport, "importRecipeFromSource")
      .mockRejectedValueOnce(new ImportRecipeError("video-unavailable", 502, "Video is private"))
      .mockRejectedValueOnce(new ImportRecipeError("fetch-timeout", 504, "Recipe host timed out"))
      .mockRejectedValueOnce(new ImportRecipeError("not-html", 415, "Recipe URL did not return HTML"));

    const response = await action(mutationRequest(fixture.writer.token, "req_native_import_video_private", {
      clientMutationId: "cm_native_video_private",
      source: { type: "video-url", url: "https://www.youtube.com/watch?v=private" },
    }));
    const payload = await readJson(response);
    const timeoutResponse = await action(mutationRequest(fixture.writer.token, "req_native_import_timeout", {
      clientMutationId: "cm_native_import_timeout",
      source: { type: "url", url: "https://example.com/slow-recipe" },
    }));
    const timeoutPayload = await readJson(timeoutResponse);
    const validationResponse = await action(mutationRequest(fixture.writer.token, "req_native_import_not_html", {
      clientMutationId: "cm_native_import_not_html",
      source: { type: "url", url: "https://example.com/plain-text" },
    }));
    const validationPayload = await readJson(validationResponse);

    expect(response.status).toBe(502);
    expect(payload).toMatchObject({
      ok: false,
      requestId: "req_native_import_video_private",
      error: {
        code: "upstream_error",
        status: 502,
        details: { importCode: "video-unavailable", upstreamStatus: 502 },
      },
    });
    expect(timeoutResponse.status).toBe(504);
    expect(timeoutPayload).toMatchObject({
      ok: false,
      requestId: "req_native_import_timeout",
      error: {
        code: "upstream_timeout",
        status: 504,
        details: { importCode: "fetch-timeout", upstreamStatus: 504 },
      },
    });
    expect(validationResponse.status).toBe(400);
    expect(validationPayload).toMatchObject({
      ok: false,
      requestId: "req_native_import_not_html",
      error: {
        code: "validation_error",
        status: 400,
        details: { importCode: "not-html", upstreamStatus: 415 },
      },
    });
  });

  it("maps import rate limits to rate_limited API errors", async () => {
    const fixture = await createImportFixture(db);
    vi.spyOn(recipeImport, "importRecipeFromSource")
      .mockRejectedValueOnce(new ImportRecipeError("rate-limited", 429, "Import quota exhausted"));

    const response = await action(mutationRequest(fixture.writer.token, "req_native_import_rate_limited", {
      clientMutationId: "cm_native_rate_limited",
      source: { type: "text", text: "Too many recipes today" },
    }));
    const payload = await readJson(response);

    expect(response.status).toBe(429);
    expect(payload).toMatchObject({
      ok: false,
      requestId: "req_native_import_rate_limited",
      error: {
        code: "rate_limited",
        status: 429,
        details: { importCode: "rate-limited", upstreamStatus: 429 },
      },
    });
  });

  it("lets unexpected import failures become internal errors", async () => {
    const fixture = await createImportFixture(db);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(recipeImport, "importRecipeFromSource")
      .mockRejectedValueOnce(new TypeError("unexpected native importer failure"));

    const response = await action(mutationRequest(fixture.writer.token, "req_native_import_internal_error", {
      clientMutationId: "cm_native_internal_error",
      source: { type: "url", url: "https://example.com/r" },
    }));
    const payload = await readJson(response);

    expect(response.status).toBe(500);
    expect(payload).toMatchObject({
      ok: false,
      requestId: "req_native_import_internal_error",
      error: { code: "internal_error", status: 500 },
    });
  });

  it("rejects malformed source payloads and enforces bearer kitchen write scope", async () => {
    const fixture = await createImportFixture(db);
    const noAuth = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_native_import_no_auth" },
      body: JSON.stringify({ clientMutationId: "cm_no_auth", source: { type: "url", url: "https://example.com/r" } }),
    }) as unknown as Request, "recipes/import"));
    expect(noAuth.status).toBe(401);
    await expect(readJson(noAuth)).resolves.toMatchObject({
      error: { code: "authentication_required", status: 401 },
    });

    const wrongScope = await action(mutationRequest(fixture.reader.token, "req_native_import_wrong_scope", {
      clientMutationId: "cm_wrong_scope",
      source: { type: "url", url: "https://example.com/r" },
    }));
    expect(wrongScope.status).toBe(403);
    await expect(readJson(wrongScope)).resolves.toMatchObject({
      error: { code: "insufficient_scope", status: 403 },
    });

    const malformed = await action(mutationRequest(fixture.writer.token, "req_native_import_malformed", {
      clientMutationId: "cm_malformed",
      source: { type: "json-ld", jsonLD: { "@type": "Recipe" } },
    }));
    expect(malformed.status).toBe(400);
    await expect(readJson(malformed)).resolves.toMatchObject({
      error: { code: "validation_error", status: 400 },
    });

    const unsupportedSource = await action(mutationRequest(fixture.writer.token, "req_native_import_unsupported_source", {
      clientMutationId: "cm_unsupported_source",
      source: { type: "file", url: "file:///tmp/recipe.txt" },
    }));
    expect(unsupportedSource.status).toBe(400);
    await expect(readJson(unsupportedSource)).resolves.toMatchObject({
      error: {
        code: "validation_error",
        status: 400,
        message: "source.type must be url, video-url, text, or json-ld",
      },
    });

    const oversizedText = await action(mutationRequest(fixture.writer.token, "req_native_import_oversized_text", {
      clientMutationId: "cm_oversized_text",
      source: { type: "text", text: "x".repeat((12 * 1024) + 1) },
    }));
    expect(oversizedText.status).toBe(400);
    await expect(readJson(oversizedText)).resolves.toMatchObject({
      error: {
        code: "validation_error",
        status: 400,
        message: "source.text must be at most 12288 characters",
      },
    });

    const badCaptureSource = await action(mutationRequest(fixture.writer.token, "req_native_import_bad_capture_source", {
      clientMutationId: "cm_bad_capture_source",
      source: {
        type: "text",
        text: "Grandma card",
        capture: { source: "scanner" },
      },
    }));
    expect(badCaptureSource.status).toBe(400);
    await expect(readJson(badCaptureSource)).resolves.toMatchObject({
      error: {
        code: "validation_error",
        status: 400,
        message: "source.capture.source must be camera or photo-library",
      },
    });

    const missingJsonLd = await action(mutationRequest(fixture.writer.token, "req_native_import_missing_jsonld", {
      clientMutationId: "cm_missing_jsonld",
      source: { type: "json-ld" },
    }));
    expect(missingJsonLd.status).toBe(400);
    await expect(readJson(missingJsonLd)).resolves.toMatchObject({
      error: {
        code: "validation_error",
        status: 400,
        message: "source.jsonLd is required",
      },
    });

    const nonObjectSource = await action(mutationRequest(fixture.writer.token, "req_native_import_non_object_source", {
      clientMutationId: "cm_non_object_source",
      source: "not an object",
    }));
    expect(nonObjectSource.status).toBe(400);
    await expect(readJson(nonObjectSource)).resolves.toMatchObject({
      error: {
        code: "validation_error",
        status: 400,
        message: "source must be an object",
      },
    });

    const blankText = await action(mutationRequest(fixture.writer.token, "req_native_import_blank_text", {
      clientMutationId: "cm_blank_text",
      source: { type: "text", text: "   " },
    }));
    expect(blankText.status).toBe(400);
    await expect(readJson(blankText)).resolves.toMatchObject({
      error: {
        code: "validation_error",
        status: 400,
        message: "source.text must be a nonblank string",
      },
    });
  });

  it("surfaces method metadata for the known recipe import path", async () => {
    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes/import", {
      headers: { "X-Request-Id": "req_native_import_get_known_path" },
    }) as unknown as Request, "recipes/import"));

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    await expect(readJson(response)).resolves.toMatchObject({
      error: { code: "method_not_allowed", status: 405 },
    });
  });
});
