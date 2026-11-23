import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkProofFixtures } from "../e2e/journeys/support/move-in-fixtures";
import { bytesSource, openZip } from "../app/domains/move-in/adapters/archive/zip";
import { makeZip } from "./domains/move-in/support/make-zip";

const manifest = {
  kitchens: { small: { fingerprint: "small-1" }, large: { fingerprint: "large-1" } },
  sources: [
    { version: "v1", fixtures: { small: { backup: "v1/small/backup.zip" }, large: { backup: "v1/large/backup.zip" } } },
    { version: "v2", fixtures: { small: { backup: "v2/small/backup.zip" }, large: { backup: "v2/large/backup.zip" } } },
  ],
};
const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
const pinned = createHash("sha256").update(manifestBytes).digest("hex");

function fixture(fingerprint: string, mismatches: unknown[] = []) {
  return JSON.stringify({ fingerprint, mismatches });
}

/** A fixtures zip holding each version's fixture.json, with `override` replacing or (null) dropping entries. */
async function bundle(override: Record<string, string | null> = {}) {
  const files: Record<string, string | null> = {
    "v1/small/fixture.json": fixture("small-1"),
    "v1/large/fixture.json": fixture("large-1"),
    "v2/small/fixture.json": fixture("small-1"),
    "v2/large/fixture.json": fixture("large-1"),
    ...override,
  };
  const inputs = Object.entries(files).flatMap(([name, data]) => (data === null ? [] : [{ name, data }]));
  return openZip(bytesSource(makeZip(inputs)));
}

describe("the move-in proof fixtures check", () => {
  it("takes the pinned manifest and a zip whose every kitchen is the one the manifest counts, whatever the zip's bytes", async () => {
    const checked = await checkProofFixtures(manifestBytes, await bundle(), pinned);
    expect(checked).toEqual(manifest);
  });

  it("refuses a manifest that isn't the pinned one", async () => {
    await expect(checkProofFixtures(manifestBytes, await bundle(), "0".repeat(64))).rejects.toThrow(
      `The proof fixture manifest.json changed (sha256 ${pinned})`,
    );
  });

  it("refuses a kitchen that isn't the one the manifest counts, that the seeding saw differ, or that is missing", async () => {
    const cases: Array<[Record<string, string | null>, string]> = [
      [{ "v2/large/fixture.json": fixture("large-0") }, "v2/large/fixture.json is kitchen large-0, not the manifest's large-1"],
      [{ "v1/small/fixture.json": fixture("small-1", [{ table: "recipes" }]) }, "v1/small/fixture.json had 1 mismatch when it was seeded"],
      [{ "v2/small/fixture.json": null }, "The proof fixtures have no v2/small/fixture.json"],
    ];
    for (const [override, message] of cases) {
      await expect(checkProofFixtures(manifestBytes, await bundle(override), pinned)).rejects.toThrow(message);
    }
  });
});
