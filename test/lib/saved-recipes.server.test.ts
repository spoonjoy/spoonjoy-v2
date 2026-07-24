import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { PrismaClient } from "@prisma/client";
import { db } from "~/lib/db.server";
import {
  SAVED_RECIPE_DEFAULT_LIMIT,
  SAVED_RECIPE_MAX_LIMIT,
  SavedRecipeNotFoundError,
  SavedRecipeValidationError,
  decodeSavedRecipesCursor,
  encodeSavedRecipesCursor,
  escapeSavedRecipeLike,
  listSavedRecipes,
  normalizeSavedRecipeQuery,
  saveRecipe,
  unsaveRecipe,
} from "~/lib/saved-recipes.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

const EARLIER = "2026-07-20T10:00:00.000Z";
const LATER = "2026-07-21T10:00:00.000Z";

async function createUser(label: string) {
  return db.user.create({
    data: {
      ...createTestUser(),
      username: `${label}_${faker.string.alphanumeric(8).toLowerCase()}`,
    },
  });
}

async function createRecipe(input: {
  chefId: string;
  id?: string;
  title?: string;
  description?: string | null;
  course?: "main" | "side" | "appetizer" | "dessert" | null;
  deletedAt?: Date | null;
}) {
  return db.recipe.create({
    data: {
      ...createTestRecipe(input.chefId),
      id: input.id,
      title: input.title ?? `saved_${faker.string.alphanumeric(8)}`,
      description: input.description,
      course: input.course,
      deletedAt: input.deletedAt,
    },
  });
}

async function createSave(userId: string, recipeId: string, savedAt: string) {
  return db.savedRecipe.create({ data: { userId, recipeId, savedAt } });
}

function fakeRawDatabase(rows: Array<{ recipeId: string; savedAt: string }>) {
  const query = vi.fn().mockResolvedValue(rows.map(({ recipeId, savedAt }) => ({
    recipeId,
    savedAtText: `saved-at:${savedAt}`,
  })));
  return {
    database: { $queryRawUnsafe: query } as never,
    query,
  };
}

function expectValidation(error: unknown, field: string) {
  expect(error).toBeInstanceOf(SavedRecipeValidationError);
  expect(error).toMatchObject({ field });
}

function noncanonicalBase64url(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const expected = Buffer.from(value, "base64url");
  for (const candidate of alphabet) {
    const variant = `${value.slice(0, -1)}${candidate}`;
    if (variant !== value && Buffer.from(variant, "base64url").equals(expected)) return variant;
  }
  throw new Error("expected an alternate base64url spelling");
}

function twoPartyBarrier() {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return vi.fn(async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await ready;
  });
}

