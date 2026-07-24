import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";

type DatabaseSyncType = InstanceType<typeof DatabaseSync>;

interface SchemaObjectRow {
  name: string;
  sql: string | null;
}

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface SavedRecipeRow {
  userId: string;
  recipeId: string;
  savedAt: string;
}

interface SchemaDefinitionRow {
  type: string;
  name: string;
  tableName: string;
  sql: string;
}

interface ShoppingItemRow {
  id: string;
  shoppingListId: string;
  quantity: number | string | Buffer | null;
  unitId: string | null;
  ingredientRefId: string;
  checked: number;
  updatedAt: string | number;
  checkedAt: string | null;
  deletedAt: string | null;
  sortIndex: number;
  categoryKey: string | null;
  iconKey: string | null;
}

const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "migrations");
const MIGRATION_FILE = "0025_clem_feedback_product.sql";
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, MIGRATION_FILE);
const FIXTURE_SQL = readFileSync(
  resolve(__dirname, "..", "fixtures", "clem-feedback-pre-feature.sql"),
  "utf8",
);
const TEST_SETUP_SOURCE = readFileSync(
  resolve(__dirname, "..", "setup.ts"),
  "utf8",
);
const PRODUCT_DATA_CONTRACT = readFileSync(
  resolve(
    __dirname,
    "..",
    "..",
    "worker",
    "tasks",
    "2026-07-19-1505-doing-clem-feedback-ship",
    "product-data-contract.md",
  ),
  "utf8",
);
const MIGRATION_EXISTS = existsSync(MIGRATION_PATH);
const MIGRATION_SQL = MIGRATION_EXISTS
  ? readFileSync(MIGRATION_PATH, "utf8")
  : "";
const NUMERIC_MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((fileName) => /^\d{4}_[a-z0-9_]+\.sql$/.test(fileName))
  .sort();
const BASELINE_MIGRATIONS = NUMERIC_MIGRATIONS.filter(
  (fileName) => Number.parseInt(fileName.slice(0, 4), 10) < 25,
);
const EXPECTED_BASELINE_MIGRATIONS = [
  "0000_init.sql",
  "0002_seed.sql",
  "0003_shopping_list_item_option2.sql",
  "0004_reseed.sql",
  "0005_add_recipe_step_duration.sql",
  "0006_search_document_fts.sql",
  "0007_api_credentials.sql",
  "0008_s1_spoon_foundation.sql",
  "0009_d006_push_notifications.sql",
  "0010_search_index_metadata.sql",
  "0011_agent_connection_requests.sql",
  "0012_passkey_metadata.sql",
  "0013_oauth_server.sql",
  "0014_oauth_refresh_tokens.sql",
  "0015_api_credential_scopes.sql",
  "0016_api_idempotency_keys.sql",
  "0017_oauth_access_audience.sql",
  "0018_recipe_cover_lifecycle.sql",
  "0019_oauth_connection_keys.sql",
  "0020_native_push_devices.sql",
  "0020_recipe_box_indexes.sql",
  "0021_api_mutation_tombstones.sql",
  "0022_native_sync_tombstones.sql",
  "0023_recipe_cover_prompt_lineage.sql",
  "0024_remove_legacy_demo_identities.sql",
] as const;

const EXPECTED_SAVED_AT_CHECK =
  "CHECK (typeof(savedAt) = 'text' AND length(savedAt) = 24 AND length(CAST(savedAt AS BLOB)) = 24 AND substr(savedAt,5,1) = '-' AND substr(savedAt,8,1) = '-' AND substr(savedAt,11,1) = 'T' AND substr(savedAt,14,1) = ':' AND substr(savedAt,17,1) = ':' AND substr(savedAt,20,1) = '.' AND substr(savedAt,24,1) = 'Z' AND substr(savedAt,1,4) NOT GLOB '*[^0-9]*' AND substr(savedAt,6,2) NOT GLOB '*[^0-9]*' AND substr(savedAt,9,2) NOT GLOB '*[^0-9]*' AND substr(savedAt,12,2) NOT GLOB '*[^0-9]*' AND substr(savedAt,15,2) NOT GLOB '*[^0-9]*' AND substr(savedAt,18,2) NOT GLOB '*[^0-9]*' AND substr(savedAt,21,3) NOT GLOB '*[^0-9]*' AND date(substr(savedAt,1,10)) = substr(savedAt,1,10) AND substr(savedAt,12,2) BETWEEN '00' AND '23' AND substr(savedAt,15,2) BETWEEN '00' AND '59' AND substr(savedAt,18,2) BETWEEN '00' AND '59' AND strftime('%Y-%m-%dT%H:%M:%fZ', savedAt) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', savedAt) = savedAt)";
const EXPECTED_SAVED_RECIPE_TABLE_SQL = `
  CREATE TABLE SavedRecipe (
    userId TEXT NOT NULL,
    recipeId TEXT NOT NULL,
    savedAt TEXT NOT NULL ${EXPECTED_SAVED_AT_CHECK},
    PRIMARY KEY (userId, recipeId),
    CONSTRAINT SavedRecipe_userId_fkey
      FOREIGN KEY (userId) REFERENCES User (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT SavedRecipe_recipeId_fkey
      FOREIGN KEY (recipeId) REFERENCES Recipe (id) ON DELETE CASCADE ON UPDATE CASCADE
  )
`;
const EXPECTED_RECIPE_TAG_TABLE_SQL = `
  CREATE TABLE RecipeTag (
    id TEXT NOT NULL PRIMARY KEY,
    recipeId TEXT NOT NULL,
    label TEXT NOT NULL,
    normalizedLabel TEXT NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT RecipeTag_recipeId_fkey
      FOREIGN KEY (recipeId) REFERENCES Recipe (id) ON DELETE CASCADE ON UPDATE CASCADE
  )
`;
const COURSE_COLUMN_SQL =
  "\"course\" TEXT CHECK (\"course\" IS NULL OR \"course\" IN ('main','side','appetizer','dessert'))";
const MIGRATION_CLOCK_TABLE_SQL = `
  CREATE TABLE "_Migration0025Clock" (
    "singleton" INTEGER PRIMARY KEY CHECK ("singleton" = 1),
    "boundNowMs" INTEGER NOT NULL,
    "boundNowText" TEXT NOT NULL
  )
`;
const MIGRATION_CLOCK_EXPRESSION =
  "CAST(round((julianday('now')-2440587.5)*86400000) AS INTEGER)";
const ACTIVE_IDENTITY_INDEX_SQL = `
  CREATE UNIQUE INDEX "ShoppingListItem_active_identity_key"
  ON "ShoppingListItem" (
    "shoppingListId",
    "ingredientRefId",
    COALESCE('u:' || "unitId", 'n:')
  )
  WHERE "deletedAt" IS NULL
`;
const SETUP_ACTIVE_IDENTITY_INDEX_SQL = ACTIVE_IDENTITY_INDEX_SQL.replace(
  "CREATE UNIQUE INDEX",
  "CREATE UNIQUE INDEX IF NOT EXISTS",
);
const UNIT_3_CONFLICT_TARGET_SQL = `
  ON CONFLICT (
    shoppingListId,
    ingredientRefId,
    COALESCE('u:' || unitId, 'n:')
  )
  WHERE deletedAt IS NULL
`;
const MIGRATION_CLOCK_REPAIR_JOIN_SQL = `
  CROSS JOIN "_Migration0025Clock" AS "migration_clock"
`;

function normalizeSql(sql: string): string {
  return sql
    .replace(/["`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

function createBaselineDatabase(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const fileName of BASELINE_MIGRATIONS) {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, fileName), "utf8"));
  }
  return db;
}

function applyMigration(db: DatabaseSyncType): void {
  db.transaction(() => db.exec(MIGRATION_SQL))();
}

function withDatabase(
  callback: (db: DatabaseSyncType) => void,
  options: { fixture?: boolean; migrate?: boolean } = {},
): void {
  const db = createBaselineDatabase();
  try {
    if (options.fixture) db.exec(FIXTURE_SQL);
    if (options.migrate ?? true) applyMigration(db);
    callback(db);
  } finally {
    db.close();
  }
}

function schemaObject(
  db: DatabaseSyncType,
  type: "index" | "table" | "trigger",
  name: string,
): SchemaObjectRow | undefined {
  return db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = ? AND name = ?")
    .get(type, name) as SchemaObjectRow | undefined;
}

function tableInfo(db: DatabaseSyncType, table: string): TableInfoRow[] {
  return db.prepare(`PRAGMA table_info("${table}")`).all() as TableInfoRow[];
}

function foreignKeys(db: DatabaseSyncType, table: string): unknown[] {
  return db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
}

function schemaDefinitions(
  db: DatabaseSyncType,
  excludedNames: ReadonlySet<string>,
): SchemaDefinitionRow[] {
  return (
    db
      .prepare(
        "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE type IN ('index', 'trigger', 'view') AND sql IS NOT NULL ORDER BY type, name",
      )
      .all() as SchemaDefinitionRow[]
  )
    .filter(({ type, name }) => !excludedNames.has(`${type}:${name}`))
    .map((row) => ({ ...row, sql: normalizeSql(row.sql) }));
}

function tableRows(
  db: DatabaseSyncType,
  table: string,
): Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all() as Record<
    string,
    unknown
  >[];
}

function count(db: DatabaseSyncType, sql: string): number {
  return (db.prepare(sql).get() as { count: number }).count;
}

function shoppingItems(db: DatabaseSyncType): ShoppingItemRow[] {
  return db
    .prepare(
      `SELECT id, shoppingListId, quantity, unitId, ingredientRefId, checked,
        updatedAt, checkedAt, deletedAt, sortIndex, categoryKey, iconKey
       FROM ShoppingListItem ORDER BY id COLLATE BINARY`,
    )
    .all() as ShoppingItemRow[];
}

