import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppLoadContext } from "react-router";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  IMPORT_MESSAGES,
  IMPORT_TEXT_MAX_LENGTH,
  IMPORT_URL_MAX_LENGTH,
  importRecipeForSession,
  parseSessionImportForm,
  sessionImportRecipeId,
  type SessionImportArgs,
  type SessionImportInput,
} from "~/lib/recipe-import-session.server";
import { RecipeLlmError, type RecipeLlmRunner } from "~/lib/recipe-import-llm.server";
import type { ParsedIngredient } from "~/lib/ingredient-parse.server";
import { IMPORT_DAILY_CAP, startOfUtcDay } from "~/lib/image-gen-ledger.server";
import * as analytics from "~/lib/analytics-server";

const IMPORT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

function htmlResponse(body: string, url = "https://example.com/r"): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers([["content-type", "text/html"]]),
    body: stream,
  } as unknown as Response;
}

function ingredientParser() {
  return vi.fn(async (text: string): Promise<ParsedIngredient[]> =>
    text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => ({ quantity: 1, unit: "whole", ingredientName: line })));
}

function llm(payload: Partial<{ title: string; ingredients: string[]; steps: string[] }>): RecipeLlmRunner {
  return {
    extract: vi.fn(async () => ({
      title: payload.title ?? "",
      description: null,
      servings: null,
      ingredients: payload.ingredients ?? [],
      steps: payload.steps ?? [],
    })),
  };
}

function context(env: Record<string, unknown> | null = { OPENAI_API_KEY: "k" }): AppLoadContext {
  return { cloudflare: { env, ctx: undefined } } as unknown as AppLoadContext;
}

function request(ip?: string): Request {
  const headers = new Headers();
  if (ip) headers.set("CF-Connecting-IP", ip);
  return new Request("https://spoonjoy.app/recipes/new", { method: "POST", headers });
}

async function makeChef() {
  return createUser(
    db,
    `sess-import-${faker.string.alphanumeric(8).toLowerCase()}@example.com`,
    `sess_import_${faker.string.alphanumeric(8).toLowerCase()}`,
    "test-password-1234",
  );
}

