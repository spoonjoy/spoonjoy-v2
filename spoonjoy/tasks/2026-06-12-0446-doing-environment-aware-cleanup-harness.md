# Doing: Environment-Aware Cleanup Harness

**Status**: READY_FOR_EXECUTION
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
- [x] A shared resolver defines and validates `local`, `qa`, and `production` script targets and is consumed by smoke/preflight/cleanup code.
- [x] Cleanup commands print resolved environment, base URL, D1 target, R2 target, and destructive-operation scope before any mutation.
- [x] Cleanup refuses ambiguous remote mutation and refuses broad production mutation; production cleanup remains read-first and narrow.
- [x] QA cleanup can remove disposable users, recipes, spoons, OAuth clients/codes/tokens, API credentials/idempotency keys, generated covers, and related QA R2 objects.
- [x] QA cleanup reports and refuses mutation when any non-disposable row still references disposable cleanup targets.
- [x] QA cleanup safely handles disposable recipe fork chains without mutating non-disposable fork attribution.
- [x] Smoke artifacts include environment, base URL, branch/commit, created record ids, cleanup result, and retained/deleted R2 keys where available.
- [x] Docs and preflight checks encode the explicit cleanup/smoke target contract.
- [x] 100% test coverage on all new code
- [x] All tests pass
- [x] No warnings
- [x] Work is merged to `main`, auto-deployment is verified, production smoke passes, and disposable local/QA/prod test data is clean.

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

### ✅ Unit 0: Setup/Research
**What**: Verify branch/worktree state, current script/test files, current local cleanup residue, and exact schema relationships that the cleanup harness must respect.
**Output**: `unit-0-setup.log` with branch, status, current cleanup dry-run, and confirmation that these files were inspected: `scripts/smoke-live-helpers.mjs`, `scripts/smoke-live.mjs`, `scripts/smoke-api-live.mjs`, `scripts/smoke-image-cover-live.mjs`, `scripts/cleanup-local-qa-data.mjs`, `scripts/qa-preflight.ts`, `scripts/deployment-preflight.ts`, `test/helpers/cleanup.ts`, `test/scripts/cleanup-local-qa-data.test.ts`, `test/scripts/smoke-live-helpers.test.ts`, `test/scripts/deployment-preflight.test.ts`, `prisma/schema.prisma`, `package.json`, `README.md`, and `docs/deployment.md`.
**Acceptance**: Branch is `spoonjoy/sj-044-cleanup-harness`; no unrelated dirty work is overwritten; cleanup starting state is recorded.

### ✅ Unit 1a: Shared Environment Resolver — Tests
**What**: Add failing tests for a shared script target resolver covering `local`, `qa`, `production`, missing/invalid env, URL/env mismatch, D1/R2 target metadata, and destructive-operation scope text. Add failing tests for `scripts/smoke-api-live.mjs` target parsing so it requires `--target-env qa|production` for remote URLs, validates URL/env pairs through the shared resolver, and records environment metadata. Add failing package-script tests requiring `smoke:api` to pass `--target-env production`.
**Output**: Tests in `test/scripts/script-environment.test.ts`, `test/scripts/smoke-api-live.test.ts`, and `test/scripts/deployment-preflight.test.ts` plus red output in `unit-1a-red.log`.
**Acceptance**: Tests fail for missing resolver behavior, not for test syntax/import errors.

### ✅ Unit 1b: Shared Environment Resolver — Implementation
**What**: Add runtime-compatible `scripts/script-environment.mjs`, refactor `scripts/smoke-live-helpers.mjs`, `scripts/smoke-api-live.mjs`, and `scripts/qa-preflight.ts` to consume it, and update `package.json` so `smoke:api` passes `--target-env production`. Keep smoke scripts runnable with plain `node` package scripts; do not make `.mjs` scripts import a `.ts` module.
**Output**: Resolver module, updated imports/constants, and green focused resolver/smoke/preflight test output in `unit-1b-green.log`.
**Acceptance**: Unit 1a tests plus existing smoke/API/preflight helper tests pass with no warnings.

### ✅ Unit 1c: Shared Environment Resolver — Coverage & Refactor
**What**: Verify new resolver coverage, add edge-case tests for empty base URL and invalid URL parsing if needed, and keep existing smoke/preflight behavior intact.
**Output**: Targeted coverage output in `unit-1c-coverage.log`.
**Acceptance**: New resolver has 100% statements, branches, functions, and lines; focused tests stay green.

