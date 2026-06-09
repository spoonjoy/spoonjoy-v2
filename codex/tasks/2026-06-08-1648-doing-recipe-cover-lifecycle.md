# Doing: Recipe Cover Lifecycle

**Status**: drafting
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

### ⬜ Unit 0: Setup/Research
**What**: Inventory every active-cover read/write path before editing: `prisma/schema.prisma`, `app/lib/recipe-cover.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/lib/recipe-detail.server.ts`, `app/lib/recipe-spoon.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/search.server.ts`, `app/lib/recipe-fork.server.ts`, `app/lib/recipe-import.server.ts`, `app/routes/recipes.$id.tsx`, `app/routes/recipes._index.tsx`, `app/routes/_index.tsx`, `app/routes/users.$identifier.tsx`, `app/routes/cookbooks.$id.tsx`, `app/routes/og.recipes.$id.png.tsx`, `app/routes/og.cookbooks.$id.png.tsx`, `app/components/recipe/RecipeHeader.tsx`, `app/components/recipe/SpoonDialog.tsx`, `app/components/pantry/RecipeGrid.tsx`, `app/components/cookbook/CookbookCoverArt.tsx`, and `app/lib/og-image.server.tsx`.
**Output**: Notes saved under `./2026-06-08-1648-doing-recipe-cover-lifecycle/cover-read-write-inventory.md`.
**Acceptance**: Inventory lists each read/write path, the current behavior, and the unit that will change or intentionally leave it.

### ⬜ Unit 1a: Active Cover Schema And Helpers — Tests
**What**: Add failing tests for explicit active-cover state, active variant selection, provenance derivation, archive filtering, newest ready/non-empty backfill semantics, and intentional no-cover state. Target `test/lib/recipe-cover.server.test.ts`, `test/models/recipe-cover.test.ts`, migration tests under `test/scripts/`, and any existing route/API tests that assert newest-row behavior.
**Acceptance**: New and updated tests fail because `Recipe.activeCoverId`, active variant selection, cover status/provenance, archive behavior, and backfill support do not exist yet.

### ⬜ Unit 1b: Active Cover Schema And Helpers — Implementation
**What**: Add migrations and Prisma schema fields for explicit active cover selection. Use nullable `Recipe.activeCoverId`, an active variant field for verbatim vs editorialized display, and a recipe cover state/mode that can represent automatic, manual, and intentional no-cover states. Extend `RecipeCover` with status/provenance fields needed for pure AI, uploaded, imported, and editorialized-photo distinctions. Update `app/lib/recipe-cover.server.ts` with create/list/set/archive helpers, provenance formatting, active URL selection, and safe newest ready/non-empty backfill support.
**Acceptance**: Unit 1a tests pass, Prisma validation/generation succeeds, and no helper falls back to newest-row selection except the explicit migration/backfill helper.

### ⬜ Unit 1c: Active Cover Schema And Helpers — Coverage & Refactor
**What**: Refactor helper names/types for clarity, add edge-case coverage for empty URLs, archived covers, failed covers, missing active cover rows, inactive editorial variants, and D1-compatible non-interactive write sequences.
**Acceptance**: Cover helper/model/migration tests pass with 100% coverage on new helper branches and no warnings.

### ⬜ Unit 2a: Recipe Page And Listing Read Surfaces — Tests
**What**: Add failing tests proving recipe detail, recipe index, home, profile, cookbook pages, `RecipeHeader`, `RecipeGrid`, and `CookbookCoverArt` use explicit active covers and render provenance badges. Include newest empty row, archived newest row, active older cover, and intentional no-cover cases.
**Acceptance**: Tests fail because these surfaces still use ordered covers or lack provenance badges.

### ⬜ Unit 2b: Recipe Page And Listing Read Surfaces — Implementation
**What**: Update recipe/detail/index/home/profile/cookbook loaders and components to fetch/use active cover helper output. Add compact public provenance badges for pure AI, uploaded verbatim, imported, and editorialized-photo covers.
**Acceptance**: Unit 2a tests pass and no listed web surface displays an archived/empty newest row.

### ⬜ Unit 2c: Recipe Page And Listing Read Surfaces — Coverage & Refactor
**What**: Consolidate duplicate cover props for web surfaces, keep null/no-cover states intentional, and cover badge rendering branches.
**Acceptance**: Affected web route/component tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 3a: API v1, Search, And Open Graph Read Surfaces — Tests
**What**: Add failing tests proving `app/lib/api-v1.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/lib/search.server.ts`, `app/routes/og.recipes.$id.png.tsx`, and `app/routes/og.cookbooks.$id.png.tsx` use explicit active covers and include/derive correct provenance metadata. Include active older cover, archived newest row, empty newest row, and intentional no-cover cases.
**Acceptance**: Tests fail because these server surfaces still derive cover output from ordered cover arrays or lack provenance.

