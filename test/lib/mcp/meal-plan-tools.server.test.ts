import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { loader as apiLoader } from "~/routes/api.$";
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
});
