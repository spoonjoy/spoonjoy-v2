# Doing: Dedicated QA Environment

**Status**: READY_FOR_EXECUTION
**Execution Mode**: direct
**Created**: 2026-06-11 09:45 America/Los_Angeles
**Planning**: ./2026-06-11-0923-planning-qa-environment.md
**Artifacts**: ./2026-06-11-0923-doing-qa-environment/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (non-autopilot interactive mode only; autopilot must convert this to `spawn` or `direct` unless a hard exception is present)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective

Add a real Spoonjoy QA deployment target with separate Cloudflare state so live/manual/e2e verification can create disposable users, recipes, images, and spoons without touching production data.

## Upstream Work Items

- `BACKLOG.md` `SJ-043`: Build a dedicated QA/test environment with separate Cloudflare state.
- `spoonjoy/tasks/2026-06-10-1521-planning-next-work-queue.md`: Current next-work queue and thin-slice handoff.

## Completion Criteria

- [ ] `wrangler.json` has a `qa` environment with distinct QA D1/R2/rate-limit/base URL settings.
- [ ] `pnpm run qa:preflight` proves QA config exists, is not aliased to production resources, resolves to the QA Worker URL, verifies QA secret presence with `wrangler secret list --env qa` when authenticated, and checks QA migrations with `--env qa`.
- [ ] QA D1 migrations can be listed/applied with `--env qa` without touching production.
- [x] QA R2 bucket exists and `pnpm run qa:preflight` or QA smoke performs an actual QA R2 write/read/delete verification.
- [ ] QA seed command is idempotent, creates only disposable/demo data, runs with `--env qa`, and refuses production resources.
- [x] QA deploy command builds and deploys `spoonjoy-v2-qa`.
- [x] QA smoke command targets the QA base URL, requires the QA Wrangler environment for remote cleanup, and does not default to production.
- [x] QA smoke skips or adapts the production-only Apple OAuth guard instead of hitting production as part of QA verification.
- [x] QA smoke creates disposable QA data and verifies that cleanup removed that data from QA D1.
- [ ] QA docs cover telemetry defaults, image-provider policy, OAuth callback expectations, WebAuthn/RP-origin expectations, QA seed data, and disposable data naming.
- [ ] Docs make it clear future agents should verify QA before production-risky live flows.
- [x] `pnpm run deploy:preflight`, `pnpm test:coverage`, and `pnpm typecheck` pass.
- [x] Work is merged to `main`, auto-deployment is verified, production smoke passes, and disposable test data is cleaned.
- [x] 100% test coverage on all new code
- [x] All tests pass
- [x] No warnings

## Code Coverage Requirements

**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## TDD Requirements

**Strict TDD — no exceptions:**
1. **Tests first**: Write failing tests BEFORE any implementation
2. **Verify failure**: Run tests, confirm they FAIL (red)
3. **Minimal implementation**: Write just enough code to pass
4. **Verify pass**: Run tests, confirm they PASS (green)
5. **Refactor**: Clean up, keep tests green
6. **No skipping**: Never write implementation without failing test first

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

**CRITICAL: Every unit header MUST start with status emoji (⬜ for new units).**

### ✅ Unit 0: Setup/Research
**What**: Verify branch/worktree state, existing Cloudflare auth, QA resource names, current deploy scripts, and current smoke cleanup behavior.
**Output**: Durable notes in the progress log and artifact directory where useful.
**Acceptance**: Branch is `spoonjoy/qa-environment`; QA D1/R2 resource existence is known; no unrelated worktree changes are overwritten.

### ✅ Unit 1a: Static QA Contract — Tests
**What**: Add failing tests for static QA configuration: `wrangler.json` `env.qa`, distinct D1/R2/rate-limit namespaces, QA base URL, and QA package scripts.
**Output**: Updated preflight/package tests plus red-run output saved under the artifacts directory.
**Acceptance**: Focused preflight tests fail because the QA environment/scripts do not exist yet.

### ✅ Unit 1b: Static QA Contract — Implementation
**What**: Add the `env.qa` Wrangler config, package scripts, and static deployment-preflight validation needed for the tests.
**Output**: `wrangler.json`, `package.json`, and static preflight helper changes.
**Acceptance**: Focused static QA contract tests pass with no warnings.

### ✅ Unit 1c: Static QA Contract — Coverage & Refactor
**What**: Refactor static preflight helpers only where needed and run targeted coverage.
**Output**: Targeted coverage/test output saved under the artifacts directory and any small helper cleanup needed.
**Acceptance**: New static validation branches are covered and focused tests remain green.

### ✅ Unit 2a: QA Remote Preflight — Tests
**What**: Add failing tests for `qa:preflight`: `--env qa` migration check, secret-list check, R2 write/read/delete argument construction, auth-warning behavior, and failure behavior for non-QA aliases.
**Output**: New QA preflight tests plus red-run output saved under the artifacts directory.
**Acceptance**: Focused QA preflight tests fail before the new script/helpers exist.

