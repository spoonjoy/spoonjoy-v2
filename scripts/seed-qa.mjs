#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function stampDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase();
}

function disposableToken(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "run";
}

export function createQaSeedRun({
  now = () => new Date(),
  random = () => randomUUID(),
} = {}) {
  const stamp = stampDate(now());
  const token = disposableToken(random());
  const base = `codex-qa-seed-${stamp}-${token}`;
  return {
    stamp,
    token,
    user: {
      id: `${base}-chef`,
      email: `${base}@example.com`,
      username: base.replaceAll("-", "_"),
    },
    recipe: {
      id: `${base}-recipe`,
      title: `codex QA seed lemon rice ${stamp} ${token}`,
    },
    step: { id: `${base}-step-1` },
    unit: { id: `${base}-unit-cup`, name: `${base} cup` },
    ingredientRef: { id: `${base}-ingredient-rice`, name: `${base} rice` },
    ingredient: { id: `${base}-ingredient-1` },
  };
}

export function buildQaSeedSql(seedRun = createQaSeedRun()) {
  return [
    `INSERT INTO "User" (id, email, username, photoUrl, createdAt, updatedAt) VALUES (${sqlString(seedRun.user.id)}, ${sqlString(seedRun.user.email)}, ${sqlString(seedRun.user.username)}, ${sqlString("/images/chef-rj.png")}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    `INSERT INTO Unit (id, name, updatedAt) VALUES (${sqlString(seedRun.unit.id)}, ${sqlString(seedRun.unit.name)}, CURRENT_TIMESTAMP);`,
    `INSERT INTO IngredientRef (id, name, updatedAt) VALUES (${sqlString(seedRun.ingredientRef.id)}, ${sqlString(seedRun.ingredientRef.name)}, CURRENT_TIMESTAMP);`,
    `INSERT INTO Recipe (id, title, description, servings, chefId, deletedAt, sourceRecipeId, sourceUrl, activeCoverId, activeCoverVariant, coverMode, createdAt, updatedAt) VALUES (${sqlString(seedRun.recipe.id)}, ${sqlString(seedRun.recipe.title)}, ${sqlString("Disposable QA seed recipe for smoke tests and manual verification.")}, ${sqlString("2 servings")}, ${sqlString(seedRun.user.id)}, NULL, NULL, NULL, NULL, NULL, ${sqlString("auto")}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    `INSERT INTO RecipeStep (id, recipeId, stepNum, stepTitle, description, duration, updatedAt) VALUES (${sqlString(seedRun.step.id)}, ${sqlString(seedRun.recipe.id)}, 1, ${sqlString("Warm the pan")}, ${sqlString("Warm rice with lemon and herbs until fragrant.")}, 10, CURRENT_TIMESTAMP);`,
    `INSERT INTO Ingredient (id, recipeId, stepNum, quantity, unitId, ingredientRefId, updatedAt) VALUES (${sqlString(seedRun.ingredient.id)}, ${sqlString(seedRun.recipe.id)}, 1, 1, ${sqlString(seedRun.unit.id)}, ${sqlString(seedRun.ingredientRef.id)}, CURRENT_TIMESTAMP);`,
  ].join("\n");
}

export function buildQaSeedTeardownSql(seedRun) {
  return [
    `DELETE FROM Ingredient WHERE id = ${sqlString(seedRun.ingredient.id)};`,
    `DELETE FROM RecipeStep WHERE id = ${sqlString(seedRun.step.id)};`,
    `DELETE FROM Recipe WHERE id = ${sqlString(seedRun.recipe.id)} AND chefId = ${sqlString(seedRun.user.id)};`,
    `DELETE FROM IngredientRef WHERE id = ${sqlString(seedRun.ingredientRef.id)};`,
    `DELETE FROM Unit WHERE id = ${sqlString(seedRun.unit.id)};`,
    `DELETE FROM "User" WHERE id = ${sqlString(seedRun.user.id)} AND email = ${sqlString(seedRun.user.email)};`,
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
    skipTeardown: argv.includes("--skip-teardown"),
  };
}

export function main(argv = process.argv.slice(2), execFile = execFileSync, io = console) {
  const options = parseSeedQaArgs(argv);
  const seedRun = createQaSeedRun();
  const seedSql = buildQaSeedSql(seedRun);
  const teardownSql = buildQaSeedTeardownSql(seedRun);

  if (options.dryRun) {
    io.log([seedSql, teardownSql].join("\n"));
    return;
  }

  if (options.skipTeardown) {
    execFile("pnpm", wranglerQaSeedArgs(seedSql), { stdio: "inherit" });
    return;
  }

  let seedError;
  try {
    execFile("pnpm", wranglerQaSeedArgs(seedSql), { stdio: "inherit" });
  } catch (error) {
    seedError = error;
    throw error;
  } finally {
    try {
      execFile("pnpm", wranglerQaSeedArgs(teardownSql), { stdio: "inherit" });
    } catch (teardownError) {
      if (seedError) {
        throw new AggregateError([seedError, teardownError], "QA seed and teardown both failed");
      }
      throw teardownError;
    }
  }
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
