// The move-in proof's manifest: for each kitchen size, the generated kitchen's fingerprint and the
// counts a faithful import must reproduce, and for each source app version, where its exported
// fixtures sit. It holds nothing that changes between runs (no ids, times or passwords), so two
// runs of the same generator publish byte-identical manifests.
import { DEFAULT_SEED, GENERATOR_VERSION, expectedCounts, generateKitchen, kitchenFingerprint, stableStringify } from "./kitchen.mjs";
import { SOURCE_VERSIONS, sourceProfile } from "./adapters/mealie/profile.mjs";

export const MANIFEST_SCHEMA_VERSION = 1;
export const KITCHEN_SIZE_NAMES = Object.freeze(["small", "large"]);

export function fixturePath(version, size, file) {
  return `${version}/${size}/${file}`;
}

export function buildManifest({ seed = DEFAULT_SEED, sizes = KITCHEN_SIZE_NAMES } = {}) {
  const kitchens = Object.fromEntries(
    sizes.map((size) => {
      const kitchen = generateKitchen(size, { seed });
      return [
        size,
        {
          recipes: kitchen.recipes.length,
          fingerprint: kitchenFingerprint(kitchen),
          household: kitchen.household.name,
          members: kitchen.household.members.map(({ key, email }) => ({ key, email })),
          counts: expectedCounts(kitchen),
        },
      ];
    }),
  );
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    name: "move-in proof fixtures",
    generatorVersion: GENERATOR_VERSION,
    seed,
    kitchens,
    sources: SOURCE_VERSIONS.map(({ version, image }) => ({
      app: "source app",
      adapter: "mealie",
      version,
      image,
      fixtures: Object.fromEntries(
        sizes.map((size) => [
          size,
          {
            backup: fixturePath(version, size, "backup.zip"),
            recipes: fixturePath(version, size, "recipes/"),
            recipeZips: sourceProfile(version).recipeZipExport ? fixturePath(version, size, "recipe-zips/") : null,
          },
        ]),
      ),
    })),
  };
}

export function manifestJson(manifest) {
  return `${stableStringify(manifest, 2)}\n`;
}

// Every count in `expected` that `observed` lacks or holds differently, nested counts named by
// their dotted path. Counts only `observed` has are not mismatches.
export function compareCounts(expected, observed, prefix = "") {
  return Object.entries(expected).flatMap(([key, value]) => {
    const path = `${prefix}${key}`;
    const actual = observed?.[key];
    if (value && typeof value === "object") return compareCounts(value, actual, `${path}.`);
    return actual === value ? [] : [{ path, expected: value, observed: actual }];
  });
}

// Problems with a set of seeded fixtures ({ version, size, fingerprint, observed }) against the
// manifest: a source and size with no fixtures, fixtures the manifest does not list, fixtures
// seeded from a different kitchen, and counts the server did not hold.
export function checkFixtures(manifest, fixtures) {
  const problems = [];
  const seen = new Set();
  for (const source of manifest.sources) {
    for (const size of Object.keys(source.fixtures)) {
      const id = `${source.version}/${size}`;
      seen.add(id);
      const fixture = fixtures.find((candidate) => candidate.version === source.version && candidate.size === size);
      if (!fixture) {
        problems.push(`${id}: no fixtures.`);
        continue;
      }
      const kitchen = manifest.kitchens[size];
      if (fixture.fingerprint !== kitchen.fingerprint) {
        problems.push(`${id}: seeded from kitchen ${fixture.fingerprint}, but the manifest's kitchen is ${kitchen.fingerprint}.`);
        continue;
      }
      for (const mismatch of compareCounts(kitchen.counts, fixture.observed)) {
        problems.push(`${id}: ${mismatch.path} expected ${mismatch.expected}, server held ${mismatch.observed}.`);
      }
    }
  }
  for (const fixture of fixtures) {
    const id = `${fixture.version}/${fixture.size}`;
    if (!seen.has(id)) problems.push(`${id}: not in the manifest.`);
  }
  return problems.sort();
}