function shoppingItem(db: DatabaseSyncType, id: string): ShoppingItemRow {
  return db
    .prepare(
      `SELECT id, shoppingListId, quantity, unitId, ingredientRefId, checked,
        updatedAt, checkedAt, deletedAt, sortIndex, categoryKey, iconKey
       FROM ShoppingListItem WHERE id = ?`,
    )
    .get(id) as ShoppingItemRow;
}

function addIngredientRef(db: DatabaseSyncType, id: string): void {
  db.prepare(
    "INSERT INTO IngredientRef (id, name, updatedAt) VALUES (?, ?, '2026-01-01T00:00:00.000Z')",
  ).run(id, `fixture-${id}`);
}

function addShoppingItem(
  db: DatabaseSyncType,
  values: {
    id: string;
    ingredientRefId: string;
    quantity?: number | string | Buffer | null;
    unitId?: string | null;
    checked?: number;
    updatedAt?: string | number;
    checkedAt?: string | null;
    deletedAt?: string | null;
    sortIndex?: number;
    categoryKey?: string | null;
    iconKey?: string | null;
    shoppingListId?: string;
  },
): void {
  db.prepare(
    `INSERT INTO ShoppingListItem (
      id, shoppingListId, quantity, unitId, ingredientRefId, checked,
      updatedAt, checkedAt, deletedAt, sortIndex, categoryKey, iconKey
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    values.id,
    values.shoppingListId ?? "shopping-a",
    values.quantity ?? null,
    values.unitId ?? null,
    values.ingredientRefId,
    values.checked ?? 0,
    values.updatedAt ?? "2026-01-01T00:00:00.000Z",
    values.checkedAt ?? null,
    values.deletedAt ?? null,
    values.sortIndex ?? 0,
    values.categoryKey ?? null,
    values.iconKey ?? null,
  );
}

function expectCanonicalUtc(value: string | number): void {
  expect(String(value)).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  expect(Buffer.byteLength(String(value), "utf8")).toBe(24);
}

function expectShoppingMigrationRollback(
  db: DatabaseSyncType,
  before: ShoppingItemRow[],
): void {
  expect(db.inTransaction).toBe(false);
  expect(shoppingItems(db)).toEqual(before);
  expect(
    schemaObject(
      db,
      "index",
      "ShoppingListItem_shoppingListId_unitId_ingredientRefId_key",
    ),
  ).toBeDefined();
  expect(
    schemaObject(db, "index", "ShoppingListItem_active_identity_key"),
  ).toBeUndefined();
  expect(schemaObject(db, "table", "_Migration0025Clock")).toBeUndefined();
  expect(schemaObject(db, "table", "SavedRecipe")).toBeUndefined();
  expect(tableInfo(db, "Recipe").some(({ name }) => name === "course")).toBe(
    false,
  );
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
}

function insertBackfillSubject(
  db: DatabaseSyncType,
  suffix: string,
  createdAt: string | number,
): void {
  const userId = `time-user-${suffix}`;
  const recipeId = `time-recipe-${suffix}`;
  const cookbookId = `time-cookbook-${suffix}`;
  db.prepare(
    'INSERT INTO "User" (id, email, username, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
  ).run(
    userId,
    `${suffix}@fixture.test`,
    `time-${suffix}`,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  );
  db.prepare(
    'INSERT INTO "Recipe" (id, title, chefId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
  ).run(
    recipeId,
    `Time ${suffix}`,
    userId,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  );
  db.prepare(
    'INSERT INTO "Cookbook" (id, title, authorId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
  ).run(
    cookbookId,
    `Time ${suffix}`,
    userId,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  );
  db.prepare(
    'INSERT INTO "RecipeInCookbook" (id, cookbookId, recipeId, addedById, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    `time-membership-${suffix}`,
    cookbookId,
    recipeId,
    userId,
    createdAt,
    "2099-12-31T23:59:59.999Z",
  );
}

function expectFenceAbort(
  db: DatabaseSyncType,
  mutationSql: string,
  verifyRollback: () => void,
): void {
  const mutation = db.transaction(() => {
    db.exec(
      "UPDATE Recipe SET title = 'must roll back' WHERE id = 'recipe-r1'",
    );
    db.exec(mutationSql);
  });
  expect(mutation).toThrow(/saved_recipe_cutover_pending/);
  expect(db.inTransaction).toBe(false);
  expect(
    db.prepare("SELECT title FROM Recipe WHERE id = 'recipe-r1'").pluck().get(),
  ).toBe("R1 Active");
  verifyRollback();
}

describe("migration 0025 - product schema and SavedRecipe backfill", () => {
  it("exists after the complete numeric 0000-0024 baseline", () => {
    expect(BASELINE_MIGRATIONS).toEqual(EXPECTED_BASELINE_MIGRATIONS);
    expect(
      NUMERIC_MIGRATIONS.filter(
        (fileName) => Number.parseInt(fileName.slice(0, 4), 10) === 25,
      ),
    ).toEqual([MIGRATION_FILE]);
    expect(MIGRATION_EXISTS, `${MIGRATION_FILE} must be implemented`).toBe(
      true,
    );
  });

  it("applies to an empty baseline with the exact additive product schema", () => {
    withDatabase(
      (db) => {
        expect({
          users: count(db, "SELECT COUNT(*) AS count FROM User"),
          recipes: count(db, "SELECT COUNT(*) AS count FROM Recipe"),
          cookbooks: count(db, "SELECT COUNT(*) AS count FROM Cookbook"),
          memberships: count(
            db,
            "SELECT COUNT(*) AS count FROM RecipeInCookbook",
          ),
          units: count(db, "SELECT COUNT(*) AS count FROM Unit"),
          ingredientRefs: count(
            db,
            "SELECT COUNT(*) AS count FROM IngredientRef",
          ),
        }).toEqual({
          users: 0,
          recipes: 0,
          cookbooks: 0,
          memberships: 0,
          units: 20,
          ingredientRefs: 49,
        });
        const baselineTables = (
          db
            .prepare(
              "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .all() as SchemaObjectRow[]
        ).map(({ name }) => name);
        const baselineColumns = new Map(
          baselineTables.map((table) => [table, tableInfo(db, table)]),
        );
        const baselineForeignKeys = new Map(
          baselineTables.map((table) => [table, foreignKeys(db, table)]),
        );
        const baselineTableDefinitions = new Map(
          baselineTables.map((table) => [
            table,
            normalizeSql(schemaObject(db, "table", table)?.sql ?? ""),
          ]),
        );
        const baselineRecipeSql =
          schemaObject(db, "table", "Recipe")?.sql ?? "";
        const expectedRecipeSql = baselineRecipeSql.replace(
          '    CONSTRAINT "Recipe_chefId_fkey"',
          `    ${COURSE_COLUMN_SQL},\n    CONSTRAINT "Recipe_chefId_fkey"`,
        );
        expect(expectedRecipeSql).not.toBe(baselineRecipeSql);
        const baselineDefinitions = schemaDefinitions(
          db,
          new Set([
            "index:ShoppingListItem_shoppingListId_unitId_ingredientRefId_key",
          ]),
        );
        applyMigration(db);
        const postMigrationTables = (
          db
            .prepare(
              "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .all() as SchemaObjectRow[]
        ).map(({ name }) => name);
        expect(postMigrationTables).toEqual(
          [...baselineTables, "RecipeTag", "SavedRecipe"].sort(),
        );
        for (const table of baselineTables) {
          const columns = tableInfo(db, table);
          if (table === "Recipe") {
            expect(columns.slice(0, -1)).toEqual(baselineColumns.get(table));
            expect(columns.at(-1)).toEqual({
              cid: columns.length - 1,
              name: "course",
              type: "TEXT",
              notnull: 0,
              dflt_value: null,
              pk: 0,
            });
            expect(
              normalizeSql(schemaObject(db, "table", table)?.sql ?? ""),
            ).toBe(normalizeSql(expectedRecipeSql));
          } else {
            expect(columns).toEqual(baselineColumns.get(table));
            expect(
              normalizeSql(schemaObject(db, "table", table)?.sql ?? ""),
            ).toBe(baselineTableDefinitions.get(table));
          }
          expect(foreignKeys(db, table)).toEqual(
            baselineForeignKeys.get(table),
          );
        }
        expect(
          schemaDefinitions(
            db,
            new Set([
              "index:ShoppingListItem_shoppingListId_unitId_ingredientRefId_key",
              "index:ShoppingListItem_active_identity_key",
              "index:Recipe_course_deletedAt_updatedAt_idx",
              "index:RecipeTag_recipeId_normalizedLabel_key",
              "index:RecipeTag_normalizedLabel_recipeId_idx",
              "index:SavedRecipe_userId_savedAt_recipeId_idx",
              "index:SavedRecipe_recipeId_idx",
              "trigger:SavedRecipe_cutover_block_membership_insert",
              "trigger:SavedRecipe_cutover_block_membership_delete",
            ]),
          ),
        ).toEqual(baselineDefinitions);
        expect(count(db, "SELECT COUNT(*) AS count FROM SavedRecipe")).toBe(0);
        expect(
          normalizeSql(schemaObject(db, "table", "SavedRecipe")?.sql ?? ""),
        ).toBe(normalizeSql(EXPECTED_SAVED_RECIPE_TABLE_SQL));
        expect(
          normalizeSql(schemaObject(db, "table", "RecipeTag")?.sql ?? ""),
        ).toBe(normalizeSql(EXPECTED_RECIPE_TAG_TABLE_SQL));

        expect(tableInfo(db, "SavedRecipe")).toEqual([
          {
            cid: 0,
            name: "userId",
            type: "TEXT",
            notnull: 1,
            dflt_value: null,
            pk: 1,
          },
          {
            cid: 1,
            name: "recipeId",
            type: "TEXT",
            notnull: 1,
            dflt_value: null,
            pk: 2,
          },
          {
            cid: 2,
            name: "savedAt",
            type: "TEXT",
            notnull: 1,
            dflt_value: null,
            pk: 0,
          },
        ]);
        expect(
          normalizeSql(schemaObject(db, "table", "SavedRecipe")?.sql ?? ""),
        ).toContain(normalizeSql(EXPECTED_SAVED_AT_CHECK));
        expect(
          normalizeSql(schemaObject(db, "table", "SavedRecipe")?.sql ?? ""),
        ).toContain(
          normalizeSql(
            "FOREIGN KEY (userId) REFERENCES User (id) ON DELETE CASCADE ON UPDATE CASCADE",
          ),
        );
        expect(
          normalizeSql(schemaObject(db, "table", "SavedRecipe")?.sql ?? ""),
        ).toContain(
          normalizeSql(
            "FOREIGN KEY (recipeId) REFERENCES Recipe (id) ON DELETE CASCADE ON UPDATE CASCADE",
          ),
        );
        expect(
          normalizeSql(
            schemaObject(db, "index", "SavedRecipe_userId_savedAt_recipeId_idx")
              ?.sql ?? "",
          ),
        ).toBe(
          normalizeSql(
            "CREATE INDEX SavedRecipe_userId_savedAt_recipeId_idx ON SavedRecipe(userId, savedAt, recipeId)",
          ),
        );
        expect(
          normalizeSql(
            schemaObject(db, "index", "SavedRecipe_recipeId_idx")?.sql ?? "",
          ),
        ).toBe(
          normalizeSql(
            "CREATE INDEX SavedRecipe_recipeId_idx ON SavedRecipe(recipeId)",
          ),
        );

        expect(tableInfo(db, "RecipeTag")).toEqual([
          {
            cid: 0,
            name: "id",
            type: "TEXT",
            notnull: 1,
            dflt_value: null,
            pk: 1,
          },
          {
            cid: 1,
            name: "recipeId",
            type: "TEXT",
            notnull: 1,
            dflt_value: null,
            pk: 0,
          },
          {
            cid: 2,
            name: "label",
            type: "TEXT",
            notnull: 1,
            dflt_value: null,
            pk: 0,
          },
          {
            cid: 3,
            name: "normalizedLabel",
            type: "TEXT",
            notnull: 1,
            dflt_value: null,
            pk: 0,
          },
          {
            cid: 4,
            name: "createdAt",
            type: "DATETIME",
            notnull: 1,
            dflt_value: "CURRENT_TIMESTAMP",
            pk: 0,
          },
          {
            cid: 5,
            name: "updatedAt",
            type: "DATETIME",
            notnull: 1,
            dflt_value: "CURRENT_TIMESTAMP",
            pk: 0,
          },
        ]);
        expect(
          normalizeSql(schemaObject(db, "table", "RecipeTag")?.sql ?? ""),
        ).toContain(
          normalizeSql(
            "FOREIGN KEY (recipeId) REFERENCES Recipe (id) ON DELETE CASCADE ON UPDATE CASCADE",
          ),
        );
        expect(
          normalizeSql(
            schemaObject(db, "index", "RecipeTag_recipeId_normalizedLabel_key")
              ?.sql ?? "",
          ),
        ).toBe(
          normalizeSql(
            "CREATE UNIQUE INDEX RecipeTag_recipeId_normalizedLabel_key ON RecipeTag(recipeId, normalizedLabel)",
          ),
        );
        expect(
          normalizeSql(
            schemaObject(db, "index", "RecipeTag_normalizedLabel_recipeId_idx")
              ?.sql ?? "",
          ),
        ).toBe(
          normalizeSql(
            "CREATE INDEX RecipeTag_normalizedLabel_recipeId_idx ON RecipeTag(normalizedLabel, recipeId)",
          ),
        );

        expect(
          tableInfo(db, "Recipe").find((column) => column.name === "course"),
        ).toEqual({
          cid: expect.any(Number),
          name: "course",
          type: "TEXT",
          notnull: 0,
          dflt_value: null,
          pk: 0,
        });
        expect(
          normalizeSql(schemaObject(db, "table", "Recipe")?.sql ?? ""),
        ).toContain(
          normalizeSql(
            "CHECK (course IS NULL OR course IN ('main','side','appetizer','dessert'))",
          ),
        );
        expect(
          normalizeSql(
            schemaObject(db, "index", "Recipe_course_deletedAt_updatedAt_idx")
              ?.sql ?? "",
          ),
        ).toBe(
          normalizeSql(
            "CREATE INDEX Recipe_course_deletedAt_updatedAt_idx ON Recipe(course, deletedAt, updatedAt)",
          ),
        );

        const cookNamedTables = (
          db
            .prepare(
              "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND lower(name) LIKE '%cook%' ORDER BY name",
            )
            .all() as SchemaObjectRow[]
        ).map(({ name }) => name);
        expect(cookNamedTables).toEqual(["Cookbook", "RecipeInCookbook"]);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      },
      { migrate: false },
    );
  });

  it("backfills exactly four distinct saves from authoritative membership createdAt", () => {
    withDatabase(
      (db) => {
        const usersBefore = tableRows(db, "User");
        const recipesBefore = tableRows(db, "Recipe");
        const cookbooksBefore = tableRows(db, "Cookbook");
        const membershipsBefore = tableRows(db, "RecipeInCookbook");

        applyMigration(db);

        expect(tableRows(db, "User")).toEqual(usersBefore);
        const recipesAfter = tableRows(db, "Recipe");
        expect(recipesAfter.map(({ course }) => course)).toEqual([
          null,
          null,
          null,
        ]);
        expect(
          recipesAfter.map(({ course: _course, ...recipe }) => recipe),
        ).toEqual(recipesBefore);
        expect(tableRows(db, "Cookbook")).toEqual(cookbooksBefore);
        expect(tableRows(db, "RecipeInCookbook")).toEqual(membershipsBefore);
        expect(count(db, "SELECT COUNT(*) AS count FROM RecipeTag")).toBe(0);

        const rows = db
          .prepare(
            "SELECT userId, recipeId, savedAt FROM SavedRecipe ORDER BY userId, recipeId",
          )
          .all() as SavedRecipeRow[];
        expect(rows).toEqual([
          {
            userId: "user-a",
            recipeId: "recipe-r1",
            savedAt: "2026-01-03T00:00:00.000Z",
          },
          {
            userId: "user-a",
            recipeId: "recipe-r2",
            savedAt: "2026-01-02T00:00:00.000Z",
          },
          {
            userId: "user-a",
            recipeId: "recipe-r3",
            savedAt: "2026-01-04T00:00:00.000Z",
          },
          {
            userId: "user-b",
            recipeId: "recipe-r1",
            savedAt: "2026-01-05T00:00:00.000Z",
          },
        ]);
        expect(
          count(
            db,
            "SELECT COUNT(*) AS count FROM SavedRecipe WHERE typeof(savedAt) = 'text' AND length(savedAt) = 24 AND length(CAST(savedAt AS BLOB)) = 24",
          ),
        ).toBe(4);
        expect(
          count(
            db,
            "SELECT COUNT(*) AS count FROM SavedRecipe JOIN Recipe ON Recipe.id = SavedRecipe.recipeId WHERE Recipe.deletedAt IS NOT NULL",
          ),
        ).toBe(1);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      },
      { fixture: true, migrate: false },
    );
  });

  it("ignores RecipeInCookbook.updatedAt even when it is later", () => {
    withDatabase(
      (db) => {
        db.prepare(
          "UPDATE RecipeInCookbook SET updatedAt = ? WHERE id = 'membership-2'",
        ).run("2099-12-31T23:59:59.999Z");
        applyMigration(db);
        expect(
          db
            .prepare(
              "SELECT updatedAt FROM RecipeInCookbook WHERE id = 'membership-2'",
            )
            .pluck()
            .get(),
        ).toBe("2099-12-31T23:59:59.999Z");
        expect(
          db
            .prepare(
              "SELECT savedAt FROM SavedRecipe WHERE userId = 'user-a' AND recipeId = 'recipe-r1'",
            )
            .pluck()
            .get(),
        ).toBe("2026-01-03T00:00:00.000Z");
      },
      { fixture: true, migrate: false },
    );
  });

  it("normalizes integers, half-away-from-zero reals, boundaries, and all five text grammars", () => {
    withDatabase(
      (db) => {
        const cases: Array<[string, string | number, string]> = [
          ["integer", 0, "1970-01-01T00:00:00.000Z"],
          ["real-positive-half", 0.5, "1970-01-01T00:00:00.001Z"],
          ["real-negative-half", -0.5, "1969-12-31T23:59:59.999Z"],
          ["negative-in-range", -1, "1969-12-31T23:59:59.999Z"],
          ["minimum", -62167219200000, "0000-01-01T00:00:00.000Z"],
          ["maximum", 253402300799999, "9999-12-31T23:59:59.999Z"],
          ["space", "2024-02-29 12:34:56", "2024-02-29T12:34:56.000Z"],
          ["zulu", "2024-02-29T12:34:56Z", "2024-02-29T12:34:56.000Z"],
          [
            "millis-zulu",
            "2024-02-29T12:34:56.789Z",
            "2024-02-29T12:34:56.789Z",
          ],
          [
            "positive-fourteen",
            "2024-02-29T12:34:56+14:00",
            "2024-02-28T22:34:56.000Z",
          ],
          [
            "negative-fourteen",
            "2024-02-29T12:34:56.789-14:00",
            "2024-03-01T02:34:56.789Z",
          ],
          [
            "negative-offset-minutes-no-millis",
            "2024-02-29T12:34:56-13:59",
            "2024-03-01T02:33:56.000Z",
          ],
          [
            "positive-offset-minutes-millis",
            "2024-02-29T12:34:56.789+13:59",
            "2024-02-28T22:35:56.789Z",
          ],
        ];
        for (const [suffix, input] of cases)
          insertBackfillSubject(db, suffix, input);

        expect(
          db
            .prepare(
              "SELECT typeof(createdAt) FROM RecipeInCookbook WHERE id = 'time-membership-integer'",
            )
            .pluck()
            .get(),
        ).toBe("integer");
        expect(
          db
            .prepare(
              "SELECT typeof(createdAt) FROM RecipeInCookbook WHERE id = 'time-membership-real-positive-half'",
            )
            .pluck()
            .get(),
        ).toBe("real");

        applyMigration(db);

        for (const [suffix, , expected] of cases) {
          expect(
            db
              .prepare(
                "SELECT savedAt FROM SavedRecipe WHERE userId = ? AND recipeId = ?",
              )
              .pluck()
              .get(`time-user-${suffix}`, `time-recipe-${suffix}`),
          ).toBe(expected);
        }
      },
      { migrate: false },
    );
  });

  it("normalizes before choosing the latest distinct cookbook membership", () => {
    withDatabase(
      (db) => {
        insertBackfillSubject(
          db,
          "normalized-max",
          "2024-03-01T00:00:00-14:00",
        );
        db.exec(`
          INSERT INTO Cookbook (id, title, authorId, createdAt, updatedAt)
          VALUES (
            'time-cookbook-normalized-max-2',
            'Time normalized max 2',
            'time-user-normalized-max',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          );
          INSERT INTO RecipeInCookbook (
            id, cookbookId, recipeId, addedById, createdAt, updatedAt
          ) VALUES (
            'time-membership-normalized-max-2',
            'time-cookbook-normalized-max-2',
            'time-recipe-normalized-max',
            'time-user-normalized-max',
            '2024-03-01T23:00:00+14:00',
            '2099-12-31T23:59:59.999Z'
          );
        `);

        applyMigration(db);

        expect(
          db
            .prepare(
              "SELECT savedAt FROM SavedRecipe WHERE userId = 'time-user-normalized-max' AND recipeId = 'time-recipe-normalized-max'",
            )
            .pluck()
            .get(),
        ).toBe("2024-03-01T14:00:00.000Z");
      },
      { migrate: false },
    );
  });

  it.each([
    ["positive infinity", "1e999"],
    ["negative infinity", "-1e999"],
    ["above maximum", "253402300800000"],
    ["below minimum", "-62167219200001"],
    ["half-rounds above maximum", "253402300799999.5"],
    ["half-rounds below minimum", "-62167219200000.5"],
    ["arbitrary modifier", "'now'"],
    ["date only", "'2024-02-29'"],
    ["T without zone", "'2024-02-29T12:34:56'"],
    ["space with zone", "'2024-02-29 12:34:56Z'"],
    ["lowercase separators", "'2024-02-29t12:34:56z'"],
    ["offset without colon", "'2024-02-29T12:34:56+1400'"],
    ["short fractional seconds", "'2024-02-29T12:34:56.78Z'"],
    ["extra fractional digits", "'2024-02-29T12:34:56.7890Z'"],
    ["non-ASCII digit", "'２０24-02-29T12:34:56.789Z'"],
    ["impossible month", "'2024-13-01T12:34:56Z'"],
    ["zero day", "'2024-02-00T12:34:56Z'"],
    ["impossible day", "'2023-02-29T12:34:56Z'"],
    ["month day overflow", "'2024-04-31T12:34:56Z'"],
    ["24 hour", "'2024-02-29T24:00:00Z'"],
    ["leap second", "'2024-02-29T23:59:60Z'"],
    ["minute overflow", "'2024-02-29T12:60:00Z'"],
    ["positive offset beyond fourteen", "'2024-02-29T12:34:56+14:01'"],
    ["negative offset beyond fourteen", "'2024-02-29T12:34:56-14:01'"],
    ["fifteen hour offset", "'2024-02-29T12:34:56+15:00'"],
    ["negative fifteen hour offset", "'2024-02-29T12:34:56-15:00'"],
    ["offset minute overflow", "'2024-02-29T12:34:56+13:60'"],
    ["normalizes below four-digit year", "'0000-01-01T00:00:00+14:00'"],
    ["normalizes above four-digit year", "'9999-12-31T23:59:59.999-14:00'"],
  ])("aborts atomically for invalid legacy time: %s", (_label, sqlValue) => {
    withDatabase(
      (db) => {
        insertBackfillSubject(db, "invalid", "2024-02-29T12:34:56Z");
        db.prepare(
          "UPDATE RecipeInCookbook SET createdAt = 0 WHERE id = 'time-membership-invalid'",
        ).run();
        db.exec(
          `UPDATE RecipeInCookbook SET createdAt = ${sqlValue} WHERE id = 'time-membership-invalid'`,
        );

        expect(() => applyMigration(db)).toThrow();
        expect(db.inTransaction).toBe(false);
        expect(
          tableInfo(db, "Recipe").some(({ name }) => name === "course"),
        ).toBe(false);
        expect(schemaObject(db, "table", "SavedRecipe")).toBeUndefined();
        expect(schemaObject(db, "table", "RecipeTag")).toBeUndefined();
        expect(
          schemaObject(db, "index", "Recipe_course_deletedAt_updatedAt_idx"),
        ).toBeUndefined();
        expect(
          count(
            db,
            "SELECT COUNT(*) AS count FROM RecipeInCookbook WHERE id = 'time-membership-invalid'",
          ),
        ).toBe(1);
        expect(
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'SavedRecipe_cutover_%'",
            )
            .all(),
        ).toEqual([]);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      },
      { migrate: false },
    );
  });

  it("records the driver-level NaN limitation before migration evaluation", () => {
    withDatabase(
      (db) => {
        insertBackfillSubject(db, "nan", "2024-02-29T12:34:56Z");
        expect(() =>
          db
            .prepare(
              "UPDATE RecipeInCookbook SET createdAt = ? WHERE id = 'time-membership-nan'",
            )
            .run(Number.NaN),
        ).toThrow(/NOT NULL/);
        expect(
          db
            .prepare(
              "SELECT createdAt FROM RecipeInCookbook WHERE id = 'time-membership-nan'",
            )
            .pluck()
            .get(),
        ).toBe("2024-02-29T12:34:56Z");
      },
      { migrate: false },
    );
  });

  it("aborts when an invalid membership shares a save key with a valid membership", () => {
    withDatabase(
      (db) => {
        insertBackfillSubject(db, "mixed-validity", "2024-02-29T12:34:56.789Z");
        db.exec(`
          INSERT INTO Cookbook (id, title, authorId, createdAt, updatedAt)
          VALUES (
            'time-cookbook-mixed-validity-2',
            'Time mixed validity 2',
            'time-user-mixed-validity',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          );
          INSERT INTO RecipeInCookbook (
            id, cookbookId, recipeId, addedById, createdAt, updatedAt
          ) VALUES (
            'time-membership-mixed-validity-2',
            'time-cookbook-mixed-validity-2',
            'time-recipe-mixed-validity',
            'time-user-mixed-validity',
            'not-a-time',
            CURRENT_TIMESTAMP
          );
        `);

        expect(() => applyMigration(db)).toThrow();
        expect(db.inTransaction).toBe(false);
        expect(schemaObject(db, "table", "SavedRecipe")).toBeUndefined();
        expect(
          count(
            db,
            "SELECT COUNT(*) AS count FROM RecipeInCookbook WHERE recipeId = 'time-recipe-mixed-validity'",
          ),
        ).toBe(2);
      },
      { migrate: false },
    );
  });

  it("enforces the full canonical savedAt CHECK on direct raw writes", () => {
    withDatabase(
      (db) => {
        db.exec(`
          INSERT INTO Recipe (id, title, chefId, createdAt, updatedAt)
          VALUES
            ('raw-recipe', 'Raw check', 'user-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
            ('raw-min', 'Raw minimum', 'user-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
            ('raw-max', 'Raw maximum', 'user-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
        `);
        const insert = db.prepare(
          "INSERT INTO SavedRecipe (userId, recipeId, savedAt) VALUES ('user-a', 'raw-recipe', ?)",
        );
        const invalidValues: unknown[] = [
          null,
          1700000000000,
          Buffer.from("2024-02-29T12:34:56.789Z"),
          "2024-02-29T12:34:56Z",
          "2024-02-29T12:34:56.7890Z",
          "202A-02-29T12:34:56.789Z",
          "2024-0A-29T12:34:56.789Z",
          "2024-02-2AT12:34:56.789Z",
          "2024-02-29TA2:34:56.789Z",
          "2024-02-29T12:A4:56.789Z",
          "2024-02-29T12:34:A6.789Z",
          "2024-02-29T12:34:56.7A9Z",
          "2024/02-29T12:34:56.789Z",
          "2024-02/29T12:34:56.789Z",
          "2024-02-29 12:34:56.789Z",
          "2024-02-29T12-34:56.789Z",
          "2024-02-29T12:34-56.789Z",
          "2024-02-29T12:34:56,789Z",
          "2024-02-29T12:34:56.789z",
          "2023-02-29T12:34:56.789Z",
          "2024-04-31T12:34:56.789Z",
          "2024-02-29T24:00:00.000Z",
          "2024-02-29T12:60:00.000Z",
          "2024-02-29T12:34:60.000Z",
          "２０24-02-29T12:34:56.789Z",
        ];
        for (const value of invalidValues) {
          expect(() => insert.run(value)).toThrow();
        }
        expect(
          count(
            db,
            "SELECT COUNT(*) AS count FROM SavedRecipe WHERE recipeId = 'raw-recipe'",
          ),
        ).toBe(0);
        expect(() => insert.run("2024-02-29T12:34:56.789Z")).not.toThrow();
        expect(() =>
          db
            .prepare(
              "INSERT INTO SavedRecipe (userId, recipeId, savedAt) VALUES ('user-a', 'raw-min', '0000-01-01T00:00:00.000Z')",
            )
            .run(),
        ).not.toThrow();
        expect(() =>
          db
            .prepare(
              "INSERT INTO SavedRecipe (userId, recipeId, savedAt) VALUES ('user-a', 'raw-max', '9999-12-31T23:59:59.999Z')",
            )
            .run(),
        ).not.toThrow();
      },
      { fixture: true },
    );
  });

  it("accepts only the frozen course values and enforces product foreign keys", () => {
    withDatabase(
      (db) => {
        for (const course of [null, "main", "side", "appetizer", "dessert"]) {
          expect(() =>
            db
              .prepare("UPDATE Recipe SET course = ? WHERE id = 'recipe-r1'")
              .run(course),
          ).not.toThrow();
        }
        expect(() =>
          db
            .prepare(
              "UPDATE Recipe SET course = 'breakfast' WHERE id = 'recipe-r1'",
            )
            .run(),
        ).toThrow();
        expect(() =>
          db
            .prepare(
              "INSERT INTO SavedRecipe (userId, recipeId, savedAt) VALUES ('user-a', 'recipe-r1', '2026-01-06T00:00:00.000Z')",
            )
            .run(),
        ).toThrow();
        db.prepare(
          "INSERT INTO RecipeTag (id, recipeId, label, normalizedLabel) VALUES ('tag-dinner', 'recipe-r1', 'Dinner', 'dinner')",
        ).run();
        expect(() =>
          db
            .prepare(
              "INSERT INTO RecipeTag (id, recipeId, label, normalizedLabel) VALUES ('tag-dinner-duplicate', 'recipe-r1', 'DINNER', 'dinner')",
            )
            .run(),
        ).toThrow();
        expect(() =>
          db
            .prepare(
              "INSERT INTO SavedRecipe (userId, recipeId, savedAt) VALUES ('missing-user', 'recipe-r1', '2026-01-01T00:00:00.000Z')",
            )
            .run(),
        ).toThrow();
        expect(() =>
          db
            .prepare(
              "INSERT INTO SavedRecipe (userId, recipeId, savedAt) VALUES ('user-a', 'missing-recipe', '2026-01-01T00:00:00.000Z')",
            )
            .run(),
        ).toThrow();
        expect(() =>
          db
            .prepare(
              "INSERT INTO RecipeTag (id, recipeId, label, normalizedLabel) VALUES ('missing-tag', 'missing-recipe', 'Dinner', 'dinner')",
            )
            .run(),
        ).toThrow();
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      },
      { fixture: true },
    );
  });

  it("creates exactly the two cutover triggers with the frozen abort body", () => {
    withDatabase((db) => {
      const triggers = db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'RecipeInCookbook' ORDER BY name",
        )
        .all() as SchemaObjectRow[];
      expect(triggers.map(({ name }) => name)).toEqual([
        "SavedRecipe_cutover_block_membership_delete",
        "SavedRecipe_cutover_block_membership_insert",
      ]);
      expect(normalizeSql(triggers[0].sql ?? "")).toBe(
        normalizeSql(
          "CREATE TRIGGER SavedRecipe_cutover_block_membership_delete BEFORE DELETE ON RecipeInCookbook BEGIN SELECT RAISE(ABORT, 'saved_recipe_cutover_pending'); END",
        ),
      );
      expect(normalizeSql(triggers[1].sql ?? "")).toBe(
        normalizeSql(
          "CREATE TRIGGER SavedRecipe_cutover_block_membership_insert BEFORE INSERT ON RecipeInCookbook BEGIN SELECT RAISE(ABORT, 'saved_recipe_cutover_pending'); END",
        ),
      );
    });
  });

  it("blocks membership insert and rolls back its enclosing transaction", () => {
    withDatabase(
      (db) => {
        expectFenceAbort(
          db,
          `INSERT INTO Cookbook (id, title, authorId, createdAt, updatedAt)
           VALUES ('blocked-cookbook', 'Blocked cookbook', 'user-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
           INSERT INTO RecipeInCookbook (id, cookbookId, recipeId, addedById, createdAt, updatedAt)
           VALUES ('blocked-insert', 'blocked-cookbook', 'recipe-r2', 'user-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          () => {
            expect(
              count(
                db,
                "SELECT COUNT(*) AS count FROM RecipeInCookbook WHERE id = 'blocked-insert'",
              ),
            ).toBe(0);
            expect(
              count(
                db,
                "SELECT COUNT(*) AS count FROM Cookbook WHERE id = 'blocked-cookbook'",
              ),
            ).toBe(0);
          },
        );
      },
      { fixture: true },
    );
  });

  it("blocks membership delete and rolls back its enclosing transaction", () => {
    withDatabase(
      (db) => {
        expectFenceAbort(
          db,
          "DELETE FROM RecipeInCookbook WHERE id = 'membership-1'",
          () => {
            expect(
              count(
                db,
                "SELECT COUNT(*) AS count FROM RecipeInCookbook WHERE id = 'membership-1'",
              ),
            ).toBe(1);
          },
        );
      },
      { fixture: true },
    );
  });

  it("blocks cookbook and user delete cascades and rolls back both transactions", () => {
    withDatabase(
      (db) => {
        db.exec(`
          INSERT INTO User (id, email, username, createdAt, updatedAt)
          VALUES ('cascade-user', 'cascade@fixture.test', 'cascade-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
          INSERT INTO Cookbook (id, title, authorId, createdAt, updatedAt)
          VALUES ('cascade-cookbook', 'Cascade cookbook', 'cascade-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
          INSERT INTO RecipeInCookbook (
            id, cookbookId, recipeId, addedById, createdAt, updatedAt
          ) VALUES (
            'cascade-membership',
            'cascade-cookbook',
            'recipe-r2',
            'user-a',
            '2026-01-06T00:00:00.000Z',
            '2026-01-06T00:00:00.000Z'
          );
        `);
        applyMigration(db);
        expectFenceAbort(
          db,
          "DELETE FROM Cookbook WHERE id = 'cookbook-a1'",
          () => {
            expect(
              count(
                db,
                "SELECT COUNT(*) AS count FROM Cookbook WHERE id = 'cookbook-a1'",
              ),
            ).toBe(1);
            expect(
              count(
                db,
                "SELECT COUNT(*) AS count FROM RecipeInCookbook WHERE cookbookId = 'cookbook-a1'",
              ),
            ).toBe(3);
          },
        );
        expectFenceAbort(
          db,
          "DELETE FROM User WHERE id = 'cascade-user'",
          () => {
            expect(
              count(
                db,
                "SELECT COUNT(*) AS count FROM User WHERE id = 'cascade-user'",
              ),
            ).toBe(1);
            expect(
              count(
                db,
                "SELECT COUNT(*) AS count FROM SavedRecipe WHERE userId = 'cascade-user'",
              ),
            ).toBe(1);
          },
        );
      },
      { fixture: true, migrate: false },
    );
  });

  it("leaves saved state independent after the exact cutover fences are removed", () => {
    withDatabase(
      (db) => {
        const before = db
          .prepare(
            "SELECT userId, recipeId, savedAt FROM SavedRecipe ORDER BY userId, recipeId",
          )
          .all();
        db.exec(`
          DROP TRIGGER SavedRecipe_cutover_block_membership_insert;
          DROP TRIGGER SavedRecipe_cutover_block_membership_delete;
          INSERT INTO RecipeInCookbook (
            id, cookbookId, recipeId, addedById, createdAt, updatedAt
          ) VALUES (
            'post-cutover-membership',
            'cookbook-a2',
            'recipe-r2',
            'user-a',
            '2026-02-01T00:00:00.000Z',
            '2026-02-01T00:00:00.000Z'
          );
          DELETE FROM RecipeInCookbook WHERE id = 'post-cutover-membership';
        `);
        expect(
          db
            .prepare(
              "SELECT userId, recipeId, savedAt FROM SavedRecipe ORDER BY userId, recipeId",
            )
            .all(),
        ).toEqual(before);
      },
      { fixture: true },
    );
  });

  it("keeps saves on soft delete and cascades them on hard recipe delete", () => {
    withDatabase(
      (db) => {
        db.prepare(
          "UPDATE Recipe SET deletedAt = ? WHERE id = 'recipe-r1'",
        ).run("2026-02-01T00:00:00.000Z");
        expect(
          count(
            db,
            "SELECT COUNT(*) AS count FROM SavedRecipe WHERE recipeId = 'recipe-r1'",
          ),
        ).toBe(2);

        db.exec(`
          INSERT INTO Recipe (id, title, chefId, createdAt, updatedAt)
          VALUES ('hard-delete-recipe', 'Hard delete', 'user-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
          INSERT INTO SavedRecipe (userId, recipeId, savedAt)
          VALUES ('user-a', 'hard-delete-recipe', '2026-02-01T00:00:00.000Z');
          INSERT INTO RecipeTag (id, recipeId, label, normalizedLabel)
          VALUES ('hard-delete-tag', 'hard-delete-recipe', 'Dinner', 'dinner');
          DELETE FROM Recipe WHERE id = 'hard-delete-recipe';
        `);
        expect(
          count(
            db,
            "SELECT COUNT(*) AS count FROM SavedRecipe WHERE recipeId = 'hard-delete-recipe'",
          ),
        ).toBe(0);
        expect(
          count(
            db,
            "SELECT COUNT(*) AS count FROM RecipeTag WHERE recipeId = 'hard-delete-recipe'",
          ),
        ).toBe(0);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      },
      { fixture: true },
    );
  });
});

