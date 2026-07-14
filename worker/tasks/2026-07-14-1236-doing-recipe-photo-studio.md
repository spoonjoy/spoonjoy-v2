# Doing: Recipe Photo Studio

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-07-14 12:39
**Planning**: ./2026-07-14-1236-planning-recipe-photo-studio.md
**Artifacts**: ./2026-07-14-1236-doing-recipe-photo-studio/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts only when the user explicitly requested interactive per-unit approval; otherwise convert this to `spawn` or `direct` unless a hard exception is present
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Build Recipe Photo Studio as the owner-facing recipe-management workflow for adding, editorializing, regenerating, and controlling a recipe's single public cover photo across web, native Apple, and MCP/agent surfaces.

## Upstream Work Items
- None

## Completion Criteria
- [ ] Recipe management exposes a polished Photo Studio web workflow for no-photo and has-photo recipes.
- [ ] Uploading the first photo can create a Spoon with optional Spoon fields and defaults to creating an editorialized recipe cover while preserving the original photo on the Spoon.
- [ ] The active recipe photo shows the original immediately while editorialization is processing, displays a clear loading chip, and refreshes to the editorial variant when ready.
- [ ] Backend cover lifecycle supports upload, Spoon-origin cover creation, AI placeholder generation, regeneration with prompt additions, activation, archive, no-cover mode, status polling, and owner media validation.
- [ ] REST API v1 exposes the native-required real cover upload/create/regenerate/status contracts with request-shape tests and docs/OpenAPI/playground drift coverage.
- [ ] Native queued cover uploads preserve `clientMutationId`, Spoon-posting fields, activation choice, and editorialization choice without dropping staged media on validation or cancellation errors.
- [ ] MCP/agent tools expose the same core cover lifecycle, including generated placeholders and prompt additions.
- [ ] Native Apple Photo Studio uses the real backend contracts and platform-native upload/Spoon/detail/editorial controls.
- [ ] User-facing cover labels no longer say misleading "Chef photo" or generic "Spoonjoy cookbook" for all covers.
- [ ] Prompt additions and cover lineage are persisted and tested for AI placeholder/editorial generation paths.
- [ ] Web and native changes are merged, deployed/published to the applicable non-human-gated targets, and smoke-tested through their consuming surfaces.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings
- [ ] If UI/rendering/layout changed: `visual-qa-dogfood` evidence captured, absurdity ledger closed, and automated visual metrics still pass

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

### ⬜ Unit 0: Setup/Research
**What**: Confirm both worktrees are on `worker/recipe-photo-studio`, read current source targets, record command inventory, and ensure the native branch is pushed before native commits begin.
**Output**: Artifact notes in `./2026-07-14-1236-doing-recipe-photo-studio/setup.md` covering web worktree, native worktree, source files, test files, command matrix, and any local capability blockers.
**Acceptance**: `git status --short --branch` is clean except task docs; source/test paths in the notes exist; web branch is pushed; native branch push status is recorded.

### ⬜ Unit 1a: Backend Prompt And Cover Lineage — Tests
**What**: Write failing tests for prompt additions, bounded prompt sanitization, cover lineage persistence, provider prompt forwarding, safer provenance labels, and first-photo activation guard behavior.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/image-gen.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/ai-placeholder-cover.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/spoon-cover-stylization.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/recipe-cover.server.test.ts`, and the relevant migration/schema test file.
**Acceptance**: Focused Vitest command fails for the new assertions for missing prompt additions, lineage fields, safer labels, and activation guard behavior.

### ⬜ Unit 1b: Backend Prompt And Cover Lineage — Implementation
**What**: Add `RecipeCover` lineage/prompt fields in Prisma and migration SQL, update image generation and scheduling helpers to accept bounded prompt additions, persist prompt lineage, and update provenance labels.
**Output**: Passing focused tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/prisma/schema.prisma`, migration files, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/image-gen.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/ai-placeholder-cover.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoon-cover-stylization.server.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-cover.server.ts`.
**Acceptance**: Focused Vitest command passes, Prisma generation/build-compatible schema checks pass, and no warnings appear in final green logs.

### ⬜ Unit 1c: Backend Prompt And Cover Lineage — Coverage & Refactor
**What**: Run focused coverage for new/modified backend lineage and prompt code, close branch/error-path gaps, and refactor only where it reduces duplication.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/backend-lineage-coverage.log`.
**Acceptance**: 100% coverage for new backend prompt/lineage code, focused tests still pass, and `npm run build` passes with no warnings.

