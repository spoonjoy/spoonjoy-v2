import type { Route } from "./+types/photos.$";
import { getCloudflareEnv } from "~/lib/route-platform.server";

/**
 * Resource route to serve photos from Cloudflare R2 storage.
 * Matches URLs like /photos/profiles/userId/timestamp-randomId.jpg
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const key = params["*"];

  if (!key) {
    throw new Response("Not Found", { status: 404 });
  }

  const r2Bucket = getCloudflareEnv(context)?.PHOTOS;

  if (!r2Bucket) {
    // In local dev without R2, return 404
    throw new Response("Photo storage not available", { status: 503 });
  }

  const object = await r2Bucket.get(key);

  if (!object) {
    throw new Response("Photo not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
}
