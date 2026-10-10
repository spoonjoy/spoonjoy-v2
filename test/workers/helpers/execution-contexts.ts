import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach } from "vitest";

// Route actions called directly hand their background work (cover generation, stylization,
// notifications) to `ctx.waitUntil`. A context nobody waits on lets that work finish during a
// later test, so its writes and any warning it logs land there. Each test's contexts are
// awaited when it ends, so background work stays with the test that started it.

const pending: ExecutionContext[] = [];

/** An execution context whose `waitUntil` work is awaited when the current test ends. */
export function trackedExecutionContext(): ExecutionContext {
  const ctx = createExecutionContext();
  pending.push(ctx);
  return ctx;
}

afterEach(async () => {
  const contexts = pending.splice(0);
  for (const ctx of contexts) {
    await waitOnExecutionContext(ctx);
  }
});
