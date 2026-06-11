# Doing: MCP/API Image Cover Smokes

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-06-11 13:08
**Planning**: ./2026-06-11-1221-planning-mcp-image-cover-smokes.md
**Artifacts**: ./2026-06-11-1221-doing-mcp-image-cover-smokes/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (non-autopilot interactive mode only; autopilot must convert this to `spawn` or `direct` unless a hard exception is present)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Add a QA-targeted live smoke mode that proves Spoonjoy's remote API/MCP image and cover operations work end to end without touching production data or leaving disposable residue.

## Upstream Work Items
- `SJ-045`

## Completion Criteria
- [ ] `pnpm smoke:qa:image-cover` targets only the QA base URL and remote QA D1/R2 state.
- [ ] Smoke uploads a recipe image and spoon photo, rejects GIF uploads, creates a recipe, creates a spoon, lists/switches/archives covers, regenerates a cover, reads generation status, and browses spoon images.
- [ ] Smoke verifies EXIF metadata normalization with a downloaded stored object from `/photos/*`: dirty APP1 marker removed and sanitized Orientation equals the source fixture's intended orientation.
- [ ] Smoke proves `Chef photo`, `Editorialized chef photo`, and `AI generated` provenance labels through QA API/MCP-visible recipe-cover state.
- [ ] Smoke records and deletes every created QA R2 object key, refuses to delete keys outside `recipes/{ownerId}/uploads/` or `spoons/{ownerId}/uploads/`, verifies those exact objects are gone, cleans its disposable QA chef, and verifies the exact run-scoped email remains at count zero.
- [ ] MCP `/mcp` JSON-RPC is exercised with the minted bearer token for the critical cover/spoon operations, not just for token/list/ping checks.
- [ ] CI/scheduled QA smoke exists and is credential-gated so it never mutates production and never fails forks or unconfigured environments just because QA secrets are absent.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings

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

### ⬜ Unit 0: Setup And Current-State Capture
**What**: Confirm the approved planning doc, current branch, relevant API/MCP contracts, and artifact directory; update `AUTOPILOT-STATE.md`.
**Output**: Durable state points at this doing doc, branch, gate state, and next unit.
**Acceptance**: Planning status is `approved`; artifacts directory exists; current branch is `spoonjoy/mcp-image-cover-smokes`; state doc records the active objective and next action.

### ⬜ Unit 1a: Smoke Helper And Adapter Tests
**What**: Add failing tests for image-cover smoke helpers and outbound request adapters.
**Output**: Tests cover QA-only argument parsing, canonical R2 key extraction/validation, R2 delete/get args, EXIF fixture orientation parsing, dirty APP1 marker detection, API adapter request URL/body/headers, MCP JSON-RPC request body/headers, provider-secret preflight parsing, and package script expectations.
**Acceptance**: Focused tests fail red because helper exports, adapter functions, or package script do not exist yet; failures are meaningful outbound-shape/helper assertions.

### ⬜ Unit 1b: Smoke Helper And Adapter Implementation
**What**: Implement the helper and adapter code needed by the live smoke plus the `smoke:qa:image-cover` package command.
**Output**: `scripts/smoke-live-helpers.mjs` and any importable smoke helper module expose the tested functions; `package.json` includes `smoke:qa:image-cover`; deployment preflight recognizes the command.
**Acceptance**: Unit 1a tests pass green with no warnings.

### ⬜ Unit 1c: Smoke Helper Coverage And Refactor
**What**: Run the focused helper/preflight tests, inspect edge cases, and refactor for clarity without changing behavior.
**Output**: Clean focused test output saved in artifacts.
**Acceptance**: Focused tests pass; no warnings; helper error paths for unsafe target env, invalid R2 key, missing JSON response, and failed tool response are tested.

