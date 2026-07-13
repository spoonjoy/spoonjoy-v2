#!/usr/bin/env node
// Seed a demo Spoonjoy kitchen with sample recipes, a cookbook, and a shopping
// list for QA/local reviewer rehearsals. This script intentionally refuses the
// production Spoonjoy domain; production should never carry demo fixture data.
//
// Setup (Ari):
//   1. Sign up the demo account in QA or local dev.
//   2. Create an API token in Account Settings (or via create_api_token)
//   3. Run:  SPOONJOY_API_TOKEN=sj_... node scripts/seed-demo-kitchen.mjs --target-env qa
//
// Options (env):
//   SPOONJOY_API_TOKEN   required - bearer token for the demo account
//   SPOONJOY_BASE_URL    optional - overrides the QA/local default, except production

export const DEMO_SEED_BASE_URLS = {
  local: "http://localhost:5173",
  qa: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
};

const ALLOWED_TARGET_ENVS = new Set(Object.keys(DEMO_SEED_BASE_URLS));
const PRODUCTION_HOSTS = new Set(["spoonjoy.app", "www.spoonjoy.app"]);

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/$/, "");
}

export function isProductionBaseUrl(baseUrl) {
  try {
    return PRODUCTION_HOSTS.has(new URL(baseUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function readFlag(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

export function parseSeedDemoKitchenArgs(argv = process.argv.slice(2), env = process.env) {
  const targetEnv = readFlag(argv, "--target-env");
  if (!targetEnv || !ALLOWED_TARGET_ENVS.has(targetEnv)) {
    throw new Error("seed-demo-kitchen requires `--target-env qa` or `--target-env local`.");
  }

  const baseUrl = normalizeBaseUrl(env.SPOONJOY_BASE_URL ?? DEMO_SEED_BASE_URLS[targetEnv]);
  if (isProductionBaseUrl(baseUrl)) {
    throw new Error("seed-demo-kitchen refuses production domains; use QA/local only.");
  }

  const token = env.SPOONJOY_API_TOKEN;
  if (!token) {
    throw new Error("Missing SPOONJOY_API_TOKEN. See the header of this script for setup steps.");
  }

  return { targetEnv, baseUrl, token };
}

async function callTool(options, operation, args = {}, fetchImpl = fetch) {
  const res = await fetchImpl(`${options.baseUrl}/api/tools/${operation}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    const message = payload?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`${operation}: ${message}`);
  }
  return payload.data;
}

// Best-effort: a recipe whose title already exists will 400; treat that as
// "already seeded" and keep going so the script is safe to re-run.
async function seedRecipe(options, recipe, fetchImpl, io) {
  try {
    const data = await callTool(options, "create_recipe", recipe, fetchImpl);
    io.log(`  ✓ recipe: ${recipe.title}`);
    return data.recipe;
  } catch (error) {
    io.log(`  • recipe skipped (${recipe.title}): ${error.message}`);
    return null;
  }
}

const RECIPES = [
  {
    title: "Weeknight Tomato Beans",
    description: "A 20-minute skillet of white beans in garlicky tomato with crusty bread.",
    servings: "4",
    steps: [
      {
        description: "Warm olive oil and sizzle the garlic until fragrant.",
        duration: 3,
        ingredients: [
          { name: "olive oil", quantity: 2, unit: "tbsp" },
          { name: "garlic", quantity: 3, unit: "clove" },
        ],
      },
      {
        description: "Add crushed tomatoes and beans; simmer until thickened. Finish with basil.",
        duration: 12,
        ingredients: [
          { name: "crushed tomatoes", quantity: 1, unit: "can" },
          { name: "white beans", quantity: 2, unit: "can" },
          { name: "basil", quantity: 0.25, unit: "cup" },
        ],
      },
    ],
  },
  {
    title: "Lemon Ricotta Pancakes",
    description: "Bright, fluffy weekend pancakes with whipped ricotta and lemon zest.",
    servings: "3",
    steps: [
      {
        description: "Whisk the dry ingredients, then fold in ricotta, milk, eggs, and lemon zest.",
        ingredients: [
          { name: "flour", quantity: 1.5, unit: "cup" },
          { name: "ricotta", quantity: 1, unit: "cup" },
          { name: "milk", quantity: 0.75, unit: "cup" },
          { name: "eggs", quantity: 2, unit: "whole" },
          { name: "lemon", quantity: 1, unit: "whole" },
        ],
      },
      {
        description: "Cook on a buttered griddle until golden, flipping once.",
        duration: 6,
        ingredients: [{ name: "butter", quantity: 1, unit: "tbsp" }],
      },
    ],
  },
  {
    title: "Sheet-Pan Harissa Chicken",
    description: "Spiced chicken thighs roasted with chickpeas and red onion on one pan.",
    servings: "4",
    steps: [
      {
        description: "Toss chicken, chickpeas, and onion with harissa and olive oil.",
        ingredients: [
          { name: "chicken thighs", quantity: 6, unit: "piece" },
          { name: "chickpeas", quantity: 1, unit: "can" },
          { name: "red onion", quantity: 1, unit: "whole" },
          { name: "harissa", quantity: 2, unit: "tbsp" },
        ],
      },
      {
        description: "Roast at 425°F until the chicken is crisp and cooked through.",
        duration: 35,
        ingredients: [],
      },
    ],
  },
];

export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch, io = console) {
  const options = parseSeedDemoKitchenArgs(argv, env);

  io.log(`Seeding demo kitchen at ${options.baseUrl} ...`);

  const status = await callTool(options, "auth_status", {}, fetchImpl);
  if (!status.writable) {
    throw new Error("Token is not writable — check that SPOONJOY_API_TOKEN belongs to the demo account.");
  }
  io.log(`Authenticated as ${status.principal?.email ?? status.defaultOwnerEmail ?? "demo account"}.`);

  io.log("Recipes:");
  const recipes = [];
  for (const recipe of RECIPES) {
    const created = await seedRecipe(options, recipe, fetchImpl, io);
    if (created) recipes.push(created);
  }

  io.log("Cookbook:");
  const cookbook = await callTool(options, "create_cookbook", { title: "Weeknight Favorites" }, fetchImpl);
  io.log(`  ✓ cookbook: ${cookbook.cookbook.title}`);
  for (const recipe of recipes) {
    await callTool(options, "add_recipe_to_cookbook", { cookbookId: cookbook.cookbook.id, recipeId: recipe.id }, fetchImpl);
    io.log(`    ✓ added: ${recipe.title}`);
  }

  io.log("Shopping list:");
  for (const item of [
    { name: "olive oil", quantity: 1, unit: "bottle" },
    { name: "lemons", quantity: 4, unit: "whole" },
    { name: "chickpeas", quantity: 2, unit: "can" },
  ]) {
    await callTool(options, "add_shopping_list_item", item, fetchImpl);
    io.log(`  ✓ ${item.name}`);
  }

  io.log("\nDone. The demo kitchen is ready for QA/local reviewers.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\nSeed failed: ${error.message}`);
    process.exit(1);
  });
}
