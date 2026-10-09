#!/usr/bin/env node
// Generates the WebP size variants of every stored photo that D1 references and that does not
// have them yet. Variants are new R2 objects under `variants/w<width>/<key>.webp`; originals are
// only read, never written or deleted. The Worker serves a variant for `/photos/<key>?w=<width>`
// and falls back to the original until the variant exists (app/lib/photo-delivery.server.ts).
//
//   node scripts/generate-photo-variants.mjs --target-env qa|production [--apply] [--limit N]
//
// Without --apply it only reports which photos lack variants. D1 is read through wrangler
// (CLOUDFLARE_API_TOKEN); R2 objects are read and written through the Cloudflare R2 REST API with
// CLOUDFLARE_R2_API_TOKEN, falling back to CLOUDFLARE_API_TOKEN.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { arg, PRODUCTION_R2_BUCKET, QA_R2_BUCKET } from "./script-environment.mjs";

// Keep in step with app/lib/photo-variants.ts.
export const VARIANT_WIDTHS = [256, 512, 1024, 1536];
export const VARIANT_CONTENT_TYPE = "image/webp";
export const WEBP_QUALITY = 78;

const TARGETS = {
  qa: { bucket: QA_R2_BUCKET, d1Args: ["d1", "execute", "DB", "--remote", "--env", "qa"] },
  production: { bucket: PRODUCTION_R2_BUCKET, d1Args: ["d1", "execute", "DB", "--remote"] },
};

export const PHOTO_URLS_SQL = [
  "SELECT imageUrl AS url FROM RecipeCover WHERE imageUrl LIKE '/photos/%'",
  "SELECT stylizedImageUrl AS url FROM RecipeCover WHERE stylizedImageUrl LIKE '/photos/%'",
  "SELECT sourceImageUrl AS url FROM RecipeCover WHERE sourceImageUrl LIKE '/photos/%'",
  "SELECT photoUrl AS url FROM User WHERE photoUrl LIKE '/photos/%'",
  "SELECT photoUrl AS url FROM RecipeSpoon WHERE photoUrl LIKE '/photos/%'",
].join(" UNION ");

export function variantKey(originalKey, width) {
  return `variants/w${width}/${originalKey}.webp`;
}

export function parseArgs(argv) {
  const targetEnv = arg(argv, "--target-env");
  if (!Object.hasOwn(TARGETS, targetEnv ?? "")) {
    throw new Error("--target-env must be qa or production.");
  }
  const rawLimit = arg(argv, "--limit");
  const limit = rawLimit === undefined ? Infinity : Number(rawLimit);
  if (!(limit > 0) || (limit !== Infinity && !Number.isInteger(limit))) {
    throw new Error("--limit must be a positive whole number.");
  }
  return { targetEnv, apply: argv.includes("--apply"), limit };
}

