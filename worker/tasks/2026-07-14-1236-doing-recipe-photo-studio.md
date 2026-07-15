# Doing: Recipe Photo Studio

**Status**: in-progress
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
- [x] Uploading the first photo can create a Spoon with optional Spoon fields and defaults to creating an editorialized recipe cover while preserving the original photo on the Spoon.
- [x] The active recipe photo shows the original immediately while editorialization is processing, displays a clear loading chip, and refreshes to the editorial variant when ready.
- [ ] Backend cover lifecycle supports upload, Spoon-origin cover creation, AI placeholder generation, regeneration with prompt additions, activation, archive, no-cover mode, status polling, and owner media validation.
- [ ] REST API v1 exposes the native-required real cover upload/create/regenerate/status contracts with request-shape tests and docs/OpenAPI/playground drift coverage.
- [x] Native queued cover uploads preserve `clientMutationId`, Spoon-posting fields, activation choice, and editorialization choice without dropping staged media on validation or cancellation errors.
- [x] MCP/agent tools expose the same core cover lifecycle, including generated placeholders and prompt additions.
- [ ] Native Apple Photo Studio uses the real backend contracts and platform-native upload/Spoon/detail/editorial controls.
- [x] User-facing cover labels no longer say misleading "Chef photo" or generic "Spoonjoy cookbook" for all covers.
- [x] Prompt additions and cover lineage are persisted and tested for AI placeholder/editorial generation paths.
- [ ] Web changes are merged and verified on production; native changes are merged and verified through local native validation plus TestFlight/publish status only when existing credentials permit it.
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

### ✅ Unit 0: Setup/Research
**What**: Confirm both worktrees are on `worker/recipe-photo-studio`, read current source targets, record command inventory, and ensure the native branch is pushed before native commits begin.
**Output**: Artifact notes in `./2026-07-14-1236-doing-recipe-photo-studio/setup.md` covering web worktree, native worktree, source files, test files, command matrix, and any local capability blockers.
**Acceptance**: `git status --short --branch` is clean except task docs; source/test paths in the notes exist; web branch is pushed; native branch `worker/recipe-photo-studio` is pushed and tracks `origin/worker/recipe-photo-studio` before any native commit is created.

### ✅ Unit 1a: Backend Prompt And Cover Lineage — Tests
**What**: Write failing tests for bounded prompt additions, prompt sanitization, provider prompt forwarding, and `RecipeCover` prompt/parent lineage persistence.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/image-gen.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/ai-placeholder-cover.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/spoon-cover-stylization.server.test.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/scripts/migration-0023-recipe-cover-prompt-lineage.test.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/lib/image-gen.server.test.ts test/lib/ai-placeholder-cover.server.test.ts test/lib/spoon-cover-stylization.server.test.ts test/scripts/migration-0023-recipe-cover-prompt-lineage.test.ts --fileParallelism=false` fails for missing prompt additions, sanitization, persisted lineage fields, and provider prompt forwarding.

### ✅ Unit 1b: Backend Prompt And Cover Lineage — Implementation
**What**: Add `RecipeCover` lineage/prompt fields in Prisma and migration SQL, update image-generation helpers and scheduling helpers to accept bounded prompt additions, and persist lineage.
**Output**: Passing tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/prisma/schema.prisma`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/prisma/migrations/20260714123600_recipe_cover_prompt_lineage/migration.sql`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/migrations/0023_recipe_cover_prompt_lineage.sql`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/image-gen.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/ai-placeholder-cover.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoon-cover-stylization.server.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-cover.server.ts` so `RECIPE_COVER_DISPLAY_SELECT satisfies Record<keyof RecipeCover, true>` remains exhaustive after Prisma generation.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/lib/image-gen.server.test.ts test/lib/ai-placeholder-cover.server.test.ts test/lib/spoon-cover-stylization.server.test.ts test/scripts/migration-0023-recipe-cover-prompt-lineage.test.ts --fileParallelism=false` passes; `pnpm run prisma:generate` passes; no warnings appear in the green logs.

### ✅ Unit 1c: Backend Prompt And Cover Lineage — Coverage & Refactor
**What**: Run focused coverage for new/modified backend lineage and prompt code, close branch/error-path gaps, and refactor only where it reduces duplication.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/backend-lineage-coverage.log`.
**Acceptance**: `bash -o pipefail -c 'pnpm exec vitest run test/lib/image-gen.server.test.ts test/lib/ai-placeholder-cover.server.test.ts test/lib/spoon-cover-stylization.server.test.ts test/scripts/migration-0023-recipe-cover-prompt-lineage.test.ts --coverage --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/backend-lineage-coverage.log'` shows 100% coverage for new backend prompt/lineage code; `pnpm run build` passes with no warnings.

### ✅ Unit 2a: Backend Activation And Labels — Tests
**What**: Write failing tests for first-photo activation guard behavior and user-facing provenance labels that avoid false "Chef photo" and generic cookbook language.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/recipe-cover.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/spoon-cover-activation.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/spoon-cover-stylization.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeCoverHistory.test.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeHeader.test.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/cookbook/CookbookCoverArt.test.tsx`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/lib/recipe-cover.server.test.ts test/lib/spoon-cover-activation.server.test.ts test/lib/spoon-cover-stylization.server.test.ts test/components/recipe/RecipeCoverHistory.test.tsx test/components/recipe/RecipeHeader.test.tsx test/components/cookbook/CookbookCoverArt.test.tsx --fileParallelism=false` fails because labels and active-cover guard behavior still use the old contract.

### ✅ Unit 2b: Backend Activation And Labels — Implementation
**What**: Update active-cover guard behavior for original-to-editorial swaps and replace misleading provenance/cookbook labels in backend display helpers.
**Output**: Passing tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-cover.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoon-cover-activation.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoon-cover-stylization.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeCoverHistory.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeHeader.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/cookbook/CookbookCoverArt.tsx`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/lib/recipe-cover.server.test.ts test/lib/spoon-cover-activation.server.test.ts test/lib/spoon-cover-stylization.server.test.ts test/components/recipe/RecipeCoverHistory.test.tsx test/components/recipe/RecipeHeader.test.tsx test/components/cookbook/CookbookCoverArt.test.tsx --fileParallelism=false` passes and no product copy includes the rejected labels.

### ✅ Unit 2c: Backend Activation And Labels — Coverage & Refactor
**What**: Run focused coverage for activation and label helpers and close null/archived/fallback branches.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/backend-activation-labels-coverage.log`.
**Acceptance**: `bash -o pipefail -c 'pnpm exec vitest run test/lib/recipe-cover.server.test.ts test/lib/spoon-cover-activation.server.test.ts test/lib/spoon-cover-stylization.server.test.ts test/components/recipe/RecipeCoverHistory.test.tsx test/components/recipe/RecipeHeader.test.tsx test/components/cookbook/CookbookCoverArt.test.tsx --coverage --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/backend-activation-labels-coverage.log'` shows 100% coverage on new activation/label code; `pnpm run build` passes with no warnings.

### ✅ Unit 3a: REST First-Photo Upload Contract — Tests
**What**: Write failing tests for `POST /api/v1/recipes/:id/image` multipart upload with `clientMutationId`, `activate`, `generateEditorial`, `postAsSpoon`, `note`, `nextTime`, `cookedAt`, file validation, owner media validation, replay, conflict behavior, and orphaned uploaded-object cleanup when storage succeeds but DB/idempotency commit fails.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/api-v1-recipe-covers.test.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/api-v1-recipe-covers.test.ts --fileParallelism=false` fails on the missing upload route and missing multipart/idempotency behavior.

### ✅ Unit 3b: REST First-Photo Upload Contract — Implementation
**What**: Implement the upload route so direct cover uploads and Spoon-backed first-photo uploads share domain logic, preserve the original photo on `RecipeSpoon.photoUrl` when `postAsSpoon` is true, and schedule editorialization with the correct activation guard.
**Output**: Passing tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/api-v1.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-detail.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-spoon.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-image-assignment.server.ts`, and new helper `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-photo-studio.server.ts` only if helper extraction is needed.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/api-v1-recipe-covers.test.ts --fileParallelism=false` passes, multipart fields are parsed exactly as documented, and the green log contains no warnings.

### ✅ Unit 3c: REST First-Photo Upload Contract — Coverage & Refactor
**What**: Run focused coverage for the upload route and close invalid MIME, empty photo, unsupported fields, foreign media, replay, conflict, provider-blocker, and orphan-cleanup failure branches.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/rest-upload-coverage.log`.
**Acceptance**: `bash -o pipefail -c 'pnpm exec vitest run test/routes/api-v1-recipe-covers.test.ts --coverage --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/rest-upload-coverage.log'` shows 100% coverage on new upload route code; `pnpm run build` passes with no warnings.

