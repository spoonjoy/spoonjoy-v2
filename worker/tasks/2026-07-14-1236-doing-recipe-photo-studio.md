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
**What**: Write failing tests for bounded prompt additions, prompt sanitization, provider prompt forwarding, and `RecipeCover` prompt/parent lineage persistence.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/image-gen.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/ai-placeholder-cover.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/spoon-cover-stylization.server.test.ts`, and the relevant migration/schema test file.
**Acceptance**: Focused Vitest command fails for missing prompt additions, sanitization, persisted lineage fields, and provider prompt forwarding.

### ⬜ Unit 1b: Backend Prompt And Cover Lineage — Implementation
**What**: Add `RecipeCover` lineage/prompt fields in Prisma and migration SQL, update image-generation helpers and scheduling helpers to accept bounded prompt additions, and persist lineage.
**Output**: Passing focused tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/prisma/schema.prisma`, migration files, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/image-gen.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/ai-placeholder-cover.server.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoon-cover-stylization.server.ts`.
**Acceptance**: Focused Vitest command passes, Prisma generation/build-compatible schema checks pass, and no warnings appear in final green logs.

### ⬜ Unit 1c: Backend Prompt And Cover Lineage — Coverage & Refactor
**What**: Run focused coverage for new/modified backend lineage and prompt code, close branch/error-path gaps, and refactor only where it reduces duplication.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/backend-lineage-coverage.log`.
**Acceptance**: 100% coverage for new backend prompt/lineage code, focused tests still pass, and `npm run build` passes with no warnings.

### ⬜ Unit 2a: Backend Activation And Labels — Tests
**What**: Write failing tests for first-photo activation guard behavior and user-facing provenance labels that avoid false "Chef photo" and generic cookbook language.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/recipe-cover.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/spoon-cover-activation.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeCoverHistory.test.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeHeader.test.tsx`.
**Acceptance**: Focused Vitest command fails because labels and active-cover guard behavior still use the old contract.

### ⬜ Unit 2b: Backend Activation And Labels — Implementation
**What**: Update active-cover guard behavior for original-to-editorial swaps and replace misleading provenance/cookbook labels in backend display helpers.
**Output**: Passing focused tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-cover.server.ts` and activation helper files.
**Acceptance**: Focused tests pass and no product copy includes the rejected labels.

### ⬜ Unit 2c: Backend Activation And Labels — Coverage & Refactor
**What**: Run focused coverage for activation and label helpers and close null/archived/fallback branches.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/backend-activation-labels-coverage.log`.
**Acceptance**: 100% coverage on new activation/label code and `npm run build` passes with no warnings.

### ⬜ Unit 3a: REST First-Photo Upload Contract — Tests
**What**: Write failing tests for `POST /api/v1/recipes/:id/image` multipart upload with `clientMutationId`, `activate`, `generateEditorial`, `postAsSpoon`, `note`, `nextTime`, `cookedAt`, file validation, owner media validation, replay, and conflict behavior.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/api-v1-recipe-covers.test.ts`.
**Acceptance**: Focused Vitest command fails on the missing upload route and missing multipart/idempotency behavior.

### ⬜ Unit 3b: REST First-Photo Upload Contract — Implementation
**What**: Implement the upload route so direct cover uploads and Spoon-backed first-photo uploads share domain logic, preserve the original photo on `RecipeSpoon.photoUrl` when `postAsSpoon` is true, and schedule editorialization with the correct activation guard.
**Output**: Passing focused tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/api-v1.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-detail.server.ts`, and shared helper files if extracted.
**Acceptance**: Focused upload/idempotency tests pass, multipart fields are parsed exactly as documented, and final logs contain no warnings.

### ⬜ Unit 3c: REST First-Photo Upload Contract — Coverage & Refactor
**What**: Run focused coverage for the upload route and close invalid MIME, empty photo, unsupported fields, foreign media, replay, conflict, and provider-blocker branches.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/rest-upload-coverage.log`.
**Acceptance**: 100% coverage on new upload route code and `npm run build` passes with no warnings.

### ⬜ Unit 4a: REST Cover Generation And Regeneration — Tests
**What**: Write failing tests for JSON cover creation from image URL, generated AI placeholder creation, regeneration with prompt additions, status polling payloads, activation, archive, and no-cover parity.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/api-v1-recipe-covers.test.ts` and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/api-v1-recipe-writes.server.test.ts` if route helpers are extracted.
**Acceptance**: Focused Vitest command fails on missing JSON/generate/prompt/status behavior.

