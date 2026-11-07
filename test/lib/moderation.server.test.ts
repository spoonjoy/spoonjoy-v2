// Reports, blocks and what they hide (App Store guideline 1.2).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb } from "~/lib/db.server";
import {
  MODERATION_EMAIL_DEFAULT,
  ModerationError,
  NO_HIDES,
  blockChef,
  createContentReport,
  ejectReportedChef,
  hidesChef,
  hidesContent,
  isModerator,
  isReportReason,
  isReportTargetType,
  listBlockedChefs,
  listOpenReports,
  loadRequestViewerHides,
  loadViewerHides,
  loadViewerHidesFromD1,
  moderationEmail,
  moderatorUsernames,
  notifyModerators,
  parseReportDetails,
  removeReportedContent,
  reportTargetChef,
  reportTargetHref,
  resolveReport,
  unblockChef,
  withoutHidden,
  type CreatedContentReport,
} from "~/lib/moderation.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestRecipe, createTestUser } from "../utils";

type Db = Awaited<ReturnType<typeof getLocalDb>>;

describe("moderation", () => {
  let db: Db;
  let d1: SqliteD1;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    d1.close();
    await cleanupDatabase();
  });

  async function kitchen() {
    const reporter = await db.user.create({ data: createTestUser() });
    const chef = await db.user.create({ data: createTestUser() });
    const recipe = await db.recipe.create({ data: createTestRecipe(chef.id) });
    const cookbook = await db.cookbook.create({ data: { title: "Weeknight", authorId: chef.id } });
    const spoon = await db.recipeSpoon.create({ data: { recipeId: recipe.id, chefId: chef.id, cookedAt: new Date() } });
    return { reporter, chef, recipe, cookbook, spoon };
  }

  it("checks report types and reasons", () => {
    expect(isReportTargetType("recipe")).toBe(true);
    expect(isReportTargetType("comment")).toBe(false);
    expect(isReportReason("spam")).toBe(true);
    expect(isReportReason(4)).toBe(false);
  });

  it("hides by chef or by content", () => {
    const hides = { chefIds: new Set(["chef"]), targets: new Set(["recipe:r1"]) };
    expect(hidesChef(hides, "chef")).toBe(true);
    expect(hidesChef(hides, null)).toBe(false);
    expect(hidesContent(hides, "recipe", "r1", "other")).toBe(true);
    expect(hidesContent(hides, "cookbook", "r1", "other")).toBe(false);
    expect(hidesContent(hides, "cookbook", "c1", "chef")).toBe(true);
    const items = [{ id: "r1", chef: "other" }, { id: "r2", chef: "chef" }, { id: "r3", chef: "other" }];
    const describe = (item: (typeof items)[number]) => ({ type: "recipe" as const, id: item.id, chefId: item.chef });
    expect(withoutHidden(hides, items, describe).map((item) => item.id)).toEqual(["r3"]);
    const kept = withoutHidden(NO_HIDES, items, describe);
    expect(kept).toEqual(items);
    expect(kept).not.toBe(items);
  });

  it("validates report details", () => {
    expect(parseReportDetails(undefined)).toBeNull();
    expect(parseReportDetails(null)).toBeNull();
    expect(parseReportDetails("   ")).toBeNull();
    expect(parseReportDetails(" rude ")).toBe("rude");
    expect(() => parseReportDetails(5)).toThrow("details must be a string");
    expect(() => parseReportDetails("x".repeat(1001))).toThrow("at most 1000");
  });

  it("names each report target's chef, or null when it is gone", async () => {
    const { chef, recipe, cookbook, spoon } = await kitchen();
    expect(await reportTargetChef(db, "recipe", recipe.id)).toEqual({ chefId: chef.id, label: `recipe "${recipe.title}"` });
    expect(await reportTargetChef(db, "chef", chef.id)).toEqual({ chefId: chef.id, label: `chef @${chef.username}` });
    expect(await reportTargetChef(db, "spoon", spoon.id)).toEqual({ chefId: chef.id, label: "a cook log" });
    expect(await reportTargetChef(db, "cookbook", cookbook.id)).toEqual({ chefId: chef.id, label: 'cookbook "Weeknight"' });
    for (const type of ["recipe", "chef", "spoon", "cookbook"] as const) {
      expect(await reportTargetChef(db, type, "missing")).toBeNull();
    }
  });

  it("files one open report per reporter and target, and refuses bad ones", async () => {
    const { reporter, chef, recipe } = await kitchen();
    const first = await createContentReport(db, { reporterId: reporter.id, targetType: "recipe", targetId: ` ${recipe.id} `, reason: "offensive", details: "rude" });
    expect(first).toMatchObject({ created: true, targetChefId: chef.id, reason: "offensive", details: "rude", report: { status: "open" } });
    const again = await createContentReport(db, { reporterId: reporter.id, targetType: "recipe", targetId: recipe.id, reason: "spam" });
    expect(again).toMatchObject({ created: false, report: first.report });

    const bad = (input: Record<string, unknown>) =>
      createContentReport(db, { reporterId: reporter.id, targetType: "recipe", targetId: recipe.id, reason: "spam", ...input });
    await expect(bad({ targetType: "comment" })).rejects.toThrow("targetType must be one of");
    await expect(bad({ targetId: " " })).rejects.toThrow("targetId must be a non-empty string");
    await expect(bad({ targetId: 7 })).rejects.toThrow("targetId must be a non-empty string");
    await expect(bad({ reason: "boring" })).rejects.toThrow("reason must be one of");
    await expect(bad({ targetId: "missing" })).rejects.toMatchObject({ code: "not_found" });
    await expect(createContentReport(db, { reporterId: chef.id, targetType: "recipe", targetId: recipe.id, reason: "spam" }))
      .rejects.toThrow("You can't report your own content");
  });

  it("returns the report that won a race, and rethrows any other failure", async () => {
    const { reporter, recipe } = await kitchen();
    const input = { reporterId: reporter.id, targetType: "recipe", targetId: recipe.id, reason: "spam" };
    const winner = await db.contentReport.create({
      data: { reporterId: reporter.id, targetType: "recipe", targetId: recipe.id, targetChefId: recipe.chefId, reason: "spam" },
    });
    const findFirst = vi.spyOn(db.contentReport, "findFirst").mockResolvedValueOnce(null);
    vi.spyOn(db.contentReport, "create").mockRejectedValueOnce(new Error("UNIQUE constraint failed"));
    expect(await createContentReport(db, input)).toMatchObject({ created: false, report: { id: winner.id } });

    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    vi.spyOn(db.contentReport, "create").mockRejectedValueOnce(new Error("disk full"));
    await expect(createContentReport(db, input)).rejects.toThrow("disk full");
  });

  it("loads the viewer's hides through Prisma, D1 or the request", async () => {
    const { reporter, chef, recipe } = await kitchen();
    await blockChef(db, reporter.id, chef.id);
    await createContentReport(db, { reporterId: reporter.id, targetType: "recipe", targetId: recipe.id, reason: "spam" });
    const expected = { chefIds: new Set([chef.id]), targets: new Set([`recipe:${recipe.id}`]) };
    expect(await loadViewerHides(db, reporter.id)).toEqual(expected);
    expect(await loadViewerHidesFromD1(d1.binding, reporter.id)).toEqual(expected);
    expect(await loadViewerHides(db, null)).toBe(NO_HIDES);
    expect(await loadViewerHidesFromD1(d1.binding, undefined)).toBe(NO_HIDES);
    expect(await loadRequestViewerHides({ cloudflare: { env: { DB: d1.binding } } } as any, reporter.id)).toEqual(expected);
    expect(await loadRequestViewerHides({ cloudflare: { env: {} } } as any, reporter.id)).toEqual(expected);
    expect(await loadRequestViewerHides({} as any, null)).toBe(NO_HIDES);
  });

  it("blocks, lists and unblocks chefs", async () => {
    const { reporter, chef } = await kitchen();
    const block = await blockChef(db, reporter.id, ` ${chef.id} `);
    expect(block.chef).toEqual({ id: chef.id, username: chef.username, photoUrl: null });
    expect((await blockChef(db, reporter.id, chef.id)).createdAt).toEqual(block.createdAt);
    expect(await listBlockedChefs(db, reporter.id)).toEqual([block]);
    await expect(blockChef(db, reporter.id, "")).rejects.toThrow("chefId must be a non-empty string");
    await expect(blockChef(db, reporter.id, reporter.id)).rejects.toThrow("You can't block yourself");
    await expect(blockChef(db, reporter.id, "missing")).rejects.toBeInstanceOf(ModerationError);
    await unblockChef(db, reporter.id, chef.id);
    expect(await listBlockedChefs(db, reporter.id)).toEqual([]);
  });

  it("reads moderation settings from the environment", () => {
    expect(moderationEmail(undefined)).toBe(MODERATION_EMAIL_DEFAULT);
    expect(moderationEmail({ SPOONJOY_MODERATION_EMAIL: " mod@example.test " })).toBe("mod@example.test");
    expect(moderatorUsernames({ SPOONJOY_MODERATOR_USERNAMES: " Ari, ,bob " })).toEqual(new Set(["ari", "bob"]));
    expect(moderatorUsernames(null)).toEqual(new Set());
    expect(isModerator({ SPOONJOY_MODERATOR_USERNAMES: "ari" }, "ARI")).toBe(true);
    expect(isModerator({ SPOONJOY_MODERATOR_USERNAMES: "ari" }, "bob")).toBe(false);
    expect(isModerator({ SPOONJOY_MODERATOR_USERNAMES: "ari" }, null)).toBe(false);
  });

  it("emails the moderators about a new report, and never throws", async () => {
    const report: CreatedContentReport = {
      report: { id: "report_1", status: "open" },
      created: true,
      targetChefId: "chef",
      targetLabel: 'recipe "Soup"',
      reason: "offensive",
      details: "rude",
    };
    const capture = { SPOONJOY_EMAIL_MODE: "capture", SPOONJOY_BASE_URL: "http://localhost:5173" } as any;
    await notifyModerators(db, capture, report, "reporter");
    const emails = await db.emailOutbox.findMany();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ purpose: "content_report", toAddress: MODERATION_EMAIL_DEFAULT, subject: "Spoonjoy report: Offensive or inappropriate" });
    expect(emails[0]!.textBody).toContain("@reporter reported recipe \"Soup\"");
    expect(emails[0]!.textBody).toContain("They wrote: rude");
    expect(emails[0]!.textBody).toContain("http://localhost:5173/moderation");

    const send = vi.fn().mockResolvedValue(undefined);
    await notifyModerators(db, { EMAIL: { send }, SPOONJOY_EMAIL_FROM: "hello@spoonjoy.app" } as any, { ...report, details: null }, "reporter");
    expect(send.mock.calls[0]![0].text).toContain("They added no details.");
    expect(send.mock.calls[0]![0].text).toContain("https://spoonjoy.app/moderation");

    // Mail off, or no environment at all: nothing is sent and nothing throws.
    await expect(notifyModerators(db, {} as any, report, "reporter")).resolves.toBeUndefined();
    await expect(notifyModerators(db, undefined, report, "reporter")).resolves.toBeUndefined();
    // A report that was already open is not announced again.
    await notifyModerators(db, capture, { ...report, created: false }, "reporter");
    expect(await db.emailOutbox.count()).toBe(1);
  });

  it("lists open reports oldest first with their chefs, and resolves them once", async () => {
    const { reporter, chef, recipe } = await kitchen();
    const filed = await createContentReport(db, { reporterId: reporter.id, targetType: "recipe", targetId: recipe.id, reason: "harassment" });
    await db.contentReport.create({ data: { reporterId: reporter.id, targetType: "chef", targetId: "gone", targetChefId: null, reason: "other" } });
    const queue = await listOpenReports(db);
    expect(queue.map((item) => [item.targetType, item.targetChef?.username ?? null])).toEqual([["recipe", chef.username], ["chef", null]]);
    expect(queue[0]).toMatchObject({ id: filed.report.id, reason: "harassment", reporter: { id: reporter.id, username: reporter.username } });
    expect(await resolveReport(db, filed.report.id, "dismissed")).toBe(true);
    expect(await resolveReport(db, filed.report.id, "actioned")).toBe(false);

    await db.contentReport.deleteMany();
    expect(await listOpenReports(db)).toEqual([]);
  });

  it("links each report target", () => {
    expect(reportTargetHref("recipe", "r1", null)).toBe("/recipes/r1");
    expect(reportTargetHref("cookbook", "c1", null)).toBe("/cookbooks/c1");
    expect(reportTargetHref("chef", "u1", "ari")).toBe("/users/ari");
    expect(reportTargetHref("spoon", "s1", null)).toBeNull();
  });

  it("removes reported recipes, cookbooks and cook logs, and closes the report", async () => {
    const { reporter, recipe, cookbook, spoon, chef } = await kitchen();
    const file = async (targetType: string, targetId: string) =>
      (await createContentReport(db, { reporterId: reporter.id, targetType, targetId, reason: "offensive" })).report.id;

    const spoonReport = await file("spoon", spoon.id);
    expect(await removeReportedContent(db, null, spoonReport)).toBe(true);
    expect((await db.recipeSpoon.findUnique({ where: { id: spoon.id } }))!.deletedAt).not.toBeNull();

    const cookbookReport = await file("cookbook", cookbook.id);
    expect(await removeReportedContent(db, null, cookbookReport)).toBe(true);
    expect(await db.cookbook.findUnique({ where: { id: cookbook.id } })).toBeNull();

    const recipeReport = await file("recipe", recipe.id);
    expect(await removeReportedContent(db, null, recipeReport)).toBe(true);
    expect((await db.recipe.findUnique({ where: { id: recipe.id } }))!.deletedAt).not.toBeNull();
    expect((await db.contentReport.findUnique({ where: { id: recipeReport } }))!.status).toBe("actioned");

    // Closed, missing, chef-only, or content already gone: nothing to remove.
    expect(await removeReportedContent(db, null, recipeReport)).toBe(false);
    expect(await removeReportedContent(db, null, "missing")).toBe(false);
    expect(await removeReportedContent(db, null, await file("chef", chef.id))).toBe(false);
    const stale = async (targetType: string, targetId: string) => (await db.contentReport.create({
      data: { reporterId: reporter.id, targetType, targetId, targetChefId: chef.id, reason: "spam" },
    })).id;
    expect(await removeReportedContent(db, null, await stale("recipe", recipe.id))).toBe(false);
    expect(await removeReportedContent(db, null, await stale("cookbook", cookbook.id))).toBe(false);
    expect(await removeReportedContent(db, null, await stale("spoon", spoon.id))).toBe(false);
    const orphan = await db.contentReport.create({ data: { reporterId: reporter.id, targetType: "recipe", targetId: "x", reason: "spam" } });
    expect(await removeReportedContent(db, null, orphan.id)).toBe(false);
  });

  it("ejects a reported chef and closes every report about them", async () => {
    const { reporter, chef, recipe } = await kitchen();
    const moderator = await db.user.create({ data: createTestUser() });
    const recipeReport = await createContentReport(db, { reporterId: reporter.id, targetType: "recipe", targetId: recipe.id, reason: "offensive" });
    const chefReport = await createContentReport(db, { reporterId: moderator.id, targetType: "chef", targetId: chef.id, reason: "harassment" });

    expect(await ejectReportedChef(d1.binding, db, recipeReport.report.id, moderator.id)).toBe(true);
    expect(await db.user.findUnique({ where: { id: chef.id } })).toBeNull();
    expect((await db.contentReport.findUnique({ where: { id: chefReport.report.id } }))!.status).toBe("actioned");
    expect(await ejectReportedChef(d1.binding, db, recipeReport.report.id, moderator.id)).toBe(false);

    const selfReport = await db.contentReport.create({
      data: { reporterId: reporter.id, targetType: "chef", targetId: moderator.id, targetChefId: moderator.id, reason: "spam" },
    });
    expect(await ejectReportedChef(d1.binding, db, selfReport.id, moderator.id)).toBe(false);
    const orphan = await db.contentReport.create({ data: { reporterId: reporter.id, targetType: "chef", targetId: "x", reason: "spam" } });
    expect(await ejectReportedChef(d1.binding, db, orphan.id, moderator.id)).toBe(false);
  });
});