### ⬜ Unit 3b: API v1, Search, And Open Graph Read Surfaces — Implementation
**What**: Replace newest-row cover selection in API v1, API v1 OpenAPI schemas/examples, search metadata, and Open Graph route output with active-cover helper output. Ensure search metadata updates when active cover or active variant changes.
**Acceptance**: Unit 3a tests pass and server read surfaces agree on active cover URL/provenance.

### ⬜ Unit 3c: API v1, Search, And Open Graph Read Surfaces — Coverage & Refactor
**What**: Refactor shared server cover formatting to avoid drift between API v1, search, and OG paths.
**Acceptance**: Affected server tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 4a: Recipe New/Edit And Placeholder Mutations — Tests
**What**: Add failing tests for new recipe creation without photo, recipe upload assignment, recipe clear-image behavior, pure AI placeholder generation, verbatim uploaded active cover selection, manual cover mode, intentional no-cover mode, and PostHog capture on placeholder failure.
**Acceptance**: Tests fail because these mutations/jobs create rows without explicit active state, provenance, or manual replacement checks.

### ⬜ Unit 4b: Recipe New/Edit And Placeholder Mutations — Implementation
**What**: Update recipe new/edit/clear-image and placeholder generation flows to create covers with status/provenance, activate them through helpers, support verbatim active uploads, and prevent placeholder jobs from replacing manual covers.
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
**What**: Update stylization/generation jobs to record status/provenance, re-check active-cover state before activation, preserve manual selections, and return failure states usable by UI/MCP.
**Acceptance**: Unit 6a tests pass and async jobs cannot silently replace a manually selected active cover.

### ⬜ Unit 6c: Stylization Jobs, Races, And Telemetry — Coverage & Refactor
**What**: Refactor shared generation status and telemetry helpers; cover success, failure, timeout, missing bucket, and stale-job branches.
**Acceptance**: Generation/job tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 7a: Spoon Backend And Dialog Flow — Tests
**What**: Add failing tests for optional first chef spoon photo, first chef photo auto-seed only when no active real cover exists, later chef spoon explicit cover opt-in, non-owner spoon photos never auto-update recipe cover, and preservation of upload progress/disabled submit behavior.
**Acceptance**: Tests fail because current backend requires first chef photo and current dialog lacks cover opt-in controls.

### ⬜ Unit 7b: Spoon Backend And Dialog Flow — Implementation
**What**: Update `app/lib/recipe-spoon.server.ts`, `app/lib/recipe-detail.server.ts`, `app/routes/recipes.$id.tsx`, and `SpoonDialog` so first chef spoon photo is optional, first chef photo auto-seeds through helpers only when allowed, later chef spoon cover creation requires explicit form input, and posting stays disabled while uploading.
**Acceptance**: Unit 7a tests pass and non-owner users cannot invoke owner cover behavior through spoon creation.

### ⬜ Unit 7c: Spoon Backend And Dialog Flow — Coverage & Refactor
**What**: Refactor spoon-cover decision logic into tested helpers and cover invalid form inputs, missing photo, invalid photo, owner/non-owner, and existing active-cover cases.
**Acceptance**: Spoon backend/dialog tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 8a: Owner Cover History UI — Tests
**What**: Add failing route/component tests for owner-only cover history browsing on recipe pages: current badge, provenance labels, source thumbnails, active variant labels, set-active action, no-cover state, and non-owner hidden state.
**Acceptance**: Tests fail because owner cover history UI does not exist.

### ⬜ Unit 8b: Owner Cover History UI — Implementation
**What**: Add focused recipe cover history components and route actions for browsing covers and setting the active cover/variant. Keep controls accessible, stable in size, and visually consistent with existing Spoonjoy surfaces.
**Acceptance**: Unit 8a tests pass and owner can swap between retained covers including verbatim and editorialized variants.

### ⬜ Unit 8c: Owner Cover History UI — Coverage & Refactor
**What**: Cover empty, loading, failed, archived, long-title, and mobile layout states without overlapping text or nested cards.
**Acceptance**: Cover history UI tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 9a: Spoon Image Picker, Regeneration, And Archive UI — Tests
**What**: Add failing route/component tests for browsing recipe spoon photos as cover sources, generating an editorial cover from a selected spoon/upload, regenerating a cover, archiving a cover, and requiring explicit replacement/no-cover choice when archiving the active cover.
**Acceptance**: Tests fail because source picker, regeneration, and archive controls do not exist.

