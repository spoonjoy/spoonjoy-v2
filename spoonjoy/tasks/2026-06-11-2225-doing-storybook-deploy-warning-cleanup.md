# Doing: Storybook Deploy Warning Cleanup

**Status**: IN_PROGRESS
**Execution Mode**: direct
**Created**: 2026-06-11 22:45
**Planning**: ./2026-06-11-2225-planning-storybook-deploy-warning-cleanup.md
**Artifacts**: ./2026-06-11-2225-doing-storybook-deploy-warning-cleanup/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (non-autopilot interactive mode only; autopilot must convert this to `spawn` or `direct` unless a hard exception is present)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Remove the remaining controllable warnings from the Storybook build/deploy workflow after the Wrangler action migration, while preserving main-only Cloudflare Pages deployment and keeping PR Storybook validation intact.

## Upstream Work Items
- Follow-up from PR #188 (`03f1a854`) terminal verification.

## Completion Criteria
- [x] `.github/workflows/storybook.yml` uses a single Storybook build job with main-only deploy steps after `pnpm build-storybook`.
- [x] Storybook workflow no longer uses `actions/upload-artifact@` or `actions/download-artifact@`.
- [x] Storybook deploy uses `cloudflare/wrangler-action@v4` from a generated clean Pages deploy directory, with `packageManager: npm` and command `pages deploy --project-name=spoonjoy-storybook --branch=${{ github.ref_name }} --commit-hash=${{ github.sha }} --commit-dirty=true`.
- [x] Generated Pages deploy directory contains a minimal `wrangler.json` with `pages_build_output_dir: storybook-static`.
- [x] `.gitignore` ignores the generated Storybook Pages deploy directory.
- [x] Main-only deploy behavior, Cloudflare token/account secrets, `deployments: write`, and `gitHubToken: ${{ secrets.GITHUB_TOKEN }}` are preserved.
- [x] Workflow-level Git config environment suppresses checkout default-branch hints.
- [x] Root `pnpm-workspace.yaml` encodes `allowBuilds: false` for the complete known pnpm ignored build dependency set: `@prisma/client`, `@prisma/engines`, `@swc/core`, `core-js`, `esbuild`, `prisma`, `protobufjs`, `sharp`, `unrs-resolver`, and `workerd`.
- [x] Deployment preflight rejects Storybook workflows that reintroduce artifact actions, repo-root Wrangler Pages deploy, missing clean deploy directory preparation, missing generated deploy-directory ignore rule, missing npm package manager, missing commit metadata, missing `--commit-dirty=true`, missing Git config env, or missing root `pnpm-workspace.yaml` `allowBuilds` config.
- [x] Local verification passes: focused red/green Storybook deploy warning-cleanup tests, targeted `scripts/deployment-preflight.ts` coverage at 100%, `pnpm install --frozen-lockfile`, `pnpm run deploy:preflight`, `pnpm run qa:preflight`, `pnpm run typecheck`, `pnpm run build`, `pnpm build-storybook`, Ruby Psych workflow parse, `git diff --check`, and full `pnpm run test:coverage`.
- [ ] Merged `main` Storybook workflow passes and its log has no matches for `node 20`, `cloudflare/pages-action`, checkout default-branch hint text, `actions/download-artifact`, `actions/upload-artifact`, `Ignored build scripts`, `Pages now has wrangler.json support`, or `uncommitted changes`.
- [ ] Production Deploy passes after merge and both production health endpoints return ok.
- [ ] Storybook Pages returns HTTP 200 after merge.
- [ ] No open PR, stale branch, or disposable QA residue remains from this slice.
- [ ] `spoonjoy/tasks/AUTOPILOT-STATE.md` records `SJ-044` as the next queued seed.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No coverage exclusions on new validation code
- All parser branches covered
- Error paths tested for each warning-regression shape
- Edge cases: missing job, missing deploy directory prep, wrong working directory, wrong package manager, missing commit metadata, missing dirty flag, missing ignore rule, and artifact action reintroduction

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
**What**: Verify current warning sources, pnpm `allowBuilds` behavior, Wrangler Pages deploy flags, and existing workflow/preflight parser shape.
**Output**: Evidence saved in the progress log.
**Acceptance**: Current warning strings and package names are recorded, temp-copy `pnpm-workspace.yaml` `allowBuilds: false` install probe emits no `Ignored build scripts` warning, and no tracked files are modified by research.

### ✅ Unit 1a: Warning-Clean Storybook Contract — Tests
**What**: Extend `test/scripts/deployment-preflight.test.ts` and `test/scripts/qa-preflight.test.ts` with red tests requiring the warning-clean Storybook workflow contract, root `pnpm-workspace.yaml` config, `.gitignore` coverage, and QA static-config read path updates. Extend the deployment-preflight input shape as tests require.
**Output**: Failing tests covering artifact-action reintroduction, missing clean deploy directory setup, missing `.gitignore` rule, repo-root Wrangler deploy, wrong package manager, missing commit metadata, missing `--commit-dirty=true`, missing Git config env, missing `allowBuilds: false` package entries, and QA preflight static-config propagation.
**Acceptance**: `pnpm exec vitest run test/scripts/deployment-preflight.test.ts test/scripts/qa-preflight.test.ts -t "Storybook deploy warning cleanup|QA static config"` fails before implementation for the new contract gaps. This is a local TDD checkpoint only; do not commit or push the deliberately red state.

