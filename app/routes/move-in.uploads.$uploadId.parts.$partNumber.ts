// Takes one part of a backup's upload (PUT, the part's bytes as the body) and streams it to storage
// without holding it. A part sent again replaces the first. See app/lib/move-in-upload.ts.
import type { Route } from "./+types/move-in.uploads.$uploadId.parts.$partNumber";
import { putBackupPart } from "~/domains/move-in";
import { uploadAnswer, uploadEndpoint, uploadRefused } from "~/lib/move-in-route.server";

export function loader() {
  return new Response(null, { status: 405, headers: { Allow: "PUT", "Cache-Control": "no-store" } });
}

export async function action({ request, params, context }: Route.ActionArgs) {
  return uploadEndpoint({ request, context }, ["PUT"], async ({ userId, env }) => {
    const partNumber = /^\d{1,5}$/.test(params.partNumber) ? Number(params.partNumber) : 0;
    const length = request.headers.get("Content-Length");
    const put = await putBackupPart({
      env,
      ownerId: userId,
      uploadId: params.uploadId,
      partNumber,
      contentLength: length !== null && /^\d+$/.test(length) ? Number(length) : null,
      body: request.body,
    });
    return put.ok ? uploadAnswer({ partNumber: put.partNumber }) : uploadRefused(put);
  });
}
