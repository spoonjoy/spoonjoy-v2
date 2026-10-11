// A D1 binding whose next matching batches fail with a transient D1 error, as D1 does when its
// connection drops: either before the batch reaches the database (nothing applied) or after it
// committed (applied, but the answer is lost). The write paths' retries must end with the rows a
// single successful batch leaves, never a second copy.

/**
 * "lost": the batch never reached the database. "lost-answer": it committed, but the answer was
 * lost. "late": it is lost now, and commits just before the next batch that matches the same
 * pattern (the retry), after any check in between, as a write still in flight on D1's side would.
 */
export type FlakyOutcome = "lost" | "lost-answer" | "late";

export const NETWORK_LOST_MESSAGE = "D1_ERROR: Network connection lost.";

interface BatchingBinding {
  prepare(sql: string): unknown;
  batch(statements: never[]): Promise<unknown[]>;
}

export interface FlakyD1<B> {
  binding: B;
  /** Fails the next batches whose first statement's SQL matches `pattern`, one outcome each. */
  failNext(pattern: RegExp, ...outcomes: FlakyOutcome[]): void;
  /** How many batches failed so far. */
  failures(): number;
}

// The test SQLite binding keeps a statement's SQL as `sql`; workerd's D1 keeps it as `statement`.
function sqlOf(statement: unknown): string {
  const { sql, statement: text } = statement as { sql?: unknown; statement?: unknown };
  return String(sql ?? text ?? "");
}

export function flakyD1<B extends BatchingBinding>(inner: B): FlakyD1<B> {
  const plans: Array<{ pattern: RegExp; outcome: FlakyOutcome }> = [];
  let failed = 0;
  let late: { pattern: RegExp; statements: never[] } | null = null;
  const binding = {
    ...inner,
    prepare: (sql: string) => inner.prepare(sql),
    batch: async (statements: never[]) => {
      const sql = statements.map(sqlOf).join("\n");
      if (late?.pattern.test(sql)) {
        const landing = late.statements;
        late = null;
        await inner.batch(landing);
      }
      const index = plans.findIndex((plan) => plan.pattern.test(sql));
      if (index === -1) return inner.batch(statements);
      const [{ outcome, pattern }] = plans.splice(index, 1);
      failed += 1;
      if (outcome === "lost-answer") await inner.batch(statements);
      if (outcome === "late") late = { pattern, statements };
      throw new Error(NETWORK_LOST_MESSAGE);
    },
  } as unknown as B;
  return {
    binding,
    failNext(pattern, ...outcomes) {
      for (const outcome of outcomes) plans.push({ pattern, outcome });
    },
    failures: () => failed,
  };
}
