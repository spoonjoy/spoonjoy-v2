#!/usr/bin/env node
// Resets three permanent QA personas (chef, friend, newbie) and their kitchen content
// to a known state, with a fresh, per-run password for each persona. CI runs this before
// Playwright journeys sign in as them against the real QA mirror (spoonjoy-v2-qa / D1
// spoonjoy-qa). See docs on scripts/seed-qa.mjs for the disposable-seed sibling script
// this follows in house style (sqlString, arg parsing that refuses non-QA targets,
// injectable execFile, CLI guard).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";

export const KITCHEN = Object.freeze({
  chef: { id: "qa-kitchen-chef", username: "qa_kitchen_chef", email: "qa-kitchen-chef@example.com" },
  friend: { id: "qa-kitchen-friend", username: "qa_kitchen_friend", email: "qa-kitchen-friend@example.com" },
  newbie: { id: "qa-kitchen-newbie", username: "qa_kitchen_newbie", email: "qa-kitchen-newbie@example.com" },
  recipes: {
    lemonRice: { id: "qa-kitchen-recipe-lemon-rice", chef: "chef", title: "Lemon Herb Rice" },
    tomatoSoup: { id: "qa-kitchen-recipe-tomato-soup", chef: "chef", title: "Roasted Tomato Soup" },
    risotto: { id: "qa-kitchen-recipe-risotto", chef: "friend", title: "Saffron Risotto" },
    salmon: { id: "qa-kitchen-recipe-salmon", chef: "friend", title: "Miso Glazed Salmon" },
  },
  cookbooks: {
    weeknight: { id: "qa-kitchen-cookbook-weeknight", title: "Weeknight Dinners" },
    soups: { id: "qa-kitchen-cookbook-soups", title: "Soups" },
  },
});

// Recipe content: steps (with an optional StepOutputUse) and per-step ingredients.
// Units and ingredient refs are shared, named lookup tables — see buildKitchenResetSql,
// which inserts them with INSERT OR IGNORE and references every other row by name
// through a subquery, since a row with the same name may already exist under another id.
const RECIPE_CONTENT = {
  lemonRice: {
    steps: [
      { stepNum: 1, stepTitle: "Cook the rice", description: "Simmer rice in stock until tender." },
      { stepNum: 2, stepTitle: "Make the dressing", description: "Whisk lemon juice, zest and herbs." },
      { stepNum: 3, stepTitle: "Combine", description: "Fold the dressing through the cooked rice." },
    ],
    ingredients: [
      { stepNum: 1, quantity: 1, unit: "cup", ref: "jasmine rice" },
      { stepNum: 1, quantity: 2, unit: "cup", ref: "chicken stock" },
      { stepNum: 2, quantity: 1, unit: "whole", ref: "lemon" },
      { stepNum: 2, quantity: 0.25, unit: "cup", ref: "parsley" },
    ],
    // Step 3 ("Combine") folds in the output of step 1 ("Cook the rice").
    stepOutputUses: [{ outputStepNum: 1, inputStepNum: 3 }],
  },
  tomatoSoup: {
    steps: [
      { stepNum: 1, stepTitle: "Roast", description: "Roast tomatoes and garlic until blistered." },
      { stepNum: 2, stepTitle: "Blend", description: "Blend with stock until smooth." },
    ],
    ingredients: [
      { stepNum: 1, quantity: 6, unit: "whole", ref: "tomato" },
      { stepNum: 1, quantity: 4, unit: "clove", ref: "garlic" },
      { stepNum: 2, quantity: 2, unit: "cup", ref: "vegetable stock" },
    ],
    stepOutputUses: [],
  },
  risotto: {
    steps: [
      { stepNum: 1, stepTitle: "Bloom saffron", description: "Steep saffron in warm stock." },
      { stepNum: 2, stepTitle: "Toast rice", description: "Toast arborio in butter." },
      { stepNum: 3, stepTitle: "Finish", description: "Add stock gradually and stir until creamy." },
    ],
    ingredients: [
      { stepNum: 1, quantity: 0.5, unit: "teaspoon", ref: "saffron" },
      { stepNum: 1, quantity: 4, unit: "cup", ref: "chicken stock" },
      { stepNum: 2, quantity: 1.5, unit: "cup", ref: "arborio rice" },
      { stepNum: 2, quantity: 2, unit: "tablespoon", ref: "butter" },
    ],
    stepOutputUses: [],
  },
  salmon: {
    steps: [
      { stepNum: 1, stepTitle: "Glaze", description: "Mix miso, mirin and honey." },
      { stepNum: 2, stepTitle: "Roast", description: "Brush salmon and roast." },
    ],
    ingredients: [
      { stepNum: 1, quantity: 2, unit: "tablespoon", ref: "white miso" },
      { stepNum: 1, quantity: 1, unit: "tablespoon", ref: "mirin" },
      { stepNum: 2, quantity: 2, unit: "fillet", ref: "salmon" },
    ],
    stepOutputUses: [],
  },
};

