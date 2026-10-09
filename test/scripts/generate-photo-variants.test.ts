import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createR2Client,
  defaultDeps,
  generateVariants,
  isCliEntry,
  main,
  parseArgs,
  PHOTO_URLS_SQL,
  photoKeysFromRows,
  readPhotoKeys,
  renderVariants,
  runCliIfEntry,
  VARIANT_CONTENT_TYPE,
  VARIANT_WIDTHS,
  variantKey,
} from "../../scripts/generate-photo-variants.mjs";

async function png(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } }).png().toBuffer();
}

function silentIo() {
  return { log: vi.fn(), error: vi.fn() };
}

/** An in-memory R2 with the client's interface. */
function memoryR2(objects: Record<string, Buffer> = {}) {
  const store = new Map(Object.entries(objects));
  const writes: string[] = [];
  return {
    store,
    writes,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    exists: vi.fn(async (key: string) => store.has(key)),
    put: vi.fn(async (key: string, body: Buffer) => {
      writes.push(key);
      store.set(key, body);
    }),
  };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("parseArgs", () => {
  it("reads the target, --apply and --limit", () => {
    expect(parseArgs(["--target-env", "qa"])).toEqual({ targetEnv: "qa", apply: false, limit: Infinity });
    expect(parseArgs(["--target-env", "production", "--apply", "--limit", "5"])).toEqual({
      targetEnv: "production",
      apply: true,
      limit: 5,
    });
  });

  it("rejects unknown targets and bad limits", () => {
    expect(() => parseArgs([])).toThrow("--target-env must be qa or production.");
    expect(() => parseArgs(["--target-env", "local"])).toThrow("--target-env must be qa or production.");
    expect(() => parseArgs(["--target-env", "toString"])).toThrow("--target-env must be qa or production.");
    for (const limit of ["0", "-1", "1.5", "many"]) {
      expect(() => parseArgs(["--target-env", "qa", "--limit", limit])).toThrow("--limit must be a positive whole number.");
    }
  });
});

describe("photoKeysFromRows", () => {
  it("keeps each stored photo once, sorted, without variants, query strings or other URLs", () => {
    expect(
      photoKeysFromRows([
        { url: "/photos/covers/b.jpg" },
        { url: "/photos/covers/a.png?v=1" },
        { url: "/photos/covers/b.jpg" },
        { url: "/photos/variants/w256/covers/a.png.webp" },
        { url: "https://images.example.com/x.jpg" },
        { url: "/photos/" },
        { url: null },
        null,
      ]),
    ).toEqual(["covers/a.png", "covers/b.jpg"]);
  });
});

describe("readPhotoKeys", () => {
  it("queries the target's D1 through wrangler and reads every statement's rows", () => {
    const execFile = vi.fn(() => JSON.stringify([{ results: [{ url: "/photos/covers/a.jpg" }] }, {}]));

    expect(readPhotoKeys({ targetEnv: "qa", execFile })).toEqual(["covers/a.jpg"]);
    expect(execFile).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", "qa", "--json", "--command", PHOTO_URLS_SQL],
      expect.objectContaining({ encoding: "utf8" }),
    );

    readPhotoKeys({ targetEnv: "production", execFile });
    expect(execFile.mock.calls[1][1]).toEqual(["exec", "wrangler", "d1", "execute", "DB", "--remote", "--json", "--command", PHOTO_URLS_SQL]);
  });
});

