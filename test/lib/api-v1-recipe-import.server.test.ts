import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportRecipeError } from "~/lib/recipe-import.server";
import {
  hasRecipeImportProviderSecret,
  parseNativeRecipeImportBody,
  providerBlockedRecipeImportData,
  providerSecretBlocker,
  runNativeRecipeImport,
  type ApiV1RecipeImportResult,
} from "~/lib/api-v1-recipe-import.server";

const importMocks = vi.hoisted(() => ({
  fromJsonLd: vi.fn(),
  fromText: vi.fn(),
  fromUrl: vi.fn(),
}));

vi.mock("~/lib/recipe-import.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/recipe-import.server")>();
  return {
    ...actual,
    importRecipeFromJsonLd: importMocks.fromJsonLd,
    importRecipeFromText: importMocks.fromText,
    importRecipeFromUrl: importMocks.fromUrl,
  };
});

function expectOk<T>(result: ApiV1RecipeImportResult<T>) {
  expect(result.ok).toBe(true);
  return result as Extract<ApiV1RecipeImportResult<T>, { ok: true }>;
}

function expectFailure<T>(result: ApiV1RecipeImportResult<T>, code: string) {
  expect(result.ok).toBe(false);
  expect(result).toMatchObject({ ok: false, code });
  return result as Extract<ApiV1RecipeImportResult<T>, { ok: false }>;
}

function importResult(overrides: Partial<{
  confidence: "high" | "medium" | "low";
  coverPending: boolean;
  existingRecipeId: string | null;
  recipeId: string | null;
  source: "json-ld" | "llm" | "mixed" | "video-oembed-llm";
}> = {}) {
  return {
    recipeId: overrides.recipeId ?? "recipe_1",
    recipe: null,
    confidence: overrides.confidence ?? "high",
    source: overrides.source ?? "json-ld",
    existingRecipeId: overrides.existingRecipeId ?? null,
    coverPending: overrides.coverPending ?? false,
  };
}

