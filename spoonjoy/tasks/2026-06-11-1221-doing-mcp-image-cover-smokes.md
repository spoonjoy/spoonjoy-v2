# Doing: MCP/API Image Cover Smokes

**Status**: done
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
- [x] `pnpm smoke:qa:image-cover` targets only the QA base URL and remote QA D1/R2 state.
- [x] Smoke uploads a recipe image and spoon photo, rejects GIF uploads, creates a recipe, creates a spoon, lists/switches/archives covers, regenerates a cover, reads generation status, and browses spoon images.
- [x] Smoke verifies EXIF metadata normalization with a downloaded stored object from `/photos/*`: dirty APP1 marker removed and sanitized Orientation equals the source fixture's intended orientation.
- [x] Smoke proves `Chef photo`, `Editorialized chef photo`, and `AI generated` provenance labels through QA API/MCP-visible recipe-cover state.
- [x] Smoke records and deletes every created QA R2 object key, refuses to delete upload keys outside `recipes/{ownerId}/uploads/` or `spoons/{ownerId}/uploads/`, refuses to delete `covers/*` keys unless observed on this run's cover records, verifies those exact objects are gone, revokes its smoke credential, cleans its disposable QA chef, and verifies the exact run-scoped email remains at count zero.
- [x] MCP `/mcp` JSON-RPC is exercised with the minted bearer token for the critical cover/spoon operations, not just for token/list/ping checks.
- [x] CI/scheduled QA smoke exists and is credential-gated so it never mutates production and never fails forks or unconfigured environments just because QA secrets are absent.
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

### ✅ Unit 0: Setup And Current-State Capture
**What**: Confirm the approved planning doc, current branch, artifact directory, and these contract files: `scripts/smoke-live.mjs`, `scripts/smoke-live-helpers.mjs`, `app/lib/spoonjoy-api.server.ts`, `app/routes/api.$.ts`, `app/routes/mcp.ts`, `app/lib/mcp/http-mcp.server.ts`, `app/lib/image-storage.server.ts`, `app/lib/spoon-cover-stylization.server.ts`, `app/lib/ai-placeholder-cover.server.ts`, `package.json`, `scripts/deployment-preflight.ts`, and `test/scripts/deployment-preflight.test.ts`; update `AUTOPILOT-STATE.md`.
**Output**: Durable state points at this doing doc, branch, gate state, and next unit.
**Acceptance**: Planning status is `approved`; artifacts directory exists; current branch is `spoonjoy/mcp-image-cover-smokes`; state doc records the active objective and next action.

### ✅ Unit 1a: Smoke Helper And Adapter Tests
**What**: Add failing tests in `test/scripts/smoke-live-helpers.test.ts`, new `test/scripts/smoke-image-cover-live.test.ts`, and `test/scripts/deployment-preflight.test.ts`.
**Output**: Tests cover `--include-image-cover-smoke` QA-only parsing, canonical upload and generated `covers/*` R2 key extraction/validation, R2 delete/get args, generated JPEG fixture Orientation `6`, dirty APP1 marker detection, API adapter request URL/body/headers, MCP `tools/list` and `tools/call` JSON-RPC request body/headers, explicit `recipes:read kitchen:write` token scopes, credential revocation request shape, `wrangler secret list --env qa` provider-secret parsing, and exact package script expectations.
**Acceptance**: `pnpm exec vitest run test/scripts/smoke-live-helpers.test.ts test/scripts/smoke-image-cover-live.test.ts test/scripts/deployment-preflight.test.ts` fails red because `scripts/smoke-image-cover-live.mjs`, helper exports, workflow assertions, or `smoke:qa:image-cover` do not exist yet; failures are meaningful outbound-shape/helper assertions.