### ⬜ Unit 4b: REST Cover Generation And Regeneration — Implementation
**What**: Implement JSON cover creation, generated placeholder creation, prompt-addition regeneration, status payloads, and parity fixes for activation/archive/no-cover responses.
**Output**: Passing focused tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/api-v1.server.ts` and shared cover helper files.
**Acceptance**: Focused tests pass and responses include `activeCover`, `createdCover`, `generationStatus`, warnings, and mutation replay metadata where applicable.

### ⬜ Unit 4c: REST Cover Generation And Regeneration — Coverage & Refactor
**What**: Run focused coverage for REST generation/regeneration/status code and close archived-cover, missing-cover, prompt-boundary, and provider-blocker branches.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/rest-generation-coverage.log`.
**Acceptance**: 100% coverage on new REST generation code and `npm run build` passes with no warnings.

### ⬜ Unit 5a: OpenAPI Docs And Playground — Tests
**What**: Write failing tests for OpenAPI, SDK profile, playground metadata, generated multipart examples, and `docs/api.md` snippets for the new/changed cover endpoints.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/api-v1-openapi.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/api-v1-openapi.test.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/scripts/generate-api-playground.test.ts`.
**Acceptance**: Focused tests fail on missing paths, fields, examples, or generated request shapes.

### ⬜ Unit 5b: OpenAPI Docs And Playground — Implementation
**What**: Update OpenAPI builders, SDK/no-code profiles where applicable, playground generation, and `docs/api.md` for first-photo upload, JSON creation, generated placeholder, and prompt-addition regeneration.
**Output**: Passing focused tests plus docs/generated updates in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/docs/api.md` and OpenAPI/playground source files.
**Acceptance**: Focused OpenAPI/playground tests pass, generated multipart examples do not manually set browser multipart boundaries, and no stale placeholder contract remains.

### ⬜ Unit 5c: OpenAPI Docs And Playground — Coverage & Refactor
**What**: Run focused docs/generated coverage and source-contract scans for changed operations.
**Output**: Coverage/scan logs in `./2026-07-14-1236-doing-recipe-photo-studio/openapi-playground-coverage.log`.
**Acceptance**: Changed operations are present in all intended profiles and `npm run build` passes with no warnings.

### ⬜ Unit 6a: MCP Cover Tool Schemas — Tests
**What**: Write failing tests for MCP tool schema descriptions and argument validation for upload, generated placeholder, regenerate, status/list, activate, archive, and no-cover tools.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/mcp.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/mcp/spoonjoy-tools.server.test.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/scripts/spoonjoy-mcp-server.test.ts`.
**Acceptance**: Focused MCP tests fail on missing tool parameters, missing generated-placeholder schema, or mismatched field descriptions.

### ⬜ Unit 6b: MCP Cover Tool Schemas — Implementation
**What**: Update MCP tool definitions and schema descriptions so agents can discover the Photo Studio lifecycle and its prompt/Spoon/upload fields.
**Output**: Passing focused schema tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoonjoy-api.server.ts` and MCP tool registry files.
**Acceptance**: Focused MCP tests pass and tool schemas are honest about required/optional fields.

### ⬜ Unit 6c: MCP Generated And Regenerate Tools — Tests
**What**: Write failing tests for MCP generated-placeholder creation and regenerate-with-prompt handlers, including prompt boundaries and provider-blocker payloads.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/mcp/spoonjoy-tools.server.test.ts` and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/mcp.test.ts`.
**Acceptance**: Focused MCP tests fail on missing generated/regenerate handler behavior.

### ⬜ Unit 6d: MCP Generated And Regenerate Tools — Implementation
**What**: Implement generated-placeholder and regenerate-with-prompt MCP handler behavior using the same domain helpers as REST.
**Output**: Passing focused tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoonjoy-api.server.ts`.
**Acceptance**: Focused MCP tests pass and generated/regenerate responses expose cover and generation status fields.

### ⬜ Unit 6e: MCP Upload, Status, And Activation Tools — Tests
**What**: Write failing tests for MCP upload-to-cover parity, list/status payloads, activate, archive, and no-cover behavior.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/mcp/spoonjoy-tools.server.test.ts` and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/mcp.test.ts`.
**Acceptance**: Focused MCP tests fail on missing upload/status/activation behavior or owner validation.

### ⬜ Unit 6f: MCP Upload, Status, And Activation Tools — Implementation
**What**: Implement MCP upload-to-cover parity, list/status payloads, activate, archive, and no-cover flows.
**Output**: Passing focused tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoonjoy-api.server.ts`.
**Acceptance**: Focused MCP tests pass and owner validation/error payloads match the documented tool contract.

