# Doing: Clem Feedback E2E

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-07-14 13:26
**Planning**: ./2026-07-14-1313-planning-clem-feedback-e2e.md
**Artifacts**: ./2026-07-14-1313-doing-clem-feedback-e2e/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts only when the user explicitly requested interactive per-unit approval; otherwise convert this to `spawn` or `direct` unless a hard exception is present
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Turn Clem's feedback into shipped Spoonjoy product primitives: reliable live cooking continuity across devices, correct shopping-list behavior, usable recipe organization, and neutral API metadata while explicitly rejecting first-party import UI and Pebble-specific work.

## Upstream Work Items
- None

## Completion Criteria
- [ ] Reliability gate identifies the canonical QA/prod smoke commands, confirms cleanup safety, and passes or records a true credential/capability blocker.
- [ ] Shopping-list clear/remove then re-add of the same recipe restores only the newly requested quantity across web, REST API v1, and MCP.
- [ ] Active shopping-list duplicate adds still merge quantities consistently and keep ordering/check-state behavior tested.
- [ ] Logged-in cook progress syncs across two clients through a Durable Object-backed session; anonymous cook progress remains local-only.
- [ ] Cook-session snapshot `GET`, revision-checked `PATCH`, completion mutation, and WebSocket subscription contracts are tested.
- [ ] Cook-session completion is idempotent, creates/updates cook history, clears active resume state, and tolerates DO-to-D1 retry after transient failure.
- [ ] Recipe edits during an active cook session are detected and do not silently remap progress to different steps or ingredients.
- [ ] Scaling persists in cook sessions and API projections expose original quantities plus scaled structured quantities without mutating recipe data.
- [ ] Saved recipes are private, distinct from cookbook membership, and appear on recipe detail, `/saved-recipes`, My Kitchen, search, and authenticated API responses.
- [ ] Existing cookbook-derived saved recipes are preserved through migration/interop tests.
- [ ] Accepted typed recipe tags power at least one user-facing filter/search path, search-index path, and API response path.
- [ ] API responses and OpenAPI/playground docs expose step count, normalized source display name, tags/course data, authenticated saved state, and scaling semantics.
- [ ] Import feedback is explicitly rejected in product UI and documented as agentic/API-only.
- [ ] No Pebble-specific behavior is introduced.
- [ ] My Kitchen/navigation updates surface Continue Cooking, Your Recipes, Saved Recipes, Cookbooks, and Tags without destabilizing the mobile dock.
- [ ] Visual QA evidence is captured for changed UI surfaces.
- [ ] Live/manual smoke data is disposable, named according to repo rules, and cleaned up in the same run.
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
**What**: Verify the branch/worktree, install/runtime state, route inventory, migration pattern, smoke command safety, and exact current behavior before code changes.
**Output**: Artifact notes in `./2026-07-14-1313-doing-clem-feedback-e2e/unit-0-research.md` covering smoke commands, existing saved-recipes route semantics, search index touch points, Durable Object wiring requirements, and cleanup constraints.
**Acceptance**: Notes cite exact files/commands and classify any credential/capability blocker before implementation units start.

### ⬜ Unit 1a: Shopping List Canonical Mutations — Tests
**What**: Write failing tests for shared shopping-list add/restore semantics across route helper behavior, REST API v1 add-from-recipe, MCP `add_recipe_to_shopping_list`, manual add, deleted tombstone restore, checked restore, active duplicate merge, sort order, and category/icon retention.
**Output**: Tests in `test/lib/shopping-list-mutations.server.test.ts`, `test/routes/api-v1-shopping-mutations.test.ts`, `test/routes/api-v1-shopping-d1.test.ts`, `test/lib/mcp/spoonjoy-tools.server.test.ts`, and route-level tests covering `app/lib/shopping-list.server.ts` behavior.
**Acceptance**: Targeted tests fail because deleted rows currently add stale quantities or web/API/MCP behavior differs.

