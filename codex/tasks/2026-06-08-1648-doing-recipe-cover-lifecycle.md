# Doing: Recipe Cover Lifecycle

**Status**: drafting
**Execution Mode**: direct
**Created**: pending initial commit
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
**What**: Inventory every active-cover read/write path before editing: `prisma/schema.prisma`, `app/lib/recipe-cover.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/recipe-detail.server.ts`, `app/lib/recipe-spoon.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/search.server.ts`, `app/lib/recipe-fork.server.ts`, `app/lib/recipe-import.server.ts`, `app/routes/recipes.$id.tsx`, `app/routes/recipes._index.tsx`, `app/routes/_index.tsx`, `app/routes/users.$identifier.tsx`, `app/routes/cookbooks.$id.tsx`, `app/components/recipe/RecipeHeader.tsx`, `app/components/recipe/SpoonDialog.tsx`, `app/components/pantry/RecipeGrid.tsx`, `app/components/cookbook/CookbookCoverArt.tsx`, and Open Graph helpers.
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

### ⬜ Unit 2a: Existing Web/API Read Surfaces — Tests
**What**: Add failing tests proving recipe detail, recipe index, home, profile, cookbook, search, API v1, public API/MCP formatting, and Open Graph output use explicit active covers and expose provenance badges/metadata. Include tests where the newest cover row is empty or archived but an older ready cover is active.
**Acceptance**: Tests fail because those surfaces still depend on ordered covers or lack provenance output.

### ⬜ Unit 2b: Existing Web/API Read Surfaces — Implementation
**What**: Update loaders, formatters, and components to fetch/use explicit active cover data. Replace `getRecipeCoverImageUrl` newest-row usage in recipe/detail/index/profile/cookbook/search/API v1/MCP/Open Graph paths with active-cover helper output. Add compact provenance badge rendering to public recipe cards/pages and owner-aware metadata where needed.
**Acceptance**: Unit 2a tests pass, no active surface displays an archived/empty newest row, and provenance labels render for pure AI, uploaded verbatim, imported, and editorialized-photo covers.

### ⬜ Unit 2c: Existing Web/API Read Surfaces — Coverage & Refactor
**What**: Consolidate duplicate cover formatting into shared server helpers where appropriate, keep client props narrow, and verify null/no-cover states remain intentional across all public surfaces.
**Acceptance**: Full affected route/component/API tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 3a: Cover Creation Jobs And Recipe Mutations — Tests
**What**: Add failing tests for new recipe creation, recipe edit image upload/clear, import cover creation, fork cover copying, AI placeholder generation, spoon cover stylization, and job completion races. Cover the rules that pure AI placeholders are provisional, manual cover choice blocks auto-replacement, verbatim upload can be active without editorial generation, and failures record user/API-visible status plus PostHog exception capture.
**Acceptance**: Tests fail because current mutations/jobs create cover rows without explicit active selection, provenance, status, or manual replacement checks.

### ⬜ Unit 3b: Cover Creation Jobs And Recipe Mutations — Implementation
**What**: Update recipe new/edit/import/fork/stylization/placeholder flows to create cover records with status/provenance and activate them only through explicit helper rules. Ensure pending placeholder/import/stylization jobs re-check active-cover state before activation. Preserve current image provider telemetry and PostHog exception capture.
**Acceptance**: Unit 3a tests pass and background job completion cannot override a manually selected active cover.

### ⬜ Unit 3c: Cover Creation Jobs And Recipe Mutations — Coverage & Refactor
**What**: Refactor duplicate activation/provenance logic into shared helpers and cover error paths for failed generation, missing bucket, missing source image, and manual no-cover mode.
**Acceptance**: Affected server tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 4a: Spoon Flow And Owner Cover UI — Tests
**What**: Add failing component/route tests for optional first chef spoon photo, owner-only cover opt-in on later spoon photos, upload progress/disabled submit preservation, cover history browsing, spoon image browsing, verbatim uploaded active cover selection, editorial generation/regeneration, archive/remove behavior, and provenance badge display on recipe header/cards.
**Acceptance**: Tests fail because current UI requires first chef photo and lacks cover opt-in/history/browser controls.

