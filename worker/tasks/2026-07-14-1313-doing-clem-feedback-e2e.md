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

### ⬜ Unit 2a: API Metadata And Scaling Projection — Tests
**What**: Write failing tests for REST API recipe detail/list/OpenAPI/playground fields: `stepCount`, normalized `sourceDisplayName`, yield/servings validation behavior, authenticated `isSaved` placeholder behavior before SavedRecipe lands, accepted tag response placeholders, and scale projection that returns original plus scaled structured quantities without mutating stored ingredients.
**Output**: Tests in `test/routes/api-v1-recipes.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/docs/developer-platform-docs.test.ts`, and supporting lib tests as needed.
**Acceptance**: Tests fail on missing fields or scaling projection behavior.

### ⬜ Unit 2b: API Metadata And Scaling Projection — Implementation
**What**: Implement API-neutral metadata and scale projection in API v1 response builders, OpenAPI schema, generated playground data, and developer docs without Pebble-specific language.
**Output**: Updated `app/lib/api-v1.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/lib/generated/api-v1-playground.ts` via generator, API docs routes, and related helpers.
**Acceptance**: Unit 2a tests pass and stored recipe ingredient quantities remain unchanged after scaled reads.

### ⬜ Unit 2c: API Metadata And Scaling Projection — Coverage & Refactor
**What**: Run targeted API/OpenAPI tests, generated playground check, coverage, and build/typecheck.
**Output**: Logs in artifacts for API tests, OpenAPI generation, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new API helper code, docs generation stable, no warnings.

### ⬜ Unit 3a: Durable Cook Session Infrastructure — Tests
**What**: Write failing tests for cook-session state normalization, revision-checked patching, snapshot shape, recipe fingerprint mismatch handling, completion idempotency, pending completion retry, D1 index helper behavior, Wrangler binding/migration config, and Env type shape.
**Output**: Tests in `test/lib/cook-session-state.server.test.ts`, `test/lib/cook-session-index.server.test.ts`, `test/workers/cook-session-do.test.ts`, `test/config/wrangler-durable-objects.test.ts`, and schema/migration tests as needed.
**Acceptance**: Tests fail because no cook-session state helpers, D1 index model, Durable Object class, binding, or migration exists.

### ⬜ Unit 3b: Durable Cook Session Infrastructure — Implementation
**What**: Add D1/Prisma cook-session index schema and migrations, Cloudflare Durable Object class, Env binding, Worker export, snapshot `GET`, revision-checked `PATCH`, completion mutation, WebSocket subscription/broadcast, and completion retry path.
**Output**: Updated `prisma/schema.prisma`, `migrations/`, `prisma/migrations/`, `wrangler.json`, `app/cloudflare-env.d.ts`, `workers/app.ts`, new cook-session route/lib files, and generated Prisma client artifacts if required.
**Acceptance**: Unit 3a tests pass; DO is SQLite-backed and configured for production and QA; D1 is index/history only; live state remains DO-owned.

### ⬜ Unit 3c: Durable Cook Session Infrastructure — Coverage & Refactor
**What**: Run targeted cook-session tests, worker/config tests, migration validation, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, migration checks, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new cook-session helper code, no warnings, build/typecheck clean.

### ⬜ Unit 4a: Cook Session UI And My Kitchen Resume — Tests
**What**: Write failing tests for recipe cook mode using server sessions for logged-in users, anonymous local fallback, local-to-server adoption rules, two-client sync state application, recipe edit warning, completion flow, and My Kitchen Continue Cooking cards.
**Output**: Tests in `test/routes/recipe-detail-cook-session.test.tsx`, `test/routes/index-cook-session.test.tsx`, and component/hook tests for any new client cook-session module.
**Acceptance**: Tests fail because UI still uses localStorage as the logged-in source of truth and My Kitchen has no Continue Cooking cards.

