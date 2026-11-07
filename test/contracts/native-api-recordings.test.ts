// Recorded responses for every endpoint the native app (spoonjoy/spoonjoy-apple) calls.
//
// This test drives one synthetic chef through the real route handlers, the way the native app does,
// with the request bodies the native app sends. It normalizes the values that change between runs
// (IDs, tokens, cursors and timestamps) and compares each response with its committed recording in
// test/fixtures/native-api-recordings. spoonjoy-apple keeps a copy of that directory and decodes
// every recording into its Swift models, so a change to a response shape fails here first.
//
// The cook-session endpoints (/api/cook-sessions/...) are served by a Durable Object that only runs in
// the Workers runtime, so test/workers/native-cook-session-recordings.test.ts records and checks
// those (the `cook-session-*` files). This test lists them in index.json after its own.
//
// After an intended response change, refresh the recordings here, then refresh spoonjoy-apple's copy once
// this lands on main (spoonjoy-apple's "v2 API recordings" check fails while the copies differ):
//
//   pnpm run test:native-recordings:refresh               # in spoonjoy-v2
//   ruby scripts/check-v2-api-recordings.rb --update      # in spoonjoy-apple
//
// Every value is synthetic: no real user data, tokens or secrets are recorded.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { createApiCredential } from "~/lib/api-auth.server";
import { createUser } from "~/lib/auth.server";
import { buildApiV1OpenApiDocument } from "~/lib/api-v1-openapi.server";
import { recordCookingNow } from "~/lib/cooking-now.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { getLocalDb } from "~/lib/db.server";
import * as recipeImport from "~/lib/recipe-import.server";
import * as recipeWrites from "~/lib/api-v1-recipe-writes.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1 } from "../helpers/sqlite-d1";
import {
  COOK_SESSION_RECORDING_PREFIX,
  createRecordingNormalizer,
  serializeRecording as serialize,
  type Recording,
  type RecordingIndexEntry,
} from "./native-api-recording-format";

// Account deletion runs on the request's D1 binding; the rest of the API reads the same local
// database through getRequestDb.
const mocked = vi.hoisted(() => ({ db: null as PrismaClientType | null }));

vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: vi.fn(async () => mocked.db!),
}));

// Apple's identity-token check needs Apple's signing keys. The Apple route's own handler still runs;
// the account behind the synthetic Apple credential is the friend chef, signed in the way password
// sign-in does it, so the route answers with real first-party tokens.
vi.mock("~/lib/apple-native-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/apple-native-auth.server")>()),
  handleNativeAppleSignIn: vi.fn(async (db: any, _input: unknown, _config: unknown, options: { issuer: string }) => {
    const { handleNativePasswordSignIn } = await import("~/lib/native-password-auth.server");
    return await handleNativePasswordSignIn(db, { emailOrUsername: "contract_friend", password: "contract-friend-password-not-secret" }, { issuer: options.issuer });
  }),
}));

const { action: apiAction, loader: apiLoader } = await import("~/routes/api.v1.$");
const { action: oauthRegisterAction } = await import("~/routes/oauth.register");
const { action: oauthTokenAction } = await import("~/routes/oauth.token");

export const RECORDINGS_DIRECTORY = path.resolve(__dirname, "../fixtures/native-api-recordings");
const WRITE_RECORDINGS = process.env.SPOONJOY_WRITE_NATIVE_API_RECORDINGS === "1";

const ORIGIN = "http://localhost";
const CHEF_PASSWORD = "contract-chef-password-not-secret";
const FRIEND_PASSWORD = "contract-friend-password-not-secret";
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const recordings: Recording[] = [];
const normalizeRecordedValue = createRecordingNormalizer();

// Work a request hands to waitUntil (an AI placeholder cover, notifications) finishes before the
// next request starts, so every run sees the same order of events.
const backgroundWork: Promise<unknown>[] = [];

async function drainBackgroundWork() {
  while (backgroundWork.length > 0) {
    await Promise.allSettled(backgroundWork.splice(0));
  }
}

function routeArgs(request: Request, splat: string, env: Record<string, unknown> | null = null) {
  return {
    request,
    params: { "*": splat },
    context: {
      cloudflare: {
        env,
        ctx: { waitUntil: (promise: Promise<unknown>) => void backgroundWork.push(promise.catch(() => undefined)) },
      },
    },
  } as any;
}

let photoBucket: R2Bucket;

function mockPhotoBucket(): R2Bucket {
  const keys = new Set<string>();
  return {
    put: vi.fn(async (key: string) => {
      keys.add(key);
    }),
    get: vi.fn(async (key: string) => (keys.has(key) ? { key } : null)),
    delete: vi.fn(async (key: string) => {
      keys.delete(key);
    }),
  } as unknown as R2Bucket;
}