### ⬜ Unit 1b: Shopping List Canonical Mutations — Implementation
**What**: Add a shared server mutation helper and route API/MCP/web shopping-list add flows through it.
**Output**: Shared helper under `app/lib/`, updated `app/lib/shopping-list.server.ts`, `app/lib/api-v1.server.ts`, and `app/lib/spoonjoy-api.server.ts`.
**Acceptance**: Unit 1a tests pass; active duplicate rows merge; deleted rows restore to requested quantity only; checked/deleted rows move to the end unchecked.

### ⬜ Unit 1c: Shopping List Canonical Mutations — Coverage & Refactor
**What**: Run targeted coverage/build for shopping-list changes, refactor duplication, and verify no warnings.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck commands.
**Acceptance**: 100% coverage on new helper code, targeted tests pass, build/typecheck clean.

### ⬜ Unit 2a: Base API Metadata And Scaling Projection — Tests
**What**: Write failing tests for REST API recipe detail/list/OpenAPI/playground fields that do not depend on later primitives: `stepCount`, normalized `sourceDisplayName`, yield/servings validation behavior, and scale projection that returns original plus scaled structured quantities without mutating stored ingredients.
**Output**: Tests in `test/routes/api-v1-recipes.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/docs/developer-platform-docs.test.ts`, and supporting lib tests as needed.
**Acceptance**: Tests fail on missing fields or scaling projection behavior.

### ⬜ Unit 2b: Base API Metadata And Scaling Projection — Implementation
**What**: Implement API-neutral metadata and scale projection in API v1 response builders, OpenAPI schema, generated playground data, and developer docs without Pebble-specific language.
**Output**: Updated `app/lib/api-v1.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/lib/generated/api-v1-playground.ts` via generator, API docs routes, and related helpers.
**Acceptance**: Unit 2a tests pass and stored recipe ingredient quantities remain unchanged after scaled reads.

### ⬜ Unit 2c: Base API Metadata And Scaling Projection — Coverage & Refactor
**What**: Run targeted API/OpenAPI tests, generated playground check, coverage, and build/typecheck.
**Output**: Logs in artifacts for API tests, OpenAPI generation, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new API helper code, docs generation stable, no warnings.

### ⬜ Unit 3a: Cook Session D1 Index And Migrations — Tests
**What**: Write failing tests for the cook-session index schema, active-session uniqueness, history fields, migration presence in `migrations/` and `prisma/migrations/`, and index helper create/update/complete queries.
**Output**: Tests in `test/models/cook-session-index.test.ts`, `test/lib/cook-session-index.server.test.ts`, and migration/config tests.
**Acceptance**: Tests fail because no cook-session index schema, migrations, or helper exists.

### ⬜ Unit 3b: Cook Session D1 Index And Migrations — Implementation
**What**: Add the D1/Prisma cook-session index model, migrations, and helper functions for active lookup, metadata update, completion marking, and pending completion state.
**Output**: Updated `prisma/schema.prisma`, `migrations/`, `prisma/migrations/`, new `app/lib/cook-session-index.server.ts`, and generated Prisma artifacts if required.
**Acceptance**: Unit 3a tests pass; D1 stores queryable metadata/history only, not the live checklist source of truth.

### ⬜ Unit 3c: Cook Session D1 Index And Migrations — Coverage & Refactor
**What**: Run targeted cook-session index tests, migration validation, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, migration checks, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new index helper code, no warnings.

### ⬜ Unit 4a: Durable Object State And Revision Core — Tests
**What**: Write failing tests for pure cook-session state normalization, snapshot serialization, revision-checked patching, stale revision rejection, bounds checking, recipe fingerprint mismatch detection, and empty/null edge cases.
**Output**: Tests in `test/lib/cook-session-state.server.test.ts`.
**Acceptance**: Tests fail because no cook-session state core exists.