### ✅ Unit 4a: REST Cover Generation And Status Polling — Tests
**What**: Write failing tests for JSON cover creation from image URL, `POST /api/v1/recipes/:id/covers/generate`, `POST /api/v1/recipes/:id/covers/regenerate` with `promptAddition`, `GET /api/v1/recipes/:id/covers` status polling payloads (`covers[].generationStatus`, `covers[].status`, `activeCover`, `spoonImages`, pagination), activation, archive, and no-cover parity.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/api-v1-recipe-covers.test.ts` and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/api-v1-recipe-writes.server.test.ts` if route helpers are extracted.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/api-v1-recipe-covers.test.ts test/lib/api-v1-recipe-writes.server.test.ts --fileParallelism=false` fails on missing JSON/generate/prompt/status behavior.

### ✅ Unit 4b: REST Cover Generation And Status Polling — Implementation
**What**: Implement `POST /api/v1/recipes/:id/covers` JSON cover creation, `POST /api/v1/recipes/:id/covers/generate` with `{ clientMutationId, promptAddition?, activateWhenReady? }`, `POST /api/v1/recipes/:id/covers/regenerate` with `{ clientMutationId, coverId, promptAddition?, activateWhenReady? }`, `GET /api/v1/recipes/:id/covers` status payloads, and parity fixes for activation/archive/no-cover responses.
**Output**: Passing tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/api-v1.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/api-v1-recipe-writes.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-cover.server.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-photo-studio.server.ts` when the helper was created in Unit 3b.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/api-v1-recipe-covers.test.ts test/lib/api-v1-recipe-writes.server.test.ts --fileParallelism=false` passes; mutation responses for create/regenerate/archive/no-cover include `mutation.clientMutationId` and `mutation.replayed`; create/regenerate responses include `createdCover` or `generationStatus`; activation responses include `activeCover`; archive responses include `archivedCover`.

### ✅ Unit 4c: REST Cover Generation And Status Polling — Coverage & Refactor
**What**: Run focused coverage for REST generation/regeneration/status code and close archived-cover, missing-cover, prompt-boundary, and provider-blocker branches.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/rest-generation-coverage.log`.
**Acceptance**: `bash -o pipefail -c 'pnpm exec vitest run test/routes/api-v1-recipe-covers.test.ts test/lib/api-v1-recipe-writes.server.test.ts --coverage --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/rest-generation-coverage.log'` shows 100% coverage on new REST generation code; `pnpm run build` passes with no warnings.

### ✅ Unit 5a: OpenAPI Docs And Playground — Tests
**What**: Write failing tests for OpenAPI, SDK profile, playground metadata, generated multipart examples, and `docs/api.md` snippets for the new/changed cover endpoints.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/api-v1-openapi.server.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/api-v1-openapi.test.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/scripts/generate-api-playground.test.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/lib/api-v1-openapi.server.test.ts test/routes/api-v1-openapi.test.ts test/scripts/generate-api-playground.test.ts --fileParallelism=false` fails on missing paths, fields, examples, or generated request shapes.

### ✅ Unit 5b: OpenAPI Docs And Playground — Implementation
**What**: Update OpenAPI builders, playground generation, and `docs/api.md` for first-photo upload, JSON creation, generated placeholder, and prompt-addition regeneration.
**Output**: Passing tests plus docs/generated updates in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/api-v1-openapi.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/routes/api.openapi-json.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/routes/api.openapi-spec.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/scripts/generate-api-playground.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/generated/api-v1-playground.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/docs/api.md`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/lib/api-v1-openapi.server.test.ts test/routes/api-v1-openapi.test.ts test/scripts/generate-api-playground.test.ts --fileParallelism=false` passes; `/api/v1/openapi.json`, `/api/v1/openapi.sdk.json`, and generated playground include the changed recipe-cover endpoints; `/api/v1/openapi.connector.json` omits recipe-cover endpoints; generated multipart examples use `FormData`/`curl --form` without manually setting browser multipart boundaries.

### ✅ Unit 5c: OpenAPI Docs And Playground — Coverage & Refactor
**What**: Run focused docs/generated coverage and source-contract scans for changed operations.
**Output**: Coverage/scan logs in `./2026-07-14-1236-doing-recipe-photo-studio/openapi-playground-coverage.log`.
**Acceptance**: `bash -o pipefail -c 'pnpm exec vitest run test/lib/api-v1-openapi.server.test.ts test/routes/api-v1-openapi.test.ts test/scripts/generate-api-playground.test.ts --coverage --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/openapi-playground-coverage.log'` shows changed-operation coverage; `pnpm run build` passes with no warnings.

### ✅ Unit 6a: MCP Cover Tool Schemas — Tests
**What**: Write failing tests for MCP tool schema descriptions and argument validation for `create_recipe_cover_from_upload`, `generate_recipe_cover_placeholder`, `regenerate_recipe_cover`, `get_cover_generation_status`, `list_recipe_covers`, `set_active_recipe_cover`, `archive_recipe_cover`, and no-cover tools.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/mcp.test.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/mcp/spoonjoy-tools.server.test.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/scripts/spoonjoy-mcp-server.test.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/mcp.test.ts test/lib/mcp/spoonjoy-tools.server.test.ts test/scripts/spoonjoy-mcp-server.test.ts --fileParallelism=false` fails on missing tool parameters, missing generated-placeholder schema, or mismatched field descriptions.

### ✅ Unit 6b: MCP Cover Tool Schemas — Implementation
**What**: Update MCP tool definitions and schema descriptions so agents can discover the Photo Studio lifecycle and its prompt/Spoon/upload fields.
**Output**: Passing schema tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoonjoy-api.server.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/mcp/spoonjoy-tools.server.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/scripts/spoonjoy-mcp-server.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/mcp.test.ts test/lib/mcp/spoonjoy-tools.server.test.ts test/scripts/spoonjoy-mcp-server.test.ts --fileParallelism=false` passes for schema assertions and tool schemas are honest about required/optional fields.

### ✅ Unit 6c: MCP Generated And Regenerate Tools — Tests
**What**: Write failing tests for `generate_recipe_cover_placeholder` with `{ recipeId, promptAddition?, activateWhenReady?, idempotencyKey }` and `regenerate_recipe_cover` with `{ recipeId, coverId, promptAddition?, activateWhenReady?, idempotencyKey }`, including prompt boundaries and provider-blocker payloads.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/mcp/spoonjoy-tools.server.test.ts` and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/mcp.test.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/lib/mcp/spoonjoy-tools.server.test.ts test/routes/mcp.test.ts --fileParallelism=false` fails on missing generated/regenerate handler behavior.

### ✅ Unit 6d: MCP Generated And Regenerate Tools — Implementation
**What**: Implement `generate_recipe_cover_placeholder` and `regenerate_recipe_cover` MCP handler behavior using the same domain helpers as REST.
**Output**: Passing tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoonjoy-api.server.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/lib/mcp/spoonjoy-tools.server.test.ts test/routes/mcp.test.ts --fileParallelism=false` passes and generated/regenerate responses expose cover and generation status fields.

### ✅ Unit 6e: MCP Upload, Status, And Activation Tools — Tests
**What**: Write failing tests for MCP upload-to-cover parity, list/status payloads, activate, archive, and no-cover behavior.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/lib/mcp/spoonjoy-tools.server.test.ts` and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/mcp.test.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/lib/mcp/spoonjoy-tools.server.test.ts test/routes/mcp.test.ts --fileParallelism=false` fails on missing upload/status/activation behavior or owner validation.

### ✅ Unit 6f: MCP Upload, Status, And Activation Tools — Implementation
**What**: Implement MCP upload-to-cover parity, list/status payloads, activate, archive, and no-cover flows.
**Output**: Passing tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoonjoy-api.server.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/lib/mcp/spoonjoy-tools.server.test.ts test/routes/mcp.test.ts --fileParallelism=false` passes and owner validation/error payloads match the documented tool contract.

### ✅ Unit 6g: MCP Cover Tools — Coverage & Refactor
**What**: Run focused coverage for MCP tool parsing, owner validation, error payloads, and provider-blocker branches.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/mcp-cover-tools-coverage.log`.
**Acceptance**: `bash -o pipefail -c 'pnpm exec vitest run test/routes/mcp.test.ts test/lib/mcp/spoonjoy-tools.server.test.ts test/scripts/spoonjoy-mcp-server.test.ts --coverage --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/mcp-cover-tools-coverage.log'` shows 100% coverage on new MCP code; `pnpm run build` passes with no warnings.

### ✅ Unit 7a: MCP/Live Smoke Scripts — Tests
**What**: Write failing tests for `scripts/smoke-live.mjs --include-image-cover-smoke` and `runImageCoverSmokeFlow` support for prompt additions, generated placeholder, first-photo upload/Spoon preservation, and cleanup of disposable cover/spoon data.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/scripts/smoke-image-cover-live.test.ts` and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/scripts/spoonjoy-mcp-server.test.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/scripts/smoke-image-cover-live.test.ts test/scripts/spoonjoy-mcp-server.test.ts --fileParallelism=false` fails on missing smoke options or cleanup behavior.

### ✅ Unit 7b: MCP/Live Smoke Scripts — Implementation
**What**: Update the `scripts/smoke-live.mjs` entrypoint, `runImageCoverSmokeFlow`, and cleanup references so disposable Photo Studio data is created with clear names and removed in the same run.
**Output**: Passing script tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/scripts/smoke-live.mjs`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/scripts/smoke-image-cover-live.mjs`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/scripts/spoonjoy-mcp-server.ts`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/scripts/cleanup-local-qa-data.mjs`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/scripts/smoke-image-cover-live.test.ts test/scripts/spoonjoy-mcp-server.test.ts --fileParallelism=false` passes and smoke cleanup covers new cover/spoon artifacts.

### ✅ Unit 7c: MCP/Live Smoke Scripts — Coverage & Refactor
**What**: Run script coverage and build warning scan.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/smoke-script-coverage.log`.
**Acceptance**: `bash -o pipefail -c 'pnpm exec vitest run test/scripts/smoke-image-cover-live.test.ts test/scripts/spoonjoy-mcp-server.test.ts --coverage --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/smoke-script-coverage.log'` shows script coverage; `pnpm run build` passes with no warnings.

