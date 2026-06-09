# Doing: Recipe Cover Lifecycle

**Status**: READY_FOR_EXECUTION
**Execution Mode**: direct
**Created**: 2026-06-08 17:00
**Planning**: ./2026-06-08-1648-planning-recipe-cover-lifecycle.md
**Artifacts**: ./2026-06-08-1648-doing-recipe-cover-lifecycle/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (non-autopilot interactive mode only; autopilot must convert this to `spawn` or `direct` unless a hard exception is present)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Make Spoonjoy recipe imagery explicit, provenance-aware, and controllable across web UI and MCP. Recipes should distinguish pure AI placeholders, uploaded photos, imported photos, and editorialized chef photos while letting chefs browse, choose, and retain cover history.

## Decision Record
- 2026-06-08: Main recipe cards/pages should show cover provenance because pure AI, verbatim chef photos, imported photos, and editorialized chef photos must be distinguishable in today's trust environment.
- 2026-06-08: Verbatim uploaded photos are valid active covers. Editorialized generation is optional, not required, even when a chef uploads a photo.
- 2026-06-08: Recipes with no real photo should show an intentional awaiting-cover state, with owner copy clarifying that Spoonjoy is awaiting a first chef spoon photo or direct photo upload.
- 2026-06-08: If no photo exists, Spoonjoy may eventually use a pure AI generated placeholder, but the UI/API/MCP must clearly identify it as pure AI rather than an editorialized chef photo.
- 2026-06-08: Chefs should be able to browse all recipe covers and all spoon images for a recipe, then choose raw or editorialized variants explicitly.
- 2026-06-08: GIF uploads are out of scope for recipe and spoon imagery.

## Upstream Work Items
- None

## Completion Criteria
- [ ] New recipes without a real cover show an intentional awaiting-cover state and never show the Chef RJ placeholder as a recipe cover fallback.
- [ ] Public recipe surfaces show a provenance badge for the active cover.
- [ ] Owner recipe surfaces provide cover history controls for active cover selection, verbatim uploaded cover use, editorial generation/regeneration, and cover removal/archive.
- [ ] First chef spoon can be logged without a photo; first chef spoon with a photo auto-seeds an editorialized cover only when the recipe has no active real cover.
- [ ] Later chef spoons can opt in to cover creation with explicit UI and do not replace a manually chosen active cover unless requested.
- [ ] MCP exposes explicit cover and spoon-image browsing/activation operations with provenance, generation status, idempotency, and safe permission checks.
- [ ] Existing APIs and loaders no longer derive current cover from newest row ordering.
- [ ] Pure AI generated, uploaded verbatim, imported, and editorialized-photo covers are distinguishable in database rows, web UI, public API, and MCP responses.
- [ ] Placeholder, import, edit, fork, and stylization jobs cannot silently replace a manually selected active cover.
- [ ] Removing a cover archives the cover record by default; removing the active cover requires an explicit next active cover or an explicit no-cover state.
- [ ] Search index metadata and Open Graph output use the explicit active cover and remain correct after cover changes.
- [ ] Image generation failures remain visible via PostHog exception capture and user-facing failure states.
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

### ✅ Unit 0: Setup/Research
**What**: Inventory every active-cover read/write path before editing: `prisma/schema.prisma`, `prisma/seed.ts`, root D1 SQL migrations under `migrations/`, `app/lib/recipe-cover.server.ts`, `app/lib/ai-placeholder-cover.server.ts`, `app/lib/spoon-cover-stylization.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/lib/recipe-detail.server.ts`, `app/lib/recipe-spoon.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/search.server.ts`, `app/lib/recipe-fork.server.ts`, `app/lib/recipe-import.server.ts`, `app/routes/recipes.new.tsx`, `app/routes/recipes.$id.edit.tsx`, `app/routes/recipes.$id.tsx`, `app/routes/recipes._index.tsx`, `app/routes/_index.tsx`, `app/routes/users.$identifier.tsx`, `app/routes/cookbooks.$id.tsx`, `app/routes/search.tsx`, `app/routes/og.recipes.$id.png.tsx`, `app/routes/og.cookbooks.$id.png.tsx`, `app/components/recipe/RecipeHeader.tsx`, `app/components/recipe/SpoonDialog.tsx`, `app/components/pantry/RecipeGrid.tsx`, `app/components/cookbook/CookbookCoverArt.tsx`, and `app/lib/og-image.server.tsx`.
**Output**: Notes saved under `./2026-06-08-1648-doing-recipe-cover-lifecycle/cover-read-write-inventory.md`.
**Acceptance**: Inventory lists each read/write path, the current behavior, and the unit that will change or intentionally leave it.