### ⬜ Unit 9b: Spoon Image Picker, Regeneration, And Archive UI — Implementation
**What**: Add owner-only source picker, regenerate action, archive action, and active-cover removal confirmation. Use server helpers from earlier units and keep destructive R2 cleanup behind explicit safe paths.
**Acceptance**: Unit 9a tests pass and active-cover archive never silently selects a replacement.

### ⬜ Unit 9c: Spoon Image Picker, Regeneration, And Archive UI — Coverage & Refactor
**What**: Cover source spoon deleted, no spoon photos, archived source cover, failed generation retry, and permission-denied states.
**Acceptance**: Picker/regeneration/archive UI tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 10a: MCP Cover And Spoon Image Read Operations — Tests
**What**: Add failing MCP tests for `list_recipe_covers`, `list_recipe_spoon_images`, and active cover/provenance fields on existing recipe/spoon responses. Cover read scopes, ownership visibility, archived inclusion flags, pagination, and no-cover state.
**Acceptance**: Tests fail because explicit cover/spoon image browse operations and response metadata do not exist.

### ⬜ Unit 10b: MCP Cover And Spoon Image Read Operations — Implementation
**What**: Implement read-only MCP operations and shared payload formatting in `app/lib/spoonjoy-api.server.ts`, register annotations, and expose cover provenance/status/variant metadata in existing recipe/spoon outputs.
**Acceptance**: Unit 10a tests pass and MCP can browse all covers for a recipe plus all recipe spoon images.

### ⬜ Unit 10c: MCP Cover And Spoon Image Read Operations — Coverage & Refactor
**What**: Refactor cover payload formatting and cover auth/visibility helpers for reuse by write operations.
**Acceptance**: MCP read tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 11a: MCP Cover Create, Regenerate, And Status Operations — Tests
**What**: Add failing MCP tests for `create_recipe_cover_from_upload`, `create_recipe_cover_from_spoon`, `regenerate_recipe_cover`, and `get_cover_generation_status`. Cover idempotency keys, dry-run behavior, explicit activation flags, provider failure, invalid source image, and `createdCover`/`generationStatus` payloads.
**Acceptance**: Tests fail because create/regenerate/status operations do not exist.

### ⬜ Unit 11b: MCP Cover Create, Regenerate, And Status Operations — Implementation
**What**: Implement MCP create/regenerate/status operations using shared cover helpers and generation jobs. Preserve upload tools and require explicit activation for existing active-cover replacement.
**Acceptance**: Unit 11a tests pass and MCP can generate candidates without hidden active-cover replacement.

### ⬜ Unit 11c: MCP Cover Create, Regenerate, And Status Operations — Coverage & Refactor
**What**: Cover auth, validation, idempotency, dry-run, failed generation, and successful generation branches.
**Acceptance**: MCP create/regenerate/status tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 12a: MCP Active Cover Set And Archive Operations — Tests
**What**: Add failing MCP tests for `set_active_recipe_cover` and `archive_recipe_cover`. Cover ownership, explicit previous/next active cover payloads, active variant selection, no-cover confirmation, archived cover rejection, and safe deletion warnings/nextActions.
**Acceptance**: Tests fail because explicit activation/archive MCP operations do not exist.

### ⬜ Unit 12b: MCP Active Cover Set And Archive Operations — Implementation
**What**: Implement MCP active-cover mutation and archive operations, update unknown-argument handling and annotations, and return `activeCover`, `previousActiveCover`, `warnings`, and `nextActions`.
**Acceptance**: Unit 12a tests pass and MCP active-cover mutation is explicit and permission checked.

### ⬜ Unit 12c: MCP Active Cover Set And Archive Operations — Coverage & Refactor
**What**: Cover destructive hints, idempotent archive calls, no-cover confirmation, active variant edge cases, and attempts by non-owners.
**Acceptance**: MCP set/archive tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 13: Final Validation And Browser Smoke
**What**: Run full validation after all feature units are green: `pnpm run test:coverage`, `pnpm run test:e2e`, `pnpm run deploy:preflight`, and targeted browser smoke for no-photo recipe placeholder, provenance badge, cover history, first chef text-only spoon, first chef photo auto-cover, later chef opt-in cover, verbatim cover selection, and MCP cover browsing through available harnesses.
**Output**: Validation logs and screenshots saved under `./2026-06-08-1648-doing-recipe-cover-lifecycle/`.
**Acceptance**: All validation commands pass with no warnings; browser smoke confirms no broken placeholder, sideways image regression, or overlapping cover controls.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
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
