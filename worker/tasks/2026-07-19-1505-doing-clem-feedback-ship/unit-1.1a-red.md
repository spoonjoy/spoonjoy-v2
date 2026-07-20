# Unit 1.1a Red Evidence

Command:

```text
pnpm exec vitest run test/config/workers-vitest-lane.test.ts test/config/warning-policy.test.ts
```

Initial result: expected exit status 1; 2 files failed and all 16 initial contract tests failed. Review then strengthened the suite with behavioral warning/browser collectors, exact fixture imports, and distinct CI job parsing.

Review-fix rerun result: expected exit status 1; the Workers file collected 4 tests and all 4 failed, while the warning-policy file failed during transform because the intentionally absent `test/warning-policy.ts` module could not be resolved. The captured Vitest output named only missing Unit 1.1 infrastructure and exact source/config assertions; it contained no unrelated product failure. The behavior cases will collect once Unit 1.1b supplies the modules they exercise.

A subsequent compatibility audit checked Cloudflare's current primary documentation and the published `@cloudflare/vitest-pool-workers@0.18.6` declaration file. That package exports `cloudflareTest`/`cloudflarePool`, not the removed `defineWorkersConfig` helper; shared WebSocket storage is selected with the already-tested `--maxWorkers=1 --no-isolate` command flags. The config assertion now requires the supported `cloudflareTest()` plugin shape and rejects the stale helper.

Round 2 then required end-to-end hook evidence rather than collector-only calls, plus syntax-aware fixture inventory. The repaired contract now spawns sentinel app/Workers Vitest runs that emit real console/process diagnostics, proves an exact owned `console.error` remains clean, exercises the browser context/page observer wiring with emitted events, and parses TypeScript imports so comments or type-only fixture imports cannot masquerade as runtime coverage while inline official type specifiers remain allowed.

Round 3 completed the matrix for both Vitest lanes, requires each unique sentinel in the captured diagnostic, parses the exported `defineConfig` AST to prove `cloudflareTest()` is imported/called and every lane option is executable structure, recognizes side-effect official imports as runtime imports, and parses exact executable CI `run:` commands rather than accepting commented text.

Current rerun: expected exit status 1; both files fail during transform on their intentionally absent implementation modules (`vitest.workers.config.ts` and `test/warning-policy.ts`), so no test bodies collect. This supersedes the earlier 4/4 Workers count while preserving the same implementation-only red boundary.

The failures are confined to the intentionally absent Unit 1.1 infrastructure:

- Vitest packages are still `4.0.18` and the Workers pool is absent.
- `vitest.workers.config.ts`, `vitest.workers.setup.ts`, and `wrangler.workers-test.json` do not exist.
- Workers tests are not excluded from the app lane and CI has no Workers coverage job.
- `scripts/run-with-warning-policy.mjs` and clean verification package scripts do not exist.
- The app setup still contains the legacy React/SQLite warning suppression.
- `e2e/fixtures.ts` does not exist and 17 Playwright spec/setup files still import runtime `test`/`expect` directly from `@playwright/test`.

No pre-existing product assertion failed.