### ✅ Unit 2a: Cleanup Target/CLI Safety — Tests
**What**: Add failing cleanup tests for `--target-env local|qa|production`, missing/invalid target env, target summary output, local dry-run default, local apply args, QA remote dry-run args, QA remote apply refusal until D1/R2 cleanup safety is implemented, production read-only output, and production broad-apply refusal.
**Output**: Updated tests in `test/scripts/cleanup-local-qa-data.test.ts` plus red output in `unit-2a-red.log`.
**Acceptance**: Tests fail because current `scripts/cleanup-local-qa-data.mjs` is local-only and does not expose the explicit environment-aware CLI contract.

### ✅ Unit 2b: Cleanup Target/CLI Safety — Implementation
**What**: Refactor `scripts/cleanup-local-qa-data.mjs` argument parsing and target summary behavior while preserving backwards-compatible local dry-run behavior for `pnpm cleanup:qa`. At this stage, `--target-env qa` dry-run may inspect remote QA, but `--target-env qa --apply` must still refuse with a clear "remote QA apply not enabled until D1/R2 safety checks are installed" message.
**Output**: Cleanup CLI implementation and green focused cleanup CLI tests in `unit-2b-green.log`.
**Acceptance**: Unit 2a tests pass with no warnings; no D1 SQL semantics or R2 deletion behavior beyond target selection is changed in this unit; remote QA apply remains refused.

### ✅ Unit 2c: Cleanup Target/CLI Safety — Coverage & Refactor
**What**: Verify target/CLI parser coverage, including help text and invalid argument branches.
**Output**: Targeted coverage output in `unit-2c-coverage.log`.
**Acceptance**: Cleanup target/CLI new code reaches 100% coverage; focused tests remain green.

### ✅ Unit 3a: D1 Disposable Cleanup And Blockers — Tests
**What**: Add failing cleanup tests for D1 dry-run SQL, broad D1 apply order, the concrete cleanup surface mapping below, cross-boundary blocker queries, disposable-only fork chains, mixed fork chains, and the rule that `sourceRecipeId` may be cleared only inside the disposable target set. Disposable target predicates are `SUSPICIOUS_RECIPE_WHERE`, `DISPOSABLE_USER_WHERE`, spoon rows where `chefId` is a disposable user or `DISPOSABLE_SPOON_WHERE`, and OAuth clients matching the E2E OAuth test-client signature (`clientName = 'E2E OAuth Client'` plus redirect URI containing `codex`, `e2e`, `localhost`, or `127.0.0.1`). Tests must distinguish hard-deleted recipes owned by disposable users from suspicious recipes owned by non-disposable users that are only soft-deleted. Tests must cover ambiguous E2E OAuth client name matches without a test redirect signature, non-disposable `ApiCredential.oauthClientId`, `OAuthAuthCode.userId`, and `OAuthRefreshToken.userId` rows pointing at the E2E test client; disposable credential snapshotting before mutation; `AgentConnectionRequest` deletion before `ApiCredential` deletion for disposable `approvedById` or `credentialId` pointing at a snapshotted disposable-user credential; non-disposable `AgentConnectionRequest.approvedById` blockers before any credential nulling; non-disposable `ApiIdempotencyKey.credentialId` rows pointing at disposable credentials; non-disposable cookbook membership referencing hard-delete recipe targets or `addedById` disposable users; non-disposable cover history with `sourceSpoonId` pointing at disposable spoons or `createdById` pointing at disposable users; non-disposable `NotificationEvent.payload` references to hard-delete users/recipes/spoons/covers; absent search tables; and search rows for disposable/soft-deleted targets.
**Output**: Updated cleanup SQL tests plus red output in `unit-3a-red.log`.
**Acceptance**: Tests fail because current SQL lacks the full D1 blocker/fork-chain cleanup contract.