### ⬜ Unit 6g: MCP Cover Tools — Coverage & Refactor
**What**: Run focused coverage for MCP tool parsing, owner validation, error payloads, and provider-blocker branches.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/mcp-cover-tools-coverage.log`.
**Acceptance**: 100% coverage on new MCP code and `npm run build` passes with no warnings.

### ⬜ Unit 7a: MCP/Live Smoke Scripts — Tests
**What**: Write failing tests for smoke script support for prompt additions, generated placeholder, first-photo upload/Spoon preservation, and cleanup of disposable cover/spoon data.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/scripts/smoke-image-cover-live.test.ts` and related script tests.
**Acceptance**: Focused script tests fail on missing smoke options or cleanup behavior.

### ⬜ Unit 7b: MCP/Live Smoke Scripts — Implementation
**What**: Update smoke scripts and cleanup references so disposable Photo Studio data is created with clear names and removed in the same run.
**Output**: Passing focused script tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/scripts/smoke-image-cover-live.mjs` and cleanup helpers if needed.
**Acceptance**: Focused script tests pass and smoke cleanup covers new cover/spoon artifacts.

### ⬜ Unit 7c: MCP/Live Smoke Scripts — Coverage & Refactor
**What**: Run focused script coverage and warning scan.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/smoke-script-coverage.log`.
**Acceptance**: Script tests pass, cleanup behavior is covered, and no warning scan false positives remain.

### ⬜ Unit 8a: Web First-Photo Studio — Tests
**What**: Write failing route/component tests for the Recipe management Photo Studio no-photo state, `Add first photo`, default toggles, Spoon details disclosure, and action payload creating a Spoon-backed editorial cover.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/recipes-id.test.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeCoverHistory.test.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/SpoonDialog.test.tsx`.
**Acceptance**: Focused UI tests fail on missing first-photo UI, defaults, or action behavior.

### ⬜ Unit 8b: Web First-Photo Studio — Implementation
**What**: Build the first-photo Photo Studio UI under recipe management and wire its recipe-detail action to create a Spoon and cover with editorialization defaulted on.
**Output**: Passing focused tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeCoverHistory.tsx` or replacement, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/SpoonDialog.tsx` if controls are reused, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-detail.server.ts`.
**Acceptance**: Focused tests pass and route actions create the expected `RecipeSpoon` and `RecipeCover` records.

### ⬜ Unit 8c: Web First-Photo Studio — Coverage & Refactor
**What**: Run focused coverage for first-photo UI/action code and close empty-file, post-as-cover-off, post-as-spoon-off, optional field, and validation branches.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/web-first-photo-coverage.log`.
**Acceptance**: 100% coverage on new first-photo code and `npm run build` passes with no warnings.

### ⬜ Unit 9a: Web Processing State And Autoswap — Tests
**What**: Write failing tests for active original-photo display while editorialization is processing, loading chip copy, revalidation/autorefresh behavior, and final editorial swap.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/recipes-id.test.tsx` and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeHeader.test.tsx`.
**Acceptance**: Focused UI tests fail on missing loading chip or revalidation behavior.

### ⬜ Unit 9b: Web Processing State And Autoswap — Implementation
**What**: Add loader data, header/studio processing chips, and route revalidation while active cover generation is pending.
**Output**: Passing focused tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/routes/recipes.$id.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeHeader.tsx`, and Photo Studio component files.
**Acceptance**: Focused tests pass and processing UI swaps to the editorial variant once loader data reports it ready.

### ⬜ Unit 9c: Web Processing State And Autoswap — Coverage & Refactor
**What**: Run focused coverage for loading/autorefresh branches and ensure stale async states do not show false errors.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/web-processing-coverage.log`.
**Acceptance**: 100% coverage on new processing UI code and `npm run build` passes with no warnings.

### ⬜ Unit 10a: Web Generation Controls And Copy — Tests
**What**: Write failing tests for generated placeholder controls, prompt-addition regeneration, create-cover-from-Spoon controls, archive/no-cover controls, and safer user-facing labels.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/recipes-id.test.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeCoverHistory.test.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeHeader.test.tsx`.
**Acceptance**: Focused tests fail on missing controls, prompt fields, or rejected labels.