### ✅ Unit 8a: Web First-Photo Studio — Tests
**What**: Write failing route/component tests for the Recipe management Photo Studio no-photo state, `Add first photo`, default toggles, Spoon details disclosure, and action payload creating a Spoon-backed editorial cover.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/recipes-id.test.tsx`, new `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipePhotoStudio.test.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeCoverHistory.test.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/SpoonDialog.test.tsx`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/recipes-id.test.tsx test/components/recipe/RecipePhotoStudio.test.tsx test/components/recipe/RecipeCoverHistory.test.tsx test/components/recipe/SpoonDialog.test.tsx --fileParallelism=false` fails on missing first-photo UI, defaults, or action behavior.

### ✅ Unit 8b: Web First-Photo Studio — Implementation
**What**: Build the first-photo Photo Studio UI under recipe management and wire its recipe-detail action to create a Spoon and cover with editorialization defaulted on.
**Output**: Passing tests plus implementation in new `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipePhotoStudio.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeCoverHistory.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/SpoonDialog.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/routes/recipes.$id.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-detail.server.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/recipes-id.test.tsx test/components/recipe/RecipePhotoStudio.test.tsx test/components/recipe/RecipeCoverHistory.test.tsx test/components/recipe/SpoonDialog.test.tsx --fileParallelism=false` passes and route actions create the expected `RecipeSpoon` and `RecipeCover` records.

### ✅ Unit 8c: Web First-Photo Studio — Coverage & Refactor
**What**: Run focused coverage for first-photo UI/action code and close empty-file, post-as-cover-off, post-as-spoon-off, optional field, and validation branches.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/web-first-photo-coverage.log`.
**Acceptance**: `bash -o pipefail -c 'pnpm exec vitest run test/routes/recipes-id.test.tsx test/components/recipe/RecipePhotoStudio.test.tsx test/components/recipe/RecipeCoverHistory.test.tsx test/components/recipe/SpoonDialog.test.tsx --coverage --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/web-first-photo-coverage.log'` shows 100% coverage on new first-photo code; `pnpm run build` passes with no warnings.

### ✅ Unit 9a: Web Processing State And Autoswap — Tests
**What**: Write failing tests for active original-photo display while editorialization is processing, loading chip copy, revalidation/autorefresh behavior, and final editorial swap.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/recipes-id.test.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeHeader.test.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipePhotoStudio.test.tsx`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/recipes-id.test.tsx test/components/recipe/RecipeHeader.test.tsx test/components/recipe/RecipePhotoStudio.test.tsx --fileParallelism=false` fails on missing loading chip or revalidation behavior.

### ✅ Unit 9b: Web Processing State And Autoswap — Implementation
**What**: Add loader data, header/studio processing chips, and route revalidation while active cover generation is pending.
**Output**: Passing tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/routes/recipes.$id.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeHeader.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipePhotoStudio.tsx`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/recipes-id.test.tsx test/components/recipe/RecipeHeader.test.tsx test/components/recipe/RecipePhotoStudio.test.tsx --fileParallelism=false` passes and processing UI swaps to the editorial variant once loader data reports it ready.

### ✅ Unit 9c: Web Processing State And Autoswap — Coverage & Refactor
**What**: Run focused coverage for loading/autorefresh branches and ensure stale async states do not show false errors.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/web-processing-coverage.log`.
**Acceptance**: `bash -o pipefail -c 'pnpm exec vitest run test/routes/recipes-id.test.tsx test/components/recipe/RecipeHeader.test.tsx test/components/recipe/RecipePhotoStudio.test.tsx --coverage --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/web-processing-coverage.log'` shows 100% coverage on new processing UI code; `pnpm run build` passes with no warnings.

### ✅ Unit 10a: Web Generation Controls And Copy — Tests
**What**: Write failing tests for generated placeholder controls, prompt-addition regeneration, create-cover-from-Spoon controls, archive/no-cover controls, and safer user-facing labels.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/routes/recipes-id.test.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeCoverHistory.test.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/test/components/recipe/RecipeHeader.test.tsx`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/recipes-id.test.tsx test/components/recipe/RecipePhotoStudio.test.tsx test/components/recipe/RecipeCoverHistory.test.tsx test/components/recipe/RecipeHeader.test.tsx --fileParallelism=false` fails on missing controls, prompt fields, or rejected labels.

### ✅ Unit 10b: Web Generation Controls And Copy — Implementation
**What**: Add generated placeholder and regenerate-with-direction controls, update create-from-Spoon/archive/no-cover controls in Photo Studio, and replace old copy.
**Output**: Passing tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipePhotoStudio.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeCoverHistory.tsx`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeHeader.tsx`, and `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-detail.server.ts`.
**Acceptance**: `pnpm run api:playground:generate && pnpm exec vitest run test/routes/recipes-id.test.tsx test/components/recipe/RecipePhotoStudio.test.tsx test/components/recipe/RecipeCoverHistory.test.tsx test/components/recipe/RecipeHeader.test.tsx --fileParallelism=false` passes and no product surface renders "Chef photo", "Spoonjoy cookbook", or "On the counter".

### ✅ Unit 10c: Web Generation Controls And Copy — Coverage & Refactor
**What**: Run focused coverage for generation/control copy branches and refactor UI names for product clarity.
**Output**: Coverage logs in `./2026-07-14-1236-doing-recipe-photo-studio/web-generation-controls-coverage.log`.
**Acceptance**: `bash -o pipefail -c 'pnpm exec vitest run test/routes/recipes-id.test.tsx test/components/recipe/RecipePhotoStudio.test.tsx test/components/recipe/RecipeCoverHistory.test.tsx test/components/recipe/RecipeHeader.test.tsx --coverage --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/web-generation-controls-coverage.log'` shows 100% coverage on new generation-control UI code; `pnpm run build` passes with no warnings.

### ✅ Unit 11: Web Visual QA Dogfood
**What**: Run `visual-qa-dogfood` on recipe detail management Photo Studio states for no photo, first-photo form, processing original, editorial ready, generated placeholder, regenerate direction, and narrow/desktop viewports.
**Output**: Screenshots and `./2026-07-14-1236-doing-recipe-photo-studio/web-visual-qa-ledger.md`.
**Acceptance**: Ledger has no `ready` or `needs reviewer gate` items, screenshots show readable controls/copy without overlap, and any visual reviewer gate passes.

### ✅ Unit 12a: Native Request Builders — Tests
**What**: Write failing Swift tests for `RecipeCoverRequests.uploadImage`, `RecipeCoverRequests.createFromImageURL`, new `RecipeCoverRequests.generatePlaceholder`, `RecipeCoverRequests.regenerate`, and `RecipeCoverRequests.listCovers` carrying `postAsSpoon`, Spoon fields, `promptAddition`, activation, editorial choices, and polling via `GET /api/v1/recipes/:id/covers`.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/NativeAPIExpansionTests.swift` and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/APITransportTests.swift`.
**Acceptance**: `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'NativeAPIExpansionTests|APITransportTests'` fails on missing request fields or missing generated-placeholder request builder, and multipart body tests assert field names and values.

### ✅ Unit 12b: Native Request Builders — Implementation
**What**: Update native request builders and transport parsing for real Photo Studio REST contracts.
**Output**: Passing Swift tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/API/NativeAPIRequests.swift` and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/API/APITransport.swift`.
**Acceptance**: `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'NativeAPIExpansionTests|APITransportTests'` passes and request-builder tests parse multipart bodies from generated boundaries.

### ✅ Unit 12c: Native Request Builders — Coverage & Refactor
**What**: Run native focused coverage for request-builder branches, invalid filenames/content types, optional fields, and typed error paths.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/native-request-builder-coverage.log`.
**Acceptance**: `bash -o pipefail -c "swift test --enable-code-coverage --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'NativeAPIExpansionTests|APITransportTests' 2>&1 | tee /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/native-request-builder-coverage.log"` covers new request-builder code; `scripts/fail-on-warning.rb --log /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/native-request-builder-coverage.log` passes from the native worktree.

### ✅ Unit 13a: Native Sync Queue Preservation — Tests
**What**: Write failing tests proving queued `cover.upload` mutations preserve `clientMutationId`, staged media, `postAsSpoon`, Spoon fields, activation, editorialization, and prompt additions without eviction on validation/cancellation errors.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/NativeSyncEngineTests.swift` and existing offline queue tests if required.
**Acceptance**: `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'NativeSyncEngineTests|OfflineStoreTests'` fails on missing queued metadata or unsafe staged-media behavior.