### ✅ Unit 3b: D1 Disposable Cleanup And Blockers — Implementation
**What**: Implement the D1 cleanup query builders and apply sequencing for disposable rows. Block broad apply when cross-boundary non-disposable references exist; clear `sourceRecipeId` only where referencing and referenced recipes are both disposable; keep production broad mutation unavailable. Cleanup target split: hard-delete recipe targets are recipes whose `chefId` is a disposable user; soft-delete-only recipe targets are suspicious recipes whose `chefId` is not a disposable user; disposable spoon targets are spoons whose `chefId` is a disposable user or whose note matches `DISPOSABLE_SPOON_WHERE`; E2E OAuth client targets require both `clientName = 'E2E OAuth Client'` and a redirect URI containing `codex`, `e2e`, `localhost`, or `127.0.0.1`; same-name OAuth clients without that redirect signature are blockers. Cleanup sequence and surface mapping: snapshot disposable `ApiCredential.id` values before any mutation; resolve/delete/block `AgentConnectionRequest` and `ApiIdempotencyKey` rows that reference those credential IDs before deleting any `ApiCredential`; direct delete `OAuthAuthCode` and `OAuthRefreshToken` rows for E2E OAuth test-client targets only when `userId` is a disposable user; blocker-report E2E OAuth code/token rows for non-disposable users; direct delete `ApiIdempotencyKey`, `ApiCredential`, `OAuth`, `UserCredential`, `PushSubscription`, `NotificationEvent`, `NotificationPreference`, and `ImageGenLedger` rows owned by disposable users only after credential-reference blockers are zero; blocker-report non-disposable `ApiIdempotencyKey` rows whose `credentialId` points at a snapshotted disposable credential; direct delete `AgentConnectionRequest` rows when `approvedById` is a disposable user or snapshotted `credentialId` points at a disposable user's `ApiCredential` and no non-disposable `approvedById` is present; blocker-report `AgentConnectionRequest` rows whose `credentialId` points at a snapshotted disposable credential while `approvedById` is a non-disposable user; blocker-report `ApiCredential` rows for non-disposable users whose `oauthClientId` points at an E2E OAuth test-client target; delete E2E OAuth test-client target rows only after non-disposable credential/code/token blockers are zero; direct delete `RecipeCover` rows only when their `recipeId` is a hard-delete recipe target, after recording their image URLs; blocker-report `RecipeCover` rows outside hard-delete recipe targets whose `sourceSpoonId` or `createdById` points at disposable targets; direct delete `RecipeSpoon` rows in the disposable target set; direct delete `RecipeInCookbook` rows only when the cookbook author is disposable; blocker-report `RecipeInCookbook` rows in non-disposable cookbooks when `recipeId` is a hard-delete recipe target or `addedById` is a disposable user; leave `RecipeInCookbook` rows for soft-delete-only suspicious recipes intact; direct delete `Cookbook` rows authored by disposable users; clear only in-target `Recipe.sourceRecipeId` links; hard-delete hard-delete recipe targets; soft-delete soft-delete-only recipe targets; hard-delete `User` rows in the disposable user target set after owned dependents and R2 candidate keys are collected. Cascade-verify `RecipeStep`, `Ingredient`, and `StepOutputUse` only for hard-deleted recipes; cascade-verify `ShoppingList` and `ShoppingListItem` only for hard-deleted users. Before touching search tables, detect their existence via `sqlite_master`; if present, direct delete `SearchDocument` rows whose `ownerId`, `entityId`, `href`, or `imageUrl` references disposable users, hard-deleted recipes/spoons/covers, or soft-deleted suspicious recipe IDs, then direct delete `SearchIndexMetadata` so the app rebuilds search; if absent, record search cleanup as skipped. Blocker-report non-disposable `NotificationEvent.payload` rows that contain hard-delete user, recipe, spoon, or cover IDs. Cross-boundary blockers: `Recipe.sourceRecipeId`, `RecipeSpoon.recipeId`, `RecipeInCookbook.recipeId`, non-disposable `RecipeInCookbook.addedById`, non-disposable cookbook author ownership, `Recipe.activeCoverId`, non-disposable `RecipeCover.sourceSpoonId`, non-disposable `RecipeCover.createdById`, non-disposable `AgentConnectionRequest.approvedById`, non-disposable `ApiIdempotencyKey.credentialId`, non-disposable `ApiCredential.oauthClientId`, non-disposable OAuth code/token `userId`, non-disposable `NotificationEvent.payload`, ambiguous OAuth client name matches, and surviving R2 key references when the referencing row is outside the disposable target set and the referenced row/key is inside it.
**Output**: D1 cleanup implementation and green focused cleanup SQL tests in `unit-3b-green.log`.
**Acceptance**: Unit 3a tests pass with no warnings; generated SQL contains no whole-database fork clearing and no production remote delete path.

### ✅ Unit 3c: D1 Disposable Cleanup And Blockers — Coverage & Refactor
**What**: Verify D1 cleanup helper coverage and add branches for blocker-count parsing and Wrangler D1 failure reporting.
**Output**: Targeted coverage output in `unit-3c-coverage.log`.
**Acceptance**: D1 cleanup new code reaches 100% coverage; focused tests remain green.

