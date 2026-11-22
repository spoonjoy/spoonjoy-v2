import { describe, expect, it } from "vitest";
import { expectedCounts, generateKitchen, kitchenFingerprint } from "../../../scripts/move-in-proof/kitchen.mjs";
import { buildManifest, checkFixtures, compareCounts, fixturePath } from "../../../scripts/move-in-proof/manifest.mjs";
import { SOURCE_VERSIONS, sourceProfile } from "../../../scripts/move-in-proof/adapters/mealie/profile.mjs";

describe("sourceProfile", () => {
  it("covers the latest 1.x, the latest 2.x and 3.31.0", () => {
    expect(SOURCE_VERSIONS.map((source) => source.version)).toEqual(["v1.12.0", "v2.8.0", "v3.31.0"]);
    for (const source of SOURCE_VERSIONS) {
      expect(source.image).toBe(`ghcr.io/mealie-recipes/mealie:${source.version}`);
    }
  });

  it("keeps 1.x kitchen data under the group, with organizer-list cookbooks", () => {
    expect(sourceProfile("v1.12.0")).toEqual({
      version: "v1.12.0",
      major: 1,
      households: false,
      cookbookFilter: "organizers",
      recipeZipExport: true,
      disableAmountSetting: true,
      paths: {
        cookbooks: "/api/groups/cookbooks",
        mealPlans: "/api/groups/mealplans",
        shoppingLists: "/api/groups/shopping/lists",
        shoppingItems: "/api/groups/shopping/items",
        labels: "/api/groups/labels",
      },
    });
  });

  it("keeps 2.x data under the household, with query-filter cookbooks", () => {
    expect(sourceProfile("v2.8.0")).toMatchObject({
      major: 2,
      households: true,
      cookbookFilter: "query",
      recipeZipExport: true,
      disableAmountSetting: true,
      paths: {
        cookbooks: "/api/households/cookbooks",
        mealPlans: "/api/households/mealplans",
        shoppingLists: "/api/households/shopping/lists",
        shoppingItems: "/api/households/shopping/items",
        labels: "/api/groups/labels",
      },
    });
  });

  it("drops the per-recipe zip and the amount setting from 3.x", () => {
    expect(sourceProfile("v3.31.0")).toMatchObject({ major: 3, households: true, recipeZipExport: false, disableAmountSetting: false });
  });

  it("refuses versions it has no profile for", () => {
    expect(() => sourceProfile("v0.5.4")).toThrow('No source profile for "v0.5.4"; supported majors are 1, 2 and 3.');
    expect(() => sourceProfile("latest")).toThrow('No source profile for "latest"; supported majors are 1, 2 and 3.');
  });
});

describe("compareCounts", () => {
  it("returns nothing when the counts match", () => {
    expect(compareCounts({ recipes: 2, byMember: { a: 1 } }, { recipes: 2, byMember: { a: 1 }, extra: 9 })).toEqual([]);
  });

  it("names each count that differs or is missing, nested ones by path", () => {
    expect(compareCounts({ recipes: 2, byMember: { a: 1, b: 1 }, tags: 3 }, { recipes: 3, byMember: { a: 1 } })).toEqual([
      { path: "recipes", expected: 2, observed: 3 },
      { path: "byMember.b", expected: 1, observed: undefined },
      { path: "tags", expected: 3, observed: undefined },
    ]);
  });

  it("treats a missing nested object as a mismatch of each count in it", () => {
    expect(compareCounts({ byMember: { a: 1 } }, {})).toEqual([{ path: "byMember.a", expected: 1, observed: undefined }]);
  });
});

describe("buildManifest", () => {
  it("lists each kitchen's fingerprint and counts, and each source's fixtures", () => {
    const manifest = buildManifest({ sizes: ["small"] });
    const kitchen = generateKitchen("small");
    expect(manifest).toEqual({
      schemaVersion: 1,
      name: "move-in proof fixtures",
      generatorVersion: 1,
      seed: 20261122,
      kitchens: {
        small: {
          recipes: 20,
          fingerprint: kitchenFingerprint(kitchen),
          household: "Juniper Street Kitchen",
          members: [
            { key: "owner", email: "owner@move-in-proof.example" },
            { key: "member", email: "member@move-in-proof.example" },
          ],
          counts: expectedCounts(kitchen),
        },
      },
      sources: SOURCE_VERSIONS.map((source) => ({
        app: "source app",
        adapter: "mealie",
        version: source.version,
        image: source.image,
        fixtures: {
          small: {
            backup: `${source.version}/small/backup.zip`,
            recipes: `${source.version}/small/recipes/`,
            recipeZips: sourceProfile(source.version).recipeZipExport ? `${source.version}/small/recipe-zips/` : null,
          },
        },
      })),
    });
  });

  it("serializes to the same bytes every time, with no timestamps", async () => {
    const { manifestJson } = await import("../../../scripts/move-in-proof/manifest.mjs");
    const first = manifestJson(buildManifest());
    expect(manifestJson(buildManifest())).toBe(first);
    expect(first).not.toMatch(/\d{4}-\d\d-\d\dT/);
    expect(Object.keys(JSON.parse(first).kitchens)).toEqual(["large", "small"]);
    expect(first.endsWith("}\n")).toBe(true);
  });

  it("builds the fixture path for a source, size and file", () => {
    expect(fixturePath("v2.8.0", "large", "backup.zip")).toBe("v2.8.0/large/backup.zip");
  });
});

describe("checkFixtures", () => {
  const manifest = buildManifest({ sizes: ["small"] });
  const counts = manifest.kitchens.small.counts;

  it("passes when every source's fixtures were seeded from the manifest's kitchen and read back whole", () => {
    const fixtures = manifest.sources.map((source) => ({
      version: source.version,
      size: "small",
      fingerprint: manifest.kitchens.small.fingerprint,
      observed: counts,
    }));
    expect(checkFixtures(manifest, fixtures)).toEqual([]);
  });

  it("names a missing fixture, a kitchen from another generator and a count the server lost", () => {
    const fixtures = [
      { version: "v1.12.0", size: "small", fingerprint: "other", observed: counts },
      { version: "v2.8.0", size: "small", fingerprint: manifest.kitchens.small.fingerprint, observed: { ...counts, tags: counts.tags - 1 } },
      { version: "v9.0.0", size: "small", fingerprint: manifest.kitchens.small.fingerprint, observed: counts },
    ];
    expect(checkFixtures(manifest, fixtures)).toEqual([
      "v1.12.0/small: seeded from kitchen other, but the manifest's kitchen is " + manifest.kitchens.small.fingerprint + ".",
      `v2.8.0/small: tags expected ${counts.tags}, server held ${counts.tags - 1}.`,
      "v3.31.0/small: no fixtures.",
      "v9.0.0/small: not in the manifest.",
    ]);
  });
});
