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
**Output**: `unit-0-setup.log` with branch, status, current cleanup dry-run, and confirmation that these files were inspected: `scripts/smoke-live-helpers.mjs`, `scripts/smoke-live.mjs`, `scripts/smoke-image-cover-live.mjs`, `scripts/cleanup-local-qa-data.mjs`, `scripts/qa-preflight.ts`, `scripts/deployment-preflight.ts`, `test/helpers/cleanup.ts`, `test/scripts/cleanup-local-qa-data.test.ts`, `test/scripts/smoke-live-helpers.test.ts`, `test/scripts/deployment-preflight.test.ts`, `prisma/schema.prisma`, `package.json`, `README.md`, and `docs/deployment.md`.
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

### ⬜ Unit 2a: Cleanup Target/CLI Safety — Tests
**What**: Add failing cleanup tests for `--target-env local|qa|production`, missing/invalid target env, target summary output, local dry-run default, local apply args, refusal of remote mutation without explicit `--target-env qa --apply`, production read-only output, and production broad-apply refusal.
**Output**: Updated tests in `test/scripts/cleanup-local-qa-data.test.ts` plus red output in `unit-2a-red.log`.
**Acceptance**: Tests fail because current `scripts/cleanup-local-qa-data.mjs` is local-only and does not expose the explicit environment-aware CLI contract.

### ⬜ Unit 2b: Cleanup Target/CLI Safety — Implementation
**What**: Refactor `scripts/cleanup-local-qa-data.mjs` argument parsing and target summary behavior while preserving backwards-compatible local dry-run behavior for `pnpm cleanup:qa`.
**Output**: Cleanup CLI implementation and green focused cleanup CLI tests in `unit-2b-green.log`.
**Acceptance**: Unit 2a tests pass with no warnings; no D1 SQL semantics or R2 deletion behavior beyond target selection is changed in this unit.

### ⬜ Unit 2c: Cleanup Target/CLI Safety — Coverage & Refactor
**What**: Verify target/CLI parser coverage, including help text and invalid argument branches.
**Output**: Targeted coverage output in `unit-2c-coverage.log`.
**Acceptance**: Cleanup target/CLI new code reaches 100% coverage; focused tests remain green.

### ⬜ Unit 3a: D1 Disposable Cleanup And Blockers — Tests
**What**: Add failing cleanup tests for D1 dry-run SQL, broad D1 apply order, direct/cascade/count-only cleanup surfaces, cross-boundary blocker queries, disposable-only fork chains, mixed fork chains, and the rule that `sourceRecipeId` may be cleared only inside the disposable target set.
**Output**: Updated cleanup SQL tests plus red output in `unit-3a-red.log`.
**Acceptance**: Tests fail because current SQL lacks the full D1 blocker/fork-chain cleanup contract.

### ⬜ Unit 3b: D1 Disposable Cleanup And Blockers — Implementation
**What**: Implement the D1 cleanup query builders and apply sequencing for disposable rows. Block broad apply when cross-boundary non-disposable references exist; clear `sourceRecipeId` only where referencing and referenced recipes are both disposable; keep production broad mutation unavailable.
**Output**: D1 cleanup implementation and green focused cleanup SQL tests in `unit-3b-green.log`.
**Acceptance**: Unit 3a tests pass with no warnings; generated SQL contains no whole-database fork clearing and no production remote delete path.

### ⬜ Unit 3c: D1 Disposable Cleanup And Blockers — Coverage & Refactor
**What**: Verify D1 cleanup helper coverage and add branches for blocker-count parsing and Wrangler D1 failure reporting.
**Output**: Targeted coverage output in `unit-3c-coverage.log`.
**Acceptance**: D1 cleanup new code reaches 100% coverage; focused tests remain green.

### ⬜ Unit 4a: QA R2 Cleanup Planning — Tests
**What**: Add failing cleanup tests for `/photos/` key extraction from disposable `User.photoUrl`, `RecipeSpoon.photoUrl`, and `RecipeCover.imageUrl` / `stylizedImageUrl` / `sourceImageUrl`; validation of disposable-owner and generated-cover keys; retained-key reporting; and exact Wrangler R2 delete/get argument shapes.
**Output**: Updated cleanup R2 tests plus red output in `unit-4a-red.log`.
**Acceptance**: Tests fail because current broad cleanup does not plan or execute QA R2 cleanup.

### ⬜ Unit 4b: QA R2 Cleanup Planning — Implementation
**What**: Implement QA R2 key planning and exact-key deletion/verification for validated disposable keys, collecting candidate keys before D1 mutation and reporting retained invalid or unsafe keys.
**Output**: R2 cleanup implementation and green focused cleanup R2 tests in `unit-4b-green.log`.
**Acceptance**: Unit 4a tests pass with no warnings; R2 deletes use exact keys only and are unavailable for production broad cleanup.

### ⬜ Unit 4c: QA R2 Cleanup Planning — Coverage & Refactor
**What**: Verify R2 cleanup helper coverage and cover Wrangler R2 delete/get failure branches.
**Output**: Targeted coverage output in `unit-4c-coverage.log`.
**Acceptance**: R2 cleanup new code reaches 100% coverage; focused tests remain green.

### ⬜ Unit 5a: Smoke Artifact Metadata — Tests
**What**: Add failing tests for smoke artifact metadata helpers so live smoke reports resolved environment, base URL, branch, commit, created record ids, cleanup result, and retained/deleted R2 keys where available.
**Output**: Tests in `test/scripts/smoke-live-helpers.test.ts` and/or `test/scripts/smoke-image-cover-live.test.ts` plus red output in `unit-5a-red.log`.
**Acceptance**: Tests fail on missing artifact metadata behavior, not on unrelated smoke setup.