### ✅ Unit 2b: QA Remote Preflight — Implementation
**What**: Add a testable `scripts/qa-preflight.ts` that runs static config validation plus QA remote migration, secret, and R2 round-trip checks.
**Output**: `scripts/qa-preflight.ts`, package script wiring, and any shared preflight exports needed.
**Acceptance**: Focused QA preflight tests pass; no production `--remote` call is constructed without `--env qa`.

### ✅ Unit 2c: QA Remote Preflight — Coverage & Refactor
**What**: Cover success, auth-warning, parse/failure, and cleanup-after-R2-failure branches.
**Output**: Targeted coverage/test output saved under the artifacts directory and any helper cleanup needed.
**Acceptance**: New QA preflight code has 100% coverage and focused tests remain green.

### ✅ Unit 3a: QA Seed — Tests
**What**: Add failing tests for an idempotent QA seed command that builds SQL for disposable/demo data, includes `--env qa`, and refuses production or non-QA targets.
**Output**: New QA seed tests plus red-run output saved under the artifacts directory.
**Acceptance**: Focused QA seed tests fail before the seed script exists.

### ✅ Unit 3b: QA Seed — Implementation
**What**: Add `scripts/seed-qa.mjs` with exported testable SQL/argument helpers and a CLI that applies the seed to QA D1.
**Output**: `scripts/seed-qa.mjs`, package script wiring, and passing focused seed tests.
**Acceptance**: Focused seed tests pass; the seed helper cannot construct production D1 arguments.

### ✅ Unit 3c: QA Seed — Coverage & Refactor
**What**: Cover idempotency SQL fragments, shell args, dry-run behavior, and refusal branches.
**Output**: Targeted coverage/test output saved under the artifacts directory and any seed helper cleanup needed.
**Acceptance**: New seed code has 100% coverage and focused tests remain green.

### ✅ Unit 4a: QA-Safe Smoke Cleanup — Tests
**What**: Add failing tests around `scripts/smoke-live.mjs` helpers so QA cleanup uses `--env qa`, production cleanup is explicit, and Apple OAuth guard runs only for production.
**Output**: New smoke helper tests plus red-run output saved under the artifacts directory.
**Acceptance**: Focused smoke tests fail against the current hardcoded behavior.

### ✅ Unit 4b: QA-Safe Smoke Cleanup — Implementation
**What**: Refactor `scripts/smoke-live.mjs` to export testable helpers, support explicit `--target-env local|qa|production`, wire `smoke:qa`, and verify smoke cleanup removed the QA user.
**Output**: Updated smoke script, package script wiring, and passing focused smoke tests.
**Acceptance**: Focused smoke tests pass; `smoke:qa` cannot default to production and skips the production-only Apple OAuth check.

### ✅ Unit 4c: QA-Safe Smoke Cleanup — Coverage & Refactor
**What**: Cover local, QA, production, missing target env, cleanup failure, and post-cleanup verification branches.
**Output**: Targeted coverage/test output saved under the artifacts directory and any smoke helper cleanup needed.
**Acceptance**: New smoke helper code has 100% coverage and focused tests remain green.

### ✅ Unit 5a: Documentation — Tests
**What**: Add failing tests or extend existing docs tests for QA resource setup, secrets, telemetry/image-provider policy, OAuth/WebAuthn origin expectations, seed data, disposable naming, and verification commands.
**Output**: Updated docs/preflight tests plus red-run output saved under the artifacts directory.
**Acceptance**: Docs tests fail before README/DEPLOY/docs updates are made.

### ✅ Unit 5b: Documentation — Implementation
**What**: Update deployment docs, README/DEPLOY where appropriate, backlog/task docs, and autopilot state with the QA environment contract.
**Output**: Updated documentation and autopilot state.
**Acceptance**: Docs tests pass and the docs describe exact QA commands without suggesting production cleanup.

### ✅ Unit 5c: Documentation — Coverage & Refactor
**What**: Run focused docs/preflight tests and simplify wording or helper assertions if needed.
**Output**: Focused docs/preflight test output saved under the artifacts directory and any doc/test cleanup needed.
**Acceptance**: Docs-related tests remain green with no warnings.

### ✅ Unit 6a: Remote QA Verification — Tests/Preflight
**What**: Run local targeted tests, create or verify QA Cloudflare resources, apply QA migrations, verify QA secrets via `wrangler secret list --env qa` when authenticated, run QA seed, and run QA preflight. If auth or secret values are missing, record the exact blocker, do not touch production, and do not mark QA smoke complete.
**Output**: QA resource, migration, secret-list, seed, and preflight logs saved under the artifacts directory.
**Acceptance**: Command outputs are saved in the artifact directory; failures are actionable and do not touch production.

### ✅ Unit 6b: Remote QA Verification — Implementation
**What**: Deploy QA, run QA smoke, verify QA smoke cleanup in QA D1, and run R2 round-trip verification if not already covered by preflight.
**Output**: QA deploy, health, smoke, cleanup-verification, and R2 round-trip logs saved under the artifacts directory.
**Acceptance**: QA Worker is reachable, QA smoke passes, QA disposable user is gone after cleanup, and artifacts show the exact URL and environment.

