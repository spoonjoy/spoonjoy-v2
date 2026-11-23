// The move-in proof's published fixtures (scripts/move-in-proof, release move-in-proof-fixtures-v1):
// one manifest of expected counts and one zip of every version's small and large kitchen backups.
// Journeys read them from the public release. The manifest is pinned by digest. The zip's bytes
// differ from run to run of the generator, so instead each kitchen in it must carry the manifest's
// fingerprint for its size and have seeded without a mismatch.
import { createHash } from "node:crypto";
import { bytesSource, openZip, type ZipArchive } from "../../../app/domains/move-in/adapters/archive/zip";

const RELEASE = "https://github.com/spoonjoy/spoonjoy-v2/releases/download/move-in-proof-fixtures-v1";
// The generation of the manifest the journeys' counts belong to.
const MANIFEST_DIGEST = "95d32baf9cf8b120a0623cd5aec57b18d6d313f16717b5291d7ae65ced65a58f";
const FIXTURE_MAX_BYTES = 1024 * 1024;

/** The parts of the manifest the check reads; callers read the rest with their own shape. */
export interface ProofManifest {
  kitchens: Record<string, { fingerprint: string }>;
  sources: Array<{ version: string; fixtures: Record<string, unknown> }>;
}

/** Fetches a release asset, trying again after a blip. */
async function fetchAsset(name: string): Promise<Uint8Array> {
  let failure = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
    const response = await fetch(`${RELEASE}/${name}`).catch((error: Error) => error);
    if (response instanceof Error || !response.ok) {
      failure = response instanceof Error ? response.message : `HTTP ${response.status}`;
      continue;
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error(`The proof fixture ${name} didn't download: ${failure}`);
}

/**
 * Checks the manifest against its pinned digest, and each version's kitchen in the zip against the
 * manifest: same fingerprint for its size, and no mismatch when it was seeded.
 */
export async function checkProofFixtures(manifestBytes: Uint8Array, bundle: ZipArchive, digest = MANIFEST_DIGEST): Promise<ProofManifest> {
  const actual = createHash("sha256").update(manifestBytes).digest("hex");
  if (actual !== digest) throw new Error(`The proof fixture manifest.json changed (sha256 ${actual}); update MANIFEST_DIGEST with the counts it belongs to`);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ProofManifest;
  for (const source of manifest.sources) {
    for (const size of Object.keys(source.fixtures)) {
      const name = `${source.version}/${size}/fixture.json`;
      const entry = bundle.get(name);
      if (!entry) throw new Error(`The proof fixtures have no ${name}`);
      const fixture = JSON.parse(new TextDecoder().decode(await bundle.read(entry, { maxBytes: FIXTURE_MAX_BYTES }))) as {
        fingerprint: string;
        mismatches: unknown[];
      };
      const expected = manifest.kitchens[size]?.fingerprint;
      if (fixture.fingerprint !== expected) throw new Error(`The proof fixtures' ${name} is kitchen ${fixture.fingerprint}, not the manifest's ${expected}`);
      const count = fixture.mismatches.length;
      if (count) throw new Error(`The proof fixtures' ${name} had ${count} ${count === 1 ? "mismatch" : "mismatches"} when it was seeded`);
    }
  }
  return manifest;
}

/** The checked manifest and the fixtures zip, from the release. */
export async function proofFixtures(): Promise<{ manifest: ProofManifest; bundle: ZipArchive }> {
  const manifestBytes = await fetchAsset("manifest.json");
  const bundle = await openZip(bytesSource(await fetchAsset("move-in-proof-fixtures.zip")));
  return { manifest: await checkProofFixtures(manifestBytes, bundle), bundle };
}
