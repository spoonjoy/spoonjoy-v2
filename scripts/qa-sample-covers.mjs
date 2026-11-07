#!/usr/bin/env node
// Puts the sample cover images in assets/sample-covers/ into QA's photo bucket under
// samples/covers/, where QA's sample image provider (app/lib/sample-cover-images.server.ts) reads
// them, so QA covers no person sees never cost a paid generation call. It writes only to QA's
// bucket, and putting an image that is already there replaces it with the same bytes.
//
// The images: four Unsplash food photos the app already shows in its stories and landing page
// (Unsplash License), fetched at 768x768 from images.unsplash.com
// (photo-1518492104633-130d0cc84637, photo-1621996346565-e3dbc646d9a9,
// photo-1547592166-23ac45744acd, photo-1565299624946-b28f40a0ae38), and the Test Kitchen's own
// cover art (public/test-kitchen/crispy-chickpeas.webp).
import { execFile as nodeExecFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isTransientR2ApiError, R2_TRANSIENT_RETRY_DELAYS_MS } from "./cleanup-local-qa-data.mjs";

export const QA_PHOTO_BUCKET = "spoonjoy-photos-qa";
export const SAMPLE_COVER_DIR = "assets/sample-covers";
export const SAMPLE_COVER_PREFIX = "samples/covers/";

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function sampleCoverUploads(fileNames) {
  const uploads = [...fileNames]
    .sort()
    .filter((name) => !name.startsWith("."))
    .map((name) => {
      const contentType = CONTENT_TYPES[extname(name).toLowerCase()];
      if (!contentType) throw new Error(`${SAMPLE_COVER_DIR}/${name} is not a JPEG, PNG or WebP image.`);
      return { path: join(SAMPLE_COVER_DIR, name), key: `${SAMPLE_COVER_PREFIX}${name}`, contentType };
    });
  if (uploads.length === 0) throw new Error(`${SAMPLE_COVER_DIR} has no sample cover images.`);
  return uploads;
}

export function wranglerPutArgs(upload) {
  return [
    "exec", "wrangler", "r2", "object", "put", `${QA_PHOTO_BUCKET}/${upload.key}`,
    "--file", upload.path,
    "--content-type", upload.contentType,
    "--remote",
  ];
}

export async function main(deps = {}) {
  const {
    readdir = readdirSync,
    exec = promisify(nodeExecFile),
    log = console.log,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = deps;
  const uploads = sampleCoverUploads(readdir(SAMPLE_COVER_DIR));
  for (const upload of uploads) {
    // R2's API sometimes answers a put with a 500 or 429 for a moment; one of those failed the
    // QA Image Cover Smoke before it started, so a transient refusal is retried.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await exec("pnpm", wranglerPutArgs(upload));
        break;
      } catch (error) {
        if (attempt >= R2_TRANSIENT_RETRY_DELAYS_MS.length || !isTransientR2ApiError(error)) throw error;
        log(`R2 refused ${upload.key} for a moment; trying again (retry ${attempt + 1} of ${R2_TRANSIENT_RETRY_DELAYS_MS.length}).`);
        await sleep(R2_TRANSIENT_RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  log(`Put ${uploads.length} sample cover images in ${QA_PHOTO_BUCKET}/${SAMPLE_COVER_PREFIX}.`);
  return uploads.length;
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
    io.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  return true;
}

await runCliIfEntry();
