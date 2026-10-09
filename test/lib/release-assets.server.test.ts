// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { RELEASE_ASSET_PREFIX, serveReleaseAssetFallback } from "../../app/lib/release-assets.server";

function bucket(objects: Record<string, string>) {
  return {
    get: vi.fn(async (key: string) => (key in objects ? { body: objects[key] } : null)),
  } as unknown as Pick<R2Bucket, "get"> & { get: ReturnType<typeof vi.fn> };
}

describe("serveReleaseAssetFallback", () => {
  it("serves an archived hashed asset as immutable, with a type from its extension", async () => {
    const archive = bucket({ [`${RELEASE_ASSET_PREFIX}root-AbC_12.css`]: "body{}" });
    const response = await serveReleaseAssetFallback(new Request("https://spoonjoy.app/assets/root-AbC_12.css"), archive);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("body{}");
    expect(response?.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(archive.get).toHaveBeenCalledWith("release-assets/root-AbC_12.css");
  });

  it("answers HEAD without a body", async () => {
    const archive = bucket({ [`${RELEASE_ASSET_PREFIX}font-x1.woff2`]: "bytes" });
    const response = await serveReleaseAssetFallback(
      new Request("https://spoonjoy.app/assets/font-x1.woff2", { method: "HEAD" }),
      archive,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe("font/woff2");
    expect(response?.body).toBeNull();
  });

  it("returns null when the archive does not hold the asset", async () => {
    await expect(serveReleaseAssetFallback(new Request("https://spoonjoy.app/assets/gone-Q1.js"), bucket({})))
      .resolves.toBeNull();
  });

  it.each([
    ["no bucket binding", "https://spoonjoy.app/assets/a-1.js", "GET", false],
    ["a write method", "https://spoonjoy.app/assets/a-1.js", "POST", true],
    ["a non-asset path", "https://spoonjoy.app/photos/a-1.js", "GET", true],
    ["a nested path", "https://spoonjoy.app/assets/x/a-1.js", "GET", true],
    ["an unknown extension", "https://spoonjoy.app/assets/a-1.html", "GET", true],
    ["a dotted traversal name", "https://spoonjoy.app/assets/a..b.js", "GET", true],
    ["a hidden-file name", "https://spoonjoy.app/assets/.env.js", "GET", true],
  ])("never touches the archive for %s", async (_label, url, method, withBucket) => {
    const archive = bucket({ "release-assets/a-1.js": "x", "release-assets/a..b.js": "x" });
    const response = await serveReleaseAssetFallback(new Request(url, { method }), withBucket ? archive : undefined);
    expect(response).toBeNull();
    expect(archive.get).not.toHaveBeenCalled();
  });
});
