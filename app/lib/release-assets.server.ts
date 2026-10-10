// Serves fingerprinted /assets/ files from earlier releases.
//
// Each release uploads only its own build, so after a deploy any tab still running the previous
// build 404s when it lazy-loads a route chunk, and React Router answers that by reloading the
// page. The release pipeline copies every hashed asset into R2 under RELEASE_ASSET_PREFIX before
// the version can serve traffic; static assets serve the current build first, and only a miss
// reaches the Worker and this lookup.

export const RELEASE_ASSET_PREFIX = "release-assets/";

// Vite output names: a base name, a content hash and a known extension, no directories.
const HASHED_ASSET_PATH = /^\/assets\/([A-Za-z0-9_-][A-Za-z0-9._-]*\.(js|css|woff2|svg|png|webp|json|map))$/;

const CONTENT_TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  woff2: "font/woff2",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  json: "application/json",
  map: "application/json",
};

type AssetBucket = Pick<R2Bucket, "get">;

export async function serveReleaseAssetFallback(
  request: Request,
  bucket: AssetBucket | undefined,
): Promise<Response | null> {
  if (!bucket || (request.method !== "GET" && request.method !== "HEAD")) return null;
  const match = new URL(request.url).pathname.match(HASHED_ASSET_PATH);
  if (!match || match[1].includes("..")) return null;
  const object = await bucket.get(`${RELEASE_ASSET_PREFIX}${match[1]}`);
  if (!object) return null;
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[match[2]],
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Spoonjoy-Asset-Source": "release-archive",
    },
  });
}