const UNITS = ["cup", "whole", "clove", "teaspoon", "tablespoon", "fillet"];

const INGREDIENT_REFS = [
  "jasmine rice",
  "chicken stock",
  "lemon",
  "parsley",
  "tomato",
  "garlic",
  "vegetable stock",
  "saffron",
  "arborio rice",
  "butter",
  "white miso",
  "mirin",
  "salmon",
];

// Chef owns both cookbooks; the Weeknight Dinners cookbook includes friend's Saffron
// Risotto, added by chef (the cookbook author), not by the recipe's own chef.
const COOKBOOK_ENTRIES = [
  { cookbook: "weeknight", recipe: "lemonRice" },
  { cookbook: "weeknight", recipe: "risotto" },
  { cookbook: "soups", recipe: "tomatoSoup" },
];

// Chef's shopping list: three unchecked items, reusing ingredients already on the
// Lemon Herb Rice recipe.
const SHOPPING_LIST_ITEMS = [
  { quantity: 1, unit: "cup", ref: "jasmine rice" },
  { quantity: 1, unit: "whole", ref: "lemon" },
  { quantity: 0.25, unit: "cup", ref: "parsley" },
];

const BCRYPT_HASH_PATTERN = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{22,53}/g;

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const PERSONA_IDS = [KITCHEN.chef.id, KITCHEN.friend.id, KITCHEN.newbie.id];

function sqlIdList(ids) {
  return ids.map(sqlString).join(", ");
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function generatePersonaPasswords(random = randomBytes) {
  return {
    chef: random(24).toString("base64url"),
    friend: random(24).toString("base64url"),
    newbie: random(24).toString("base64url"),
  };
}

// Number of per-run scratch users seeded alongside the three kitchen personas. Journeys that
// change data use one of these (via support/personas.ts's scratch(n)) instead of signing up a
// throwaway user through /signup, so they stop spending QA's shared auth rate limit
// (AUTH_IP_RATE_LIMITER, 60/minute in QA — see docs/deployment.md). Each scratch index is owned
// by exactly one journey file (see AGENTS.md's Validation section for the assignment table) —
// 6 is exactly today's assignment table; see personas.setup.ts's budget comment for the
// accounting before raising this further.
export const SCRATCH_USER_COUNT = 6;

// Token shape follows e2e/support/disposable-auth.ts's createDisposableE2EUser() and this
// script's own sibling scripts/seed-qa.mjs (duplicated, not imported — this file's top-of-file
// comment notes it follows that script's dependency-free, unit-testable house style), sanitized
// down to lowercase alphanumerics only.
function disposableToken(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "run";
}

// Email prefix this generator mints going forward (no other script or e2e helper uses it). Kept
// short, like the whole generated id below: Cloudflare D1 caps a LIKE/GLOB pattern at 50 bytes,
// and scripts/cleanup-local-qa-data.mjs's disposable-row blockers build patterns from a row's
// id — a long id was exactly what broke that in QA before these ids were shortened (D1 error
// SQLITE_ERROR 7500, "LIKE or GLOB pattern too complex"); cleanup itself now builds those
// specific blockers with instr(...) instead of a concatenated LIKE pattern, which has no length
// limit, but ids here stay short regardless, in case another LIKE/GLOB pattern is ever built
// from one. buildScratchInvalidationSql matches a broader pattern than this exact prefix, to
// still catch older scratch users minted before this shortening — see its own comment.
const SCRATCH_EMAIL_PREFIX = "codex-e2e-s-";

// Generates `count` scratch user identities for this run. Every one shares a single run token
// (an 8-character random segment, no timestamp — see SCRATCH_EMAIL_PREFIX on why these stay
// short) baked into both email and username, so a concurrent run, or a leftover run whose
// cleanup didn't get to run, can never collide with this run's scratch users: no generated id
// exceeds 40 characters. Scratch users own no data (no recipes, cookbooks, or shopping lists),
// so there is no persona-style drift to reset here — only identity.
export function generateScratchUsers(count = SCRATCH_USER_COUNT, { random = randomBytes } = {}) {
  // 4 bytes (32 bits) of randomness is what fits the 40-character id budget above; that's still
  // plenty of entropy for run-to-run uniqueness (this is a collision-avoidance token, not a
  // security secret).
  const runToken = disposableToken(random(4).toString("hex"));
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const username = `codex_e2e_s_${runToken}_${n}`;
    return {
      id: username,
      username,
      email: `${SCRATCH_EMAIL_PREFIX}${runToken}-${n}@example.com`,
    };
  });
}