describe("parseSessionImportForm", () => {
  it("accepts a link with an import id and normalises it", () => {
    expect(parseSessionImportForm(form({ importKind: "link", importId: IMPORT_ID, url: "  https://Example.com/pasta  " }))).toEqual({
      ok: true,
      input: { kind: "link", importId: IMPORT_ID, url: "https://example.com/pasta" },
    });
  });

  it("treats a missing kind as a link and gives a form sent before the page loaded its own id", () => {
    const parsed = parseSessionImportForm(form({ url: "http://example.com/a" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.kind).toBe("link");
    expect(parsed.input.importId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects an import id that is not a UUID", () => {
    expect(parseSessionImportForm(form({ importKind: "link", importId: "../x", url: "https://example.com" }))).toEqual({
      ok: false,
      kind: "link",
      message: IMPORT_MESSAGES.failed,
    });
  });

  it.each([
    ["", IMPORT_MESSAGES.linkMissing],
    ["   ", IMPORT_MESSAGES.linkMissing],
    ["not a url", IMPORT_MESSAGES.linkInvalid],
    ["ftp://example.com/r", IMPORT_MESSAGES.linkInvalid],
    ["javascript:alert(1)", IMPORT_MESSAGES.linkInvalid],
    [`https://example.com/${"a".repeat(IMPORT_URL_MAX_LENGTH)}`, IMPORT_MESSAGES.linkTooLong],
  ])("rejects the link %j", (url, message) => {
    expect(parseSessionImportForm(form({ importKind: "link", importId: IMPORT_ID, url }))).toEqual({ ok: false, kind: "link", message });
  });

  it("rejects a link field that is missing entirely", () => {
    expect(parseSessionImportForm(form({ importKind: "link", importId: IMPORT_ID }))).toEqual({
      ok: false,
      kind: "link",
      message: IMPORT_MESSAGES.linkMissing,
    });
  });

  it("accepts pasted text as it was typed", () => {
    expect(parseSessionImportForm(form({ importKind: "text", importId: IMPORT_ID, text: " Toast\nbread\nToast it " }))).toEqual({
      ok: true,
      input: { kind: "text", importId: IMPORT_ID, text: " Toast\nbread\nToast it " },
    });
  });

  it.each([
    [undefined, IMPORT_MESSAGES.textMissing],
    ["  \n ", IMPORT_MESSAGES.textMissing],
    ["x".repeat(IMPORT_TEXT_MAX_LENGTH + 1), IMPORT_MESSAGES.textTooLong],
  ])("rejects pasted text %#", (text, message) => {
    const fields: Record<string, string> = { importKind: "text", importId: IMPORT_ID };
    if (text !== undefined) fields.text = text;
    expect(parseSessionImportForm(form(fields))).toEqual({ ok: false, kind: "text", message });
  });
});

describe("importRecipeForSession", () => {
  let chefId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    chefId = (await makeChef()).id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  function args(input: Omit<SessionImportInput, "importId"> & { importId?: string }, overrides: Partial<SessionImportArgs> = {}): SessionImportArgs {
    return {
      db,
      userId: chefId,
      input: { importId: IMPORT_ID, ...input },
      request: request(),
      context: context(),
      ...overrides,
    };
  }

  it("imports a recipe page through the shared pipeline, under the form's id, and spends one import", async () => {
    const fixture = await readFile(path.resolve(process.cwd(), "test/fixtures/recipe-import/nyt-style-jsonld.html"), "utf-8");
    const fetchImpl = vi.fn(async () => htmlResponse(fixture)) as unknown as typeof fetch;

    const outcome = await importRecipeForSession(args(
      { kind: "link", url: "https://example.com/r" },
      { pipeline: { fetchImpl, ingredientParser: ingredientParser() } },
    ));

    expect(outcome).toEqual({ ok: true, recipeId: sessionImportRecipeId(IMPORT_ID) });
    const recipe = await db.recipe.findUniqueOrThrow({
      where: { id: sessionImportRecipeId(IMPORT_ID) },
      include: { steps: { include: { ingredients: true } } },
    });
    expect(recipe.chefId).toBe(chefId);
    expect(recipe.sourceUrl).toBe("https://example.com/r");
    expect(recipe.steps.length).toBeGreaterThan(0);
    expect(recipe.steps.flatMap((step) => step.ingredients).length).toBeGreaterThan(0);
    const ledger = await db.imageGenLedger.findFirstOrThrow({ where: { userId: chefId, kind: "import" } });
    expect(ledger.count).toBe(1);
  });

  it("imports pasted text with the model", async () => {
    const runner = llm({ title: "Buttered Toast", ingredients: ["1 slice bread"], steps: ["Toast the bread."] });
    const outcome = await importRecipeForSession(args(
      { kind: "text", text: "Buttered toast. 1 slice bread. Toast the bread." },
      { pipeline: { llmRunner: runner, ingredientParser: ingredientParser() } },
    ));
    expect(outcome).toEqual({ ok: true, recipeId: sessionImportRecipeId(IMPORT_ID) });
    expect(runner.extract).toHaveBeenCalledWith("Buttered toast. 1 slice bread. Toast the bread.");
    const recipe = await db.recipe.findUniqueOrThrow({ where: { id: sessionImportRecipeId(IMPORT_ID) } });
    expect(recipe.title).toBe("Buttered Toast");
    expect(recipe.sourceUrl).toBeNull();
  });

  it("opens the recipe a first submit of the same form wrote, without importing again", async () => {
    await db.recipe.create({ data: { id: sessionImportRecipeId(IMPORT_ID), title: "Already here", chefId } });
    const runner = llm({ title: "Second" });
    const outcome = await importRecipeForSession(args({ kind: "text", text: "x" }, { pipeline: { llmRunner: runner } }));
    expect(outcome).toEqual({ ok: true, recipeId: sessionImportRecipeId(IMPORT_ID) });
    expect(runner.extract).not.toHaveBeenCalled();
    expect(await db.imageGenLedger.count()).toBe(0);
  });

  it("does not open another chef's recipe that happens to carry the id", async () => {
    const other = await makeChef();
    await db.recipe.create({ data: { id: sessionImportRecipeId(IMPORT_ID), title: "Theirs", chefId: other.id } });
    const outcome = await importRecipeForSession(args({ kind: "text", text: "x" }, { context: context({}) }));
    expect(outcome).toEqual({ ok: false, kind: "text", message: IMPORT_MESSAGES.unavailable });
  });

  it("points at the recipe the cook already imported from the same link, without spending an import", async () => {
    const existing = await db.recipe.create({ data: { title: "Grandma's Pasta", chefId, sourceUrl: "https://example.com/r" } });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await importRecipeForSession(args({ kind: "link", url: "https://example.com/r" }, { pipeline: { fetchImpl } }));
    expect(outcome).toEqual({
      ok: false,
      kind: "link",
      message: "You already brought this one in as “Grandma's Pasta”.",
      existingRecipe: { id: existing.id, title: "Grandma's Pasta" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores a deleted earlier import of the same link", async () => {
    await db.recipe.create({ data: { title: "Old", chefId, sourceUrl: "https://example.com/r", deletedAt: new Date() } });
    const outcome = await importRecipeForSession(args({ kind: "link", url: "https://example.com/r" }, { context: context({ OPENAI_API_KEY: " " }) }));
    expect(outcome).toEqual({ ok: false, kind: "link", message: IMPORT_MESSAGES.unavailable });
  });

  it("says import is not switched on when the server has no model key, like the API does", async () => {
    expect(await importRecipeForSession(args({ kind: "link", url: "https://example.com/r" }, { context: context(null) }))).toEqual({
      ok: false,
      kind: "link",
      message: IMPORT_MESSAGES.unavailable,
    });
    expect(await importRecipeForSession(args({ kind: "link", url: "https://example.com/r" }, { context: {} as AppLoadContext }))).toEqual({
      ok: false,
      kind: "link",
      message: IMPORT_MESSAGES.unavailable,
    });
  });

  it("applies the API's per-IP limiter", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const outcome = await importRecipeForSession(args(
      { kind: "text", text: "x" },
      { request: request("203.0.113.9"), context: context({ OPENAI_API_KEY: "k", API_IP_RATE_LIMITER: { limit } }) },
    ));
    expect(outcome).toEqual({ ok: false, kind: "text", message: IMPORT_MESSAGES.busy });
    expect(limit).toHaveBeenCalledWith({ key: "ip:203.0.113.9" });
  });

  it("stops at the daily import quota", async () => {
    await db.imageGenLedger.create({
      data: { userId: chefId, kind: "import", bucketStart: startOfUtcDay(new Date()), count: IMPORT_DAILY_CAP },
    });
    const runner = llm({ title: "Toast" });
    const outcome = await importRecipeForSession(args({ kind: "text", text: "toast" }, { pipeline: { llmRunner: runner } }));
    expect(outcome).toEqual({
      ok: false,
      kind: "text",
      message: `You've brought in ${IMPORT_DAILY_CAP} recipes today, the daily limit. You can import more tomorrow, or write this one below.`,
    });
    expect(runner.extract).not.toHaveBeenCalled();
  });

  it("refuses private addresses through the pipeline's fetch guard", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await importRecipeForSession(args({ kind: "link", url: "http://127.0.0.1/admin" }, { pipeline: { fetchImpl } }));
    expect(outcome).toEqual({
      ok: false,
      kind: "link",
      message: "Spoonjoy can only read public web pages. Check the link, or paste the recipe instead.",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("explains a text with no recipe in it", async () => {
    const outcome = await importRecipeForSession(args({ kind: "text", text: "hello" }, { pipeline: { llmRunner: llm({ title: " " }) } }));
    expect(outcome).toEqual({
      ok: false,
      kind: "text",
      message: "We couldn't find a recipe in that text. Include the ingredients and the steps.",
    });
  });

  it("explains a page with no recipe on it", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse("<html><body>No food here</body></html>")) as unknown as typeof fetch;
    const outcome = await importRecipeForSession(args(
      { kind: "link", url: "https://example.com/blog" },
      { pipeline: { fetchImpl, llmRunner: llm({ title: "" }) } },
    ));
    expect(outcome).toEqual({ ok: false, kind: "link", message: "We couldn't find a recipe there. Paste the recipe text instead." });
  });

  it("explains a model outage", async () => {
    const runner: RecipeLlmRunner = { extract: vi.fn(async () => { throw new RecipeLlmError("boom"); }) };
    const outcome = await importRecipeForSession(args({ kind: "text", text: "toast" }, { pipeline: { llmRunner: runner } }));
    expect(outcome).toEqual({
      ok: false,
      kind: "text",
      message: "Recipe reading isn't working right now. Try again in a few minutes, or write the recipe below.",
    });
  });

  it("opens the recipe when the write throws after it landed", async () => {
    const parser = vi.fn(async () => {
      await db.recipe.create({ data: { id: sessionImportRecipeId(IMPORT_ID), title: "Raced", chefId } });
      throw new Error("write reported late");
    });
    const outcome = await importRecipeForSession(args(
      { kind: "text", text: "toast" },
      { pipeline: { llmRunner: llm({ title: "Toast", ingredients: ["bread"], steps: ["Toast."] }), ingredientParser: parser } },
    ));
    expect(outcome).toEqual({ ok: true, recipeId: sessionImportRecipeId(IMPORT_ID) });
  });

  it("captures an unexpected failure and answers in plain words", async () => {
    const capture = vi.spyOn(analytics, "captureException").mockRejectedValue(new Error("posthog down"));
    const parser = vi.fn(async () => { throw new Error("parser exploded"); });
    const outcome = await importRecipeForSession(args(
      { kind: "text", text: "toast" },
      {
        context: context({ OPENAI_API_KEY: "k", POSTHOG_API_KEY: "phc_test" }),
        pipeline: { llmRunner: llm({ title: "Toast", ingredients: ["bread"], steps: ["Toast."] }), ingredientParser: parser },
      },
    ));
    expect(outcome).toEqual({ ok: false, kind: "text", message: IMPORT_MESSAGES.failed });
    expect(capture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ distinctId: chefId, extras: { feature: "recipe_import_web", importKind: "text" } }),
    );
  });

  it("answers a failure plainly when the landed-check itself fails", async () => {
    const realFindFirst = db.recipe.findFirst.bind(db.recipe);
    let ownLookups = 0;
    vi.spyOn(db.recipe, "findFirst").mockImplementation(((query: { where?: { id?: string } }) => {
      if (query?.where?.id === sessionImportRecipeId(IMPORT_ID) && ++ownLookups === 2) {
        return Promise.reject(new Error("d1 unavailable"));
      }
      return realFindFirst(query as never);
    }) as never);
    const parser = vi.fn(async () => { throw new Error("parser exploded"); });
    const outcome = await importRecipeForSession(args(
      { kind: "text", text: "toast" },
      { pipeline: { llmRunner: llm({ title: "Toast", ingredients: ["bread"], steps: ["Toast."] }), ingredientParser: parser } },
    ));
    expect(outcome).toEqual({ ok: false, kind: "text", message: IMPORT_MESSAGES.failed });
  });

  it("passes the platform's waitUntil to the pipeline", async () => {
    const waitUntil = vi.fn();
    const ctx = { cloudflare: { env: { OPENAI_API_KEY: "k" }, ctx: { waitUntil } } } as unknown as AppLoadContext;
    const outcome = await importRecipeForSession(args(
      { kind: "text", text: "toast" },
      { context: ctx, pipeline: { llmRunner: llm({ title: "Toast", steps: ["Toast."] }), ingredientParser: ingredientParser() } },
    ));
    expect(outcome.ok).toBe(true);
  });
});