### ⬜ Unit 4b: Cook Session UI And My Kitchen Resume — Implementation
**What**: Wire recipe cook mode and My Kitchen to cook-session endpoints while keeping anonymous/local fallback, optimistic state, conflict handling, and completion behavior.
**Output**: Updated `app/routes/recipes.$id.tsx`, `app/routes/_index.tsx`, new client hook/module files, and any route actions/loaders needed.
**Acceptance**: Unit 4a tests pass; logged-in progress syncs through server session; anonymous progress remains local-only; completion clears active resume card.

### ⬜ Unit 4c: Cook Session UI And My Kitchen Resume — Coverage & Refactor
**What**: Run targeted UI tests, coverage, build/typecheck, and fix edge cases.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new client/server session code, no warnings.

### ⬜ Unit 4d: Cook Session UI And My Kitchen Resume — Visual QA Dogfood
**What**: Run `visual-qa-dogfood` on recipe cook mode and My Kitchen Continue Cooking across desktop/mobile.
**Output**: Screenshots, overflow metrics, and absurdity ledger in artifacts.
**Acceptance**: No ready visual issues remain; text/buttons do not overlap; mobile dock remains stable.

### ⬜ Unit 5a: SavedRecipe Primitive — Tests
**What**: Write failing tests for `SavedRecipe` schema/migration/backfill, explicit save/unsave service, cookbook-add compatibility, `/saved-recipes` route migration, recipe detail state, My Kitchen saved section, search index, API authenticated `isSaved`, and no accidental author-follow behavior.
**Output**: Tests in `test/models/saved-recipe.test.ts`, `test/lib/saved-recipes.server.test.ts`, `test/routes/saved-recipes.test.tsx`, `test/routes/recipe-detail-saved.test.tsx`, `test/lib/search.server.test.ts`, and API tests.
**Acceptance**: Tests fail because `SavedRecipe` does not exist and `/saved-recipes` derives from `RecipeInCookbook`.

### ⬜ Unit 5b: SavedRecipe Primitive — Implementation
**What**: Add `SavedRecipe` schema/migrations/backfill/compat helpers and update route/UI/API/search surfaces to use it as canonical private saved state.
**Output**: Updated Prisma/D1 migrations, `app/lib/saved-recipes.server.ts`, recipe detail action/loaders, `/saved-recipes`, My Kitchen, search, API response builders, and cookbook save compatibility.
**Acceptance**: Unit 5a tests pass; existing cookbook-derived saved lists are preserved; explicit unsave is independent from cookbook removal.

### ⬜ Unit 5c: SavedRecipe Primitive — Coverage & Refactor
**What**: Run targeted saved-recipe/search/API tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new saved-recipe code, no warnings.

### ⬜ Unit 5d: SavedRecipe Primitive — Visual QA Dogfood
**What**: Run `visual-qa-dogfood` on recipe detail saved controls, `/saved-recipes`, and My Kitchen saved sections.
**Output**: Screenshots, overflow metrics, and absurdity ledger in artifacts.
**Acceptance**: No ready visual issues remain; saved controls are reachable and not confused with cookbook membership.

### ⬜ Unit 6a: Typed Recipe Tags — Tests
**What**: Write failing tests for controlled accepted tags, course tags, custom tags, recipe create/edit persistence, search/filter behavior, API response fields, OpenAPI/playground docs, and exclusion of AI suggestion machinery from v1.
**Output**: Tests in `test/models/recipe-tag.test.ts`, `test/lib/recipe-tags.server.test.ts`, route/component tests for recipe create/edit/list/search, `test/lib/search.server.test.ts`, and API/OpenAPI tests.
**Acceptance**: Tests fail because no recipe tag schema/services/UI/API fields exist.

