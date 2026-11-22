#!/usr/bin/env node
// Seeds one synthetic kitchen into one running source app server, proves the server holds exactly
// that kitchen, and exports its fixtures:
//
//   node scripts/move-in-proof/run.mjs --source v2.8.0 --size small --base-url http://localhost:9000 --out move-in-proof
//
// writes move-in-proof/<source>/<size>/{backup.zip,recipes/,recipe-zips/,fixture.json} and exits 1
// when any count the server reads back differs from the kitchen's expected counts.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SourceClient, waitForServer } from "./adapters/mealie/client.mjs";
import { exportKitchen } from "./adapters/mealie/export.mjs";
import { observeKitchen } from "./adapters/mealie/observe.mjs";
import { sourceProfile } from "./adapters/mealie/profile.mjs";
import { seedKitchen } from "./adapters/mealie/seed.mjs";
import { DEFAULT_SEED, expectedCounts, generateKitchen, kitchenFingerprint, stableStringify } from "./kitchen.mjs";
import { compareCounts } from "./manifest.mjs";

function backupTables(zipPath) {
  try {
    const database = JSON.parse(execFileSync("unzip", ["-p", zipPath, "database.json"], { maxBuffer: 1024 * 1024 * 1024 }).toString("utf8"));
    return Object.fromEntries(
      Object.entries(database)
        .filter(([, rows]) => Array.isArray(rows))
        .map(([table, rows]) => [table, rows.length])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  } catch (error) {
    return { error: error.message.split("\n")[0] };
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      size: { type: "string", default: "small" },
      "base-url": { type: "string", default: "http://localhost:9000" },
      out: { type: "string", default: "move-in-proof" },
      seed: { type: "string", default: String(DEFAULT_SEED) },
    },
  });
  const profile = sourceProfile(values.source);
  const kitchen = generateKitchen(values.size, { seed: Number(values.seed) });
  const log = (message) => console.log(`[${values.source} ${values.size}] ${message}`);
  const about = await waitForServer(values["base-url"]);
  log(`source app ${about.version} is up`);

  // The members' password only lives for this run's throwaway server; it is never written out.
  const password = randomBytes(18).toString("base64url");
  const client = new SourceClient(values["base-url"]);
  const started = Date.now();
  const seeded = await seedKitchen({ client, profile, kitchen, password, log });
  log(`seeded in ${Math.round((Date.now() - started) / 1000)}s`);

  const { counts, recipes } = await observeKitchen({ profile, kitchen, seeded });
  const expected = expectedCounts(kitchen);
  const mismatches = compareCounts(expected, counts);
  for (const mismatch of mismatches) log(`MISMATCH ${mismatch.path}: expected ${mismatch.expected}, server held ${mismatch.observed}`);
  if (mismatches.length === 0) log(`every count matches (${Object.keys(expected).length} entities)`);

  const outDir = path.join(values.out, values.source, values.size);
  mkdirSync(outDir, { recursive: true });
  const exported = await exportKitchen({ profile, seeded, recipes, outDir, log });
  const fixture = {
    version: values.source,
    size: values.size,
    reportedVersion: about.version,
    fingerprint: kitchenFingerprint(kitchen),
    expected,
    observed: counts,
    mismatches,
    exported,
    backupTables: backupTables(path.join(outDir, "backup.zip")),
  };
  writeFileSync(path.join(outDir, "fixture.json"), `${stableStringify(fixture, 2)}\n`);

  if (mismatches.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