### ⬜ Unit 2a: REST API And MCP Cover Contracts — Tests
**What**: Write failing tests for `/api/v1/recipes/:id/image`, JSON cover creation, generated placeholder creation, regeneration prompt additions, idempotency replay/conflict behavior, OpenAPI/playground docs, and MCP prompt/generate/upload tool behavior.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/api-v1-recipe-covers.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/api-v1-openapi.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/scripts/generate-api-playground.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/mcp.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/mcp/spoonjoy-tools.server.test.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/scripts/smoke-image-cover-live.test.ts`.
**Acceptance**: Focused Vitest command fails on missing route/tool contracts and missing request fields, with assertions capturing outgoing or generated request shapes where adapters/generators are touched.

### ⬜ Unit 2b: REST API And MCP Cover Contracts — Implementation
**What**: Implement real REST handlers and MCP tool updates for upload, JSON cover creation, generated placeholder creation, regeneration prompt additions, status/activation/archive/no-cover parity, idempotency, docs/OpenAPI, playground, and smoke script coverage.
**Output**: Passing focused tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/api-v1.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoonjoy-api.server.ts`, OpenAPI builder files, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/docs/api.md`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/scripts/generate-api-playground.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/scripts/smoke-image-cover-live.mjs`.
**Acceptance**: Focused API/MCP/OpenAPI/playground tests pass, multipart request-shape coverage proves field names, and final logs contain no warnings.

### ⬜ Unit 2c: REST API And MCP Cover Contracts — Coverage & Refactor
**What**: Run focused coverage for REST/MCP contract code, add missing edge cases for invalid MIME, foreign media, archived cover, prompt boundaries, replay/conflict, and provider-blocker paths.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/api-mcp-coverage.log`.
**Acceptance**: 100% coverage on new REST/MCP code, focused tests still pass, and `npm run build` passes with no warnings.

### ⬜ Unit 3a: Web Photo Studio UI — Tests
**What**: Write failing web route/component tests for the Recipe management Photo Studio first-photo flow, Spoon detail disclosure, default toggles, loading chip, auto-refresh when processing, generated placeholder action, prompt-addition regeneration, safer labels, and replacement of "Recipe covers" framing.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/recipes-id.test.tsx` and any component-focused test file created for the Photo Studio component.
**Acceptance**: Focused UI tests fail on missing Photo Studio UI, defaults, copy, and processing/autorefresh behavior.

### ⬜ Unit 3b: Web Photo Studio UI — Implementation
**What**: Build `RecipePhotoStudio` under recipe management, wire recipe-detail action/loader support, add first-photo upload with Spoon fields, default editorialization, loading chip/autorefresh, generated placeholder and regenerate controls with prompt additions, and update `RecipeHeader` processing chip if active cover is generating.
**Output**: Passing focused UI tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeCoverHistory.tsx` or its replacement, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/SpoonDialog.tsx` if shared controls are reused, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeHeader.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-detail.server.ts`.
**Acceptance**: Focused UI tests pass, route actions create the expected Spoon and cover records, and `npm run build` passes with no warnings.

### ⬜ Unit 3c: Web Photo Studio UI — Coverage & Refactor
**What**: Run focused coverage for Photo Studio UI/action code, cover empty/no-photo/has-photo/archived/processing/error branches, and refactor names/copy for product clarity.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/web-photo-studio-coverage.log`.
**Acceptance**: 100% coverage on new web UI/action code, focused tests still pass, and no "Chef photo", "Spoonjoy cookbook", or "On the counter" regressions appear in product surfaces.

### ⬜ Unit 3d: Web Photo Studio UI — Visual QA Dogfood
**What**: Run `visual-qa-dogfood` on recipe detail management Photo Studio states for no photo, uploading/processing, has active original, has editorial ready, prompt regenerate, generated placeholder, and narrow/desktop viewports.
**Output**: Screenshots and `./2026-07-14-1236-doing-recipe-photo-studio/web-visual-qa-ledger.md`.
**Acceptance**: Ledger has no `ready` or `needs reviewer gate` items, screenshots show readable controls/copy without overlap, and any visual reviewer gate passes.