/** The R2 key behind each `/photos/...` URL, without duplicates, variants or query strings. */
export function photoKeysFromRows(rows) {
  const keys = new Set();
  for (const row of rows) {
    const url = typeof row?.url === "string" ? row.url : "";
    const key = url.slice("/photos/".length).split(/[?#]/)[0];
    // Variants have no variants, and quarantined photos are never served, so neither gets any. A key
    // with an empty, "." or ".." segment could resolve outside its folder, so it is skipped.
    const unsafe = key.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
    if (url.startsWith("/photos/") && key && !unsafe && !key.startsWith("variants/") && !key.startsWith("quarantine/")) {
      keys.add(key);
    }
  }
  return [...keys].sort();
}

export function readPhotoKeys({ targetEnv, execFile }) {
  const output = execFile(
    "pnpm",
    ["exec", "wrangler", ...TARGETS[targetEnv].d1Args, "--json", "--command", PHOTO_URLS_SQL],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(output);
  return photoKeysFromRows(parsed.flatMap((statement) => statement.results ?? []));
}

function objectPath(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** Reads and writes R2 objects through the Cloudflare REST API. */
export function createR2Client({ accountId, token, bucket, fetchImpl = fetch }) {
  if (!accountId || !token) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and an R2 API token are required.");
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/`;
  const authorization = { Authorization: `Bearer ${token}` };
  return {
    async get(key) {
      const response = await fetchImpl(base + objectPath(key), { headers: authorization });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`R2 GET ${key} failed with HTTP ${response.status}.`);
      return Buffer.from(await response.arrayBuffer());
    },
    async exists(key) {
      const response = await fetchImpl(base + objectPath(key), { headers: authorization });
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`R2 GET ${key} failed with HTTP ${response.status}.`);
      await response.arrayBuffer();
      return true;
    },
    async put(key, body, contentType) {
      if (key === "" || !key.startsWith("variants/")) {
        // The generator only ever writes variants; an original is never overwritten.
        throw new Error(`Refusing to write ${key}: only variants/ keys may be written.`);
      }
      const response = await fetchImpl(base + objectPath(key), {
        method: "PUT",
        headers: { ...authorization, "Content-Type": contentType },
        body,
      });
      if (!response.ok) throw new Error(`R2 PUT ${key} failed with HTTP ${response.status}.`);
    },
  };
}

/** Every variant of one image, largest first, each at most `width` wide and never enlarged. */
export async function renderVariants(original, { sharp }) {
  const variants = [];
  for (const width of [...VARIANT_WIDTHS].reverse()) {
    const body = await sharp(original, { failOn: "none" })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    variants.push({ width, body });
  }
  return variants;
}

/**
 * Generates the missing variants. The smallest variant is written last, so its presence means the
 * photo is done; a photo whose read or write fails is reported and left for the next run.
 */
export async function generateVariants({ keys, r2, sharp, apply, limit, io }) {
  const summary = { checked: 0, missing: 0, generated: 0, unsupported: 0, missingOriginal: 0, failed: 0, originalBytes: 0, variantBytes: 0 };
  for (const key of keys) {
    if (summary.generated + summary.unsupported + summary.missingOriginal + summary.failed >= limit) break;
    summary.checked += 1;
    if (await r2.exists(variantKey(key, VARIANT_WIDTHS[0]))) continue;
    summary.missing += 1;
    if (!apply) {
      io.log(`missing ${key}`);
      continue;
    }
    try {
      const original = await r2.get(key);
      if (!original) {
        // A row that points at a photo no longer in R2 has nothing to make variants from. The next
        // run cannot fix that either, so it is reported without failing the run.
        summary.missingOriginal += 1;
        io.log(`missing-original ${key}: the original is not in R2`);
        continue;
      }
      let variants;
      try {
        variants = await renderVariants(original, { sharp });
      } catch (error) {
        // An image sharp cannot decode keeps being served as its original; that is not a failure
        // the next run could fix, so it does not fail the run.
        summary.unsupported += 1;
        io.log(`unsupported ${key}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      for (const variant of variants) {
        await r2.put(variantKey(key, variant.width), variant.body, VARIANT_CONTENT_TYPE);
      }
      summary.generated += 1;
      summary.originalBytes += original.length;
      summary.variantBytes += variants.reduce((total, variant) => total + variant.body.length, 0);
      const sizes = variants.map((variant) => `w${variant.width}=${variant.body.length}`).join(" ");
      io.log(`generated ${key} original=${original.length} ${sizes}`);
    } catch (error) {
      summary.failed += 1;
      io.error(`failed ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  io.log(`photo variants: ${JSON.stringify(summary)}`);
  return summary;
}

/** What main uses when run from the command line. */
export function defaultDeps() {
  return {
    env: process.env,
    execFile: execFileSync,
    fetchImpl: fetch,
    loadSharp: async () => (await import("sharp")).default,
    io: console,
  };
}

export async function main(argv = process.argv.slice(2), deps = defaultDeps()) {
  const { env, execFile, fetchImpl, loadSharp, io } = { ...defaultDeps(), ...deps };
  const options = parseArgs(argv);
  const keys = readPhotoKeys({ targetEnv: options.targetEnv, execFile });
  io.log(`${keys.length} stored photos referenced in ${options.targetEnv} D1.`);
  const r2 = createR2Client({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_R2_API_TOKEN || env.CLOUDFLARE_API_TOKEN,
    bucket: TARGETS[options.targetEnv].bucket,
    fetchImpl,
  });
  const sharp = options.apply ? await loadSharp() : null;
  const summary = await generateVariants({ keys, r2, sharp, apply: options.apply, limit: options.limit, io });
  if (summary.failed > 0) {
    throw new Error(`${summary.failed} photo(s) could not get variants; see the lines above.`);
  }
  return summary;
}

export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

export async function runCliIfEntry({
  moduleUrl = import.meta.url,
  argv1 = process.argv[1],
  runMain = main,
  io = console,
} = {}) {
  if (!isCliEntry(moduleUrl, argv1)) return false;
  try {
    await runMain();
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
  return true;
}

await runCliIfEntry();
