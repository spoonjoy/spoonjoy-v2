import { describe, expect, it } from "vitest";
import {
  buildMigrationSql,
  buildR2GetArgs,
  buildR2PutArgs,
  buildReferenceQuery,
  buildRollbackSql,
  contentTypeForExtension,
  detectImageContentType,
  extensionForContentType,
  isCloudinaryUrl,
  keyForCloudinaryUrl,
  parseOptions,
  parseWranglerD1Results,
  planCloudinaryMigration,
  sanitizeKeySegment,
  sqlString,
  targetConfig,
  type CloudinaryReference,
} from "../../scripts/migrate-cloudinary-covers-to-r2";

const NOW = new Date("2026-07-12T12:34:56.000Z");

function coverReference(overrides: Partial<CloudinaryReference> = {}): CloudinaryReference {
  return {
    tableName: "RecipeCover",
    fieldName: "imageUrl",
    rowId: "cover_1",
    entityId: "recipe_1",
    imageUrl: "https://res.cloudinary.com/dpjmyc4uz/image/upload/v1675274505/cream.png",
    ...overrides,
  };
}

describe("Cloudinary to R2 migration helpers", () => {
  it("defaults to a production dry-run with a timestamped report path", () => {
    expect(parseOptions([], NOW)).toMatchObject({
      apply: false,
      targetEnv: "production",
      database: "DB",
      limit: null,
      resumeExistingR2: false,
      reportPath: "cloudinary-r2-migration-artifacts/cloudinary-r2-migration-production-20260712T123456Z.json",
    });
    expect(parseOptions(["--resume-existing-r2"], NOW)).toMatchObject({ resumeExistingR2: true });
  });

  it("requires a valid target and mutually exclusive mode flags", () => {
    expect(() => parseOptions(["--target-env", "local"], NOW)).toThrow("--target-env");
    expect(() => parseOptions(["--apply", "--dry-run"], NOW)).toThrow("either --apply or --dry-run");
    expect(() => parseOptions(["--limit", "0"], NOW)).toThrow("--limit");
  });

  it("targets production and QA Cloudflare resources explicitly", () => {
    expect(targetConfig({ targetEnv: "production", database: "DB" })).toMatchObject({
      r2Bucket: "spoonjoy-photos",
      d1Args: ["--remote"],
      r2Args: ["--remote"],
    });
    expect(targetConfig({ targetEnv: "qa", database: "DB" })).toMatchObject({
      r2Bucket: "spoonjoy-photos-qa",
      d1Args: ["--remote", "--env", "qa"],
      r2Args: ["--remote", "--env", "qa"],
    });
  });

  it("detects only secure Cloudinary asset URLs", () => {
    expect(isCloudinaryUrl("https://res.cloudinary.com/dpjmyc4uz/image/upload/a.png")).toBe(true);
    expect(isCloudinaryUrl("http://res.cloudinary.com/dpjmyc4uz/image/upload/a.png")).toBe(false);
    expect(isCloudinaryUrl("https://images.example.com/a.png")).toBe(false);
    expect(isCloudinaryUrl("not a url")).toBe(false);
  });

  it("builds deterministic safe R2 keys from Cloudinary URLs", () => {
    expect(sanitizeKeySegment("Creamy Israeli Hummus!.png")).toBe("creamy-israeli-hummus.png");
    expect(keyForCloudinaryUrl("https://res.cloudinary.com/dpjmyc4uz/image/upload/v1675274505/Creamy Israeli Hummus.PNG")).toMatch(
      /^legacy-cloudinary\/creamy-israeli-hummus-[a-f0-9]{16}\.png$/,
    );
    expect(keyForCloudinaryUrl("https://res.cloudinary.com/dpjmyc4uz/image/upload/v1/no-ext", "image/webp")).toMatch(
      /^legacy-cloudinary\/no-ext-[a-f0-9]{16}\.webp$/,
    );
  });

  it("normalizes content types and sniffs image magic bytes", () => {
    expect(extensionForContentType("image/jpeg; charset=binary")).toBe(".jpg");
    expect(extensionForContentType("application/json")).toBeNull();
    expect(contentTypeForExtension(".webp")).toBe("image/webp");
    expect(detectImageContentType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(detectImageContentType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectImageContentType(Uint8Array.from([0x00, 0x01, 0x02]))).toBeNull();
  });

  it("plans unique assets and counts every table field reference", () => {
    const plan = planCloudinaryMigration([
      coverReference(),
      coverReference({ rowId: "cover_2" }),
      coverReference({
        tableName: "SearchDocument",
        fieldName: "imageUrl",
        rowId: "42",
        entityId: "recipe_1",
      }),
      coverReference({ imageUrl: "/photos/already-local.png" }),
    ]);

    expect(plan.references).toHaveLength(3);
    expect(plan.assets).toHaveLength(1);
    expect(plan.assets[0]).toMatchObject({ referenceCount: 3, migratedUrl: expect.stringMatching(/^\/photos\/legacy-cloudinary\//) });
    expect(plan.countsByField).toEqual({
      "RecipeCover.imageUrl": 2,
      "SearchDocument.imageUrl": 1,
    });
  });

  it("builds guarded update SQL for source rows and SearchDocument rows", () => {
    const migrated = new Map([
      ["https://res.cloudinary.com/dpjmyc4uz/image/upload/v1675274505/cream.png", "/photos/legacy-cloudinary/cream.png"],
      ["https://res.cloudinary.com/dpjmyc4uz/image/upload/v1/o'hara.png", "/photos/legacy-cloudinary/ohara.png"],
    ]);

    const sql = buildMigrationSql([
      coverReference(),
      coverReference({
        tableName: "SearchDocument",
        fieldName: "imageUrl",
        rowId: "99",
        entityId: "recipe_1",
        imageUrl: "https://res.cloudinary.com/dpjmyc4uz/image/upload/v1/o'hara.png",
      }),
    ], migrated);

    expect(sql).toContain(
      `UPDATE "RecipeCover" SET "imageUrl" = '/photos/legacy-cloudinary/cream.png' WHERE "id" = 'cover_1' AND "imageUrl" = 'https://res.cloudinary.com/dpjmyc4uz/image/upload/v1675274505/cream.png';`,
    );
    expect(sql).toContain(
      `UPDATE "SearchDocument" SET "imageUrl" = '/photos/legacy-cloudinary/ohara.png' WHERE rowid = 99 AND "imageUrl" = 'https://res.cloudinary.com/dpjmyc4uz/image/upload/v1/o''hara.png';`,
    );
    expect(sql).not.toContain("BEGIN TRANSACTION");
    expect(sql).not.toContain("COMMIT");
  });

  it("builds rollback SQL that reverses guarded URL updates", () => {
    const migrated = new Map([
      [coverReference().imageUrl, "/photos/legacy-cloudinary/cream.png"],
    ]);

    expect(buildRollbackSql([coverReference()], migrated)).toContain(
      `UPDATE "RecipeCover" SET "imageUrl" = 'https://res.cloudinary.com/dpjmyc4uz/image/upload/v1675274505/cream.png' WHERE "id" = 'cover_1' AND "imageUrl" = '/photos/legacy-cloudinary/cream.png';`,
    );
  });

  it("allows empty migrated URLs for missing Cloudinary assets", () => {
    const migrated = new Map([[coverReference().imageUrl, ""]]);

    expect(buildMigrationSql([coverReference()], migrated)).toContain(
      `UPDATE "RecipeCover" SET "imageUrl" = '' WHERE "id" = 'cover_1' AND "imageUrl" = 'https://res.cloudinary.com/dpjmyc4uz/image/upload/v1675274505/cream.png';`,
    );
    expect(buildRollbackSql([coverReference()], migrated)).toContain(
      `UPDATE "RecipeCover" SET "imageUrl" = 'https://res.cloudinary.com/dpjmyc4uz/image/upload/v1675274505/cream.png' WHERE "id" = 'cover_1' AND "imageUrl" = '';`,
    );
  });

  it("rejects unsafe SearchDocument row ids", () => {
    expect(() =>
      buildMigrationSql([
        coverReference({
          tableName: "SearchDocument",
          rowId: "not-a-rowid",
        }),
      ], new Map([[coverReference().imageUrl, "/photos/new.png"]])),
    ).toThrow("Invalid SearchDocument rowid");
  });

  it("escapes SQL strings and builds reference queries with the Cloudinary guard", () => {
    expect(sqlString("o'hara")).toBe("'o''hara'");
    const query = buildReferenceQuery({
      tableName: "RecipeCover",
      fieldName: "stylizedImageUrl",
      rowIdSql: "id",
      entityIdSql: "recipeId",
    }, 10);

    expect(query).toContain(`FROM "RecipeCover"`);
    expect(query).toContain(`"stylizedImageUrl" LIKE '%res.cloudinary.com/%'`);
    expect(query).toContain("LIMIT 10");
  });

  it("parses Wrangler D1 JSON result arrays", () => {
    expect(parseWranglerD1Results<{ id: string }>(JSON.stringify([{ results: [{ id: "a" }] }, { results: [{ id: "b" }] }]))).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
    expect(() => parseWranglerD1Results("{}")).toThrow("not an array");
  });

  it("builds R2 put args with immutable caching", () => {
    expect(buildR2PutArgs(
      targetConfig({ targetEnv: "production", database: "DB" }),
      "legacy-cloudinary/a.png",
      "/tmp/a.png",
      "image/png",
    )).toEqual([
      "exec",
      "wrangler",
      "r2",
      "object",
      "put",
      "spoonjoy-photos/legacy-cloudinary/a.png",
      "--remote",
      "--file",
      "/tmp/a.png",
      "--content-type",
      "image/png",
      "--cache-control",
      "public, max-age=31536000, immutable",
    ]);
  });

  it("builds R2 get args for resume probes", () => {
    expect(buildR2GetArgs(
      targetConfig({ targetEnv: "production", database: "DB" }),
      "legacy-cloudinary/a.png",
      "/tmp/a.png",
    )).toEqual([
      "exec",
      "wrangler",
      "r2",
      "object",
      "get",
      "spoonjoy-photos/legacy-cloudinary/a.png",
      "--remote",
      "--file",
      "/tmp/a.png",
    ]);
  });
});