let d1Binding: unknown;

function apiEnv() {
  return {
    PHOTOS: photoBucket,
    DB: d1Binding,
    SPOONJOY_BASE_URL: ORIGIN,
    APPLE_NATIVE_CLIENT_IDS: "app.spoonjoy",
  };
}

async function capture(name: string, endpoint: string, response: Response, expectedStatus: number) {
  const text = await response.text();
  await drainBackgroundWork();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${endpoint} answered ${response.status} with a body that is not JSON: ${text.slice(0, 200)}`);
  }
  if (response.status !== expectedStatus) {
    throw new Error(`${endpoint} answered ${response.status}, expected ${expectedStatus}: ${text.slice(0, 600)}`);
  }
  recordings.push({ name, endpoint, status: response.status, body: normalizeRecordedValue(body) });
  return body as any;
}

async function api(
  name: string,
  method: Method,
  apiPath: string,
  options: {
    token?: string;
    body?: unknown;
    form?: UndiciFormData;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    endpoint: string;
    status?: number;
    env?: Record<string, unknown>;
  },
) {
  const url = new URL(`${ORIGIN}/api/v1/${apiPath}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const headers: Record<string, string> = { "X-Request-Id": `req_${name}`, ...options.headers };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: string | UndiciFormData | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const request = new UndiciRequest(url, {
    method,
    headers,
    body,
    ...(options.form ? { duplex: "half" as const } : {}),
  }) as unknown as Request;
  const args = routeArgs(request, apiPath, { ...apiEnv(), ...options.env });
  const response = method === "GET" ? await apiLoader(args) : await apiAction(args);
  return capture(name, options.endpoint, response as Response, options.status ?? 200);
}

function photoForm(fields: Record<string, string>) {
  const form = new UndiciFormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("photo", new File([PNG_BYTES], "dish.png", { type: "image/png" }));
  return form;
}

async function oauthForm(name: string, endpoint: string, handler: typeof oauthTokenAction, url: string, body: URLSearchParams, status = 200) {
  const request = new UndiciRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Request-Id": `req_${name}` },
    body,
  }) as unknown as Request;
  return capture(name, endpoint, await handler(routeArgs(request, "", null)) as Response, status);
}