### ⬜ Unit 4b: Durable Object State And Revision Core — Implementation
**What**: Implement pure state helpers and the Durable Object in-memory/storage state core without HTTP route or UI integration.
**Output**: New cook-session state module and initial Durable Object class internals.
**Acceptance**: Unit 4a tests pass; state changes are revisioned and fingerprint-aware.

### ⬜ Unit 4c: Durable Object State And Revision Core — Coverage & Refactor
**What**: Run targeted state tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new state code, no warnings.

### ⬜ Unit 5a: Durable Object Binding And HTTP Contracts — Tests
**What**: Write failing tests for Wrangler Durable Object binding/migration in production and QA, Env binding shape, Worker export, session snapshot `GET`, revision-checked `PATCH`, auth rejection, ownership checks, and invalid payload errors.
**Output**: Tests in `test/config/wrangler-durable-objects.test.ts`, `test/workers/cook-session-do.test.ts`, and route contract tests.
**Acceptance**: Tests fail because no binding/export/contracts exist.

### ⬜ Unit 5b: Durable Object Binding And HTTP Contracts — Implementation
**What**: Configure the Durable Object binding/migration, export the class from `workers/app.ts`, update Env types, and add authenticated cook-session HTTP contracts.
**Output**: Updated `wrangler.json`, `app/cloudflare-env.d.ts`, `workers/app.ts`, and cook-session route modules/libs.
**Acceptance**: Unit 5a tests pass; top-level and QA Wrangler envs both define the binding/migration.

### ⬜ Unit 5c: Durable Object Binding And HTTP Contracts — Coverage & Refactor
**What**: Run targeted config/worker/route tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new route/config helper code, no warnings.

### ⬜ Unit 6a: Cook Session Completion And Retry — Tests
**What**: Write failing tests for idempotent completion, RecipeSpoon creation/update, active resume clearing, pending completion retry after D1 failure, duplicate completion replay, and cleanup of completed sessions.
**Output**: Tests in cook-session route/lib suites and `test/models/recipe-spoon.test.ts` or existing spoon helper tests as needed.
**Acceptance**: Tests fail because completion/retry is not implemented.

### ⬜ Unit 6b: Cook Session Completion And Retry — Implementation
**What**: Implement completion mutation, DO-to-D1 handoff, pending retry path, RecipeSpoon history write, and active index cleanup.
**Output**: Updated cook-session DO/route/index helpers and spoon integration.
**Acceptance**: Unit 6a tests pass; transient D1 failure leaves retryable pending completion rather than losing state.

### ⬜ Unit 6c: Cook Session Completion And Retry — Coverage & Refactor
**What**: Run targeted completion tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on completion/retry branches, no warnings.

### ⬜ Unit 7a: Cook Session WebSocket Subscription — Tests
**What**: Write failing tests for WebSocket subscribe authorization, initial snapshot delivery, broadcast after accepted patch/completion, stale-client handling, and hibernation-safe attachment metadata.
**Output**: Tests in `test/workers/cook-session-do.test.ts` or equivalent DO WebSocket test suite.
**Acceptance**: Tests fail because no WebSocket subscription exists.

### ⬜ Unit 7b: Cook Session WebSocket Subscription — Implementation
**What**: Implement WebSocket subscription/broadcast on the Durable Object using hibernation-compatible APIs and fallback-safe state loading.
**Output**: Updated Durable Object class and tests.
**Acceptance**: Unit 7a tests pass; accepted patches broadcast snapshots to subscribed clients.

### ⬜ Unit 7c: Cook Session WebSocket Subscription — Coverage & Refactor
**What**: Run targeted WebSocket/DO tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new WebSocket handling code, no warnings.

### ⬜ Unit 8a: Recipe Cook Mode Server Source — Tests
**What**: Write failing tests for logged-in recipe cook mode loading server snapshots, applying revision conflicts, preserving anonymous localStorage fallback, and not using localStorage as logged-in canonical state.
**Output**: Tests in `test/routes/recipe-detail-cook-session.test.tsx` and client hook tests.
**Acceptance**: Tests fail because logged-in cook progress is still localStorage-only.

