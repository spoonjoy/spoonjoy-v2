# Doing: Storybook Deploy Warning Cleanup

**Status**: READY_FOR_REVIEW
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
- [ ] `.github/workflows/storybook.yml` uses a single Storybook build job with main-only deploy steps after `pnpm build-storybook`.
- [ ] Storybook workflow no longer uses `actions/upload-artifact@` or `actions/download-artifact@`.
- [ ] Storybook deploy uses `cloudflare/wrangler-action@v4` from a generated clean Pages deploy directory, with `packageManager: npm` and command `pages deploy --project-name=spoonjoy-storybook --branch=${{ github.ref_name }} --commit-hash=${{ github.sha }} --commit-dirty=true`.
- [ ] Generated Pages deploy directory contains a minimal `wrangler.json` with `pages_build_output_dir: storybook-static`.
- [ ] `.gitignore` ignores the generated Storybook Pages deploy directory.
- [ ] Main-only deploy behavior, Cloudflare token/account secrets, `deployments: write`, and `gitHubToken: ${{ secrets.GITHUB_TOKEN }}` are preserved.
- [ ] Workflow-level Git config environment suppresses checkout default-branch hints.
- [ ] Root `pnpm-workspace.yaml` encodes `allowBuilds: false` for the complete known pnpm ignored build dependency set: `@prisma/client`, `@prisma/engines`, `@swc/core`, `core-js`, `esbuild`, `prisma`, `protobufjs`, `sharp`, `unrs-resolver`, and `workerd`.
- [ ] Deployment preflight rejects Storybook workflows that reintroduce artifact actions, repo-root Wrangler Pages deploy, missing clean deploy directory preparation, missing generated deploy-directory ignore rule, missing npm package manager, missing commit metadata, missing `--commit-dirty=true`, missing Git config env, or missing root `pnpm-workspace.yaml` `allowBuilds` config.
- [ ] Local verification passes: focused red/green Storybook deploy warning-cleanup tests, targeted `scripts/deployment-preflight.ts` coverage at 100%, `pnpm install --frozen-lockfile`, `pnpm run deploy:preflight`, `pnpm run qa:preflight`, `pnpm run typecheck`, `pnpm run build`, `pnpm build-storybook`, Ruby Psych workflow parse, `git diff --check`, and full `pnpm run test:coverage`.
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

### ⬜ Unit 0: Setup/Research
**What**: Verify current warning sources, pnpm `allowBuilds` behavior, Wrangler Pages deploy flags, and existing workflow/preflight parser shape.
**Output**: Evidence saved in the progress log.
**Acceptance**: Current warning strings and package names are recorded, temp-copy `pnpm-workspace.yaml` `allowBuilds: false` install probe emits no `Ignored build scripts` warning, and no tracked files are modified by research.

### ⬜ Unit 1a: Warning-Clean Storybook Contract — Tests
**What**: Extend `test/scripts/deployment-preflight.test.ts` and `test/scripts/qa-preflight.test.ts` with red tests requiring the warning-clean Storybook workflow contract, root `pnpm-workspace.yaml` config, `.gitignore` coverage, and QA static-config read path updates. Extend the deployment-preflight input shape as tests require.
**Output**: Failing tests covering artifact-action reintroduction, missing clean deploy directory setup, missing `.gitignore` rule, repo-root Wrangler deploy, wrong package manager, missing commit metadata, missing `--commit-dirty=true`, missing Git config env, missing `allowBuilds: false` package entries, and QA preflight static-config propagation.
**Acceptance**: `pnpm exec vitest run test/scripts/deployment-preflight.test.ts test/scripts/qa-preflight.test.ts -t "Storybook deploy warning cleanup|QA static config"` fails before implementation for the new contract gaps. This is a local TDD checkpoint only; do not commit or push the deliberately red state.

### ⬜ Unit 1b: Warning-Clean Storybook Contract — Implementation
**What**: Update `.github/workflows/storybook.yml`, `.gitignore`, `pnpm-workspace.yaml`, `scripts/deployment-preflight.ts`, and `scripts/qa-preflight.ts` to satisfy the red tests.
**Output**: Single-job Storybook workflow, ignored generated deploy wrapper directory, root pnpm workspace build-script decisions, and preflight validation for the warning-clean contract.
**Acceptance**: Focused Storybook warning-cleanup and QA static-config tests pass, `pnpm install --frozen-lockfile` emits no `Ignored build scripts` warning, Ruby Psych parses `.github/workflows/storybook.yml` and `pnpm-workspace.yaml`, and `pnpm build-storybook` passes. Commit and push the paired 1a/1b green state as the first code commit.

### ⬜ Unit 1c: Warning-Clean Storybook Contract — Coverage & Full Local Verification
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
