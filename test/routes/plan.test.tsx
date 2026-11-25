import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureException: vi.fn(() => Promise.resolve()),
}));

import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub, createTestRecipe, createTestUser } from "../utils";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { D1WriteUnavailableError, D1_WRITE_UNAVAILABLE_MESSAGE } from "~/lib/d1-write-retry.server";
import { OBJECTIONABLE_CONTENT_MESSAGE } from "~/lib/objectionable-terms";
import PlanPage, { WeekListAnswer, action, loader, meta } from "~/routes/plan";
import { errorsFor } from "~/domains/planning";
import { cleanupDatabase } from "../helpers/cleanup";
import { captureException } from "~/lib/analytics-server";

const ENV: Record<string, string> = {};
let chefId: string;
let cookie: string;

function context(env: Record<string, string> | null = ENV) {
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

    it("opens for a signed-in cook with no flag set", async () => {
      await expect(load("/plan", null)).resolves.toMatchObject({ week: { days: expect.any(Array) } });
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

  describe("adding the week to the shopping list", () => {
    async function recipeWith(title: string, ingredients: Array<[number, string, string]>) {
      return db.recipe.create({
        data: {
          ...createTestRecipe(chefId),
          title,
          steps: {
            create: [{
              stepNum: 1,
              description: "Cook it",
              ingredients: {
                create: ingredients.map(([quantity, unit, name]) => ({
                  quantity,
                  unit: { connectOrCreate: { where: { name: unit }, create: { name: unit } } },
                  ingredientRef: { connectOrCreate: { where: { name }, create: { name } } },
                })),
              },
            }],
          },
        },
      });
    }

    async function listItems() {
      const items = await db.shoppingListItem.findMany({ where: { deletedAt: null }, include: { ingredientRef: true, unit: true } });
      return items.map((item) => ({ name: item.ingredientRef.name, quantity: item.quantity, unit: item.unit?.name ?? null })).sort((a, b) => a.name.localeCompare(b.name));
    }

    it("puts the week's recipes on the list at their planned servings, merging the same ingredient", async () => {
      const rice = await recipeWith("Lemon Herb Rice", [[200, "g", "rice"], [1, "whole", "lemon"]]);
      const salmon = await recipeWith("Miso Salmon", [[2, "whole", "lemon"], [300, "g", "salmon"]]);
      await act({ intent: "add-recipe", entryToken: "t-1", date: "2026-11-23", mealType: "dinner", recipeId: rice.id, scaleFactor: "2" });
      await act({ intent: "add-recipe", entryToken: "t-2", date: "2026-11-25", mealType: "lunch", recipeId: rice.id, scaleFactor: "1" });
      await act({ intent: "add-recipe", entryToken: "t-3", date: "2026-11-26", mealType: "dinner", recipeId: salmon.id, scaleFactor: "1" });
      await act({ intent: "add-recipe", entryToken: "t-4", date: "2026-11-30", mealType: "dinner", recipeId: salmon.id, scaleFactor: "1" });

      const result = answer(await act({ intent: "add-week-to-list", week: "2026-11-23", listToken: "list-1" }));

      expect(result.data).toEqual({ intent: "add-week-to-list", added: { recipes: 2, missing: 0 } });
      expect(await listItems()).toEqual([
        { name: "lemon", quantity: 5, unit: "whole" },
        { name: "rice", quantity: 600, unit: "g" },
        { name: "salmon", quantity: 300, unit: "g" },
      ]);
    });

    it("adds nothing when the week has no recipes, and refuses a week that isn't a day", async () => {
      expect(answer(await act({ intent: "add-week-to-list", week: "2026-11-23", listToken: "list-2" })).data).toEqual({ intent: "add-week-to-list", added: { recipes: 0, missing: 0 } });
      expect(await listItems()).toEqual([]);
      const refused = answer(await act({ intent: "add-week-to-list", week: "soon", listToken: "list-3" }));
      expect(refused).toMatchObject({ status: 400, data: { intent: "add-week-to-list", errors: { general: "Choose a week to shop for." } } });
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
      const withTelemetry = { cloudflare: { env: { ...ENV, POSTHOG_KEY: "phc_test" }, ctx: { waitUntil } } } as never;
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
      expect(within(tuesday).getByRole("link", { name: /Lemon Herb Rice/ }).getAttribute("href")).toBe(`/recipes/${recipe.id}?scale=2`);
      expect(within(tuesday).getByText("Dinner · 2× the recipe")).toBeTruthy();
      expect(within(tuesday).getByText("Eat out")).toBeTruthy();
      expect(within(tuesday).getByText("Lunch · Tacos")).toBeTruthy();
      expect(within(tuesday).getByRole("button", { name: "Remove Eat out from Tuesday" })).toBeTruthy();
      expect(within(screen.getByRole("region", { name: "Wednesday, Nov 25" })).getByText("Snack")).toBeTruthy();
      expect(within(tuesday).queryByRole("button", { name: "Plan a meal for Tuesday" })).toBeNull();
      expect(screen.getByRole("link", { name: "Previous week" }).getAttribute("href")).toBe("/plan?week=2026-11-16");
      expect(screen.getByRole("link", { name: "Next week" }).getAttribute("href")).toBe("/plan?week=2026-11-30");
      expect(screen.getByRole("link", { name: "This week" }).getAttribute("href")).toBe("/plan");
    });

    it("says when the cook last made a planned recipe, with the year when it wasn't this one", async () => {
      const rice = await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Lemon Rice" } });
      const stew = await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Old Stew" } });
      await db.recipeSpoon.createMany({
        data: [
          { chefId, recipeId: rice.id, cookedAt: new Date("2026-11-02T18:00:00Z") },
          { chefId, recipeId: stew.id, cookedAt: new Date("2025-06-09T18:00:00Z") },
        ],
      });
      await act({ intent: "add-recipe", entryToken: "token-last-1", date: "2026-11-24", mealType: "dinner", recipeId: rice.id, scaleFactor: "1" });
      await act({ intent: "add-recipe", entryToken: "token-last-2", date: "2026-11-25", mealType: "lunch", recipeId: stew.id, scaleFactor: "2" });
      await renderPage();
      expect(within(screen.getByRole("region", { name: "Tuesday, Nov 24" })).getByText("Dinner · Last made Nov 2")).toBeTruthy();
      expect(within(screen.getByRole("region", { name: "Wednesday, Nov 25" })).getByText("Lunch · 2× the recipe · Last made Jun 9, 2025")).toBeTruthy();
    });

    it("links a meal planned at another scale to the recipe at those servings", async () => {
      const rice = await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Scaled Rice" } });
      await act({ intent: "add-recipe", entryToken: "token-scale-1", date: "2026-11-24", mealType: "dinner", recipeId: rice.id, scaleFactor: "1.5" });
      await act({ intent: "add-recipe", entryToken: "token-scale-2", date: "2026-11-25", mealType: "dinner", recipeId: rice.id, scaleFactor: "1" });
      await renderPage();
      expect(within(screen.getByRole("region", { name: "Tuesday, Nov 24" })).getByRole("link", { name: /Scaled Rice/ })).toHaveAttribute("href", `/recipes/${rice.id}?scale=1.5`);
      expect(within(screen.getByRole("region", { name: "Wednesday, Nov 25" })).getByRole("link", { name: /Scaled Rice/ })).toHaveAttribute("href", `/recipes/${rice.id}`);
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

    /** The page on a stub whose loader and action are the route's own, so an add lands and the week reloads. */
    function renderLive(path = "/plan?week=2026-11-25") {
      const Stub = createTestRoutesStub([{
        path: "/plan",
        Component: PlanPage,
        loader: () => load(path),
        action: async ({ request }: { request: Request }) => {
          const fields = Object.fromEntries(await request.formData()) as Record<string, string>;
          const result = await act(fields);
          // The route redirects to the week it added to; the stub stays on this week.
          return result instanceof Response ? null : result;
        },
      }]);
      render(<Stub initialEntries={["/plan"]} />);
      // A sheet open from the start hides the page from the accessibility tree.
      return screen.findByRole("heading", { level: 1, hidden: true });
    }

    it("gives a day with meals an Add that opens the recipe-or-note sheet with that day chosen, and an empty day only its own button", async () => {
      const user = userEvent.setup();
      await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Lemon Herb Rice" } });
      await act({ intent: "add-note", entryToken: "token-note-add-1", date: "2026-11-24", mealType: "dinner", title: "Leftovers" });
      await renderLive();

      // One control for one action: an empty day is planned from its own button, with no Add in its header.
      const monday = screen.getByRole("region", { name: "Monday, Nov 23" });
      expect(within(monday).queryByRole("button", { name: "Add to Monday" })).toBeNull();
      expect(within(monday).getByRole("button", { name: "Plan a meal for Monday" })).toBeTruthy();
      const tuesday = screen.getByRole("region", { name: "Tuesday, Nov 24" });
      await user.click(within(tuesday).getByRole("button", { name: "Add to Tuesday" }));
      const sheet = await screen.findByRole("dialog", { name: "Add to Tuesday, Nov 24" });
      expect((within(sheet).getByRole("combobox", { name: "Recipe" }) as HTMLSelectElement).value).toBeTruthy();
      expect(within(sheet).queryByRole("combobox", { name: "Day" })).toBeNull();
      expect(within(sheet).queryByRole("textbox", { name: "Title" })).toBeNull();

      await user.click(within(sheet).getByRole("radio", { name: "Note" }));
      await user.type(within(sheet).getByRole("textbox", { name: "Title" }), "Eat out");
      await user.click(within(sheet).getByRole("button", { name: "Add note" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(within(screen.getByRole("region", { name: "Tuesday, Nov 24" })).getByText("Eat out")).toBeTruthy();
      expect(await db.planEntry.findMany({ where: { title: "Eat out" }, select: { date: true, mealType: true, title: true } })).toEqual([{ date: "2026-11-24", mealType: "dinner", title: "Eat out" }]);
    });

    it("plans a recipe from a day's sheet on that day, at the scale chosen", async () => {
      const user = userEvent.setup();
      const recipe = await db.recipe.create({ data: { ...createTestRecipe(chefId), title: "Lemon Herb Rice" } });
      await renderLive();

      await user.click(within(screen.getByRole("region", { name: "Thursday, Nov 26" })).getByRole("button", { name: "Plan a meal for Thursday" }));
      const sheet = await screen.findByRole("dialog", { name: "Add to Thursday, Nov 26" });
      await user.selectOptions(within(sheet).getByRole("combobox", { name: "Meal" }), "lunch");
      const scale = within(sheet).getByRole("textbox", { name: "Scale" });
      await user.clear(scale);
      await user.type(scale, "2");
      await user.click(within(sheet).getByRole("button", { name: "Add to plan" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(within(screen.getByRole("region", { name: "Thursday, Nov 26" })).getByRole("link", { name: /Lemon Herb Rice/ })).toBeTruthy();
      expect(await db.planEntry.findMany({ select: { date: true, mealType: true, recipeId: true, scaleFactor: true } })).toEqual([
        { date: "2026-11-26", mealType: "lunch", recipeId: recipe.id, scaleFactor: 2 },
      ]);
    });

    it("makes an empty day the add target, in place of saying nothing is planned", async () => {
      const user = userEvent.setup();
      await renderLive();

      expect(screen.queryByText("Nothing planned yet.")).toBeNull();
      const monday = screen.getByRole("region", { name: "Monday, Nov 23" });
      await user.click(within(monday).getByRole("button", { name: "Plan a meal for Monday" }));
      const sheet = await screen.findByRole("dialog", { name: "Add to Monday, Nov 23" });
      await user.click(within(sheet).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("keeps the sheet open with the error on the form that sent it", async () => {
      const user = userEvent.setup();
      await renderLive();

      await user.click(within(screen.getByRole("region", { name: "Monday, Nov 23" })).getByRole("button", { name: "Plan a meal for Monday" }));
      const sheet = await screen.findByRole("dialog", { name: "Add to Monday, Nov 23" });
      // No recipes yet: the sheet opens on the note, and the recipe side offers to write one.
      await user.click(within(sheet).getByRole("radio", { name: "Recipe" }));
      expect(within(sheet).getByRole("link", { name: "Write a recipe" }).getAttribute("href")).toBe("/recipes/new");
      await user.click(within(sheet).getByRole("radio", { name: "Note" }));
      await user.type(within(sheet).getByRole("textbox", { name: "Title" }), "   ");
      await user.click(within(sheet).getByRole("button", { name: "Add note" }));

      expect(await within(screen.getByRole("dialog", { name: "Add to Monday, Nov 23" })).findByText("Give the note a title.")).toBeTruthy();
      expect(await db.planEntry.count()).toBe(0);
    });

    it("opens the sheet on the recipe a recipe's page sent the cook to plan", async () => {
      const other = await db.user.create({ data: createTestUser() });
      const salmon = await db.recipe.create({ data: { ...createTestRecipe(other.id), title: "Miso Glazed Salmon" } });
      await renderLive(`/plan?week=2026-11-25&recipe=${salmon.id}`);
      const sheet = await screen.findByRole("dialog", { name: "Add to Monday, Nov 23" });
      expect((within(sheet).getByRole("combobox", { name: "Recipe" }) as HTMLSelectElement).value).toBe(salmon.id);
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

    it("offers to add the week shown to the shopping list", async () => {
      await renderPage();
      const form = screen.getByRole("button", { name: "Add this week to my list" }).closest("form")!;
      expect(form.querySelector<HTMLInputElement>('input[name="intent"]')!.value).toBe("add-week-to-list");
      expect(form.querySelector<HTMLInputElement>('input[name="week"]')!.value).toBe("2026-11-23");
      expect(form.querySelector<HTMLInputElement>('input[name="listToken"]')!.value).not.toBe("");
    });

    it("says what went on the list, and what couldn't", () => {
      const { rerender } = render(<WeekListAnswer answer={undefined} />);
      expect(screen.queryByRole("status")).toBeNull();
      rerender(<WeekListAnswer answer={{ intent: "add-week-to-list", added: { recipes: 2, missing: 0 } }} />);
      expect(screen.getByRole("status").textContent).toBe("Added 2 recipes to your shopping list. Open the list");
      expect(screen.getByRole("link", { name: "Open the list" }).getAttribute("href")).toBe("/shopping-list");
      rerender(<WeekListAnswer answer={{ intent: "add-week-to-list", added: { recipes: 1, missing: 1 } }} />);
      expect(screen.getByRole("status").textContent).toBe("Added 1 recipe to your shopping list; 1 recipe is no longer available. Open the list");
      rerender(<WeekListAnswer answer={{ intent: "add-week-to-list", added: { recipes: 0, missing: 2 } }} />);
      expect(screen.getByRole("status").textContent).toBe("Added 0 recipes to your shopping list; 2 recipes are no longer available. Open the list");
      rerender(<WeekListAnswer answer={{ intent: "add-week-to-list", added: { recipes: 0, missing: 0 } }} />);
      expect(screen.getByRole("status").textContent).toBe("No recipes are planned this week, so nothing went on the list.");
      rerender(<WeekListAnswer answer={{ intent: "add-note", errors: { general: "Give the note a title." } }} />);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("marks today when it falls in the week shown", async () => {
      const data = await load("/plan");
      const Stub = createTestRoutesStub([{ path: "/plan", Component: PlanPage, loader: () => data }]);
      render(<Stub initialEntries={["/plan"]} />);
      expect(await screen.findByText("Today")).toBeTruthy();
    });
  });
});