### ⬜ Unit 8b: Recipe Cook Mode Server Source — Implementation
**What**: Wire recipe cook mode to cook-session snapshot/patch/WebSocket contracts for logged-in users while retaining anonymous/local fallback.
**Output**: Updated `app/routes/recipes.$id.tsx`, new client cook-session hook/module, and route integration.
**Acceptance**: Unit 8a tests pass; logged-in progress reads/writes through server session.

### ⬜ Unit 8c: Recipe Cook Mode Server Source — Coverage & Refactor
**What**: Run targeted cook-mode UI tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new client/server cook-mode integration code, no warnings.

### ⬜ Unit 9a: Cook Session Adoption, Edit Warning, And Completion UI — Tests
**What**: Write failing tests for local-to-server adoption on login/current recipe open, newer-server-session precedence, recipe edit/fingerprint warning, completion button flow, and stale local fallback handling.
**Output**: Tests in recipe detail and hook suites.
**Acceptance**: Tests fail because adoption, edit warning, and completion UI are not wired.

### ⬜ Unit 9b: Cook Session Adoption, Edit Warning, And Completion UI — Implementation
**What**: Implement adoption rules, recipe-changed warning UI, completion action wiring, and local fallback cleanup.
**Output**: Updated recipe detail route/component/hook files.
**Acceptance**: Unit 9a tests pass; completion clears active cooking state and recipe edits do not silently remap progress.

### ⬜ Unit 9c: Cook Session Adoption, Edit Warning, And Completion UI — Coverage & Refactor
**What**: Run targeted tests, coverage, and build/typecheck for adoption/edit/completion UI.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on adoption/edit/completion branches, no warnings.

### ⬜ Unit 10a: My Kitchen Continue Cooking — Tests
**What**: Write failing tests for My Kitchen Continue Cooking cards sourced from D1 cook-session index, empty state behavior, completed-session removal, and mobile navigation stability.
**Output**: Tests in `test/routes/index-cook-session.test.tsx` and navigation/layout tests.
**Acceptance**: Tests fail because My Kitchen has no Continue Cooking section.

### ⬜ Unit 10b: My Kitchen Continue Cooking — Implementation
**What**: Surface active cook-session index rows on My Kitchen without destabilizing the mobile dock.
**Output**: Updated `app/routes/_index.tsx` and any helper/component files.
**Acceptance**: Unit 10a tests pass; Continue Cooking appears only for active sessions.

### ⬜ Unit 10c: My Kitchen Continue Cooking — Coverage & Refactor
**What**: Run targeted My Kitchen/navigation tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new My Kitchen code, no warnings.

### ⬜ Unit 10d: Cook Session UI — Visual QA Dogfood
**What**: Run `visual-qa-dogfood` on recipe cook mode and My Kitchen Continue Cooking across desktop/mobile.
**Output**: Screenshots, overflow metrics, and absurdity ledger in artifacts.
**Acceptance**: No ready visual issues remain; text/buttons do not overlap; mobile dock remains stable.

### ⬜ Unit 11a: SavedRecipe Data And Backfill — Tests
**What**: Write failing tests for `SavedRecipe` schema, uniqueness, migration presence, backfill from `RecipeInCookbook`, soft-delete or removal semantics, and preservation of existing cookbook-derived saved lists.
**Output**: Tests in `test/models/saved-recipe.test.ts`, migration tests, and `test/lib/saved-recipes.server.test.ts`.
**Acceptance**: Tests fail because `SavedRecipe` does not exist.

### ⬜ Unit 11b: SavedRecipe Data And Backfill — Implementation
**What**: Add `SavedRecipe` schema/migrations/backfill helper and canonical data access helpers.
**Output**: Updated Prisma/D1 migrations and new `app/lib/saved-recipes.server.ts`.
**Acceptance**: Unit 11a tests pass; existing cookbook-derived saved state is preserved.