export function generateScratchPasswords(count = SCRATCH_USER_COUNT, random = randomBytes) {
  return Array.from({ length: count }, () => random(24).toString("base64url"));
}

// Builds the scratch users' insert statements, kept separate from buildKitchenResetSql because
// scratch users never own data and never need the kitchen personas' fork/cookbook/credential
// reset logic — and so this can never collide with that reset's persona-scoped DELETEs, which
// only ever match PERSONA_IDS. INSERT OR IGNORE (rather than a plain INSERT, matching the
// Unit/IngredientRef inserts above) makes this idempotent if the same generated statement is
// ever re-applied, for example after a retried `wrangler d1 execute` following a network flake.
export function buildScratchUsersSql({ users, passwords, hash = (password) => bcrypt.hashSync(password, 10) }) {
  if (users.length !== passwords.length) {
    throw new Error("buildScratchUsersSql requires exactly one password per scratch user.");
  }
  return users
    .map((user, index) => {
      const hashedPassword = hash(passwords[index]);
      const salt = hashedPassword.slice(0, 29);
      return `INSERT OR IGNORE INTO "User" (id, email, username, hashedPassword, salt, createdAt, updatedAt) VALUES (${sqlString(user.id)}, ${sqlString(user.email)}, ${sqlString(user.username)}, ${sqlString(hashedPassword)}, ${sqlString(salt)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`;
    })
    .join("\n");
}

// Invalidates every scratch user from every past run (not just this one), instead of minting a
// fresh batch: used by `--rotate` so the "rotate before uploading the report" step never leaves
// a brand-new, never-yet-invalidated scratch password sitting in the database for the traces
// that are about to be uploaded to carry. NULL, not a freshly generated bcrypt hash: this repo's
// authenticatePasswordUser (app/lib/auth.server.ts) rejects any login attempt whose looked-up
// user has a null hashedPassword before it ever runs a bcrypt comparison, so a null hash is a
// simpler, equally final way to make the password unusable than hashing an unknown value would
// be. Matches by email prefix only, not by PERSONA_IDS or any other id list, so it can never
// touch the kitchen personas. The pattern here is deliberately broader than SCRATCH_EMAIL_PREFIX:
// 'codex-e2e-s%' (no trailing hyphen) matches both this generator's current
// 'codex-e2e-s-...' addresses and the older, longer 'codex-e2e-scratch-...' addresses minted
// before ids were shortened to fit under D1's LIKE pattern-length limit — some of those are
// still sitting in QA, and --rotate must keep invalidating them too. Still a short literal
// prefix, nowhere near D1's 50-byte LIKE limit.
export function buildScratchInvalidationSql() {
  return `UPDATE "User" SET hashedPassword = NULL, salt = NULL WHERE email LIKE 'codex-e2e-s%';`;
}

