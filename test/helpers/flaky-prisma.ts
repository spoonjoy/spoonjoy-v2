// A Prisma client whose next calls to one model method fail with a transient D1 error, as a
// Prisma write on the D1 adapter does when D1's connection drops: before the write reached the
// database ("lost"), after it committed ("lost-answer"), or lost now and committed just before the
// next call to the same method ("late"). It is the Prisma counterpart of flaky-d1.ts.
import { NETWORK_LOST_MESSAGE, type FlakyOutcome } from "./flaky-d1";

type Call = (args: unknown) => Promise<unknown>;

export interface FlakyPrisma<C> {
  client: C;
  /** How many calls failed so far. */
  failures(): number;
}

export function flakyPrisma<C extends object>(client: C, model: string, method: string, ...outcomes: FlakyOutcome[]): FlakyPrisma<C> {
  const plans = [...outcomes];
  let failed = 0;
  let late: unknown[] = [];
  const flaky = new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== model) return value;
      return new Proxy(value as object, {
        get(delegate, name, delegateReceiver) {
          const real = Reflect.get(delegate, name, delegateReceiver) as Call;
          if (name !== method) return real;
          return async (args: unknown) => {
            const call = (callArgs: unknown) => real.call(delegate, callArgs);
            for (const landing of late.splice(0)) await call(landing);
            const outcome = plans.shift();
            if (!outcome) return call(args);
            failed += 1;
            if (outcome === "lost-answer") await call(args);
            if (outcome === "late") late.push(args);
            throw new Error(NETWORK_LOST_MESSAGE);
          };
        },
      });
    },
  }) as C;
  return { client: flaky, failures: () => failed };
}
