#!/usr/bin/env node
import { execFileSync } from "node:child_process";

export const QA_SEED_USER_ID = "sj-qa-demo-chef";
export const QA_SEED_EMAIL = "sj-qa-demo-chef@example.com";
export const QA_SEED_USERNAME = "sj_qa_demo_chef";
export const QA_SEED_RECIPE_ID = "sj-qa-demo-recipe";
export const QA_SEED_RECIPE_TITLE = "sj-qa-demo lemon rice";
export const QA_SEED_STEP_ID = "sj-qa-demo-step-1";
export const QA_SEED_UNIT_ID = "sj-qa-demo-unit-cup";
export const QA_SEED_INGREDIENT_REF_ID = "sj-qa-demo-ingredient-rice";
export const QA_SEED_INGREDIENT_ID = "sj-qa-demo-ingredient-1";

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildQaSeedSql() {
  return [
    `INSERT OR IGNORE INTO "User" (id, email, username, hashedPassword, salt, photoUrl, createdAt, updatedAt) VALUES (${sqlString(QA_SEED_USER_ID)}, ${sqlString(QA_SEED_EMAIL)}, ${sqlString(QA_SEED_USERNAME)}, ${sqlString("$2a$10$sjQaDemoHashPlaceholder0000000000000000000000000000000000000000")}, ${sqlString("sj-qa-demo-salt")}, ${sqlString("/images/chef-rj.png")}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    `INSERT OR IGNORE INTO Unit (id, name, updatedAt) VALUES (${sqlString(QA_SEED_UNIT_ID)}, ${sqlString("sj-qa-demo cup")}, CURRENT_TIMESTAMP);`,
    `INSERT OR IGNORE INTO IngredientRef (id, name, updatedAt) VALUES (${sqlString(QA_SEED_INGREDIENT_REF_ID)}, ${sqlString("sj-qa-demo rice")}, CURRENT_TIMESTAMP);`,
    `INSERT OR IGNORE INTO Recipe (id, title, description, servings, chefId, deletedAt, sourceRecipeId, sourceUrl, activeCoverId, activeCoverVariant, coverMode, createdAt, updatedAt) VALUES (${sqlString(QA_SEED_RECIPE_ID)}, ${sqlString(QA_SEED_RECIPE_TITLE)}, ${sqlString("Disposable QA seed recipe for smoke tests and manual verification.")}, ${sqlString("2 servings")}, ${sqlString(QA_SEED_USER_ID)}, NULL, NULL, NULL, NULL, NULL, ${sqlString("auto")}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    `INSERT OR IGNORE INTO RecipeStep (id, recipeId, stepNum, stepTitle, description, duration, updatedAt) VALUES (${sqlString(QA_SEED_STEP_ID)}, ${sqlString(QA_SEED_RECIPE_ID)}, 1, ${sqlString("Warm the pan")}, ${sqlString("Warm rice with lemon and herbs until fragrant.")}, 10, CURRENT_TIMESTAMP);`,
    `INSERT OR IGNORE INTO Ingredient (id, recipeId, stepNum, quantity, unitId, ingredientRefId, updatedAt) VALUES (${sqlString(QA_SEED_INGREDIENT_ID)}, ${sqlString(QA_SEED_RECIPE_ID)}, 1, 1, ${sqlString(QA_SEED_UNIT_ID)}, ${sqlString(QA_SEED_INGREDIENT_REF_ID)}, CURRENT_TIMESTAMP);`,
  ].join("\n");
}

export function wranglerQaSeedArgs(sql) {
  return ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", "qa", "--command", sql];
}

export function parseSeedQaArgs(argv) {
  const targetEnvIndex = argv.indexOf("--target-env");
  const targetEnv = targetEnvIndex === -1 ? undefined : argv[targetEnvIndex + 1];
  if (targetEnv !== "qa") {
    throw new Error("seed-qa refuses non-QA targets; run with `--target-env qa`.");
  }
  return {
    targetEnv,
    dryRun: argv.includes("--dry-run"),
  };
}

export function main(argv = process.argv.slice(2), execFile = execFileSync, io = console) {
  const options = parseSeedQaArgs(argv);
  const sql = buildQaSeedSql();

  if (options.dryRun) {
    io.log(sql);
    return;
  }

  execFile("pnpm", wranglerQaSeedArgs(sql), { stdio: "inherit" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
