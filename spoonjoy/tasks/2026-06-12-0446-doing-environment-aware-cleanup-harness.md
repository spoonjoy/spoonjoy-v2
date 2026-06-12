# Doing: Environment-Aware Cleanup Harness

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-06-12 04:58 America/Los_Angeles
**Planning**: ./2026-06-12-0446-planning-environment-aware-cleanup-harness.md
**Artifacts**: ./2026-06-12-0446-doing-environment-aware-cleanup-harness/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (non-autopilot interactive mode only; autopilot must convert this to `spawn` or `direct` unless a hard exception is present)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Make Spoonjoy smoke and cleanup scripts explicit about their target environment, safe by default for production, and useful enough for agents to clean QA disposable data including related image objects without ad hoc SQL/R2 commands.

## Upstream Work Items
- `BACKLOG.md` `SJ-044`: Environment-Aware Smoke, Cleanup, And Preflight Harness.
- `spoonjoy/tasks/2026-06-10-1521-planning-next-work-queue.md`: Next thin slice after `SJ-043`, `SJ-045`, and `SJ-047`.
- `spoonjoy/tasks/AUTOPILOT-STATE.md`: Current durable queue points to `SJ-044` as the active dogfood seed.

## Completion Criteria
- [ ] A shared resolver defines and validates `local`, `qa`, and `production` script targets and is consumed by smoke/preflight/cleanup code.
- [ ] Cleanup commands print resolved environment, base URL, D1 target, R2 target, and destructive-operation scope before any mutation.
- [ ] Cleanup refuses ambiguous remote mutation and refuses broad production mutation; production cleanup remains read-first and narrow.
- [ ] QA cleanup can remove disposable users, recipes, spoons, OAuth clients/codes/tokens, API credentials/idempotency keys, generated covers, and related QA R2 objects.
- [ ] QA cleanup reports and refuses mutation when any non-disposable row still references disposable cleanup targets.
- [ ] QA cleanup safely handles disposable recipe fork chains without mutating non-disposable fork attribution.
- [ ] Smoke artifacts include environment, base URL, branch/commit, created record ids, cleanup result, and retained/deleted R2 keys where available.
- [ ] Docs and preflight checks encode the explicit cleanup/smoke target contract.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings
- [ ] Work is merged to `main`, auto-deployment is verified, production smoke passes, and disposable local/QA/prod test data is clean.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch/case, try/catch)
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

### ⬜ Unit 0: Setup/Research
**What**: Verify branch/worktree state, current script/test files, current local cleanup residue, and exact schema relationships that the cleanup harness must respect.
**Output**: `unit-0-setup.log` with branch, status, current cleanup dry-run, and inspected files.
**Acceptance**: Branch is `spoonjoy/sj-044-cleanup-harness`; no unrelated dirty work is overwritten; cleanup starting state is recorded.

### ⬜ Unit 1a: Shared Environment Resolver — Tests
**What**: Add failing tests for a shared script target resolver covering `local`, `qa`, `production`, missing/invalid env, URL/env mismatch, D1/R2 target metadata, and destructive-operation scope text.
**Output**: Tests in `test/scripts/script-environment.test.ts` or equivalent plus red output in `unit-1a-red.log`.
**Acceptance**: Tests fail for missing resolver behavior, not for test syntax/import errors.

### ⬜ Unit 1b: Shared Environment Resolver — Implementation
**What**: Add `scripts/script-environment.ts` or equivalent and refactor `scripts/smoke-live-helpers.mjs` and `scripts/qa-preflight.ts` to consume it without changing their current accepted smoke/preflight behavior.
**Output**: Resolver module, updated imports/constants, and green focused resolver/smoke/preflight test output in `unit-1b-green.log`.
**Acceptance**: Unit 1a tests plus existing smoke/preflight helper tests pass with no warnings.

### ⬜ Unit 1c: Shared Environment Resolver — Coverage & Refactor
**What**: Verify new resolver coverage, add edge-case tests for empty base URL and invalid URL parsing if needed, and keep existing smoke/preflight behavior intact.
**Output**: Targeted coverage output in `unit-1c-coverage.log`.
**Acceptance**: New resolver has 100% statements, branches, functions, and lines; focused tests stay green.

### ⬜ Unit 2a: Environment-Aware Cleanup — Tests
**What**: Replace/extend cleanup tests to cover dry-run target summaries, local apply args, refusal of remote mutation without explicit `qa`, production read-only/refusal, QA apply intent, broad D1 cleanup SQL order, cross-boundary blocker queries, disposable fork-chain handling, R2 key extraction/validation, retained-key reporting, and exact Wrangler R2 delete/get argument shapes.
**Output**: Updated tests in `test/scripts/cleanup-local-qa-data.test.ts` or renamed equivalent plus red output in `unit-2a-red.log`.
**Acceptance**: Tests fail because cleanup harness behavior is missing, including at least one failure for cross-boundary blocker handling and one for QA R2 cleanup.

### ⬜ Unit 2b: Environment-Aware Cleanup — Implementation
**What**: Refactor `scripts/cleanup-local-qa-data.mjs` into the environment-aware cleanup harness while preserving backwards-compatible local dry-run behavior. Print target summary before work; collect R2 keys before D1 mutation; refuse broad production apply; run QA R2 exact-key deletes only for validated disposable keys; clear `sourceRecipeId` only inside the disposable target set after cross-boundary blockers are zero.
**Output**: Cleanup script implementation and green focused cleanup tests in `unit-2b-green.log`.
**Acceptance**: Unit 2a tests pass with no warnings; generated SQL contains no broad whole-database fork clearing and no production remote delete path.