### ⬜ Unit 10b: Web Generation Controls And Copy — Implementation
**What**: Add generated placeholder and regenerate-with-direction controls, update create-from-Spoon/archive/no-cover controls in Photo Studio, and replace old copy.
**Output**: Passing focused tests plus implementation in Photo Studio component files and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-detail.server.ts`.
**Acceptance**: Focused tests pass and no product surface renders "Chef photo", "Spoonjoy cookbook", or "On the counter".

### ⬜ Unit 10c: Web Generation Controls And Copy — Coverage & Refactor
**What**: Run focused coverage for generation/control copy branches and refactor UI names for product clarity.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/web-generation-controls-coverage.log`.
**Acceptance**: 100% coverage on new generation-control UI code and `npm run build` passes with no warnings.

### ⬜ Unit 11: Web Visual QA Dogfood
**What**: Run `visual-qa-dogfood` on recipe detail management Photo Studio states for no photo, first-photo form, processing original, editorial ready, generated placeholder, regenerate direction, and narrow/desktop viewports.
**Output**: Screenshots and `./2026-07-14-1236-doing-recipe-photo-studio/web-visual-qa-ledger.md`.
**Acceptance**: Ledger has no `ready` or `needs reviewer gate` items, screenshots show readable controls/copy without overlap, and any visual reviewer gate passes.

### ⬜ Unit 12a: Native Request Builders — Tests
**What**: Write failing Swift tests for `RecipeCoverRequests` upload/create/generate/regenerate builders carrying `postAsSpoon`, Spoon fields, prompt additions, activation, and editorial choices.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/NativeAPIExpansionTests.swift` and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/APITransportTests.swift`.
**Acceptance**: Focused `swift test` command fails on missing request fields or missing generated-placeholder request builder, and multipart body tests assert field names and values.

### ⬜ Unit 12b: Native Request Builders — Implementation
**What**: Update native request builders and transport parsing for real Photo Studio REST contracts.
**Output**: Passing focused Swift tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/API/NativeAPIRequests.swift` and parser files if needed.
**Acceptance**: Focused Swift tests pass and request-builder tests parse multipart bodies from generated boundaries.

### ⬜ Unit 12c: Native Request Builders — Coverage & Refactor
**What**: Run native focused coverage for request-builder branches, invalid filenames/content types, optional fields, and typed error paths.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/native-request-builder-coverage.log`.
**Acceptance**: New request-builder code is covered and final Swift test logs contain no warnings.

### ⬜ Unit 13a: Native Sync Queue Preservation — Tests
**What**: Write failing tests proving queued `cover.upload` mutations preserve `clientMutationId`, staged media, `postAsSpoon`, Spoon fields, activation, editorialization, and prompt additions without eviction on validation/cancellation errors.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/NativeSyncEngineTests.swift` and existing offline queue tests if required.
**Acceptance**: Focused Swift tests fail on missing queued metadata or unsafe staged-media behavior.

### ⬜ Unit 13b: Native Sync Queue Preservation — Implementation
**What**: Update `NativeSyncEngine` queued mutation encoding/replay for the expanded cover upload payload.
**Output**: Passing focused Swift tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Sync/NativeSyncEngine.swift` and queue model files.
**Acceptance**: Focused sync tests pass and queued replay sends the same field values as direct request builders.

### ⬜ Unit 13c: Native Sync Queue Preservation — Coverage & Refactor
**What**: Run focused coverage for sync queue branches and close missing/null/malformed payload paths.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/native-sync-coverage.log`.
**Acceptance**: New sync code is covered and final Swift test logs contain no warnings.

### ⬜ Unit 14a: Native Cover Action Planning — Tests
**What**: Write failing tests for `RecipeCoverControlsAction`, `RecipeCoverControlsMutationPlan`, `RecipeCoverControlsData`, and `LiveRecipeCoverControlsRepository` behavior for first-photo upload, generated placeholder, regenerate with prompt addition, create from Spoon, activate, archive, and no-cover.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/CoverControlSurfaceTests.swift` and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/RecipeActionParityTests.swift`.
**Acceptance**: Focused Swift tests fail on missing action plans or old `Recipe Covers` naming.

### ⬜ Unit 14b: Native Cover Action Planning — Implementation
**What**: Update `RecipeCoverControlsAction`, `RecipeCoverControlsMutationPlan`, `RecipeCoverControlsData`, `LiveRecipeCoverControlsRepository`, preparation failures, and product copy for Photo Studio.
**Output**: Passing focused Swift tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Features/Covers/RecipeCoverControlsViewModel.swift`.
**Acceptance**: Focused cover-action tests pass and action plans match REST field names.

