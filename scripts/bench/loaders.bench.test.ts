// Hot-route loader bench on Wrangler's D1 (workerd). Not part of CI; see
// scripts/bench/vitest.bench.config.ts for how to run it. For each loader it reports the
// D1 statements and round trips of one request, and the time per request split into time
// waiting on D1 and the rest (the loader's own JavaScript, which is what Workers bills as
// CPU). workerd's clock has 1 ms resolution, so times are averaged over many requests.
import { env } from "cloudflare:test";
import { beforeAll, inject, it } from "vitest";
import { applyRepositoryMigrations } from "../../test/workers/helpers/repository-migrations";
import { createUserSessionCookie } from "../../app/lib/session.server";
import { getDb } from "../../app/lib/db.server";
import { loader as rootLoader } from "../../app/root";
import { loader as homeLoader } from "../../app/routes/_index";
import { loader as searchLoader } from "../../app/routes/search";
import { loadRecipeDetail } from "../../app/lib/recipe-detail.server";
import { loadAccountSettings } from "../../app/lib/account-settings.server";

const ORIGIN = "https://spoonjoy.test";
const CHEF = "qa-kitchen-chef";
const FRIEND = "qa-kitchen-friend";
const RECIPE = "qa-kitchen-recipe-lemon-rice";
const ITERATIONS = Number((globalThis as { BENCH_N?: number }).BENCH_N ?? 150);

interface CallRecord { sql: string; start: number; end: number; kind: string }

// Wraps the D1 binding to count statements and measure time spent waiting on D1.
function instrumentedDb(db: D1Database) {
  const calls: CallRecord[] = [];
  let active = 0;
  let busySince = 0;
  let busy = 0;
  let roundTrips = 0;
  const begin = () => {
    if (active === 0) { busySince = performance.now(); roundTrips += 1; }
    active += 1;
  };
  const finish = () => {
    active -= 1;
    if (active === 0) busy += performance.now() - busySince;
  };
  const underlying = new WeakMap<object, D1PreparedStatement>();
  const wrapStatement = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), sql);
        }
        if (property === "first" || property === "all" || property === "raw" || property === "run") {
          return async (...args: unknown[]) => {
            const record = { sql, start: performance.now(), end: 0, kind: String(property) };
            calls.push(record);
            begin();
            try {
              return await (target[property] as (...a: unknown[]) => Promise<unknown>)(...args);
            } finally {
              record.end = performance.now();
              finish();
            }
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    underlying.set(wrapped, statement);
    return wrapped;
  };
  const wrappedDb = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => wrapStatement(target.prepare(sql), sql);
      }
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const record = { sql: `batch(${statements.length})`, start: performance.now(), end: 0, kind: "batch" };
          calls.push(record);
          begin();
          try {
            return await target.batch(statements.map((s) => underlying.get(s) ?? s));
          } finally {
            record.end = performance.now();
            finish();
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    db: wrappedDb,
    snapshot: () => ({ calls: calls.length, busy, roundTrips }),
    calls,
  };
}

type Scenario = {
  name: string;
  prepare?: () => Promise<void>;
  run: (request: Request, context: { cloudflare: { env: Env; ctx: ExecutionContext } }) => Promise<unknown>;
  url: string;
  user: string | null;
};

const cookies = new Map<string, string>();
let rebuildTick = 0;