### ✅ Unit 13b: Native Sync Queue Preservation — Implementation
**What**: Update `NativeSyncEngine` queued mutation encoding/replay for the expanded cover upload payload.
**Output**: Passing Swift tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Sync/NativeSyncEngine.swift`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Offline/MutationQueue.swift`, and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/API/NativeAPIRequests.swift`.
**Acceptance**: `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'NativeSyncEngineTests|OfflineStoreTests|NativeAPIExpansionTests'` passes and queued replay sends the same field values as direct request builders.

### ✅ Unit 13c: Native Sync Queue Preservation — Coverage & Refactor
**What**: Run focused coverage for sync queue branches and close missing/null/malformed payload paths.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/native-sync-coverage.log`.
**Acceptance**: `bash -o pipefail -c "swift test --enable-code-coverage --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'NativeSyncEngineTests|OfflineStoreTests|NativeAPIExpansionTests' 2>&1 | tee /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/native-sync-coverage.log"` covers new sync code; `scripts/fail-on-warning.rb --log /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/native-sync-coverage.log` passes from the native worktree.

### ✅ Unit 14a: Native Media Staging And Photo Picker — Tests
**What**: Write failing Swift/source-contract tests proving the Photo Studio upload UI uses `PhotosPicker`, loads real `Data` bytes, infers/accepts JPEG/PNG/WebP/HEIC content types through existing media-staging policy, preserves staged media on cancellation or validation rejection, and creates `NativeStagedMediaUpload` values suitable for `cover.upload`.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/CoverControlSurfaceTests.swift`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/NativeCacheFreshnessTests.swift`, and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/NativeLiveStoreTests.swift`.
**Acceptance**: `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'CoverControlSurfaceTests|NativeCacheFreshnessTests|NativeLiveStoreTests'` fails on missing Photo Studio media staging behavior.

### ✅ Unit 14b: Native Media Staging And Photo Picker — Implementation
**What**: Implement Photo Studio media picking/staging by following the existing `SpoonCookLogView.swift` and `SettingsView.swift` patterns for `PhotosPicker`, `loadTransferable(type: Data.self)`, `NativeMediaStagingPolicy`, `NativeStagedMediaUpload`, and no-silent-eviction behavior.
**Output**: Passing Swift tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Apps/Spoonjoy/Shared/Views/RecipeCoverControlsView.swift`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Cache/NativeMediaStagingPolicy.swift`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Sync/NativeSyncEngine.swift`, and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Features/Covers/RecipeCoverControlsViewModel.swift`.
**Acceptance**: `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'CoverControlSurfaceTests|NativeCacheFreshnessTests|NativeLiveStoreTests'` passes and source-contract tests prove upload controls produce staged bytes, not placeholder tokens.

### ✅ Unit 14c: Native Media Staging And Photo Picker — Coverage & Refactor
**What**: Run focused coverage for native media staging branches, cancellation, invalid/oversized media, HEIC/JPEG/PNG/WebP content type handling, and staged-media retention.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/native-media-staging-coverage.log`.
**Acceptance**: `bash -o pipefail -c "swift test --enable-code-coverage --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'CoverControlSurfaceTests|NativeCacheFreshnessTests|NativeLiveStoreTests' 2>&1 | tee /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/native-media-staging-coverage.log"` covers new media-staging code; `scripts/fail-on-warning.rb --log /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/native-media-staging-coverage.log` passes from the native worktree.

### ✅ Unit 15a: Native Cover Action Planning — Tests
**What**: Write failing tests for `RecipeCoverControlsAction`, `RecipeCoverControlsMutationPlan`, `RecipeCoverControlsData`, and `LiveRecipeCoverControlsRepository` behavior for first-photo upload, generated placeholder, regenerate with prompt addition, create from Spoon, activate, archive, and no-cover.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/CoverControlSurfaceTests.swift` and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/RecipeActionParityTests.swift`.
**Acceptance**: `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'CoverControlSurfaceTests|RecipeActionParityTests'` fails on missing action plans or old `Recipe Covers` naming.

### ✅ Unit 15b: Native Cover Action Planning — Implementation
**What**: Update `RecipeCoverControlsAction`, `RecipeCoverControlsMutationPlan`, `RecipeCoverControlsData`, `LiveRecipeCoverControlsRepository`, preparation failures, and product copy for Photo Studio.
**Output**: Passing Swift tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Features/Covers/RecipeCoverControlsViewModel.swift`.
**Acceptance**: `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'CoverControlSurfaceTests|RecipeActionParityTests'` passes and action plans match REST field names.

### ✅ Unit 15c: Native Cover Action Planning — Coverage & Refactor
**What**: Run focused coverage for cover-action planning branches and error states.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/native-viewmodel-coverage-final.log`, `./2026-07-14-1236-doing-recipe-photo-studio/native-viewmodel-file-coverage-final.log`, and `./2026-07-14-1236-doing-recipe-photo-studio/native-viewmodel-changed-range-coverage-final.log`.
**Acceptance**: `bash -o pipefail -c "swift test --enable-code-coverage --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'CoverControlSurfaceTests|RecipeActionParityTests' 2>&1 | tee /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/native-viewmodel-coverage-final.log"` covers new cover-action planning code; `scripts/fail-on-warning.rb --log /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/native-viewmodel-coverage-final.log --log /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/unit-15c-build.log` passes from the native worktree.

### ✅ Unit 16a: Native SwiftUI Photo Studio Surface — Tests
**What**: Write failing source-contract/UI tests for native Photo Studio controls, Spoon details, editorial defaults, prompt-addition fields, loading states, and platform-native copy.
**Output**: Red tests in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/CoverControlSurfaceTests.swift`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/RecipeActionParityTests.swift`, and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Tests/SpoonjoyCoreTests/NativeLiveStoreTests.swift`.
**Acceptance**: `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'CoverControlSurfaceTests|RecipeActionParityTests|NativeLiveStoreTests'` fails on missing UI/source-contract tokens or stale labels.

### ⬜ Unit 16b: Native SwiftUI Photo Studio Surface — Implementation
**What**: Update `RecipeCoverControlsView.swift` into a platform-native Photo Studio surface with upload/Spoon/detail/editorial/generate/regenerate controls.
**Output**: Passing Swift tests plus implementation in `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Apps/Spoonjoy/Shared/Views/RecipeCoverControlsView.swift`.
**Acceptance**: `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'CoverControlSurfaceTests|RecipeActionParityTests|NativeLiveStoreTests'` passes and UI copy aligns with web product language.

### ⬜ Unit 16c: Native SwiftUI Photo Studio Surface — Coverage & Refactor
**What**: Run focused native surface tests and refactor visual/product language without changing REST contracts.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/native-swiftui-surface-coverage.log`.
**Acceptance**: `bash -o pipefail -c "swift test --enable-code-coverage --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'CoverControlSurfaceTests|RecipeActionParityTests|NativeLiveStoreTests' 2>&1 | tee /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/native-swiftui-surface-coverage.log"` passes; `scripts/fail-on-warning.rb --log /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/native-swiftui-surface-coverage.log` passes from the native worktree.

### ⬜ Unit 17: Native Validation
**What**: Run native validation from `build-native-apple-app` using the repo-owned validation matrix script.
**Output**: Native validation logs and screenshots/blocker artifacts under `./2026-07-14-1236-doing-recipe-photo-studio/native-validation/`.
**Acceptance**: From `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio`, `scripts/validate-native-local.sh --artifact-root /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/native-validation` passes, or its canonical blocker artifact documents the exact command, exit code, and fallback evidence.

### ⬜ Unit 18a: Cross-Surface Drift Checks — Tests
**What**: Write failing source-contract checks that compare REST/OpenAPI field names, native request-builder field names, MCP tool schema field names, docs examples, and smoke-script arguments for first-photo, `POST /api/v1/recipes/:id/covers/generate`, `promptAddition`, `GET /api/v1/recipes/:id/covers` status polling, and activation.
**Output**: Red tests in web OpenAPI/playground/MCP suites and native request-builder/source-contract suites.
**Acceptance**: These commands fail only on real field-name or behavior drift between surfaces: `pnpm run api:playground:generate && pnpm exec vitest run test/lib/api-v1-openapi.server.test.ts test/scripts/generate-api-playground.test.ts test/lib/mcp/spoonjoy-tools.server.test.ts test/scripts/smoke-image-cover-live.test.ts --fileParallelism=false` from `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio`; `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter 'NativeAPIExpansionTests|APITransportTests|CoverControlSurfaceTests'` from `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio`.

### ⬜ Unit 18b: Cross-Surface Drift Checks — Implementation
**What**: Fix drift found by Unit 18a across web REST/OpenAPI/docs/MCP/smoke and native request builders/source contracts.
**Output**: Passing cross-surface tests and updated `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/generated/api-v1-playground.ts`, `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/docs/api.md`, `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/API/NativeAPIRequests.swift`, and `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Features/Covers/RecipeCoverControlsViewModel.swift`.
**Acceptance**: The exact Unit 18a commands pass in both repositories with no warnings.