### ⬜ Unit 14c: Native Cover Action Planning — Coverage & Refactor
**What**: Run focused coverage for cover-action planning branches and error states.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/native-viewmodel-coverage.log`.
**Acceptance**: New cover-action planning code is covered and final Swift test logs contain no warnings.

### ⬜ Unit 15a: Native SwiftUI Photo Studio Surface — Tests
**What**: Write failing source-contract/UI tests for native Photo Studio controls, Spoon details, editorial defaults, prompt-addition fields, loading states, and platform-native copy.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/CoverControlSurfaceTests.swift`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/RecipeActionParityTests.swift`, and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/NativeLiveStoreTests.swift` if route wiring is asserted.
**Acceptance**: Focused Swift tests fail on missing UI/source-contract tokens or stale labels.

### ⬜ Unit 15b: Native SwiftUI Photo Studio Surface — Implementation
**What**: Update `RecipeCoverControlsView.swift` into a platform-native Photo Studio surface with upload/Spoon/detail/editorial/generate/regenerate controls.
**Output**: Passing focused Swift tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Apps/Spoonjoy/Shared/Views/RecipeCoverControlsView.swift`.
**Acceptance**: Focused source-contract tests pass and UI copy aligns with web product language.

### ⬜ Unit 15c: Native SwiftUI Photo Studio Surface — Coverage & Refactor
**What**: Run focused native surface tests and refactor visual/product language without changing REST contracts.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/native-swiftui-surface-coverage.log`.
**Acceptance**: Native surface tests pass and final Swift test logs contain no warnings.

### ⬜ Unit 16: Native Validation
**What**: Run native validation from `build-native-apple-app`: focused `swift test`, broader `swift test`, app-target build commands available in the repo, and screenshot or blocker artifacts for touched Photo Studio surfaces.
**Output**: Native validation logs and screenshots/blocker artifacts under `./2026-07-14-1236-doing-recipe-photo-studio/native-validation/`.
**Acceptance**: Required native validation passes, or any Xcode/simulator/capability blocker is documented with exact command, exit code, and fallback evidence.

### ⬜ Unit 17a: Cross-Surface Drift Checks — Tests
**What**: Write failing source-contract checks that compare REST/OpenAPI field names, native request-builder field names, MCP tool schema field names, docs examples, and smoke-script arguments for first-photo, generated placeholder, prompt additions, status, and activation.
**Output**: Red tests in web OpenAPI/playground/MCP suites and native request-builder/source-contract suites.
**Acceptance**: Tests fail only on real field-name or behavior drift between surfaces.

### ⬜ Unit 17b: Cross-Surface Drift Checks — Implementation
**What**: Fix drift found by Unit 17a across web REST/OpenAPI/docs/MCP/smoke and native request builders/source contracts.
**Output**: Passing cross-surface tests and updated generated/docs artifacts.
**Acceptance**: Cross-surface focused tests pass in both repositories with no warnings.