### ⬜ Unit 11c: SavedRecipe Data And Backfill — Coverage & Refactor
**What**: Run targeted saved data/backfill tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new saved data/backfill code, no warnings.

### ⬜ Unit 12a: SavedRecipe Service And Cookbook Compatibility — Tests
**What**: Write failing tests for explicit save/unsave, cookbook-add ensuring saved state, cookbook-removal not being the only unsave path, idempotency, ownership checks, and no accidental author-follow behavior.
**Output**: Tests in saved service, recipe detail, and cookbook mutation suites.
**Acceptance**: Tests fail because compatibility service behavior does not exist.

### ⬜ Unit 12b: SavedRecipe Service And Cookbook Compatibility — Implementation
**What**: Implement explicit save/unsave service and cookbook-save compatibility updates.
**Output**: Updated saved service, recipe detail actions/loaders, cookbook save flows, and notification behavior if affected.
**Acceptance**: Unit 12a tests pass; SavedRecipe is canonical private saved state.

### ⬜ Unit 12c: SavedRecipe Service And Cookbook Compatibility — Coverage & Refactor
**What**: Run targeted service/cookbook tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new service/compat branches, no warnings.

### ⬜ Unit 13a: SavedRecipe Routes And UI — Tests
**What**: Write failing tests for `/saved-recipes` loader/UI using `SavedRecipe`, recipe detail saved controls, My Kitchen saved section, copy that distinguishes saved from cookbooks, and empty/query states.
**Output**: Tests in `test/routes/saved-recipes.test.tsx`, `test/routes/recipe-detail-saved.test.tsx`, and My Kitchen route tests.
**Acceptance**: Tests fail because UI still derives saved state from cookbook membership or lacks explicit saved controls.

### ⬜ Unit 13b: SavedRecipe Routes And UI — Implementation
**What**: Update `/saved-recipes`, recipe detail, and My Kitchen UI to use explicit SavedRecipe state.
**Output**: Updated `app/routes/saved-recipes.tsx`, `app/routes/recipes.$id.tsx`, `app/routes/_index.tsx`, and related components.
**Acceptance**: Unit 13a tests pass; saved controls are distinct from Save to Cookbook.

### ⬜ Unit 13c: SavedRecipe Routes And UI — Coverage & Refactor
**What**: Run targeted saved route/UI tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new saved route/UI code, no warnings.

### ⬜ Unit 13d: SavedRecipe Routes And UI — Visual QA Dogfood
**What**: Run `visual-qa-dogfood` on recipe detail saved controls, `/saved-recipes`, and My Kitchen saved sections.
**Output**: Screenshots, overflow metrics, and absurdity ledger in artifacts.
**Acceptance**: No ready visual issues remain; saved controls are reachable and not confused with cookbook membership.

### ⬜ Unit 14a: SavedRecipe Search And API — Tests
**What**: Write failing tests for saved recipe search index/private filtering, REST API authenticated `isSaved`, saved recipe listing if added, OpenAPI/playground fields, and MCP/API saved behavior if exposed.
**Output**: Tests in `test/lib/search.server.test.ts`, API/OpenAPI route tests, and MCP tests if the surface changes.
**Acceptance**: Tests fail because search/API do not read `SavedRecipe`.

### ⬜ Unit 14b: SavedRecipe Search And API — Implementation
**What**: Add SavedRecipe to search/API response paths and public docs without public saved-count metrics.
**Output**: Updated `app/lib/search.server.ts`, API response builders, OpenAPI docs, generated playground data, and developer docs.
**Acceptance**: Unit 14a tests pass; authenticated saved state is private and documented.

### ⬜ Unit 14c: SavedRecipe Search And API — Coverage & Refactor
**What**: Run targeted saved search/API tests, coverage, generator, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, generator, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new saved search/API code, no warnings.

