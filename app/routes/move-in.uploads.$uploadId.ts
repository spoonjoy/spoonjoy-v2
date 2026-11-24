// Finishes a backup's upload in parts (POST), which checks the backup and starts its move-in, or
// stops it (DELETE). A finish sent again answers with the same move-in. See app/lib/move-in-upload.ts.
import type { Route } from "./+types/move-in.uploads.$uploadId";
import { abortBackupUpload, finishBackupUpload } from "~/domains/move-in";
import { jsonBody, startQueuedMoveIn, uploadAnswer, uploadEndpoint, uploadRefused } from "~/lib/move-in-route.server";

export function loader() {
  return new Response(null, { status: 405, headers: { Allow: "POST, DELETE", "Cache-Control": "no-store" } });
}

export async function action({ request, params, context }: Route.ActionArgs) {
  return uploadEndpoint({ request, context }, ["POST", "DELETE"], async (gate) => {
    const { userId: ownerId, env } = gate;
    const uploadId = params.uploadId;
    if (request.method === "DELETE") {
      const aborted = await abortBackupUpload({ env, ownerId, uploadId });
      return aborted.ok ? uploadAnswer({ ok: true }) : uploadRefused(aborted);
    }
    const app = (await jsonBody(request))?.app;
    if (typeof app !== "string") return uploadAnswer({ error: "Send the backup's app as JSON." }, 400);
    const finished = await finishBackupUpload({ env, ownerId, uploadId, app, now: new Date() });
    if (!finished.ok) return uploadRefused(finished);
    if (finished.started) await startQueuedMoveIn(context, gate, finished.jobId);
    return uploadAnswer({ jobId: finished.jobId });
  });
}
