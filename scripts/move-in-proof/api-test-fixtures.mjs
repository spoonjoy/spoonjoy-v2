// Builds the move-in API reader's test fixtures from the move-in proof's fixtures (the move-in-proof-fixtures-v1
// release, unzipped): for each source version, a few recipes exactly as its server's API returned them, and the same
// recipes' rows from that kitchen's backup database, with every user's password and token left out. A unit test then
// checks that the API reader and the backup reader make the same draft of the same recipe.
//
//   node scripts/move-in-proof/api-test-fixtures.mjs <unzipped release folder>
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stableStringify } from "./kitchen.mjs";

const VERSIONS = ["v1.12.0", "v2.8.0", "v3.31.0"];
const SLUGS = ["crunchy-rabbit-steak", "bitter-ebiten-maki", "creamy-turkey-steak"];
const OUT = "test/domains/move-in/support/mealie-api";
// The tables a recipe draft reads, and how each one ties to the chosen recipes or to their kitchen.
const BY_RECIPE = ["recipes_ingredients", "recipe_instructions", "notes", "recipe_settings", "recipes_to_tags", "recipes_to_categories", "recipes_to_tools"];
const BY_GROUP = ["tags", "categories", "tools", "ingredient_foods", "ingredient_units"];
const USER_COLUMNS = ["id", "email", "full_name", "username", "group_id", "household_id"];

const key = (value) => String(value).replace(/-/g, "").toLowerCase();

const release = process.argv[2];
if (!release) throw new Error("Give the unzipped move-in-proof-fixtures-v1 release folder.");
rmSync(OUT, { recursive: true, force: true });
for (const version of VERSIONS) {
  const kitchen = path.join(release, version, "small");
  const database = JSON.parse(execFileSync("unzip", ["-p", path.join(kitchen, "backup.zip"), "database.json"], { maxBuffer: 1 << 28 }).toString());
  const recipes = SLUGS.map((slug) => JSON.parse(readFileSync(path.join(kitchen, "recipes", `${slug}.json`), "utf8")));
  const ids = new Set(recipes.map((recipe) => key(recipe.id)));
  const group = key(recipes[0].groupId);
  const steps = new Set(database.recipe_instructions.filter((row) => ids.has(key(row.recipe_id))).map((row) => key(row.id)));
  const trimmed = {
    alembic_version: database.alembic_version,
    groups: database.groups.filter((row) => key(row.id) === group),
    users: database.users.filter((row) => key(row.group_id) === group).map((row) => Object.fromEntries(USER_COLUMNS.filter((column) => column in row).map((column) => [column, row[column]]))),
    recipes: database.recipes.filter((row) => ids.has(key(row.id))),
    recipe_ingredient_ref_link: database.recipe_ingredient_ref_link.filter((row) => steps.has(key(row.instruction_id))),
  };
  if ("households" in database) trimmed.households = database.households.filter((row) => key(row.group_id) === group);
  for (const table of BY_RECIPE) trimmed[table] = (database[table] ?? []).filter((row) => ids.has(key(row.recipe_id)));
  for (const table of BY_GROUP) trimmed[table] = (database[table] ?? []).filter((row) => key(row.group_id) === group);
  const out = path.join(OUT, version);
  mkdirSync(path.join(out, "recipes"), { recursive: true });
  writeFileSync(path.join(out, "database.json"), `${stableStringify(trimmed, 2)}\n`);
  for (const recipe of recipes) writeFileSync(path.join(out, "recipes", `${recipe.slug}.json`), `${stableStringify(recipe, 2)}\n`);
  console.log(`${version}: ${recipes.length} recipes, ${trimmed.users.length} users`);
}