### ✅ Unit 1b: Smoke Helper And Adapter Implementation
**What**: Implement the helper and adapter code needed by the live smoke plus the `smoke:qa:image-cover` package command.
**Output**: `scripts/smoke-live-helpers.mjs` exports the new argument/R2 helpers; new `scripts/smoke-image-cover-live.mjs` exports API/MCP adapters, fixture builders, provider preflight parsing, polling, provenance, credential revocation, and cleanup helpers; `package.json` includes `smoke:qa:image-cover`; `scripts/deployment-preflight.ts` recognizes the command; `vitest.config.ts` includes the new script helper modules in coverage.
**Acceptance**: Unit 1a tests pass green with no warnings.

### ✅ Unit 1c: Smoke Helper Coverage And Refactor
**What**: Run the focused helper/preflight tests, inspect edge cases, and refactor for clarity without changing behavior.
**Output**: Clean focused test output saved in artifacts.
**Acceptance**: Focused tests pass; no warnings; helper error paths for unsafe target env, invalid R2 key, missing JSON response, and failed tool response are tested.

### ✅ Unit 2a: Live Smoke Flow Tests
**What**: Add failing tests for live smoke flow composition where it can be injected without a browser: provider preflight sequencing, R2 cleanup-on-error, bounded generation polling, and provenance assertions.
**Output**: `test/scripts/smoke-image-cover-live.test.ts` proves the flow refuses mutation before QA/provider safety checks, polls the browser-created AI placeholder before upload/spoon cover mutations, polls `get_cover_generation_status` to `succeeded`/`failed`/timeout with fixed attempts and delay, collects/deletes/verifies exact upload and generated-cover R2 keys, revokes the created credential, and requires `Chef photo`, `Editorialized chef photo`, and `AI generated`.
**Acceptance**: Tests fail red because the image-cover smoke flow is not integrated yet or does not call the expected injected operations.

### ✅ Unit 2b: Live Smoke Auth And API Upload Integration
**What**: Integrate `--include-image-cover-smoke` into `scripts/smoke-live.mjs` up to the API surface.
**Output**: With the flag present, the existing QA browser smoke runs pre-mutation safety checks, mints a scoped token through `POST /api/tools/create_api_token` with scopes `["recipes:read","kitchen:write"]`, polls the browser-created no-photo placeholder until `AI generated` is visible before later cover mutations, uploads the generated Orientation-6 JPEG through `POST /api/tools/upload_recipe_image`, rejects the GIF fixture through `POST /api/tools/upload_recipe_image`, uploads a spoon photo through `POST /api/tools/upload_spoon_photo`, downloads the stored JPEG, and validates dirty APP1 removal plus Orientation `6`.
**Acceptance**: The auth/API/upload portions of Unit 2a tests pass; existing smoke behavior is unchanged when the new flag is absent.

### ✅ Unit 2c: Live Smoke MCP Cover And Spoon Integration
**What**: Add the MCP JSON-RPC image-cover operation sequence to the flagged smoke path.
**Output**: The flagged smoke calls `/mcp` JSON-RPC `tools/list` as its own method, then calls `/mcp` JSON-RPC `tools/call` with `{ "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "<tool>", "arguments": { ... } } }` for `create_spoon`, `list_recipe_spoon_images`, `create_recipe_cover_from_upload`, `create_recipe_cover_from_spoon`, `regenerate_recipe_cover`, `get_cover_generation_status`, `set_active_recipe_cover`, `archive_recipe_cover`, and `list_recipe_covers`; it polls generation status and validates `Chef photo`, `Editorialized chef photo`, and `AI generated`.
**Acceptance**: The MCP/provenance/polling portions of Unit 2a tests pass.

### ✅ Unit 2d: Live Smoke Cleanup And Artifact Integration
**What**: Wire exact run-scoped cleanup and reporting into the flagged smoke path.
**Output**: The flagged smoke records created ids, the API credential id, image URLs, cover IDs, operation names, provenance labels, generation polling history, canonical upload R2 keys, and generated `covers/*` keys observed on this run's cover records; deletes/verifies exact QA R2 objects in `finally`; revokes the credential through the browser session; cleans D1 by exact disposable email; reports unrelated `codex-smoke-%` residue without broad cleanup; writes `qa-image-cover-smoke-artifacts/smoke-results.json`.
**Acceptance**: The cleanup/artifact portions of Unit 2a tests pass, including cleanup-on-error.