### ⬜ Unit 2c: Environment-Aware Cleanup — Coverage & Refactor
**What**: Verify cleanup harness coverage, cover parse errors and Wrangler failure branches, and refactor duplicated SQL/key helpers only if it reduces risk.
**Output**: Targeted coverage output in `unit-2c-coverage.log`.
**Acceptance**: Cleanup script/helper new code reaches 100% coverage; focused tests remain green.

### ⬜ Unit 3a: Smoke Artifact Metadata — Tests
**What**: Add failing tests for smoke artifact metadata helpers so live smoke reports resolved environment, base URL, branch, commit, created record ids, cleanup result, and retained/deleted R2 keys where available.
**Output**: Tests in `test/scripts/smoke-live-helpers.test.ts` and/or `test/scripts/smoke-image-cover-live.test.ts` plus red output in `unit-3a-red.log`.
**Acceptance**: Tests fail on missing artifact metadata behavior, not on unrelated smoke setup.

### ⬜ Unit 3b: Smoke Artifact Metadata — Implementation
**What**: Wire resolver metadata and git branch/commit detection into `scripts/smoke-live.mjs` / helpers, without breaking existing exact-run cleanup or image-cover smoke cleanup.
**Output**: Updated smoke artifact code and green focused smoke tests in `unit-3b-green.log`.
**Acceptance**: Focused smoke helper/image-cover tests pass; report JSON keeps existing fields and adds the new metadata.

### ⬜ Unit 3c: Smoke Artifact Metadata — Coverage & Refactor
**What**: Verify metadata helper coverage and add edge tests for missing git info fallback if needed.
**Output**: Targeted coverage output in `unit-3c-coverage.log`.
**Acceptance**: New metadata code has 100% coverage and no warnings.

### ⬜ Unit 4a: Docs, Package Scripts, And Preflight — Tests
**What**: Add failing tests that require explicit cleanup package scripts, deployment preflight contract, and docs text for local dry-run, local apply, QA dry-run/apply, production read-only/refusal, and no broad production cleanup.
**Output**: Updated `test/scripts/deployment-preflight.test.ts` or focused docs tests plus red output in `unit-4a-red.log`.
**Acceptance**: Tests fail on current ambiguous `cleanup:qa` contract.

### ⬜ Unit 4b: Docs, Package Scripts, And Preflight — Implementation
**What**: Update `package.json`, `scripts/deployment-preflight.ts`, `README.md`, and `docs/deployment.md` so the explicit cleanup/smoke target contract is encoded for future agents.
**Output**: Updated docs/scripts and green focused deployment preflight tests in `unit-4b-green.log`.
**Acceptance**: Focused preflight/docs tests pass with no warnings.

### ⬜ Unit 4c: Docs, Package Scripts, And Preflight — Coverage & Refactor
**What**: Verify deployment preflight coverage remains 100% for modified code and docs assertions are precise enough to prevent ambiguous remote cleanup regression.
**Output**: Targeted deployment preflight coverage output in `unit-4c-coverage.log`.
**Acceptance**: Modified preflight code has 100% coverage and no warnings.

### ⬜ Unit 5: Local Verification And Live Safe Cleanup Dogfood
**What**: Run focused tests, full coverage, typecheck, build, local cleanup dry-run/apply if local residue exists, QA cleanup dry-run, production read-only cleanup check, QA preflight, and save outputs.
**Output**: `focused-tests.log`, `coverage.log`, `typecheck.log`, `build.log`, `cleanup-local.log`, `cleanup-qa-dry-run.log`, `cleanup-production-readonly.log`, and `qa-preflight.log`.
**Acceptance**: Commands pass with no warnings; QA/prod cleanup commands print resolved targets; production command refuses broad apply; no disposable local residue remains.

### ⬜ Unit 6: Implementation Review
**What**: Dispatch a cold implementation reviewer with the full diff, unit evidence, safety policy, and cleanup/deploy logs.
**Output**: `implementation-review.md` with reviewer verdict and any fixes.
**Acceptance**: Reviewer returns CONVERGED after any BLOCKER/MAJOR findings are fixed and re-reviewed.

### ⬜ Unit 7: Merge, Deploy, Smoke, Cleanup, And Continuation Scan
**What**: Create PR, wait for checks, merge to `main`, verify auto-deploy for the merge commit, run production health/custom-domain smoke and production live smoke, run final local/QA/prod cleanup checks, remove stale PR/branch state, update `AUTOPILOT-STATE.md`, notify Slugger, and run the durable continuation scan.
**Output**: `pr.log`, `main-checks.log`, `deploy-smoke.log`, `production-smoke.log`, `final-cleanup.log`, `branch-cleanup.log`, `slugger-notification.log`, and updated durable state.
**Acceptance**: PR merged; main checks and production deploy are green; production smoke passes; cleanup checks are clean; no stale branch/PR remains; next ready item is either started or durable state records why none is ready.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-12-0446-doing-environment-aware-cleanup-harness/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-12 04:58 Created from planning doc after reviewer convergence.