// Sorted by name, so the index does not depend on the order the directory lists files in.
function committedCookSessionIndexEntries(): RecordingIndexEntry[] {
  return fs.readdirSync(RECORDINGS_DIRECTORY)
    .filter((file) => file.startsWith(COOK_SESSION_RECORDING_PREFIX) && file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort()
    .map((name) => readCommittedRecording(name)!)
    .map(({ name, endpoint, status }) => ({ name, endpoint, status }));
}

function readCommittedRecording(name: string): Recording | null {
  const file = path.join(RECORDINGS_DIRECTORY, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as Recording : null;
}

async function recordNativeSession() {
  const db = mocked.db!;
  const chefUser = await createUser(db, "contract-chef@example.test", "contract_chef", CHEF_PASSWORD);
  // Token management needs tokens:read and tokens:write, which native sign-in never grants; the app
  // reads tokens and connections only for a session that has them, such as a personal token.
  const tokenAdmin = (await createApiCredential(db, chefUser.id, "Contract token admin", { scopes: ["tokens:read", "tokens:write", "recipes:read"] })).token;
  await createUser(db, "contract-friend@example.test", "contract_friend", FRIEND_PASSWORD);

  // Sign-in and OAuth: the native app signs in and then calls everything with that access token.
  const signIn = await api("auth-password-native", "POST", "auth/password/native", {
    body: { emailOrUsername: "contract_chef", password: CHEF_PASSWORD },
    endpoint: "POST /api/v1/auth/password/native",
    status: 201,
  });
  const chef = signIn.data.access_token as string;
  const friendSignIn = await api("auth-password-native-friend", "POST", "auth/password/native", {
    body: { emailOrUsername: "contract-friend@example.test", password: FRIEND_PASSWORD },
    endpoint: "POST /api/v1/auth/password/native",
    status: 201,
  });
  recordings.pop();
  const friend = friendSignIn.data.access_token as string;
  await api("auth-apple-native", "POST", "auth/apple/native", {
    body: { identityToken: "header.payload.signature", rawNonce: "contract-raw-nonce", email: "contract-friend@example.test", fullName: "Contract Friend" },
    endpoint: "POST /api/v1/auth/apple/native",
    status: 201,
  });
  await oauthForm("oauth-token-refresh", "POST /oauth/token", oauthTokenAction, `${ORIGIN}/oauth/token`, new URLSearchParams({
    grant_type: "refresh_token",
    client_id: signIn.data.client_id,
    refresh_token: signIn.data.refresh_token,
  }));
  {
    const request = new UndiciRequest(`${ORIGIN}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_oauth-register" },
      body: JSON.stringify({ client_name: "Spoonjoy Apple", redirect_uris: ["https://spoonjoy.app/oauth/callback"], token_endpoint_auth_method: "none" }),
    }) as unknown as Request;
    await capture("oauth-register", "POST /oauth/register", await oauthRegisterAction(routeArgs(request, "", null)) as Response, 201);
  }

  // Recipe editor. The first create meets D1 briefly unavailable and answers a retryable 503;
  // the client keeps the mutation queued and retries it with the same clientMutationId, which
  // creates the recipe once.
  const recipeCreateBody = {
    clientMutationId: "cm_recipe_create",
    title: "Lemon Pantry Pasta",
    description: "Bright weeknight pasta from the pantry.",
    servings: "4",
    steps: [
      {
        stepTitle: "Boil",
        description: "Cook the spaghetti in salted water.",
        duration: 10,
        ingredients: [
          { quantity: 200, unit: "g", name: "spaghetti" },
          { quantity: 1, unit: "tsp", name: "salt" },
        ],
      },
    ],
  };
  vi.spyOn(recipeWrites, "createNativeRecipe").mockRejectedValueOnce(new Error("D1_ERROR: Network connection lost."));
  await api("recipe-create-temporarily-unavailable", "POST", "recipes", {
    token: chef,
    body: recipeCreateBody,
    endpoint: "POST /api/v1/recipes",
    status: 503,
  });
  const created = await api("recipe-create", "POST", "recipes", {
    token: chef,
    body: recipeCreateBody,
    endpoint: "POST /api/v1/recipes",
    status: 201,
  });
  const recipeId = created.data.recipe.id as string;
  const step = await api("recipe-step-create", "POST", `recipes/${recipeId}/steps`, {
    token: chef,
    body: {
      clientMutationId: "cm_step_create",
      stepNum: 2,
      stepTitle: "Toss",
      description: "Toss the pasta with lemon and olive oil.",
      duration: 2,
      ingredients: [{ quantity: 1, unit: "whole", name: "lemon" }],
      outputStepNums: [1],
    },
    endpoint: "POST /api/v1/recipes/{id}/steps",
    status: 201,
  });
  const stepId = step.data.step.id as string;
  await api("recipe-step-update", "PATCH", `recipes/${recipeId}/steps/${stepId}`, {
    token: chef,
    body: {
      clientMutationId: "cm_step_update",
      stepTitle: "Toss and serve",
      description: "Toss the pasta with lemon and olive oil, then serve.",
      duration: 3,
      outputStepNums: [1],
    },
    endpoint: "PATCH /api/v1/recipes/{id}/steps/{stepId}",
  });
  const ingredient = await api("recipe-ingredient-create", "POST", `recipes/${recipeId}/steps/${stepId}/ingredients`, {
    token: chef,
    body: { clientMutationId: "cm_ingredient_create", quantity: 2, unit: "tbsp", name: "olive oil" },
    endpoint: "POST /api/v1/recipes/{id}/steps/{stepId}/ingredients",
    status: 201,
  });
  const extra = await api("recipe-ingredient-create-extra", "POST", `recipes/${recipeId}/steps/${stepId}/ingredients`, {
    token: chef,
    body: { clientMutationId: "cm_ingredient_create_extra", quantity: 1, unit: "pinch", name: "chili flakes" },
    endpoint: "POST /api/v1/recipes/{id}/steps/{stepId}/ingredients",
    status: 201,
  });
  recordings.pop();
  await api("recipe-ingredient-delete", "DELETE", `recipes/${recipeId}/steps/${stepId}/ingredients/${extra.data.ingredient.id}`, {
    token: chef,
    headers: { "X-Client-Mutation-Id": "cm_ingredient_delete" },
    endpoint: "DELETE /api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}",
  });
  expect(ingredient.data.ingredient.id).toBeTruthy();
  await api("recipe-output-uses-replace", "PUT", `recipes/${recipeId}/step-output-uses`, {
    token: chef,
    body: { clientMutationId: "cm_output_uses", inputStepId: stepId, outputStepNums: [1] },
    endpoint: "PUT /api/v1/recipes/{id}/step-output-uses",
  });
  const scratchStep = await api("recipe-step-create-scratch", "POST", `recipes/${recipeId}/steps`, {
    token: chef,
    body: {
      clientMutationId: "cm_step_create_scratch",
      stepNum: 3,
      stepTitle: null,
      description: "Garnish.",
      duration: null,
      ingredients: [],
      outputStepNums: [],
    },
    endpoint: "POST /api/v1/recipes/{id}/steps",
    status: 201,
  });
  recordings.pop();
  await api("recipe-step-reorder", "POST", `recipes/${recipeId}/steps/reorder`, {
    token: chef,
    body: { clientMutationId: "cm_step_reorder", stepId: scratchStep.data.step.id, toStepNum: 1 },
    endpoint: "POST /api/v1/recipes/{id}/steps/reorder",
  });
  await api("recipe-step-delete", "DELETE", `recipes/${recipeId}/steps/${scratchStep.data.step.id}`, {
    token: chef,
    body: { clientMutationId: "cm_step_delete" },
    endpoint: "DELETE /api/v1/recipes/{id}/steps/{stepId}",
  });
  // The app sends the recipe's updatedAt as its edit read it. An edit based on an older version is
  // turned down with the recipe as it is now; keeping the cook's edit sends it again, with the same
  // clientMutationId, based on that current version.
  const recipeEdit = {
    clientMutationId: "cm_recipe_update",
    title: "Lemon Pantry Pasta",
    description: "Bright weeknight pasta from the pantry, ready in fifteen minutes.",
    servings: "4",
  };
  const editConflict = await api("recipe-update-edit-conflict", "PATCH", `recipes/${recipeId}`, {
    token: chef,
    body: { ...recipeEdit, expectedUpdatedAt: "2025-01-01T00:00:00.000Z" },
    endpoint: "PATCH /api/v1/recipes/{id}",
    status: 409,
  });
  await api("recipe-update", "PATCH", `recipes/${recipeId}`, {
    token: chef,
    body: { ...recipeEdit, expectedUpdatedAt: editConflict.error.details.currentUpdatedAt },
    endpoint: "PATCH /api/v1/recipes/{id}",
  });

  // Covers and spoons.
  const upload = await api("recipe-image-upload", "POST", `recipes/${recipeId}/image`, {
    token: chef,
    form: photoForm({ clientMutationId: "cm_cover_upload", activateWhenReady: "true", generateEditorial: "false", postAsSpoon: "false" }),
    endpoint: "POST /api/v1/recipes/{id}/image",
    status: 201,
  });
  expect(upload.ok).toBe(true);
  const covers = await api("recipe-covers-list", "GET", `recipes/${recipeId}/covers`, {
    token: chef,
    query: { includeArchived: "true", limit: "20", offset: "0" },
    endpoint: "GET /api/v1/recipes/{id}/covers",
  });
  const coverId = covers.data.covers.find((cover: { sourceType: string }) => cover.sourceType === "chef-upload").id as string;
  await api("recipe-cover-activate", "PATCH", `recipes/${recipeId}/covers/${coverId}`, {
    token: chef,
    body: { clientMutationId: "cm_cover_activate", variant: "image" },
    endpoint: "PATCH /api/v1/recipes/{id}/covers/{coverId}",
  });
  const jsonSpoon = await api("recipe-spoon-create", "POST", `recipes/${recipeId}/spoons`, {
    token: chef,
    body: {
      clientMutationId: "cm_spoon_create",
      note: "Added extra lemon zest.",
      nextTime: "Try bucatini.",
      cookedAt: "2026-01-01T19:00:00.000Z",
      photoUrl: null,
      useAsRecipeCover: false,
    },
    endpoint: "POST /api/v1/recipes/{id}/spoons",
    status: 201,
  });
  await api("recipe-spoon-update", "PATCH", `recipes/${recipeId}/spoons/${jsonSpoon.data.spoon.id}`, {
    token: chef,
    body: {
      clientMutationId: "cm_spoon_update",
      note: "Added extra lemon zest and pepper.",
      nextTime: "Try bucatini.",
      cookedAt: "2026-01-01T19:00:00.000Z",
      photoUrl: null,
    },
    endpoint: "PATCH /api/v1/recipes/{id}/spoons/{spoonId}",
  });
  await api("recipe-spoon-create-photo", "POST", `recipes/${recipeId}/spoons`, {
    token: chef,
    form: photoForm({
      clientMutationId: "cm_spoon_create_photo",
      useAsRecipeCover: "false",
      note: "Charred the lemons first.",
      nextTime: "More pepper.",
      cookedAt: "2026-01-01T20:00:00.000Z",
    }),
    endpoint: "POST /api/v1/recipes/{id}/spoons",
    status: 201,
  });
  const photoSpoon = await api("recipe-image-upload-spoon", "POST", `recipes/${recipeId}/image`, {
    token: chef,
    form: photoForm({ clientMutationId: "cm_image_spoon", activateWhenReady: "false", generateEditorial: "false", postAsSpoon: "true", note: "Lovely and quick." }),
    endpoint: "POST /api/v1/recipes/{id}/image",
    status: 201,
  });
  await api("recipe-cover-from-spoon", "POST", `recipes/${recipeId}/covers/from-spoon/${photoSpoon.data.spoon.id}`, {
    token: chef,
    body: { clientMutationId: "cm_cover_from_spoon", activate: false, generateEditorial: false },
    endpoint: "POST /api/v1/recipes/{id}/covers/from-spoon/{spoonId}",
    status: 201,
  });
  await api("recipe-spoons-list", "GET", `recipes/${recipeId}/spoons`, {
    query: { limit: "20" },
    endpoint: "GET /api/v1/recipes/{id}/spoons",
  });
  await api("recipe-cover-set-no-cover", "PATCH", `recipes/${recipeId}/covers`, {
    token: chef,
    body: { clientMutationId: "cm_cover_no_cover", confirmNoCover: true },
    endpoint: "PATCH /api/v1/recipes/{id}/covers",
  });
  await api("recipe-cover-archive", "DELETE", `recipes/${recipeId}/covers/${coverId}`, {
    token: chef,
    query: { clientMutationId: "cm_cover_archive" },
    body: { replacementCoverId: null, replacementVariant: null, confirmNoCover: true, deleteSafeObjects: false },
    endpoint: "DELETE /api/v1/recipes/{id}/covers/{coverId}",
  });

  // A second chef's recipe to fork, search and save.
  const friendRecipe = await api("recipe-create-friend", "POST", "recipes", {
    token: friend,
    body: {
      clientMutationId: "cm_friend_recipe",
      title: "Tomato Herb Soup",
      description: "A simple soup.",
      servings: "2",
      steps: [{ stepTitle: null, description: "Simmer everything.", duration: 20, ingredients: [{ quantity: 400, unit: "g", name: "tomatoes" }] }],
    },
    endpoint: "POST /api/v1/recipes",
    status: 201,
  });
  recordings.pop();
  const friendRecipeId = friendRecipe.data.recipe.id as string;
  const fork = await api("recipe-fork", "POST", `recipes/${friendRecipeId}/fork`, {
    token: chef,
    body: { clientMutationId: "cm_recipe_fork", title: "Tomato Herb Soup, my way" },
    endpoint: "POST /api/v1/recipes/{id}/fork",
    status: 201,
  });

  // Cookbooks.
  const cookbook = await api("cookbook-create", "POST", "cookbooks", {
    token: chef,
    body: { clientMutationId: "cm_cookbook_create", title: "Weeknights" },
    endpoint: "POST /api/v1/cookbooks",
    status: 201,
  });
  const cookbookId = cookbook.data.cookbook.id as string;
  await api("cookbook-update", "PATCH", `cookbooks/${cookbookId}`, {
    token: chef,
    body: { clientMutationId: "cm_cookbook_update", title: "Weeknight Dinners" },
    endpoint: "PATCH /api/v1/cookbooks/{id}",
  });
  await api("cookbook-add-recipe", "POST", `cookbooks/${cookbookId}/recipes/${recipeId}`, {
    token: chef,
    body: { clientMutationId: "cm_cookbook_add" },
    endpoint: "POST /api/v1/cookbooks/{id}/recipes/{recipeId}",
    status: 201,
  });
  await api("cookbook-add-recipe-friend", "POST", `cookbooks/${cookbookId}/recipes/${friendRecipeId}`, {
    token: chef,
    body: { clientMutationId: "cm_cookbook_add_friend" },
    endpoint: "POST /api/v1/cookbooks/{id}/recipes/{recipeId}",
    status: 201,
  });
  recordings.pop();
  await api("cookbook-remove-recipe", "DELETE", `cookbooks/${cookbookId}/recipes/${friendRecipeId}`, {
    token: chef,
    body: { clientMutationId: "cm_cookbook_remove" },
    endpoint: "DELETE /api/v1/cookbooks/{id}/recipes/{recipeId}",
  });
  const scratchCookbook = await api("cookbook-create-scratch", "POST", "cookbooks", {
    token: chef,
    body: { clientMutationId: "cm_cookbook_create_scratch", title: "Someday" },
    endpoint: "POST /api/v1/cookbooks",
    status: 201,
  });
  recordings.pop();
  await api("cookbook-delete", "DELETE", `cookbooks/${scratchCookbook.data.cookbook.id}`, {
    token: chef,
    query: { clientMutationId: "cm_cookbook_delete" },
    endpoint: "DELETE /api/v1/cookbooks/{id}",
  });
  await api("cookbooks-list", "GET", "cookbooks", { query: { limit: "20" }, endpoint: "GET /api/v1/cookbooks" });
  await api("cookbook-detail", "GET", `cookbooks/${cookbookId}`, { endpoint: "GET /api/v1/cookbooks/{id}" });

  // Shopping list.
  await api("shopping-list-read", "GET", "shopping-list", { token: chef, endpoint: "GET /api/v1/shopping-list" });
  const item = await api("shopping-item-add", "POST", "shopping-list/items", {
    token: chef,
    body: { clientMutationId: "cm_shopping_add", name: "parmesan", quantity: 50, unit: "g" },
    endpoint: "POST /api/v1/shopping-list/items",
    status: 201,
  });
  await api("shopping-item-check", "PATCH", `shopping-list/items/${item.data.item.id}`, {
    token: chef,
    body: { clientMutationId: "cm_shopping_check", checked: true },
    endpoint: "PATCH /api/v1/shopping-list/items/{itemId}",
  });
  await api("shopping-add-from-recipe", "POST", "shopping-list/add-from-recipe", {
    token: chef,
    body: { clientMutationId: "cm_shopping_from_recipe", recipeId, scaleFactor: 1 },
    endpoint: "POST /api/v1/shopping-list/add-from-recipe",
  });
  await api("shopping-list-read-full", "GET", "shopping-list", { token: chef, endpoint: "GET /api/v1/shopping-list" });
  await api("shopping-item-delete", "DELETE", `shopping-list/items/${item.data.item.id}`, {
    token: chef,
    headers: { "X-Client-Mutation-Id": "cm_shopping_delete" },
    endpoint: "DELETE /api/v1/shopping-list/items/{itemId}",
  });
  await api("shopping-clear-completed", "POST", "shopping-list/clear-completed", {
    token: chef,
    body: { clientMutationId: "cm_shopping_clear_completed" },
    endpoint: "POST /api/v1/shopping-list/clear-completed",
  });
  await api("shopping-clear-all", "POST", "shopping-list/clear-all", {
    token: chef,
    body: { clientMutationId: "cm_shopping_clear_all" },
    endpoint: "POST /api/v1/shopping-list/clear-all",
  });

  // Catalog, search, profiles, chefs and sync.
  await api("recipes-list", "GET", "recipes", { query: { limit: "20" }, endpoint: "GET /api/v1/recipes" });
  await api("recipe-detail", "GET", `recipes/${recipeId}`, { token: chef, endpoint: "GET /api/v1/recipes/{id}" });
  await api("search", "GET", "search", { query: { q: "pasta", scope: "all", limit: "20" }, endpoint: "GET /api/v1/search" });
  // The signed-in app sends its token on profile pages, so the chef's own profile answers isOwner.
  await api("user-profile", "GET", "users/contract_chef", { token: chef, endpoint: "GET /api/v1/users/{identifier}" });
  await api("user-kitchen-visitors", "GET", "users/contract_chef/kitchen-visitors", {
    token: chef,
    query: { page: "1", limit: "20" },
    endpoint: "GET /api/v1/users/{identifier}/kitchen-visitors",
  });
  await api("user-fellow-chefs", "GET", "users/contract_chef/fellow-chefs", {
    token: chef,
    query: { page: "1", limit: "20" },
    endpoint: "GET /api/v1/users/{identifier}/fellow-chefs",
  });
  await api("me-chefs", "GET", "me/chefs", { token: chef, endpoint: "GET /api/v1/me/chefs" });
  // Cooking now: the Worker records a row after each cook-session write; record one directly.
  await recordCookingNow(d1Binding as D1ReadDatabase, {
    userId: chefUser.id,
    recipeId,
    attemptId: "11111111-1111-4111-8111-111111111111",
    revision: 1,
    activeStepId: stepId,
    activeStepIndex: 0,
    checkedCount: 1,
    touchedAt: Date.now(),
  });
  await api("cooking-now", "GET", "cooking-now", { token: chef, endpoint: "GET /api/v1/cooking-now" });
  await api("me-sync", "GET", "me/sync", { token: chef, query: { limit: "20" }, endpoint: "GET /api/v1/me/sync" });

  // Recipe import: without the import provider's secret the API answers with a blocker, and with it
  // the parsed recipe. The provider call itself is replaced by a fixed parse.
  const importSource = {
    type: "json-ld",
    url: "https://recipes.example/garlic-bread",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Garlic Bread",
      recipeYield: "4",
      recipeIngredient: ["1 baguette", "3 cloves garlic", "4 tbsp butter"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Spread garlic butter on the bread and bake." }],
    },
  };
  await api("recipe-import-blocked", "POST", "recipes/import", {
    token: chef,
    body: { clientMutationId: "cm_recipe_import_blocked", source: importSource },
    endpoint: "POST /api/v1/recipes/import",
  });
  vi.spyOn(recipeImport, "importRecipeFromSource").mockImplementation(async (options) => {
    const recipe = await db.recipe.create({
      data: {
        id: options.recipeId,
        chefId: options.chefId,
        title: "Garlic Bread",
        description: null,
        servings: "4",
        sourceUrl: "https://recipes.example/garlic-bread",
      },
    });
    return { recipeId: recipe.id, recipe, confidence: "high", source: "json-ld", existingRecipeId: null, coverPending: false };
  });
  await api("recipe-import", "POST", "recipes/import", {
    token: chef,
    env: { OPENAI_API_KEY: "contract-test-key-not-secret" },
    body: {
      clientMutationId: "cm_recipe_import",
      source: {
        type: "json-ld",
        url: "https://recipes.example/garlic-bread",
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "Recipe",
          name: "Garlic Bread",
          recipeYield: "4",
          recipeIngredient: ["1 baguette", "3 cloves garlic", "4 tbsp butter"],
          recipeInstructions: [{ "@type": "HowToStep", text: "Spread garlic butter on the bread and bake." }],
        },
      },
    },
    endpoint: "POST /api/v1/recipes/import",
    status: 201,
  });

  // Account and settings.
  await api("me", "GET", "me", { token: chef, endpoint: "GET /api/v1/me" });
  await api("me-update", "PATCH", "me", {
    token: chef,
    body: { clientMutationId: "cm_me_update", email: "contract-chef@example.test", username: "contract_chef" },
    endpoint: "PATCH /api/v1/me",
  });
  await api("me-photo-upload", "POST", "me/photo", {
    token: chef,
    form: photoForm({ clientMutationId: "cm_me_photo_upload" }),
    endpoint: "POST /api/v1/me/photo",
  });
  await api("me-photo-remove", "DELETE", "me/photo", {
    token: chef,
    headers: { "X-Client-Mutation-Id": "cm_me_photo_remove" },
    endpoint: "DELETE /api/v1/me/photo",
  });
  await api("notification-preferences", "GET", "me/notification-preferences", { token: chef, endpoint: "GET /api/v1/me/notification-preferences" });
  await api("notification-preferences-update", "PATCH", "me/notification-preferences", {
    token: chef,
    body: { clientMutationId: "cm_notification_preferences", notifySpoonOnMyRecipe: true, notifyForkOfMyRecipe: false, notifyCookbookSaveOfMine: true, notifyFellowChefOriginCook: false },
    endpoint: "PATCH /api/v1/me/notification-preferences",
  });
  await api("apns-device-register", "POST", "me/apns-devices", {
    token: chef,
    body: {
      clientMutationId: "cm_apns_register",
      deviceId: "contract-device-1",
      platform: "ios",
      environment: "development",
      token: "a".repeat(64),
      deviceName: "Contract iPhone",
      appVersion: "1.0 (1)",
    },
    endpoint: "POST /api/v1/me/apns-devices",
    status: 201,
  });
  await api("apns-device-revoke", "DELETE", "me/apns-devices/contract-device-1", {
    token: chef,
    headers: { "X-Client-Mutation-Id": "cm_apns_revoke" },
    endpoint: "DELETE /api/v1/me/apns-devices/{deviceId}",
  });
  // The first request with a token records its last use while the request runs, so a list made with a
  // fresh token could show it either used or not. Use the token once first so the list is repeatable.
  await api("tokens-list-warmup", "GET", "tokens", { token: tokenAdmin, endpoint: "GET /api/v1/tokens" });
  recordings.pop();
  await api("tokens-list", "GET", "tokens", { token: tokenAdmin, endpoint: "GET /api/v1/tokens" });
  const createdToken = await api("token-create", "POST", "tokens", {
    token: tokenAdmin,
    body: { name: "Shortcuts", scopes: ["recipes:read"] },
    endpoint: "POST /api/v1/tokens",
    status: 201,
  });
  await api("token-revoke", "DELETE", `tokens/${createdToken.data.credential.id}`, { token: tokenAdmin, endpoint: "DELETE /api/v1/tokens/{credentialId}" });
  await api("native-telemetry", "POST", "native/telemetry", {
    token: chef,
    body: { event: "sync_failed", stage: "sync", environment: "production", platform: "ios", appVersion: "1.0", buildNumber: "1", route: "/api/v1/me/sync", status: 503 },
    endpoint: "POST /api/v1/native/telemetry",
    status: 202,
  });
  await api("me-export", "GET", "me/export", { token: chef, endpoint: "GET /api/v1/me/export" });

  // Moderation: the friend reports the chef's recipe (again answers the same open report), then
  // blocks, lists and unblocks the chef.
  await api("report-create", "POST", "reports", {
    token: friend,
    body: { targetType: "recipe", targetId: recipeId, reason: "offensive", details: "Contract report." },
    endpoint: "POST /api/v1/reports",
    status: 201,
  });
  await api("report-create-again", "POST", "reports", {
    token: friend,
    body: { targetType: "recipe", targetId: recipeId, reason: "offensive" },
    endpoint: "POST /api/v1/reports",
  });
  await api("block-create", "POST", "blocks", { token: friend, body: { chefId: chefUser.id }, endpoint: "POST /api/v1/blocks" });
  await api("blocks-list", "GET", "blocks", { token: friend, endpoint: "GET /api/v1/blocks" });
  await api("block-delete", "DELETE", `blocks/${chefUser.id}`, { token: friend, endpoint: "DELETE /api/v1/blocks/{chefId}" });

  // Deletes, last: they remove what the reads above recorded.
  await api("recipe-spoon-delete", "DELETE", `recipes/${recipeId}/spoons/${jsonSpoon.data.spoon.id}`, {
    token: chef,
    headers: { "X-Client-Mutation-Id": "cm_spoon_delete" },
    endpoint: "DELETE /api/v1/recipes/{id}/spoons/{spoonId}",
  });
  await api("recipe-delete", "DELETE", `recipes/${fork.data.recipe.id}`, {
    token: chef,
    query: { clientMutationId: "cm_recipe_delete" },
    endpoint: "DELETE /api/v1/recipes/{id}",
  });
  // The OAuth connection the native sign-in made. Disconnecting it revokes the chef's access token,
  // so it comes after every call that uses that token.
  const connections = await api("connections-list", "GET", "me/connections", { token: tokenAdmin, endpoint: "GET /api/v1/me/connections" });
  await api("connection-disconnect", "DELETE", `me/connections/${connections.data.connections[0].id}`, {
    token: tokenAdmin,
    endpoint: "DELETE /api/v1/me/connections/{connectionId}",
  });
  await api("account-delete", "DELETE", "me", {
    token: friend,
    body: { confirmUsername: "contract_friend", password: FRIEND_PASSWORD },
    endpoint: "DELETE /api/v1/me",
  });
}

describe("native API recordings", () => {
  beforeAll(async () => {
    await cleanupDatabase();
    mocked.db = await getLocalDb();
    d1Binding = sqliteD1().binding;
    photoBucket = mockPhotoBucket();
    // Some rows get random UUIDs and some lists are ordered by id, so random UUIDs would shuffle those
    // lists between runs. Sequential UUIDs keep creation order and make every recording repeatable.
    let uuidCounter = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      uuidCounter += 1;
      return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`;
    });
    await recordNativeSession();
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("records every endpoint at most once and only endpoints the OpenAPI document declares", () => {
    const names = recordings.map((recording) => recording.name);
    expect(new Set(names).size).toBe(names.length);
    const document = buildApiV1OpenApiDocument() as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
    for (const recording of recordings) {
      const [method, endpointPath] = recording.endpoint.split(" ");
      if (!endpointPath.startsWith("/api/v1")) continue;
      const operation = document.paths[endpointPath]?.[method.toLowerCase()];
      expect(operation, `${recording.endpoint} is missing from the OpenAPI document`).toBeDefined();
      expect(Object.keys(operation!.responses), `${recording.endpoint} does not declare ${recording.status}`).toContain(String(recording.status));
    }
  });

  it("matches the committed recordings", () => {
    // The cook-session recordings come from test/workers/native-cook-session-recordings.test.ts, which
    // checks them itself; the index lists them after this test's own.
    const cookSessionEntries = committedCookSessionIndexEntries();
    const index = [...recordings.map(({ name, endpoint, status }) => ({ name, endpoint, status })), ...cookSessionEntries];
    if (WRITE_RECORDINGS) {
      fs.mkdirSync(RECORDINGS_DIRECTORY, { recursive: true });
      for (const file of fs.readdirSync(RECORDINGS_DIRECTORY)) {
        if (file.endsWith(".json") && !index.some((entry) => `${entry.name}.json` === file) && file !== "index.json") {
          fs.renameSync(path.join(RECORDINGS_DIRECTORY, file), path.join(RECORDINGS_DIRECTORY, `${file}.stale`));
        }
      }
      for (const recording of recordings) fs.writeFileSync(path.join(RECORDINGS_DIRECTORY, `${recording.name}.json`), serialize(recording));
      fs.writeFileSync(path.join(RECORDINGS_DIRECTORY, "index.json"), serialize(index));
      return;
    }
    expect(cookSessionEntries.length, "The cook-session recordings are missing. Run `pnpm run test:native-recordings:refresh`.").toBeGreaterThan(0);
    const committedIndex = JSON.parse(fs.readFileSync(path.join(RECORDINGS_DIRECTORY, "index.json"), "utf8"));
    expect(index, "The recorded endpoints changed. Run `pnpm run test:native-recordings:refresh`.").toEqual(committedIndex);
    for (const recording of recordings) {
      expect(recording, `${recording.name} changed. Run \`pnpm run test:native-recordings:refresh\` and copy the recordings to spoonjoy-apple.`)
        .toEqual(readCommittedRecording(recording.name));
    }
  });
});