### ✅ Unit 6c: Full Verification, Merge, Deploy
**What**: Run full `deploy:preflight`, `typecheck`, `test:coverage`, create/merge PR, verify main CI and auto-deploy, run production smoke, verify no disposable QA D1/R2 residue and no production smoke residue remain, close stale branch state, and notify Slugger without adding broader production cleanup powers.
**Output**: Full verification logs, PR/merge/deploy evidence, production smoke artifacts, QA/prod residue checks, and Slugger notification output saved under the artifacts directory.
**Acceptance**: `main` contains the work, production auto-deploy is verified for the merge commit, production smoke passes, no Codex QA/prod smoke residue remains, and no stale PR/branch remains for this task.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Red-only test units save failure evidence under `./2026-06-11-0923-doing-qa-environment/`; do not commit or push a deliberately failing suite as complete.
- Commit and push after the paired green/refactor slice passes.
- Run the full test suite before marking an implementation/refactor group complete.
- **All artifacts**: Save outputs, logs, data to `./2026-06-11-0923-doing-qa-environment/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-11 09:45 America/Los_Angeles Created from approved planning doc.
- 2026-06-11 09:53 America/Los_Angeles Addressed doing-doc reviewer findings: added missing outputs, moved docs tests out of Unit 1, clarified red-test commit handling, made QA secret blocker handling explicit, and strengthened cleanup verification.
- 2026-06-11 09:56 America/Los_Angeles Removed stale Unit 1a docs wording after reviewer re-check.
- 2026-06-11 09:58 America/Los_Angeles Doing-doc review gates converged; marked ready for execution.
- 2026-06-11 10:01 America/Los_Angeles Unit 0 complete: branch is clean on `spoonjoy/qa-environment`; Wrangler auth works; QA D1 `spoonjoy-qa` and QA R2 `spoonjoy-photos-qa` exist; setup evidence saved to `./2026-06-11-0923-doing-qa-environment/unit-0/setup-verification.txt`.
- 2026-06-11 10:45 America/Los_Angeles Units 1a-1c complete: added failing static QA tests, then implemented `env.qa`, QA scripts, and static deployment preflight checks. Focused tests pass; targeted coverage artifact saved with local thresholds because repo-wide coverage thresholds require the full suite.
- 2026-06-11 10:50 America/Los_Angeles Units 2a-2c complete: added failing QA preflight tests, then implemented `scripts/qa-preflight.ts` with QA D1 migration checks, QA secret checks, and QA R2 write/read/delete verification. Focused preflight tests pass.
- 2026-06-11 10:55 America/Los_Angeles Addressed Unit 1 reviewer findings: `deploy:qa` now builds with `CLOUDFLARE_ENV=qa`, QA preflight can validate generated `build/server/wrangler.json`, and static validation requires expected unique QA rate-limit bindings.
- 2026-06-11 10:57 America/Los_Angeles Units 3a-3c complete: added failing seed tests, then implemented `scripts/seed-qa.mjs` with idempotent disposable QA SQL and hard `--target-env qa` refusal. Focused scripts suite passes.
- 2026-06-11 11:00 America/Los_Angeles Units 4a-4c complete: added failing smoke-helper tests, then made live smoke cleanup target-explicit, QA cleanup use `--env qa`, production smoke explicit, Apple OAuth guard production-only, and cleanup verification query the same target environment. Focused scripts suite passes.
- 2026-06-11 11:02 America/Los_Angeles Units 5a-5c complete: added failing QA docs test, then documented QA resources, secret commands, telemetry/image-provider policy, OAuth callback and WebAuthn origin expectations, seed namespace, disposable smoke naming, and safe verification commands. Focused scripts suite passes.
- 2026-06-11 11:10 America/Los_Angeles Unit 6a complete: targeted tests passed; QA D1 migrations applied; QA Worker bootstrapped; QA runtime secrets set and listed; QA seed ran and reran idempotently; full QA preflight passed with generated build config, D1 migrations, secrets, and R2 round trip.
- 2026-06-11 10:10 America/Los_Angeles Addressed fresh reviewer findings before QA smoke: smoke target env and base URL now must match, and QA R2 preflight fails if the delete probe cannot be removed. Red/green evidence saved as `unit-review-fixes-red.txt` and `unit-review-fixes-green.txt`.
- 2026-06-11 10:12 America/Los_Angeles Unit 6b complete: documented QA deploy succeeded, `/health` returned ok, `pnpm run smoke:qa` passed, QA D1 `codex-smoke-%` residue count is 0, and QA R2 write/read/delete preflight passed. Smoke JSON and screenshots are saved under the artifact directory.
- 2026-06-11 10:21 America/Los_Angeles Fresh Unit 6b reviewer converged. Unit 6c local gates passed: `pnpm run deploy:preflight`, `pnpm typecheck`, `pnpm run test:coverage` (300 files, 5,871 tests, 100% coverage), and `pnpm run build`.
- 2026-06-11 10:43 America/Los_Angeles Unit 6c complete: PR #179 merged to `main`, production auto-deploy passed for merge commit `39979853`, production and custom-domain health checks returned ok, production smoke rerun passed with cleanup verification, QA/prod `codex-smoke-%` residue counts are 0, and post-merge main CI/Storybook passed.