export function buildKitchenResetSql({ passwords, hash = (password) => bcrypt.hashSync(password, 10) }) {
  const statements = [];
  const personaIds = sqlIdList(PERSONA_IDS);

  // 1. Detach forks that point at ANY recipe owned by a kitchen persona. Match by
  // ownership (chefId), not by the forked recipe's own id: a persona's recipe can carry
  // a journey-created id (a real UUID from the app, not our fixed 'qa-kitchen-recipe-*'
  // scheme) once journeys have run against it, and a fork of it — made by another
  // persona or by a throwaway user — would otherwise survive with a dangling
  // sourceRecipeId and block the cascade delete below (Recipe.sourceRecipeId is
  // ON DELETE RESTRICT).
  statements.push(
    `UPDATE Recipe SET sourceRecipeId = NULL WHERE sourceRecipeId IN (SELECT id FROM Recipe WHERE chefId IN (${personaIds}));`,
  );

  // 2. RecipeInCookbook.recipeId/addedById are ON DELETE RESTRICT (not CASCADE); clear
  // every row that touches a persona-owned recipe or cookbook (by ownership, for the
  // same journey-drift reason as above — id, cookbookId is matched by ownership since a
  // persona's own cookbook could likewise carry a journey-created id), or that a
  // persona added (addedById is a direct user reference, matched by exact persona id).
  statements.push(
    `DELETE FROM RecipeInCookbook WHERE recipeId IN (SELECT id FROM Recipe WHERE chefId IN (${personaIds})) OR cookbookId IN (SELECT id FROM Cookbook WHERE authorId IN (${personaIds})) OR addedById IN (${personaIds});`,
  );

  // 3. UserCredential.userId and OAuth.userId are also ON DELETE RESTRICT — every other
  // table that references "User" (Recipe, Cookbook, ShoppingList, RecipeSpoon,
  // ApiCredential, OAuth* tables, etc.) cascades, but these two must be cleared by hand
  // or the delete of "User" below fails with a foreign key error. Direct user references,
  // so matched by exact persona id, not by ownership.
  statements.push(`DELETE FROM UserCredential WHERE userId IN (${personaIds});`);
  statements.push(`DELETE FROM OAuth WHERE userId IN (${personaIds});`);

  // 4. Deleting the kitchen users cascades their recipes, steps, ingredients, step output
  // uses, cookbooks, shopping list and items, spoons, and their OAuth grant graph
  // (OAuthGrant/OAuthAuthCode/ApiCredential/OAuthRefreshToken/OAuthTokenIssuance/
  // OAuthRefreshLineage) — every one of those is ON DELETE CASCADE from "User", directly
  // or transitively through OAuthGrant, once UserCredential/OAuth are out of the way.
  statements.push(`DELETE FROM "User" WHERE id IN (${personaIds});`);

  // 5. Shared lookup tables: reuse an existing row with the same name; never delete these.
  for (const name of UNITS) {
    statements.push(
      `INSERT OR IGNORE INTO Unit (id, name, updatedAt) VALUES (${sqlString(`qa-kitchen-unit-${slug(name)}`)}, ${sqlString(name)}, CURRENT_TIMESTAMP);`,
    );
  }
  for (const name of INGREDIENT_REFS) {
    statements.push(
      `INSERT OR IGNORE INTO IngredientRef (id, name, updatedAt) VALUES (${sqlString(`qa-kitchen-ingredient-${slug(name)}`)}, ${sqlString(name)}, CURRENT_TIMESTAMP);`,
    );
  }

  // 6. Users, each with a bcrypt hash of this run's freshly generated password.
  for (const key of ["chef", "friend", "newbie"]) {
    const persona = KITCHEN[key];
    const hashedPassword = hash(passwords[key]);
    const salt = hashedPassword.slice(0, 29);
    statements.push(
      `INSERT INTO "User" (id, email, username, hashedPassword, salt, createdAt, updatedAt) VALUES (${sqlString(persona.id)}, ${sqlString(persona.email)}, ${sqlString(persona.username)}, ${sqlString(hashedPassword)}, ${sqlString(salt)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    );
  }

  // 7. Recipes, steps, step output uses, and ingredients.
  for (const [key, recipe] of Object.entries(KITCHEN.recipes)) {
    const content = RECIPE_CONTENT[key];
    const chefId = KITCHEN[recipe.chef].id;
    statements.push(
      `INSERT INTO Recipe (id, title, description, servings, chefId, deletedAt, sourceRecipeId, sourceUrl, activeCoverId, activeCoverVariant, coverMode, createdAt, updatedAt) VALUES (${sqlString(recipe.id)}, ${sqlString(recipe.title)}, NULL, NULL, ${sqlString(chefId)}, NULL, NULL, NULL, NULL, NULL, ${sqlString("auto")}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    );

    for (const step of content.steps) {
      statements.push(
        `INSERT INTO RecipeStep (id, recipeId, stepNum, stepTitle, description, updatedAt) VALUES (${sqlString(`${recipe.id}-step-${step.stepNum}`)}, ${sqlString(recipe.id)}, ${step.stepNum}, ${sqlString(step.stepTitle)}, ${sqlString(step.description)}, CURRENT_TIMESTAMP);`,
      );
    }

    for (const use of content.stepOutputUses) {
      statements.push(
        `INSERT INTO StepOutputUse (id, recipeId, outputStepNum, inputStepNum, updatedAt) VALUES (${sqlString(`${recipe.id}-stepoutput-${use.outputStepNum}-${use.inputStepNum}`)}, ${sqlString(recipe.id)}, ${use.outputStepNum}, ${use.inputStepNum}, CURRENT_TIMESTAMP);`,
      );
    }

    for (const ingredient of content.ingredients) {
      statements.push(
        `INSERT INTO Ingredient (id, recipeId, stepNum, quantity, unitId, ingredientRefId, updatedAt) VALUES (${sqlString(`${recipe.id}-ingredient-${ingredient.stepNum}-${slug(ingredient.ref)}`)}, ${sqlString(recipe.id)}, ${ingredient.stepNum}, ${ingredient.quantity}, (SELECT id FROM Unit WHERE name = ${sqlString(ingredient.unit)}), (SELECT id FROM IngredientRef WHERE name = ${sqlString(ingredient.ref)}), CURRENT_TIMESTAMP);`,
      );
    }
  }

  // 8. Cookbooks and memberships (both cookbooks are chef's; chef adds friend's Saffron
  // Risotto to Weeknight Dinners).
  for (const [, cookbook] of Object.entries(KITCHEN.cookbooks)) {
    statements.push(
      `INSERT INTO Cookbook (id, title, authorId, createdAt, updatedAt) VALUES (${sqlString(cookbook.id)}, ${sqlString(cookbook.title)}, ${sqlString(KITCHEN.chef.id)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    );
  }
  for (const entry of COOKBOOK_ENTRIES) {
    const cookbook = KITCHEN.cookbooks[entry.cookbook];
    const recipe = KITCHEN.recipes[entry.recipe];
    statements.push(
      `INSERT INTO RecipeInCookbook (id, cookbookId, recipeId, addedById, createdAt, updatedAt) VALUES (${sqlString(`${cookbook.id}-${recipe.id}`)}, ${sqlString(cookbook.id)}, ${sqlString(recipe.id)}, ${sqlString(KITCHEN.chef.id)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    );
  }

  // 9. Chef's shopping list: three unchecked items.
  const shoppingListId = "qa-kitchen-shoppinglist-chef";
  statements.push(
    `INSERT INTO ShoppingList (id, authorId, createdAt, updatedAt) VALUES (${sqlString(shoppingListId)}, ${sqlString(KITCHEN.chef.id)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
  );
  for (const item of SHOPPING_LIST_ITEMS) {
    statements.push(
      `INSERT INTO ShoppingListItem (id, shoppingListId, quantity, unitId, ingredientRefId, checked, updatedAt) VALUES (${sqlString(`qa-kitchen-shoppingitem-${slug(item.ref)}`)}, ${sqlString(shoppingListId)}, ${item.quantity}, (SELECT id FROM Unit WHERE name = ${sqlString(item.unit)}), (SELECT id FROM IngredientRef WHERE name = ${sqlString(item.ref)}), 0, CURRENT_TIMESTAMP);`,
    );
  }

  // 10. Chef's one RecipeSpoon, on friend's Saffron Risotto — so friend is a fellow chef.
  statements.push(
    `INSERT INTO RecipeSpoon (id, chefId, recipeId, note, createdAt, updatedAt) VALUES (${sqlString("qa-kitchen-spoon-risotto")}, ${sqlString(KITCHEN.chef.id)}, ${sqlString(KITCHEN.recipes.risotto.id)}, ${sqlString("Great with extra parmesan")}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
  );

  return statements.join("\n");
}

export function parseSeedKitchenArgs(argv) {
  const targetEnvIndex = argv.indexOf("--target-env");
  const targetEnv = targetEnvIndex === -1 ? undefined : argv[targetEnvIndex + 1];
  if (targetEnv !== "qa") {
    throw new Error("seed-qa-kitchen refuses non-QA targets; run with `--target-env qa`.");
  }
  const credentialsOutIndex = argv.indexOf("--credentials-out");
  let credentialsOut = null;
  if (credentialsOutIndex !== -1) {
    credentialsOut = argv[credentialsOutIndex + 1];
    if (credentialsOut === undefined || credentialsOut.startsWith("--")) {
      throw new Error("--credentials-out requires a path value.");
    }
  }
  return {
    targetEnv,
    dryRun: argv.includes("--dry-run"),
    credentialsOut,
    rotate: argv.includes("--rotate"),
  };
}

function credentialsPayload(passwords, scratchUsers, scratchPasswords) {
  return {
    chef: { username: KITCHEN.chef.username, email: KITCHEN.chef.email, password: passwords.chef },
    friend: { username: KITCHEN.friend.username, email: KITCHEN.friend.email, password: passwords.friend },
    newbie: { username: KITCHEN.newbie.username, email: KITCHEN.newbie.email, password: passwords.newbie },
    scratch: scratchUsers.map((user, index) => ({
      username: user.username,
      email: user.email,
      password: scratchPasswords[index],
    })),
  };
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const {
    execFile = execFileSync,
    writeFile = writeFileSync,
    mkdtemp = mkdtempSync,
    rm = rmSync,
    chmod = chmodSync,
    generatePasswords = generatePersonaPasswords,
    generateScratch = generateScratchUsers,
    generateScratchPasswords: generateScratchPwds = generateScratchPasswords,
    io = console,
  } = deps;

  const options = parseSeedKitchenArgs(argv);
  const passwords = generatePasswords();
  // --rotate invalidates every existing scratch user in place instead of minting a new batch,
  // so a rotation never leaves a fresh, never-yet-invalidated scratch password in the database
  // for the report/traces it runs ahead of to carry (see buildScratchInvalidationSql).
  const scratchUsers = options.rotate ? [] : generateScratch();
  const scratchPasswords = options.rotate ? [] : generateScratchPwds(scratchUsers.length);
  const scratchSql = options.rotate
    ? buildScratchInvalidationSql()
    : buildScratchUsersSql({ users: scratchUsers, passwords: scratchPasswords });
  const sql = `${buildKitchenResetSql({ passwords })}\n${scratchSql}`;

  if (options.dryRun) {
    io.log(sql.replace(BCRYPT_HASH_PATTERN, "<hash>"));
    return;
  }

  const directory = mkdtemp(join(tmpdir(), "spoonjoy-qa-kitchen-"));
  let primaryError;
  try {
    const file = join(directory, "kitchen-reset.sql");
    writeFile(file, sql, { encoding: "utf8", mode: 0o600 });
    execFile("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", "qa", "--file", file], {
      stdio: "inherit",
    });
  } catch (error) {
    primaryError = error;
  } finally {
    // Always attempt cleanup, but a cleanup failure must never hide a real wrangler
    // failure — only surface the cleanup error when nothing else already failed.
    try {
      rm(directory, { recursive: true, force: true });
    } catch (cleanupError) {
      if (!primaryError) primaryError = cleanupError;
    }
  }
  if (primaryError) throw primaryError;

  if (options.credentialsOut) {
    writeFile(options.credentialsOut, `${JSON.stringify(credentialsPayload(passwords, scratchUsers, scratchPasswords), null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    // writeFile's mode option only applies to a newly created file; chmod explicitly so
    // a pre-existing file at this path is restricted too.
    chmod(options.credentialsOut, 0o600);
  }
}

// CLI guard, following the injectable-entry-detection shape used by
// scripts/cleanup-local-qa-data.mjs so the guard itself is unit-testable
// (this file is coverage-gated at 100%, unlike scripts/seed-qa.mjs's plain
// `import.meta.url === file://...` guard, which is not).
export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

export function defaultCliErrorHandler(error, io = console) {
  io.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

export function runCliIfEntry({
  moduleUrl = import.meta.url,
  argv1 = process.argv[1],
  runMain = main,
  onError = defaultCliErrorHandler,
} = {}) {
  if (!isCliEntry(moduleUrl, argv1)) return false;
  try {
    runMain();
  } catch (error) {
    onError(error);
  }
  return true;
}

runCliIfEntry();