### ⬜ Unit 2a: Live Smoke Flow Tests
**What**: Add failing tests for live smoke flow composition where it can be injected without a browser: provider preflight sequencing, R2 cleanup-on-error, bounded generation polling, and provenance assertions.
**Output**: Tests prove the flow refuses mutation before QA/provider safety checks, polls terminal generation states with timeout, collects/deletes/verifies exact R2 keys, and requires the three provenance labels.
**Acceptance**: Tests fail red because the image-cover smoke flow is not integrated yet or does not call the expected injected operations.

### ⬜ Unit 2b: Live Smoke Flow Implementation
**What**: Integrate `--include-image-cover-smoke` into `scripts/smoke-live.mjs`.
**Output**: The existing QA browser smoke mints a scoped token, uploads JPEG/GIF/spoon fixtures through `/api/tools`, calls critical cover/spoon operations through `/mcp`, polls cover generation status, validates provenance and EXIF normalization, records created ids/R2 keys, and cleans R2/D1 in `finally`.
**Acceptance**: Unit 2a tests pass; existing smoke behavior is unchanged when the new flag is absent.

### ⬜ Unit 2c: Live Smoke Coverage And Refactor
**What**: Run focused smoke helper/flow tests and refactor script code for readability.
**Output**: Focused test output saved in artifacts; no behavior drift.
**Acceptance**: Focused tests pass with no warnings; all newly introduced branches in tested helper/flow modules are covered by tests.

### ⬜ Unit 3a: Scheduled QA Workflow Tests
**What**: Add failing tests/preflight assertions for the credential-gated GitHub Actions workflow.
**Output**: Tests assert the workflow file exists, runs only manually/scheduled, guards Cloudflare/image-provider secrets before mutation, installs dependencies, and runs `pnpm smoke:qa:image-cover`.
**Acceptance**: Tests fail red until the workflow exists and matches the expected guarded command shape.

### ⬜ Unit 3b: Scheduled QA Workflow Implementation
**What**: Add the credential-gated scheduled/manual QA image-cover smoke workflow and docs references if needed.
**Output**: `.github/workflows/qa-image-cover-smoke.yml` exists and skips cleanly when QA credentials are not configured.
**Acceptance**: Unit 3a tests pass; workflow cannot target production; workflow cannot run mutation steps without required secrets.

### ⬜ Unit 3c: Scheduled QA Workflow Coverage And Refactor
**What**: Run workflow/preflight tests and refactor the assertions if they are brittle.
**Output**: Focused test output saved in artifacts.
**Acceptance**: Focused tests pass with no warnings.

### ⬜ Unit 4: Local Verification
**What**: Run all focused tests, typecheck, build, and local cleanup inspection.
**Output**: Artifact logs for focused tests, typecheck, build, and `pnpm cleanup:qa`.
**Acceptance**: Local verification passes with no warnings; local disposable residue remains zero.

### ⬜ Unit 5: Remote QA E2E Verification
**What**: Run `pnpm smoke:qa:image-cover` against the QA Worker after confirming QA preflight and provider prerequisites.
**Output**: QA smoke JSON artifact plus command logs copied into the doing artifacts directory.
**Acceptance**: Smoke passes end to end, artifact proves API/MCP operation coverage, EXIF normalization, three provenance labels, exact R2 cleanup verification, exact user cleanup, and no production mutation.

### ⬜ Unit 6: Final Review, Merge, Deploy, And Cleanup
**What**: Run reviewer gate on the implementation, push, open/merge PR, verify CI/Storybook/Production Deploy for the merge commit, smoke health endpoints, close stale branches, and clean disposable test data.
**Output**: PR merged to `main`, production deploy verified, branch cleanup verified, final cleanup outputs saved, Slugger notified.
**Acceptance**: GitHub PR is merged; `main` is deployed; production health returns ok; no stale PRs/branches remain for this work; QA/production disposable smoke residue checks are clean.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-11-1221-doing-mcp-image-cover-smokes/`
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-11 13:08 Created from approved planning doc.
