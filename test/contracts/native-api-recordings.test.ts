// Recorded responses for every endpoint the native app (spoonjoy/spoonjoy-apple) calls.
//
// This test drives one synthetic chef through the real route handlers, the way the native app does,
// with the request bodies the native app sends. It normalizes the values that change between runs
// (IDs, tokens, cursors and timestamps) and compares each response with its committed recording in
// test/fixtures/native-api-recordings. spoonjoy-apple keeps a copy of that directory and decodes
// every recording into its Swift models, so a change to a response shape fails here first.
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
import { getLocalDb } from "~/lib/db.server";
import * as recipeImport from "~/lib/recipe-import.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1 } from "../helpers/sqlite-d1";

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
const FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z";
const CHEF_PASSWORD = "contract-chef-password-not-secret";
const FRIEND_PASSWORD = "contract-friend-password-not-secret";
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Recording {
  name: string;
  endpoint: string;
  status: number;
  body: unknown;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const recordings: Recording[] = [];

// One placeholder per distinct dynamic value, numbered by first appearance across the whole run, so a
// recipe's ID is the same placeholder in its create response, its detail and the list it appears in.
const placeholders = new Map<string, string>();
const placeholderCounts = new Map<string, number>();

function placeholder(kind: string, value: string) {
  const key = `${kind}:${value}`;
  const existing = placeholders.get(key);
  if (existing) return existing;
  const next = (placeholderCounts.get(kind) ?? 0) + 1;
  placeholderCounts.set(kind, next);
  const created = `${kind}_${String(next).padStart(3, "0")}`;
  placeholders.set(key, created);
  return created;
}

const DYNAMIC_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "access_token", pattern: /\bsj_[A-Za-z0-9_-]{8,}/g },
  { kind: "refresh_token", pattern: /\bort_[A-Za-z0-9_-]{8,}/g },
  { kind: "uuid", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { kind: "id", pattern: /\bc[a-z0-9]{24}\b/g },
];
const TIMESTAMP_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
// Upload keys start with the upload time in milliseconds.
const EPOCH_MILLISECONDS_PATTERN = /\b1\d{12}\b/g;
const FIXED_EPOCH_MILLISECONDS = "1767225600000";
const OPAQUE_KEY_PATTERN = /(^id$|Id$|^cursor$|Cursor$|^token$|^client_id$|^access_token$|^refresh_token$)/;
const STABLE_VALUES = new Set(["spoonjoy-apple-native"]);

function normalizeString(value: string, key: string | null): string {
  let result = value.replace(TIMESTAMP_PATTERN, FIXED_TIMESTAMP).replace(EPOCH_MILLISECONDS_PATTERN, FIXED_EPOCH_MILLISECONDS);
  for (const { kind, pattern } of DYNAMIC_PATTERNS) {
    result = result.replace(pattern, (match) => placeholder(kind, match));
  }
  if (key && OPAQUE_KEY_PATTERN.test(key) && result === value && !STABLE_VALUES.has(value) && !/_\d{3}$/.test(value)) {
    const kind = /cursor/i.test(key) ? "cursor" : /token/i.test(key) ? "token" : "opaque";
    result = placeholder(kind, value);
  }
  return result;
}

export function normalizeRecordedValue(value: unknown, key: string | null = null): unknown {
  if (typeof value === "string") return normalizeString(value, key);
  if (Array.isArray(value)) return value.map((entry) => normalizeRecordedValue(entry, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entry]) => [entryKey, normalizeRecordedValue(entry, entryKey)]),
    );
  }
  return value;
}

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

function readCommittedRecording(name: string): Recording | null {
  const file = path.join(RECORDINGS_DIRECTORY, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as Recording : null;
}

function serialize(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
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

  // Recipe editor.
  const created = await api("recipe-create", "POST", "recipes", {
    token: chef,
    body: {
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
    },
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
  await api("recipe-update", "PATCH", `recipes/${recipeId}`, {
    token: chef,
    body: {
      clientMutationId: "cm_recipe_update",
      title: "Lemon Pantry Pasta",
      description: "Bright weeknight pasta from the pantry, ready in fifteen minutes.",
      servings: "4",
    },
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
  if (process.env.TMP_SKIP_PROFILES !== "1") {
  await api("user-profile", "GET", "users/contract_chef", { endpoint: "GET /api/v1/users/{identifier}" });
  await api("user-kitchen-visitors", "GET", "users/contract_chef/kitchen-visitors", {
    query: { page: "1", limit: "20" },
    endpoint: "GET /api/v1/users/{identifier}/kitchen-visitors",
  });
  await api("user-fellow-chefs", "GET", "users/contract_chef/fellow-chefs", {
    query: { page: "1", limit: "20" },
    endpoint: "GET /api/v1/users/{identifier}/fellow-chefs",
  });
  }
  await api("me-chefs", "GET", "me/chefs", { token: chef, endpoint: "GET /api/v1/me/chefs" });
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
    const index = recordings.map(({ name, endpoint, status }) => ({ name, endpoint, status }));
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
    const committedIndex = JSON.parse(fs.readFileSync(path.join(RECORDINGS_DIRECTORY, "index.json"), "utf8"));
    expect(index, "The recorded endpoints changed. Run `pnpm run test:native-recordings:refresh`.").toEqual(committedIndex);
    for (const recording of recordings) {
      expect(recording, `${recording.name} changed. Run \`pnpm run test:native-recordings:refresh\` and copy the recordings to spoonjoy-apple.`)
        .toEqual(readCommittedRecording(recording.name));
    }
  });
});
