# Doing: Storybook Wrangler Action Migration

**Status**: READY_FOR_EXECUTION
**Execution Mode**: direct
**Created**: 2026-06-11 20:44
**Planning**: ./2026-06-11-2038-planning-storybook-wrangler-action.md
**Artifacts**: ./2026-06-11-2038-doing-storybook-wrangler-action/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (non-autopilot interactive mode only; autopilot must convert this to `spawn` or `direct` unless a hard exception is present)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Remove the deprecated Cloudflare Pages GitHub Action from the Storybook deployment workflow so the verification pipeline stays warning-free and does not depend on the Node 20 action runtime cutoff.

## Upstream Work Items
- None

## Completion Criteria
- [ ] `.github/workflows/storybook.yml` no longer references `cloudflare/pages-action@v1`.
- [ ] Storybook deployment uses `cloudflare/wrangler-action@v4` with `pages deploy storybook-static --project-name=spoonjoy-storybook`.
- [ ] Existing secret names and main-branch deploy behavior are preserved.
- [ ] Existing `deployments: write` permission is preserved for GitHub deployment records.
- [ ] Workflow syntax is validated before merge.
- [ ] Local Storybook build passes with no warnings caused by this change.
- [ ] Merged `main` Storybook workflow passes after the change.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values
- This slice changes workflow configuration only; no application code coverage delta is expected.

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
**What**: Verify the current Storybook workflow, Cloudflare Wrangler action runtime, local Storybook build baseline, and generated artifact cleanliness.
**Output**: Evidence saved in the progress log and artifacts directory.
**Acceptance**: Existing workflow target is understood, `wrangler-action@v4` Node 24 evidence is recorded, and baseline `pnpm build-storybook` passes without leaving tracked changes.

### ✅ Unit 1a: Workflow Migration — Tests
**What**: Extend `test/scripts/deployment-preflight.test.ts` with a Storybook deploy workflow contract that expects `validateDeploymentConfig` to check a `storybookWorkflow` input. The red tests must fail while `scripts/deployment-preflight.ts` does not read/check `.github/workflows/storybook.yml` and while the repo workflow still uses `cloudflare/pages-action@v1`.
**Output**: Failing test coverage for the Storybook deploy workflow contract in `test/scripts/deployment-preflight.test.ts`.
**Acceptance**: `pnpm exec vitest run test/scripts/deployment-preflight.test.ts -t "Storybook deploy workflow"` fails before the workflow migration.

### ⬜ Unit 1b: Workflow Migration — Implementation
**What**: Extend `scripts/deployment-preflight.ts` to read `.github/workflows/storybook.yml` and validate the Storybook deploy contract, then replace the deploy step in `.github/workflows/storybook.yml` with `cloudflare/wrangler-action@v4` and command `pages deploy storybook-static --project-name=spoonjoy-storybook`, while preserving `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `deployments: write`, `gitHubToken: ${{ secrets.GITHUB_TOKEN }}`, and main-branch-only deploy behavior.
**Output**: Updated deployment preflight and Storybook workflow.
**Acceptance**: `pnpm exec vitest run test/scripts/deployment-preflight.test.ts -t "Storybook deploy workflow"` passes, `pnpm build-storybook` passes, and `ruby -e 'require "psych"; Psych.parse_file(".github/workflows/storybook.yml")'` parses the workflow.

### ⬜ Unit 1c: Workflow Migration — Coverage & Refactor
**What**: Run `pnpm exec vitest run test/scripts/deployment-preflight.test.ts --coverage` plus `pnpm run deploy:preflight` for the workflow validation code and inspect for warnings or stale generated artifacts.
**Output**: Passing verification evidence and any cleanup committed.
**Acceptance**: New workflow validation logic has 100% coverage, `git diff --check` passes, and the branch is ready for reviewer/merge.

### ⬜ Unit 2: Merge/Deploy Verification
**What**: Open the PR, run cold implementation review, merge after checks pass, wait for `main` Storybook workflow success, and clean the branch/PR state.
**Output**: Merged PR, successful main Storybook run, clean local and remote branch state.
**Acceptance**: `main` contains the migration, Storybook workflow passes on the merge commit, no open PR or stale `spoonjoy/storybook-wrangler-action` branch remains, and `spoonjoy/tasks/AUTOPILOT-STATE.md` records `SJ-044` as the next queued seed.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-11-2038-doing-storybook-wrangler-action/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-11 20:44 Created from planning doc
- 2026-06-11 20:48 Doing review Round 1 required exact validation files/commands and a concrete Storybook workflow syntax parse command.
- 2026-06-11 20:51 Doing review Round 2 converged; status set to READY_FOR_EXECUTION.
- 2026-06-11 20:53 Unit 0 complete: verified `cloudflare/wrangler-action@v4.0.0` uses Node 24, `v3` uses Node 20, baseline `pnpm build-storybook` passed, `.github/workflows/storybook.yml` parses with Ruby Psych, and the worktree stayed clean.
- 2026-06-11 20:55 Unit 1a red confirmed: `pnpm exec vitest run test/scripts/deployment-preflight.test.ts -t "Storybook deploy workflow"` failed because the Storybook deploy preflight check did not exist.