### ⬜ Unit 4a: Native API, Sync, And Photo Studio — Tests
**What**: Write failing Swift tests for native request builders carrying `postAsSpoon`, Spoon fields, prompt additions, generated placeholder creation, upload idempotency metadata, queued `cover.upload` preservation, and native Photo Studio source-contract/UI copy.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/NativeAPIExpansionTests.swift`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/APITransportTests.swift`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/NativeSyncEngineTests.swift`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/CoverControlSurfaceTests.swift`, and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/RecipeActionParityTests.swift`.
**Acceptance**: Focused `swift test` command fails on missing fields, missing generated placeholder request, missing queued metadata, and old native cover-management copy.

### ⬜ Unit 4b: Native API, Sync, And Photo Studio — Implementation
**What**: Implement native request builders, queued mutation payloads, view model actions, and SwiftUI Photo Studio controls for upload/Spoon details/editorial defaults/prompt additions/generated placeholders using real REST contracts.
**Output**: Passing focused Swift tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/API/NativeAPIRequests.swift`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Features/Covers/RecipeCoverControlsViewModel.swift`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Sync/NativeSyncEngine.swift`, and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Apps/Spoonjoy/Shared/Views/RecipeCoverControlsView.swift`.
**Acceptance**: Focused Swift tests pass, native app source-contract tests pass, and request-builder tests parse multipart bodies and assert field names/values.

### ⬜ Unit 4c: Native API, Sync, And Photo Studio — Coverage & Refactor
**What**: Run native focused coverage/refactor checks, close branch/error-path gaps for upload validation and queued metadata, and keep platform-native UI copy/product language aligned with web.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/native-coverage.log`.
**Acceptance**: New native code coverage is complete for request/build/sync/view-model branches, focused tests still pass, and no warnings appear in final Swift test logs.

### ⬜ Unit 4d: Native API, Sync, And Photo Studio — Native Validation
**What**: Run native validation from `build-native-apple-app`: `swift test`, app-target build commands available in the repo, and screenshot or blocker artifacts for touched native Photo Studio surfaces.
**Output**: Native validation logs and screenshots/blocker artifacts under `./2026-07-14-1236-doing-recipe-photo-studio/native-validation/`.
**Acceptance**: Required native validation passes, or any Xcode/simulator/capability blocker is documented with exact command, exit code, and fallback evidence.

### ⬜ Unit 5a: Cross-Surface Integration — Tests
**What**: Write failing integration/contract tests that prove web REST, native request shapes, MCP tools, docs/OpenAPI, and smoke scripts agree on field names and behavior for first-photo, generated placeholder, prompt additions, status, and activation.
**Output**: Red cross-surface tests or source-contract checks in the web and native test suites.
**Acceptance**: Tests fail only on real drift between surfaces, not on missing fixtures or unrelated setup.

### ⬜ Unit 5b: Cross-Surface Integration — Implementation
**What**: Fix contract drift found by Unit 5a, update docs and smoke fixtures, regenerate playground or generated artifacts as required, and verify local API/native consumers agree.
**Output**: Passing cross-surface tests, updated generated/docs artifacts, and smoke notes.
**Acceptance**: Cross-surface focused tests pass in both repositories with no warnings.

### ⬜ Unit 5c: Cross-Surface Integration — Coverage & Refactor
**What**: Run the final focused web coverage suite, final focused native test suite, full web test/build commands, and any required generated-contract scan.
**Output**: Final logs in `./2026-07-14-1236-doing-recipe-photo-studio/final-validation/`.
**Acceptance**: All required tests/builds pass with no warnings; coverage criteria are met; stale failed logs are either removed or clearly marked red-phase evidence.

### ⬜ Unit 6: Merge, Deploy, Smoke, Cleanup
**What**: Create PRs as needed, pass reviewer gates, merge web and native branches, verify production or applicable deployment/install surfaces, run smoke checks, clean task worktrees, clean QA residue, and notify Slugger.
**Output**: PR/deploy/smoke/cleanup artifacts and final task status updates.
**Acceptance**: Web and native changes are merged or a true human-only blocker is recorded; production/applicable smoke checks pass; `pnpm cleanup:qa` or equivalent confirms no Codex-created QA residue; Slugger is notified.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- For UI/rendering/layout units, run `visual-qa-dogfood` before declaring the unit or task complete
- **All artifacts**: Save outputs, logs, data to `./2026-07-14-1236-doing-recipe-photo-studio/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-07-14 12:39 Created from planning doc