### ✅ Unit 4a: QA R2 Cleanup Planning — Tests
**What**: Add failing cleanup tests for `/photos/` key extraction from disposable `User.photoUrl`, `RecipeSpoon.photoUrl`, and `RecipeCover.imageUrl` / `stylizedImageUrl` / `sourceImageUrl`; validation of `profiles/{disposableUserId}/`, browser recipe keys under `recipes/{disposableUserId}/{recipeId}/`, browser spoon keys under `spoons/{disposableUserId}/{recipeId}/`, API upload keys under `recipes/{disposableUserId}/uploads/` and `spoons/{disposableUserId}/uploads/`, and generated-cover keys recorded from hard-delete recipe targets; retained-key reporting; surviving-reference blockers for outside `User.photoUrl`, `RecipeSpoon.photoUrl`, `RecipeCover.imageUrl` / `stylizedImageUrl` / `sourceImageUrl`, and `SearchDocument.imageUrl` rows reusing candidate keys; exact Wrangler R2 delete/get argument shapes; and failure-path behavior proving R2 delete/get commands are skipped when D1 apply fails.
**Output**: Updated cleanup R2 tests plus red output in `unit-4a-red.log`.
**Acceptance**: Tests fail because current broad cleanup does not plan or execute QA R2 cleanup.

### ✅ Unit 4b: QA R2 Cleanup Planning — Implementation
**What**: Implement QA R2 key planning and exact-key deletion/verification for validated disposable keys, collecting candidate keys before D1 mutation and reporting retained invalid or unsafe keys. Include profile photo keys under `profiles/{disposableUserId}/`, browser recipe keys under `recipes/{disposableUserId}/{recipeId}/`, browser spoon keys under `spoons/{disposableUserId}/{recipeId}/`, and API upload keys under `recipes/{disposableUserId}/uploads/` / `spoons/{disposableUserId}/uploads/`; reject those namespaces for non-disposable users. Before deleting any candidate key, blocker-report surviving non-disposable DB/search references to the same `/photos/{key}` in `User.photoUrl`, `RecipeSpoon.photoUrl`, `RecipeCover.imageUrl`, `RecipeCover.stylizedImageUrl`, `RecipeCover.sourceImageUrl`, and `SearchDocument.imageUrl`. Enable `--target-env qa --apply` only with this apply order: collect R2 candidate keys, run all D1/R2 blocker checks, apply D1 cleanup successfully, log a D1 cleanup success marker, then delete and verify exact R2 keys while logging retained, deleted, and verified key arrays. If D1 apply fails, log the D1 failure and skip every R2 delete/get command.
**Output**: R2 cleanup implementation and green focused cleanup R2 tests in `unit-4b-green.log`.
**Acceptance**: Unit 4a tests pass with no warnings; R2 deletes use exact keys only and are unavailable for production broad cleanup.

### ✅ Unit 4c: QA R2 Cleanup Planning — Coverage & Refactor
**What**: Verify R2 cleanup helper coverage and cover Wrangler R2 delete/get failure branches.
**Output**: Targeted coverage output in `unit-4c-coverage.log`.
**Acceptance**: R2 cleanup new code reaches 100% coverage; focused tests remain green.

### ✅ Unit 5a: Smoke Artifact Metadata — Tests
**What**: Add failing tests for a `buildSmokeReport` or `finalizeSmokeReport` helper used by `scripts/smoke-live.mjs` so `smoke-results.json` reports `environment.targetEnv`, `environment.baseUrl`, `environment.d1Target`, `environment.r2Target`, `environment.destructiveScope`, `git.branch`, `git.commit`, `created.email`, `created.username`, `created.recipeTitle`, `created.recipeId`, cleanup result, and `r2.retainedKeys` / `r2.deletedKeys` / `r2.verifiedDeletedKeys`. For normal smoke, R2 arrays must exist and be empty; for image-cover smoke, top-level R2 arrays must mirror `imageCoverSmoke.r2`. Add tests for `scripts/smoke-api-live.mjs` artifact serialization so its artifact includes environment/git metadata from Unit 1.
**Output**: Tests in `test/scripts/smoke-live-helpers.test.ts`, `test/scripts/smoke-image-cover-live.test.ts`, and `test/scripts/smoke-api-live.test.ts` plus red output in `unit-5a-red.log`.
**Acceptance**: Tests fail on missing artifact metadata behavior, not on unrelated smoke setup.

### ✅ Unit 5b: Smoke Artifact Metadata — Implementation
**What**: Wire resolver metadata and git branch/commit detection into `scripts/smoke-live.mjs`, `scripts/smoke-api-live.mjs`, and helpers, without breaking existing exact-run cleanup or image-cover smoke cleanup.
**Output**: Updated smoke artifact code and green focused smoke tests in `unit-5b-green.log`.
**Acceptance**: Focused smoke helper/image-cover tests pass; report JSON keeps existing fields and adds the new metadata.

### ✅ Unit 5c: Smoke Artifact Metadata — Coverage & Refactor
**What**: Verify metadata helper coverage and add edge tests for missing git info fallback if needed.
**Output**: Targeted coverage output in `unit-5c-coverage.log`.
**Acceptance**: New metadata code has 100% coverage and no warnings.