describe("saved-recipes.server", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await cleanupDatabase();
  });

  describe("query normalization", () => {
    it("normalizes Unicode whitespace for display without compatibility folding prose", () => {
      expect(normalizeSavedRecipeQuery(null)).toEqual({
        displayQuery: "",
        tagQuery: "",
        displayPattern: "",
        tagPattern: "",
      });
      expect(normalizeSavedRecipeQuery(undefined)).toEqual({
        displayQuery: "",
        tagQuery: "",
        displayPattern: "",
        tagPattern: "",
      });

      const normalized = normalizeSavedRecipeQuery("\u2003\tＦＯＯ\nbar\u00a0");
      expect(normalized).toEqual({
        displayQuery: "ＦＯＯ bar",
        tagQuery: "foo bar",
        displayPattern: "%ＦＯＯ bar%",
        tagPattern: "%foo bar%",
      });
    });

    it("rejects category-C values and counts Unicode code points through the 200 boundary", () => {
      for (const value of ["hello\u0000world", "hello\u200eworld", "hello\ud800world"]) {
        try {
          normalizeSavedRecipeQuery(value);
          throw new Error("expected validation failure");
        } catch (error) {
          expectValidation(error, "q");
        }
      }

      expect(normalizeSavedRecipeQuery("a\u0085b").displayQuery).toBe("a b");
      expect(() => normalizeSavedRecipeQuery("a\ufeffb")).toThrow(SavedRecipeValidationError);
      expect(normalizeSavedRecipeQuery(`${"a".repeat(99)}${"\u2003".repeat(500)}${"b".repeat(100)}`).displayQuery)
        .toBe(`${"a".repeat(99)} ${"b".repeat(100)}`);
      expect(() => normalizeSavedRecipeQuery(
        `${"a".repeat(100)}${"\u2003".repeat(500)}${"b".repeat(100)}`,
      )).toThrow(SavedRecipeValidationError);
      expect(normalizeSavedRecipeQuery("😀".repeat(200)).displayQuery).toBe("😀".repeat(200));
      expect(() => normalizeSavedRecipeQuery("😀".repeat(201))).toThrow(SavedRecipeValidationError);
    });

    it("applies NFKC once before locale-independent tag lowercasing", () => {
      const normalize = vi.spyOn(String.prototype, "normalize");
      const result = normalizeSavedRecipeQuery("  İ①Ｋ  ");

      expect(result.displayQuery).toBe("İ①Ｋ");
      expect(result.tagQuery).toBe("i\u03071k");
      expect(normalize).toHaveBeenCalledTimes(1);
      expect(normalize).toHaveBeenCalledWith("NFKC");
    });

    it("rejects malformed runtime values and category-C introduced by normalization", () => {
      expect(() => normalizeSavedRecipeQuery(42 as unknown as string))
        .toThrow(SavedRecipeValidationError);

      vi.spyOn(String.prototype, "normalize").mockReturnValue("tag\u0000");
      try {
        normalizeSavedRecipeQuery("tag");
        throw new Error("expected validation failure");
      } catch (error) {
        expectValidation(error, "q");
      }
    });

    it("escapes backslash, percent, and underscore as literal LIKE characters", () => {
      expect(escapeSavedRecipeLike("100%_fold \\ sauce")).toBe("100\\%\\_fold \\\\ sauce");
      expect(normalizeSavedRecipeQuery("100%_fold \\ sauce")).toMatchObject({
        displayPattern: "%100\\%\\_fold \\\\ sauce%",
        tagPattern: "%100\\%\\_fold \\\\ sauce%",
      });
    });
  });

  describe("cursor codec", () => {
    it("encodes exact unpadded fixed-key JSON and round-trips canonical timestamps", () => {
      const cursor = encodeSavedRecipesCursor({ savedAt: LATER, recipeId: "recipe_1" });
      const decodedJson = Buffer.from(cursor, "base64url").toString("utf8");

      expect(cursor).not.toContain("=");
      expect(decodedJson).toBe(`{"v":1,"savedAt":"${LATER}","recipeId":"recipe_1"}`);
      expect(decodeSavedRecipesCursor(cursor)).toEqual({ savedAt: LATER, recipeId: "recipe_1" });
      expect(decodeSavedRecipesCursor(encodeSavedRecipesCursor({
        savedAt: "0000-01-01T00:00:00.000Z",
        recipeId: "min",
      }))).toEqual({ savedAt: "0000-01-01T00:00:00.000Z", recipeId: "min" });
      expect(decodeSavedRecipesCursor(encodeSavedRecipesCursor({
        savedAt: "9999-12-31T23:59:59.999Z",
        recipeId: "max",
      }))).toEqual({ savedAt: "9999-12-31T23:59:59.999Z", recipeId: "max" });
    });

    it("admits the exact 256 four-byte-code-point cursor maximum", () => {
      const recipeId = "😀".repeat(256);
      const cursor = encodeSavedRecipesCursor({ savedAt: LATER, recipeId });

      expect(Buffer.byteLength(Buffer.from(cursor, "base64url"))).toBe(1082);
      expect(cursor).toHaveLength(1443);
      expect(decodeSavedRecipesCursor(cursor)).toEqual({ savedAt: LATER, recipeId });
    });

    it.each([
      ["empty", ""],
      ["padding", `${Buffer.from("{}", "utf8").toString("base64url")}=`],
      ["alphabet", "abc+def"],
      ["encoded cap", "a".repeat(1444)],
      ["malformed JSON", Buffer.from("not json", "utf8").toString("base64url")],
      ["array", Buffer.from("[]", "utf8").toString("base64url")],
      ["invalid UTF-8", Buffer.from([0xc3, 0x28]).toString("base64url")],
    ])("rejects %s cursors", (_label, cursor) => {
      try {
        decodeSavedRecipesCursor(cursor);
        throw new Error("expected validation failure");
      } catch (error) {
        expectValidation(error, "cursor");
      }
    });

    it.each([
      ["missing key", { v: 1, savedAt: LATER }],
      ["extra key", { v: 1, savedAt: LATER, recipeId: "r", extra: true }],
      ["wrong order", { savedAt: LATER, v: 1, recipeId: "r" }],
      ["wrong version", { v: 2, savedAt: LATER, recipeId: "r" }],
      ["invalid date", { v: 1, savedAt: "2026-02-30T00:00:00.000Z", recipeId: "r" }],
      ["noncanonical date", { v: 1, savedAt: "2026-01-01T00:00:00Z", recipeId: "r" }],
      ["empty id", { v: 1, savedAt: LATER, recipeId: "" }],
      ["long id", { v: 1, savedAt: LATER, recipeId: "😀".repeat(257) }],
      ["control id", { v: 1, savedAt: LATER, recipeId: "r\n2" }],
      ["format id", { v: 1, savedAt: LATER, recipeId: "r\u200e2" }],
      ["surrogate id", { v: 1, savedAt: LATER, recipeId: "r\ud8002" }],
      ["private-use id", { v: 1, savedAt: LATER, recipeId: "r\ue0002" }],
    ])("rejects decoded cursor with %s", (_label, value) => {
      const cursor = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
      try {
        decodeSavedRecipesCursor(cursor);
        throw new Error("expected validation failure");
      } catch (error) {
        expectValidation(error, "cursor");
      }
    });

    it("rejects whitespace JSON, oversized decoded bytes, and alternate base64url spellings", () => {
      const spaced = Buffer.from(
        `{ "v": 1, "savedAt": "${LATER}", "recipeId": "r" }`,
        "utf8",
      ).toString("base64url");
      const oversized = Buffer.from("x".repeat(1083), "utf8").toString("base64url");
      const canonical = encodeSavedRecipesCursor({ savedAt: LATER, recipeId: "r" });
      const invalidUtf8Json = Buffer.concat([
        Buffer.from(`{"v":1,"savedAt":"${LATER}","recipeId":"`, "utf8"),
        Buffer.from([0xc3, 0x28]),
        Buffer.from('"}', "utf8"),
      ]).toString("base64url");

      for (const cursor of [
        spaced,
        oversized,
        invalidUtf8Json,
        noncanonicalBase64url(canonical),
      ]) {
        try {
          decodeSavedRecipesCursor(cursor);
          throw new Error("expected validation failure");
        } catch (error) {
          expectValidation(error, "cursor");
        }
      }
    });

    it("rejects invalid values at encode time", () => {
      for (const value of [
        { savedAt: "today", recipeId: "r" },
        { savedAt: "2026-02-30T00:00:00.000Z", recipeId: "r" },
        { savedAt: "2026-01-01T00:00:00Z", recipeId: "r" },
        { savedAt: LATER, recipeId: "" },
        { savedAt: LATER, recipeId: "x".repeat(257) },
        { savedAt: LATER, recipeId: "r\u0000" },
        { savedAt: LATER, recipeId: "r\u200e" },
        { savedAt: LATER, recipeId: "r\ud800" },
        { savedAt: LATER, recipeId: "r\ue000" },
      ]) {
        try {
          encodeSavedRecipesCursor(value);
          throw new Error("expected validation failure");
        } catch (error) {
          expectValidation(error, "cursor");
        }
      }
    });

    it("rejects defensive encoded cursor byte and character cap violations", () => {
      vi.stubGlobal("TextEncoder", class {
        encode() {
          return new Uint8Array(1083);
        }
      });
      expect(() => encodeSavedRecipesCursor({ savedAt: LATER, recipeId: "r" }))
        .toThrow(SavedRecipeValidationError);

      vi.unstubAllGlobals();
      for (const encoded of ["", "A".repeat(1444)]) {
        vi.stubGlobal("btoa", vi.fn(() => encoded));
        expect(() => encodeSavedRecipesCursor({ savedAt: LATER, recipeId: "r" }))
          .toThrow(SavedRecipeValidationError);
        vi.unstubAllGlobals();
      }
    });
  });

  describe("bounded list query", () => {
    it("uses the default 24-row page and SQL LIMIT 25 without full materialization", async () => {
      const rows = Array.from({ length: 25 }, (_, index) => ({
        recipeId: `recipe_${String(25 - index).padStart(2, "0")}`,
        savedAt: LATER,
      }));
      const { database, query } = fakeRawDatabase(rows);

      const result = await listSavedRecipes(database, { userId: "owner" });
      const [sql, ...values] = query.mock.calls[0]!;

      expect(SAVED_RECIPE_DEFAULT_LIMIT).toBe(24);
      expect(SAVED_RECIPE_MAX_LIMIT).toBe(24);
      expect(sql).toContain(
        `CASE WHEN typeof(saved."savedAt") = 'text' ` +
        `THEN ('saved-at:' || saved."savedAt") END AS "savedAtText"`,
      );
      expect(result.items).toEqual(rows.slice(0, 24));
      expect(result.nextCursor).toBe(encodeSavedRecipesCursor(rows[23]!));
      expect(sql).toMatch(/LIMIT 25\b/);
      expect(values).toEqual(["owner"]);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it("captures owner, escaped search branches, strict cursor predicate, and custom limit", async () => {
      const { database, query } = fakeRawDatabase([]);
      const cursor = encodeSavedRecipesCursor({ savedAt: LATER, recipeId: "cursor_recipe" });

      const result = await listSavedRecipes(database, {
        userId: "owner_a",
        query: "  Ｍiso%_ \\  ",
        limit: 2,
        cursor,
      });
      const [sql, ...values] = query.mock.calls[0]!;
      const compactSql = sql.replace(/\s+/g, " ").trim();

      expect(result).toEqual({ query: "Ｍiso%_ \\", items: [], nextCursor: null });
      expect(sql).toContain('FROM "SavedRecipe" AS saved');
      expect(sql).toContain('INNER JOIN "Recipe" AS recipe');
      expect(sql).toContain('INNER JOIN "User" AS chef');
      expect(sql).toContain('saved."userId" = ?');
      expect(sql).toContain('recipe."deletedAt" IS NULL');
      expect(sql.match(/LIKE \? ESCAPE '\\'/g)).toHaveLength(5);
      expect(compactSql).toContain(
        `AND ( recipe."title" LIKE ? ESCAPE '\\' OR COALESCE(recipe."description", '') LIKE ? ESCAPE '\\' OR chef."username" LIKE ? ESCAPE '\\' OR COALESCE(recipe."course", '') LIKE ? ESCAPE '\\' OR EXISTS ( SELECT 1 FROM "RecipeTag" AS tag WHERE tag."recipeId" = recipe."id" AND tag."normalizedLabel" LIKE ? ESCAPE '\\' ) )`,
      );
      expect(compactSql).toContain(
        `AND ( saved."savedAt" COLLATE BINARY < ? COLLATE BINARY OR ( saved."savedAt" COLLATE BINARY = ? COLLATE BINARY AND saved."recipeId" COLLATE BINARY < ? COLLATE BINARY ) )`,
      );
      expect(sql).toMatch(/saved\."savedAt" COLLATE BINARY < \? COLLATE BINARY/);
      expect(sql).toMatch(/saved\."savedAt" COLLATE BINARY = \? COLLATE BINARY/);
      expect(sql).toMatch(/saved\."recipeId" COLLATE BINARY < \? COLLATE BINARY/);
      expect(sql).toContain('ORDER BY saved."savedAt" COLLATE BINARY DESC, saved."recipeId" COLLATE BINARY DESC');
      expect(sql).toMatch(/LIMIT 3\b/);
      expect(values).toEqual([
        "owner_a",
        "%Ｍiso\\%\\_ \\\\%",
        "%Ｍiso\\%\\_ \\\\%",
        "%Ｍiso\\%\\_ \\\\%",
        "%Ｍiso\\%\\_ \\\\%",
        "%miso\\%\\_ \\\\%",
        LATER,
        LATER,
        "cursor_recipe",
      ]);
    });

    it.each([0, -1, 1.5, 25, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects invalid limit %s before querying",
      async (limit) => {
        const { database, query } = fakeRawDatabase([]);
        try {
          await listSavedRecipes(database, { userId: "owner", limit });
          throw new Error("expected validation failure");
        } catch (error) {
          expectValidation(error, "limit");
        }
        expect(query).not.toHaveBeenCalled();
      },
    );

    it("returns no cursor for exactly one page and rejects mixed noncanonical stored times", async () => {
      const rows = Array.from({ length: 24 }, (_, index) => ({
        recipeId: `recipe_${index}`,
        savedAt: LATER,
      }));
      const exact = fakeRawDatabase(rows);
      const invalid = fakeRawDatabase([
        { recipeId: "good-new", savedAt: LATER },
        { recipeId: "bad", savedAt: "2026-07-21 10:00:00" },
        { recipeId: "good-old", savedAt: EARLIER },
      ]);
      const invalidLookahead = fakeRawDatabase([
        ...rows,
        { recipeId: "bad-lookahead", savedAt: "2026-07-21 10:00:00" },
      ]);
      const invalidRecipeId = fakeRawDatabase([
        { recipeId: null, savedAt: LATER },
      ] as never);

      await expect(listSavedRecipes(exact.database, { userId: "owner" })).resolves.toEqual({
        query: "",
        items: rows,
        nextCursor: null,
      });
      await expect(listSavedRecipes(invalid.database, { userId: "owner" }))
        .rejects.toMatchObject({ field: "savedAt" });
      await expect(listSavedRecipes(invalidLookahead.database, { userId: "owner" }))
        .rejects.toMatchObject({ field: "savedAt" });
      await expect(listSavedRecipes(invalidRecipeId.database, { userId: "owner" }))
        .rejects.toMatchObject({ field: "recipeId" });
    });

    it("rejects missing and non-string raw saved-at text envelopes", async () => {
      for (const savedAtText of [LATER, new Date(LATER)]) {
        const query = vi.fn().mockResolvedValue([{ recipeId: "recipe_1", savedAtText }]);
        await expect(listSavedRecipes(
          { $queryRawUnsafe: query } as never,
          { userId: "owner" },
        )).rejects.toMatchObject({ field: "savedAt" });
      }
    });

    it("applies owner scoping, active filtering, literal escaping, and ASCII-only LIKE folding", async () => {
      const owner = await createUser("saved_list_owner");
      const other = await createUser("saved_list_other");
      const chef = await createUser("saved_list_chef");
      const ascii = await createRecipe({ chefId: chef.id, title: "miso 100%_fold \\ bowl", course: "main" });
      const unicode = await createRecipe({ chefId: chef.id, title: "CAFÉ stew", description: "ＦＯＯ prose" });
      const deleted = await createRecipe({
        chefId: chef.id,
        title: "miso deleted",
        deletedAt: new Date("2026-07-21T12:00:00.000Z"),
      });
      await createSave(owner.id, ascii.id, LATER);
      await createSave(owner.id, unicode.id, EARLIER);
      await createSave(owner.id, deleted.id, LATER);
      await createSave(other.id, unicode.id, LATER);
      const otherAscii = await createRecipe({ chefId: chef.id, title: "miso belongs elsewhere" });
      await createSave(other.id, otherAscii.id, LATER);

      await expect(listSavedRecipes(db, { userId: owner.id, query: "MISO" }))
        .resolves.toMatchObject({ items: [{ recipeId: ascii.id }] });
      await expect(listSavedRecipes(db, { userId: owner.id, query: "100%_fold \\" }))
        .resolves.toMatchObject({ items: [{ recipeId: ascii.id }] });
      await expect(listSavedRecipes(db, { userId: owner.id, query: "café" }))
        .resolves.toMatchObject({ items: [] });
      await expect(listSavedRecipes(db, { userId: owner.id, query: "foo" }))
        .resolves.toMatchObject({ items: [] });
      const otherResult = await listSavedRecipes(db, { userId: other.id });
      expect(new Set(otherResult.items.map((item) => item.recipeId)))
        .toEqual(new Set([unicode.id, otherAscii.id]));
    });

    it("searches title, description, chef, course, and once-normalized tags as one OR", async () => {
      const owner = await createUser("saved_search_owner");
      const chef = await createUser("plain_chef");
      const matchingChef = await createUser("needle_chef");
      await db.user.update({ where: { id: chef.id }, data: { username: "plain_chef_savedsearch" } });
      await db.user.update({ where: { id: matchingChef.id }, data: { username: "needle_chef_savedsearch" } });
      const matches = await Promise.all([
        createRecipe({ chefId: chef.id, title: "Needle title" }),
        createRecipe({ chefId: chef.id, title: "Description", description: "needle description" }),
        createRecipe({ chefId: matchingChef.id, title: "Chef match" }),
        createRecipe({ chefId: chef.id, title: "Course match", course: "dessert" }),
        createRecipe({ chefId: chef.id, title: "Tag match" }),
      ]);
      await db.recipeTag.create({
        data: {
          recipeId: matches[4]!.id,
          label: "① NEEDLE",
          normalizedLabel: "1 needle",
        },
      });
      for (const [index, recipe] of matches.entries()) {
        await createSave(owner.id, recipe.id, `2026-07-2${index + 1}T10:00:00.000Z`);
      }

      const needle = await listSavedRecipes(db, { userId: owner.id, query: "needle" });
      expect(new Set(needle.items.map((item) => item.recipeId))).toEqual(new Set([
        matches[0]!.id,
        matches[1]!.id,
        matches[2]!.id,
        matches[4]!.id,
      ]));
      await expect(listSavedRecipes(db, { userId: owner.id, query: "dessert" }))
        .resolves.toMatchObject({ items: [{ recipeId: matches[3]!.id }] });
      await expect(listSavedRecipes(db, { userId: owner.id, query: "①" }))
        .resolves.toMatchObject({ items: [{ recipeId: matches[4]!.id }] });
      await expect(listSavedRecipes(db, { userId: owner.id, query: "1" }))
        .resolves.toMatchObject({ items: [{ recipeId: matches[4]!.id }] });
    });

    it("uses SQLite BINARY ordering and tie predicates instead of JavaScript ordering", async () => {
      const owner = await createUser("saved_binary_owner");
      const chef = await createUser("saved_binary_chef");
      const supplementary = await createRecipe({ chefId: chef.id, id: "😀", title: "Supplementary" });
      const bmp = await createRecipe({ chefId: chef.id, id: "\ue000", title: "BMP private use" });
      await createSave(owner.id, supplementary.id, LATER);
      await createSave(owner.id, bmp.id, LATER);

      const first = await listSavedRecipes(db, { userId: owner.id, limit: 1 });
      expect(first.items).toEqual([{ recipeId: supplementary.id, savedAt: LATER }]);
      expect(first.nextCursor).not.toBeNull();
      await expect(listSavedRecipes(db, {
        userId: owner.id,
        limit: 1,
        cursor: first.nextCursor!,
      })).resolves.toEqual({
        query: "",
        items: [{ recipeId: bmp.id, savedAt: LATER }],
        nextCursor: null,
      });
    });
  });

  describe("save and unsave", () => {
    it("sends one active-recipe insert-or-observe statement with exact bind order", async () => {
      const query = vi.fn().mockResolvedValue([{
        recipeId: "recipe_1",
        savedAtText: `saved-at:${LATER}`,
      }]);

      await expect(saveRecipe(
        { $queryRawUnsafe: query } as never,
        { userId: "owner_1", recipeId: "recipe_1", nowMs: Date.parse(LATER) },
      )).resolves.toEqual({ recipeId: "recipe_1", savedAt: LATER });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, ...values] = query.mock.calls[0]!;
      expect(sql.replace(/\s+/g, " ").trim()).toBe(
        `INSERT INTO "SavedRecipe" ("userId", "recipeId", "savedAt") ` +
        `SELECT ?, recipe."id", ? FROM "Recipe" AS recipe ` +
        `WHERE recipe."id" = ? AND recipe."deletedAt" IS NULL ` +
        `ON CONFLICT ("userId", "recipeId") DO UPDATE ` +
        `SET "savedAt" = "SavedRecipe"."savedAt" RETURNING "recipeId", ` +
        `CASE WHEN typeof("savedAt") = 'text' ` +
        `THEN ('saved-at:' || "savedAt") END AS "savedAtText"`,
      );
      expect(values).toEqual(["owner_1", LATER, "recipe_1"]);
    });

    it("writes one canonical persisted winner and preserves it on idempotent and concurrent saves", async () => {
      const owner = await createUser("save_owner");
      const chef = await createUser("save_chef");
      const recipe = await createRecipe({ chefId: chef.id, title: "Save me" });
      const nowMs = Date.parse(LATER);
      const clientA = new PrismaClient();
      const clientB = new PrismaClient();
      const beforePersist = twoPartyBarrier();

      try {
        const [first, concurrent] = await Promise.all([
          saveRecipe(
            clientA,
            { userId: owner.id, recipeId: recipe.id, nowMs },
            { beforePersist },
          ),
          saveRecipe(
            clientB,
            { userId: owner.id, recipeId: recipe.id, nowMs: nowMs + 60_000 },
            { beforePersist },
          ),
        ]);
        const repeated = await saveRecipe(db, {
          userId: owner.id,
          recipeId: recipe.id,
          nowMs: nowMs + 120_000,
        });
        const persisted = await db.savedRecipe.findUniqueOrThrow({
          where: { userId_recipeId: { userId: owner.id, recipeId: recipe.id } },
        });

        expect(beforePersist).toHaveBeenCalledTimes(2);
        expect([LATER, new Date(nowMs + 60_000).toISOString()]).toContain(persisted.savedAt);
        expect([first.savedAt, concurrent.savedAt, repeated.savedAt])
          .toEqual([persisted.savedAt, persisted.savedAt, persisted.savedAt]);
        expect(Buffer.byteLength(persisted.savedAt)).toBe(24);
        await expect(db.savedRecipe.count({ where: { userId: owner.id, recipeId: recipe.id } }))
          .resolves.toBe(1);
      } finally {
        await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);
      }
    });

    it("enforces active recipe existence for PUT without requiring recipe ownership", async () => {
      const owner = await createUser("save_active_owner");
      const chef = await createUser("save_active_chef");
      const active = await createRecipe({ chefId: chef.id, title: "Other chef active" });
      const deleted = await createRecipe({
        chefId: chef.id,
        title: "Other chef deleted",
        deletedAt: new Date(LATER),
      });

      await expect(saveRecipe(db, {
        userId: owner.id,
        recipeId: active.id,
        nowMs: Date.parse(LATER),
      })).resolves.toEqual({ recipeId: active.id, savedAt: LATER });
      for (const recipeId of [deleted.id, "missing_recipe"]) {
        await expect(saveRecipe(db, {
          userId: owner.id,
          recipeId,
          nowMs: Date.parse(LATER),
        })).rejects.toBeInstanceOf(SavedRecipeNotFoundError);
      }
    });

    it("linearizes active-recipe enforcement against soft and hard deletion", async () => {
      const owner = await createUser("save_delete_race_owner");
      const soft = await createRecipe({ chefId: owner.id, title: "Soft race" });
      const hard = await createRecipe({ chefId: owner.id, title: "Hard race" });

      await expect(saveRecipe(
        db,
        { userId: owner.id, recipeId: soft.id, nowMs: Date.parse(LATER) },
        {
          beforePersist: async () => {
            await db.recipe.update({ where: { id: soft.id }, data: { deletedAt: new Date(LATER) } });
          },
        },
      )).rejects.toBeInstanceOf(SavedRecipeNotFoundError);
      await expect(db.savedRecipe.count({ where: { recipeId: soft.id } })).resolves.toBe(0);

      await expect(saveRecipe(
        db,
        { userId: owner.id, recipeId: hard.id, nowMs: Date.parse(LATER) },
        {
          beforePersist: async () => {
            await db.recipe.delete({ where: { id: hard.id } });
          },
        },
      )).rejects.toBeInstanceOf(SavedRecipeNotFoundError);
      await expect(db.savedRecipe.count({ where: { recipeId: hard.id } })).resolves.toBe(0);
    });

    it("rejects invalid write clocks before mutation", async () => {
      const owner = await createUser("save_clock_owner");
      const recipe = await createRecipe({ chefId: owner.id, title: "Clock" });
      for (const nowMs of [1.5, Number.NaN, Number.POSITIVE_INFINITY, -62_167_219_200_001, 253_402_300_800_000]) {
        try {
          await saveRecipe(db, { userId: owner.id, recipeId: recipe.id, nowMs });
          throw new Error("expected validation failure");
        } catch (error) {
          expectValidation(error, "nowMs");
        }
      }
      await expect(db.savedRecipe.count()).resolves.toBe(0);
    });

    it("accepts the exact four-digit-year write-clock bounds", async () => {
      const owner = await createUser("save_clock_bounds");
      const minimum = await createRecipe({ chefId: owner.id, title: "Minimum clock" });
      const maximum = await createRecipe({ chefId: owner.id, title: "Maximum clock" });

      await expect(saveRecipe(db, {
        userId: owner.id,
        recipeId: minimum.id,
        nowMs: -62_167_219_200_000,
      })).resolves.toEqual({ recipeId: minimum.id, savedAt: "0000-01-01T00:00:00.000Z" });
      await expect(saveRecipe(db, {
        userId: owner.id,
        recipeId: maximum.id,
        nowMs: 253_402_300_799_999,
      })).resolves.toEqual({ recipeId: maximum.id, savedAt: "9999-12-31T23:59:59.999Z" });
    });

    it("keeps saves independent from cookbook membership in both directions", async () => {
      const owner = await createUser("save_independent_owner");
      const recipe = await createRecipe({ chefId: owner.id, title: "Independent" });
      const cookbook = await db.cookbook.create({ data: { authorId: owner.id, title: "Shelf" } });

      await db.recipeInCookbook.create({
        data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: owner.id },
      });
      expect(await db.savedRecipe.count()).toBe(0);

      await saveRecipe(db, { userId: owner.id, recipeId: recipe.id, nowMs: Date.parse(LATER) });
      await db.recipeInCookbook.deleteMany({ where: { cookbookId: cookbook.id, recipeId: recipe.id } });
      expect(await db.savedRecipe.count()).toBe(1);

      await db.recipeInCookbook.create({
        data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: owner.id },
      });
      expect(await db.savedRecipe.count()).toBe(1);
      await unsaveRecipe(db, { userId: owner.id, recipeId: recipe.id });
      expect(await db.recipeInCookbook.count()).toBe(1);

      await db.recipeInCookbook.deleteMany({ where: { cookbookId: cookbook.id, recipeId: recipe.id } });
      expect(await db.savedRecipe.count()).toBe(0);
    });

    it("unsaves idempotently after soft deletion, absence, and hard-delete cascade", async () => {
      const owner = await createUser("unsave_owner");
      const soft = await createRecipe({ chefId: owner.id, title: "Soft" });
      const hard = await createRecipe({ chefId: owner.id, title: "Hard" });
      await createSave(owner.id, soft.id, EARLIER);
      await createSave(owner.id, hard.id, LATER);
      await db.recipe.update({ where: { id: soft.id }, data: { deletedAt: new Date(LATER) } });
      await db.recipe.delete({ where: { id: hard.id } });
      await expect(db.savedRecipe.findUnique({
        where: { userId_recipeId: { userId: owner.id, recipeId: hard.id } },
      })).resolves.toBeNull();

      await expect(unsaveRecipe(db, { userId: owner.id, recipeId: soft.id }))
        .resolves.toEqual({ recipeId: soft.id });
      await expect(unsaveRecipe(db, { userId: owner.id, recipeId: soft.id }))
        .resolves.toEqual({ recipeId: soft.id });
      await expect(unsaveRecipe(db, { userId: owner.id, recipeId: hard.id }))
        .resolves.toEqual({ recipeId: hard.id });
      await expect(unsaveRecipe(db, { userId: owner.id, recipeId: "missing" }))
        .resolves.toEqual({ recipeId: "missing" });
      await expect(db.savedRecipe.count({ where: { userId: owner.id } })).resolves.toBe(0);
    });

    it("never crosses owner keys during save or unsave", async () => {
      const ownerA = await createUser("save_scope_a");
      const ownerB = await createUser("save_scope_b");
      const recipe = await createRecipe({ chefId: ownerA.id, title: "Scoped" });
      await createSave(ownerA.id, recipe.id, EARLIER);
      await saveRecipe(db, { userId: ownerB.id, recipeId: recipe.id, nowMs: Date.parse(LATER) });

      await unsaveRecipe(db, { userId: ownerB.id, recipeId: recipe.id });
      await expect(db.savedRecipe.findMany({
        where: { recipeId: recipe.id },
        orderBy: { userId: "asc" },
      })).resolves.toEqual([{ userId: ownerA.id, recipeId: recipe.id, savedAt: EARLIER }]);
    });
  });
});
