import type { PrismaClient } from "@prisma/client";
import type { AppLoadContext } from "react-router";
import { captureEvent, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { d1ReadBatch, requestD1, type D1ReadDatabase } from "~/lib/d1-read.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { deleteAccount } from "~/lib/account-deletion.server";
import { deleteNativeRecipe } from "~/lib/api-v1-recipe-writes.server";
import { asCompatibleCookbookD1Database, deleteCookbookWithTombstone } from "~/lib/cookbook-membership-compat.server";
import { deleteSpoon } from "~/lib/recipe-spoon.server";
import { sendTransactionalEmail, type TransactionalEmailEnv } from "~/lib/transactional-email.server";

// Moderation for App Store guideline 1.2: chefs report content and block other chefs, and the
// blocker never sees a blocked chef's recipes, cookbooks, cook logs or profile again. Reporting
// something also hides it from the reporter at once. Reports reach the moderators by email when
// the environment can send mail, as a PostHog event always, and in the /moderation queue.

export const REPORT_TARGET_TYPES = ["recipe", "chef", "spoon", "cookbook"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = ["spam", "offensive", "harassment", "copyright", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam or advertising",
  offensive: "Offensive or inappropriate",
  harassment: "Harassment or hate",
  copyright: "Copied without permission",
  other: "Something else",
};

export const REPORT_DETAILS_MAX = 1000;

export const MODERATION_EMAIL_DEFAULT = "ari@spoonjoy.app";

export type ModerationErrorCode = "validation_error" | "not_found";

export class ModerationError extends Error {
  constructor(readonly code: ModerationErrorCode, message: string) {
    super(message);
    this.name = "ModerationError";
  }
}

export function isReportTargetType(value: unknown): value is ReportTargetType {
  return typeof value === "string" && (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value);
}

/** What one viewer has hidden: the chefs they blocked or reported, and the content they reported. */
export interface ViewerHides {
  chefIds: ReadonlySet<string>;
  targets: ReadonlySet<string>;
}

export const NO_HIDES: ViewerHides = { chefIds: new Set(), targets: new Set() };

function targetKey(type: ReportTargetType, id: string): string {
  return `${type}:${id}`;
}

export function hidesChef(hides: ViewerHides, chefId: string | null | undefined): boolean {
  return Boolean(chefId) && hides.chefIds.has(chefId!);
}

/** True when the viewer blocked or reported the content's chef, or reported the content itself. */
export function hidesContent(hides: ViewerHides, type: ReportTargetType, id: string, chefId: string | null | undefined): boolean {
  return hidesChef(hides, chefId) || hides.targets.has(targetKey(type, id));
}

const VIEWER_HIDES_SQL = `SELECT 'chef' AS "type", "blockedId" AS "id" FROM "ChefBlock" WHERE "blockerId" = ?
  UNION ALL
  SELECT "targetType" AS "type", "targetId" AS "id" FROM "ContentReport" WHERE "reporterId" = ?`;

/** Turns the rows of viewerHidesQuery into the viewer's hides. */
export function hidesFromRows(rows: ReadonlyArray<Record<string, unknown>>): ViewerHides {
  const chefIds = new Set<string>();
  const targets = new Set<string>();
  for (const row of rows) {
    const type = String(row.type);
    const id = String(row.id);
    if (type === "chef") chefIds.add(id);
    else targets.add(`${type}:${id}`);
  }
  return { chefIds, targets };
}

/** The D1 statement for a viewer's hides, to join another read batch. */
export function viewerHidesQuery(viewerId: string): readonly [string, string, string] {
  return [VIEWER_HIDES_SQL, viewerId, viewerId];
}

export async function loadViewerHides(db: PrismaClient, viewerId: string | null | undefined): Promise<ViewerHides> {
  if (!viewerId) return NO_HIDES;
  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(VIEWER_HIDES_SQL, viewerId, viewerId);
  return hidesFromRows(rows);
}

export async function loadViewerHidesFromD1(db: D1ReadDatabase, viewerId: string | null | undefined): Promise<ViewerHides> {
  if (!viewerId) return NO_HIDES;
  const [rows] = await d1ReadBatch(db, [viewerHidesQuery(viewerId)]);
  return hidesFromRows(rows);
}

/** The viewer's hides for a route request: from D1 on the Worker, else through Prisma. */
export async function loadRequestViewerHides(context: AppLoadContext, viewerId: string | null | undefined): Promise<ViewerHides> {
  if (!viewerId) return NO_HIDES;
  const d1 = requestD1(context);
  return d1 ? loadViewerHidesFromD1(d1, viewerId) : loadViewerHides(await getRequestDb(context), viewerId);
}

/** Drops the items the viewer has hidden; `describe` names each item's content type, id and chef. */
export function withoutHidden<T>(
  hides: ViewerHides,
  items: readonly T[],
  describe: (item: T) => { type: ReportTargetType; id: string; chefId: string | null | undefined },
): T[] {
  if (hides.chefIds.size === 0 && hides.targets.size === 0) return [...items];
  return items.filter((item) => {
    const { type, id, chefId } = describe(item);
    return !hidesContent(hides, type, id, chefId);
  });
}

/** The chef behind a report target, or null when the target does not exist (or is deleted). */
export async function reportTargetChef(db: PrismaClient, type: ReportTargetType, id: string): Promise<{ chefId: string; label: string } | null> {
  switch (type) {
    case "recipe": {
      const recipe = await db.recipe.findFirst({ where: { id, deletedAt: null }, select: { chefId: true, title: true } });
      return recipe ? { chefId: recipe.chefId, label: `recipe "${recipe.title}"` } : null;
    }
    case "chef": {
      const chef = await db.user.findUnique({ where: { id }, select: { id: true, username: true } });
      return chef ? { chefId: chef.id, label: `chef @${chef.username}` } : null;
    }
    case "spoon": {
      const spoon = await db.recipeSpoon.findFirst({ where: { id, deletedAt: null }, select: { chefId: true } });
      return spoon ? { chefId: spoon.chefId, label: "a cook log" } : null;
    }
    case "cookbook": {
      const cookbook = await db.cookbook.findUnique({ where: { id }, select: { authorId: true, title: true } });
      return cookbook ? { chefId: cookbook.authorId, label: `cookbook "${cookbook.title}"` } : null;
    }
  }
}

export interface ContentReportInput {
  reporterId: string;
  targetType: unknown;
  targetId: unknown;
  reason: unknown;
  details?: unknown;
}

export interface CreatedContentReport {
  report: { id: string; status: string };
  created: boolean;
  targetChefId: string;
  targetLabel: string;
  reason: ReportReason;
  details: string | null;
}

export function parseReportDetails(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ModerationError("validation_error", "details must be a string");
  const trimmed = value.trim();
  if (trimmed.length > REPORT_DETAILS_MAX) {
    throw new ModerationError("validation_error", `details must be at most ${REPORT_DETAILS_MAX} characters`);
  }
  return trimmed || null;
}

/**
 * Files a report, or returns the reporter's open report about the same target. Throws
 * ModerationError for an unknown type, reason or target, or a report about yourself.
 */
export async function createContentReport(db: PrismaClient, input: ContentReportInput): Promise<CreatedContentReport> {
  if (!isReportTargetType(input.targetType)) {
    throw new ModerationError("validation_error", `targetType must be one of ${REPORT_TARGET_TYPES.join(", ")}`);
  }
  if (typeof input.targetId !== "string" || !input.targetId.trim()) {
    throw new ModerationError("validation_error", "targetId must be a non-empty string");
  }
  if (!isReportReason(input.reason)) {
    throw new ModerationError("validation_error", `reason must be one of ${REPORT_REASONS.join(", ")}`);
  }
  const details = parseReportDetails(input.details);
  const targetType = input.targetType;
  const targetId = input.targetId.trim();
  const target = await reportTargetChef(db, targetType, targetId);
  if (!target) throw new ModerationError("not_found", "That content no longer exists");
  if (target.chefId === input.reporterId) {
    throw new ModerationError("validation_error", "You can't report your own content");
  }

  const where = { reporterId: input.reporterId, targetType, targetId, status: "open" };
  const existing = await db.contentReport.findFirst({ where, select: { id: true, status: true } });
  const base = { targetChefId: target.chefId, targetLabel: target.label, reason: input.reason, details };
  if (existing) return { report: existing, created: false, ...base };
  try {
    const report = await db.contentReport.create({
      data: { ...where, targetChefId: target.chefId, reason: input.reason, details },
      select: { id: true, status: true },
    });
    return { report, created: true, ...base };
  } catch (error) {
    // Two reports raced: the partial unique index kept one open report; return it.
    const raced = await db.contentReport.findFirst({ where, select: { id: true, status: true } });
    if (raced) return { report: raced, created: false, ...base };
    throw error;
  }
}

export type ModerationEnv = TransactionalEmailEnv & {
  SPOONJOY_MODERATION_EMAIL?: string;
  SPOONJOY_MODERATOR_USERNAMES?: string;
};

export function moderationEmail(env: ModerationEnv | null | undefined): string {
  return env?.SPOONJOY_MODERATION_EMAIL?.trim() || MODERATION_EMAIL_DEFAULT;
}

export function moderatorUsernames(env: ModerationEnv | null | undefined): Set<string> {
  return new Set(
    (env?.SPOONJOY_MODERATOR_USERNAMES ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isModerator(env: ModerationEnv | null | undefined, username: string | null | undefined): boolean {
  return Boolean(username) && moderatorUsernames(env).has(username!.toLowerCase());
}

/**
 * Tells the moderators about a new report: a PostHog event always, and an email when this
 * environment can send mail. Never throws, so a report is filed even when both fail.
 */
export async function notifyModerators(
  db: PrismaClient,
  env: ModerationEnv | null | undefined,
  report: CreatedContentReport,
  reporterUsername: string,
): Promise<void> {
  if (!report.created) return;
  const baseUrl = env?.SPOONJOY_BASE_URL?.trim() || "https://spoonjoy.app";
  if (env) {
    await captureEvent(resolvePostHogServerConfig(env), {
      event: "spoonjoy.moderation.report_created",
      distinctId: "system",
      properties: { report_id: report.report.id, reason: report.reason },
    });
  }
  try {
    await sendTransactionalEmail(db, env, {
      to: moderationEmail(env),
      purpose: "content_report",
      subject: `Spoonjoy report: ${REPORT_REASON_LABELS[report.reason]}`,
      text: [
        `@${reporterUsername} reported ${report.targetLabel} (${REPORT_REASON_LABELS[report.reason]}).`,
        report.details ? `They wrote: ${report.details}` : "They added no details.",
        `Review it within 24 hours: ${baseUrl}/moderation`,
      ].join("\n\n"),
    });
  } catch {
    // Mail is off or refused here; the PostHog event and the /moderation queue still carry it.
  }
}

export interface BlockedChef {
  chef: { id: string; username: string; photoUrl: string | null };
  createdAt: Date;
}

export async function listBlockedChefs(db: PrismaClient, blockerId: string): Promise<BlockedChef[]> {
  const rows = await db.chefBlock.findMany({
    where: { blockerId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, blocked: { select: { id: true, username: true, photoUrl: true } } },
  });
  return rows.map((row) => ({ chef: row.blocked, createdAt: row.createdAt }));
}

/** Blocks a chef (again is fine). Throws ModerationError for yourself or an unknown chef. */
export async function blockChef(db: PrismaClient, blockerId: string, chefId: unknown): Promise<BlockedChef> {
  if (typeof chefId !== "string" || !chefId.trim()) {
    throw new ModerationError("validation_error", "chefId must be a non-empty string");
  }
  const blockedId = chefId.trim();
  if (blockedId === blockerId) throw new ModerationError("validation_error", "You can't block yourself");
  const chef = await db.user.findUnique({ where: { id: blockedId }, select: { id: true, username: true, photoUrl: true } });
  if (!chef) throw new ModerationError("not_found", "That chef doesn't exist");
  const row = await db.chefBlock.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    create: { blockerId, blockedId },
    update: {},
    select: { createdAt: true },
  });
  return { chef, createdAt: row.createdAt };
}

export async function unblockChef(db: PrismaClient, blockerId: string, chefId: string): Promise<void> {
  await db.chefBlock.deleteMany({ where: { blockerId, blockedId: chefId } });
}

export interface ModerationQueueItem {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  targetChef: { id: string; username: string } | null;
  reason: ReportReason;
  details: string | null;
  status: string;
  createdAt: Date;
  reporter: { id: string; username: string };
}

export async function listOpenReports(db: PrismaClient): Promise<ModerationQueueItem[]> {
  const reports = await db.contentReport.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      targetType: true,
      targetId: true,
      targetChefId: true,
      reason: true,
      details: true,
      status: true,
      createdAt: true,
      reporter: { select: { id: true, username: true } },
    },
  });
  const chefIds = [...new Set(reports.map((report) => report.targetChefId).filter((id): id is string => Boolean(id)))];
  const chefs = chefIds.length
    ? await db.user.findMany({ where: { id: { in: chefIds } }, select: { id: true, username: true } })
    : [];
  const chefById = new Map(chefs.map((chef) => [chef.id, chef]));
  return reports.map(({ targetChefId, ...report }) => ({
    ...report,
    targetType: report.targetType as ReportTargetType,
    reason: report.reason as ReportReason,
    targetChef: (targetChefId && chefById.get(targetChefId)) || null,
  }));
}