### ⬜ Unit 18c: Cross-Surface Drift Checks — Coverage & Refactor
**What**: Run changed-operation generated-contract scans and stale-language scans.
**Output**: Logs in `./2026-07-14-1236-doing-recipe-photo-studio/cross-surface-drift.log`.
**Acceptance**: `bash -o pipefail -c 'pnpm run api:playground:generate && pnpm exec vitest run test/lib/api-v1-openapi.server.test.ts test/scripts/generate-api-playground.test.ts test/lib/mcp/spoonjoy-tools.server.test.ts test/scripts/smoke-image-cover-live.test.ts --coverage --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/cross-surface-drift.log'` passes; `! rg -n "Chef photo|Spoonjoy cookbook|On the counter|placeholder request schema" app docs scripts test` succeeds for in-scope product-contract matches.

### ⬜ Unit 19: Final Web Validation
**What**: Run final web test, coverage, build, warning scan, and local QA cleanup inspection.
**Output**: Final web logs under `./2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/`.
**Acceptance**: From `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio`, these commands pass: `mkdir -p worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web`; `bash -o pipefail -c 'pnpm test -- --run --fileParallelism=false 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/pnpm-test.log'`; `bash -o pipefail -c 'pnpm run test:coverage 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/pnpm-test-coverage.log'`; `bash -o pipefail -c 'pnpm run build 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/pnpm-build.log'`; `bash -o pipefail -c 'pnpm run cleanup:qa 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/pnpm-cleanup-qa.log'`; `! rg -n " warning |\\bWARN\\b|DeprecationWarning|UnhandledPromiseRejection|console\\.warn" worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/pnpm-test.log worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/pnpm-test-coverage.log worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/pnpm-build.log worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/pnpm-cleanup-qa.log`.

### ⬜ Unit 20: Final Native Validation
**What**: Run final native Swift tests, native validation matrix, warning scan, and native artifact audit.
**Output**: Final native logs under `./2026-07-14-1236-doing-recipe-photo-studio/final-validation/native/`.
**Acceptance**: From `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio`, `bash -o pipefail -c 'swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors 2>&1 | tee /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/native/swift-test.log'` passes; `scripts/validate-native-local.sh --artifact-root /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/native/matrix` passes; `scripts/fail-on-warning.rb --log /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/native/swift-test.log --log /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/native/matrix/apple/matrix-warning-scan.log` passes, or exact capability blockers are recorded with fallback evidence.

### ⬜ Unit 21: Open Web PR
**What**: Create or update the web/backend PR with summary, validation evidence, linked planning/doing docs, and no stale red-phase logs presented as final evidence.
**Output**: Web PR URL and PR body snapshot under `./2026-07-14-1236-doing-recipe-photo-studio/pr-review/web-pr.md`.
**Acceptance**: `gh pr view --json url,headRefName,baseRefName,statusCheckRollup` from `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio` returns a PR whose `headRefName` is `worker/recipe-photo-studio`, and `web-pr.md` records the URL plus validation artifact paths.

### ⬜ Unit 22: Open Native PR
**What**: Create or update the native PR with summary, validation evidence, linked planning/doing docs, and any exact capability blockers.
**Output**: Native PR URL and PR body snapshot under `./2026-07-14-1236-doing-recipe-photo-studio/pr-review/native-pr.md`.
**Acceptance**: `gh pr view --json url,headRefName,baseRefName,statusCheckRollup` from `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio` returns a PR whose `headRefName` is `worker/recipe-photo-studio`, and `native-pr.md` records the URL plus validation artifact paths.

### ⬜ Unit 23: Cold Implementation Review Gates
**What**: Run cold reviewer agents against web and native diffs plus validation artifacts, then record reviewer reports.
**Output**: Reviewer reports under `./2026-07-14-1236-doing-recipe-photo-studio/pr-review/reviewer-reports.md`.
**Acceptance**: `reviewer-reports.md` contains separate web and native reviewer sections, each ending in `CONVERGED` or listing concrete findings for Unit 24.

### ⬜ Unit 24: Reviewer Finding Fixes
**What**: Address any BLOCKER/MAJOR reviewer findings from Unit 23 with focused patches, tests, commits, and re-review.
**Output**: Fix commits, focused validation logs, and reviewer follow-up notes.
**Acceptance**: `reviewer-reports.md` has no unresolved `BLOCKER` or `MAJOR` findings after re-review; the focused commands tied to each fix pass; if any fix changes web/backend source, rerun Unit 19 final web validation before Unit 25; if any fix changes native source, rerun Unit 20 final native validation before Unit 26; if any fix changes UI, rerun Unit 11 visual QA before Unit 25 or Unit 26.

### ⬜ Unit 25: Merge Web PR
**What**: Merge the web/backend PR after reviewer gates and GitHub status checks pass.
**Output**: Web merge log under `./2026-07-14-1236-doing-recipe-photo-studio/pr-review/web-merge.md`.
**Acceptance**: `gh pr view --json state,mergedAt,mergeCommit` from `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio` reports `MERGED`, or `web-merge.md` records a true human-only blocker with exact required action.

### ⬜ Unit 26: Merge Native PR
**What**: Merge the native PR after reviewer gates and GitHub status checks pass.
**Output**: Native merge log under `./2026-07-14-1236-doing-recipe-photo-studio/pr-review/native-merge.md`.
**Acceptance**: `gh pr view --json state,mergedAt,mergeCommit` from `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio` reports `MERGED`, or `native-merge.md` records a true human-only blocker with exact required action.

### ⬜ Unit 27: Production Migration, Deploy, And Web Smoke
**What**: Verify the merged web commit deploys with `pnpm run deploy:auto` ordering (`deploy:preflight`, `build`, remote D1 migrations, full preflight, deploy), confirm remote D1 has no pending migrations, and run owner-facing Photo Studio smoke checks without leaving disposable data.
**Output**: Deploy and smoke logs under `./2026-07-14-1236-doing-recipe-photo-studio/deploy/web-smoke.md`.
**Acceptance**: From the merged web checkout, GitHub production deploy for the merge commit is green or `pnpm run deploy:auto` succeeds locally; `pnpm exec wrangler d1 migrations list DB --remote` reports no pending migrations; `pnpm run deploy:preflight` passes after migrations; `pnpm run smoke:api` passes, or `web-smoke.md` records a true provider/capability blocker with exact evidence.

### ⬜ Unit 28: Native Install Or Publish Smoke
**What**: Verify the native installed/build surface after merge using local build/install smoke, and record TestFlight publish status only when existing credentials permit it without new human action.
**Output**: Native smoke logs under `./2026-07-14-1236-doing-recipe-photo-studio/deploy/native-smoke.md`.
**Acceptance**: From the merged native checkout, `scripts/validate-native-local.sh --artifact-root /Users/arimendelow/Projects/spoonjoy-v2-photo-studio/worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/deploy/native-smoke` passes, or `native-smoke.md` records a signing/TestFlight/capability blocker with exact evidence.

### ⬜ Unit 29: MCP Consuming-Surface Smoke
**What**: Deploy or verify QA with the merged web code, then run a QA-only MCP/image-cover smoke through the `scripts/smoke-live.mjs --include-image-cover-smoke` entrypoint to prove an agent client can list, generate/regenerate, poll status via `GET /api/v1/recipes/:id/covers` equivalent tool output, activate, archive, and clean up recipe covers.
**Output**: MCP smoke logs under `./2026-07-14-1236-doing-recipe-photo-studio/deploy/mcp-smoke.md`.
**Acceptance**: From the merged web checkout, `pnpm run deploy:qa` succeeds or `mcp-smoke.md` records evidence that QA already serves the merge commit; then `node scripts/smoke-live.mjs --target-env qa --base-url https://spoonjoy-v2-qa.mendelow-studio.workers.dev --out worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/deploy/mcp-smoke --include-image-cover-smoke` passes, or `mcp-smoke.md` records a true provider/capability blocker with exact evidence.

### ⬜ Unit 30: QA Data Cleanup
**What**: Run local QA cleanup inspection and remove any Codex-created disposable Spoonjoy data created during validation.
**Output**: Cleanup logs under `./2026-07-14-1236-doing-recipe-photo-studio/cleanup/qa-data.md`.
**Acceptance**: From `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio`, `bash -o pipefail -c 'pnpm run cleanup:qa 2>&1 | tee worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/cleanup/qa-data.md'` reports no Codex-created residue.

### ⬜ Unit 31: Worktree Cleanup
**What**: Remove task worktrees that are no longer needed after merge/deploy validation and confirm main checkouts are not dirtied.
**Output**: Worktree cleanup log under `./2026-07-14-1236-doing-recipe-photo-studio/cleanup/worktrees.md`.
**Acceptance**: `git -C /Users/arimendelow/Projects/spoonjoy-v2 worktree list`, `git -C /Users/arimendelow/Projects/spoonjoy-apple worktree list`, and `git status --short --branch` logs show temporary Photo Studio worktrees removed when safe and remaining checkouts at expected statuses.

