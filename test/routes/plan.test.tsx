import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureException: vi.fn(() => Promise.resolve()),
}));

import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createTestRoutesStub, createTestRecipe, createTestUser } from "../utils";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { D1WriteUnavailableError, D1_WRITE_UNAVAILABLE_MESSAGE } from "~/lib/d1-write-retry.server";
import { OBJECTIONABLE_CONTENT_MESSAGE } from "~/lib/objectionable-terms";
import PlanPage, { action, loader, meta } from "~/routes/plan";
import { errorsFor } from "~/domains/planning";
import { cleanupDatabase } from "../helpers/cleanup";
import { captureException } from "~/lib/analytics-server";

const FLAGS_ON = { SPOONJOY_FLAGS: "meal-planner" };
let chefId: string;
let cookie: string;

function context(env: Record<string, string> | null = FLAGS_ON) {
  return { cloudflare: { env } } as never;
}

async function signIn(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function get(path: string, withCookie = true) {
  return new UndiciRequest(`http://localhost:3000${path}`, { headers: withCookie ? { Cookie: cookie } : {} }) as unknown as Request;
}

function post(fields: Record<string, string>) {
  const form = new UndiciFormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new UndiciRequest("http://localhost:3000/plan", { method: "POST", headers: { Cookie: cookie }, body: form }) as unknown as Request;
}

async function load(path = "/plan?week=2026-11-25", env?: Record<string, string> | null) {
  return loader({ request: get(path), context: context(env), params: {} } as never);
}

async function act(fields: Record<string, string>) {
  return action({ request: post(fields), context: context(), params: {} } as never) as Promise<{ data?: unknown; init?: ResponseInit | null } | Response>;
}

function answer(result: unknown): { data: unknown; status: number } {
  const value = result as { type?: string; data?: unknown; init?: { status?: number } | null };
  return value?.type === "DataWithResponseInit" ? { data: value.data, status: value.init?.status ?? 200 } : { data: value, status: 200 };
}

describe("meal plan route", () => {
  beforeEach(async () => {
    // A fixed clock, outside the week of Nov 23 most tests plan, so "today" never lands in it by chance.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-16T12:00:00Z"));
    await cleanupDatabase();
    const chef = await db.user.create({ data: createTestUser() });
    chefId = chef.id;
    cookie = await signIn(chefId);
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    await cleanupDatabase();
  });

  it("names the page", () => {
    expect(meta({} as never)).toEqual([
      { title: "Meal plan - Spoonjoy" },
      { name: "description", content: "Plan the week's meals: recipes and notes, day by day." },
    ]);
  });

  describe("loader", () => {
    it("sends a signed-out visitor to sign in", async () => {
      await expect(loader({ request: get("/plan", false), context: context(), params: {} } as never)).rejects.toSatisfy((error: Response) => {
        expect(error.status).toBe(302);
        expect(error.headers.get("Location")).toContain("/login");
        return true;
      });
    });

    it("is not found while the meal-planner flag is off, as in production", async () => {
      await expect(load("/plan", null)).rejects.toSatisfy((error: Response) => error.status === 404);
    });

    it("loads the asked week and the cook's own live recipes to plan, by title", async () => {
      const other = await db.user.create({ data: createTestUser() });
      await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Zucchini bread" } });
      await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Apple pie" } });
      await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Gone soup", deletedAt: new Date() } });
      await db.recipe.create({ data: { ...createTestRecipe(other.id), title: "Not mine" } });

      const result = await load();
      expect(result.week.start).toBe("2026-11-23");
      expect(result.week.days).toHaveLength(7);
      expect(result.recipes.map((recipe) => recipe.title)).toEqual(["Apple pie", "Zucchini bread"]);
    });

    it("offers another chef's recipe the page was opened to plan, first and chosen", async () => {
      const other = await db.user.create({ data: createTestUser() });
      await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Apple pie" } });
      const salmon = await db.recipe.create({ data: { ...createTestRecipe(other.id), title: "Miso Glazed Salmon" } });
      const gone = await db.recipe.create({ data: { ...createTestRecipe(other.id), title: "Gone", deletedAt: new Date() } });

      const result = await load(`/plan?week=2026-11-25&recipe=${salmon.id}`);
      expect(result.recipes.map((recipe) => recipe.title)).toEqual(["Miso Glazed Salmon", "Apple pie"]);
      expect(result.chosenRecipeId).toBe(salmon.id);
      expect((await load(`/plan?recipe=${gone.id}`)).chosenRecipeId).toBeNull();
      expect((await load("/plan")).chosenRecipeId).toBeNull();
    });

    it("offers recipes the cook saved to a cookbook, and never shows another cook's private recipe asked for by link", async () => {
      const other = await db.user.create({ data: createTestUser() });
      await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Apple pie" } });
      const saved = await db.recipe.create({ data: { ...createTestRecipe(other.id), title: "Borscht", visibility: "public" } });
      const hidden = await db.recipe.create({ data: { ...createTestRecipe(other.id), title: "Secret Stew", visibility: "private" } });
      const book = await db.cookbook.create({ data: { title: "Soups", authorId: chefId } });
      await db.recipeInCookbook.create({ data: { cookbookId: book.id, recipeId: saved.id, addedById: chefId } });

      const result = await load(`/plan?recipe=${hidden.id}`);
      expect(result.recipes.map((recipe) => recipe.title)).toEqual(["Apple pie", "Borscht"]);
      expect(result.chosenRecipeId).toBeNull();
    });

    it("doesn't list a recipe twice when the cook opens the page to plan their own", async () => {
      const pie = await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Apple pie" } });
      const result = await load(`/plan?recipe=${pie.id}`);
      expect(result.recipes.map((recipe) => recipe.title)).toEqual(["Apple pie"]);
      expect(result.chosenRecipeId).toBe(pie.id);
    });

    it("opens on this week when the week asked for is not a day", async () => {
      const result = await load("/plan?week=soon");
      expect(result.week).toMatchObject({ today: "2026-12-16", start: "2026-12-14" });
    });
  });

  describe("action", () => {
    it("plans a recipe at a scale and sends the cook to the week it landed in", async () => {
      const recipe = await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Lemon Herb Rice" } });
      const result = await act({ intent: "add-recipe", entryToken: "token-recipe-1", date: "2026-11-24", mealType: "dinner", recipeId: recipe.id, scaleFactor: "2" });
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).headers.get("Location")).toBe("/plan?week=2026-11-24");
      const [entry] = await db.planEntry.findMany();
      expect(entry).toMatchObject({ kind: "recipe", recipeId: recipe.id, recipeTitle: "Lemon Herb Rice", scaleFactor: 2, date: "2026-11-24", mealType: "dinner" });
    });

    it("adds a note once when the same form is sent twice", async () => {
      const fields = { intent: "add-note", entryToken: "token-note-1", date: "2026-11-26", mealType: "lunch", title: "Eat out", note: "Tacos" };
      await act(fields);
      await act(fields);
      expect(await db.planEntry.findMany({ select: { kind: true, title: true, note: true } })).toEqual([{ kind: "note", title: "Eat out", note: "Tacos" }]);
    });

    it("adds a note without a token too", async () => {
      await act({ intent: "add-note", date: "2026-11-26", mealType: "lunch", title: "Leftovers" });
      expect(await db.planEntry.count()).toBe(1);
    });

    it("answers a refused entry with its reason, on the form it came from", async () => {
      expect(answer(await act({ intent: "add-note", date: "2026-11-26", mealType: "lunch", title: " " }))).toEqual({
        status: 400,
        data: { intent: "add-note", errors: { general: "Give the note a title." } },
      });
      expect(answer(await act({ intent: "add-recipe", date: "2026-11-26", mealType: "lunch", recipeId: "missing", scaleFactor: "x" }))).toEqual({
        status: 400,
        data: { intent: "add-recipe", errors: { general: "Servings must be more than none and at most 50 times the recipe." } },
      });
      expect(answer(await act({ intent: "add-note", date: "2026-11-26", mealType: "lunch", title: "porn night" }))).toEqual({
        status: 400,
        data: { intent: "add-note", errors: { general: OBJECTIONABLE_CONTENT_MESSAGE } },
      });
    });

    it("removes an entry from the cook's plan", async () => {
      await act({ intent: "add-note", entryToken: "token-note-2", date: "2026-11-26", mealType: "lunch", title: "Eat out" });
      const [entry] = await db.planEntry.findMany();
      const result = await act({ intent: "remove", entryId: entry.id });
      expect(answer(result)).toEqual({ status: 200, data: { intent: "remove", removed: true } });
      expect((await load("/plan?week=2026-11-26")).week.days[3].entries).toEqual([]);
    });

    it("removes nothing when no entry is named", async () => {
      expect(answer(await act({ intent: "remove" }))).toEqual({ status: 200, data: { intent: "remove", removed: false } });
    });

    it("refuses an intent it doesn't know", async () => {
      expect(answer(await act({ intent: "explode" }))).toEqual({ status: 400, data: { intent: "explode", errors: { general: "That isn't something the plan can do." } } });
      expect(answer(await act({}))).toEqual({ status: 400, data: { errors: { general: "That isn't something the plan can do." } } });
    });

    it("is not found while the flag is off", async () => {
      await expect(action({ request: post({ intent: "remove", entryId: "x" }), context: context(null), params: {} } as never)).rejects.toSatisfy((error: Response) => error.status === 404);
    });

    it("keeps the form as it was and says so when the database is busy", async () => {
      vi.spyOn(db.planEntry, "create").mockRejectedValueOnce(new D1WriteUnavailableError("plan_entry.add", new Error("busy")));
      const result = answer(await act({ intent: "add-note", entryToken: "token-note-3", date: "2026-11-26", mealType: "lunch", title: "Eat out" }));
      expect(result.status).toBe(503);
      expect(result.data).toMatchObject({ intent: "add-note", error: D1_WRITE_UNAVAILABLE_MESSAGE, retryable: true });
    });

    it("lets any other failure through", async () => {
      vi.spyOn(db.planEntry, "updateMany").mockRejectedValueOnce(new Error("boom"));
      await expect(act({ intent: "remove", entryId: "x" })).rejects.toThrow("boom");
    });

    it("reports an unexpected failure with the plan action that hit it", async () => {
      const waitUntil = vi.fn();
      const failure = new Error("boom");
      vi.spyOn(db.planEntry, "updateMany").mockRejectedValueOnce(failure);
      const withTelemetry = { cloudflare: { env: { ...FLAGS_ON, POSTHOG_KEY: "phc_test" }, ctx: { waitUntil } } } as never;
      await expect(action({ request: post({ intent: "remove", entryId: "x" }), context: withTelemetry, params: {} } as never)).rejects.toBe(failure);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true }),
        expect.objectContaining({ error: failure, distinctId: chefId, route: "/plan", method: "POST", extras: { action: "plan_remove" } }),
      );
      expect(waitUntil).toHaveBeenCalledTimes(1);
    });
  });

  describe("page", () => {
    async function renderPage(actionData?: unknown) {
      const data = await load();
      const Stub = createTestRoutesStub([{ path: "/plan", Component: PlanPage, loader: () => data, action: () => actionData ?? null }]);
      render(<Stub initialEntries={["/plan"]} />);
      await screen.findByRole("heading", { level: 1 });
      return data;
    }

    it("shows each day of the week with its meals, recipes linking to themselves", async () => {
      const recipe = await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Lemon Herb Rice" } });
      await act({ intent: "add-recipe", entryToken: "token-recipe-2", date: "2026-11-24", mealType: "dinner", recipeId: recipe.id, scaleFactor: "2" });
      await act({ intent: "add-note", entryToken: "token-note-4", date: "2026-11-24", mealType: "lunch", title: "Eat out", note: "Tacos" });
      await act({ intent: "add-note", entryToken: "token-note-5", date: "2026-11-25", mealType: "snack", title: "Fruit" });
      await renderPage();

      expect(screen.getByRole("heading", { level: 1, name: "Week of Nov 23" })).toBeTruthy();
      const tuesday = screen.getByRole("region", { name: "Tuesday, Nov 24" });
      expect(within(tuesday).getByRole("link", { name: /Lemon Herb Rice/ }).getAttribute("href")).toBe(`/recipes/${recipe.id}`);
      expect(within(tuesday).getByText("Dinner · 2× the recipe")).toBeTruthy();
      expect(within(tuesday).getByText("Eat out")).toBeTruthy();
      expect(within(tuesday).getByText("Lunch · Tacos")).toBeTruthy();
      expect(within(tuesday).getByRole("button", { name: "Remove Eat out from Tuesday" })).toBeTruthy();
      expect(within(screen.getByRole("region", { name: "Wednesday, Nov 25" })).getByText("Snack")).toBeTruthy();
      expect(within(screen.getByRole("region", { name: "Monday, Nov 23" })).getByText("Nothing planned yet.")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Previous week" }).getAttribute("href")).toBe("/plan?week=2026-11-16");
      expect(screen.getByRole("link", { name: "Next week" }).getAttribute("href")).toBe("/plan?week=2026-11-30");
      expect(screen.getByRole("link", { name: "This week" }).getAttribute("href")).toBe("/plan");
    });

    it("keeps a deleted recipe's meal readable without a link", async () => {
      const recipe = await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Gone Soup" } });
      await act({ intent: "add-recipe", entryToken: "token-recipe-3", date: "2026-11-24", mealType: "dinner", recipeId: recipe.id, scaleFactor: "1" });
      await db.recipe.delete({ where: { id: recipe.id } });
      await renderPage();
      const tuesday = screen.getByRole("region", { name: "Tuesday, Nov 24" });
      expect(within(tuesday).getByText("Gone Soup")).toBeTruthy();
      expect(within(tuesday).queryByRole("link", { name: /Gone Soup/ })).toBeNull();
      expect(within(tuesday).getByText("Dinner")).toBeTruthy();
    });

    it("offers the cook's recipes to plan, or a way to write one when there are none", async () => {
      await renderPage();
      expect(screen.getByRole("link", { name: "Write a recipe" }).getAttribute("href")).toBe("/recipes/new");
      expect(screen.queryByRole("combobox", { name: "Recipe" })).toBeNull();
      cleanup();

      await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Lemon Herb Rice" } });
      await renderPage();
      expect(within(screen.getByRole("combobox", { name: "Recipe" })).getByRole("option", { name: "Lemon Herb Rice" })).toBeTruthy();
      expect(screen.getAllByRole("combobox", { name: "Day" })[0]).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add to plan" })).toBeTruthy();
      cleanup();

      const other = await db.user.create({ data: createTestUser() });
      const salmon = await db.recipe.create({ data: { ...createTestRecipe(other.id), title: "Miso Glazed Salmon" } });
      const chosen = await load(`/plan?week=2026-11-25&recipe=${salmon.id}`);
      const Stub = createTestRoutesStub([{ path: "/plan", Component: PlanPage, loader: () => chosen }]);
      render(<Stub initialEntries={["/plan"]} />);
      expect(((await screen.findByRole("combobox", { name: "Recipe" })) as HTMLSelectElement).value).toBe(salmon.id);
      expect(screen.getByRole("button", { name: "Add note" })).toBeTruthy();
    });

    it("shows a moved-in recipe meal that came without its title by its own title", async () => {
      const plan = await db.mealPlan.upsert({ where: { ownerId: chefId }, create: { ownerId: chefId }, update: {} });
      await db.planEntry.create({ data: { mealPlanId: plan.id, date: "2026-11-24", mealType: "dinner", kind: "recipe", title: "Grandma's stew" } });
      await renderPage();
      expect(within(screen.getByRole("region", { name: "Tuesday, Nov 24" })).getByText("Grandma's stew")).toBeTruthy();
    });

    it("puts an answer's errors on the form that sent it, a busy database's message included", () => {
      expect(errorsFor(undefined, "add-note")).toBeUndefined();
      expect(errorsFor({ intent: "add-recipe", errors: { general: "Choose a recipe." } }, "add-note")).toBeUndefined();
      expect(errorsFor({ intent: "add-note", errors: { general: "Give the note a title." } }, "add-note")).toEqual({ general: "Give the note a title." });
      expect(errorsFor({ intent: "add-note", error: D1_WRITE_UNAVAILABLE_MESSAGE }, "add-note")).toEqual({ general: D1_WRITE_UNAVAILABLE_MESSAGE });
    });

    it("marks today when it falls in the week shown", async () => {
      const data = await load("/plan");
      const Stub = createTestRoutesStub([{ path: "/plan", Component: PlanPage, loader: () => data }]);
      render(<Stub initialEntries={["/plan"]} />);
      expect(await screen.findByText("Today")).toBeTruthy();
    });
  });
});