### ✅ Unit 1a: Active Cover Schema And Helpers — Tests
**What**: Add failing tests for explicit active-cover state, active variant selection, provenance derivation, archive filtering, newest ready/non-empty backfill semantics, and intentional no-cover state. Target `test/lib/recipe-cover.server.test.ts`, `test/models/recipe-cover.test.ts`, migration tests under `test/scripts/`, and any existing route/API tests that assert newest-row behavior. Migration coverage must include both the Prisma migration and the root D1 SQL migration applied by Wrangler from `migrations/`.
**Acceptance**: New and updated tests fail because `Recipe.activeCoverId`, active variant selection, cover status/provenance, archive behavior, and backfill support do not exist yet.

### ✅ Unit 1b: Active Cover Schema And Helpers — Implementation
**What**: Add both a Prisma migration and the next numbered root D1 SQL migration under `migrations/` for explicit active cover selection. Add `Recipe.activeCoverId String?`, `Recipe.activeCoverVariant String?` with values `image | stylized`, and `Recipe.coverMode String @default("auto")` with values `auto | manual | none`. Add an optional active-cover relation named `RecipeActiveCover`: `Recipe.activeCover` uses `@relation("RecipeActiveCover", fields: [activeCoverId], references: [id], onDelete: SetNull)`, and `RecipeCover.activeForRecipes Recipe[] @relation("RecipeActiveCover")`. Keep the existing history relation named separately from active-cover relation, for example `Recipe.covers RecipeCover[] @relation("RecipeCoverHistory")` and `RecipeCover.recipe @relation("RecipeCoverHistory", ...)`. Retain existing `RecipeCover.sourceType` as the canonical source field with values `ai-placeholder | chef-upload | import | spoon`; do not add a separate source-kind field. Extend `RecipeCover` with `status String @default("ready")` values `processing | ready | failed | archived`, `createdById String?`, `sourceImageUrl String?`, `generationStatus String @default("none")` values `none | processing | succeeded | failed`, `failureReason String?`, `promptVersion String?`, `styleVersion String?`, and `archivedAt DateTime?`. Keep `imageUrl` as the verbatim or pure-AI display image and `stylizedImageUrl` as the editorialized variant. Update `app/lib/recipe-cover.server.ts` with create/list/set/archive helpers, provenance formatting, active URL selection, and safe newest ready/non-empty backfill support.
**Acceptance**: Unit 1a tests pass, Prisma validation/generation succeeds, and no helper falls back to newest-row selection except the explicit migration/backfill helper.

### ✅ Unit 1c: Active Cover Schema And Helpers — Coverage & Refactor
**What**: Refactor helper names/types for clarity, add edge-case coverage for empty URLs, archived covers, failed covers, missing active cover rows, inactive editorial variants, invalid `activeCoverVariant`, invalid `coverMode`, invalid `status`, invalid `sourceType`, and D1-compatible non-interactive write sequences. Backfill rules: for each recipe, choose newest `ready` non-archived cover with a non-empty `stylizedImageUrl` or `imageUrl`; set `activeCoverVariant` to `stylized` when `stylizedImageUrl` is non-empty, otherwise `image`; if no ready non-empty cover exists, leave `activeCoverId` and `activeCoverVariant` null with `coverMode="auto"`.
**Acceptance**: Cover helper/model/migration tests pass with 100% coverage on new helper branches and no warnings.

### ✅ Unit 2a: Recipe Page And Listing Read Surfaces — Tests
**What**: Add failing tests proving recipe detail, recipe index, home, profile, cookbook pages, search page, `RecipeHeader`, `RecipeGrid`, and `CookbookCoverArt` use explicit active covers and render provenance badges. Include newest empty row, archived newest row, active older cover, and intentional no-cover cases.
**Acceptance**: Tests fail because these surfaces still use ordered covers or lack provenance badges.