### ✅ Unit 6a: Docs, Package Scripts, And Preflight — Tests
**What**: Add failing tests that require explicit cleanup package scripts, deployment preflight contract, docs text for local dry-run, local apply, QA dry-run/apply, production read-only/refusal, no broad production cleanup, coverage instrumentation for `scripts/script-environment.mjs`, `scripts/cleanup-local-qa-data.mjs`, `scripts/smoke-api-live.mjs`, `scripts/qa-preflight.ts`, and `scripts/deployment-preflight.ts`, and a script typecheck command for modified TypeScript scripts.
**Output**: Updated `test/scripts/deployment-preflight.test.ts` plus red output in `unit-6a-red.log`.
**Acceptance**: Tests fail on current ambiguous `cleanup:qa` contract.

### ✅ Unit 6b: Docs, Package Scripts, And Preflight — Implementation
**What**: Update `package.json`, `scripts/deployment-preflight.ts`, `vitest.config.ts`, `README.md`, and `docs/deployment.md` so the explicit cleanup/smoke target contract is encoded for future agents. Keep `cleanup:qa` as a backwards-compatible local dry-run alias to `cleanup:local`; add `cleanup:local`, `cleanup:local:apply`, `cleanup:remote:qa`, `cleanup:remote:qa:apply`, and `cleanup:production`; make `smoke:api` pass `--target-env production`. Add `typecheck:scripts` package script and `tsconfig.scripts.json` if needed so modified TypeScript scripts are typechecked outside the app-only `tsconfig.json`.
**Output**: Updated docs/scripts and green focused deployment preflight tests in `unit-6b-green.log`.
**Acceptance**: Focused preflight/docs tests pass with no warnings.

### ✅ Unit 6c: Docs, Package Scripts, And Preflight — Coverage & Refactor
**What**: Verify deployment preflight coverage remains 100% for modified code and docs assertions are precise enough to prevent ambiguous remote cleanup regression.
**Output**: Targeted deployment preflight coverage output in `unit-6c-coverage.log`.
**Acceptance**: Modified preflight code has 100% coverage and no warnings.

### ✅ Unit 7: Local Deterministic Verification
**What**: Run these commands and save their output: `pnpm exec vitest run test/scripts/script-environment.test.ts test/scripts/cleanup-local-qa-data.test.ts test/scripts/smoke-live-helpers.test.ts test/scripts/smoke-image-cover-live.test.ts test/scripts/smoke-api-live.test.ts test/scripts/deployment-preflight.test.ts`; `pnpm run test:coverage`; `pnpm run typecheck`; `pnpm run typecheck:scripts`; `pnpm run build`; `pnpm run cleanup:local`. If `pnpm run cleanup:local` reports active disposable residue and zero blockers, run `pnpm run cleanup:local:apply` and then rerun `pnpm run cleanup:local`.
**Output**: `focused-tests.log`, `coverage.log`, `typecheck.log`, `build.log`, and `cleanup-local.log`.
**Acceptance**: Commands pass with no warnings; no disposable local residue remains.

### ✅ Unit 8: Live Safe Cleanup Dogfood
**What**: Run these commands and save their output: `pnpm run cleanup:remote:qa`; if it reports disposable QA residue and zero blockers, run `pnpm run cleanup:remote:qa:apply` and rerun `pnpm run cleanup:remote:qa`; `pnpm run cleanup:production`; `pnpm run cleanup:production -- --apply` with nonzero exit expected and captured as production broad-apply refusal evidence; `pnpm run qa:preflight`.
**Output**: `cleanup-qa-dry-run.log`, `cleanup-qa-apply.log` when apply runs, `cleanup-qa-post-apply.log` when apply runs, `cleanup-production-readonly.log`, `cleanup-production-apply-refusal.log` with exit code, and `qa-preflight.log`.
**Acceptance**: QA cleanup and QA preflight commands pass with no warnings; QA/prod cleanup commands print resolved targets; production read-only command passes; production `--apply` command refuses broad apply with the expected nonzero exit and no mutation.

### ✅ Unit 9: Implementation Review
**What**: Dispatch a cold implementation reviewer with the full diff, unit evidence, safety policy, and cleanup/deploy logs.
**Output**: `implementation-review.md` with reviewer verdict.
**Acceptance**: Reviewer returns CONVERGED or lists BLOCKER/MAJOR/MINOR/NIT findings with exact file/test references.

