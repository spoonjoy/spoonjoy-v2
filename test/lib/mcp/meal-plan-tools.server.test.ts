import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action as apiAction, loader as apiLoader } from "~/routes/api.$";
import { getLocalDb } from "~/lib/db.server";
import { authenticateApiToken, createApiCredential } from "~/lib/api-auth.server";
import { callSpoonjoyMcpTool, listSpoonjoyMcpTools, type SpoonjoyMcpContext } from "~/lib/mcp/spoonjoy-tools.server";
import { addEntry, prismaPlanStore } from "~/domains/planning";
import { cleanupDatabase } from "../../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../../utils";

const FLAG_ON = { SPOONJOY_FLAGS: "meal-planner" };

async function signedIn(scopes: string[], env: Record<string, string> | null = FLAG_ON): Promise<SpoonjoyMcpContext & { userId: string }> {
  const db = await getLocalDb();
  const user = await db.user.create({ data: createTestUser() });
  const { token } = await createApiCredential(db, user.id, "Planner", { scopes });
  return { db, principal: await authenticateApiToken(db, token), env, userId: user.id } as SpoonjoyMcpContext & { userId: string };
}

type Answer = Record<string, unknown> & { meal?: Record<string, unknown>; removed?: boolean };

async function write(name: string, args: Record<string, unknown>, context: SpoonjoyMcpContext) {
  return JSON.parse(await callSpoonjoyMcpTool(name, args, context)) as Answer;
}

type MealPlanAnswer = {
  mealPlan: { weekStart: string; today: string; timeZone: string; days: { date: string; meals: Record<string, unknown>[] }[] };
};

async function call(name: string, args: Record<string, unknown>, context: SpoonjoyMcpContext) {
  return JSON.parse(await callSpoonjoyMcpTool(name, args, context)) as MealPlanAnswer;
}