### ✅ Unit 2b: Recipe Page And Listing Read Surfaces — Implementation
**What**: Update recipe/detail/index/home/profile/cookbook/search loaders and components to fetch/use active cover helper output. Add public provenance badge labels: `AI generated` for `sourceType="ai-placeholder"` with variant `image`, `Chef photo` for `chef-upload` or `spoon` with variant `image`, `Editorialized chef photo` for `chef-upload` or `spoon` with variant `stylized`, and `Imported photo` for `import`.
**Acceptance**: Unit 2a tests pass and no listed web surface displays an archived/empty newest row.

### ✅ Unit 2c: Recipe Page And Listing Read Surfaces — Coverage & Refactor
**What**: Consolidate duplicate cover props for web surfaces, keep null/no-cover states intentional, and cover badge rendering branches.
**Acceptance**: Affected web route/component tests pass with 100% coverage on new branches and no warnings.

### ✅ Unit 3a: API v1, Search, And Open Graph Read Surfaces — Tests
**What**: Add failing tests proving `app/lib/api-v1.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/lib/search.server.ts`, `app/routes/og.recipes.$id.png.tsx`, and `app/routes/og.cookbooks.$id.png.tsx` use explicit active covers and include/derive correct provenance metadata. API v1 `RecipeSummary` and `RecipeDetail` must expose `coverProvenanceLabel`, `coverSourceType`, and `coverVariant`; cookbook cover arrays remain URL arrays but recipe entries include those fields. Include active older cover, archived newest row, empty newest row, and intentional no-cover cases.
**Acceptance**: Tests fail because these server surfaces still derive cover output from ordered cover arrays or lack provenance.

### ✅ Unit 3b: API v1, Search, And Open Graph Read Surfaces — Implementation
**What**: Replace newest-row cover selection in API v1, API v1 OpenAPI schemas/examples, search metadata, and Open Graph route output with active-cover helper output. Ensure search metadata updates when active cover or active variant changes. Update `RecipeSummary`, `RecipeDetail`, `CookbookSummary`, and `CookbookDetail` schema/examples in `app/lib/api-v1-openapi.server.ts` for the new provenance fields where recipe objects are returned.
**Acceptance**: Unit 3a tests pass and server read surfaces agree on active cover URL/provenance.

### ✅ Unit 3c: API v1, Search, And Open Graph Read Surfaces — Coverage & Refactor
**What**: Refactor shared server cover formatting to avoid drift between API v1, search, and OG paths.
**Acceptance**: Affected server tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 4a: Recipe New/Edit And Placeholder Mutations — Tests
**What**: Add failing tests for new recipe creation without photo, recipe upload assignment, recipe clear-image behavior, pure AI placeholder generation, verbatim uploaded active cover selection, manual cover mode, intentional no-cover mode, seed/demo recipe active-cover setup, and PostHog capture on placeholder failure.
**Acceptance**: Tests fail because these mutations/jobs create rows without explicit active state, provenance, or manual replacement checks.

### ⬜ Unit 4b: Recipe New/Edit And Placeholder Mutations — Implementation
**What**: Update `app/routes/recipes.new.tsx`, `app/routes/recipes.$id.edit.tsx`, recipe clear-image, `prisma/seed.ts`, and placeholder generation flows to create covers with status/provenance, activate them through helpers, support verbatim active uploads, and prevent placeholder jobs from replacing manual covers. New recipe with no upload uses `coverMode="auto"` and no active cover until a placeholder succeeds; clear-image sets `coverMode="none"` with null `activeCoverId`/`activeCoverVariant`; explicit upload sets `coverMode="manual"`, `activeCoverVariant="image"`, and `sourceType="chef-upload"` unless editorial generation is requested.
**Acceptance**: Unit 4a tests pass and placeholder failures leave visible failure state plus existing PostHog exception capture.

### ⬜ Unit 4c: Recipe New/Edit And Placeholder Mutations — Coverage & Refactor
**What**: Refactor duplicate upload/placeholder activation logic and cover error paths for missing bucket, failed generation, empty image URL, and no-cover state.
**Acceptance**: Affected mutation/job tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 5a: Import And Fork Cover Flows — Tests
**What**: Add failing tests for recipe import cover rows, imported provenance, fork cover copying, fork active-cover selection, and preservation of manual/no-cover semantics on copied recipes.
**Acceptance**: Tests fail because import/fork paths do not preserve explicit active-cover state or detailed provenance.