### ✅ Unit 10: Review Fixes
**What**: If Unit 9 has BLOCKER/MAJOR findings, add explicit fix commits for those findings and dispatch a narrow re-review; if Unit 9 converges, record that no fix commits were needed.
**Output**: `implementation-review-fixes.md` with fixes, verification commands, and re-review verdict.
**Acceptance**: No BLOCKER/MAJOR implementation-review findings remain.

### ✅ Unit 11: PR Creation And Checks
**What**: Push current branch, create the PR, and wait for required PR checks.
**Output**: `pr.log` and `pr-checks.log`.
**Acceptance**: PR exists, branch is pushed, and required PR checks are green or explicitly non-applicable.

### ✅ Unit 12: Merge And Auto-Deploy Verification
**What**: Merge the PR to `main`, wait for main CI/Storybook/Production Deploy, and verify auto-deploy for the merge commit.
**Output**: `main-checks.log` and `deploy-smoke.log`.
**Acceptance**: PR is merged; main checks pass; deployed production commit/version corresponds to the merge or the provider's deploy run for the merge is green.

### ✅ Unit 13: Production Smoke And Final Cleanup
**What**: Run production health/custom-domain checks with `curl -fsS https://spoonjoy-v2.mendelow-studio.workers.dev/health` and `curl -fsS https://spoonjoy.app/health`; run production live smoke with `pnpm run smoke:live`; run API smoke with `pnpm run smoke:api`; copy or record the produced `live-smoke-artifacts/smoke-results.json` and `api-live-smoke-artifacts/api-smoke-results.json` paths/contents into this task's artifact directory; run final cleanup checks with `pnpm run cleanup:local`, `pnpm run cleanup:remote:qa`, and `pnpm run cleanup:production`; save evidence.
**Output**: `production-smoke.log`, `production-smoke-results.json`, `api-smoke-results.json`, and `final-cleanup.log`.
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
- 2026-06-12 05:16 Doing-doc reviewer chain converged across granularity, validation, ambiguity, quality, Tinfoil Hat, and Stranger With Candy passes; status set to READY_FOR_EXECUTION.
- 2026-06-12 05:23 Unit 0 complete: branch/status, cleanup dry-run counts, inspected files, and cleanup-sensitive schema relationships recorded in `unit-0-setup.log`. Unit review skipped (reason: setup/research evidence only; no code behavior changed).
- 2026-06-12 06:13 Unit 1a complete: added resolver/API-smoke/package-script red tests and captured `unit-1a-red.log`; failures are missing resolver behavior, API target validation/metadata, and `smoke:api` package target contract. Unit review skipped (reason: red-test unit; implementation review follows green unit).
- 2026-06-12 06:16 Unit 1b complete: implemented shared script target resolver, wired live/API smoke and QA preflight constants to it, updated `smoke:api` to explicit production target, and captured focused green tests plus build logs in `unit-1b-green.log` and `unit-1b-build.log`.
- 2026-06-12 06:19 Unit 1c complete: added default-call resolver coverage, verified 100% coverage for `script-environment.mjs`, `smoke-api-live.mjs`, and `smoke-live-helpers.mjs`, and captured build output in `unit-1c-build.log`.
- 2026-06-12 06:20 Unit 1b cold review complete: Peirce returned CONVERGED with no findings; verdict recorded in `unit-1b-review.md`.
- 2026-06-12 06:22 Unit 2a complete: added cleanup target parser/summary/run-command red tests for local, QA, and production safety behavior; captured expected failures in `unit-2a-red.log`. Unit review skipped (reason: red-test unit; implementation review follows green unit).
- 2026-06-12 06:24 Unit 2b complete: implemented target-aware cleanup parser, target summary output, local apply, QA remote dry-run, QA apply refusal, production read-only dry-run, and production broad-apply refusal; focused tests and build captured in `unit-2b-green.log` and `unit-2b-build.log`.
- 2026-06-12 06:29 Unit 2b cold review complete: Raman reported one NIT about remote dry-run output mentioning local D1; verdict recorded in `unit-2b-review.md`.
- 2026-06-12 06:29 Unit 2c complete: fixed Raman's target-output nit, added CLI default/help/no-output/error-path coverage, verified 100% coverage for `cleanup-local-qa-data.mjs`, and captured focused/build logs in `unit-2c-focused.log`, `unit-2c-coverage.log`, and `unit-2c-build.log`.
- 2026-06-12 06:31 Unit 3a complete: added D1 cleanup SQL red tests for target snapshots, cross-boundary blockers, fork clearing, search cleanup, notification payload blockers, and safe mutation order; expected failures captured in `unit-3a-red.log`. Unit review skipped (reason: red-test unit; implementation review follows green unit).
- 2026-06-12 06:39 Unit 3b complete: implemented D1 target snapshots, blocker table, safe mutation ordering, in-target fork clearing, search cleanup guards, and notification payload blockers. Focused tests/build passed, local dry-run initially caught D1 `CREATE TEMP TABLE` auth behavior, implementation was corrected to D1-compatible helper tables, local apply executed, and post-apply dry-run remained clean for disposable users/spoons/OAuth clients. Evidence: `unit-3b-green.log`, `unit-3b-build.log`, `unit-3b-local-dry-run.log`, `unit-3b-local-apply.log`, `unit-3b-local-post-apply-dry-run.log`.
- 2026-06-12 06:41 Unit 3c complete: verified 100% coverage for `cleanup-local-qa-data.mjs` after D1 blocker cleanup changes and captured build output in `unit-3c-coverage.log` and `unit-3c-build.log`.
- 2026-06-12 06:42 Unit 3b cold review complete: Tesla reported one BLOCKER, two MAJOR findings, and one MINOR around duplicate credential snapshots, notification payload blockers, search-image cleanup ordering, and blocker reporting. Verdict recorded in `unit-3b-review.md`; fixes are required before QA R2 apply is enabled.
- 2026-06-12 06:45 Unit 4a complete: added QA R2 red tests for photo-key extraction, candidate planning, QA apply D1-before-R2 ordering, exact R2 delete/get commands, retained-key reporting, and D1-failure skip behavior; expected failures captured in `unit-4a-red.log`. Unit review skipped (reason: red-test unit; implementation review follows green unit).
- 2026-06-12 06:55 Unit 4b complete: implemented QA R2 candidate collection, retained-key reporting, surviving-reference blockers, exact R2 delete/get verification, QA apply enablement after D1 success, and Tesla's Unit 3b cleanup fixes. Focused tests/build/local dogfood passed with evidence in `unit-4b-green.log`, `unit-4b-build.log`, `unit-4b-local-dry-run.log`, `unit-4b-local-apply.log`, and `unit-4b-local-post-apply-dry-run.log`.
- 2026-06-12 07:01 Unit 4c complete: added R2 planner/parser/delete-verification edge coverage and verified `scripts/cleanup-local-qa-data.mjs` at 100% statements, branches, functions, and lines; build passed with evidence in `unit-4c-coverage.log` and `unit-4c-build.log`.
- 2026-06-12 07:10 Unit 4b review fix complete: Aquinas found a MAJOR absent-`SearchDocument` QA apply blocker and a MINOR blocker-visibility gap; fix split SearchDocument R2 blockers behind a table-existence probe, added D1 blocker-report preflight before apply, restored 100% cleanup coverage, and passed build/local dogfood. Evidence in `unit-4b-review.md` and `unit-4b-review-fix-*.log`; narrow re-review dispatched.
- 2026-06-12 07:12 Unit 5a complete: added red tests for live smoke report environment/git/created/R2 metadata, image-cover retained R2 keys, and API smoke git metadata; expected failures captured in `unit-5a-red.log`. Unit review skipped (reason: red-test unit; implementation review follows green unit).
- 2026-06-12 07:15 Unit 4b narrow re-review complete: Aquinas returned CONVERGED; verdict recorded in `unit-4b-review-round2.md`.
- 2026-06-12 07:15 Unit 5b complete: added shared smoke report metadata builder, git metadata capture, live smoke environment/created/R2 artifact shape, API smoke git metadata, and image-cover retained R2 arrays. Focused tests/build passed with evidence in `unit-5b-green.log` and `unit-5b-build.log`.
- 2026-06-12 07:17 Unit 5c complete: added git fallback/default report coverage and verified 100% coverage for `smoke-live-helpers.mjs`, `smoke-image-cover-live.mjs`, and `smoke-api-live.mjs`; build passed with evidence in `unit-5c-coverage.log` and `unit-5c-build.log`.
- 2026-06-12 07:20 Unit 6a complete: added red tests for explicit cleanup package scripts, cleanup target docs, script coverage instrumentation, and `typecheck:scripts`/`tsconfig.scripts.json`; expected failures captured in `unit-6a-red.log`. Unit review skipped (reason: red-test unit; implementation review follows green unit).
- 2026-06-12 07:25 Unit 6b complete: added explicit cleanup scripts, script typecheck config, coverage includes, deployment/QA preflight enforcement, and README/deployment cleanup target docs. Focused preflight tests, `typecheck:scripts`, and build passed with evidence in `unit-6b-green.log`, `unit-6b-typecheck-scripts.log`, and `unit-6b-build.log`.
- 2026-06-12 07:38 Unit 6c complete: hardened QA preflight CLI testability, added branch coverage for generated config validation, migration parsing, R2 failure cleanup, and CLI entry handling; deployment/QA preflight coverage is 100% statements/branches/functions/lines and build passed with evidence in `unit-6c-coverage.log`, `unit-6c-qa-preflight-green.log`, and `unit-6c-build.log`.
- 2026-06-12 07:52 Unit 6c review fix complete: Lagrange found one NIT for trailing whitespace/blank EOF in generated logs; normalized Unit 6c logs, suppressed intentional QA preflight CLI stdout in the default-failure test, reran 100% preflight coverage and build, and recorded the result in `unit-6c-review.md`. Narrow review satisfied by `git diff --check` and clean verification logs.
- 2026-06-12 08:00 Unit 7 complete: focused script tests, full 100% coverage, app typecheck, script typecheck, build, and local cleanup dry-run passed with evidence in `focused-tests.log`, `coverage.log`, `typecheck.log`, `typecheck-scripts.log`, `build.log`, and `cleanup-local.log`. Local cleanup reported zero active disposable users/spoons/OAuth clients, zero active suspicious recipes, and zero blockers; only already-deleted suspicious recipes remain, so no local apply was needed. Unit review skipped (reason: verification-only unit; no behavior changed beyond Unit 6c review fix already reviewed).
- 2026-06-12 08:04 Unit 8 complete: dogfooded live cleanup contract. QA cleanup dry-run resolved QA D1/R2 targets and reported all disposable counts at zero with zero blockers, so no QA apply was needed; production read-only cleanup resolved production D1/R2 targets and reported zero disposable counts; production broad apply refused with exit code 1; QA preflight passed D1 migrations, secrets, R2 round trip, and static config. Evidence in `cleanup-qa-dry-run.log`, `cleanup-production-readonly.log`, `cleanup-production-apply-refusal.log`, and `qa-preflight.log`. Unit review skipped (reason: live verification-only unit; no code changed).
- 2026-06-12 08:05 Unit 9 complete: Parfit returned FINDINGS with one BLOCKER, three MAJOR findings, and one MINOR: unsafe note-matched spoon R2 deletion, missing generated `covers/...` cleanup, hardcoded dry-run blocker zero, mutating blocker preflight SQL, and artifact whitespace. Findings recorded in `implementation-review.md`.
- 2026-06-12 08:14 Unit 10 complete: added red tests for all implementation-review findings, fixed QA R2 spoon namespace safety, generated cover cleanup, real dry-run blocker counts, read-only blocker preflight SQL, D1 compound-select compatibility, and artifact hygiene. Focused tests, 100% cleanup coverage, build, local/QA/prod cleanup dry-runs, and production broad-apply refusal passed with evidence in `unit-10-review-fixes-*.log` and `unit-10-cleanup-*.log`; fix summary recorded in `implementation-review-fixes.md`. Narrow re-review returned `CONVERGED`.
- 2026-06-12 09:06 Unit 11 complete: PR #193 initially passed checks but GitHub kept it pinned to stale head `30ced73c`; after pre-merge review found a MAJOR absent-search-table gap, fixed in `9ffa098d`, closed stale PR #193, opened replacement PR #194 on the fixed head, and watched PR checks green: Storybook, e2e, and coverage. Evidence in `unit-11-pr-checks.log`, `unit-11-replacement-pr-checks.log`, `premerge-review.md`, and `unit-11-premerge-search-*.log`.
- 2026-06-12 09:19 Unit 12 complete: PR #194 merged as `bf6ea6b13d16666d575d4483599a59619308acc2`; main CI, Storybook, and Production Deploy passed for that exact merge commit. Production Deploy run `27427777080` published Worker version `a7c13623-f833-43ec-ae4d-a5e76f819b58`. Evidence in `unit-12-main-checks.log` and `unit-13-production-health.log`.
- 2026-06-12 09:21 Unit 13 complete: production workers.dev and custom-domain health returned ok; `pnpm run smoke:live` and `pnpm run smoke:api` passed; smoke artifacts copied to `unit-13-production-smoke-results.json` and `unit-13-api-smoke-results.json`; final local, QA, and production cleanup checks passed with zero blockers. Evidence in `unit-13-*.log` and copied smoke JSON artifacts.
- 2026-06-12 09:22 Unit 14 partial: stale original branch `spoonjoy/sj-044-cleanup-harness` removed locally and remotely after PR #194 squash merge. Active terminal-verification branch remains only long enough to land this durable evidence and will be cleaned after its PR merges. Evidence in `unit-14-branch-cleanup.log`.
- 2026-06-12 09:36 Unit 14 review fix: Averroes found the top-level terminal completion criterion was still unchecked despite merge/deploy/smoke/cleanup evidence; marked it complete before merging terminal evidence PR #195.