### ⬜ Unit 5b: Smoke Artifact Metadata — Implementation
**What**: Wire resolver metadata and git branch/commit detection into `scripts/smoke-live.mjs` / helpers, without breaking existing exact-run cleanup or image-cover smoke cleanup.
**Output**: Updated smoke artifact code and green focused smoke tests in `unit-5b-green.log`.
**Acceptance**: Focused smoke helper/image-cover tests pass; report JSON keeps existing fields and adds the new metadata.

### ⬜ Unit 5c: Smoke Artifact Metadata — Coverage & Refactor
**What**: Verify metadata helper coverage and add edge tests for missing git info fallback if needed.
**Output**: Targeted coverage output in `unit-5c-coverage.log`.
**Acceptance**: New metadata code has 100% coverage and no warnings.

### ⬜ Unit 6a: Docs, Package Scripts, And Preflight — Tests
**What**: Add failing tests that require explicit cleanup package scripts, deployment preflight contract, and docs text for local dry-run, local apply, QA dry-run/apply, production read-only/refusal, and no broad production cleanup.
**Output**: Updated `test/scripts/deployment-preflight.test.ts` or focused docs tests plus red output in `unit-6a-red.log`.
**Acceptance**: Tests fail on current ambiguous `cleanup:qa` contract.

### ⬜ Unit 6b: Docs, Package Scripts, And Preflight — Implementation
**What**: Update `package.json`, `scripts/deployment-preflight.ts`, `README.md`, and `docs/deployment.md` so the explicit cleanup/smoke target contract is encoded for future agents.
**Output**: Updated docs/scripts and green focused deployment preflight tests in `unit-6b-green.log`.
**Acceptance**: Focused preflight/docs tests pass with no warnings.

### ⬜ Unit 6c: Docs, Package Scripts, And Preflight — Coverage & Refactor
**What**: Verify deployment preflight coverage remains 100% for modified code and docs assertions are precise enough to prevent ambiguous remote cleanup regression.
**Output**: Targeted deployment preflight coverage output in `unit-6c-coverage.log`.
**Acceptance**: Modified preflight code has 100% coverage and no warnings.

### ⬜ Unit 7: Local Deterministic Verification
**What**: Run focused tests, full coverage, typecheck, build, and local cleanup dry-run/apply only when local disposable residue exists.
**Output**: `focused-tests.log`, `coverage.log`, `typecheck.log`, `build.log`, and `cleanup-local.log`.
**Acceptance**: Commands pass with no warnings; no disposable local residue remains.

### ⬜ Unit 8: Live Safe Cleanup Dogfood
**What**: Run QA cleanup dry-run, production read-only cleanup check, and QA preflight; save target summaries and refusal/read-only evidence.
**Output**: `cleanup-qa-dry-run.log`, `cleanup-production-readonly.log`, and `qa-preflight.log`.
**Acceptance**: Commands pass with no warnings; QA/prod cleanup commands print resolved targets; production command refuses broad apply.

### ⬜ Unit 9: Implementation Review
**What**: Dispatch a cold implementation reviewer with the full diff, unit evidence, safety policy, and cleanup/deploy logs.
**Output**: `implementation-review.md` with reviewer verdict.
**Acceptance**: Reviewer returns CONVERGED or lists BLOCKER/MAJOR/MINOR/NIT findings with exact file/test references.

### ⬜ Unit 10: Review Fixes
**What**: If Unit 9 has BLOCKER/MAJOR findings, add explicit fix commits for those findings and dispatch a narrow re-review; if Unit 9 converges, record that no fix commits were needed.
**Output**: `implementation-review-fixes.md` with fixes, verification commands, and re-review verdict.
**Acceptance**: No BLOCKER/MAJOR implementation-review findings remain.

### ⬜ Unit 11: PR Creation And Checks
**What**: Create the PR, push current branch, and wait for required PR checks.
**Output**: `pr.log` and `pr-checks.log`.
**Acceptance**: PR exists, branch is pushed, and required PR checks are green or explicitly non-applicable.

### ⬜ Unit 12: Merge And Auto-Deploy Verification
**What**: Merge the PR to `main`, wait for main CI/Storybook/Production Deploy, and verify auto-deploy for the merge commit.
**Output**: `main-checks.log` and `deploy-smoke.log`.
**Acceptance**: PR is merged; main checks pass; deployed production commit/version corresponds to the merge or the provider's deploy run for the merge is green.

### ⬜ Unit 13: Production Smoke And Final Cleanup
**What**: Run production health/custom-domain checks, production live smoke, final local/QA/prod cleanup checks, and save evidence.
**Output**: `production-smoke.log` and `final-cleanup.log`.
**Acceptance**: Production smoke passes; cleanup checks are clean; no disposable local/QA/prod residue remains from this run.

### ⬜ Unit 14: Branch Cleanup, Notification, And Continuation Scan
**What**: Remove stale PR/branch state, update `AUTOPILOT-STATE.md`, notify Slugger, and run the durable continuation scan.
**Output**: `branch-cleanup.log`, `slugger-notification.log`, and updated durable state.
**Acceptance**: No stale branch/PR remains; Slugger notification succeeds; next ready item is either started or durable state records why none is ready.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-12-0446-doing-environment-aware-cleanup-harness/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-12 04:58 Created from planning doc after reviewer convergence.