describe("meal plan tools", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("lists get_meal_plan as a read-only tool", () => {
    const tool = listSpoonjoyMcpTools().find((candidate) => candidate.name === "get_meal_plan");
    expect(tool?.annotations.readOnlyHint).toBe(true);
    expect(tool?.requiredScopes).toEqual(["kitchen:read"]);
  });

  it("gives the week holding the asked day, each day's meals in meal order, with recipes by title and scale", async () => {
    const context = await signedIn(["kitchen:read"]);
    const recipe = await context.db.recipe.create({ data: { ...createTestRecipe(context.userId), title: "Miso soup" } });
    const store = prismaPlanStore(context.db);
    await addEntry(store, context.userId, "e-dinner", { kind: "recipe", recipeId: recipe.id, date: "2026-11-25", mealType: "dinner", scaleFactor: 2 });
    await addEntry(store, context.userId, "e-lunch", { kind: "note", title: "Leftovers", note: "From Monday", date: "2026-11-25", mealType: "lunch" });

    const { mealPlan } = await call("get_meal_plan", { week: "2026-11-26" }, context);
    expect(mealPlan.weekStart).toBe("2026-11-23");
    expect(mealPlan.timeZone).toBe("UTC");
    expect(mealPlan.days.map((day) => day.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(mealPlan.days[2].meals).toEqual([
      { id: "e-lunch", mealType: "lunch", kind: "note", recipeId: null, title: "Leftovers", note: "From Monday", scaleFactor: 1 },
      { id: "e-dinner", mealType: "dinner", kind: "recipe", recipeId: recipe.id, title: "Miso soup", note: "", scaleFactor: 2 },
    ]);
  });

  it("opens on this week when no week is asked for", async () => {
    const context = await signedIn(["kitchen:read"]);
    const { mealPlan } = await call("get_meal_plan", {}, context);
    expect(mealPlan.days).toHaveLength(7);
    expect(mealPlan.days.map((day) => day.date)).toContain(mealPlan.today);
  });

  it("refuses a week that isn't a calendar date", async () => {
    const context = await signedIn(["kitchen:read"]);
    await expect(call("get_meal_plan", { week: "next week" }, context)).rejects.toThrow("week must be a day as YYYY-MM-DD");
  });

  it("needs the kitchen:read scope", async () => {
    const context = await signedIn(["shopping_list:read"]);
    await expect(call("get_meal_plan", {}, context)).rejects.toThrow("Missing required scope: kitchen:read");
  });

  it("is not found while the meal planner is off for the caller", async () => {
    const context = await signedIn(["kitchen:read"], {});
    await expect(call("get_meal_plan", {}, context)).rejects.toMatchObject({ message: "The meal planner isn't available on this account yet.", status: 404 });
  });
});

describe("planning and removing meals by tool", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("lists plan_meal as a write and remove_meal_plan_entry as a destructive, idempotent write, both needing kitchen:write", () => {
    const tools = listSpoonjoyMcpTools();
    const plan = tools.find((tool) => tool.name === "plan_meal");
    const remove = tools.find((tool) => tool.name === "remove_meal_plan_entry");
    expect(plan?.requiredScopes).toEqual(["kitchen:write"]);
    expect(plan?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(remove?.requiredScopes).toEqual(["kitchen:write"]);
    expect(remove?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
  });

  it("plans a recipe at a servings scale and a note, each after the day's meals of its type", async () => {
    const context = await signedIn(["kitchen:read", "kitchen:write"]);
    const recipe = await context.db.recipe.create({ data: { ...createTestRecipe(context.userId), title: "Miso soup" } });
    const soup = await write("plan_meal", { date: "2026-11-25", mealType: "dinner", recipeId: recipe.id, scaleFactor: 1.5 }, context);
    const out = await write("plan_meal", { date: "2026-11-25", mealType: "dinner", title: "Eating out", note: "Friends" }, context);
    expect(soup.meal).toMatchObject({ mealType: "dinner", kind: "recipe", recipeId: recipe.id, title: "Miso soup", scaleFactor: 1.5 });
    expect(out.meal).toMatchObject({ kind: "note", recipeId: null, title: "Eating out", note: "Friends", scaleFactor: 1 });
    const { mealPlan } = await call("get_meal_plan", { week: "2026-11-25" }, context);
    expect(mealPlan.days[2].meals.map((meal) => meal.id)).toEqual([soup.meal?.id, out.meal?.id]);
  });

  it("plans the meal once when the same call is sent again with its idempotency key", async () => {
    const context = await signedIn(["kitchen:write"]);
    const args = { date: "2026-11-25", mealType: "lunch", title: "Leftovers", idempotencyKey: "retry-1" };
    const first = await write("plan_meal", args, context);
    const again = await write("plan_meal", args, context);
    expect(again.meal?.id).toBe(first.meal?.id);
    expect(await context.db.planEntry.count()).toBe(1);
  });

  it("refuses a meal the plan can't take, with the reason", async () => {
    const context = await signedIn(["kitchen:write"]);
    await expect(write("plan_meal", { date: "someday", mealType: "dinner", title: "Out" }, context)).rejects.toMatchObject({ message: "Choose a day for this meal.", status: 400 });
    await expect(write("plan_meal", { date: "2026-11-25", mealType: "brunch", title: "Out" }, context)).rejects.toMatchObject({ message: "Choose a meal type.", status: 400 });
    await expect(write("plan_meal", { date: "2026-11-25", mealType: "dinner", recipeId: "missing" }, context)).rejects.toMatchObject({ message: "That recipe isn't available to plan.", status: 400 });
  });

  it("removes a planned meal, and answers removed: false when it is already gone", async () => {
    const context = await signedIn(["kitchen:read", "kitchen:write"]);
    const { meal } = await write("plan_meal", { date: "2026-11-25", mealType: "dinner", title: "Out" }, context);
    expect(await write("remove_meal_plan_entry", { entryId: meal?.id }, context)).toEqual({ removed: true });
    expect(await write("remove_meal_plan_entry", { entryId: meal?.id }, context)).toEqual({ removed: false });
    const { mealPlan } = await call("get_meal_plan", { week: "2026-11-25" }, context);
    expect(mealPlan.days[2].meals).toEqual([]);
  });

  it("needs kitchen:write, and is not found while the meal planner is off for the caller", async () => {
    const reader = await signedIn(["kitchen:read"]);
    await expect(write("plan_meal", { date: "2026-11-25", mealType: "dinner", title: "Out" }, reader)).rejects.toThrow("Missing required scope: kitchen:write");
    const flagOff = await signedIn(["kitchen:write"], {});
    await expect(write("remove_meal_plan_entry", { entryId: "x" }, flagOff)).rejects.toMatchObject({ status: 404 });
  });
});

describe("meal plan REST endpoints", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  async function get(path: string, token: string, env: Record<string, string> = FLAG_ON) {
    const request = new UndiciRequest(`http://localhost/api/${path}`, { headers: { Authorization: `Bearer ${token}` } }) as unknown as Request;
    const splat = path.split("?")[0];
    const response = (await apiLoader({ request, params: { "*": splat }, context: { cloudflare: { env, ctx: { waitUntil: () => {} } } } } as never)) as Response;
    return { status: response.status, body: (await response.json()) as { data?: MealPlanAnswer; error?: unknown } };
  }

  it("reads a week of the plan at GET /api/meal-plan?week=", async () => {
    const db = await getLocalDb();
    const user = await db.user.create({ data: createTestUser() });
    const { token } = await createApiCredential(db, user.id, "Planner", { scopes: ["kitchen:read"] });
    const { status, body } = await get("meal-plan?week=2026-11-26", token);
    expect({ status, error: body.error }).toEqual({ status: 200, error: undefined });
    expect(body.data?.mealPlan.weekStart).toBe("2026-11-23");
    expect((await get("meal-plan", token, {})).status).toBe(404);
  });

  it("plans a meal at POST /api/meal-plan/meals and removes it at DELETE /api/meal-plan/meals/:id", async () => {
    const db = await getLocalDb();
    const user = await db.user.create({ data: createTestUser() });
    const { token } = await createApiCredential(db, user.id, "Planner", { scopes: ["kitchen:write"] });
    const send = async (method: string, path: string, body: Record<string, unknown>) => {
      const request = new UndiciRequest(`http://localhost/api/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }) as unknown as Request;
      const response = (await apiAction({ request, params: { "*": path }, context: { cloudflare: { env: FLAG_ON, ctx: { waitUntil: () => {} } } } } as never)) as Response;
      return { status: response.status, body: (await response.json()) as { data?: Answer } };
    };
    const planned = await send("POST", "meal-plan/meals", { date: "2026-11-25", mealType: "dinner", title: "Out" });
    expect(planned.status).toBe(200);
    const id = String(planned.body.data?.meal?.id);
    expect((await send("DELETE", `meal-plan/meals/${id}`, {})).body.data).toEqual({ removed: true });
  });
});
