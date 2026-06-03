# Unit 8c: Docs/Config/Sink Setup Verification

## Verification Commands

```bash
pnpm exec vitest run test/scripts/deployment-preflight.test.ts
```

Result: PASS, 1 file, 54 tests.

```bash
SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run deploy:preflight
```

Result: PASS. Output lists telemetry env names and check names only; no secret values are printed.

```bash
pnpm exec vitest run --coverage --coverage.include scripts/deployment-preflight.ts --coverage.thresholds.lines 0 --coverage.thresholds.functions 0 --coverage.thresholds.branches 0 --coverage.thresholds.statements 0 test/scripts/deployment-preflight.test.ts
```

Result: PASS. `scripts/deployment-preflight.ts` coverage:

- statements: 97.52%
- branches: 93.93%
- functions: 100%
- lines: 100%

Remaining uncovered branches are existing helper/default edges at lines 86, 270, 331, and 363, not the new telemetry checks.

## Regression Added

The Unit 8b reviewer found that `DEPLOY.md` listed `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, and `VITE_POSTHOG_DISABLED` under the `wrangler secret put` secrets table. Unit 8c adds a regression assertion that:

- `DEPLOY.md` does not document `wrangler secret put VITE_POSTHOG_KEY`
- `DEPLOY.md` does not document `wrangler secret put VITE_POSTHOG_DISABLED`
- `VITE_POSTHOG_*` values are not in the `wrangler secret put` summary section
- `VITE_POSTHOG_*` values are in the public build-time variables section

## Secret Safety

Secret scan command:

```bash
rg -n -e 'phc_' -e 'phx_' -e 'sk-[A-Za-z0-9]' -e 'sj_[A-Za-z0-9]' -e 'POSTHOG_KEY="[^"]+"' -e 'VITE_POSTHOG_KEY="[^"]+"' .env.example README.md DEPLOY.md docs/deployment.md docs/analytics-privacy.md test/scripts/deployment-preflight.test.ts spoonjoy/tasks/2026-06-02-2027-doing-world-class-telemetry || true
```

Only hit: the test regex that rejects real-looking PostHog key examples.

## Coverage Note

The unscoped coverage command:

```bash
pnpm exec vitest run --coverage test/scripts/deployment-preflight.test.ts
```

ran all 54 tests successfully but exited 1 because the repo-level 100% coverage threshold included unrelated app files that this focused docs/config suite does not import. The targeted include command above provides the meaningful coverage signal for Unit 8c.