### ⬜ Unit 17c: Cross-Surface Drift Checks — Coverage & Refactor
**What**: Run changed-operation generated-contract scans and stale-language scans.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/cross-surface-drift.log`.
**Acceptance**: No changed operation leaks placeholder schemas/examples or rejected labels.

### ⬜ Unit 18: Final Web Validation
**What**: Run final focused web suites, full web test/build commands, warning scan, and local QA cleanup inspection.
**Output**: Final web logs under `./2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/`.
**Acceptance**: Web tests/build pass with no warnings, coverage criteria are met, and `pnpm cleanup:qa` reports no Codex-created residue.

### ⬜ Unit 19: Final Native Validation
**What**: Run final native focused suites, broader native test/build commands available in the repo, warning scan, and native artifact audit.
**Output**: Final native logs under `./2026-07-14-1236-doing-recipe-photo-studio/final-validation/native/`.
**Acceptance**: Native tests/builds pass with no warnings, or exact capability blockers are recorded with fallback evidence.

### ⬜ Unit 20: Open Web PR
**What**: Create or update the web/backend PR with summary, validation evidence, linked planning/doing docs, and no stale red-phase logs presented as final evidence.
**Output**: Web PR URL and PR body snapshot under `./2026-07-14-1236-doing-recipe-photo-studio/pr-review/web-pr.md`.
**Acceptance**: Web PR exists and references the final validation artifacts.

### ⬜ Unit 21: Open Native PR
**What**: Create or update the native PR with summary, validation evidence, linked planning/doing docs, and any exact capability blockers.
**Output**: Native PR URL and PR body snapshot under `./2026-07-14-1236-doing-recipe-photo-studio/pr-review/native-pr.md`.
**Acceptance**: Native PR exists and references the final validation artifacts.

### ⬜ Unit 22: Cold Implementation Review Gates
**What**: Run cold reviewer agents against web and native diffs plus validation artifacts, then record reviewer reports.
**Output**: Reviewer reports under `./2026-07-14-1236-doing-recipe-photo-studio/pr-review/reviewer-reports.md`.
**Acceptance**: Reviewer reports are `CONVERGED` or list concrete findings to fix.

### ⬜ Unit 23: Reviewer Finding Fixes
**What**: Address any BLOCKER/MAJOR reviewer findings from Unit 22 with focused patches, tests, commits, and re-review.
**Output**: Fix commits, focused validation logs, and reviewer follow-up notes.
**Acceptance**: Reviewer gates converge with no unresolved BLOCKER/MAJOR findings.

### ⬜ Unit 24: Merge Web PR
**What**: Merge the web/backend PR after reviewer gates and required checks pass.
**Output**: Web merge log under `./2026-07-14-1236-doing-recipe-photo-studio/pr-review/web-merge.md`.
**Acceptance**: Web PR is merged, or a true human-only blocker is recorded with exact required action.

### ⬜ Unit 25: Merge Native PR
**What**: Merge the native PR after reviewer gates and required checks pass.
**Output**: Native merge log under `./2026-07-14-1236-doing-recipe-photo-studio/pr-review/native-merge.md`.
**Acceptance**: Native PR is merged, or a true human-only blocker is recorded with exact required action.

### ⬜ Unit 26: Production Deploy And Web Smoke
**What**: Verify web production deployment for the merged commit and run owner-facing Photo Studio smoke checks without leaving disposable data.
**Output**: Deploy and smoke logs under `./2026-07-14-1236-doing-recipe-photo-studio/deploy/web-smoke.md`.
**Acceptance**: Production Photo Studio smoke passes or a true provider/capability blocker is recorded with exact evidence.

### ⬜ Unit 27: Native Install Or Publish Smoke
**What**: Verify the applicable native installed/build surface after merge, using local build/install smoke or publish status available without human-only credentials.
**Output**: Native smoke logs under `./2026-07-14-1236-doing-recipe-photo-studio/deploy/native-smoke.md`.
**Acceptance**: Native Photo Studio smoke passes, or a signing/TestFlight/capability blocker is recorded with exact evidence.

### ⬜ Unit 28: QA Data Cleanup
**What**: Run local QA cleanup inspection and remove any Codex-created disposable Spoonjoy data created during validation.
**Output**: Cleanup logs under `./2026-07-14-1236-doing-recipe-photo-studio/cleanup/qa-data.md`.
**Acceptance**: `pnpm cleanup:qa` or equivalent reports no Codex-created residue.

### ⬜ Unit 29: Worktree Cleanup
**What**: Remove task worktrees that are no longer needed after merge/deploy validation and confirm main checkouts are not dirtied.
**Output**: Worktree cleanup log under `./2026-07-14-1236-doing-recipe-photo-studio/cleanup/worktrees.md`.
**Acceptance**: Temporary worktrees are removed when safe and remaining checkouts have expected git status.

### ⬜ Unit 30: Final Docs And Slugger Notification
**What**: Update planning/doing completion criteria, mark task done, commit final docs, and notify Slugger.
**Output**: Final task-doc commit and Slugger notification command output.
**Acceptance**: Planning and doing docs reflect verified completion, final docs are committed/pushed, and `ouro msg --to slugger "Done: ..."` succeeds.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after every unit or unit phase, including Unit 0, non-lettered validation units, terminal units, and task-doc status updates
- Push immediately after every commit in every touched repository
- Run full test suite before marking unit done
- For UI/rendering/layout units, run `visual-qa-dogfood` before declaring the unit or task complete
- **All artifacts**: Save outputs, logs, data to `./2026-07-14-1236-doing-recipe-photo-studio/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-07-14 12:39 Created from planning doc
- 2026-07-14 12:46 Granularity pass addressed reviewer blockers by splitting REST, MCP, web, native, cross-surface, and terminal work into smaller TDD/validation units
- 2026-07-14 12:50 Granularity Round 2 addressed remaining MCP and terminal-unit findings
- 2026-07-14 12:55 Validation pass retargeted stale native ViewModel symbol and concrete web component test paths
