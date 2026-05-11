# Baseline (Unit 0)

- Branch: `codex/d001-deploy-remote-migration-check`
- Starting commit: `1558e65` (test: align mobile e2e headings with redesign)
- `pnpm typecheck`: passes clean.
- `pnpm test test/scripts/deployment-preflight.test.ts`: 3 tests pass, 0 warnings.
- Focused istanbul coverage on `scripts/deployment-preflight.ts`:
  - statements 63.82%, branches 65.9%, functions 84.21%, lines 67.44%
  - Uncovered lines: 182-198 (`formatCheck`, `main`), 205-208 (CLI guard `main().catch`)
  - These are pre-existing CLI-only paths.

## Strategy implication

Completion criterion #6 demands 100% on the whole file `scripts/deployment-preflight.ts`.
The pre-existing uncovered lines are CLI/print helpers (`formatCheck`, `main`, the `executedPath === currentPath` guard's success branch, and the `main().catch` handler).

These will be covered as part of Unit 5b's "100% on `scripts/deployment-preflight.ts`" requirement. Approach:
- Export (or re-export for tests) `formatCheck` and `main` so they can be invoked directly.
- Test `formatCheck` for the three prefix branches (PASS/WARN/FAIL).
- Test `main` by injecting a fake `runDeploymentPreflight`-equivalent path or by stubbing dependencies. Simplest: extract `main` to accept the result-producer as a dep, then invoke it under test with stubbed deps and capture `console.log` / `process.exit`.

This is implementation detail that surfaces during Unit 5b cleanup; the doing doc allows it under the "fixups within the same file" framing.

## Warnings baseline

Zero warnings in the test run output. Final must remain zero.