### ✅ Unit 1b: Warning-Clean Storybook Contract — Implementation
**What**: Update `.github/workflows/storybook.yml`, `.gitignore`, `pnpm-workspace.yaml`, `scripts/deployment-preflight.ts`, and `scripts/qa-preflight.ts` to satisfy the red tests.
**Output**: Single-job Storybook workflow, ignored generated deploy wrapper directory, root pnpm workspace build-script decisions, and preflight validation for the warning-clean contract.
**Acceptance**: Focused Storybook warning-cleanup and QA static-config tests pass, `pnpm install --frozen-lockfile` emits no `Ignored build scripts` warning, Ruby Psych parses `.github/workflows/storybook.yml` and `pnpm-workspace.yaml`, and `pnpm build-storybook` passes. Commit and push the paired 1a/1b green state as the first code commit.

### ✅ Unit 1c: Warning-Clean Storybook Contract — Coverage & Full Local Verification
**What**: Run targeted coverage, preflights, typecheck, build, Storybook build, full coverage, and whitespace checks; add missing parser edge tests until coverage is 100%.
**Output**: Passing local verification and any small refactors/cleanup.
**Acceptance**: `scripts/deployment-preflight.ts` targeted coverage is 100% statements/branches/functions/lines, full `pnpm run test:coverage` passes at 100%, `pnpm run deploy:preflight`, `pnpm run qa:preflight`, `pnpm run typecheck`, `pnpm run build`, `pnpm build-storybook`, Ruby Psych parse, `pnpm install --frozen-lockfile`, and `git diff --check` pass with no targeted warnings.

