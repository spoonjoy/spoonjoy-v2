# Unit 1.2a Red Evidence

Captured: 2026-07-20

## Config contract

Command:

```sh
pnpm exec vitest run test/config/cook-session-binding.test.ts --config vitest.config.ts --maxWorkers=1
```

Result: expected exit 1. All three tests failed only because the repository does not yet contain the `COOK_SESSIONS`/`CookSession` lifecycle:

- production/QA config has no `COOK_SESSIONS` binding;
- the Workers test config has no `COOK_SESSIONS` binding; and
- `workers/cook-session.ts` does not exist.

## Runtime contract

Command:

```sh
pnpm run test:workers -- test/workers/cook-session-bootstrap.test.ts
```

Result: expected exit 1 with all twelve behavioral contract tests failing synchronously on the absent `COOK_SESSIONS` binding. There were zero skips, warnings, unhandled errors, timeouts, or failures from unrelated files. Once Unit 1.2b adds the binding, the same callbacks execute the public route, internal route, complete security matrix, adapter-construction, probe, idempotence, and seeded storage-residue assertions.

## Harness note

The Workers pool executes the real `workers/app.ts` entrypoint, whose existing server graph uses `~`, `@`, and generated Prisma imports. `vitest.workers.config.ts` now resolves those three existing project aliases so the real entrypoint can collect in the official Cloudflare pool. These aliases do not add or emulate CookSession behavior.

The existing Node-mocked `test/workers/app.test.ts` remains in the app pool, where its module mocks are isolated from the real Cloudflare integration. `vitest.config.ts` owns `workers/app.ts` coverage; the Workers pool owns `workers/cook-session.ts` coverage. Focused lane-boundary tests and all ten existing Worker unit tests pass.
