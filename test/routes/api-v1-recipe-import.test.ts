import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import {
  hashIdempotencyRequest,
  idempotencyClientKey,
  reserveIdempotencyKey,
} from "~/lib/api-idempotency.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

const openAiMock = vi.hoisted(() => ({
  calls: [] as Array<{
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format: { json_schema?: { name?: string } };
  }>,
  configs: [] as Array<{ apiKey: string; timeout: number; maxRetries?: number }>,
}));

vi.mock("~/lib/openai-client.server", () => ({
  createOpenAIClient: vi.fn((config: { apiKey: string; timeout: number; maxRetries?: number }) => {
    openAiMock.configs.push(config);
    return {
      chat: {
        completions: {
          create: vi.fn(async (args: {
            model: string;
            messages: Array<{ role: string; content: string }>;
            response_format: { json_schema?: { name?: string } };
          }) => {
            openAiMock.calls.push(args);
            const schemaName = args.response_format.json_schema?.name;
            const prompt = args.messages.map((message) => message.content).join("\n");
            if (schemaName === "ingredient_response") {
              return openAiResponse({
                ingredients: [
                  { quantity: 1, unit: "whole", ingredientName: "codex ingredient" },
                ],
              });
            }
            if (schemaName === "recipe_response") {
              const video = prompt.includes("Source: youtube") || prompt.includes("social-media video");
              return openAiResponse({
                title: video ? "Codex Video Noodles" : "Codex Capture Soup",
                description: video ? "Recipe by codex_kitchen on YouTube" : "A recipe captured from native text.",
                servings: video ? "2 servings" : "4 servings",
                ingredients: video ? ["1 bundle noodles"] : ["1 cup broth"],
                steps: video ? ["Boil noodles.", "Toss with sauce."] : ["Warm broth.", "Serve hot."],
              });
            }
            throw new Error(`Unexpected OpenAI schema in test: ${schemaName ?? "(missing)"}`);
          }),
        },
      },
    };
  }),
}));

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;

const JSON_LD_HTML = `<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Codex Lemon Pasta",
        "description": "Bright pasta for route tests.",
        "recipeYield": "3 servings",
        "recipeIngredient": ["1 lemon", "2 cups pasta"],
        "recipeInstructions": [
          { "@type": "HowToStep", "text": "Boil the pasta." },
          { "@type": "HowToStep", "text": "Toss with lemon." }
        ]
      }
    </script>
  </head>
  <body>Codex Lemon Pasta</body>
</html>`;

function openAiResponse(content: unknown) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(content),
        },
      },
    ],
  };
}

function routeArgs(request: Request, splat: string, env: Record<string, unknown> | null = null) {
  return {
    request,
    params: { "*": splat },
    context: { cloudflare: { env } },
  } as never;
}

function bearerHeaders(token: string, requestId: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
    ...extra,
  };
}

