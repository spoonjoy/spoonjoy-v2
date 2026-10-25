import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestRecipe, createTestRoutesStub, createTestUser } from "../utils";

const mocked = vi.hoisted(() => ({ db: null as PrismaClient | null }));

vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: vi.fn(async () => mocked.db!),
}));

const { default: Moderation, action, loader, meta } = await import("~/routes/moderation");

let db: PrismaClient;
let d1: SqliteD1;

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  mocked.db = db;
  d1 = sqliteD1();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  d1.close();
  await cleanupDatabase();
});

async function chef(username?: string) {
  const user = await db.user.create({ data: { ...createTestUser(), ...(username ? { username } : {}) } });
  return { user, cookie: (await createUserSessionCookie(user.id)).split(";")[0]! };
}

function env(extra: Record<string, unknown> = {}) {
  return { DB: d1.binding, SPOONJOY_MODERATOR_USERNAMES: "the_mod", ...extra };
}

async function call<T>(run: () => Promise<T>): Promise<T | Response> {
  try {
    return await run();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

function post(cookie: string, fields: Record<string, string>, context: Record<string, unknown> = { cloudflare: { env: env() } }) {
  const request = new UndiciRequest("http://localhost:3000/moderation", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return call(() => action({ request, context, params: {} } as never));
}

function load(cookie: string | null, moderators = "the_mod") {
  const request = new UndiciRequest("http://localhost:3000/moderation", { headers: cookie ? { Cookie: cookie } : {} });
  return call(() => loader({ request, context: { cloudflare: { env: env({ SPOONJOY_MODERATOR_USERNAMES: moderators }) } }, params: {} } as never));
}

function answer(result: unknown): { status: number; body: unknown } {
  if (result && typeof result === "object" && "init" in result && "data" in result) {
    const wrapped = result as { data: unknown; init: { status?: number } | null };
    return { status: wrapped.init?.status ?? 200, body: wrapped.data };
  }
  return { status: 200, body: result };
}

describe("/moderation", () => {
  it("is not indexed", () => {
    expect(meta({} as never)).toEqual([{ title: "Moderation - Spoonjoy" }, { name: "robots", content: "noindex" }]);
  });

  it("sends signed-out chefs to sign in, and hides the queue from anyone but a moderator", async () => {
    const signedOut = (await load(null)) as Response;
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get("Location")).toBe("/login?redirectTo=%2Fmoderation");

    const { cookie } = await chef();
    expect(((await load(cookie)) as Response).status).toBe(404);
  });

  it("lists open reports for a moderator", async () => {
    const mod = await chef("the_mod");
    const reporter = await chef();
    const author = await chef("author_chef");
    const recipe = await db.recipe.create({ data: createTestRecipe(author.user.id) });
    await post(reporter.cookie, { intent: "report", targetType: "recipe", targetId: recipe.id, reason: "spam", details: "ads" });

    const result = (await load(mod.cookie, "someone, THE_MOD")) as Awaited<ReturnType<typeof loader>>;
    expect(result.reports).toEqual([
      expect.objectContaining({
        targetType: "recipe",
        reason: "Spam or advertising",
        details: "ads",
        reporter: reporter.user.username,
        chef: "author_chef",
        href: `/recipes/${recipe.id}`,
      }),
    ]);
  });

  it("files a report, waiting on the moderator notice when there is no execution context", async () => {
    const reporter = await chef();
    const author = await chef();
    const recipe = await db.recipe.create({ data: createTestRecipe(author.user.id) });
    const fields = { intent: "report", targetType: "recipe", targetId: recipe.id, reason: "offensive" };

    expect(answer(await post(reporter.cookie, fields))).toEqual({ status: 200, body: { intent: "report", success: true } });

    const waitUntil = vi.fn();
    const withCtx = { cloudflare: { env: env(), ctx: { waitUntil } } };
    expect(answer(await post(reporter.cookie, fields, withCtx)).body).toEqual({ intent: "report", success: true });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(await db.contentReport.count()).toBe(1);

    expect(answer(await post(reporter.cookie, { ...fields, targetId: "missing" }))).toEqual({
      status: 404,
      body: { intent: "report", success: false, error: expect.any(String) },
    });
    expect(answer(await post(reporter.cookie, { ...fields, reason: "nope" })).status).toBe(400);
  });

  it("blocks and unblocks a chef, and refuses to block yourself", async () => {
    const me = await chef();
    const other = await chef();
    expect(answer(await post(me.cookie, { intent: "block", chefId: other.user.id })).body).toEqual({ intent: "block", success: true });
    expect(await db.chefBlock.count({ where: { blockerId: me.user.id } })).toBe(1);
    expect(answer(await post(me.cookie, { intent: "block", chefId: me.user.id })).status).toBe(400);
    expect(answer(await post(me.cookie, { intent: "unblock", chefId: other.user.id })).body).toEqual({ intent: "unblock", success: true });
    expect(answer(await post(me.cookie, { intent: "unblock" })).body).toEqual({ intent: "unblock", success: true });
    expect(await db.chefBlock.count()).toBe(0);
  });

  it("lets only moderators dismiss, remove and eject, and answers unknown intents", async () => {
    const mod = await chef("the_mod");
    const reporter = await chef();
    const author = await chef();
    const recipe = await db.recipe.create({ data: createTestRecipe(author.user.id) });
    const report = async (targetType: string, targetId: string) => {
      await post(reporter.cookie, { intent: "report", targetType, targetId, reason: "offensive" });
      return (await db.contentReport.findFirstOrThrow({ where: { targetType, targetId, status: "open" } })).id;
    };

    const recipeReport = await report("recipe", recipe.id);
    expect(answer(await post(reporter.cookie, { intent: "dismiss", reportId: recipeReport })).status).toBe(404);
    expect(answer(await post(mod.cookie, { intent: "dismiss", reportId: recipeReport })).body).toEqual({ intent: "dismiss", success: true });
    expect(answer(await post(mod.cookie, { intent: "dismiss", reportId: recipeReport })).status).toBe(409);

    const again = await report("recipe", recipe.id);
    expect(answer(await post(mod.cookie, { intent: "remove", reportId: again })).body).toEqual({ intent: "remove", success: true });
    expect((await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).deletedAt).not.toBeNull();

    const chefReport = await report("chef", author.user.id);
    const noD1 = { cloudflare: { env: { SPOONJOY_MODERATOR_USERNAMES: "the_mod" } } };
    expect(answer(await post(mod.cookie, { intent: "eject", reportId: chefReport }, noD1)).status).toBe(409);
    expect(answer(await post(mod.cookie, { intent: "eject", reportId: chefReport })).body).toEqual({ intent: "eject", success: true });
    expect(await db.user.findUnique({ where: { id: author.user.id } })).toBeNull();
    expect(answer(await post(mod.cookie, { intent: "eject" })).status).toBe(409);

    expect(answer(await post(mod.cookie, { intent: "shrug" }))).toEqual({ status: 400, body: { intent: "shrug", success: false, error: "Unknown action" } });
    expect(answer(await post(mod.cookie, {})).status).toBe(400);
  });

  it("rethrows unexpected failures to the route boundary", async () => {
    const me = await chef();
    vi.spyOn(db.chefBlock, "upsert").mockRejectedValueOnce(new Error("D1 down"));
    const other = await chef();
    await expect(post(me.cookie, { intent: "block", chefId: other.user.id })).rejects.toThrow("D1 down");
  });

  it("falls back to no username when the chef row is gone", async () => {
    const me = await chef();
    vi.spyOn(db.user, "findUnique").mockResolvedValueOnce(null);
    const other = await chef();
    expect(answer(await post(me.cookie, { intent: "block", chefId: other.user.id })).body).toEqual({ intent: "block", success: true });
  });

  describe("the queue", () => {
    const report = {
      id: "r1",
      targetType: "recipe",
      reason: "Spam",
      details: "selling pans",
      createdAt: "2026-10-24T12:00:00.000Z",
      reporter: "reporter",
      chef: "author",
      href: "/recipes/x",
    };

    function renderQueue(reports: unknown[], act = vi.fn(async () => ({ success: true }))) {
      const Stub = createTestRoutesStub([
        { path: "/moderation", Component: Moderation, loader: () => ({ reports }), action: async ({ request }: { request: Request }) => act(Object.fromEntries(await request.formData())) },
      ]);
      render(<Stub initialEntries={["/moderation"]} />);
      return act;
    }

    it("says when there is nothing to review", async () => {
      renderQueue([]);
      expect(await screen.findByText("No open reports")).toBeInTheDocument();
    });

    it("shows each report and acts on it", async () => {
      const user = userEvent.setup();
      const act = renderQueue([
        report,
        { ...report, id: "r2", targetType: "chef", details: null, href: "/users/author" },
        { ...report, id: "r3", chef: null, href: null, details: null },
        { ...report, id: "r4", chef: null, href: "/cookbooks/c", targetType: "cookbook", details: null },
      ]);

      const [first] = await screen.findAllByRole("article", { name: "Report about @author" });
      expect(within(first!).getByRole("link", { name: "@author's recipe" })).toHaveAttribute("href", "/recipes/x");
      expect(within(first!).getByText("“selling pans”")).toBeInTheDocument();
      await user.click(within(first!).getByRole("button", { name: "Remove content" }));
      await waitFor(() => expect(act).toHaveBeenCalledWith({ intent: "remove", reportId: "r1" }));

      const [, chefRow] = screen.getAllByRole("article");
      expect(within(chefRow!).queryByRole("button", { name: "Remove content" })).toBeNull();
      await user.click(within(chefRow!).getByRole("button", { name: "Eject @author" }));
      await user.click(await screen.findByRole("button", { name: "Eject" }));
      await waitFor(() => expect(act).toHaveBeenCalledWith({ intent: "eject", reportId: "r2" }));

      const gone = screen.getAllByRole("article", { name: "Report about deleted content" });
      expect(within(gone[0]!).queryByRole("link")).toBeNull();
      expect(within(gone[1]!).getByRole("link", { name: "cookbook" })).toHaveAttribute("href", "/cookbooks/c");
      await user.click(within(gone[0]!).getByRole("button", { name: "Dismiss" }));
      await waitFor(() => expect(act).toHaveBeenCalledWith({ intent: "dismiss", reportId: "r3" }));
    });

    it("shows a failed action", async () => {
      const user = userEvent.setup();
      renderQueue([report], vi.fn(async () => ({ success: false, error: "That report is closed." })));
      await user.click(await screen.findByRole("button", { name: "Dismiss" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("That report is closed.");
    });
  });
});
