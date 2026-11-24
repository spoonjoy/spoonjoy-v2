// Begins sending a backup to storage in parts, or picks up the unfinished upload of the same file:
// the Move in page's script posts the file's name, size and the SHA-256 of its first MiB, and gets back the upload's
// id, its part size and the parts that have already arrived. See app/lib/move-in-upload.ts.
import type { Route } from "./+types/move-in.uploads";
import { beginBackupUpload, isFileHead } from "~/domains/move-in";
import { jsonBody, uploadAnswer, uploadEndpoint, uploadRefused } from "~/lib/move-in-route.server";

const MAX_NAME = 255;

export function loader() {
  return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}

export async function action({ request, context }: Route.ActionArgs) {
  return uploadEndpoint({ request, context }, ["POST"], async ({ userId, env }) => {
    const body = await jsonBody(request);
    const { app, name, size, head, resume, fresh } = body ?? {};
    if (
      typeof app !== "string" ||
      typeof name !== "string" ||
      !name ||
      typeof size !== "number" ||
      !isFileHead(head) ||
      (resume !== undefined && resume !== null && typeof resume !== "string") ||
      (fresh !== undefined && typeof fresh !== "boolean")
    ) {
      return uploadAnswer({ error: "Send the backup's app, name, size and head as JSON." }, 400);
    }
    const begun = await beginBackupUpload({ env, ownerId: userId, app, name: name.slice(0, MAX_NAME), size, head, resume, fresh, now: new Date() });
    if (!begun.ok) return uploadRefused(begun);
    const { ok: _ok, ...plan } = begun;
    return uploadAnswer(plan);
  });
}