### ⬜ Unit 5b: Import And Fork Cover Flows — Implementation
**What**: Update `app/lib/recipe-import.server.ts` and `app/lib/recipe-fork.server.ts` to create/copy cover status, provenance, active variant, and active-cover state through helpers.
**Acceptance**: Unit 5a tests pass and fork/import flows cannot reintroduce newest-row selection.

### ⬜ Unit 5c: Import And Fork Cover Flows — Coverage & Refactor
**What**: Cover import/fork edge cases for missing source cover, empty source cover, archived source cover, pure AI placeholder, and imported image fallback.
**Acceptance**: Import/fork tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 6a: Stylization Jobs, Races, And Telemetry — Tests
**What**: Add failing tests for spoon cover stylization, recipe upload editorial generation/regeneration, job completion after manual cover selection, job failure status, missing source image, and PostHog exception capture.
**Acceptance**: Tests fail because stylization jobs do not re-check active-cover/manual state or persist generation status/failure details.

### ⬜ Unit 6b: Stylization Jobs, Races, And Telemetry — Implementation
**What**: Update stylization/generation jobs to record status/provenance, re-check active-cover state before activation, preserve manual selections, and return failure states usable by UI/MCP. A job may auto-activate only when `coverMode="auto"` and there is no active real cover. A real cover means active cover status `ready`, active URL non-empty, and active cover `sourceType !== "ai-placeholder"`. A manual cover means `coverMode="manual"` and must never be replaced by job completion.
**Acceptance**: Unit 6a tests pass and async jobs cannot silently replace a manually selected active cover.

### ⬜ Unit 6c: Stylization Jobs, Races, And Telemetry — Coverage & Refactor
**What**: Refactor shared generation status and telemetry helpers; cover success, failure, timeout, missing bucket, and stale-job branches.
**Acceptance**: Generation/job tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 7a: Spoon Backend And Dialog Flow — Tests
**What**: Add failing tests for optional first chef spoon photo, first chef photo auto-seed only when no active real cover exists, later chef spoon explicit cover opt-in, non-owner spoon photos never auto-update recipe cover, and preservation of upload progress/disabled submit behavior. The form field for later opt-in is `useAsRecipeCover=true`; first-chef/no-real-cover auto-seed does not require the field. First-chef auto-seed creates a cover in `status="processing"` with `sourceType="spoon"`, `imageUrl` set to the raw photo, `activeCoverId` set to that cover, and `activeCoverVariant` left null until stylization succeeds; the active display may use raw photo while processing, but it must not count as a real cover for the same cover's stylization activation.
**Acceptance**: Tests fail because current backend requires first chef photo and current dialog lacks cover opt-in controls.

### ⬜ Unit 7b: Spoon Backend And Dialog Flow — Implementation
**What**: Update `app/lib/recipe-spoon.server.ts`, `app/lib/recipe-detail.server.ts`, `app/routes/recipes.$id.tsx`, and `SpoonDialog` so first chef spoon photo is optional, first chef photo auto-seeds through helpers only when `coverMode="auto"` and no real cover exists, later chef spoon cover creation requires `useAsRecipeCover=true`, and posting stays disabled while uploading. Dialog copy: when owner recipe has no real cover and `coverMode="auto"`, show `Add a photo to create the recipe cover`; later owner spoon with photo shows checkbox label `Use this photo as recipe cover`; non-owner dialog shows no cover copy/control. First-chef auto-seed must schedule editorialization for the same processing cover and update that cover to `status="ready"`, `generationStatus="succeeded"`, and `activeCoverVariant="stylized"` when the stylized URL is available.
**Acceptance**: Unit 7a tests pass and non-owner users cannot invoke owner cover behavior through spoon creation.