### ✅ Unit 2e: Live Smoke Coverage And Refactor
**What**: Run focused smoke helper/flow tests and refactor script code for readability.
**Output**: Focused test output saved in artifacts; no behavior drift.
**Acceptance**: Focused tests pass with no warnings; `pnpm run test:coverage` measures `scripts/smoke-live-helpers.mjs` and `scripts/smoke-image-cover-live.mjs`; all newly introduced branches in tested helper/flow modules are covered by tests.

### ✅ Unit 3a: Scheduled QA Workflow Tests
**What**: Add failing tests/preflight assertions for the credential-gated GitHub Actions workflow.
**Output**: Tests assert `.github/workflows/qa-image-cover-smoke.yml` exists, runs only on `workflow_dispatch` and `schedule`, guards `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, checks QA Cloudflare secrets before mutation with `wrangler secret list --env qa`, requires at least one configured image provider key among `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY`, installs dependencies, and runs `pnpm run smoke:qa:image-cover`.
**Acceptance**: Tests fail red until the workflow exists and matches the expected guarded command shape.

### ✅ Unit 3b: Scheduled QA Workflow Implementation
**What**: Add the credential-gated scheduled/manual QA image-cover smoke workflow and update `docs/deployment.md` if the smoke command or required QA secrets need documenting.
**Output**: `.github/workflows/qa-image-cover-smoke.yml` exists and skips cleanly when GitHub or QA Cloudflare credentials are not configured.
**Acceptance**: Unit 3a tests pass; workflow command includes `--target-env qa` and `https://spoonjoy-v2-qa.mendelow-studio.workers.dev`; workflow contains no production smoke/deploy command; workflow cannot run mutation steps without `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and one configured image-provider key.

### ✅ Unit 3c: Scheduled QA Workflow Coverage And Refactor
**What**: Run workflow/preflight tests and refactor the assertions if they are brittle.
**Output**: Focused test output saved in artifacts.
**Acceptance**: Focused tests pass with no warnings.

### ✅ Unit 4: Local Verification
**What**: Run focused tests, full coverage, typecheck, build, and local cleanup inspection.
**Output**: Save logs to `2026-06-11-1221-doing-mcp-image-cover-smokes/focused-tests.log`, `coverage.log`, `typecheck.log`, `build.log`, and `cleanup-local.log`.
**Acceptance**: These commands pass with no warnings: `pnpm exec vitest run test/scripts/smoke-live-helpers.test.ts test/scripts/smoke-image-cover-live.test.ts test/scripts/deployment-preflight.test.ts`, `pnpm run test:coverage`, `pnpm run typecheck`, `pnpm run build`, and `pnpm cleanup:qa`; local disposable residue remains zero.

### ✅ Unit 5: Remote QA E2E Verification
**What**: Run `pnpm run qa:preflight`, confirm `wrangler secret list --env qa` contains at least one of `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY`, then run `pnpm run smoke:qa:image-cover` against `https://spoonjoy-v2-qa.mendelow-studio.workers.dev`.
**Output**: Save command logs to `qa-preflight.log`, `qa-secrets.log`, and `qa-image-cover-smoke.log`; copy `qa-image-cover-smoke-artifacts/smoke-results.json` to `2026-06-11-1221-doing-mcp-image-cover-smokes/qa-image-cover-smoke-results.json`.
**Acceptance**: Smoke passes end to end; artifact proves API/MCP operation coverage, EXIF normalization, three provenance labels, exact R2 cleanup verification, exact user cleanup, and no production mutation.

### ✅ Unit 6a: Implementation Review Gate
**What**: Spawn a fresh implementation reviewer with the final diff, focused/full test logs, build/typecheck logs, and QA smoke artifact.
**Output**: Reviewer report saved to `implementation-review.md`; any BLOCKER/MAJOR findings are fixed and re-reviewed.
**Acceptance**: Reviewer returns CONVERGED or no BLOCKER/MAJOR findings remain.