function importRequest(token: string, requestId: string, body: unknown) {
  return new UndiciRequest("http://localhost/api/v1/recipes/import", {
    method: "POST",
    headers: bearerHeaders(token, requestId),
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function unauthenticatedImportRequest(requestId: string, body: unknown) {
  return new UndiciRequest("http://localhost/api/v1/recipes/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

async function readJson(response: Response) {
  return await response.json() as Record<string, any>;
}

function expectExactKeys(value: Record<string, unknown>, keys: string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function expectPrivateEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
}

function expectSuccessEnvelope(payload: Record<string, any>, requestId: string) {
  expectExactKeys(payload, ["ok", "requestId", "data"]);
  expect(payload.ok).toBe(true);
  expect(payload.requestId).toBe(requestId);
}

function expectErrorEnvelope(payload: Record<string, any>, requestId: string, code: string, status: number) {
  expectExactKeys(payload, ["ok", "requestId", "error"]);
  expect(payload).toMatchObject({
    ok: false,
    requestId,
    error: { code, status, message: expect.any(String) },
  });
}

function expectMutationShape(mutation: Record<string, unknown>, clientMutationId: string, replayed: boolean) {
  expectExactKeys(mutation, ["clientMutationId", "replayed"]);
  expect(mutation).toEqual({ clientMutationId, replayed });
}

function expectImportShape(importInfo: Record<string, unknown>, inputType: string, source: string | null) {
  expectExactKeys(importInfo, [
    "confidence",
    "coverPending",
    "existingRecipeId",
    "inputType",
    "source",
  ]);
  expect(importInfo.inputType).toBe(inputType);
  expect(importInfo.source).toBe(source);
  expect(importInfo.existingRecipeId === null || typeof importInfo.existingRecipeId === "string").toBe(true);
  expect(typeof importInfo.coverPending).toBe("boolean");
}

function expectImportMutationData(
  data: Record<string, any>,
  clientMutationId: string,
  replayed: boolean,
  inputType: string,
  source: string | null,
  options: { blocked?: boolean } = {},
) {
  expectExactKeys(data, [
    "blockers",
    "import",
    "mutation",
    "nextActions",
    "recipe",
    "warnings",
  ]);
  expect(Array.isArray(data.blockers)).toBe(true);
  expect(Array.isArray(data.nextActions)).toBe(true);
  expect(Array.isArray(data.warnings)).toBe(true);
  expectImportShape(data.import, inputType, source);
  expectMutationShape(data.mutation, clientMutationId, replayed);
  if (options.blocked) {
    expect(data.recipe).toBeNull();
    expect(data.blockers).not.toEqual([]);
  } else {
    expect(data.blockers).toEqual([]);
    expectRecipeDetailShape(data.recipe);
  }
}

function expectProviderBlockerShape(blocker: Record<string, unknown>, outputPath: string) {
  expectExactKeys(blocker, [
    "blocked",
    "capability",
    "command",
    "domain",
    "outputPath",
    "ownerAction",
    "reason",
  ]);
  expect(blocker).toMatchObject({
    blocked: true,
    capability: "ProviderSecret",
    domain: "recipe-import",
    outputPath,
    ownerAction: expect.stringMatching(/OPENAI_API_KEY/),
    reason: expect.stringMatching(/recipe import|provider secret|OPENAI_API_KEY/i),
  });
}

function expectChefShape(chef: Record<string, unknown>) {
  expectExactKeys(chef, ["id", "username"]);
  expect(typeof chef.id).toBe("string");
  expect(typeof chef.username).toBe("string");
}

function expectRecipeDetailShape(recipe: Record<string, any>) {
  expectExactKeys(recipe, [
    "attribution",
    "canonicalUrl",
    "chef",
    "cookbooks",
    "coverImageUrl",
    "coverProvenanceLabel",
    "coverSourceType",
    "coverVariant",
    "createdAt",
    "description",
    "href",
    "id",
    "recentSpoons",
    "servings",
    "steps",
    "title",
    "updatedAt",
  ]);
  expect(typeof recipe.id).toBe("string");
  expect(typeof recipe.title).toBe("string");
  expect(recipe.href).toBe(`/recipes/${recipe.id}`);
  expect(recipe.canonicalUrl).toBe(`https://spoonjoy.app/recipes/${recipe.id}`);
  expectChefShape(recipe.chef);
  expect(Array.isArray(recipe.steps)).toBe(true);
  expect(Array.isArray(recipe.cookbooks)).toBe(true);
  expect(Array.isArray(recipe.recentSpoons)).toBe(true);
}

function jsonLdImportDocument(title = "Codex JSON-LD Card") {
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: title,
    description: "A native-captured JSON-LD recipe.",
    recipeYield: "6 servings",
    recipeIngredient: ["2 tbsp olive oil"],
    recipeInstructions: [
      { "@type": "HowToStep", text: "Drizzle olive oil." },
    ],
  };
}

function makeFetchHarness() {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    if (url.startsWith("https://recipes.example/")) {
      return new Response(JSON_LD_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.startsWith("https://www.youtube.com/oembed")) {
      return Response.json({
        title: "Codex Video Noodles",
        author_name: "codex_kitchen",
        description: "A quick noodle recipe",
        thumbnail_url: null,
      });
    }
    throw new Error(`Unexpected fetch in recipe import test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

async function createImportFixture(db: LocalDb) {
  const chef = await db.user.create({ data: createTestUser() });
  const writer = await createApiCredential(db, chef.id, "Recipe import writer", { scopes: ["kitchen:write"] });
  const reader = await createApiCredential(db, chef.id, "Recipe import reader", { scopes: ["recipes:read"] });
  return { chef, writer, reader };
}

async function reserveImportMutation(
  db: LocalDb,
  input: {
    body: { clientMutationId: string; source: Record<string, unknown> };
    chefId: string;
    credentialId: string;
  },
) {
  const requestHash = await hashIdempotencyRequest({
    method: "POST",
    path: "/api/v1/recipes/import",
    body: input.body,
  });
  const reservation = await reserveIdempotencyKey(db, {
    userId: input.chefId,
    credentialId: input.credentialId,
    clientKey: idempotencyClientKey({ id: input.chefId, source: "bearer", credentialId: input.credentialId }),
    key: input.body.clientMutationId,
    operation: "recipes.import",
    requestHash,
  });
  if (reservation.status !== "reserved") throw new Error(`expected recipe import idempotency reservation, got ${reservation.status}`);
  return reservation.record;
}

describe("API v1 recipe import", () => {
  let db: LocalDb;
  let artifactRoot: string;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    artifactRoot = path.join(tmpdir(), `spoonjoy-import-api-${faker.string.alphanumeric(8)}`);
    await rm(artifactRoot, { recursive: true, force: true });
    await mkdir(path.join(artifactRoot, "web"), { recursive: true });
    openAiMock.calls.length = 0;
    openAiMock.configs.length = 0;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(artifactRoot, { recursive: true, force: true });
    await cleanupDatabase();
  });

  it("declares the authenticated kitchen-write route contract", () => {
    expect(resolveApiV1ScopeRequirement("POST", "recipes/import")).toEqual({
      auth: "bearer",
      scopes: ["kitchen:write"],
    });
  });

  it("rejects unsupported import methods before treating import as a recipe id", async () => {
    const response = await action(routeArgs(
      new UndiciRequest("http://localhost/api/v1/recipes/import", {
        method: "GET",
        headers: { "X-Request-Id": "req_import_method" },
      }) as unknown as Request,
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expectErrorEnvelope(await readJson(response), "req_import_method", "method_not_allowed", 405);
  });

  it("imports a recipe URL through the native mutation envelope and captures the provider fetch", async () => {
    const { calls } = makeFetchHarness();
    const { writer } = await createImportFixture(db);
    const clientMutationId = "native-import-url-1";

    const response = await action(routeArgs(
      importRequest(writer.token, "req_import_url", {
        clientMutationId,
        source: { type: "url", url: "https://recipes.example/lemon-pasta" },
      }),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    const payload = await readJson(response);
    expect(response.status).toBe(201);
    expectPrivateEnvelopeHeaders(response, "req_import_url");
    expectSuccessEnvelope(payload, "req_import_url");
    expectImportMutationData(payload.data, clientMutationId, false, "url", "json-ld");
    expect(payload.data.recipe).toMatchObject({
      title: "Codex Lemon Pasta",
      description: "Bright pasta for route tests.",
      servings: "3 servings",
    });
    expect(calls).toEqual(["https://recipes.example/lemon-pasta"]);
  });

  it("imports raw text through the provider-backed capture path", async () => {
    makeFetchHarness();
    const { writer } = await createImportFixture(db);
    const clientMutationId = "native-import-text-1";

    const response = await action(routeArgs(
      importRequest(writer.token, "req_import_text", {
        clientMutationId,
        source: {
          type: "text",
          text: "Codex Capture Soup\nIngredients: 1 cup broth\nSteps: Warm broth. Serve hot.",
        },
      }),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    const payload = await readJson(response);
    expect(response.status).toBe(201);
    expectSuccessEnvelope(payload, "req_import_text");
    expectImportMutationData(payload.data, clientMutationId, false, "text", "llm");
    expect(payload.data.recipe.title).toBe("Codex Capture Soup");
    expect(openAiMock.calls.some((call) => (
      call.response_format.json_schema?.name === "recipe_response" &&
      call.messages.some((message) => message.content.includes("Codex Capture Soup"))
    ))).toBe(true);
  });

  it("imports a JSON-LD capture payload without fetching a public URL", async () => {
    const { calls } = makeFetchHarness();
    const { writer } = await createImportFixture(db);
    const clientMutationId = "native-import-jsonld-1";

    const response = await action(routeArgs(
      importRequest(writer.token, "req_import_jsonld", {
        clientMutationId,
        source: {
          type: "json-ld",
          url: "https://captures.example/jsonld-card",
          jsonLd: jsonLdImportDocument(),
        },
      }),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    const payload = await readJson(response);
    expect(response.status).toBe(201);
    expectSuccessEnvelope(payload, "req_import_jsonld");
    expectImportMutationData(payload.data, clientMutationId, false, "json-ld", "json-ld");
    expect(payload.data.recipe).toMatchObject({
      title: "Codex JSON-LD Card",
      description: "A native-captured JSON-LD recipe.",
      servings: "6 servings",
    });
    expect(calls).toEqual([]);
  });

  it("imports a video URL through oEmbed and the recipe LLM path", async () => {
    const { calls } = makeFetchHarness();
    const { writer } = await createImportFixture(db);
    const clientMutationId = "native-import-video-1";

    const response = await action(routeArgs(
      importRequest(writer.token, "req_import_video", {
        clientMutationId,
        source: { type: "video-url", url: "https://www.youtube.com/watch?v=codex" },
      }),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    const payload = await readJson(response);
    expect(response.status).toBe(201);
    expectSuccessEnvelope(payload, "req_import_video");
    expectImportMutationData(payload.data, clientMutationId, false, "video-url", "video-oembed-llm");
    expect(payload.data.recipe.title).toBe("Codex Video Noodles");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dcodex&format=json");
  });

  it("returns the canonical provider-secret blocker for provider-bound local imports", async () => {
    makeFetchHarness();
    const { writer } = await createImportFixture(db);
    const clientMutationId = "native-import-provider-blocker-1";
    const blockerPath = path.join(artifactRoot, "web", "provider-secret-blocker-recipe-import.json");

    const response = await action(routeArgs(
      importRequest(writer.token, "req_import_provider_blocker", {
        clientMutationId,
        source: {
          type: "text",
          text: "Provider-bound native capture that needs the recipe importer.",
        },
      }),
      "recipes/import",
      { OPENAI_API_KEY: "", ARTIFACT_ROOT: artifactRoot },
    ));

    const payload = await readJson(response);
    expect(response.status).toBe(202);
    expectSuccessEnvelope(payload, "req_import_provider_blocker");
    expectImportMutationData(payload.data, clientMutationId, false, "text", null, { blocked: true });
    expect(payload.data.blockers).toHaveLength(1);
    expectProviderBlockerShape(payload.data.blockers[0], blockerPath);
    const blocker = JSON.parse(await readFile(blockerPath, "utf8")) as Record<string, unknown>;
    expectProviderBlockerShape(blocker, blockerPath);
    await expect(db.recipe.count()).resolves.toBe(0);
  });

  it("suffixes duplicate imported titles instead of failing the capture", async () => {
    makeFetchHarness();
    const { chef, writer } = await createImportFixture(db);
    await db.recipe.create({
      data: {
        ...createTestRecipe(chef.id),
        title: "Codex Lemon Pasta",
        sourceUrl: "https://already.example/lemon-pasta",
      },
    });

    const response = await action(routeArgs(
      importRequest(writer.token, "req_import_duplicate_title", {
        clientMutationId: "native-import-duplicate-title-1",
        source: { type: "url", url: "https://recipes.example/lemon-pasta" },
      }),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    const payload = await readJson(response);
    expect(response.status).toBe(201);
    expectSuccessEnvelope(payload, "req_import_duplicate_title");
    expect(payload.data.recipe.title).toBe("Codex Lemon Pasta (imported)");
  });

  it("requires authentication and the kitchen-write scope", async () => {
    makeFetchHarness();
    const { reader } = await createImportFixture(db);
    const body = {
      clientMutationId: "native-import-auth-1",
      source: { type: "url", url: "https://recipes.example/lemon-pasta" },
    };

    const missingAuth = await action(routeArgs(
      unauthenticatedImportRequest("req_import_missing_auth", body),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));
    expect(missingAuth.status).toBe(401);
    expectErrorEnvelope(await readJson(missingAuth), "req_import_missing_auth", "authentication_required", 401);

    const insufficientScope = await action(routeArgs(
      importRequest(reader.token, "req_import_scope", body),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));
    expect(insufficientScope.status).toBe(403);
    expectErrorEnvelope(await readJson(insufficientScope), "req_import_scope", "insufficient_scope", 403);
  });

  it("validates exact request body shape before reserving idempotency", async () => {
    makeFetchHarness();
    const { writer } = await createImportFixture(db);

    const response = await action(routeArgs(
      importRequest(writer.token, "req_import_validation", {
        clientMutationId: "native-import-validation-1",
        source: {
          type: "url",
          url: "https://recipes.example/lemon-pasta",
          text: "Conflicting source payload",
        },
        unexpected: true,
      }),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    const payload = await readJson(response);
    expect(response.status).toBe(400);
    expectErrorEnvelope(payload, "req_import_validation", "validation_error", 400);
    await expect(db.apiIdempotencyKey.count()).resolves.toBe(0);
  });

  it("maps import helper failures through the API error envelope without creating recipes", async () => {
    makeFetchHarness();
    const { writer } = await createImportFixture(db);

    const response = await action(routeArgs(
      importRequest(writer.token, "req_import_blocked_host", {
        clientMutationId: "native-import-blocked-host-1",
        source: { type: "url", url: "http://127.0.0.1/private-recipe" },
      }),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    const payload = await readJson(response);
    expect(response.status).toBe(400);
    expectErrorEnvelope(payload, "req_import_blocked_host", "validation_error", 400);
    expect(payload.error.details).toEqual({ importCode: "fetch-blocked" });
    await expect(db.recipe.count()).resolves.toBe(0);
  });

  it("replays an identical import request without creating a second recipe", async () => {
    makeFetchHarness();
    const { writer } = await createImportFixture(db);
    const body = {
      clientMutationId: "native-import-replay-1",
      source: { type: "url", url: "https://recipes.example/lemon-pasta" },
    };

    const first = await action(routeArgs(
      importRequest(writer.token, "req_import_replay_first", body),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));
    const second = await action(routeArgs(
      importRequest(writer.token, "req_import_replay_second", body),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    const firstPayload = await readJson(first);
    const secondPayload = await readJson(second);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expectImportMutationData(firstPayload.data, body.clientMutationId, false, "url", "json-ld");
    expectImportMutationData(secondPayload.data, body.clientMutationId, true, "url", "json-ld");
    expect(secondPayload.data.recipe.id).toBe(firstPayload.data.recipe.id);
    await expect(db.recipe.count()).resolves.toBe(1);
  });

  it("recovers an import when the recipe committed before the import tombstone was written", async () => {
    makeFetchHarness();
    const { chef, writer } = await createImportFixture(db);
    const body = {
      clientMutationId: "native-import-tombstone-recovery-1",
      source: { type: "url", url: "https://recipes.example/lemon-pasta" },
    };
    const requestHash = await hashIdempotencyRequest({
      method: "POST",
      path: "/api/v1/recipes/import",
      body,
    });
    const reservation = await reserveIdempotencyKey(db, {
      userId: chef.id,
      credentialId: writer.credential.id,
      clientKey: idempotencyClientKey({ id: chef.id, source: "bearer", credentialId: writer.credential.id }),
      key: body.clientMutationId,
      operation: "recipes.import",
      requestHash,
    });
    if (reservation.status !== "reserved") throw new Error("expected recipe import idempotency reservation");
    await db.recipe.create({
      data: {
        id: reservation.record.id,
        chefId: chef.id,
        title: "Codex Lemon Pasta",
        description: "Bright pasta for route tests.",
        servings: "3 servings",
        sourceUrl: body.source.url,
      },
    });

    const first = await action(routeArgs(
      importRequest(writer.token, "req_import_tombstone_recovery_first", body),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));
    const second = await action(routeArgs(
      importRequest(writer.token, "req_import_tombstone_recovery_second", body),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    const firstPayload = await readJson(first);
    const secondPayload = await readJson(second);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expectImportMutationData(firstPayload.data, body.clientMutationId, true, "url", null);
    expectImportMutationData(secondPayload.data, body.clientMutationId, true, "url", null);
    expect(secondPayload.data.recipe.id).toBe(firstPayload.data.recipe.id);
    await expect(db.recipe.count()).resolves.toBe(1);
    await expect(db.apiIdempotencyKey.count({
      where: { key: body.clientMutationId, responseStatus: 201 },
    })).resolves.toBe(1);
  });

  it("recovers a provider-secret blocker for an in-flight import before any recipe commits", async () => {
    makeFetchHarness();
    const { chef, writer } = await createImportFixture(db);
    const body = {
      clientMutationId: "native-import-provider-recovery-1",
      source: {
        type: "text",
        text: "Provider-bound native capture that was reserved before the worker stopped.",
      },
    };
    await reserveImportMutation(db, {
      body,
      chefId: chef.id,
      credentialId: writer.credential.id,
    });

    const response = await action(routeArgs(
      importRequest(writer.token, "req_import_provider_recovery", body),
      "recipes/import",
      { OPENAI_API_KEY: "", ARTIFACT_ROOT: artifactRoot },
    ));

    const payload = await readJson(response);
    expect(response.status).toBe(202);
    expectSuccessEnvelope(payload, "req_import_provider_recovery");
    expectImportMutationData(payload.data, body.clientMutationId, true, "text", null, { blocked: true });
    expect(payload.data.blockers).toHaveLength(1);
    expectProviderBlockerShape(
      payload.data.blockers[0],
      path.join(artifactRoot, "web", "provider-secret-blocker-recipe-import.json"),
    );
    await expect(db.recipe.count()).resolves.toBe(0);
    await expect(db.apiIdempotencyKey.count({
      where: { key: body.clientMutationId, responseStatus: 202 },
    })).resolves.toBe(1);
  });

  it("does not recover in-flight imports whose reservation-derived recipe belongs to another chef", async () => {
    const { chef, writer } = await createImportFixture(db);
    const otherChef = await db.user.create({ data: createTestUser() });
    const body = {
      clientMutationId: "native-import-foreign-recovery-1",
      source: { type: "url", url: "https://recipes.example/lemon-pasta" },
    };
    const reservation = await reserveImportMutation(db, {
      body,
      chefId: chef.id,
      credentialId: writer.credential.id,
    });
    await db.recipe.create({
      data: {
        ...createTestRecipe(otherChef.id),
        id: reservation.id,
        title: "Foreign Reserved Import",
        sourceUrl: "https://recipes.example/lemon-pasta",
      },
    });

    const response = await action(routeArgs(
      importRequest(writer.token, "req_import_foreign_recovery", body),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    expect(response.status).toBe(409);
    expectErrorEnvelope(await readJson(response), "req_import_foreign_recovery", "idempotency_in_progress", 409);
    await expect(db.apiIdempotencyKey.count({
      where: { key: body.clientMutationId, responseStatus: null },
    })).resolves.toBe(1);
  });

  it("keeps an in-flight import unresolved when no recipe committed and the provider is available", async () => {
    makeFetchHarness();
    const { chef, writer } = await createImportFixture(db);
    const body = {
      clientMutationId: "native-import-empty-recovery-1",
      source: {
        type: "text",
        text: "Provider is available, but no committed recipe exists to recover.",
      },
    };
    await reserveImportMutation(db, {
      body,
      chefId: chef.id,
      credentialId: writer.credential.id,
    });

    const response = await action(routeArgs(
      importRequest(writer.token, "req_import_empty_recovery", body),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    expect(response.status).toBe(409);
    expectErrorEnvelope(await readJson(response), "req_import_empty_recovery", "idempotency_in_progress", 409);
    await expect(db.recipe.count()).resolves.toBe(0);
    await expect(db.apiIdempotencyKey.count({
      where: { key: body.clientMutationId, responseStatus: null },
    })).resolves.toBe(1);
  });

  it("recovers import metadata from valid tombstones and honest fallbacks for malformed or missing journals", async () => {
    makeFetchHarness();
    const { chef, writer } = await createImportFixture(db);

    async function seedCommittedImport(
      body: { clientMutationId: string; source: Record<string, unknown> },
      options: {
        payload?: string | null;
        title: string;
      },
    ) {
      const reservation = await reserveImportMutation(db, {
        body,
        chefId: chef.id,
        credentialId: writer.credential.id,
      });
      await db.recipe.create({
        data: {
          ...createTestRecipe(chef.id),
          id: reservation.id,
          title: options.title,
          description: "Recovered import recipe",
          sourceUrl: typeof body.source.url === "string" ? body.source.url : null,
        },
      });
      if (options.payload !== undefined) {
        await db.apiMutationTombstone.create({
          data: {
            idempotencyKeyId: reservation.id,
            operation: "recipes.import",
            resourceType: "recipeImport",
            resourceId: reservation.id,
            payload: options.payload,
          },
        });
      }
      return reservation;
    }

    const urlBody = {
      clientMutationId: "native-import-valid-tombstone-1",
      source: { type: "url", url: "https://recipes.example/lemon-pasta" },
    };
    await seedCommittedImport(urlBody, {
      title: "Recovered Tombstone URL",
      payload: JSON.stringify({
        inputType: "url",
        source: "mixed",
        confidence: "medium",
        existingRecipeId: "recipe_existing_import",
        coverPending: true,
      }),
    });
    const validTombstone = await action(routeArgs(
      importRequest(writer.token, "req_import_valid_tombstone", urlBody),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));
    const validPayload = await readJson(validTombstone);
    expect(validTombstone.status).toBe(201);
    expectImportMutationData(validPayload.data, urlBody.clientMutationId, true, "url", "mixed");
    expect(validPayload.data.import).toMatchObject({
      confidence: "medium",
      existingRecipeId: "recipe_existing_import",
      coverPending: true,
    });

    const textBody = {
      clientMutationId: "native-import-text-fallback-1",
      source: { type: "text", text: "Native text import that already committed." },
    };
    await seedCommittedImport(textBody, {
      title: "Recovered Text Import",
    });
    const textFallback = await action(routeArgs(
      importRequest(writer.token, "req_import_text_fallback", textBody),
      "recipes/import",
    ));
    const textPayload = await readJson(textFallback);
    expect(textFallback.status).toBe(201);
    expectImportMutationData(textPayload.data, textBody.clientMutationId, true, "text", "llm");

    const jsonLdBody = {
      clientMutationId: "native-import-jsonld-fallback-1",
      source: { type: "json-ld", jsonLd: jsonLdImportDocument("Recovered JSON-LD Import") },
    };
    await seedCommittedImport(jsonLdBody, {
      title: "Recovered JSON-LD Import",
      payload: "{not valid json",
    });
    const jsonLdFallback = await action(routeArgs(
      importRequest(writer.token, "req_import_jsonld_fallback", jsonLdBody),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));
    const jsonLdPayload = await readJson(jsonLdFallback);
    expect(jsonLdFallback.status).toBe(201);
    expectImportMutationData(jsonLdPayload.data, jsonLdBody.clientMutationId, true, "json-ld", "json-ld");

    const malformedShapeBody = {
      clientMutationId: "native-import-malformed-shape-fallback-1",
      source: { type: "text", text: "Committed text import with a wrong-shaped tombstone." },
    };
    await seedCommittedImport(malformedShapeBody, {
      title: "Recovered Malformed Shape Import",
      payload: "{}",
    });
    const malformedShapeFallback = await action(routeArgs(
      importRequest(writer.token, "req_import_malformed_shape_fallback", malformedShapeBody),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));
    const malformedShapePayload = await readJson(malformedShapeFallback);
    expect(malformedShapeFallback.status).toBe(201);
    expectImportMutationData(
      malformedShapePayload.data,
      malformedShapeBody.clientMutationId,
      true,
      "text",
      "llm",
    );

    const nullPayloadBody = {
      clientMutationId: "native-import-null-tombstone-fallback-1",
      source: { type: "url", url: "https://recipes.example/lemon-pasta" },
    };
    await seedCommittedImport(nullPayloadBody, {
      title: "Recovered Null Tombstone Import",
      payload: null,
    });
    const nullPayloadFallback = await action(routeArgs(
      importRequest(writer.token, "req_import_null_tombstone_fallback", nullPayloadBody),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));
    const nullPayload = await readJson(nullPayloadFallback);
    expect(nullPayloadFallback.status).toBe(201);
    expectImportMutationData(
      nullPayload.data,
      nullPayloadBody.clientMutationId,
      true,
      "url",
      null,
    );

    const videoBody = {
      clientMutationId: "native-import-video-fallback-1",
      source: { type: "video-url", url: "https://www.youtube.com/watch?v=codex" },
    };
    await seedCommittedImport(videoBody, {
      title: "Recovered Video Import",
    });
    const videoFallback = await action(routeArgs(
      importRequest(writer.token, "req_import_video_fallback", videoBody),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));
    const videoPayload = await readJson(videoFallback);
    expect(videoFallback.status).toBe(201);
    expectImportMutationData(videoPayload.data, videoBody.clientMutationId, true, "video-url", "video-oembed-llm");
  });

  it("rejects a reused clientMutationId with different import content", async () => {
    makeFetchHarness();
    const { writer } = await createImportFixture(db);
    const clientMutationId = "native-import-conflict-1";

    const first = await action(routeArgs(
      importRequest(writer.token, "req_import_conflict_first", {
        clientMutationId,
        source: { type: "url", url: "https://recipes.example/lemon-pasta" },
      }),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));
    const conflict = await action(routeArgs(
      importRequest(writer.token, "req_import_conflict_second", {
        clientMutationId,
        source: { type: "json-ld", url: "https://captures.example/other", jsonLd: jsonLdImportDocument("Other Codex Card") },
      }),
      "recipes/import",
      { OPENAI_API_KEY: "sk-test", ARTIFACT_ROOT: artifactRoot },
    ));

    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    expectErrorEnvelope(await readJson(conflict), "req_import_conflict_second", "idempotency_conflict", 409);
    await expect(db.recipe.count()).resolves.toBe(1);
  });
});
