// A Prisma client whose next matching model calls fail with a transient D1 error, as Prisma's D1
// adapter does when D1's connection drops: before the call reaches the database, after it
// committed, or late (it commits just before the next call of the same model method, as a write
// still in flight on D1's side would). The counterpart of flaky-d1.ts for writes made through
// Prisma rather than a raw D1 batch.
import type { PrismaClient } from "@prisma/client";
import { NETWORK_LOST_MESSAGE, type FlakyOutcome } from "./flaky-d1";

type Call = (...args: unknown[]) => Promise<unknown>;

export interface FlakyPrisma {
  db: PrismaClient;
  /** Fails the next calls of `model.method` (such as "apiCredential", "create"), one outcome each. */
  failNext(model: string, method: string, ...outcomes: FlakyOutcome[]): void;
  /** How many calls failed so far. */
  failures(): number;
}

export function flakyPrisma(inner: PrismaClient): FlakyPrisma {
  const plans: Array<{ model: string; method: string; outcome: FlakyOutcome }> = [];
  let late: { model: string; method: string; run: () => Promise<unknown> } | null = null;
  let failed = 0;

  const db = new Proxy(inner, {
    get(client, model) {
      const delegate = Reflect.get(client, model);
      if (typeof delegate === "function") return delegate.bind(client);
      if (typeof model !== "string" || !delegate || typeof delegate !== "object") return delegate;
      return new Proxy(delegate as Record<string, unknown>, {
        get(target, method) {
          const original = Reflect.get(target, method);
          if (typeof original !== "function" || typeof method !== "string") return original;
          const call = (args: unknown[]) => (original as Call).apply(target, args);
          return async (...args: unknown[]) => {
            if (late?.model === model && late.method === method) {
              const landing = late.run;
              late = null;
              await landing();
            }
            const index = plans.findIndex((plan) => plan.model === model && plan.method === method);
            if (index === -1) return call(args);
            const [{ outcome }] = plans.splice(index, 1);
            failed += 1;
            if (outcome === "lost-answer") await call(args);
            if (outcome === "late") late = { model, method, run: () => call(args) };
            throw new Error(NETWORK_LOST_MESSAGE);
          };
        },
      });
    },
  });

  return {
    db,
    failNext(model, method, ...outcomes) {
      for (const outcome of outcomes) plans.push({ model, method, outcome });
    },
    failures: () => failed,
  };
}
