import type { Route } from "./+types/photos.$";
import { defaultPhotoCache, deliverPhoto } from "~/lib/photo-delivery.server";
import { isServablePhotoKey } from "~/lib/photo-lifecycle.server";
import { getCloudflareEnv } from "~/lib/route-platform.server";

/**
 * Resource route to serve photos from Cloudflare R2 storage.
 * Matches URLs like /photos/profiles/userId/timestamp-randomId.jpg, optionally with `?w=<width>`
 * for a size variant. In the deployed Worker, `workers/app.ts` answers these before React Router;
 * this route covers the same URLs wherever that fast path does not run.
 */
export async function loader({ params, context, request }: Route.LoaderArgs) {
  const key = params["*"];

  // Quarantined photos (moved there by the photo sweep) are never served.
  if (!key || !isServablePhotoKey(key)) {
    throw new Response("Not Found", { status: 404 });
  }

  const r2Bucket = getCloudflareEnv(context)?.PHOTOS;

  if (!r2Bucket) {
    // In local dev without R2, return 404
    throw new Response("Photo storage not available", { status: 503 });
  }

  const response = await deliverPhoto({
    request,
    key,
    bucket: r2Bucket,
    cache: defaultPhotoCache(),
    waitUntil: context.cloudflare?.ctx?.waitUntil?.bind(context.cloudflare.ctx),
  });

  if (response.status === 404) {
    throw new Response("Photo not found", { status: 404 });
  }

  return response;
}