### ⬜ Unit 15a: Typed Recipe Tags Data And Service — Tests
**What**: Write failing tests for tag schema, controlled tag types, course tags, custom tags, uniqueness, accepted/manual provenance, no AI suggestion tables in v1, and service validation.
**Output**: Tests in `test/models/recipe-tag.test.ts` and `test/lib/recipe-tags.server.test.ts`.
**Acceptance**: Tests fail because no recipe tag schema/services exist.

### ⬜ Unit 15b: Typed Recipe Tags Data And Service — Implementation
**What**: Add accepted/manual typed tags, schema/migrations, and service helpers.
**Output**: Updated Prisma/D1 migrations and new recipe tag service files.
**Acceptance**: Unit 15a tests pass; system course tags include main/side/appetizer/dessert.

### ⬜ Unit 15c: Typed Recipe Tags Data And Service — Coverage & Refactor
**What**: Run targeted tag data/service tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new tag service code, no warnings.

### ⬜ Unit 16a: Typed Recipe Tags Authoring UI — Tests
**What**: Write failing tests for recipe create/edit tag controls, validation errors, persisted accepted tags, and display on recipe detail/cards.
**Output**: Tests in recipe builder, recipe create/edit route, recipe detail, and card component suites.
**Acceptance**: Tests fail because tag authoring/display UI does not exist.

### ⬜ Unit 16b: Typed Recipe Tags Authoring UI — Implementation
**What**: Add tag controls and display surfaces to recipe authoring/detail/card UI using existing design patterns.
**Output**: Updated recipe builder/routes/components.
**Acceptance**: Unit 16a tests pass; tags can be manually accepted/edited without AI suggestion UI.

### ⬜ Unit 16c: Typed Recipe Tags Authoring UI — Coverage & Refactor
**What**: Run targeted tag UI tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new tag UI code, no warnings.

### ⬜ Unit 17a: Typed Recipe Tags Discovery And Search — Tests
**What**: Write failing tests for tag filters in My Kitchen/search/list surfaces, search-index metadata, query behavior, and empty states.
**Output**: Tests in search, recipe list, My Kitchen, and route/component suites.
**Acceptance**: Tests fail because tags do not power discovery.

### ⬜ Unit 17b: Typed Recipe Tags Discovery And Search — Implementation
**What**: Add tag filtering/search-index integration and user-facing discovery surfaces.
**Output**: Updated `app/lib/search.server.ts`, recipe/My Kitchen/search routes, and related components.
**Acceptance**: Unit 17a tests pass; accepted tags power at least one filter/search path.

### ⬜ Unit 17c: Typed Recipe Tags Discovery And Search — Coverage & Refactor
**What**: Run targeted discovery/search tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new discovery/search code, no warnings.

### ⬜ Unit 17d: Typed Recipe Tags UI — Visual QA Dogfood
**What**: Run `visual-qa-dogfood` on tag controls, filters, recipe cards, and mobile My Kitchen/navigation surfaces affected by tags.
**Output**: Screenshots, overflow metrics, and absurdity ledger in artifacts.
**Acceptance**: No ready visual issues remain; tags do not crowd compact cards or dock surfaces.

### ⬜ Unit 18a: Typed Recipe Tags API And Docs — Tests
**What**: Write failing tests for tag/course API fields, OpenAPI/playground docs, developer docs, and no AI-suggestion contract in v1.
**Output**: API/OpenAPI/docs tests.
**Acceptance**: Tests fail because API/docs do not expose tags.

### ⬜ Unit 18b: Typed Recipe Tags API And Docs — Implementation
**What**: Add tag/course fields to API response paths, OpenAPI/playground data, and docs.
**Output**: Updated API builders, OpenAPI schema, generated playground data, and docs.
**Acceptance**: Unit 18a tests pass; API remains neutral and non-Pebble-specific.