### ⬜ Unit 32: Final Docs And Slugger Notification
**What**: Update planning/doing completion criteria, mark task done, commit final docs, and notify Slugger.
**Output**: Final task-doc commit and Slugger notification command output.
**Acceptance**: Planning and doing docs reflect verified completion, final docs are committed/pushed, and `ouro msg --to slugger "Done: ..."` succeeds.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Any command that writes validation output through `tee` must be executed under `bash -o pipefail -c '...'` or with an explicit `${PIPESTATUS[0]}` check so the producer command's failure cannot be hidden by `tee`
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
- 2026-07-14 13:06 Ambiguity pass pinned migration path, exact source targets, exact validation commands, and OpenAPI profile matrix
- 2026-07-14 13:09 Ambiguity Round 2 pinned final web validation log filenames
- 2026-07-14 13:11 Ambiguity Round 3 replaced final web warning-scan glob with explicit log filenames
- 2026-07-14 13:18 Scrutiny A added migration/deploy ordering, native media staging, MCP smoke, pinned status polling, and upload cleanup criteria
- 2026-07-14 13:26 Scrutiny B addressed no-op smoke command, pipefail validation, root D1 migration, native upstream, pinned request shapes, stale unit reference, and inverted scans
- 2026-07-14 13:33 Final scrutiny A fixed schema-helper ordering and required post-review final validation reruns
- 2026-07-14 13:34 Doing doc ready for execution after granularity, validation, ambiguity, quality, and scrutiny reviewer convergence
- 2026-07-14 13:43 Unit 0 complete: confirmed web/native worktrees, pushed native upstream, recorded setup artifact; unit review skipped because this was setup inventory only
- 2026-07-14 13:50 Unit 1a complete: added red tests for sanitized/bounded prompt additions, provider prompt forwarding, `RecipeCover` prompt/parent lineage persistence, and root/Prisma migration coverage; acceptance fails with 12 expected prompt/lineage failures and 141 existing tests passing (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-1a-red.log`)
- 2026-07-14 13:55 Unit 1a review fix complete: addressed Newton's MAJOR finding by adding over-limit stylization/editorial prompt-addition assertions and refreshed the red log with the same 12 expected failures / 141 existing passes
- 2026-07-14 14:10 Unit 1b complete: added `RecipeCover.promptAddition` / `parentCoverId` schema fields and migrations, wired bounded prompt additions through placeholder/editorial providers, persisted lineage on schedulers, regenerated Prisma, passed focused 153-test acceptance, full Vitest (354 files / 6,795 tests), and build with no warning matches
- 2026-07-14 14:26 Unit 1c complete: closed prompt-lineage branch coverage gaps, made focused coverage gates report unit-loaded files while keeping repo-wide thresholds for full coverage, passed focused coverage (154 tests with 100% rows on new prompt/lineage modules), build, config/preflight checks, and full Vitest (354 files / 6,796 tests) with no warning matches
- 2026-07-14 14:34 Unit 2a complete: added red coverage for first spoon-photo activation as original image, safer `Original photo` / `Editorial photo` provenance labels, and legacy UI-label normalization in RecipeHeader/RecipeCoverHistory; acceptance fails with 11 expected old-contract failures and 79 existing tests passing (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-2a-red.log`)
- 2026-07-14 14:39 Unit 2a review fix complete: addressed McClintock's MAJOR findings by adding cookbook cover badge normalization coverage and an integrated auto-seed original-to-editorial promotion test; refreshed acceptance fails with 14 expected old-contract failures and 123 existing tests passing
- 2026-07-14 15:13 Unit 2b complete: replaced generated provenance labels with `Original photo` / `Editorial photo`, normalized legacy UI labels defensively, made auto-seeded Spoon covers activate the original image variant before editorial promotion, refreshed OpenAPI/playground/smoke expectations, passed focused acceptance (137 tests), focused postpatch regression suite (468 tests), image-cover smoke (35 tests), full Vitest (354 files / 6,798 tests), build, warning/failure log scans, and stale-copy scans outside compatibility normalizers
- 2026-07-14 15:27 Unit 2c complete: split nullable vs required provenance label normalization to remove defensive fallback branch gaps, passed focused coverage with 100% rows for modified activation/label files (`CoverProvenanceBadge`, `RecipeCoverHistory`, `RecipeHeader`, `CookbookCoverArt`, `recipe-cover`, `spoon-cover-activation`, and stylization helpers), build, full Vitest (354 files / 6,798 tests), warning/failure log scans, and stale-copy scans
- 2026-07-14 15:35 Unit 3a complete: added red API v1 multipart first-photo upload contract coverage for Spoon-backed editorial default, direct cover upload without Spoon/editorial generation, auth/field/file validation, idempotent replay/conflict, and orphaned object cleanup after DB failure; acceptance fails with 5 expected missing-route 404 failures and 12 existing cover-management tests passing (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-3a-red.log`)
- 2026-07-14 15:42 Unit 3a review fix complete: addressed Boole's MAJOR finding by expecting Spoon-backed first-photo uploads to use the existing `spoons/{chefId}/{recipeId}` object namespace while direct covers keep `recipes/{chefId}/{recipeId}`, and refreshed the red log with the same 5 expected missing-route failures / 12 existing passes
- 2026-07-14 15:48 Unit 3b complete: implemented `POST /api/v1/recipes/{id}/image` multipart upload with idempotency, Spoon-backed original preservation, direct cover upload, default editorial generation, active original cover fallback, storage cleanup after DB failure, API contract registration, focused green log (`./2026-07-14-1236-doing-recipe-photo-studio/unit-3b-green.log`), and `pnpm run build` passing with no warnings
- 2026-07-14 16:19 Unit 3c complete: closed first-photo upload coverage/refactor gaps by adding idempotency completion recovery, late-failure cleanup coverage, OpenAPI/SDK/playground/docs metadata, and multipart playground required-field generation from schemas; focused tests passed (85 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-3c-focused.log`), targeted coverage audit shows no uncovered statements/functions/branches for changed upload/generator ranges (`./2026-07-14-1236-doing-recipe-photo-studio/rest-upload-coverage.log`), build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-3c-build.log`), and full Vitest passed (354 files / 6,811 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-3c-full-test.log`)
- 2026-07-14 16:40 Unit 3c review fix complete: addressed Heisenberg's MAJOR finding by deriving multipart playground `accept` metadata from OpenAPI `encoding` so recipe uploads advertise JPEG/PNG/WebP without GIF while profile photos keep GIF, and addressed the replay-fidelity finding by retrying exact idempotency completion once before falling back to recover-in-flight; focused tests passed (87 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-3c-review-fix-focused.log`), targeted coverage audit shows no uncovered statements/functions/branches (`./2026-07-14-1236-doing-recipe-photo-studio/rest-upload-review-fix-coverage.log`), build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-3c-review-fix-build.log`), and full Vitest passed (354 files / 6,813 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-3c-review-fix-full-test.log`)
- 2026-07-14 16:47 Unit 4a complete: added red REST cover-generation tests for JSON image-url cover creation, AI placeholder generation/provider-blocker polling payloads, and bounded `promptAddition` regeneration lineage; acceptance fails in the intended 3 places (missing `POST /covers`, missing `POST /covers/generate`, and unknown `promptAddition` on regenerate) while 34 existing targeted tests pass (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-4a-red-tests.log`)
- 2026-07-14 19:51 Unit 4b complete: implemented `POST /api/v1/recipes/{id}/covers`, `POST /api/v1/recipes/{id}/covers/generate`, and bounded `promptAddition` regeneration/lineage; added guarded placeholder activation semantics, updated REST contract/OpenAPI/playground metadata, and passed focused acceptance (37 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-4b-green.log`), OpenAPI route checks (13 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-4b-openapi-check.log`), and build with no warnings (`./2026-07-14-1236-doing-recipe-photo-studio/unit-4b-build.log`)
- 2026-07-14 19:57 Unit 4c complete: closed REST generation coverage branches for malformed image URLs, bad prompt additions, asynchronous placeholder polling, activated editorial cover creation, JSON-cover activation failures, and placeholder activation guards; focused tests passed (64 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-4c-focused.log`), focused coverage passed (`./2026-07-14-1236-doing-recipe-photo-studio/rest-generation-coverage.log`), changed-route/helper range audit shows no uncovered statements or branches (`./2026-07-14-1236-doing-recipe-photo-studio/rest-generation-changed-range-coverage.log`), and build passed with no warnings (`./2026-07-14-1236-doing-recipe-photo-studio/unit-4c-build.log`)
- 2026-07-14 20:07 Unit 5a complete: added red OpenAPI/docs/playground tests for Photo Studio endpoint schemas and examples, SDK profile visibility for generated covers, connector omission, boundary-safe multipart playground examples, and docs snippets for JSON cover creation, AI placeholder generation, and prompt-addition regeneration; acceptance fails in the intended 6 places while 14 targeted checks pass (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-5a-red-tests.log`)
- 2026-07-14 20:12 Unit 5b complete: updated OpenAPI examples and SDK profile inclusion for Photo Studio cover creation/generation, regenerated the playground manifest with boundary-safe multipart `FormData` and `curl --form` examples, and documented JSON cover creation, AI placeholder generation, and prompt-addition regeneration in `docs/api.md`; focused OpenAPI/docs/playground tests passed (20 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-5b-green.log`) and build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-5b-build.log`)
- 2026-07-14 20:15 Unit 5c complete: closed new multipart playground helper coverage for null field values and non-object examples; focused OpenAPI/docs/playground coverage passed (20 tests, `./2026-07-14-1236-doing-recipe-photo-studio/openapi-playground-coverage.log`), changed-range audit shows no uncovered statements/functions/branches on modified OpenAPI/playground source (`./2026-07-14-1236-doing-recipe-photo-studio/openapi-playground-changed-range-coverage.log`), and build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-5c-build.log`)
- 2026-07-14 20:19 Unit 5b review fix complete: addressed reviewer finding by making `POST /covers` and `POST /covers/regenerate` OpenAPI/playground response examples show `status: processing` with `generationStatus: processing` while editorial generation is running; added assertions for those examples, regenerated playground metadata, focused tests passed (20 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-5b-review-fix-focused.log`), coverage passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-5b-review-fix-coverage.log`), changed-range audit is clean (`./2026-07-14-1236-doing-recipe-photo-studio/unit-5b-review-fix-changed-range-coverage.log`), and build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-5b-review-fix-build.log`)
- 2026-07-14 20:26 Unit 6a complete: added red MCP Photo Studio schema/discovery tests for uploaded-cover Spoon fields, generated placeholders, prompt-addition regeneration, no-cover, transport parity, property descriptions, and argument validation; acceptance fails in the intended 8 places while 50 targeted MCP tests pass (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-6a-red-tests.log`)
- 2026-07-14 20:31 Unit 6b complete: exposed MCP Photo Studio schema metadata for uploaded-cover Spoon fields, generated placeholders, prompt-addition regeneration, status, activation, no-cover, and archive; focused MCP acceptance passed (58 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-6b-green.log`), adjacent Spoonjoy API operation regression passed (84 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-6b-spoonjoy-api-regression.log`), and build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-6b-build.log`)
- 2026-07-14 20:36 Unit 6c complete: added red MCP behavior tests for AI placeholder generation/provider-blocker payloads, JSON-RPC route parity, prompt-addition regeneration forwarding/lineage, and non-string prompt validation; acceptance fails in the intended 4 places while 57 targeted MCP tests pass (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-6c-red-tests.log`)
- 2026-07-14 20:41 Unit 6d complete: implemented MCP generated-placeholder and regenerate handlers with prompt sanitization, prompt forwarding, lineage persistence, provider-blocker payloads, JSON-RPC route parity, and idempotency; also addressed the Unit 6b reviewer finding by making uploaded-cover `postAsSpoon`, `note`, `nextTime`, `cookedAt`, and `promptAddition` fields live instead of schema-only, with regression coverage. Focused MCP tests passed (62 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-6d-green.log`), adjacent Spoonjoy API operation regression passed (84 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-6d-spoonjoy-api-regression.log`), and build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-6d-build.log`)
- 2026-07-14 20:43 Unit 6e complete: added red MCP no-cover behavior tests for direct tool JSON and HTTP JSON-RPC route parity with idempotent replay and active-cover clearing; acceptance fails in the intended 2 places while 62 targeted MCP tests pass (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-6e-red-tests.log`)
- 2026-07-14 20:46 Unit 6f complete: implemented `set_recipe_no_cover` with owner validation, required confirmation, active-cover clearing through the cover service, and MCP idempotent replay. Sequential focused MCP tests passed (65 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-6f-green.log`), adjacent Spoonjoy API operation regression passed (84 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-6f-spoonjoy-api-regression.log`), and build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-6f-build.log`)
- 2026-07-14 20:51 Unit 6g complete: closed the remaining changed-range MCP no-cover branch gap with explicit `confirmNoCover: false` rejection coverage. Focused MCP coverage passed (65 tests, `./2026-07-14-1236-doing-recipe-photo-studio/mcp-cover-tools-coverage.log`), changed-range coverage for `set_recipe_no_cover` passed (`./2026-07-14-1236-doing-recipe-photo-studio/mcp-cover-tools-changed-range-coverage.log`), build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-6g-build.log`), and the Unit 6d cold reviewer returned `CONVERGED`
- 2026-07-14 20:54 Unit 7a complete: added red smoke-script tests pinning MCP placeholder generation, prompt-addition regeneration, Spoon-backed upload fields, retired spoon-source helper removal, and exact cover/spoon cleanup expectations; acceptance fails in the intended 3 places while 32 script checks pass (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-7a-red-tests.log`)
- 2026-07-14 20:57 Unit 7b complete: updated image-cover live smoke to require `generate_recipe_cover_placeholder`, remove retired `create_recipe_cover_from_spoon` / `create_spoon` proof requirements, generate and poll an MCP placeholder, create Spoon-backed editorial covers through `create_recipe_cover_from_upload` with optional Spoon fields, pass prompt additions through editorial/regenerate calls, and preserve exact cover/spoon R2 cleanup. Focused script tests passed (35 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-7b-green.log`) and build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-7b-build.log`)
- 2026-07-14 20:59 Unit 7c complete: closed the generated-placeholder missing-id branch and verified focused smoke-script coverage at 100% statements/branches/functions/lines for `scripts/smoke-image-cover-live.mjs` (36 tests, `./2026-07-14-1236-doing-recipe-photo-studio/smoke-script-coverage.log`); build passed with no warning/failure matches (`./2026-07-14-1236-doing-recipe-photo-studio/unit-7c-build.log`)
- 2026-07-14 21:06 Unit 8a complete: added red web Photo Studio tests for owner-maintenance placement, first-photo/cover-photo labels, default `Post as Spoon` and `Editorialize cover` controls, Spoon details disclosure fields, multipart payload shape, and Spoon-backed first-photo action persistence; acceptance fails in the intended missing-component/missing-action places while 127 surrounding checks pass (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-8a-red-tests.log`)
- 2026-07-14 21:14 Unit 8b complete: implemented the inline owner Recipe Photo Studio form, mounted it in recipe maintenance above cover history, added route action handling for `createFirstPhotoCover`, preserved original uploads on Spoon rows when requested, activated the original cover immediately, queued editorialization with prompt additions, and cleaned partial writes on failure. Focused web acceptance passed (131 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-8b-green.log`) and build passed with no warning/failure matches (`./2026-07-14-1236-doing-recipe-photo-studio/unit-8b-build.log`)
- 2026-07-14 21:17 Unit 8c complete: closed RecipePhotoStudio branch coverage for empty submits, invalid/oversized files, picker cancellation, post-as-Spoon-off, editorial-off, and prompt omission. Focused coverage passed (134 tests, RecipePhotoStudio.tsx 100% statements/branches/functions/lines, `./2026-07-14-1236-doing-recipe-photo-studio/web-first-photo-coverage.log`) and build passed with no warning/failure matches (`./2026-07-14-1236-doing-recipe-photo-studio/unit-8c-build.log`)
- 2026-07-14 21:26 Unit 9a complete: added red web processing/autoswap tests for loader `activeCoverProcessing` data, original-image display with an `Editorializing cover` chip, owner Photo Studio processing state, interval revalidation, and final editorial-image swap. Acceptance fails in the intended 5 places while 139 surrounding checks pass (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-9a-red-tests.log`)
- 2026-07-14 22:10 Unit 9b complete: added active-cover processing loader metadata, header and Photo Studio `Editorializing cover` status chips, and route revalidation while an active original waits on the editorial variant; adjusted the polling assertion to behavior rather than exact effect setup count after the router mounted the effect twice. Focused web acceptance passed (144 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-9b-green.log`) and build passed with no warning/failure matches (`./2026-07-14-1236-doing-recipe-photo-studio/unit-9b-build.log`)
- 2026-07-14 22:15 Unit 9c complete: closed the remaining active-cover processing helper branch with generation-status-only and ready-cover coverage. Focused coverage passed (145 tests, RecipeHeader.tsx and RecipePhotoStudio.tsx 100%, active-cover processing helper changed lines covered, `./2026-07-14-1236-doing-recipe-photo-studio/web-processing-coverage.log`) and build passed with no warning/failure matches (`./2026-07-14-1236-doing-recipe-photo-studio/unit-9c-build.log`)
- 2026-07-14 22:22 Unit 10a complete: added red web Photo Studio generation-control tests for AI placeholder generation, prompt additions on Spoon-source/editorial regeneration paths, default activate-when-ready fields, archive/no-cover payload continuity, and stale label normalization; acceptance fails in the intended 8 places while 144 surrounding checks pass (log: `./2026-07-14-1236-doing-recipe-photo-studio/unit-10a-red-tests.log`)
- 2026-07-14 22:26 Unit 10b complete: implemented web Photo Studio placeholder generation, Spoon-photo editorial direction controls, regeneration direction controls, prompt-addition persistence/lineage, and defensive stale-label normalization; focused web acceptance passed (152 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-10b-green.log`), build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-10b-build.log`), and warning/failure plus stale-copy scans were clean
- 2026-07-14 22:30 Unit 10c complete: added synchronous placeholder-generation fallback coverage, reran focused coverage (153 tests, 100% rows for `CoverProvenanceBadge`, `RecipeCoverHistory`, `RecipeHeader`, and `RecipePhotoStudio`, `./2026-07-14-1236-doing-recipe-photo-studio/web-generation-controls-coverage.log`), verified changed-range coverage has no uncovered statements (`./2026-07-14-1236-doing-recipe-photo-studio/web-generation-controls-changed-range-coverage.log`), build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-10c-build.log`), and warning/failure plus stale-copy scans were clean
- 2026-07-14 23:07 Unit 11 complete: captured focused desktop/mobile Photo Studio viewport screenshots and snapshots for first-photo, cover-history, processing-original, editorial-ready regeneration/Spoon-photo, and generated-placeholder states; `./2026-07-14-1236-doing-recipe-photo-studio/visual-qa/layout-audit.json` reports no error-boundary captures, no visible overflow, and successful section placement; `./2026-07-14-1236-doing-recipe-photo-studio/web-visual-qa-ledger.md` has all findings closed after replacing first-pass bad screenshot evidence; visual re-review returned `CONVERGED`
- 2026-07-14 23:15 Unit 12a complete: added native red request-builder coverage for Photo Studio upload fields (`photo`, `postAsSpoon`, Spoon note/next-time/cooked-at metadata), generated placeholder creation, prompt-aware regeneration, cover polling, and generated-cover invalid-URL transport typing; focused native acceptance fails in the intended missing-builder/signature places (`./2026-07-14-1236-doing-recipe-photo-studio/unit-12a-red-tests.log`), and native red-test commit `8daaa02b` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-14 23:22 Unit 12a review complete: cold reviewer returned `CONVERGED`, confirming the red tests assert outgoing request shape and fail for intended native request-builder/signature gaps rather than mock/setup noise
- 2026-07-14 23:22 Unit 12b complete: implemented native Photo Studio request builders for `photo` multipart uploads with Spoon fields, generated-placeholder JSON creation, prompt-aware regeneration, and source-compatible legacy upload forwarding; focused native acceptance passed (36 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-12b-green.log`), `swift build -Xswiftc -warnings-as-errors` passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-12b-build.log`), and native implementation commit `e15e681d` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-14 23:27 Unit 12b review complete: cold reviewer returned `CONVERGED`, confirming the implementation changed only native request builders, preserved source compatibility, used the right auth/cache helpers, and satisfied the red contract without test edits
- 2026-07-14 23:27 Unit 12c complete: added coverage for the legacy `uploadImage(image:)` forwarding overload, reran focused Swift coverage (36 tests, `./2026-07-14-1236-doing-recipe-photo-studio/native-request-builder-coverage.log`), verified `APITransport.swift` full-file coverage at 100% (`./2026-07-14-1236-doing-recipe-photo-studio/native-request-builder-apitransport-coverage-enforce.log`), verified changed `RecipeCoverRequests` ranges at 100% (`./2026-07-14-1236-doing-recipe-photo-studio/native-request-builder-changed-range-coverage.log`; full `NativeAPIRequests.swift` still has pre-existing unrelated uncovered builders), warning scan passed (`./2026-07-14-1236-doing-recipe-photo-studio/native-request-builder-warning-scan.log`), build passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-12c-build.log`), and native coverage commit `86857720` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-14 23:30 Unit 13a complete: added native red sync-queue tests requiring cover uploads to persist/replay canonical `photo` staged media plus `postAsSpoon`, Spoon note/next-time/cooked-at metadata, prompt additions on regeneration, canonical `missingMedia("photo")`, and legacy `image` queue compatibility; focused sync/offline acceptance fails in the intended missing `coverUpload(photo:...)` and `coverRegenerate(promptAddition:...)` places (`./2026-07-14-1236-doing-recipe-photo-studio/unit-13a-red-tests.log`), and native red-test commit `9de472ee` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-14 23:32 Unit 13b complete: implemented canonical queued cover upload `photo` media with source-compatible `image` forwarding, Spoon metadata persistence/replay, legacy `image` decode normalization to `photo`, `missingMedia("photo")`, and prompt-aware cover regeneration; focused sync/offline/native API acceptance passed (85 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-13b-green.log`), `swift build -Xswiftc -warnings-as-errors` passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-13b-build.log`), and native implementation commit `c16e08ac` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-14 23:38 Unit 13c complete: ran native sync focused coverage after removing the redundant cover-upload `image` fallback in favor of decode-time legacy normalization; coverage suite passed (85 tests, `./2026-07-14-1236-doing-recipe-photo-studio/native-sync-coverage.log`), changed-range coverage passed (37/37 executable touched lines, `./2026-07-14-1236-doing-recipe-photo-studio/native-sync-changed-range-coverage.log`), warning scan passed (`./2026-07-14-1236-doing-recipe-photo-studio/native-sync-warning-scan.log`), `swift build -Xswiftc -warnings-as-errors` passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-13c-build.log`), and native refactor commit `107155fa` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-14 23:53 Unit 14a complete: added native red cover-photo staging tests for real picker bytes, JPEG/PNG/WebP/HEIC content types, no silent eviction, replacement accounting, preserving staged media on cancellation/rejection, and source-contract PhotosPicker wiring through `RecipeCoverPhotoStagingPolicy`; pipefail acceptance fails in the intended missing staging-policy/type places (`./2026-07-14-1236-doing-recipe-photo-studio/unit-14a-red-tests.log`), and native red-test commit `65b68329` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-15 00:05 Unit 14b complete: implemented `RecipeCoverPhotoStagingPolicy`, staging result/rejection/usage accounting, and the native Photo Studio `PhotosPicker` surface that loads real picker bytes into `NativeStagedMediaUpload` while preserving staged media on cancellation or rejection; focused native acceptance passed (99 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-14b-green.log`), warning scan passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-14b-warning-scan.log`), `swift build -Xswiftc -warnings-as-errors` passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-14b-build.log`), and native implementation commit `0dd07954` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-15 00:12 Unit 14c complete: reran native media-staging coverage (99 tests, `./2026-07-14-1236-doing-recipe-photo-studio/native-media-staging-coverage.log`), added the missing unsupported-extension assertion, verified changed-range coverage for the new core staging policy at 35/35 executable touched lines (`./2026-07-14-1236-doing-recipe-photo-studio/native-media-staging-changed-range-coverage.log`), warning scan passed (`./2026-07-14-1236-doing-recipe-photo-studio/native-media-staging-warning-scan.log`), `swift build -Xswiftc -warnings-as-errors` passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-14c-build.log`), and native coverage commit `253e59c9` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-15 00:18 Unit 15a complete: added native red action-planning tests for staged photo upload multipart request/fallback parity, offline upload queuing, generated placeholder online request planning, prompt-addition regeneration, and stable success messages; pipefail acceptance fails in the intended missing `uploadPhoto`, `generatePlaceholder`, and `regenerate(promptAddition:)` places (`./2026-07-14-1236-doing-recipe-photo-studio/unit-15a-red-tests.log`), and native red-test commit `c188e1b9` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-15 00:23 Unit 15b complete: implemented native cover action planning for staged photo uploads, online generated placeholders, and prompt-addition regeneration with exact remote/queued REST parity; focused acceptance passed (19 tests, `./2026-07-14-1236-doing-recipe-photo-studio/unit-15b-green.log`), warning scan passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-15b-warning-scan.log`), `swift build -Xswiftc -warnings-as-errors` passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-15b-build.log`), and native implementation commit `95413f2c` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-15 00:24 Unit 14 review fix complete: addressed Popper's findings by rejecting empty `NativeStagedMediaUpload` picker candidates before quota evaluation and passing `RecipeCoverPhotoStagedMediaUsage(queuedMutations:)` from the native shell into `RecipeCoverControlsView`; review-fix red/green logs passed through the intended failure then success (`./2026-07-14-1236-doing-recipe-photo-studio/unit-14-review-fix-red.log`, `./2026-07-14-1236-doing-recipe-photo-studio/unit-14-review-fix-green-final.log`), `swift build -Xswiftc -warnings-as-errors` passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-14-review-fix-build-final.log`), macOS and iOS app-target builds passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-14-review-fix-xcodebuild-macos-arm64-final.log`, `./2026-07-14-1236-doing-recipe-photo-studio/unit-14-review-fix-xcodebuild-ios-simulator-final.log`), final warning scan passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-14-review-fix-final-artifact-warning-scan.log`), and native fix commit `80e55d35` was pushed to `origin/worker/recipe-photo-studio`
- 2026-07-15 00:25 Unit 15c complete: reran focused native coverage on the final native head (19 tests, `./2026-07-14-1236-doing-recipe-photo-studio/native-viewmodel-coverage-final.log`), verified `RecipeCoverControlsViewModel.swift` at 100% line coverage (`./2026-07-14-1236-doing-recipe-photo-studio/native-viewmodel-file-coverage-final.log`), verified 47/47 changed executable segments for staging/action-planning ranges (`./2026-07-14-1236-doing-recipe-photo-studio/native-viewmodel-changed-range-coverage-final.log`), `swift build -Xswiftc -warnings-as-errors` passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-15c-build.log`), warning scan passed (`./2026-07-14-1236-doing-recipe-photo-studio/unit-15c-warning-scan.log`), and no native source changes were needed after the Unit 14 review-fix commit
- 2026-07-15 00:26 Unit 16a complete: added native red source-contract coverage for Photo Studio upload/Spoon controls, editorial defaults, placeholder/regeneration prompt fields, processing-state copy, and stale `Recipe Covers` copy removal; focused native acceptance fails in the intended five surface-contract issues while 89 surrounding checks pass (`./2026-07-14-1236-doing-recipe-photo-studio/unit-16a-red-tests.log`), and native red-test commit `7fa677a0` was pushed to `origin/worker/recipe-photo-studio`