### ⬜ Unit 7c: Spoon Backend And Dialog Flow — Coverage & Refactor
**What**: Refactor spoon-cover decision logic into tested helpers and cover invalid form inputs, missing photo, invalid photo, owner/non-owner, and existing active-cover cases.
**Acceptance**: Spoon backend/dialog tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 8a: Owner Cover History UI — Tests
**What**: Add failing route/component tests for owner-only cover history browsing on recipe pages: current badge, provenance labels, source thumbnails, active variant labels, set-active action, no-cover state, and non-owner hidden state. Placeholder copy must be `Awaiting first chef photo` for owners and `Cover coming soon` for public/non-owner viewers.
**Acceptance**: Tests fail because owner cover history UI does not exist.

### ⬜ Unit 8b: Owner Cover History UI — Implementation
**What**: Add focused recipe cover history components and route actions for browsing covers and setting the active cover/variant. Route action intents: `setRecipeCover`, `setRecipeNoCover`. Fields for `setRecipeCover`: `coverId`, `variant`. Field for `setRecipeNoCover`: `confirmNoCover=true`. Set-active action sets `coverMode="manual"`; no-cover action sets `coverMode="none"`. Keep controls accessible, stable in size, and visually consistent with existing Spoonjoy surfaces.
**Acceptance**: Unit 8a tests pass and owner can swap between retained covers including verbatim and editorialized variants.

### ⬜ Unit 8c: Owner Cover History UI — Coverage & Refactor
**What**: Cover empty, loading, failed, archived, long-title, and mobile layout states without overlapping text or nested cards.
**Acceptance**: Cover history UI tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 9a: Spoon Image Picker, Regeneration, And Archive UI — Tests
**What**: Add failing route/component tests for browsing recipe spoon photos as cover sources, generating an editorial cover from a selected spoon/upload, regenerating a cover, archiving a cover, and requiring explicit replacement/no-cover choice when archiving the active cover.
**Acceptance**: Tests fail because source picker, regeneration, and archive controls do not exist.

### ⬜ Unit 9b: Spoon Image Picker, Regeneration, And Archive UI — Implementation
**What**: Add owner-only source picker, regenerate action, archive action, and active-cover removal confirmation. Route action intents: `createCoverFromSpoon`, `regenerateRecipeCover`, `archiveRecipeCover`. Fields for `createCoverFromSpoon`: `spoonId`, `activateWhenReady` optional boolean. Fields for `regenerateRecipeCover`: `coverId`, `activateWhenReady` optional boolean. Fields for `archiveRecipeCover`: `coverId`, plus either `replacementCoverId` and `replacementVariant`, or `confirmNoCover=true`. Use server helpers from earlier units and keep destructive R2 cleanup behind explicit safe paths.
**Acceptance**: Unit 9a tests pass and active-cover archive never silently selects a replacement.

### ⬜ Unit 9c: Spoon Image Picker, Regeneration, And Archive UI — Coverage & Refactor
**What**: Cover source spoon deleted, no spoon photos, archived source cover, failed generation retry, and permission-denied states.
**Acceptance**: Picker/regeneration/archive UI tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 10a: MCP Cover And Spoon Image Read Operations — Tests
**What**: Add failing MCP tests for `list_recipe_covers`, `list_recipe_spoon_images`, and active cover/provenance fields on existing recipe/spoon responses. `list_recipe_covers` input: `{ recipeId: string, includeArchived?: boolean, limit?: number, offset?: number }`; default `includeArchived=false`, default `limit=25`, max limit uses existing MCP limit convention. `list_recipe_spoon_images` input: `{ recipeId: string, limit?: number, offset?: number }`. Public/basic recipe reads require `recipes:read`, but full cover history, archived covers, failed covers, failure metadata, and spoon image source browsing require `kitchen:write` plus recipe-owner permission. Non-owner/read-only callers may receive only active public cover metadata already exposed on recipe responses. Cover payload fields for owner/full responses: `id`, `recipeId`, `status`, `sourceType`, `imageUrl`, `stylizedImageUrl`, `displayUrl`, `activeVariant`, `provenanceLabel`, `sourceSpoonId`, `createdById`, `archivedAt`, `generationStatus`, `failureReason`, `createdAt`.
**Acceptance**: Tests fail because explicit cover/spoon image browse operations and response metadata do not exist.