### ⬜ Unit 4b: Spoon Flow And Owner Cover UI — Implementation
**What**: Update `SpoonDialog` and route actions so first chef spoon photo is optional, first chef spoon with photo auto-seeds only when no active real cover exists, later chef spoon photos can explicitly request cover creation, and submit/upload progress remains disabled while posting. Add owner cover management UI on recipe pages with current badge, provenance labels, source thumbnails, verbatim/editorial controls, set-active action, regenerate action, archive/remove action, and spoon image picker.
**Acceptance**: Unit 4a tests pass and non-owner users cannot see or invoke owner cover controls.

### ⬜ Unit 4c: Spoon Flow And Owner Cover UI — Coverage & Refactor
**What**: Refactor cover UI into focused components with stable dimensions and accessible controls, keep visual styling consistent with existing Spoonjoy components, and test empty/loading/error states.
**Acceptance**: Component and route tests pass with 100% coverage on new UI branches and no warnings.

### ⬜ Unit 5a: MCP Cover And Spoon Image Operations — Tests
**What**: Add failing MCP tests for `list_recipe_covers`, `list_recipe_spoon_images`, `create_recipe_cover_from_upload`, `create_recipe_cover_from_spoon`, `set_active_recipe_cover`, `regenerate_recipe_cover`, `archive_recipe_cover`, and `get_cover_generation_status`. Cover scopes, ownership, idempotency keys, dry-run behavior, explicit activation, no hidden replacement on `create_spoon`, and response payloads containing `activeCover`, `createdCover`, `previousActiveCover`, `generationStatus`, `warnings`, and `nextActions`.
**Acceptance**: Tests fail because the operations and response fields do not exist yet.

### ⬜ Unit 5b: MCP Cover And Spoon Image Operations — Implementation
**What**: Implement MCP/API cover operations in `app/lib/spoonjoy-api.server.ts`, register annotations, update unknown-argument handling, and expose active cover/provenance metadata in existing recipe/spoon responses. Preserve existing upload tools and make active-cover mutation explicit through `set_active_recipe_cover`.
**Acceptance**: Unit 5a tests pass and MCP tooling can browse both all recipe covers and all recipe spoon images cleanly.

### ⬜ Unit 5c: MCP Cover And Spoon Image Operations — Coverage & Refactor
**What**: Consolidate MCP cover payload formatting, document operation behavior in tests, and cover auth/permission/error branches.
**Acceptance**: MCP tests pass with 100% coverage on new branches and no warnings.

### ⬜ Unit 6a: End-To-End And Regression Coverage — Tests
**What**: Add or update e2e tests for no-photo recipe placeholder, first chef text-only spoon, first chef spoon photo auto-cover, later chef spoon opt-in cover update, cover history swap-back, verbatim upload active cover, provenance badge visibility, and MCP cover browsing/activation where e2e harness supports it.
**Acceptance**: New e2e tests fail before final implementation wiring is complete.

### ⬜ Unit 6b: End-To-End And Regression Coverage — Implementation
**What**: Finish any remaining app wiring needed for e2e flows, update test fixtures/factories, ensure local data cleanup avoids Codex-created recipes, and verify Cloudflare/D1-compatible behavior.
**Acceptance**: Unit 6a tests pass locally.

### ⬜ Unit 6c: End-To-End And Regression Coverage — Coverage & Refactor
**What**: Run full validation: unit coverage, e2e suite, build/preflight, and targeted manual browser smoke for owner cover management. Fix warnings, coverage gaps, visual overlap, or route regressions found during validation.
**Acceptance**: `pnpm run test:coverage`, `pnpm run test:e2e`, and `pnpm run deploy:preflight` pass with no warnings; manual browser smoke confirms no broken placeholder or provenance/control overlap.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-08-1648-doing-recipe-cover-lifecycle/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- pending initial commit Created from planning doc