describe("createR2Client", () => {
  const base = "https://api.cloudflare.com/client/v4/accounts/acct/r2/buckets/bucket/objects/";

  it("requires an account and a token", () => {
    expect(() => createR2Client({ accountId: "", token: "t", bucket: "b" })).toThrow("CLOUDFLARE_ACCOUNT_ID and an R2 API token are required.");
    expect(() => createR2Client({ accountId: "a", token: undefined, bucket: "b" })).toThrow("CLOUDFLARE_ACCOUNT_ID and an R2 API token are required.");
  });

  it("reads objects, and reports missing ones and errors", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("missing.jpg")) return new Response(null, { status: 404 });
      if (url.endsWith("broken.jpg")) return new Response(null, { status: 500 });
      return new Response("bytes");
    });
    const r2 = createR2Client({ accountId: "acct", token: "secret", bucket: "bucket", fetchImpl });

    expect((await r2.get("covers/a b.jpg"))?.toString()).toBe("bytes");
    expect(fetchImpl).toHaveBeenCalledWith(`${base}covers/a%20b.jpg`, { headers: { Authorization: "Bearer secret" } });
    expect(await r2.get("missing.jpg")).toBeNull();
    await expect(r2.get("broken.jpg")).rejects.toThrow("R2 GET broken.jpg failed with HTTP 500.");

    expect(await r2.exists("covers/a.jpg")).toBe(true);
    expect(await r2.exists("missing.jpg")).toBe(false);
    await expect(r2.exists("broken.jpg")).rejects.toThrow("R2 GET broken.jpg failed with HTTP 500.");
  });

  it("writes only variants", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const r2 = createR2Client({ accountId: "acct", token: "secret", bucket: "bucket", fetchImpl });
    const body = Buffer.from("webp");

    await r2.put("variants/w256/covers/a.jpg.webp", body, VARIANT_CONTENT_TYPE);
    expect(fetchImpl).toHaveBeenCalledWith(`${base}variants/w256/covers/a.jpg.webp`, {
      method: "PUT",
      headers: { Authorization: "Bearer secret", "Content-Type": "image/webp" },
      body,
    });

    await expect(r2.put("covers/a.jpg", body, VARIANT_CONTENT_TYPE)).rejects.toThrow(
      "Refusing to write covers/a.jpg: only variants/ keys may be written.",
    );
    await expect(r2.put("", body, VARIANT_CONTENT_TYPE)).rejects.toThrow("only variants/ keys may be written.");

    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(r2.put("variants/w512/covers/a.jpg.webp", body, VARIANT_CONTENT_TYPE)).rejects.toThrow(
      "R2 PUT variants/w512/covers/a.jpg.webp failed with HTTP 403.",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("renderVariants", () => {
  it("renders WebP variants largest first at each width", async () => {
    const variants = await renderVariants(await png(2000, 1000), { sharp });

    expect(variants.map((variant) => variant.width)).toEqual([...VARIANT_WIDTHS].reverse());
    for (const variant of variants) {
      const metadata = await sharp(variant.body).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(variant.width);
      expect(metadata.height).toBe(variant.width / 2);
    }
  });

  it("never enlarges a small photo", async () => {
    const variants = await renderVariants(await png(300, 200), { sharp });
    const widths = await Promise.all(variants.map(async (variant) => (await sharp(variant.body).metadata()).width));
    expect(widths).toEqual([300, 300, 300, 256]);
  });
});

describe("generateVariants", () => {
  it("only reports missing photos without --apply", async () => {
    const r2 = memoryR2({ [variantKey("done.jpg", 256)]: Buffer.from("x") });
    const io = silentIo();

    const summary = await generateVariants({ keys: ["done.jpg", "todo.jpg"], r2, sharp: null, apply: false, limit: Infinity, io });

    expect(summary).toMatchObject({ checked: 2, missing: 1, generated: 0 });
    expect(io.log).toHaveBeenCalledWith("missing todo.jpg");
    expect(r2.put).not.toHaveBeenCalled();
  });

  it("writes every variant of a missing photo, the smallest last, and never the original", async () => {
    const original = await png(1200, 800);
    const r2 = memoryR2({ "covers/a.png": original });
    const io = silentIo();

    const summary = await generateVariants({ keys: ["covers/a.png"], r2, sharp, apply: true, limit: Infinity, io });

    expect(r2.writes).toEqual([1536, 1024, 512, 256].map((width) => variantKey("covers/a.png", width)));
    expect(r2.store.get("covers/a.png")).toBe(original);
    expect(summary).toMatchObject({ checked: 1, missing: 1, generated: 1, failed: 0, unsupported: 0, originalBytes: original.length });
    expect(summary.variantBytes).toBeGreaterThan(0);
    expect(io.log).toHaveBeenCalledWith(expect.stringMatching(/^generated covers\/a\.png original=\d+ w1536=\d+ w1024=\d+ w512=\d+ w256=\d+$/));
  });

  it("reports a missing original and a failed write, and carries on", async () => {
    const r2 = memoryR2({ "covers/b.png": await png(64, 64) });
    r2.put.mockRejectedValueOnce(new Error("R2 PUT failed"));
    const io = silentIo();

    const summary = await generateVariants({ keys: ["covers/a.png", "covers/b.png"], r2, sharp, apply: true, limit: Infinity, io });

    expect(summary).toMatchObject({ failed: 2, generated: 0 });
    expect(io.error).toHaveBeenCalledWith("failed covers/a.png: the original is not in R2");
    expect(io.error).toHaveBeenCalledWith("failed covers/b.png: R2 PUT failed");
  });

  it("counts an image it cannot decode as unsupported, not failed", async () => {
    const r2 = memoryR2({ "covers/a.heic": Buffer.from("not an image") });
    const io = silentIo();
    const brokenSharp = () => {
      throw "unsupported image format";
    };

    const summary = await generateVariants({ keys: ["covers/a.heic"], r2, sharp: brokenSharp, apply: true, limit: Infinity, io });

    expect(summary).toMatchObject({ unsupported: 1, failed: 0 });
    expect(io.log).toHaveBeenCalledWith("unsupported covers/a.heic: unsupported image format");
    expect(r2.put).not.toHaveBeenCalled();
  });

  it("treats an undecodable image as unsupported with sharp's message", async () => {
    const r2 = memoryR2({ "covers/a.png": Buffer.from("not an image") });
    const io = silentIo();

    const summary = await generateVariants({ keys: ["covers/a.png"], r2, sharp, apply: true, limit: Infinity, io });

    expect(summary).toMatchObject({ unsupported: 1, failed: 0 });
    expect(io.log).toHaveBeenCalledWith(expect.stringMatching(/^unsupported covers\/a\.png: .+/));
  });

  it("reports non-Error failures by their text", async () => {
    const r2 = memoryR2();
    r2.get.mockRejectedValueOnce("network down");
    const io = silentIo();

    await generateVariants({ keys: ["covers/a.png"], r2, sharp, apply: true, limit: Infinity, io });

    expect(io.error).toHaveBeenCalledWith("failed covers/a.png: network down");
  });

  it("stops after --limit photos have been processed", async () => {
    const r2 = memoryR2({ "a.png": await png(32, 32), "b.png": await png(32, 32) });

    const summary = await generateVariants({ keys: ["a.png", "b.png"], r2, sharp, apply: true, limit: 1, io: silentIo() });

    expect(summary).toMatchObject({ checked: 1, generated: 1 });
  });
});

describe("main", () => {
  const d1 = () => JSON.stringify([{ results: [{ url: "/photos/covers/a.png" }] }]);

  it("reads the command line and the real dependencies by default", async () => {
    const deps = defaultDeps();
    expect(deps.env).toBe(process.env);
    expect(deps.fetchImpl).toBe(fetch);
    expect(deps.io).toBe(console);
    expect(typeof deps.execFile).toBe("function");
    expect(await deps.loadSharp()).toBe(sharp);
    // The test runner's own arguments name no target, so the defaults stop at argument parsing.
    await expect(main()).rejects.toThrow("--target-env must be qa or production.");
  });

  it("reports a dry run against the target bucket with the R2 token", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const io = silentIo();

    const summary = await main(["--target-env", "production"], {
      env: { CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "d1-token", CLOUDFLARE_R2_API_TOKEN: "r2-token" },
      execFile: d1,
      fetchImpl,
      io,
    });

    expect(summary).toMatchObject({ missing: 1 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acct/r2/buckets/spoonjoy-photos/objects/variants/w256/covers/a.png.webp",
      { headers: { Authorization: "Bearer r2-token" } },
    );
    expect(io.log).toHaveBeenCalledWith("1 stored photos referenced in production D1.");
  });

  it("generates with the default sharp and falls back to CLOUDFLARE_API_TOKEN for R2", async () => {
    const original = await png(40, 40);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return new Response(null, { status: 200 });
      if (url.includes("/variants/")) return new Response(null, { status: 404 });
      return new Response(original);
    });

    const summary = await main(["--target-env", "qa", "--apply"], {
      env: { CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "qa-token" },
      execFile: d1,
      fetchImpl,
      io: silentIo(),
    });

    expect(summary).toMatchObject({ generated: 1 });
    expect(fetchImpl.mock.calls[0][0]).toContain("/r2/buckets/spoonjoy-photos-qa/objects/");
    expect(fetchImpl.mock.calls[0][1]).toEqual({ headers: { Authorization: "Bearer qa-token" } });
  });

  it("fails the run when a photo could not get variants", async () => {
    const fetchImpl = vi.fn(async (url: string) => new Response(null, { status: url.includes("/variants/") ? 404 : 500 }));

    await expect(
      main(["--target-env", "qa", "--apply"], {
        env: { CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "qa-token" },
        execFile: d1,
        fetchImpl,
        loadSharp: async () => sharp,
        io: silentIo(),
      }),
    ).rejects.toThrow("1 photo(s) could not get variants; see the lines above.");
  });
});

