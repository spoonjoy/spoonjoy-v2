import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";
import {
  buildD1ImportSql,
  buildMigrationReport,
  type V1Cookbook,
  type V1Export,
  type V1Ingredient,
  type V1IngredientRef,
  type V1OAuth,
  type V1Recipe,
  type V1RecipeInCookbook,
  type V1RecipeStep,
  type V1ShoppingList,
  type V1ShoppingListItem,
  type V1StepOutputUse,
  type V1Unit,
  type V1User,
  type V1UserCredential,
} from "./lib/v1-neon-to-d1";

const { Client } = pg;

interface CliOptions {
  command: "report" | "build-sql";
  databaseUrl: string;
  out: string | null;
  reportOut: string | null;
  replaceTarget: boolean;
}

type Queryable = Pick<pg.Client, "query">;

function usage(): string {
  return [
    "Usage:",
    "  pnpm exec tsx scripts/migrate-v1-neon-to-d1.ts report",
    "  pnpm exec tsx scripts/migrate-v1-neon-to-d1.ts build-sql --out /tmp/spoonjoy-v1-import.sql --report-out /tmp/spoonjoy-v1-report.json --replace-target",
    "",
    "Database URL is read from SPOONJOY_V1_DATABASE_URL first, then DATABASE_URL.",
    "The script writes no secrets to stdout.",
  ].join("\n");
}

function readArgValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseCliOptions(args: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const [commandArg, ...rest] = args;
  const command = commandArg === "build-sql" ? "build-sql" : commandArg === "report" || !commandArg ? "report" : null;
  if (!command) {
    throw new Error(`Unknown command: ${commandArg}\n\n${usage()}`);
  }

  let out: string | null = null;
  let reportOut: string | null = null;
  let replaceTarget = false;
  let databaseUrl = env.SPOONJOY_V1_DATABASE_URL ?? env.DATABASE_URL ?? "";

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    switch (arg) {
      case "--":
        break;
      case "--out":
        out = readArgValue(rest, index, arg);
        index += 1;
        break;
      case "--report-out":
        reportOut = readArgValue(rest, index, arg);
        index += 1;
        break;
      case "--replace-target":
        replaceTarget = true;
        break;
      case "--database-url":
        databaseUrl = readArgValue(rest, index, arg);
        index += 1;
        break;
      case "--help":
      case "-h":
        throw new Error(usage());
      default:
        throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
  }

  if (!databaseUrl) {
    throw new Error("Missing SPOONJOY_V1_DATABASE_URL or DATABASE_URL");
  }

  if (command === "build-sql" && !out) {
    throw new Error("build-sql requires --out");
  }

  return {
    command,
    databaseUrl: normalizeNeonConnectionString(databaseUrl),
    out,
    reportOut,
    replaceTarget,
  };
}

export function normalizeNeonConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("Database URL must use the postgres/postgresql protocol");
  }
  if (url.searchParams.get("sslmode") === "require") {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}

async function selectRows<T>(client: Queryable, sql: string): Promise<T[]> {
  const result = await client.query<T>(sql);
  return result.rows;
}

export async function readV1Export(client: Queryable): Promise<V1Export> {
  const users = await selectRows<V1User>(
    client,
    `SELECT id, email, username, "hashedPassword", salt, "resetToken", "resetTokenExpiresAt", "webAuthnChallenge", "createdAt", "updatedAt" FROM "User" ORDER BY id`,
  );
  const userCredentials = await selectRows<V1UserCredential>(
    client,
    `SELECT id, "userId", "publicKey", transports, counter::text AS counter FROM "UserCredential" ORDER BY id`,
  );
  const oauthAccounts = await selectRows<V1OAuth>(
    client,
    `SELECT provider, "providerUserId", "providerUsername", "userId", "createdAt" FROM "OAuth" ORDER BY provider, "providerUserId"`,
  );
  const units = await selectRows<V1Unit>(client, `SELECT id, name, "updatedAt" FROM "Unit" ORDER BY id`);
  const ingredientRefs = await selectRows<V1IngredientRef>(
    client,
    `SELECT id, name, "updatedAt" FROM "IngredientRef" ORDER BY id`,
  );
  const recipes = await selectRows<V1Recipe>(
    client,
    `SELECT id, title, description, "imageUrl", servings, "chefId", "deletedAt", "sourceRecipeId", "sourceUrl", "createdAt", "updatedAt" FROM "Recipe" ORDER BY id`,
  );
  const recipeSteps = await selectRows<V1RecipeStep>(
    client,
    `SELECT id, "recipeId", "stepNum", "stepTitle", description, "updatedAt" FROM "RecipeStep" ORDER BY "recipeId", "stepNum", id`,
  );
  const stepOutputUses = await selectRows<V1StepOutputUse>(
    client,
    `SELECT id, "recipeId", "outputStepNum", "inputStepNum", "updatedAt" FROM "StepOutputUse" ORDER BY "recipeId", "outputStepNum", "inputStepNum", id`,
  );
  const ingredients = await selectRows<V1Ingredient>(
    client,
    `SELECT id, "recipeId", "stepNum", quantity, "unitId", "ingredientRefId", "updatedAt" FROM "Ingredient" ORDER BY "recipeId", "stepNum", id`,
  );
  const cookbooks = await selectRows<V1Cookbook>(
    client,
    `SELECT id, title, "authorId", "createdAt", "updatedAt" FROM "Cookbook" ORDER BY id`,
  );
  const recipeInCookbooks = await selectRows<V1RecipeInCookbook>(
    client,
    `SELECT id, "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt" FROM "RecipeInCookbook" ORDER BY "cookbookId", "recipeId", id`,
  );
  const shoppingLists = await selectRows<V1ShoppingList>(
    client,
    `SELECT id, "authorId", "createdAt", "updatedAt" FROM "ShoppingList" ORDER BY id`,
  );
  const shoppingListItems = await selectRows<V1ShoppingListItem>(
    client,
    `SELECT id, "shoppingListId", quantity, "unitId", "ingredientRefId", "updatedAt" FROM "ShoppingListItem" ORDER BY "shoppingListId", "updatedAt", id`,
  );

  return {
    users,
    userCredentials,
    oauthAccounts,
    units,
    ingredientRefs,
    recipes,
    recipeSteps,
    stepOutputUses,
    ingredients,
    cookbooks,
    recipeInCookbooks,
    shoppingLists,
    shoppingListItems,
  };
}

async function writeTextFile(path: string, contents: string): Promise<void> {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const client = new Client({ connectionString: options.databaseUrl });

  await client.connect();
  try {
    const source = await readV1Export(client);
    const report = buildMigrationReport(source);

    if (options.command === "report") {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const sql = buildD1ImportSql(source, {
      replaceTarget: options.replaceTarget,
      generatedAt: new Date(),
    });
    await writeTextFile(options.out ?? "", sql);

    if (options.reportOut) {
      await writeTextFile(options.reportOut, `${JSON.stringify(report, null, 2)}\n`);
    }

    console.log(
      JSON.stringify(
        {
          wroteSql: options.out,
          wroteReport: options.reportOut,
          replaceTarget: options.replaceTarget,
          plannedInsertCounts: report.plannedInsertCounts,
          skipped: report.skipped,
          unsupportedLoginUsers: report.auth.unsupportedLoginUsers,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