describe("API v1 recipe import helpers", () => {
  beforeEach(() => {
    importMocks.fromJsonLd.mockReset();
    importMocks.fromText.mockReset();
    importMocks.fromUrl.mockReset();
  });

  it("parses and normalizes exact native import sources", () => {
    expect(expectOk(parseNativeRecipeImportBody({
      clientMutationId: " import-1 ",
      source: { type: "url", url: "https://recipes.example/lemon pasta" },
    })).data).toEqual({
      clientMutationId: "import-1",
      source: { type: "url", url: "https://recipes.example/lemon%20pasta" },
    });

    expect(expectOk(parseNativeRecipeImportBody({
      clientMutationId: "import-2",
      source: { type: "video-url", url: "https://youtu.be/codex" },
    })).data.source).toEqual({ type: "video-url", url: "https://youtu.be/codex" });

    expect(expectOk(parseNativeRecipeImportBody({
      clientMutationId: "import-3",
      source: { type: "text", text: " Soup ", url: "" },
    })).data.source).toEqual({ type: "text", text: "Soup", url: null });

    expect(expectOk(parseNativeRecipeImportBody({
      clientMutationId: "import-4",
      source: { type: "json-ld", jsonLd: [{ "@type": "Recipe", name: "Soup" }], url: null },
    })).data.source).toEqual({
      type: "json-ld",
      jsonLd: [{ "@type": "Recipe", name: "Soup" }],
      url: null,
    });
  });

  it("rejects malformed native import request branches before idempotency", () => {
    expectFailure(parseNativeRecipeImportBody({ source: { type: "url", url: "https://example.com" } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: null }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "url" } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "url", url: "https://example.com/r", text: "extra" } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "url", url: "ftp://example.com/r" } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "url", url: "not a url" } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "video-url", url: "https://example.com/v", text: "extra" } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "video-url", url: null } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "text", text: " " } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "text", text: "Soup", jsonLd: {} } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "text", text: "Soup", url: 42 } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "json-ld" } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "json-ld", jsonLd: {}, text: "extra" } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "json-ld", jsonLd: "Recipe" } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "json-ld", jsonLd: {}, url: "ftp://example.com/r" } }), "validation_error");
    expectFailure(parseNativeRecipeImportBody({ clientMutationId: "id", source: { type: "future" } }), "validation_error");
  });

  it("keeps provider-secret blockers response-authoritative with canonical paths", async () => {
    expect(hasRecipeImportProviderSecret(null)).toBe(false);
    expect(hasRecipeImportProviderSecret({ OPENAI_API_KEY: "   " })).toBe(false);
    expect(hasRecipeImportProviderSecret({ OPENAI_API_KEY: "sk-test" })).toBe(true);
    expect(hasRecipeImportProviderSecret({ OPENAI_API_KEY: 42 } as never)).toBe(false);

    expect(providerSecretBlocker(null).outputPath)
      .toBe("web/provider-secret-blocker-recipe-import.json");
    expect(providerSecretBlocker({ ARTIFACT_ROOT: "/tmp/spoonjoy///" }).outputPath)
      .toBe("/tmp/spoonjoy/web/provider-secret-blocker-recipe-import.json");

    const blocked = await providerBlockedRecipeImportData({
      clientMutationId: "blocked-1",
      source: { type: "text", text: "Soup", url: null },
    }, null);
    expect(blocked).toMatchObject({
      recipe: null,
      import: { inputType: "text", source: null, confidence: null },
      blockers: [{ domain: "recipe-import", outputPath: "web/provider-secret-blocker-recipe-import.json" }],
      nextActions: ["Set OPENAI_API_KEY and retry the import with a new clientMutationId."],
      mutation: { clientMutationId: "blocked-1", replayed: false },
    });

    const blockedAfterArtifactFailure = await providerBlockedRecipeImportData({
      clientMutationId: "blocked-2",
      source: { type: "url", url: "https://recipes.example/soup" },
    }, { ARTIFACT_ROOT: "/dev/null" });
    expect(blockedAfterArtifactFailure.blockers[0].outputPath)
      .toBe("/dev/null/web/provider-secret-blocker-recipe-import.json");
  });

  it("dispatches each import source to the existing import orchestrator with native reservation context", async () => {
    importMocks.fromUrl.mockResolvedValueOnce(importResult({ source: "json-ld" }));
    importMocks.fromText.mockResolvedValueOnce(importResult({ source: "llm" }));
    importMocks.fromJsonLd.mockResolvedValueOnce(importResult({ source: "json-ld" }));
    const db = {} as never;
    const waitUntil = vi.fn();
    const bucket = {} as R2Bucket;
    const env = { OPENAI_API_KEY: "sk-test", PHOTOS: bucket };

    await expectOk(await runNativeRecipeImport({
      clientMutationId: "url-1",
      source: { type: "url", url: "https://recipes.example/soup" },
    }, { db, chefId: "chef_1", env, waitUntil, recipeId: "reservation_url" }));
    await expectOk(await runNativeRecipeImport({
      clientMutationId: "text-1",
      source: { type: "text", text: "Soup", url: "https://captures.example/soup" },
    }, { db, chefId: "chef_1", env, waitUntil, recipeId: "reservation_text" }));
    await expectOk(await runNativeRecipeImport({
      clientMutationId: "jsonld-1",
      source: { type: "json-ld", jsonLd: { "@type": "Recipe", name: "Soup" }, url: null },
    }, { db, chefId: "chef_1", env, waitUntil, recipeId: "reservation_jsonld" }));

    expect(importMocks.fromUrl).toHaveBeenCalledWith({
      chefId: "chef_1",
      url: "https://recipes.example/soup",
      recipeId: "reservation_url",
    }, { db, env, bucket, waitUntil });
    expect(importMocks.fromText).toHaveBeenCalledWith({
      chefId: "chef_1",
      text: "Soup",
      sourceUrl: "https://captures.example/soup",
      recipeId: "reservation_text",
    }, { db, env, bucket, waitUntil });
    expect(importMocks.fromJsonLd).toHaveBeenCalledWith({
      chefId: "chef_1",
      jsonLd: { "@type": "Recipe", name: "Soup" },
      sourceUrl: null,
      recipeId: "reservation_jsonld",
    }, { db, env, bucket, waitUntil });
  });

  it("uses empty env and bucket defaults when route context has no provider env", async () => {
    importMocks.fromUrl.mockResolvedValueOnce(importResult({ source: "json-ld" }));
    importMocks.fromText.mockResolvedValueOnce(importResult({ source: "llm" }));
    importMocks.fromJsonLd.mockResolvedValueOnce(importResult({ source: "json-ld" }));
    const db = {} as never;

    await expectOk(await runNativeRecipeImport({
      clientMutationId: "url-no-env",
      source: { type: "url", url: "https://recipes.example/soup" },
    }, { db, chefId: "chef_1", env: null }));
    await expectOk(await runNativeRecipeImport({
      clientMutationId: "text-no-env",
      source: { type: "text", text: "Soup", url: null },
    }, { db, chefId: "chef_1", env: null }));
    await expectOk(await runNativeRecipeImport({
      clientMutationId: "jsonld-no-env",
      source: { type: "json-ld", jsonLd: { "@type": "Recipe", name: "Soup" }, url: null },
    }, { db, chefId: "chef_1", env: null }));

    expect(importMocks.fromUrl.mock.calls[0]?.[1]).toMatchObject({ db, env: {} });
    expect(importMocks.fromUrl.mock.calls[0]?.[1].bucket).toBeUndefined();
    expect(importMocks.fromText.mock.calls[0]?.[1]).toMatchObject({ db, env: {} });
    expect(importMocks.fromText.mock.calls[0]?.[1].bucket).toBeUndefined();
    expect(importMocks.fromJsonLd.mock.calls[0]?.[1]).toMatchObject({ db, env: {} });
    expect(importMocks.fromJsonLd.mock.calls[0]?.[1].bucket).toBeUndefined();
  });

  it("maps import orchestrator failures to API v1 error codes", async () => {
    importMocks.fromUrl.mockRejectedValueOnce(new ImportRecipeError("rate-limited", 429, "Import quota exceeded"));
    importMocks.fromUrl.mockRejectedValueOnce(new ImportRecipeError("bad-url", 400, "Bad import URL"));
    importMocks.fromUrl.mockRejectedValueOnce(new ImportRecipeError("fetch-failed", 502, "Fetch failed"));
    importMocks.fromUrl.mockRejectedValueOnce(new Error("raw failure"));

    const input = {
      clientMutationId: "url-error",
      source: { type: "url", url: "https://recipes.example/soup" },
    } as const;
    const deps = { db: {} as never, chefId: "chef_1", env: { OPENAI_API_KEY: "sk-test" } };

    expectFailure(await runNativeRecipeImport(input, deps), "rate_limited");
    const badUrl = expectFailure(await runNativeRecipeImport(input, deps), "validation_error");
    expect(badUrl.details).toEqual({ importCode: "bad-url" });
    const internal = expectFailure(await runNativeRecipeImport(input, deps), "internal_error");
    expect(internal.details).toEqual({ importCode: "fetch-failed" });
    await expect(runNativeRecipeImport(input, deps)).rejects.toThrow("raw failure");
  });
});