### ⬜ Unit 2: Merge/Deploy Verification
**What**: Open/update PR, run cold implementation review, wait for PR checks, merge, wait for main CI/Storybook/Production Deploy, inspect Storybook logs for targeted warning strings, smoke production and Storybook Pages, clean branch/PR/QA residue, update durable state, and continue to `SJ-044`.
**Output**: Merged PR, successful main workflows, warning-clean Storybook log evidence, live smoke evidence, clean branch/PR/data state, and updated `AUTOPILOT-STATE.md`.
**Acceptance**: `main` contains the warning cleanup, main Storybook log has no targeted warning matches, production health endpoints return ok, Storybook Pages returns HTTP 200, no open PR/stale branch/disposable QA residue remains, and `AUTOPILOT-STATE.md` records `SJ-044` as next.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Unit 1a is a red-only TDD checkpoint; save output to artifacts but do not commit or push it until Unit 1b makes the paired test+implementation state green.
- Commit after each committable phase (paired 1a/1b green state, 1c, Unit 2 docs/terminal state)
- Push after each atomic commit
- Run full test suite before marking implementation done
- **All artifacts**: Save outputs, logs, data to `./2026-06-11-2225-doing-storybook-deploy-warning-cleanup/` directory when they are too large for progress log
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-11 22:45 Created from approved planning doc.
- 2026-06-11 22:58 Doing-doc review Round 1 found red-only commit/push risk and missing QA static-config test scope. Updated Unit 1a/1b so red tests stay local until the paired green commit, and added `test/scripts/qa-preflight.test.ts` coverage to the test unit.
- 2026-06-11 23:03 Unit 0 complete: main Storybook run `27395969794` still shows checkout default-branch hints, `actions/upload-artifact@v7`, `actions/download-artifact@v8`, pnpm `Ignored build scripts`, Wrangler Pages `wrangler.json` support warning, and Wrangler dirty-worktree warning with `--commit-dirty=true` guidance. The ignored-build package names are `@prisma/client`, `@prisma/engines`, `@swc/core`, `core-js`, `esbuild`, `prisma`, `protobufjs`, `sharp`, `unrs-resolver`, and `workerd`. A temp repo copy with root `pnpm-workspace.yaml` `allowBuilds: false` entries for that package set ran `pnpm install --frozen-lockfile` with no `Ignored build scripts` warning; research left no tracked source files modified.
- 2026-06-11 23:18 Units 1a/1b complete: red checkpoint `pnpm exec vitest run test/scripts/deployment-preflight.test.ts test/scripts/qa-preflight.test.ts -t "Storybook deploy warning cleanup|QA static config"` failed with 6 expected failures before implementation. Green verification passed after implementation: focused red command passed, full touched-file tests passed (`129` tests), `SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run deploy:preflight` passed, `SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run qa:preflight` passed, Ruby Psych parsed `.github/workflows/storybook.yml` and `pnpm-workspace.yaml`, clean `pnpm install --frozen-lockfile` passed with no `Ignored build scripts` warning after removing stale generated `node_modules`, and `pnpm build-storybook` passed. Code commit `a934eb4f` pushed.
- 2026-06-11 23:36 Unit 1c complete: added edge coverage for a Wrangler deploy step without `with`, noisy `pnpm-workspace.yaml` entries, and removed the dead `blockPropertyValue` parser helper. Verification passed: touched preflight suites (`131` tests), targeted `scripts/deployment-preflight.ts` coverage at 100% statements/branches/functions/lines, `pnpm install --frozen-lockfile` with no `Ignored build scripts` warning, `pnpm run deploy:preflight`, `pnpm run qa:preflight`, `pnpm run typecheck`, `pnpm run build`, `pnpm build-storybook`, Ruby Psych parse, `git diff --check`, local targeted warning-log scan, and full `pnpm run test:coverage` (`301` files, `5972` tests, 100% all files). Code commit `499d77ab` pushed.
- 2026-06-11 23:51 Cold implementation review Round 1 found that an extra deploy job with a different name than `deploy-storybook` could bypass the Storybook single-job contract. Added a red regression test for `other-deploy`, then fixed `workflowHasStorybookDeployContract` to require exactly one workflow job. Verification passed: red targeted test failed before fix, green targeted test passed after fix, touched preflight suites (`131` tests), targeted `scripts/deployment-preflight.ts` coverage at 100%, `pnpm run deploy:preflight`, `pnpm run qa:preflight`, `pnpm run typecheck`, `pnpm run build`, `pnpm build-storybook`, `git diff --check`, local targeted warning-log scan, and full `pnpm run test:coverage` (`301` files, `5972` tests, 100% all files). Code commit `b838fc32` pushed.
- 2026-06-12 00:05 Cold implementation review Round 2 found that quoted YAML job keys could bypass the Storybook single-job contract. Added red double-quoted and single-quoted extra-job regressions, then fixed `workflowJobBlocks` to count quoted job keys. Verification passed: red targeted test failed before fix, green targeted test passed after fix, touched preflight suites (`131` tests), targeted `scripts/deployment-preflight.ts` coverage at 100%, `pnpm run deploy:preflight`, `pnpm run qa:preflight`, `pnpm run typecheck`, clean rerun of `pnpm run build` after rejecting one transient canceled-build attempt, `pnpm build-storybook`, accepted-log warning scan, and full `pnpm run test:coverage` (`301` files, `5972` tests, 100% all files). Code commit `a7045ba0` pushed.
- 2026-06-12 00:19 Cold implementation review Round 3 found that an extra repo-root Wrangler deploy step could be added inside the valid `build-storybook` job while one valid deploy sequence still made the check pass. Added red regressions for an extra repo-root Wrangler action deploy, duplicate clean deploy action, and shell `wrangler pages deploy storybook-static`; then fixed the parser to reject any shell `pages deploy`, reject any non-clean Wrangler action step, and require exactly one clean prepare step plus exactly one clean deploy action step. Verification passed: red targeted test failed before fix, green targeted test passed after fix, touched preflight suites (`131` tests), targeted `scripts/deployment-preflight.ts` coverage at 100%, `pnpm run deploy:preflight`, `pnpm run qa:preflight`, `pnpm run typecheck`, clean rerun of `pnpm run build` after rejecting one transient canceled-build attempt, `pnpm build-storybook`, accepted-log warning scan, and full `pnpm run test:coverage` (`301` files, `5972` tests, 100% all files). Code commit `82d0e599` pushed.
- 2026-06-12 00:31 Cold implementation review Round 4 found that a shell deploy with shell-equivalent whitespace (`pages  deploy`) could bypass the string check. Added a red regression for the double-space shell deploy and fixed shell deploy detection to normalize whitespace per line before checking for `pages deploy`. Verification passed: red targeted test failed before fix, green targeted test passed after fix, touched preflight suites (`131` tests), targeted `scripts/deployment-preflight.ts` coverage at 100%, `pnpm run deploy:preflight`, `pnpm run qa:preflight`, `pnpm run typecheck`, `pnpm run build`, `pnpm build-storybook`, accepted-log warning scan, and full `pnpm run test:coverage` (`301` files, `5972` tests, 100% all files). Code commit `6fa1e10f` pushed.
- 2026-06-12 00:46 Cold implementation review Round 5 found that a shell deploy split with a line continuation (`pages \` newline `deploy`) could bypass the string check. Added a red regression for the continued shell deploy and fixed shell deploy detection to join backslash-newline continuations before matching `pages deploy`. Verification passed: red targeted test failed before fix, green targeted test passed after fix, touched preflight suites (`131` tests), targeted `scripts/deployment-preflight.ts` coverage at 100%, `pnpm run deploy:preflight`, `pnpm run qa:preflight`, `pnpm run typecheck`, `pnpm run build`, `pnpm build-storybook`, accepted-log warning scan, and full `pnpm run test:coverage` (`301` files, `5972` tests, 100% all files). Code commit `3b6a641f` pushed.