### ✅ Unit 6b: PR Merge And Deploy Verification
**What**: Push the branch, create a PR with `gh pr create`, merge with `gh pr merge --squash --delete-branch` after checks pass, switch to `main`, pull/fast-forward to the merge commit, and verify GitHub Actions `CI`, `Storybook`, and `Production Deploy`.
**Output**: Save `gh-pr.log`, `gh-checks.log`, and `production-health.log`.
**Acceptance**: PR is merged; `main` is at the merge commit; Production Deploy for that commit succeeds; `https://spoonjoy-v2.mendelow-studio.workers.dev/health` and `https://spoonjoy.app/health` both return `{"status":"ok","service":"spoonjoy"}`.

### ✅ Unit 6c: Final Cleanup And Notification
**What**: Verify no stale PRs/branches remain for this work, run local/remote disposable-data checks, and notify Slugger.
**Output**: Save `branch-cleanup.log`, `final-cleanup-local.log`, `final-cleanup-qa-prod.log`, and Slugger notification output.
**Acceptance**: `gh pr list --state open` has no stale PR for this branch; local branch is deleted after merge; `pnpm cleanup:qa` is clean locally; QA and production D1 exact disposable residue checks are clean; `ouro msg --to slugger "Done: ..."` succeeds.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each unit or sub-unit completes
- Push after each commit
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-11-1221-doing-mcp-image-cover-smokes/`
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-11 13:08 Created from approved planning doc.
- 2026-06-11 13:17 Addressed ambiguity-review findings: exact contract files, test files, helper module, MCP tool matrix, fixture constants, provider secret names, verification commands, artifact filenames, split final merge/deploy/cleanup units, and commit/push cadence.
- 2026-06-11 13:20 Addressed granularity-review findings by splitting live smoke implementation into auth/API upload, MCP cover/spoon, and cleanup/artifact units.
- 2026-06-11 13:24 Unit 0 complete: planning approved, branch/artifacts confirmed, contract files inspected, and autopilot state updated.
- 2026-06-11 13:27 Quality review converged with one minor lifecycle fix; marked doing status `in-progress`.
- 2026-06-11 13:31 Adversarial reviewers found generated `covers/*` cleanup, token scopes/lifecycle, `tools/list`, placeholder polling, and script coverage gaps. Updated units to require generated-cover cleanup validation, explicit `recipes:read kitchen:write` token scopes, credential revocation, separate MCP `tools/list`, placeholder polling before cover mutations, and script coverage inclusion.
- 2026-06-11 13:34 Unit 1a complete: focused red test run saved to `unit-1a-red.log`; failures are missing helper module/exports, package script/preflight requirement, and coverage instrumentation.
- 2026-06-11 13:38 Unit 1b complete: helper module, smoke flag/R2 helpers, package script, preflight requirement, and coverage config implemented; focused tests passed in `unit-1b-green.log`.
- 2026-06-11 13:04 Unit 1c complete: focused helper/preflight coverage saved to `unit-1c-coverage.log` with 100% statements/branches/functions/lines for `scripts/smoke-live-helpers.mjs` and `scripts/smoke-image-cover-live.mjs`; build saved to `unit-1c-build.log` with no warnings.
- 2026-06-11 13:10 Unit 2a complete: red flow tests saved to `unit-2a-red.log`; failures are missing `runImageCoverSmokeFlow` and `pollCoverGeneration` implementation, while existing helper/preflight tests remain green. Unit review skipped because this is a tests-only red unit with intentional missing-function failures.
- 2026-06-11 13:15 Units 2b, 2c, and 2d complete: `scripts/smoke-live.mjs` now wires `--include-image-cover-smoke` through QA provider preflight, session-created scoped token, API uploads/GIF rejection/EXIF verification, MCP cover and spoon operations, generation polling, provenance checks, exact R2 cleanup, credential revocation, and smoke-result artifact reporting. Focused green tests saved to `unit-2bcd-green.log`; build saved to `unit-2bcd-build.log`; no warnings.
- 2026-06-11 13:21 Unit 2e complete: focused coverage saved to `unit-2e-coverage.log` with 100% statements/branches/functions/lines for `scripts/smoke-live-helpers.mjs` and `scripts/smoke-image-cover-live.mjs`; build saved to `unit-2e-build.log`; no warnings. Addressed implementation-review findings by failing the smoke if token revocation does not revoke and by recording operation names, cover IDs, image URLs, and generation polling history in `imageCoverSmoke`.
- 2026-06-11 13:25 Unit 3a complete: red workflow tests saved to `unit-3a-red.log`; failures are missing `QA image-cover smoke workflow` preflight check and missing `.github/workflows/qa-image-cover-smoke.yml`. Unit review skipped because this is a tests-only red unit with intentional missing-workflow failures.
- 2026-06-11 13:30 Units 3b and 3c complete: added `.github/workflows/qa-image-cover-smoke.yml` with manual/scheduled triggers, Cloudflare credential skip gate, QA provider-secret skip gate, QA-only smoke command, and artifact upload; deployment preflight now checks the workflow. Focused tests saved to `unit-3bc-green.log`; build saved to `unit-3bc-build.log`; no warnings.
- 2026-06-11 15:13 Unit 4 complete: hardened QA workflow preflight so `qa:preflight` reads `.github/workflows/qa-image-cover-smoke.yml` and structural checks prove trigger, credential, provider-secret, smoke, and artifact gates. Focused tests saved to `focused-tests.log`; full coverage saved to `coverage.log` with 100% tracked coverage; typecheck saved to `typecheck.log`; build saved to `build.log`; local QA cleanup dry run saved to `cleanup-local.log` with zero active disposable residue.
- 2026-06-11 16:47 Unit 5 complete: deployed QA version `11bb68e0-494e-4fd7-be4b-b780a0782edb`, passed `pnpm run qa:preflight`, confirmed QA has `GOOGLE_API_KEY` image-provider coverage, and passed `pnpm run smoke:qa:image-cover`. Evidence saved to `qa-preflight.log`, `qa-secrets.log`, `qa-image-cover-smoke.log`, and `qa-image-cover-smoke-results.json`; the smoke artifact has zero console/page errors, all required API/MCP operations, EXIF Orientation `6`, all three provenance labels, verified R2 deletes, revoked credential, and exact QA user cleanup count zero.
- 2026-06-11 17:46 Unit 6a complete: Feynman and Hegel review gates converged after fixes for R2 cleanup ordering, strict R2 delete verification, exact workflow trigger validation, exact shell-gate command validation, and heredoc spoof rejection. Reviewer summary saved to `implementation-review.md`; focused tests, full coverage, typecheck, build, QA preflight, and strict QA image-cover smoke evidence are current.
- 2026-06-11 18:10 Unit 6b complete: PR #184 merged as `85da85da1417e29c34f91e81ab8ace0f575bd111`; post-merge CI, Storybook, and Production Deploy all passed; `https://spoonjoy-v2.mendelow-studio.workers.dev/health` and `https://spoonjoy.app/health` both returned `{"status":"ok","service":"spoonjoy"}`. Evidence saved to `gh-pr.log`, `gh-checks.log`, `gh-merge.log`, `post-merge-runs.json`, `post-merge-ci-watch.log`, `production-deploy-watch.log`, and `production-health.log`.
- 2026-06-11 18:41 Follow-up docs/evidence PR #185 merged as `8fd4968b4654afb640d4637443bea2a98f500fbc`; CI, Storybook, Production Deploy, and both production health endpoints passed for that commit.
- 2026-06-11 18:41 Unit 6c complete: final branch cleanup shows only local `main`, no open PRs, no remote `spoonjoy/*` branches, and local/origin at `8fd4968b4654afb640d4637443bea2a98f500fbc`; local QA cleanup shows zero active disposable residue; remote QA and production D1 checks show zero Codex smoke users and no Codex/e2e recipe rows; Slugger notification succeeded. Evidence saved to `branch-cleanup.log`, `final-cleanup-local.log`, `final-cleanup-qa-prod.log`, and `slugger-notification.log`. Independent final auditor Helmholtz returned CONVERGED.
