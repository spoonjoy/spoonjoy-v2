import { data, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/moderation";
import { Button } from "~/components/ouro/button/button";
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";
import { Empty } from "~/components/ouro/empty/empty";
import { Link } from "~/components/ouro/link/link";
import { LocalDate } from "~/components/ouro/local-date/local-date";
import { Text } from "~/components/ouro/text/text";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { requestD1 } from "~/lib/d1-read.server";
import {
  REPORT_REASON_LABELS,
  ModerationError,
  blockChef,
  createContentReport,
  ejectReportedChef,
  isModerator,
  listOpenReports,
  notifyModerators,
  removeReportedContent,
  reportTargetHref,
  resolveReport,
  unblockChef,
  type ModerationEnv,
} from "~/lib/moderation.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";

// Reports and blocks post here from the recipe, chef and settings pages. Moderators (the
// SPOONJOY_MODERATOR_USERNAMES chefs) also read the open reports here and act on each one; to
// anyone else the page does not exist.

export function meta({}: Route.MetaArgs) {
  return [{ title: "Moderation - Spoonjoy" }, { name: "robots", content: "noindex" }];
}

async function currentChef(request: Request, context: Route.LoaderArgs["context"]) {
  const env = context.cloudflare?.env as ModerationEnv | undefined;
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const db = await getRequestDb(context);
  const user = await db.user.findUnique({ where: { id: userId }, select: { username: true } });
  return { env, userId, db, username: user?.username ?? "", moderator: isModerator(env, user?.username) };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, moderator } = await currentChef(request, context);
  if (!moderator) throw new Response("Not Found", { status: 404 });
  const reports = await listOpenReports(db);
  return {
    reports: reports.map((report) => ({
      id: report.id,
      targetType: report.targetType,
      reason: REPORT_REASON_LABELS[report.reason],
      details: report.details,
      createdAt: report.createdAt.toISOString(),
      reporter: report.reporter.username,
      chef: report.targetChef?.username ?? null,
      href: reportTargetHref(report.targetType, report.targetId, report.targetChef?.username ?? null),
    })),
  };
}

export type ModerationActionData =
  | { intent: string; success: true }
  | { intent: string; success: false; error: string };

export async function action({ request, context }: Route.ActionArgs) {
  const { env, userId, db, username, moderator } = await currentChef(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const fail = (error: string, status: number) => data<ModerationActionData>({ intent, success: false, error }, { status });
  try {
    switch (intent) {
      case "report": {
        const report = await createContentReport(db, {
          reporterId: userId,
          targetType: form.get("targetType"),
          targetId: form.get("targetId"),
          reason: form.get("reason"),
          details: form.get("details") ?? undefined,
        });
        const notified = notifyModerators(db, env, report, username);
        const ctx = context.cloudflare?.ctx;
        if (ctx?.waitUntil) ctx.waitUntil(notified);
        else await notified;
        return { intent, success: true } satisfies ModerationActionData;
      }
      case "block":
        await blockChef(db, userId, form.get("chefId"));
        return { intent, success: true } satisfies ModerationActionData;
      case "unblock":
        await unblockChef(db, userId, String(form.get("chefId") ?? ""));
        return { intent, success: true } satisfies ModerationActionData;
      case "dismiss":
      case "remove":
      case "eject": {
        if (!moderator) return fail("Not Found", 404);
        const reportId = String(form.get("reportId") ?? "");
        const d1 = requestD1(context);
        const done = intent === "dismiss"
          ? await resolveReport(db, reportId, "dismissed")
          : intent === "remove"
            ? await removeReportedContent(db, d1, reportId)
            : d1 ? await ejectReportedChef(d1, db, reportId, userId) : false;
        return done
          ? ({ intent, success: true } satisfies ModerationActionData)
          : fail("That report is closed, or its content is already gone.", 409);
      }
      default:
        return fail("Unknown action", 400);
    }
  } catch (error) {
    if (error instanceof ModerationError) return fail(error.message, error.code === "not_found" ? 404 : 400);
    throw error;
  }
}

type QueueItem = Awaited<ReturnType<typeof loader>>["reports"][number];

function ReportRow({ report }: { report: QueueItem }) {
  const fetcher = useFetcher<ModerationActionData>();
  const busy = fetcher.state !== "idle";
  const failure = fetcher.data && !fetcher.data.success ? fetcher.data.error : null;
  const act = (intent: string) => fetcher.submit({ intent, reportId: report.id }, { method: "post" });
  return (
    <article className="py-5" aria-label={`Report about ${report.chef ? `@${report.chef}` : "deleted content"}`}>
      <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-brass)]">
        {report.reason} · {report.targetType}
      </p>
      <Text className="mt-1">
        @{report.reporter} reported{" "}
        {report.href ? <Link href={report.href}>{report.chef ? `@${report.chef}'s ${report.targetType}` : report.targetType}</Link> : report.targetType}
        {" "}on <LocalDate value={report.createdAt} />.
      </Text>
      {report.details ? <Text tone="muted" className="mt-1">“{report.details}”</Text> : null}
      {failure ? <Text role="alert" tone="destructive" size="sm" className="mt-2">{failure}</Text> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {report.targetType !== "chef" ? (
          <Button type="button" tone="destructive" disabled={busy} onClick={() => act("remove")}>Remove content</Button>
        ) : null}
        {report.chef ? (
          <ConfirmDialog
            trigger={<Button type="button" variant="outline" tone="destructive" disabled={busy}>Eject @{report.chef}</Button>}
            title={`Eject @${report.chef}?`}
            description="Their account and everything in it is deleted, and every open report about them closes. You can't undo this."
            confirmLabel="Eject"
            tone="destructive"
            onConfirm={() => act("eject")}
          />
        ) : null}
        <Button type="button" variant="outline" tone="secondary" disabled={busy} onClick={() => act("dismiss")}>Dismiss</Button>
      </div>
    </article>
  );
}

export default function Moderation() {
  const { reports } = useLoaderData<typeof loader>();
  return (
    <CookbookPage>
      <PageHeader
        eyebrow="Moderation"
        title="Open reports"
        size="lg"
        divider
        description="Review each report within 24 hours. Remove content that breaks the terms, and eject chefs who post it."
      />
      {reports.length > 0 ? (
        <div className="mt-6 divide-y divide-[var(--sj-border)]">
          {reports.map((report) => <ReportRow key={report.id} report={report} />)}
        </div>
      ) : (
        <Empty headingLevel={2} align="start" title="No open reports" description="New reports land here and by email." />
      )}
    </CookbookPage>
  );
}
