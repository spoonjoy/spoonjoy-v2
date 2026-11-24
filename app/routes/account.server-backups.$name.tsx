import type { Route } from "./+types/account.server-backups.$name";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { isServerAdmin } from "~/lib/server-access.server";
import { serverBackups } from "~/lib/self-host-backups.server";

// A self-hosted server's backup file, for its admin to download from Server settings. To anyone
// else, and on spoonjoy.app, there's nothing here.
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare?.env;
  const userId = await requireUserId(request, "/login", env);
  const db = await getRequestDb(context);
  const host = serverBackups(env);
  if (!host || !(await isServerAdmin(db, env, userId))) throw new Response("Not Found", { status: 404 });
  const file = await host.download(params.name);
  if (!file.ok) throw new Response("Not Found", { status: 404 });
  return new Response(file.body, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": file.headers.get("Content-Disposition") ?? "attachment",
      "Cache-Control": "private, no-store",
    },
  });
}
