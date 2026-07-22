import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const fixtureDir = "test/fixtures/product-cutover";
const manifests = JSON.parse(readFileSync(
  path.resolve(fixtureDir, "exact-runtime-manifests.json"),
  "utf8",
));
const audited = new Set();

for (const manifest of manifests) {
  const identity = `${manifest.mergeSha}:${manifest.sourcePath}`;
  if (audited.has(identity)) continue;
  audited.add(identity);

  const historicalSource = execFileSync("git", ["show", identity]);
  const fixtureSource = readFileSync(path.resolve(manifest.fixturePath));
  if (!fixtureSource.equals(historicalSource)) {
    throw new Error(`Historical source mismatch: ${identity}`);
  }
  const treeSha = execFileSync(
    "git",
    ["rev-parse", `${manifest.mergeSha}^{tree}`],
    { encoding: "utf8" },
  ).trim();
  if (treeSha !== manifest.treeSha) {
    throw new Error(`Historical tree mismatch: ${identity}`);
  }
  const blobOid = execFileSync(
    "git",
    ["rev-parse", identity],
    { encoding: "utf8" },
  ).trim();
  if (blobOid !== manifest.sourceBlobOid) {
    throw new Error(`Historical blob mismatch: ${identity}`);
  }
}

process.stdout.write(`Audited ${audited.size} exact historical runtime sources.\n`);