/** Closes a report as actioned (the content was dealt with) or dismissed. */
export async function resolveReport(db: PrismaClient, reportId: string, status: "actioned" | "dismissed"): Promise<boolean> {
  const result = await db.contentReport.updateMany({
    where: { id: reportId, status: "open" },
    data: { status, resolvedAt: new Date() },
  });
  return result.count > 0;
}

/** The path a report target opens at, for the moderation queue. */
export function reportTargetHref(type: ReportTargetType, id: string, chefUsername: string | null): string | null {
  switch (type) {
    case "recipe":
      return `/recipes/${id}`;
    case "cookbook":
      return `/cookbooks/${id}`;
    case "chef":
    case "spoon":
      return chefUsername ? `/users/${chefUsername}` : null;
  }
}

/** The open report with this id, or null. */
async function openReport(db: PrismaClient, reportId: string) {
  return db.contentReport.findFirst({
    where: { id: reportId, status: "open" },
    select: { id: true, targetType: true, targetId: true, targetChefId: true },
  });
}

/**
 * Removes the reported recipe, cookbook or cook log as its chef would delete it, then closes the
 * report as actioned. A chef report has no content to remove; eject the chef instead. Returns
 * false when the report is not open or its content is already gone.
 */
export async function removeReportedContent(db: PrismaClient, d1: D1ReadDatabase | null, reportId: string): Promise<boolean> {
  const report = await openReport(db, reportId);
  if (!report || !report.targetChefId) return false;
  const chefId = report.targetChefId;
  switch (report.targetType as ReportTargetType) {
    case "recipe": {
      const result = await deleteNativeRecipe(db, chefId, report.targetId, d1);
      if (!result.ok) return false;
      break;
    }
    case "cookbook": {
      const cookbook = await db.cookbook.findUnique({ where: { id: report.targetId }, select: { title: true } });
      if (!cookbook) return false;
      await deleteCookbookWithTombstone({
        database: db,
        nativeDatabase: asCompatibleCookbookD1Database(d1),
        accountId: chefId,
        cookbookId: report.targetId,
        title: cookbook.title,
      });
      break;
    }
    case "spoon": {
      const spoon = await db.recipeSpoon.findFirst({ where: { id: report.targetId, deletedAt: null }, select: { id: true } });
      if (!spoon) return false;
      await deleteSpoon(db, report.targetId, chefId);
      break;
    }
    case "chef":
      return false;
  }
  return resolveReport(db, reportId, "actioned");
}

/**
 * Ejects the reported chef: deletes their account the way account deletion does, which closes
 * every report about them. Returns false when the report is not open or names no chef.
 */
export async function ejectReportedChef(d1: D1ReadDatabase, db: PrismaClient, reportId: string, moderatorId: string): Promise<boolean> {
  const report = await openReport(db, reportId);
  if (!report || !report.targetChefId || report.targetChefId === moderatorId) return false;
  await db.contentReport.updateMany({
    where: { targetChefId: report.targetChefId, status: "open" },
    data: { status: "actioned", resolvedAt: new Date() },
  });
  await deleteAccount(d1, report.targetChefId);
  return true;
}