### ⬜ Unit 6b: Typed Recipe Tags — Implementation
**What**: Add accepted/manual typed tags, schema/migrations, services, recipe form/list/search filters, API fields, and docs while leaving AI suggestions out.
**Output**: Updated Prisma/D1 migrations, tag service files, recipe builder/detail/list/search routes/components, search index, API/OpenAPI docs, and generated playground data.
**Acceptance**: Unit 6a tests pass; tags power at least one user-facing filter/search path and one API response path.

### ⬜ Unit 6c: Typed Recipe Tags — Coverage & Refactor
**What**: Run targeted tag/search/API tests, coverage, and build/typecheck.
**Output**: Logs in artifacts for targeted tests, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new tag code, no warnings.

### ⬜ Unit 6d: Typed Recipe Tags — Visual QA Dogfood
**What**: Run `visual-qa-dogfood` on tag controls, filters, recipe cards, and mobile My Kitchen/navigation surfaces affected by tags.
**Output**: Screenshots, overflow metrics, and absurdity ledger in artifacts.
**Acceptance**: No ready visual issues remain; tags do not crowd compact cards or dock surfaces.

### ⬜ Unit 7a: Navigation, Import Rejection, And Developer Docs — Tests
**What**: Write failing tests for My Kitchen sections, mobile dock stability, `/saved-recipes` copy, import UI absence, agentic/API import documentation, API docs with no Pebble-specific language, and developer guide examples.
**Output**: Tests in navigation/route/docs suites, including `test/components/navigation/mobile-nav.test.tsx`, route tests, `test/docs/developer-platform-docs.test.ts`, and repo hygiene tests for forbidden Pebble-specific strings if useful.
**Acceptance**: Tests fail on missing My Kitchen sections/docs or stale import/saved copy.

### ⬜ Unit 7b: Navigation, Import Rejection, And Developer Docs — Implementation
**What**: Update My Kitchen/navigation surfaces after primitives exist, explicitly document import as agentic/API-only, and ensure docs/API copy is neutral and non-Pebble-specific.
**Output**: Updated `app/routes/_index.tsx`, navigation tests/fixtures, developer/API docs, MCP docs/landing copy if needed, and no first-party import entry point.
**Acceptance**: Unit 7a tests pass; My Kitchen surfaces Continue Cooking, Your Recipes, Saved Recipes, Cookbooks, and Tags without dock churn.

### ⬜ Unit 7c: Navigation, Import Rejection, And Developer Docs — Coverage & Refactor
**What**: Run targeted nav/docs tests, generated API playground, coverage, and build/typecheck.
**Output**: Logs in artifacts for docs/nav tests, generator, coverage, and build/typecheck.
**Acceptance**: 100% coverage on new docs/nav code, no warnings.

### ⬜ Unit 7d: Navigation, Import Rejection, And Developer Docs — Visual QA Dogfood
**What**: Run `visual-qa-dogfood` on My Kitchen, mobile dock/pantry drawer, `/saved-recipes`, recipe detail, and API/docs pages touched by copy/layout changes.
**Output**: Screenshots, overflow metrics, and absurdity ledger in artifacts.
**Acceptance**: No ready visual issues remain; no in-app text describes implementation mechanics or hidden shortcuts.

### ⬜ Unit 8: Final Validation, Smoke, Push, And Handoff
**What**: Run full test coverage, typecheck, build, smoke/readiness/cleanup commands that are safe for the available environment, push branch, create/merge/deploy according to repo workflow if credentials allow, run deployed smoke, cleanup disposable data, and notify Slugger.
**Output**: Final validation logs, smoke artifacts, cleanup output, pushed commits, PR/deploy evidence if available, and completion message.
**Acceptance**: Full suite/build/smoke pass with no warnings, or a true human-only credential/capability blocker is recorded with independent work complete; no disposable QA/live data remains.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- For UI/rendering/layout units, run `visual-qa-dogfood` before declaring the unit or task complete
- **All artifacts**: Save outputs, logs, data to `./2026-07-14-1313-doing-clem-feedback-e2e/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-07-14 13:26 Created from planning doc
