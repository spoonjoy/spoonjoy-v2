// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  d1Boolean,
  d1Count,
  d1DateTime,
  d1NullableDateTime,
  d1ReadBatch,
  groupRows,
  requestD1,
  type D1ReadDatabase,
} from "~/lib/d1-read.server";
import {
  mapModel,
  RECIPE_STEP_COLUMNS,
  INGREDIENT_COLUMNS,
  selectColumns,
  UNIT_COLUMNS,
} from "~/lib/d1-models.server";

function stubDb(results: Array<{ results?: unknown[] }>): D1ReadDatabase & { bound: unknown[][] } {
  const bound: unknown[][] = [];
  const statement = (sql: string) => ({
    bind: (...values: unknown[]) => {
      bound.push([sql, ...values]);
      return statement(sql);
    },
  });
  return {
    bound,
    prepare: statement,
    batch: async () => results,
  };
}

describe("requestD1", () => {
  it("returns the binding when the request context carries a D1-shaped DB", () => {
    const DB = { prepare() {}, batch() {} };
    expect(requestD1({ cloudflare: { env: { DB } } } as never)).toBe(DB);
  });

  it.each([
    ["no context", undefined],
    ["no cloudflare", {}],
    ["a null env", { cloudflare: { env: null } }],
    ["no DB", { cloudflare: { env: {} } }],
    ["a non-object DB", { cloudflare: { env: { DB: "db" } } }],
    ["a DB without batch", { cloudflare: { env: { DB: { prepare() {} } } } }],
    ["a DB without prepare", { cloudflare: { env: { DB: { batch() {} } } } }],
  ])("returns null for %s", (_label, context) => {
    expect(requestD1(context as never)).toBeNull();
  });
});

describe("d1ReadBatch", () => {
  it("binds each statement's values and returns each statement's rows in order", async () => {
    const db = stubDb([{ results: [{ a: 1 }] }, { results: [] }]);
    await expect(d1ReadBatch(db, [["SELECT ?", 1], ["SELECT 2"]])).resolves.toEqual([[{ a: 1 }], []]);
    expect(db.bound).toEqual([["SELECT ?", 1], ["SELECT 2"]]);
  });

  it("fails closed when a statement result carries no rows array", async () => {
    await expect(d1ReadBatch(stubDb([{}]), [["SELECT 1"]])).rejects.toThrow("D1 batch statement 0 returned no result rows");
    await expect(d1ReadBatch(stubDb([null as never]), [["SELECT 1"]])).rejects.toThrow("returned no result rows");
  });

  it("fails closed when the batch returns a different number of results", async () => {
    await expect(d1ReadBatch(stubDb([]), [["SELECT 1"]])).rejects.toThrow("D1 batch returned 0 results for 1 statements");
  });

  it("propagates a D1 error instead of returning empty rows", async () => {
    const db = { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error("D1_ERROR: boom"); } };
    await expect(d1ReadBatch(db as never, [["SELECT 1"]])).rejects.toThrow("D1_ERROR: boom");
  });
});

describe("d1DateTime", () => {
  it("reads the formats Prisma reads, zone-less timestamps as UTC", () => {
    expect(d1DateTime("2026-09-27T07:11:42.581+00:00", "c").toISOString()).toBe("2026-09-27T07:11:42.581Z");
    expect(d1DateTime("2026-07-20T01:02:03.456Z", "c").toISOString()).toBe("2026-07-20T01:02:03.456Z");
    expect(d1DateTime("2026-09-27 07:11:42", "c").toISOString()).toBe("2026-09-27T07:11:42.000Z");
    expect(d1DateTime("2026-07-20 01:02:03.5", "c").toISOString()).toBe("2026-07-20T01:02:03.500Z");
    expect(d1DateTime("2026-07-20T01:02", "c").toISOString()).toBe("2026-07-20T01:02:00.000Z");
    expect(d1DateTime(1790000000000, "c").toISOString()).toBe(new Date(1790000000000).toISOString());
  });

  it.each([["garbage"], [""], [null], [undefined], [true], [{}], [Number.NaN]])("rejects %p", (value) => {
    expect(() => d1DateTime(value, "createdAt")).toThrow("D1 column createdAt is not a valid DateTime");
  });

  it("keeps SQL NULL as null only for nullable columns", () => {
    expect(d1NullableDateTime(null, "c")).toBeNull();
    expect(d1NullableDateTime("2026-09-27 07:11:42", "c")?.toISOString()).toBe("2026-09-27T07:11:42.000Z");
    expect(() => d1NullableDateTime(undefined, "deletedAt")).toThrow("deletedAt");
  });
});

