// Cold-isolate cost of the first request on each hot loader (run without --no-isolate so
// this file gets a fresh isolate and module graph).
import { env } from "cloudflare:test";
import { inject, it } from "vitest";
import { applyRepositoryMigrations } from "../../test/workers/helpers/repository-migrations";

it("first request in a fresh isolate", async () => {
  const db = env.DB as D1Database;
  await applyRepositoryMigrations(db as never);
  for (const statement of inject("kitchenSeedSql").split(/;\n/).map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
  const { createUserSessionCookie } = await import("../../app/lib/session.server");
  const cookie = (await createUserSessionCookie("qa-kitchen-chef", env as never)).split(";")[0]!;
  const { loader } = await import("../../app/routes/_index");
  const context = { cloudflare: { env, ctx: { waitUntil() {} } } };
  const start = performance.now();
  await loader({ request: new Request("https://spoonjoy.test/", { headers: { Cookie: cookie } }), context, params: {} } as never);
  const first = performance.now() - start;
  const secondStart = performance.now();
  await loader({ request: new Request("https://spoonjoy.test/", { headers: { Cookie: cookie } }), context, params: {} } as never);
  const second = performance.now() - secondStart;
  console.log(`BENCH_COLD ${JSON.stringify({ route: "home loader (chef)", firstMs: first, secondMs: second })}`);
});
