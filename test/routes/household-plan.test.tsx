import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureException: vi.fn(() => Promise.resolve()),
}));

import { Request as UndiciRequest } from "undici";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { createUserSessionCookie } from "~/lib/session.server";
import { migratedSqliteD1, type MigratedSqlite } from "../helpers/migrated-sqlite";
import PlanPage, { action, loader, meta } from "~/routes/households.$id.plan";
import { captureException } from "~/lib/analytics-server";
import { expectConsoleError } from "../warning-policy";

// A household's meal plan at /households/:id/plan: its cooks read the week, owners and members plan and remove meals,
// and view-only members only read. People outside the household get a 404.

let database: MigratedSqlite;
let env: Record<string, unknown>;
const cookies: Record<string, string> = {};

type Answer = { type?: string; data?: unknown; init?: { status?: number } } & Record<string, unknown>;

type CallOptions = { query?: string; fields?: Record<string, string>; ctx?: { waitUntil: (promise: Promise<unknown>) => void } };

async function call(fn: (args: never) => Promise<unknown>, user: string, { query = "", fields, ctx }: CallOptions = {}) {
  const init: Record<string, unknown> = { headers: { Cookie: cookies[user]! } };
  if (fields) {
    init.method = "POST";
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(fields).toString();
  }
  const request = new UndiciRequest(`http://localhost:3000/households/h1/plan${query}`, init) as unknown as Request;
  try {
    return (await fn({ request, params: { id: "h1" }, context: { cloudflare: { env, ...(ctx ? { ctx } : {}) } } } as never)) as Answer | Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

// oxlint-disable-next-line typescript/no-explicit-any -- assertions read whatever shape each answer has
function payload(result: unknown): any {
  const answer = result as Answer;
  return answer?.type === "DataWithResponseInit" ? answer.data : answer;
}

function statusOf(result: unknown): number {
  if (result instanceof Response) return result.status;
  const answer = result as Answer;
  return answer?.type === "DataWithResponseInit" ? (answer.init?.status ?? 200) : 200;
}

const run = (sql: string) => database.sqlite.prepare(sql).run();
const WEEK = "?week=2027-03-01";
const note = (title: string) => ({ intent: "add-note", date: "2027-03-02", mealType: "dinner", title });

function entries(result: unknown): Array<{ title: string; recipeTitle: string | null }> {
  return payload(result).week.days.flatMap((day: { entries: unknown[] }) => day.entries);
}

// Prisma's D1 adapter announces, once and on Linux only, that the plan's upsert runs without a transaction.
const PRISMA_D1_TRANSACTION_WARNING =
  "prisma:warn Cloudflare D1 does not support transactions yet. When using Prisma's D1 adapter, " +
  "implicit & explicit transactions will be ignored and run as individual queries, which breaks " +
  "the guarantees of the ACID properties of transactions. For more details see " +
  "https://pris.ly/d/d1-transactions";
let restoreInfo = () => {};

beforeEach(async () => {
  const originalInfo = console.info;
  const spy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    if (args.length === 1 && args[0] === PRISMA_D1_TRANSACTION_WARNING) return;
    Reflect.apply(originalInfo, console, args);
  });
  restoreInfo = () => spy.mockRestore();
  database = migratedSqliteD1();
  env = { DB: database.binding, SPOONJOY_FLAGS: "households" };
  for (const id of ["ann", "ben", "cal", "dee"]) {
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('${id}', '${id}@example.com', '${id}_cooks')`);
    cookies[id] = (await createUserSessionCookie(id, { DB: database.binding } as Parameters<typeof createUserSessionCookie>[1])).split(";")[0]!;
  }
  run(`INSERT INTO "Household" ("id", "name") VALUES ('h1', 'The Lee kitchen')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'ann', 'owner')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'ben', 'member')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'cal', 'viewer')`);
  // Ben keeps a recipe to the household; Dee, outside it, keeps one to hers.
  run(`INSERT INTO "Recipe" ("id", "title", "chefId", "visibility") VALUES ('r-ben', 'Ben''s Stew', 'ben', 'household')`);
  run(`INSERT INTO "Recipe" ("id", "title", "chefId", "visibility") VALUES ('r-dee', 'Dee''s Pie', 'dee', 'household')`);
});

afterEach(() => {
  restoreInfo();
  cleanup();
  database.close();
});

describe("a household's meal plan", () => {
  it("is titled for the household", () => {
    expect(meta({ data: { household: { name: "The Lee kitchen" } } } as never)).toEqual([{ title: "Meal plan - The Lee kitchen - Spoonjoy" }]);
    expect(meta({ data: undefined } as never)).toEqual([{ title: "Meal plan - Spoonjoy" }]);
  });

  it("lets an owner and a member plan meals that every cook in the household reads, after a reload too", async () => {
    expect(statusOf(await call(action, "ann", { fields: note("Pizza night") }))).toBe(302);
    expect(statusOf(await call(action, "ben", { fields: { ...note("Leftovers"), mealType: "lunch" } }))).toBe(302);
    for (const reader of ["ann", "ben", "cal"]) {
      const loaded = await call(loader, reader, { query: WEEK });
      expect(entries(loaded).map((entry) => entry.title).sort(), reader).toEqual(["Leftovers", "Pizza night"]);
    }
  });

  it("sends a new meal back to the household's week", async () => {
    const answer = (await call(action, "ben", { fields: note("Tacos") })) as Response;
    expect(answer.headers.get("Location")).toBe("/households/h1/plan?week=2027-03-02");
  });

  it("offers the household's recipes to plan, and none kept to another household", async () => {
    const loaded = payload(await call(loader, "ann", { query: WEEK }));
    expect(loaded.recipes).toEqual([{ id: "r-ben", title: "Ben's Stew" }]);
    expect(statusOf(await call(action, "ann", { fields: { intent: "add-recipe", date: "2027-03-03", mealType: "dinner", recipeId: "r-ben", scaleFactor: "2" } }))).toBe(302);
    expect(entries(await call(loader, "cal", { query: WEEK })).map((entry) => entry.recipeTitle)).toEqual(["Ben's Stew"]);
    const refused = await call(action, "ann", { fields: { intent: "add-recipe", date: "2027-03-03", mealType: "dinner", recipeId: "r-dee", scaleFactor: "1" } });
    expect(statusOf(refused)).toBe(400);
  });

  it("removes a meal for an owner or a member", async () => {
    await call(action, "ann", { fields: note("Eat out") });
    const [planned] = payload(await call(loader, "ben", { query: WEEK })).week.days[1].entries;
    expect(payload(await call(action, "ben", { fields: { intent: "remove", entryId: planned.id } }))).toEqual({ intent: "remove", removed: true });
    expect(entries(await call(loader, "ann", { query: WEEK }))).toEqual([]);
  });

  it("lets a view-only member read the plan and change nothing", async () => {
    await call(action, "ann", { fields: note("Soup") });
    const loaded = payload(await call(loader, "cal", { query: WEEK }));
    expect(loaded).toMatchObject({ household: { id: "h1", name: "The Lee kitchen" }, canEdit: false });
    const [planned] = loaded.week.days[1].entries;
    for (const fields of [note("Sneaky"), { intent: "remove", entryId: planned.id }]) {
      const refused = await call(action, "cal", { fields });
      expect(statusOf(refused)).toBe(403);
      expect(payload(refused)).toMatchObject({ errors: { general: "View-only members read the household's plan but can't change it." } });
    }
    expect(entries(await call(loader, "ann", { query: WEEK })).map((entry) => entry.title)).toEqual(["Soup"]);
  });

  it("is not found for someone outside the household", async () => {
    expect(statusOf(await call(loader, "dee"))).toBe(404);
    expect(statusOf(await call(action, "dee", { fields: note("Intruder") }))).toBe(404);
  });

  it("refuses what the plan can't do here", async () => {
    expect(payload(await call(action, "ann", { fields: { intent: "add-week-to-list", week: "2027-03-01" } }))).toEqual({
      intent: "add-week-to-list",
      errors: { general: "That isn't something the plan can do." },
    });
    expect(payload(await call(action, "ann", { fields: { title: "No intent" } }))).toEqual({ errors: { general: "That isn't something the plan can do." } });
  });
});

describe("when the database fails a household plan write", () => {
  /**
   * Makes the plan's writes to HouseholdPlanEntry throw `error`, leaving every read and every other table alone.
   * Prisma's D1 adapter logs each failed statement once, so the test expects `logged` of those lines.
   */
  function failPlanWrites(error: Error, logged: number) {
    for (let i = 0; i < logged; i += 1) expectConsoleError("Error in performIO: %O", error);
    const binding = database.binding;
    env = {
      ...env,
      POSTHOG_KEY: "phc_test",
      DB: { ...binding, prepare: (sql: string) => (/^(INSERT INTO|UPDATE) `main`\.`HouseholdPlanEntry`/.test(sql) ? { bind: () => { throw error; } } : binding.prepare(sql)) },
    };
  }

  it("answers 503 while the database is unavailable, so the cook can try again", async () => {
    // Prisma wraps what the binding throws; a lost connection still reads as D1 being briefly away.
    // One try and three retries, each logged.
    failPlanWrites(new Error("Network connection lost."), 4);
    const answer = await call(action, "ben", { fields: note("Tacos") });
    expect(statusOf(answer)).toBe(503);
  });

  it("reports any other failure to PostHog, after the response when the worker can wait", async () => {
    // Two posts, one try each.
    failPlanWrites(new Error("boom"), 2);
    const waitUntil = vi.fn();
    await expect(call(action, "ben", { fields: note("Tacos"), ctx: { waitUntil } })).rejects.toThrow("boom");
    expect(captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ error: expect.any(Error), distinctId: "ben", route: "/households/h1/plan", extras: { action: "plan_add_note" } }),
    );
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(call(action, "ann", { fields: note("Soup") })).rejects.toThrow("boom");
    expect(captureException).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ distinctId: "ann" }));
  });
});

describe("the household plan page", () => {
  async function renderPage(user: string) {
    const loaded = await call(loader, user, { query: WEEK });
    const Stub = createTestRoutesStub([{ path: "/households/:id/plan", Component: PlanPage, loader: () => payload(loaded) }]);
    render(<Stub initialEntries={["/households/h1/plan?week=2027-03-01"]} />);
    await screen.findByRole("heading", { level: 1, name: "Week of Mar 1" });
  }

  it("names the household with a link back to it, links its weeks and lets a member plan each day", async () => {
    await call(action, "ann", { fields: note("Pizza night") });
    await renderPage("ben");
    expect(screen.getByRole("link", { name: "The Lee kitchen" })).toHaveAttribute("href", "/households/h1");
    expect(screen.getByRole("link", { name: "Next week" })).toHaveAttribute("href", "/households/h1/plan?week=2027-03-08");
    // An empty day has only its own button; a day with meals has the header's Add.
    const monday = screen.getByRole("region", { name: "Monday, Mar 1" });
    expect(within(monday).getByRole("button", { name: "Plan a meal for Monday" })).toBeInTheDocument();
    expect(within(monday).queryByRole("button", { name: "Add to Monday" })).toBeNull();
    const tuesday = screen.getByRole("region", { name: "Tuesday, Mar 2" });
    expect(within(tuesday).getByRole("button", { name: "Add to Tuesday" })).toBeInTheDocument();
    expect(within(tuesday).getByRole("button", { name: "Remove Pizza night from Tuesday" })).toBeInTheDocument();
  });

  it("shows a view-only member the week with no Add and no Remove", async () => {
    await call(action, "ann", { fields: note("Pizza night") });
    await renderPage("cal");
    expect(screen.queryByRole("button", { name: /^Add to / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Plan a meal for / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Monday, Mar 1" })).getByText("Nothing planned")).toBeInTheDocument();
    expect(screen.getByText("View-only: you can read this plan.")).toBeInTheDocument();
  });
});