### ⬜ Unit 18c: Typed Recipe Tags API And Docs — Coverage & Refactor
**What**: Run targeted API/docs tests, generator, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, generator, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new tag API/doc code, no warnings.

### ⬜ Unit 19a: Navigation, Import Rejection, And Developer Docs — Tests
**What**: Write failing tests for My Kitchen sections, mobile dock stability, `/saved-recipes` copy, import UI absence, agentic/API import documentation, API docs with no Pebble-specific language, and developer guide examples.
**Output**: Tests in navigation/route/docs suites, including `test/components/navigation/mobile-nav.test.tsx`, route tests, `test/docs/developer-platform-docs.test.ts`, and repo hygiene tests for forbidden Pebble-specific strings if useful.
**Acceptance**: Tests fail on missing My Kitchen sections/docs or stale import/saved copy.

### ⬜ Unit 19b: Navigation, Import Rejection, And Developer Docs — Implementation
**What**: Update My Kitchen/navigation surfaces after primitives exist, explicitly document import as agentic/API-only, and ensure docs/API copy is neutral and non-Pebble-specific.
**Output**: Updated `app/routes/_index.tsx`, navigation tests/fixtures, developer/API docs, MCP docs/landing copy if needed, and no first-party import entry point.
**Acceptance**: Unit 19a tests pass; My Kitchen surfaces Continue Cooking, Your Recipes, Saved Recipes, Cookbooks, and Tags without dock churn.

### ⬜ Unit 19c: Navigation, Import Rejection, And Developer Docs — Coverage & Refactor
**What**: Run targeted nav/docs tests, generated API playground, coverage, and build/typecheck.
**Output**: Logs in artifacts for docs/nav tests, generator, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new docs/nav code, no warnings.

### ⬜ Unit 19d: Navigation, Import Rejection, And Developer Docs — Visual QA Dogfood
**What**: Run `visual-qa-dogfood` on My Kitchen, mobile dock/pantry drawer, `/saved-recipes`, recipe detail, and API/docs pages touched by copy/layout changes.
**Output**: Screenshots, overflow metrics, and absurdity ledger in artifacts.
**Acceptance**: No ready visual issues remain; no in-app text describes implementation mechanics or hidden shortcuts.

### ⬜ Unit 20: Final Local Validation
**What**: Run full coverage, typecheck, build, generated docs/playground checks, and local cleanup inspection.
**Output**: Final local validation logs in artifacts.
**Acceptance**: Full local validation passes with no warnings, or a true local capability blocker is recorded with all independent fixes complete.

### ⬜ Unit 21: Remote Push And PR/Merge
**What**: Push committed branch, create PR if required, run review/CI gates, and merge according to repo workflow when credentials allow.
**Output**: Pushed branch, PR/CI evidence, merge evidence or exact credential/capability blocker.
**Acceptance**: Branch is merged or a true human-only credential/capability blocker is recorded.

### ⬜ Unit 22: Deploy, Smoke, Cleanup, And Slugger Handoff
**What**: Verify deploy for the merged commit or run documented deploy path if needed, run safe QA/prod smoke/readiness commands, clean disposable data, run continuation scan, and notify Slugger.
**Output**: Deploy URL/status, smoke artifacts, cleanup logs, continuation scan notes, and Slugger completion message.
**Acceptance**: Deployed surface passes smoke with no disposable data left behind, or a true deployment credential/capability blocker is recorded after all independent work is complete.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each committable unit or sub-unit phase
- Push after each unit complete
- Run full test suite before marking unit done
- For UI/rendering/layout units, run `visual-qa-dogfood` before declaring the unit or task complete
- **All artifacts**: Save outputs, logs, data to `./2026-07-14-1313-doing-clem-feedback-e2e/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-07-14 13:26 Created from planning doc
- 2026-07-14 13:31 Granularity pass split Durable Object, cook-session UI, SavedRecipe, tags, and final delivery into smaller units.