### ⬜ Unit 10b: MCP Cover And Spoon Image Read Operations — Implementation
**What**: Implement read-only MCP operations and shared payload formatting in `app/lib/spoonjoy-api.server.ts`, register annotations, and expose cover provenance/status/variant metadata in existing recipe/spoon outputs. Read responses return `{ covers, activeCover, pagination }` for owner/full cover reads and `{ spoonImages, pagination }` for owner spoon-image reads; archived covers are excluded unless `includeArchived=true`. Non-owner/read-only calls to `list_recipe_covers` return only active public cover metadata and no archived/failed/failure/source-photo details; `list_recipe_spoon_images` rejects non-owner callers.
**Acceptance**: Unit 10a tests pass and MCP can browse all covers for a recipe plus all recipe spoon images.

### ⬜ Unit 10c: MCP Cover And Spoon Image Read Operations — Coverage & Refactor
**What**: Refactor cover payload formatting and cover auth/visibility helpers for reuse by write operations.
**Acceptance**: MCP read tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 11a: MCP Cover Create, Regenerate, And Status Operations — Tests
**What**: Add failing MCP tests for `create_recipe_cover_from_upload`, `create_recipe_cover_from_spoon`, `regenerate_recipe_cover`, and `get_cover_generation_status`. Also add regression tests for existing MCP write tools `create_recipe`, `update_recipe`, `create_spoon`, `update_spoon`, `import_recipe_from_url`, and `fork_recipe` so they cannot bypass active-cover/manual/no-cover semantics. Inputs: `create_recipe_cover_from_upload { recipeId, imageUrl, activate?: boolean, generateEditorial?: boolean, idempotencyKey?: string, dryRun?: boolean }`; `create_recipe_cover_from_spoon { recipeId, spoonId, activate?: boolean, generateEditorial?: boolean, idempotencyKey?: string, dryRun?: boolean }`; `regenerate_recipe_cover { recipeId, coverId, activateWhenReady?: boolean, idempotencyKey?: string, dryRun?: boolean }`; `get_cover_generation_status { recipeId, coverId }`. Mutating operations require `kitchen:write` and recipe owner permission. Dry run performs validation, returns no writes, and never records or consumes an idempotency key. Idempotency keys are scoped by authenticated principal id, operation name, recipe id, and normalized request payload excluding `dryRun`; same key and same payload returns the original mutation result without duplicate writes after completion; same key and different payload returns an idempotency conflict error; an in-flight same-key replay returns an `idempotency_in_progress` conflict error without creating duplicate work.
**Acceptance**: Tests fail because create/regenerate/status operations do not exist.

### ⬜ Unit 11b: MCP Cover Create, Regenerate, And Status Operations — Implementation
**What**: Implement MCP create/regenerate/status operations using shared cover helpers and generation jobs. Update existing MCP write tools `create_recipe`, `update_recipe`, `create_spoon`, `update_spoon`, `import_recipe_from_url`, and `fork_recipe` to use the same helpers and respect `coverMode="manual"` and `coverMode="none"`. Register every new operation in `TOOL_ANNOTATIONS` with correct read/write/destructive/idempotent hints so MCP tool listing cannot crash. Preserve upload tools and require explicit activation for existing active-cover replacement. Mutation response shape: `{ activeCover, previousActiveCover, createdCover, generationStatus, warnings: string[], nextActions: string[] }`; dry run returns the same shape with `createdCover=null` and explanatory `nextActions`.
**Acceptance**: Unit 11a tests pass and MCP can generate candidates without hidden active-cover replacement.

### ⬜ Unit 11c: MCP Cover Create, Regenerate, And Status Operations — Coverage & Refactor
**What**: Cover auth, validation, idempotency, dry-run, failed generation, and successful generation branches.
**Acceptance**: MCP create/regenerate/status tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 12a: MCP Active Cover Set And Archive Operations — Tests
**What**: Add failing MCP tests for `set_active_recipe_cover` and `archive_recipe_cover`. Inputs: `set_active_recipe_cover { recipeId, coverId, variant, idempotencyKey?: string }` where `variant` is `image | stylized`; `archive_recipe_cover { recipeId, coverId, replacementCoverId?: string, replacementVariant?: string, confirmNoCover?: boolean, deleteSafeObjects?: boolean, idempotencyKey?: string }`. Both require `kitchen:write` and recipe owner permission. Archiving the active cover requires either replacement cover+variant or `confirmNoCover=true`. Idempotency uses the same scope/replay/conflict rules as Unit 11 and dry-run is not supported for these two operations.
**Acceptance**: Tests fail because explicit activation/archive MCP operations do not exist.