describe("CLI entry", () => {
  it("recognises being run directly", () => {
    expect(isCliEntry(pathToFileURL("/repo/scripts/x.mjs").href, "/repo/scripts/x.mjs")).toBe(true);
    expect(isCliEntry(pathToFileURL("/repo/scripts/x.mjs").href, "/repo/other.mjs")).toBe(false);
    expect(isCliEntry(pathToFileURL("/repo/scripts/x.mjs").href, undefined)).toBe(false);
  });

  it("runs main only as the entry point and turns its failure into an exit code", async () => {
    const runMain = vi.fn(async () => undefined);
    expect(await runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/b.mjs", runMain })).toBe(false);
    expect(runMain).not.toHaveBeenCalled();

    expect(await runCliIfEntry({ moduleUrl: pathToFileURL("/a.mjs").href, argv1: "/a.mjs", runMain })).toBe(true);
    expect(runMain).toHaveBeenCalledTimes(1);

    const io = silentIo();
    await runCliIfEntry({
      moduleUrl: pathToFileURL("/a.mjs").href,
      argv1: "/a.mjs",
      runMain: async () => {
        throw new Error("boom");
      },
      io,
    });
    expect(io.error).toHaveBeenCalledWith("boom");
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    await runCliIfEntry({
      moduleUrl: pathToFileURL("/a.mjs").href,
      argv1: "/a.mjs",
      runMain: async () => {
        throw "plain";
      },
      io,
    });
    expect(io.error).toHaveBeenCalledWith("plain");
  });
});