describe("d1Boolean and d1Count", () => {
  it("reads SQLite booleans", () => {
    expect(d1Boolean(1, "b")).toBe(true);
    expect(d1Boolean(true, "b")).toBe(true);
    expect(d1Boolean(0, "b")).toBe(false);
    expect(d1Boolean(false, "b")).toBe(false);
    expect(() => d1Boolean(2, "flag")).toThrow("D1 column flag is not a Boolean");
    expect(() => d1Boolean(null, "flag")).toThrow("flag");
  });

  it("reads counts", () => {
    expect(d1Count(0, "n")).toBe(0);
    expect(d1Count(7, "n")).toBe(7);
    expect(() => d1Count(-1, "n")).toThrow("D1 column n is not a count");
    expect(() => d1Count(1.5, "n")).toThrow("not a count");
    expect(() => d1Count("3", "n")).toThrow("not a count");
  });
});

describe("groupRows", () => {
  it("groups rows by key in row order", () => {
    const groups = groupRows([{ k: "a", n: 1 }, { k: "b", n: 2 }, { k: "a", n: 3 }], (row) => row.k);
    expect([...groups.entries()]).toEqual([
      ["a", [{ k: "a", n: 1 }, { k: "a", n: 3 }]],
      ["b", [{ k: "b", n: 2 }]],
    ]);
  });
});

describe("model columns", () => {
  it("selects a model's columns on an alias with a prefix", () => {
    expect(selectColumns(UNIT_COLUMNS, "u", "unit_")).toBe(
      'u."id" AS "unit_id", u."name" AS "unit_name", u."updatedAt" AS "unit_updatedAt"',
    );
    expect(selectColumns(UNIT_COLUMNS, "u")).toBe('u."id" AS "id", u."name" AS "name", u."updatedAt" AS "updatedAt"');
  });

  it("maps a raw row to the model Prisma returns", () => {
    expect(
      mapModel(
        RECIPE_STEP_COLUMNS,
        {
          s_id: "step",
          s_recipeId: "recipe",
          s_stepNum: 2,
          s_stepTitle: null,
          s_description: "Stir",
          s_duration: null,
          s_updatedAt: "2026-09-27 07:11:42",
        },
        "s_",
      ),
    ).toEqual({
      id: "step",
      recipeId: "recipe",
      stepNum: 2,
      stepTitle: null,
      description: "Stir",
      duration: null,
      updatedAt: new Date("2026-09-27T07:11:42.000Z"),
    });
  });

  const ingredientRow = {
    id: "i",
    recipeId: "r",
    stepNum: 1,
    quantity: 0.25,
    unitId: "u",
    ingredientRefId: "ref",
    updatedAt: "2026-09-27T07:11:42.581+00:00",
  };

  it("maps float columns", () => {
    expect(mapModel(INGREDIENT_COLUMNS, ingredientRow).quantity).toBe(0.25);
  });

  it.each([
    ["a missing string", { id: undefined }, "id", "string"],
    ["a numeric string column", { recipeId: 7 }, "recipeId", "string"],
    ["a null required string", { unitId: null }, "unitId", "string"],
    ["a fractional int", { stepNum: 1.5 }, "stepNum", "int"],
    ["a string int", { stepNum: "1" }, "stepNum", "int"],
    ["a non-finite float", { quantity: Number.POSITIVE_INFINITY }, "quantity", "float"],
    ["a string float", { quantity: "0.25" }, "quantity", "float"],
  ])("fails closed on %s", (_label, override, column, kind) => {
    expect(() => mapModel(INGREDIENT_COLUMNS, { ...ingredientRow, ...override })).toThrow(
      `D1 column ${column} does not hold a ${kind} value`,
    );
  });

  it("fails closed on a nullable int or string holding the wrong type", () => {
    const step = { id: "s", recipeId: "r", stepNum: 1, stepTitle: 3, description: "d", duration: null, updatedAt: 1 };
    expect(() => mapModel(RECIPE_STEP_COLUMNS, step)).toThrow("D1 column stepTitle does not hold a string? value");
    expect(() => mapModel(RECIPE_STEP_COLUMNS, { ...step, stepTitle: null, duration: "5" })).toThrow(
      "D1 column duration does not hold a int? value",
    );
    expect(() => mapModel(RECIPE_STEP_COLUMNS, { ...step, stepTitle: null, updatedAt: null })).toThrow(
      "D1 column updatedAt is not a valid DateTime",
    );
  });
});