### ⬜ Unit 12b: MCP Active Cover Set And Archive Operations — Implementation
**What**: Implement MCP active-cover mutation and archive operations, update unknown-argument handling and annotations, and return `{ activeCover, previousActiveCover, archivedCover, warnings: string[], nextActions: string[] }`. `set_active_recipe_cover` sets `coverMode="manual"`. `archive_recipe_cover` sets `status="archived"` and `archivedAt`; if `confirmNoCover=true`, set recipe `coverMode="none"` and null active fields.
**Acceptance**: Unit 12a tests pass and MCP active-cover mutation is explicit and permission checked.

### ⬜ Unit 12c: MCP Active Cover Set And Archive Operations — Coverage & Refactor
**What**: Cover destructive hints, idempotent archive calls, no-cover confirmation, active variant edge cases, and attempts by non-owners.
**Acceptance**: MCP set/archive tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 13: Final Validation And Browser Smoke
**What**: Run full validation after all feature units are green: `pnpm run test:coverage`, `pnpm run test:e2e`, `pnpm run deploy:preflight`, targeted MCP suites `pnpm run test -- test/lib/mcp/spoonjoy-tools.server.test.ts test/lib/spoonjoy-api-spoons.test.ts`, and targeted browser smoke for no-photo recipe placeholder, provenance badge, cover history, first chef text-only spoon, first chef photo auto-cover, later chef opt-in cover, and verbatim cover selection. Clean disposable browser/test data in the same run.
**Output**: Validation logs and screenshots saved under `./2026-06-08-1648-doing-recipe-cover-lifecycle/`.
**Acceptance**: All validation commands pass with no warnings; browser smoke confirms no broken placeholder, sideways image regression, or overlapping cover controls.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Preserve red-test evidence for each `Xa` phase in artifacts, but do not commit intentionally failing tests by themselves. Commit after the paired `Xb` implementation is green, and after each `Xc` coverage/refactor phase, with focused messages.
- Push after each full unit group is complete (`Unit Xc`), and after Unit 13 validation completes.
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-08-1648-doing-recipe-cover-lifecycle/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-08 17:00 Created from planning doc
- 2026-06-08 17:03 Addressed granularity review findings by splitting large units
- 2026-06-08 17:04 Granularity pass converged
- 2026-06-08 17:11 Added Open Graph route and API v1 OpenAPI targets after validation review
- 2026-06-08 17:13 Validation pass converged
- 2026-06-08 17:17 Pinned schema, UI, automation, and MCP contracts after ambiguity review
- 2026-06-08 17:21 Resolved sourceType, pagination, idempotency, and commit-boundary ambiguity
- 2026-06-08 17:25 Resolved no-cover auto-seed and idempotency in-flight ambiguity
- 2026-06-08 17:27 Ambiguity pass converged
- 2026-06-08 17:28 Quality pass converged
- 2026-06-08 17:35 Added missing writer/read paths, legacy MCP write coverage, D1 migration coverage, and API v1 provenance fields after Tinfoil scrutiny
- 2026-06-08 17:38 Added recipe new/edit route, seed, import MCP, and fork MCP coverage after Tinfoil confirmation
- 2026-06-08 17:42 Tinfoil scrutiny converged
- 2026-06-08 17:49 Moved docs to spoonjoy/tasks, renamed branch, and addressed Stranger With Candy findings
- 2026-06-08 17:52 Stranger With Candy scrutiny converged; doing doc ready for execution
- 2026-06-08 17:55 Unit 0 complete: inventoried recipe cover read/write paths
- 2026-06-08 17:59 Fixed Unit 0 placeholder inventory after reviewer finding
- 2026-06-08 18:03 Unit 0 review converged
- 2026-06-08 18:17 Unit 1a/1b complete: added red tests for explicit active-cover schema/helper behavior, implemented Prisma and D1 migrations plus active cover helpers, and validated with targeted tests (`unit-1a-red-tests.log`, `unit-1b-green-attempt-1.log`), Prisma validate/generate, and build (`unit-1b-build.log`)
- 2026-06-08 18:24 Fixed Unit 1 review findings: migration tests now apply both root D1 and Prisma migration SQL, active-cover archive rejects self-replacement, and validation passed with `unit-1-review-fix-red.log`, `unit-1-review-fix-green.log`, and `unit-1-review-fix-build.log`
- 2026-06-08 18:25 Unit 1 review converged after Round 2
- 2026-06-08 18:31 Unit 1c complete: added runtime validation and edge coverage for invalid cover lifecycle strings, failed/archived states, replacement archive sequencing, unknown provenance labels, and D1-safe helper writes; targeted tests passed (`unit-1c-green.log`), build passed (`unit-1c-build.log`), and `recipe-cover.server.ts` reached 100% coverage (`unit-1c-coverage.log`)
- 2026-06-08 18:32 Unit 1c review converged
- 2026-06-08 18:41 Unit 2a complete: added failing web read-surface tests for active cover provenance, intentional placeholders, and nested cookbook/profile/search cover display (`unit-2a-red.log`)
- 2026-06-08 18:52 Unit 2b complete: web recipe, profile, kitchen, cookbook, and search surfaces now use explicit active-cover display data and render provenance badges; targeted tests passed (`unit-2b-green.log`) and production build passed (`unit-2b-build.log`)
- 2026-06-08 18:56 Unit 2c complete: targeted coverage passed for the web read-surface slice with new badge/header/grid/cookbook/search/index/profile branches at 100% (`unit-2c-coverage.log`); production build passed (`unit-2c-build.log`). The first strict coverage attempt (`unit-2c-coverage-attempt-1.log`) hit unrelated repo-wide baseline thresholds, not uncovered Unit 2 code.
- 2026-06-08 19:03 Fixed Unit 2 review findings: production search documents now store active-cover provenance metadata, and cookbook detail passes provenance into `CookbookCoverArt`; review-fix red/green, expanded Unit 2 targeted tests, and build passed (`unit-2-review-fix-red.log`, `unit-2-review-fix-green.log`, `unit-2-review-fix-targeted.log`, `unit-2-review-fix-build.log`)
- 2026-06-08 19:10 Fixed Unit 2 Round 2 review finding: search freshness fingerprint now hashes active cover selection plus source/status/archive/display fields, so provenance-only and D1-style active-variant changes refresh indexed `imageUrl` and `coverProvenanceLabel`; red/green, expanded targeted tests, and build passed (`unit-2-round2-fix-red.log`, `unit-2-round2-fix-green.log`, `unit-2-round2-fix-targeted.log`, `unit-2-round2-fix-build.log`)
- 2026-06-08 19:10 Unit 2 review converged after Round 3
- 2026-06-08 19:28 Unit 3a/3b/3c complete: added red tests for API v1 recipe/cookbook responses, OpenAPI schemas/examples, search cover metadata, and OG active-cover image selection (`unit-3a-red.log`); implemented active-cover display/provenance fields and regenerated the API playground; targeted tests passed (`unit-3b-green.log`), coverage passed with touched search/OG/OpenAPI files at 100% and changed API lines covered (`unit-3c-coverage.log`), and builds passed (`unit-3b-build.log`, `unit-3c-build.log`).
- 2026-06-08 19:48 Fixed Unit 3 review findings: API provenance now nulls when the active image URL is not publicly displayable, API/OG loaders fetch only the scoped active cover candidate through shared cover helpers, and dynamic OG responses emit active-cover-derived freshness headers; targeted tests, coverage, and build passed (`unit-3-review-fix-green.log`, `unit-3-review-fix-coverage.log`, `unit-3-review-fix-build.log`).
- 2026-06-08 20:01 Fixed Unit 3 Round 2 review findings: updated the API recipe-list query mock for active-cover selects and preserved legacy MCP `create_recipe`/`update_recipe` upload behavior by activating the uploaded cover after stylization; focused and targeted suites plus build passed (`unit-3-round2-fix-green.log`, `unit-3-round2-fix-targeted.log`, `unit-3-round2-fix-build.log`).