async function requestFor(url: string, user: string | null): Promise<Request> {
  const headers = new Headers();
  if (user) headers.set("Cookie", cookies.get(user)!.split(";")[0]!);
  return new Request(`${ORIGIN}${url}`, { headers });
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

async function measure(scenario: Scenario, iterations: number) {
  const instrumented = instrumentedDb(env.DB as D1Database);
  const context = { cloudflare: { env: { ...(env as Env), DB: instrumented.db } as Env, ctx } };
  // Warm module state (first Prisma engine compile etc.) outside the samples.
  const firstStart = performance.now();
  await scenario.run(await requestFor(scenario.url, scenario.user), context).catch((error) => {
    if (!(error instanceof Response)) throw error;
  });
  const first = performance.now() - firstStart;
  const warm = instrumented.snapshot();
  const walls: number[] = [];
  const cpus: number[] = [];
  let totalWall = 0;
  let lastBusy = warm.busy;
  for (let i = 0; i < iterations; i += 1) {
    await scenario.prepare?.();
    const request = await requestFor(scenario.url, scenario.user);
    const start = performance.now();
    await scenario.run(request, context).catch((error) => {
      if (!(error instanceof Response)) throw error;
    });
    const wall = performance.now() - start;
    const now = instrumented.snapshot();
    walls.push(wall);
    cpus.push(wall - (now.busy - lastBusy));
    lastBusy = now.busy;
    totalWall += wall;
  }
  const end = instrumented.snapshot();
  const beforeLast = instrumented.calls.length;
  await scenario.prepare?.();
  const lastStart = instrumented.snapshot();
  await scenario.run(await requestFor(scenario.url, scenario.user), context).catch((error) => {
    if (!(error instanceof Response)) throw error;
  });
  const lastEnd = instrumented.snapshot();
  const perIteration = { calls: lastEnd.calls - lastStart.calls, roundTrips: lastEnd.roundTrips - lastStart.roundTrips };
  const avgBusy = (end.busy - warm.busy) / iterations;
  const avgWall = totalWall / iterations;
  const sorted = [...cpus].sort((a, b) => a - b);
  return {
    name: scenario.name,
    firstMs: first,
    queries: perIteration.calls,
    roundTrips: perIteration.roundTrips,
    wallMs: +avgWall.toFixed(2),
    d1WaitMs: +avgBusy.toFixed(2),
    jsMs: +(avgWall - avgBusy).toFixed(2),
    jsP95Ms: sorted[Math.floor(sorted.length * 0.95)],
    sql: instrumented.calls.slice(beforeLast).map((call) => call.sql.replace(/\s+/g, " ")),
  };
}

beforeAll(async () => {
  const db = env.DB as D1Database;
  await applyRepositoryMigrations(db as never);
  for (const statement of inject("kitchenSeedSql").split(/;\n/).map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
  for (const user of [CHEF, FRIEND]) {
    cookies.set(user, await createUserSessionCookie(user, env as never));
  }
});

const SCENARIOS: Scenario[] = [
  { name: "root loader (signed in)", url: "/", user: CHEF, run: (request, context) => rootLoader({ request, context, params: {} } as never) },
  { name: "root loader (anonymous)", url: "/", user: null, run: (request, context) => rootLoader({ request, context, params: {} } as never) },
  { name: "home loader (chef)", url: "/", user: CHEF, run: (request, context) => homeLoader({ request, context, params: {} } as never) },
  { name: "search loader q=rice (chef)", url: "/search?q=rice", user: CHEF, run: (request, context) => searchLoader({ request, context, params: {} } as never) },
  {
    name: "search loader q=rice after a data change (rebuild)",
    url: "/search?q=rice",
    user: CHEF,
    prepare: async () => {
      rebuildTick += 1;
      await (env.DB as D1Database)
        .prepare(`UPDATE "Recipe" SET "updatedAt" = ? WHERE "id" = ?`)
        .bind(new Date(Date.UTC(2030, 0, 1) + rebuildTick * 1000).toISOString(), RECIPE)
        .run();
    },
    run: (request, context) => searchLoader({ request, context, params: {} } as never),
  },
  { name: "search loader empty (anon)", url: "/search", user: null, run: (request, context) => searchLoader({ request, context, params: {} } as never) },
  { name: "recipe detail (owner)", url: `/recipes/${RECIPE}`, user: CHEF, run: (request, context) => loadRecipeDetail({ request, context, params: { id: RECIPE } } as never) },
  { name: "recipe detail (friend)", url: `/recipes/${RECIPE}`, user: FRIEND, run: (request, context) => loadRecipeDetail({ request, context, params: { id: RECIPE } } as never) },
  { name: "recipe detail (anon)", url: `/recipes/${RECIPE}`, user: null, run: (request, context) => loadRecipeDetail({ request, context, params: { id: RECIPE } } as never) },
  { name: "account settings (chef)", url: "/account/settings", user: CHEF, run: (request, context) => loadAccountSettings({ request, context } as never) },
];

it("prisma primitives", async () => {
  const results: Record<string, number> = {};
  const N = 100;
  let start = performance.now();
  const coldClient = await getDb({ DB: env.DB as D1Database });
  results.coldNewClientMs = performance.now() - start;
  start = performance.now();
  await coldClient.user.findUnique({ where: { id: CHEF }, select: { id: true } });
  results.coldFirstQueryMs = performance.now() - start;
  start = performance.now();
  for (let i = 0; i < N; i += 1) await getDb({ DB: env.DB as D1Database });
  results.newPrismaClientMs = (performance.now() - start) / N;
  start = performance.now();
  for (let i = 0; i < N; i += 1) {
    const client = await getDb({ DB: env.DB as D1Database });
    await client.user.findUnique({ where: { id: CHEF }, select: { id: true } });
  }
  results.newClientPlusFirstQueryMs = (performance.now() - start) / N;
  const shared = await getDb({ DB: env.DB as D1Database });
  await shared.user.findUnique({ where: { id: CHEF }, select: { id: true } });
  start = performance.now();
  for (let i = 0; i < N * 5; i += 1) await shared.user.findUnique({ where: { id: CHEF }, select: { id: true } });
  results.warmClientFindUniqueMs = (performance.now() - start) / (N * 5);
  start = performance.now();
  for (let i = 0; i < N * 5; i += 1) await (env.DB as D1Database).prepare('SELECT "id" FROM "User" WHERE "id" = ?').bind(CHEF).first();
  results.rawD1FirstMs = (performance.now() - start) / (N * 5);
  start = performance.now();
  for (let i = 0; i < N; i += 1) await (env.DB as D1Database).batch(Array.from({ length: 5 }, () => (env.DB as D1Database).prepare('SELECT "id" FROM "User" WHERE "id" = ?').bind(CHEF)));
  results.rawD1Batch5Ms = (performance.now() - start) / N;
  console.log(`BENCH_PRIMITIVES ${JSON.stringify(results)}`);
});

for (const scenario of SCENARIOS) {
  it(scenario.name, async () => {
    const result = await measure(scenario, ITERATIONS);
    console.log(`BENCH_ROW ${JSON.stringify(result)}`);
  });
}
