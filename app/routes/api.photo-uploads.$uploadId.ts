import type { Route } from "./+types/api.photo-uploads.$uploadId";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { photoUploadSigningSecret, receivePhotoUpload } from "~/lib/photo-upload-link.server";
import { enforceRateLimit, rateLimitedResponse } from "~/lib/rate-limit.server";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";

// The PUT end of a photo upload link (app/lib/photo-upload-link.server.ts). It takes no
// Authorization header: the link's signature and its single-use row are what let a photo in.
const HEADERS = { "Cache-Control": "no-store", Allow: "PUT" };

function answer(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: HEADERS });
}

export async function loader() {
  return answer(405, { error: { code: "method_not_allowed", message: "PUT the photo's bytes to this link." } });
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "PUT") return loader();
  const env = getCloudflareEnv(context);

  const rateLimit = await enforceRateLimit({
    authorization: null,
    ip: request.headers.get("CF-Connecting-IP"),
    ipLimiter: env?.API_IP_RATE_LIMITER,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit.retryAfterSeconds);

  try {
    const result = await receivePhotoUpload(await getRequestDb(context), {
      request,
      uploadId: params.uploadId,
      secret: photoUploadSigningSecret(env),
      bucket: env?.PHOTOS,
    });
    return answer(result.status, result.body);
  } catch (error) {
    const waitUntil = context.cloudflare?.ctx?.waitUntil?.bind(context.cloudflare.ctx);
    const capture = captureException(resolvePostHogServerConfig(env ?? {}), {
      error,
      distinctId: "anon",
      route: "/api/photo-uploads/{uploadId}",
      method: "PUT",
    }).catch(() => undefined);
    if (waitUntil) waitUntil(capture);
    return answer(500, { error: { code: "upload_failed", message: "The photo couldn't be stored. Try the same link again." } });
  }
}
