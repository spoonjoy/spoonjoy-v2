import type { Route } from "./+types/account.export";
import { accountExportFileName, buildAccountExport } from "~/lib/account-export.server";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";

// "Download my data" in account settings: the same export as GET /api/v1/me/export, as a file.
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = getCloudflareEnv(context);
  const userId = await requireUserId(request, "/login", env);
  const db = await getRequestDb(context);
  const now = new Date();
  const origin = new URL(env?.SPOONJOY_BASE_URL || "https://spoonjoy.app").origin;
  const exported = await buildAccountExport(db, userId, origin, now);
  /* istanbul ignore if -- @preserve requireUserId found the account; this keeps the read honest if it disappears mid-request. */
  if (!exported) throw new Response("Account not found", { status: 404 });
  return new Response(`${JSON.stringify(exported, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${accountExportFileName(exported.account.username, now)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