describe("migration 0025 - shopping identity repair", () => {
  it("freezes the one-row clock, exact index, setup parity, and Unit 3 conflict target", () => {
    const normalizedMigration = normalizeSql(MIGRATION_SQL);
    const normalizedClockTable = normalizeSql(MIGRATION_CLOCK_TABLE_SQL);
    const normalizedClockExpression = normalizeSql(MIGRATION_CLOCK_EXPRESSION);
    const normalizedIndex = normalizeSql(ACTIVE_IDENTITY_INDEX_SQL);
    const normalizedSetupIndex = normalizeSql(SETUP_ACTIVE_IDENTITY_INDEX_SQL);

    expect(normalizedMigration).toContain(normalizedClockTable);
    expect(normalizedMigration.split(normalizedClockExpression)).toHaveLength(
      2,
    );
    expect(normalizedMigration).toContain(
      normalizeSql(`
        INSERT INTO "_Migration0025Clock" (
          "singleton", "boundNowMs", "boundNowText"
        )
        SELECT
          1,
          "captured"."boundNowMs",
          strftime(
            '%Y-%m-%dT%H:%M:%fZ',
            "captured"."boundNowMs" / 1000.0,
            'unixepoch'
          )
        FROM (
          SELECT ${MIGRATION_CLOCK_EXPRESSION} AS "boundNowMs"
        ) AS "captured"
      `),
    );
    expect(normalizedMigration).toContain(
      normalizeSql('DROP TABLE "_Migration0025Clock"'),
    );
    expect(normalizedMigration.match(/'now'/g)).toHaveLength(1);
    expect(normalizedMigration).toContain(
      normalizeSql(MIGRATION_CLOCK_REPAIR_JOIN_SQL),
    );
    expect(normalizedMigration).toContain("migration_clock.boundNowMs");
    expect(normalizedMigration).toContain("migration_clock.boundNowText");
    expect(normalizedMigration).toContain(
      normalizeSql(
        'DROP INDEX "ShoppingListItem_shoppingListId_unitId_ingredientRefId_key"',
      ),
    );
    expect(normalizedMigration).toContain(normalizedIndex);
    expect(normalizedMigration).not.toContain(normalizedSetupIndex);

    expect(normalizeSql(TEST_SETUP_SOURCE)).toContain(normalizedSetupIndex);
    expect(
      TEST_SETUP_SOURCE.indexOf("ShoppingListItem_active_identity_key"),
    ).toBeGreaterThan(
      TEST_SETUP_SOURCE.indexOf("await db.shoppingListItem.deleteMany"),
    );
    expect(
      normalizeSql(SETUP_ACTIVE_IDENTITY_INDEX_SQL).replace(
        "CREATE UNIQUE INDEX IF NOT EXISTS",
        "CREATE UNIQUE INDEX",
      ),
    ).toBe(normalizedIndex);
    expect(normalizeSql(PRODUCT_DATA_CONTRACT)).toContain(
      normalizeSql(UNIT_3_CONFLICT_TARGET_SQL),
    );
  });

  it("rolls back without replacing a pre-existing migration-clock table", () => {
    withDatabase(
      (db) => {
        db.exec(`
          CREATE TABLE "_Migration0025Clock" (
            "sentinel" TEXT NOT NULL
          );
          INSERT INTO "_Migration0025Clock" ("sentinel") VALUES ('keep-me');
        `);
        const before = shoppingItems(db);

        expect(() => applyMigration(db)).toThrow();
        expect(db.inTransaction).toBe(false);
        expect(shoppingItems(db)).toEqual(before);
        expect(
          db
            .prepare('SELECT sentinel FROM "_Migration0025Clock"')
            .pluck()
            .get(),
        ).toBe("keep-me");
        expect(schemaObject(db, "table", "SavedRecipe")).toBeUndefined();
        expect(
          tableInfo(db, "Recipe").some(({ name }) => name === "course"),
        ).toBe(false);
        expect(
          schemaObject(
            db,
            "index",
            "ShoppingListItem_shoppingListId_unitId_ingredientRefId_key",
          ),
        ).toBeDefined();
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      },
      { fixture: true, migrate: false },
    );
  });

  it("repairs the frozen fixture with one captured clock and enforces active-only uniqueness", () => {
    withDatabase(
      (db) => {
        const before = shoppingItems(db);
        expect(before.map(({ id }) => id)).toEqual([
          "item-a",
          "item-b",
          "item-c",
        ]);

        applyMigration(db);

        const survivor = shoppingItem(db, "item-b");
        const firstExtra = shoppingItem(db, "item-a");
        const secondExtra = shoppingItem(db, "item-c");
        expect(survivor).toMatchObject({
          quantity: 3,
          checked: 0,
          checkedAt: null,
          deletedAt: null,
          sortIndex: 1,
        });
        expect(firstExtra).toMatchObject({
          quantity: 1,
          checked: 0,
          checkedAt: null,
          sortIndex: 2,
        });
        expect(secondExtra).toMatchObject({
          quantity: null,
          checked: 0,
          checkedAt: null,
          sortIndex: 3,
        });
        expect(firstExtra.deletedAt).toBe(survivor.updatedAt);
        expect(secondExtra.deletedAt).toBe(survivor.updatedAt);
        expect(firstExtra.updatedAt).toBe(survivor.updatedAt);
        expect(secondExtra.updatedAt).toBe(survivor.updatedAt);
        expectCanonicalUtc(survivor.updatedAt);
        expect(
          schemaObject(db, "table", "_Migration0025Clock"),
        ).toBeUndefined();
        expect(
          schemaObject(
            db,
            "index",
            "ShoppingListItem_shoppingListId_unitId_ingredientRefId_key",
          ),
        ).toBeUndefined();
        expect(
          normalizeSql(
            schemaObject(db, "index", "ShoppingListItem_active_identity_key")
              ?.sql ?? "",
          ),
        ).toBe(normalizeSql(ACTIVE_IDENTITY_INDEX_SQL));

        expect(() =>
          addShoppingItem(db, {
            id: "active-duplicate",
            ingredientRefId: "ingredient-flour",
          }),
        ).toThrow(
          /UNIQUE constraint failed: index 'ShoppingListItem_active_identity_key'/,
        );
        expect(() =>
          db.exec(`
            INSERT INTO ShoppingListItem (
              id, shoppingListId, quantity, unitId, ingredientRefId, checked,
              updatedAt, checkedAt, deletedAt, sortIndex, categoryKey, iconKey
            ) VALUES (
              'conflict-target-probe', 'shopping-a', 4, NULL,
              'ingredient-flour', 0, '2026-01-01T00:00:00.000Z', NULL, NULL,
              50, NULL, NULL
            )
            ${UNIT_3_CONFLICT_TARGET_SQL}
            DO NOTHING;
          `),
        ).not.toThrow();
        expect(
          count(
            db,
            "SELECT COUNT(*) AS count FROM ShoppingListItem WHERE ingredientRefId = 'ingredient-flour' AND deletedAt IS NULL",
          ),
        ).toBe(1);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      },
      { fixture: true, migrate: false },
    );
  });

  it("uses BINARY survivor order and reconciles quantity, checked state, and metadata deterministically", () => {
    withDatabase(
      (db) => {
        for (const id of [
          "binary-ref",
          "all-null-ref",
          "mixed-ref",
          "all-checked-ref",
          "checked-null-ref",
          "max-finite-ref",
          "metadata-ref",
          "negative-ref",
          "tombstone-ref",
          "weird-checked-ref",
        ]) {
          addIngredientRef(db, id);
        }

        addShoppingItem(db, {
          id: "a-binary-extra",
          ingredientRefId: "binary-ref",
          quantity: 2,
          checked: 1,
          checkedAt: "2026-01-03T00:00:00.000Z",
          sortIndex: 7,
          categoryKey: "extra-category",
          iconKey: "fallback-icon",
        });
        addShoppingItem(db, {
          id: "binary-same-identity-tombstone",
          ingredientRefId: "binary-ref",
          quantity: 100,
          checked: 1,
          updatedAt: "2025-02-01T00:00:00.000Z",
          checkedAt: "2025-02-01T00:00:00.000Z",
          deletedAt: "2025-02-02T00:00:00.000Z",
          sortIndex: 0,
          categoryKey: "tombstone-category",
          iconKey: "tombstone-icon",
        });
        addShoppingItem(db, {
          id: "A-binary-survivor",
          ingredientRefId: "binary-ref",
          quantity: 1,
          checked: 0,
          sortIndex: 7,
          categoryKey: "survivor-category",
        });
        addShoppingItem(db, {
          id: "null-survivor",
          ingredientRefId: "all-null-ref",
          quantity: null,
          checked: 1,
          sortIndex: 1,
        });
        addShoppingItem(db, {
          id: "null-extra",
          ingredientRefId: "all-null-ref",
          quantity: null,
          checked: 1,
          sortIndex: 2,
        });
        addShoppingItem(db, {
          id: "mixed-survivor",
          ingredientRefId: "mixed-ref",
          quantity: null,
          checked: 1,
          checkedAt: "2026-01-04T00:00:00.000Z",
          sortIndex: 1,
        });
        addShoppingItem(db, {
          id: "mixed-second",
          ingredientRefId: "mixed-ref",
          quantity: 1,
          checked: 0,
          checkedAt: "2026-01-02T00:00:00.000Z",
          sortIndex: 2,
        });
        addShoppingItem(db, {
          id: "mixed-third",
          ingredientRefId: "mixed-ref",
          quantity: 2.5,
          checked: 1,
          checkedAt: "2026-01-03T00:00:00.000Z",
          sortIndex: 3,
        });
        addShoppingItem(db, {
          id: "checked-survivor",
          ingredientRefId: "all-checked-ref",
          checked: 1,
          checkedAt: "2026-01-04T00:00:00.000Z",
          sortIndex: 1,
        });
        addShoppingItem(db, {
          id: "checked-logical",
          ingredientRefId: "all-checked-ref",
          checked: 0,
          checkedAt: "2026-01-02T00:00:00.000Z",
          sortIndex: 2,
        });
        addShoppingItem(db, {
          id: "checked-null-survivor",
          ingredientRefId: "checked-null-ref",
          checked: 1,
          sortIndex: 1,
        });
        addShoppingItem(db, {
          id: "checked-null-extra",
          ingredientRefId: "checked-null-ref",
          checked: 1,
          sortIndex: 2,
        });
        addShoppingItem(db, {
          id: "max-survivor",
          ingredientRefId: "max-finite-ref",
          quantity: 8.988465674311579e307,
          sortIndex: 1,
        });
        addShoppingItem(db, {
          id: "max-extra",
          ingredientRefId: "max-finite-ref",
          quantity: 8.988465674311579e307,
          sortIndex: 2,
        });
        addShoppingItem(db, {
          id: "metadata-survivor",
          ingredientRefId: "metadata-ref",
          sortIndex: 1,
        });
        addShoppingItem(db, {
          id: "metadata-first-extra",
          ingredientRefId: "metadata-ref",
          sortIndex: 2,
          categoryKey: "first-category",
          iconKey: "first-icon",
        });
        addShoppingItem(db, {
          id: "metadata-second-extra",
          ingredientRefId: "metadata-ref",
          sortIndex: 3,
          categoryKey: "second-category",
          iconKey: "second-icon",
        });
        addShoppingItem(db, {
          id: "negative-survivor",
          ingredientRefId: "negative-ref",
          quantity: -1,
          sortIndex: 1,
        });
        addShoppingItem(db, {
          id: "negative-extra",
          ingredientRefId: "negative-ref",
          quantity: -2.5,
          sortIndex: 2,
        });
        addShoppingItem(db, {
          id: "weird-checked-survivor",
          ingredientRefId: "weird-checked-ref",
          checked: 2,
          sortIndex: 1,
        });
        addShoppingItem(db, {
          id: "weird-checked-extra",
          ingredientRefId: "weird-checked-ref",
          checked: 1,
          sortIndex: 2,
        });
        addShoppingItem(db, {
          id: "existing-tombstone",
          ingredientRefId: "tombstone-ref",
          quantity: 9,
          checked: 1,
          updatedAt: "2025-01-01T00:00:00.000Z",
          checkedAt: "2025-01-01T00:00:00.000Z",
          deletedAt: "2025-01-02T00:00:00.000Z",
          sortIndex: 99,
          categoryKey: "untouched-category",
          iconKey: "untouched-icon",
        });
        const binaryExtraBefore = shoppingItem(db, "a-binary-extra");
        const sameIdentityTombstoneBefore = shoppingItem(
          db,
          "binary-same-identity-tombstone",
        );
        const tombstoneBefore = shoppingItem(db, "existing-tombstone");

        applyMigration(db);

        expect(shoppingItem(db, "A-binary-survivor")).toMatchObject({
          quantity: 3,
          checked: 0,
          checkedAt: null,
          deletedAt: null,
          categoryKey: "survivor-category",
          iconKey: "fallback-icon",
        });
        const binaryExtraAfter = shoppingItem(db, "a-binary-extra");
        expect(binaryExtraAfter).toEqual({
          ...binaryExtraBefore,
          updatedAt: binaryExtraAfter.updatedAt,
          deletedAt: binaryExtraAfter.updatedAt,
        });
        expect(shoppingItem(db, "null-survivor")).toMatchObject({
          quantity: null,
          checked: 1,
          checkedAt: null,
          deletedAt: null,
        });
        expect(shoppingItem(db, "mixed-survivor")).toMatchObject({
          quantity: 3.5,
          checked: 1,
          checkedAt: "2026-01-02T00:00:00.000Z",
          deletedAt: null,
        });
        expect(shoppingItem(db, "checked-survivor")).toMatchObject({
          checked: 1,
          checkedAt: "2026-01-02T00:00:00.000Z",
          deletedAt: null,
        });
        expect(shoppingItem(db, "checked-null-survivor")).toMatchObject({
          checked: 1,
          checkedAt: null,
          deletedAt: null,
        });
        expect(shoppingItem(db, "max-survivor").quantity).toBe(
          1.7976931348623157e308,
        );
        expect(shoppingItem(db, "metadata-survivor")).toMatchObject({
          categoryKey: "first-category",
          iconKey: "first-icon",
          deletedAt: null,
        });
        expect(shoppingItem(db, "negative-survivor")).toMatchObject({
          quantity: -3.5,
          deletedAt: null,
        });
        expect(shoppingItem(db, "weird-checked-survivor")).toMatchObject({
          checked: 0,
          checkedAt: null,
          deletedAt: null,
        });
        expect(shoppingItem(db, "binary-same-identity-tombstone")).toEqual(
          sameIdentityTombstoneBefore,
        );
        expect(shoppingItem(db, "existing-tombstone")).toEqual(tombstoneBefore);

        const repaired = shoppingItems(db).filter(
          ({ id }) =>
            id !== "existing-tombstone" &&
            id !== "binary-same-identity-tombstone",
        );
        expect(new Set(repaired.map(({ updatedAt }) => updatedAt)).size).toBe(
          1,
        );
        expectCanonicalUtc(repaired[0].updatedAt);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      },
      { fixture: true, migrate: false },
    );
  });

  it.each([
    ["positive infinity", "1e999"],
    ["negative infinity", "-1e999"],
    ["non-numeric text", "'not-numeric'"],
    ["blob", "X'01'"],
  ])("rolls back an invalid quantity source: %s", (_label, sqlValue) => {
    withDatabase(
      (db) => {
        addIngredientRef(db, "invalid-quantity-ref");
        addShoppingItem(db, {
          id: "invalid-quantity-item",
          ingredientRefId: "invalid-quantity-ref",
          quantity: 1,
        });
        db.exec(
          `UPDATE ShoppingListItem SET quantity = ${sqlValue} WHERE id = 'invalid-quantity-item'`,
        );
        const before = shoppingItems(db);

        expect(() => applyMigration(db)).toThrow();
        expectShoppingMigrationRollback(db, before);
      },
      { fixture: true, migrate: false },
    );
  });

  it("rolls back when finite quantity sources overflow in aggregate", () => {
    withDatabase(
      (db) => {
        addIngredientRef(db, "overflow-ref");
        addShoppingItem(db, {
          id: "overflow-survivor",
          ingredientRefId: "overflow-ref",
          quantity: 1.7976931348623157e308,
          sortIndex: 1,
        });
        addShoppingItem(db, {
          id: "overflow-extra",
          ingredientRefId: "overflow-ref",
          quantity: 1.7976931348623157e308,
          sortIndex: 2,
        });
        const before = shoppingItems(db);

        expect(() => applyMigration(db)).toThrow();
        expectShoppingMigrationRollback(db, before);
      },
      { fixture: true, migrate: false },
    );
  });

  it("rolls back when finite negative quantity sources overflow in aggregate", () => {
    withDatabase(
      (db) => {
        addIngredientRef(db, "negative-overflow-ref");
        addShoppingItem(db, {
          id: "negative-overflow-survivor",
          ingredientRefId: "negative-overflow-ref",
          quantity: -1.7976931348623157e308,
          sortIndex: 1,
        });
        addShoppingItem(db, {
          id: "negative-overflow-extra",
          ingredientRefId: "negative-overflow-ref",
          quantity: -1.7976931348623157e308,
          sortIndex: 2,
        });
        const before = shoppingItems(db);

        expect(() => applyMigration(db)).toThrow();
        expectShoppingMigrationRollback(db, before);
      },
      { fixture: true, migrate: false },
    );
  });

  it("records that the SQLite driver converts a bound NaN quantity to null", () => {
    withDatabase(
      (db) => {
        addIngredientRef(db, "nan-quantity-ref");
        addShoppingItem(db, {
          id: "nan-quantity-item",
          ingredientRefId: "nan-quantity-ref",
          quantity: 1,
        });
        db.prepare(
          "UPDATE ShoppingListItem SET quantity = ? WHERE id = 'nan-quantity-item'",
        ).run(Number.NaN);
        expect(
          db
            .prepare(
              "SELECT quantity FROM ShoppingListItem WHERE id = 'nan-quantity-item'",
            )
            .pluck()
            .get(),
        ).toBeNull();
      },
      { fixture: true, migrate: false },
    );
  });

  it("keeps null, empty, and arbitrary unit identities collision-free", () => {
    withDatabase(
      (db) => {
        addIngredientRef(db, "unit-collision-ref");
        db.exec(`
          INSERT INTO Unit (id, name, updatedAt) VALUES
            ('', 'empty-unit', '2026-01-01T00:00:00.000Z'),
            ('n:', 'n-prefix-unit', '2026-01-01T00:00:00.000Z'),
            ('u:x', 'u-prefix-unit', '2026-01-01T00:00:00.000Z');
        `);
        addShoppingItem(db, {
          id: "unit-null",
          ingredientRefId: "unit-collision-ref",
          unitId: null,
        });
        addShoppingItem(db, {
          id: "unit-empty",
          ingredientRefId: "unit-collision-ref",
          unitId: "",
        });
        addShoppingItem(db, {
          id: "unit-n-prefix",
          ingredientRefId: "unit-collision-ref",
          unitId: "n:",
        });
        addShoppingItem(db, {
          id: "unit-u-prefix",
          ingredientRefId: "unit-collision-ref",
          unitId: "u:x",
        });

        applyMigration(db);

        expect(
          db
            .prepare(
              `SELECT id, unitId FROM ShoppingListItem
               WHERE ingredientRefId = 'unit-collision-ref' AND deletedAt IS NULL
               ORDER BY id`,
            )
            .all(),
        ).toEqual([
          { id: "unit-empty", unitId: "" },
          { id: "unit-n-prefix", unitId: "n:" },
          { id: "unit-null", unitId: null },
          { id: "unit-u-prefix", unitId: "u:x" },
        ]);
      },
      { fixture: true, migrate: false },
    );
  });

  it.each([
    [
      "user",
      (db: DatabaseSyncType) =>
        db.exec(
          "UPDATE User SET updatedAt = '9000-01-01T00:00:00.000Z' WHERE id = 'user-a'",
        ),
    ],
    [
      "owned active recipe",
      (db: DatabaseSyncType) =>
        db.exec(
          "UPDATE Recipe SET updatedAt = '9000-01-01T00:00:00.000Z' WHERE id = 'recipe-r1'",
        ),
    ],
    [
      "owned cookbook",
      (db: DatabaseSyncType) =>
        db.exec(
          "UPDATE Cookbook SET updatedAt = '9000-01-01T00:00:00.000Z' WHERE id = 'cookbook-a1'",
        ),
    ],
    [
      "native-sync tombstone",
      (db: DatabaseSyncType) =>
        db.exec(`
          INSERT INTO NativeSyncTombstone (
            id, accountId, resourceType, resourceId, deletedAt, updatedAt, createdAt
          ) VALUES (
            'high-water-tombstone', 'user-a', 'recipe', 'deleted-resource',
            '8999-12-31T00:00:00.000Z', '9000-01-01T00:00:00.000Z',
            '8999-12-31T00:00:00.000Z'
          )
        `),
    ],
    [
      "owned shopping list",
      (db: DatabaseSyncType) =>
        db.exec(
          "UPDATE ShoppingList SET updatedAt = '9000-01-01T00:00:00.000Z' WHERE id = 'shopping-a'",
        ),
    ],
    [
      "active shopping item",
      (db: DatabaseSyncType) =>
        db.exec(
          "UPDATE ShoppingListItem SET updatedAt = '9000-01-01T00:00:00.000Z' WHERE id = 'item-a'",
        ),
    ],
    [
      "deleted shopping item",
      (db: DatabaseSyncType) => {
        addIngredientRef(db, "high-water-deleted-ref");
        addShoppingItem(db, {
          id: "high-water-deleted-item",
          ingredientRefId: "high-water-deleted-ref",
          updatedAt: "9000-01-01T00:00:00.000Z",
          deletedAt: "8999-12-31T00:00:00.000Z",
        });
      },
    ],
  ])(
    "advances repaired rows past the account-global %s high-water",
    (_label, setup) => {
      withDatabase(
        (db) => {
          setup(db);

          applyMigration(db);

          for (const id of ["item-a", "item-b", "item-c"]) {
            expect(shoppingItem(db, id).updatedAt).toBe(
              "9000-01-01T00:00:00.001Z",
            );
          }
        },
        { fixture: true, migrate: false },
      );
    },
  );

  it.each([
    [
      "user",
      (db: DatabaseSyncType) =>
        db.exec(
          "UPDATE User SET updatedAt = '9000-01-01T00:00:00.000Z' WHERE id = 'user-b'",
        ),
    ],
    [
      "active recipe",
      (db: DatabaseSyncType) =>
        db.exec(`
          INSERT INTO Recipe (id, title, chefId, createdAt, updatedAt)
          VALUES (
            'foreign-high-water-recipe', 'Foreign high water', 'user-b',
            '2026-01-01T00:00:00.000Z', '9000-01-01T00:00:00.000Z'
          )
        `),
    ],
    [
      "cookbook",
      (db: DatabaseSyncType) =>
        db.exec(
          "UPDATE Cookbook SET updatedAt = '9000-01-01T00:00:00.000Z' WHERE id = 'cookbook-b1'",
        ),
    ],
    [
      "native-sync tombstone",
      (db: DatabaseSyncType) =>
        db.exec(`
          INSERT INTO NativeSyncTombstone (
            id, accountId, resourceType, resourceId, deletedAt, updatedAt, createdAt
          ) VALUES (
            'foreign-high-water-tombstone', 'user-b', 'recipe',
            'foreign-deleted-resource', '8999-12-31T00:00:00.000Z',
            '9000-01-01T00:00:00.000Z', '8999-12-31T00:00:00.000Z'
          )
        `),
    ],
    [
      "shopping list",
      (db: DatabaseSyncType) =>
        db.exec(`
          INSERT INTO ShoppingList (id, authorId, createdAt, updatedAt)
          VALUES (
            'foreign-high-water-list', 'user-b',
            '2026-01-01T00:00:00.000Z', '9000-01-01T00:00:00.000Z'
          )
        `),
    ],
    [
      "active shopping item",
      (db: DatabaseSyncType) => {
        db.exec(`
          INSERT INTO ShoppingList (id, authorId, createdAt, updatedAt)
          VALUES (
            'foreign-high-water-list', 'user-b',
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          )
        `);
        addIngredientRef(db, "foreign-high-water-active-ref");
        addShoppingItem(db, {
          id: "foreign-high-water-active-item",
          shoppingListId: "foreign-high-water-list",
          ingredientRefId: "foreign-high-water-active-ref",
          updatedAt: "9000-01-01T00:00:00.000Z",
        });
      },
    ],
    [
      "deleted shopping item",
      (db: DatabaseSyncType) => {
        db.exec(`
          INSERT INTO ShoppingList (id, authorId, createdAt, updatedAt)
          VALUES (
            'foreign-high-water-list', 'user-b',
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          )
        `);
        addIngredientRef(db, "foreign-high-water-deleted-ref");
        addShoppingItem(db, {
          id: "foreign-high-water-deleted-item",
          shoppingListId: "foreign-high-water-list",
          ingredientRefId: "foreign-high-water-deleted-ref",
          updatedAt: "9000-01-01T00:00:00.000Z",
          deletedAt: "8999-12-31T00:00:00.000Z",
        });
      },
    ],
  ])("ignores another owner's %s high-water", (_label, setup) => {
    withDatabase(
      (db) => {
        setup(db);
        db.exec(
          "UPDATE Cookbook SET updatedAt = '2030-01-01T00:00:00.000Z' WHERE id = 'cookbook-a1'",
        );

        applyMigration(db);

        expect(shoppingItem(db, "item-b").updatedAt).toBe(
          "2030-01-01T00:00:00.001Z",
        );
      },
      { fixture: true, migrate: false },
    );
  });

  it.each([
    [
      "user",
      (db: DatabaseSyncType) =>
        db.exec("UPDATE User SET updatedAt = 'not-a-time' WHERE id = 'user-a'"),
    ],
    [
      "active recipe",
      (db: DatabaseSyncType) =>
        db.exec(
          "UPDATE Recipe SET updatedAt = 'not-a-time' WHERE id = 'recipe-r1'",
        ),
    ],
    [
      "cookbook",
      (db: DatabaseSyncType) =>
        db.exec(
          "UPDATE Cookbook SET updatedAt = 'not-a-time' WHERE id = 'cookbook-a1'",
        ),
    ],
    [
      "native-sync tombstone",
      (db: DatabaseSyncType) =>
        db.exec(`
          INSERT INTO NativeSyncTombstone (
            id, accountId, resourceType, resourceId, deletedAt, updatedAt, createdAt
          ) VALUES (
            'invalid-high-water-tombstone', 'user-a', 'recipe',
            'invalid-deleted-resource', '2026-01-01T00:00:00.000Z',
            'not-a-time', '2026-01-01T00:00:00.000Z'
          )
        `),
    ],
    [
      "shopping list",
      (db: DatabaseSyncType) =>
        db.exec(
          "UPDATE ShoppingList SET updatedAt = 'not-a-time' WHERE id = 'shopping-a'",
        ),
    ],
    [
      "active shopping item",
      (db: DatabaseSyncType) =>
        db.exec(
          "UPDATE ShoppingListItem SET updatedAt = 'not-a-time' WHERE id = 'item-a'",
        ),
    ],
    [
      "deleted shopping item",
      (db: DatabaseSyncType) => {
        addIngredientRef(db, "invalid-high-water-deleted-ref");
        addShoppingItem(db, {
          id: "invalid-high-water-deleted-item",
          ingredientRefId: "invalid-high-water-deleted-ref",
          updatedAt: "not-a-time",
          deletedAt: "2026-01-01T00:00:00.000Z",
        });
      },
    ],
  ])("rolls back an invalid owned %s high-water", (_label, setup) => {
    withDatabase(
      (db) => {
        setup(db);
        const before = shoppingItems(db);

        expect(() => applyMigration(db)).toThrow();
        expectShoppingMigrationRollback(db, before);
      },
      { fixture: true, migrate: false },
    );
  });

  it("truncates numeric real cursors before advancing the owner high-water", () => {
    withDatabase(
      (db) => {
        db.prepare(
          "UPDATE Recipe SET updatedAt = ? WHERE id = 'recipe-r1'",
        ).run(221845392000000.9);

        applyMigration(db);

        expect(shoppingItem(db, "item-b").updatedAt).toBe(
          "9000-01-01T00:00:00.001Z",
        );
      },
      { fixture: true, migrate: false },
    );
  });

  it("ignores another owner and an owned deleted recipe when choosing high-water", () => {
    withDatabase(
      (db) => {
        db.exec(`
          UPDATE User
          SET updatedAt = '9001-01-01T00:00:00.000Z'
          WHERE id = 'user-b';
          UPDATE Recipe
          SET updatedAt = '9002-01-01T00:00:00.000Z'
          WHERE id = 'recipe-r3';
          UPDATE Cookbook
          SET updatedAt = '2030-01-01T00:00:00.000Z'
          WHERE id = 'cookbook-a1';
        `);

        applyMigration(db);

        expect(shoppingItem(db, "item-b").updatedAt).toBe(
          "2030-01-01T00:00:00.001Z",
        );
      },
      { fixture: true, migrate: false },
    );
  });

  it.each([
    ["invalid text", "'not-a-time'"],
    ["positive infinity", "1e999"],
    ["negative infinity", "-1e999"],
  ])("rolls back an invalid owner high-water: %s", (_label, sqlValue) => {
    withDatabase(
      (db) => {
        db.exec(`UPDATE User SET updatedAt = ${sqlValue} WHERE id = 'user-a'`);
        const before = shoppingItems(db);

        expect(() => applyMigration(db)).toThrow();
        expectShoppingMigrationRollback(db, before);
      },
      { fixture: true, migrate: false },
    );
  });

  it("rolls back when advancing the maximum supported cursor would overflow", () => {
    withDatabase(
      (db) => {
        db.prepare("UPDATE User SET updatedAt = ? WHERE id = 'user-a'").run(
          253402300799999,
        );
        const before = shoppingItems(db);

        expect(() => applyMigration(db)).toThrow();
        expectShoppingMigrationRollback(db, before);
      },
      { fixture: true, migrate: false },
    );
  });
});
