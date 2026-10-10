import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Prisma's D1 adapter does not support transactions: it runs `$transaction([...])` and
// interactive `$transaction(async (tx) => ...)` as separate statements, so on production D1
// neither is atomic (a failing statement leaves the earlier ones applied). Atomic writes go
// through `d1WriteBatch` (app/lib/d1-write.server.ts) with the request's D1 binding.
//
// Every `$transaction` left in app/ is listed here with the reason it is safe. Each one runs
// only without a D1 binding (unit tests on SQLite, local scripts), where Prisma's transaction
// is real. A new `$transaction` fails this test: write the production path as a D1 batch, and
// list the Prisma fallback here only if it is reached solely without a binding.

const NO_BINDING_FALLBACK = "Prisma fallback, reached only without a D1 binding; production writes go through d1WriteBatch.";

interface Allowance {
  /** The most `$transaction` calls the file may hold. */
  max: number;
  reason: string;
}

export const TRANSACTION_ALLOWLIST: Record<string, Allowance> = {
  "app/lib/api-v1-recipe-steps.server.ts": {
    max: 8,
    reason: `${NO_BINDING_FALLBACK} Each REST step write branches on options.d1 first.`,
  },
  "app/lib/api-v1-recipe-writes.server.ts": {
    max: 2,
    reason: `${NO_BINDING_FALLBACK} REST recipe update and delete branch on the request's binding first.`,
  },
  "app/lib/api-v1.server.ts": {
    max: 1,
    reason: `${NO_BINDING_FALLBACK} Clearing the shopping list uses the binding's batch when present.`,
  },
  "app/lib/cookbook-membership-compat.server.ts": {
    max: 4,
    reason: `${NO_BINDING_FALLBACK} Every caller passes nativeDatabase, which takes the batch path.`,
  },
  "app/lib/recipe-cover.server.ts": {
    max: 2,
    reason: `${NO_BINDING_FALLBACK} setActiveRecipeCover and clearActiveRecipeCover take the guarded batch when d1 is passed, and every production caller passes it.`,
  },
  "app/lib/recipe-cover-stuck.server.ts": {
    max: 1,
    reason: `${NO_BINDING_FALLBACK} stuckCoverStore picks the D1 store whenever the request has a binding.`,
  },
  "app/lib/recipe-detail.server.ts": {
    max: 2,
    reason: `${NO_BINDING_FALLBACK} Clearing the cover and deleting the recipe branch on requestD1(context) first.`,
  },
  "app/lib/recipe-import.server.ts": {
    max: 1,
    reason: `${NO_BINDING_FALLBACK} Imports write the recipe graph as one guarded batch when the binding is present.`,
  },
  "app/lib/recipe-steps-update.server.ts": {
    max: 1,
    reason: `${NO_BINDING_FALLBACK} The steps update plan runs as one guarded batch when the binding is present.`,
  },
  "app/lib/shopping-list-mutations.server.ts": {
    max: 2,
    reason: `${NO_BINDING_FALLBACK} The shared shopping-item plan runs as a D1 batch when the binding is present.`,
  },
  "app/lib/spoon-cover-stylization.server.ts": {
    max: 2,
    reason: `${NO_BINDING_FALLBACK} Stylization's cover updates and touches use one batch per lifecycle step when the binding is present.`,
  },
  "app/lib/spoonjoy-api.server.ts": {
    max: 1,
    reason: `${NO_BINDING_FALLBACK} MCP create_recipe and update_recipe replace steps with recipeStepsReplaceStatements in a batch when the binding is present.`,
  },
  "app/routes/recipes.$id.edit.tsx": {
    max: 4,
    reason: `${NO_BINDING_FALLBACK} Each editor intent branches on requestD1(context) first.`,
  },
  "app/routes/recipes.$id.steps.$stepId.edit.tsx": {
    max: 4,
    reason: `${NO_BINDING_FALLBACK} Each step-editor intent branches on requestD1(context) first.`,
  },
};

/** The number of `$transaction(` calls in a source file, ignoring comment lines. */
export function countTransactionCalls(source: string): number {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"));
    })
    .reduce((count, line) => count + (line.match(/\$transaction\s*\(/g)?.length ?? 0), 0);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

function transactionCallsInApp(): Record<string, number> {
  const root = process.cwd();
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(resolve(root, "app"))) {
    const count = countTransactionCalls(readFileSync(file, "utf8"));
    if (count > 0) counts[relative(root, file)] = count;
  }
  return counts;
}

describe("Prisma $transaction in app/", () => {
  it("counts calls, not comments that mention them", () => {
    expect(countTransactionCalls([
      "// `$transaction([...])` is not atomic on D1",
      " * `$transaction(async (tx) => ...)` neither",
      "/* $transaction(ops) */",
      "await db.$transaction([a, b]);",
      "return database.$transaction (async (tx) => tx.recipe.update(args));",
    ].join("\n"))).toBe(2);
  });

  it("appears only in allowlisted files, never more often than allowed", () => {
    const unexpected = Object.entries(transactionCallsInApp())
      .filter(([file, count]) => count > (TRANSACTION_ALLOWLIST[file]?.max ?? 0))
      .map(([file, count]) => `${file}: ${count} $transaction call(s), ${TRANSACTION_ALLOWLIST[file]?.max ?? 0} allowed`);

    // A $transaction is not atomic on D1: write the production path with d1WriteBatch, and list
    // a no-binding Prisma fallback in TRANSACTION_ALLOWLIST with its reason.
    expect(unexpected).toEqual([]);
  });

  it("lists only files that still hold a $transaction, each with a reason", () => {
    const counts = transactionCallsInApp();
    const stale = Object.keys(TRANSACTION_ALLOWLIST).filter((file) => !counts[file]);
    expect(stale).toEqual([]);
    for (const allowance of Object.values(TRANSACTION_ALLOWLIST)) {
      expect(allowance.reason.length).toBeGreaterThan(NO_BINDING_FALLBACK.length);
    }
  });
});
