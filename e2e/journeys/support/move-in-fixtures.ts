// The move-in proof's published fixtures (scripts/move-in-proof, release move-in-proof-fixtures-v1):
// one manifest of expected counts and one zip of every version's small and large kitchen backups.
// Journeys read them from the public release and refuse any bytes that aren't the pinned ones.
import { createHash } from "node:crypto";

const RELEASE = "https://github.com/spoonjoy/spoonjoy-v2/releases/download/move-in-proof-fixtures-v1";
// The release's assets can be replaced under the same tag; these pin the generation the counts belong to.
const DIGESTS: Record<string, string> = {
  "manifest.json": "95d32baf9cf8b120a0623cd5aec57b18d6d313f16717b5291d7ae65ced65a58f",
  "move-in-proof-fixtures.zip": "18bb7cbf934fc61b33f1b90d563835dd351fe6cea0546686a82a5e811cbbc9bb",
};

/** Fetches a release asset, trying again after a blip, and refuses bytes that aren't the pinned ones. */
export async function download(name: string): Promise<Uint8Array> {
  let failure = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
    const response = await fetch(`${RELEASE}/${name}`).catch((error: Error) => error);
    if (response instanceof Error || !response.ok) {
      failure = response instanceof Error ? response.message : `HTTP ${response.status}`;
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== DIGESTS[name]) throw new Error(`The proof fixture ${name} changed (sha256 ${digest}); update DIGESTS with the counts it belongs to`);
    return bytes;
  }
  throw new Error(`The proof fixture ${name} didn't download: ${failure}`);
}

