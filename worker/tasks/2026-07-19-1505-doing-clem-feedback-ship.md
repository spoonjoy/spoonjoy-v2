# Doing: Ship Clem Feedback

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-07-19 15:34
**Planning**: ./2026-07-19-1505-planning-clem-feedback-ship.md
**Artifacts**: ./2026-07-19-1505-doing-clem-feedback-ship/

## Execution Mode

- **direct**: Execute units sequentially in the current task, using fresh sub-agents for required reviews and bounded fixes.

## Objective
Ship Clem's accepted feedback as focused Spoonjoy product behavior: cross-device cooking, consistent shopping restoration, private saves, manual tags, and neutral recipe metadata/scaling. Preserve the existing navigation and agent-first import model while removing Pebble-specific behavior.

## Upstream Work Items
- `./2026-07-14-1313-clem-feedback-source.md`

## Completion Criteria
- [ ] Every feedback-source row has either shipped behavior or a regression test for its explicit rejection.
- [ ] Real Workers-runtime tests prove authenticated cook ownership, SQLite DO persistence, concurrent start convergence on one attempt, stale-attempt/revision conflicts, mutation replay, hibernatable WebSocket fan-out, eviction recovery, idempotent terminal transitions, projection retry fencing, scheduler collisions, and purge.
- [ ] Private `GET /api/cook-sessions` returns active registry rows newest-first; an authenticated home revalidates immediately on mount/focus/visibility/online and every five seconds only while visible, online, and initially empty.
- [ ] Two authenticated browser contexts can begin from an initially empty second-device home, discover the same active session within five seconds without a manual reload or recipe identifier, and synchronize step, checklist, and scale changes.
- [ ] Anonymous progress remains usable across local reloads but never reaches the authenticated DO/D1 path; an anonymous -> user A -> logout -> user B browser sequence, including a stale socket and legacy local key, cannot cross principals.
- [ ] D1 cook rows form the complete registry for unpurged objects and contain only `(userId, recipeId)`, attempt/status/revision, title of at most 200 code points, and lifecycle timestamps; schema and tests reject progress fields.
- [ ] Recipe edits never silently remap an active session; completion and abandonment remove resume state without social side effects.
- [ ] Web, REST, MCP, and legacy shared shopping add paths pass one restoration/concurrency matrix, including repaired unitless duplicates, database-enforced active identity uniqueness, quantity aggregation, rollback, monotonic sync timestamps, native-sync readback, and deterministic fresh-end ordering; existing non-add operations remain compatible.
- [ ] SavedRecipe migration backfills existing cookbook-derived saved expectations once; subsequent save/unsave and cookbook membership changes are independent and private.
- [ ] `/saved-recipes` and REST `/api/v1/saved-recipes` perform owner-scoped SQL search with deterministic descending `(savedAt, recipeId)` keyset pagination, return at most 24 recipes, reject malformed cursors, use private no-store responses, and never materialize the full saved collection in Worker memory.
- [ ] Idempotent `PUT`/`DELETE /api/v1/saved-recipes/:recipeId` mutations use existing `kitchen:write` authorization/idempotency, while `GET /api/v1/saved-recipes` uses `kitchen:read`; soft-deleted recipes are excluded and cascade deletion removes saves.
- [ ] Recipe tags enforce nullable course `main|side|appetizer|dessert`, ten normalized custom labels, per-recipe uniqueness, code-point/control-character validation, owner-only writes, deterministic output order, and no AI source or endpoint.
- [ ] My Recipes and global search apply course/tag predicates before their existing result limits; My Recipes rejects unsafe page values and never sends an unsafe SQLite offset.
- [ ] My Recipes/search treat repeated tag filters as AND, preserve `q`/course/tags through My Recipes pagination and current bounded-search filter links, and expose keyboard-accessible filter/reset and authoring controls.
- [ ] REST v1 contracts, OpenAPI, generated playground, and MCP recipe reads expose the same neutral course/tags metadata and optional `scale` contract without persisting scaled values; absent scale preserves current payloads and invalid scale errors match across adapters.
- [ ] Existing import remains agent/API-only, current navigation remains reachable, and application/docs/tests contain no Pebble-specific runtime behavior.
- [ ] The numeric migration applies from empty and from the frozen `220954a1` pre-feature schema/data fixture, preserves foreign keys, reconciles duplicate unitless rows without quantity loss, produces exact save-backfill counts, and matches Prisma-modeled tables/columns plus documented raw indexes.
- [ ] QA and the bootstrap PR create migration `v1_cook_session` through atomic `wrangler deploy`; no rollback crosses that boundary, while the subsequent product PR proves version upload, 0% candidate smoke, 100% promotion, and post-boundary rollback remain operational.
- [ ] All changed code has 100% statement, branch, function, and line coverage; unit, Workers, Playwright, typecheck, build, and migration commands fail on warnings and pass cleanly in CI.
- [ ] Changed UI passes keyboard/accessibility checks and `visual-qa-dogfood` at mobile and desktop viewports with no overlap, truncation, unreachable controls, or open absurdity findings.
- [ ] QA migration/deploy, two-client smoke, REST/MCP shopping/save/tag/scaling smoke, and cleanup pass before merge; cleanup closes sockets, purges the known DO, removes its D1 projection and disposable save/tag/shopping rows, then proves zero residue.
- [ ] The reviewed bootstrap/product PR chain merges in order with green CI; each automatic production workflow deploys its exact merge SHA, canonical health identifies it, production smoke passes, and disposable data is removed.
- [ ] 100% test coverage on all new code.
- [ ] All tests pass.
- [ ] No warnings.
- [ ] `visual-qa-dogfood` evidence is captured, its absurdity ledger is closed, and automated visual metrics pass.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code.
- All branches covered, including auth, malformed input, conflict, reconnect, retry, rollback, empty, boundary, and cleanup paths.
- Cloudflare-specific DO/D1/WebSocket behavior runs in the official Workers Vitest integration with Istanbul and `--max-workers=1 --no-isolate`.
- App services/routes/components run under the existing full 100% Istanbul gate; browser behavior runs in Playwright.
- Unit, Workers, Playwright, typecheck, build, and migration runners fail on warnings.

## TDD Requirements
**Strict TDD - no exceptions:**
1. **Tests first**: Write failing tests before implementation.
2. **Verify failure**: Run the focused tests and record the expected red failure.
3. **Minimal implementation**: Write only enough code to satisfy the tests.
4. **Verify pass**: Run focused tests, full app coverage, typecheck, and build with no warnings.
5. **Refactor**: Clean up while all gates remain green.
6. **Adapter requests**: Capture and assert outgoing HTTP/DO/SQL request shapes separately from response handling.

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

### ⬜ Unit 0: Baseline And Source Freeze
**What**: Record clean branch/upstream state, the approved plan/source hashes, Node/pnpm/Cloudflare package versions, and baseline outputs for `pnpm run typecheck`, `pnpm run test:coverage`, and `pnpm run build`; confirm no generated diff and map every feedback row to a later unit.
**Output**: Baseline logs and feedback-to-unit map in the artifacts directory.
**Acceptance**: 7,226 existing tests pass at 100% app coverage; typecheck/build pass; worktree is clean; every source row maps to a unit or explicit rejection test.

### ⬜ Unit 1.1a: Namespace Bootstrap - Tests
**What**: Add failing config/runtime tests for an inert exported `CookSession`, explicit top-level/QA bindings, retained `v1_cook_session` `new_sqlite_classes` migration, environment types, and SQLite storage.
**Output**: Red `test/config/cook-session-binding.test.ts` and `test/workers/cook-session-bootstrap.test.ts` evidence.
**Acceptance**: `pnpm exec vitest run test/config/cook-session-binding.test.ts test/workers/cook-session-bootstrap.test.ts` fails only on absent namespace code/config.

### ⬜ Unit 1.1b: Namespace Bootstrap - Implementation
**What**: Add the inert `workers/cook-session.ts` export plus `wrangler.json` production/QA binding, legacy migration, and `app/cloudflare-env.d.ts` types.
**Output**: One deployable inert SQLite DO namespace.
**Acceptance**: Unit 1.1a tests pass and `pnpm run typecheck` plus `pnpm run build` are green.

### ⬜ Unit 1.1c: Namespace Bootstrap - Verification
**What**: Cover every namespace/config branch and review storage/lifecycle correctness.
**Output**: Focused coverage and reviewer report.
**Acceptance**: Namespace code is 100% covered and a fresh Cloudflare review has no BLOCKER/MAJOR finding.

### ⬜ Unit 1.2a: Workers Test Lane - Tests
**What**: Add failing tests for the isolated Workers config, Vitest/Workers-pool version compatibility, Istanbul thresholds, serialized shared storage, warning failure, package commands, and CI invocation.
**Output**: Red `test/config/workers-vitest-lane.test.ts` and workflow-contract evidence.
**Acceptance**: Focused tests fail only because the Workers lane/dependencies are absent.

### ⬜ Unit 1.2b: Workers Test Lane - Implementation
**What**: Upgrade Vitest packages to 4.1.10, add compatible `@cloudflare/vitest-pool-workers`, `vitest.workers.config.ts`, isolated test Wrangler config, `test:workers`/`test:workers:coverage`, and the mandatory CI job.
**Output**: Executable official Workers-runtime test and coverage lane.
**Acceptance**: `pnpm run test:workers` and app typecheck/build pass with no warnings.

### ⬜ Unit 1.2c: Workers Test Lane - Verification
**What**: Run both app and Workers coverage and review config/CI isolation.
**Output**: Dual 100% coverage reports and reviewer result.
**Acceptance**: Worker bootstrap files and new config logic reach 100%; app remains 100%; fresh test-infrastructure review converges.

### ⬜ Unit 1.3a: Bootstrap Deployment Mode - Tests
**What**: Add failing deploy-script/workflow tests for source-controlled atomic bootstrap mode, exact-SHA/version verification, no pre-boundary rollback, sanitized artifact output, and restored canary mode after the boundary.
**Output**: Red deploy-production-canary and production-workflow tests.
**Acceptance**: Focused tests fail only because lifecycle-aware deployment behavior is absent.

### ⬜ Unit 1.3b: Bootstrap Deployment Mode - Implementation
**What**: Extend the existing deploy script/workflow/docs with the one-time atomic `wrangler deploy` branch and post-boundary canary branch without adding a new orchestrator.
**Output**: One reviewed lifecycle-aware production deployment mode.
**Acceptance**: Focused deploy/workflow tests, typecheck, build, and full app coverage pass.

### ⬜ Unit 1.3c: Bootstrap Deployment Mode - Verification
**What**: Cover every deployment decision/failure/artifact branch and obtain release/security review.
**Output**: 100% deploy-script coverage and reviewer report.
**Acceptance**: No secret reaches logs/artifacts; no invalid rollback is possible; review converges.

### ⬜ Unit 1.4: Bootstrap QA
**What**: Deploy the inert namespace to QA, verify exact version/migration/storage behavior, smoke it, purge its test object, and prove zero QA residue.
**Output**: Sanitized QA deployment, smoke, and cleanup logs.
**Acceptance**: QA has `v1_cook_session`, the inert DO responds, and no disposable D1/DO row remains.

### ⬜ Unit 1.5: Bootstrap PR And Merge
**What**: Run final bootstrap gates, open the bootstrap PR, resolve review/CI, and merge without product behavior.
**Output**: Bootstrap PR URL and exact merge SHA.
**Acceptance**: Required reviews/CI are green and the merge SHA contains only docs plus lifecycle/test/deploy bootstrap scope.

### ⬜ Unit 1.6: Production Lifecycle Boundary
**What**: Follow the automatic atomic production deploy, verify exact merge SHA/version and namespace behavior, clean its test object, and record the no-pre-boundary-rollback rule.
**Output**: Sanitized production deployment/version/health/cleanup evidence.
**Acceptance**: Production has the SQLite namespace, canonical health identifies the bootstrap merge, zero residue remains, and failure recovery is forward-only across this boundary.

### ⬜ Unit 1.7: Product Branch Handoff
**What**: Create a clean product branch/worktree from the verified bootstrap merge, restore the source-controlled canary path, and record PR/merge/deploy SHAs plus task/artifact paths in a handoff manifest.
**Output**: `bootstrap-handoff.md` and clean pushed product branch.
**Acceptance**: `git merge-base --is-ancestor <bootstrap-merge> HEAD` succeeds; task docs/artifacts remain reachable; canary contract tests pass; Unit 2.1 starts only from this checkpoint.

### ⬜ Unit 2.1a: Product Models - Tests
**What**: From the Unit 1.7 product handoff, add failing Prisma/schema tests for `SavedRecipe`, `RecipeTag`, nullable controlled `Recipe.course`, metadata-only `CookSessionIndex`, relations, FK actions, and absence of progress columns.
**Output**: Red `test/models/clem-feedback-schema.test.ts` evidence.
**Acceptance**: Focused tests fail only because the models/columns are absent.

### ⬜ Unit 2.1b: Product Models - Implementation
**What**: Add the four model changes and relations to `prisma/schema.prisma`, regenerate the client, and update typed test helpers/cleanup order.
**Output**: Prisma-modeled product schema and generated types.
**Acceptance**: Model tests, Prisma generation/push, typecheck, and build pass.

### ⬜ Unit 2.1c: Product Models - Verification
**What**: Cover model helpers/cleanup branches and review ownership/FK/privacy boundaries.
**Output**: Coverage and data-review evidence.
**Acceptance**: New helper code is 100% covered and review converges.

### ⬜ Unit 2.2a: SavedRecipe Backfill Migration - Tests
**What**: Add failing migration tests for empty/frozen-baseline application, `Cookbook.authorId` deduplication, `MAX(updatedAt)` saved time, exact counts, FK integrity, and soft/hard deletion behavior.
**Output**: Red saved-backfill section of `test/scripts/migration-0024-clem-feedback-product.test.ts`.
**Acceptance**: Focused migration tests fail because migration 0024 is absent.

### ⬜ Unit 2.2b: SavedRecipe Backfill Migration - Implementation
**What**: Create the SavedRecipe/course/tag/cook-index schema and deterministic SavedRecipe backfill portion of `migrations/0024_clem_feedback_product.sql`.
**Output**: Additive new tables/column and one-time saved-state backfill.
**Acceptance**: Saved migration tests pass from both fixtures with exact counts and preserved FKs.

### ⬜ Unit 2.2c: SavedRecipe Backfill Migration - Verification
**What**: Rehearse the saved/schema migration under Node SQLite and local Wrangler D1 and review prior-Worker compatibility.
**Output**: Rehearsal and reviewer evidence.
**Acceptance**: Both engines agree, no existing table contract breaks, and review converges.

### ⬜ Unit 2.3a: Shopping Repair Migration - Tests
**What**: Add failing migration tests for active unitless/unit identities, deterministic duplicate survivor/state/quantity/sort handling, tombstoned extras, partial unique index enforcement, `updatedAt`, and no quantity loss.
**Output**: Red shopping section of the migration 0024 test.
**Acceptance**: Tests fail because repair/index SQL is absent.

### ⬜ Unit 2.3b: Shopping Repair Migration - Implementation
**What**: Add deterministic shopping duplicate reconciliation and the partial expression unique index to migration 0024.
**Output**: One database-enforced active shopping identity per list/ingredient/unit.
**Acceptance**: All repair/index fixtures pass and the pre-feature Worker remains compatible with the migrated schema.

### ⬜ Unit 2.3c: Shopping Repair Migration - Verification
**What**: Run duplicate-heavy migration/rollback-failure fixtures, local D1 apply/list twice, and data review.
**Output**: Shopping migration verification and review evidence.
**Acceptance**: Migration is applied once, second apply is a no-op, no data is lost, and review converges.

### ⬜ Unit 2.4a: Reviewed Migration Gate - Tests
**What**: Add failing deploy-script tests for D1 recovery bookmark, exact 0024 statement acceptance, unrelated DML/unique-index rejection, duplicate/backfill preflight, and post-apply verification.
**Output**: Red migration-gate tests.
**Acceptance**: Tests fail because the existing additive gate rejects the reviewed 0024 forms and lacks recovery checks.

### ⬜ Unit 2.4b: Reviewed Migration Gate - Implementation
**What**: Extend only the existing production migration gate for the deterministic 0024 forms, recovery bookmark, preflight, and verification.
**Output**: Narrowly safe automatic product-migration path.
**Acceptance**: Gate tests pass, unrelated destructive SQL remains rejected, and script typecheck/build are green.

### ⬜ Unit 2.4c: Reviewed Migration Gate - Verification
**What**: Reach 100% gate/parser coverage and obtain migration/release/security review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every allow/reject/failure branch is covered and review converges.

### ⬜ Unit 3.1a: Atomic Shopping Service - Tests
**What**: Add failing service tests for one outgoing upsert statement covering active/checked/deleted rows, unitless identity, null quantities, same/new ID policy, concurrent adds, deterministic fresh-end order, `updatedAt`, and atomic failure.
**Output**: Red `test/lib/shopping-list-mutations.server.test.ts` with captured SQL/bindings.
**Acceptance**: Focused tests fail because the shared service is absent.

### ⬜ Unit 3.1b: Atomic Shopping Service - Implementation
**What**: Add `app/lib/shopping-list-mutations.server.ts` implementing the single SQLite `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` contract without application retry.
**Output**: One database-linearized add/restore function.
**Acceptance**: Service tests pass under local SQLite and the D1-compatible adapter; typecheck/build pass.

### ⬜ Unit 3.1c: Atomic Shopping Service - Verification
**What**: Reach 100% service coverage and obtain SQL/concurrency review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every quantity/state/conflict/error branch is covered and review converges.

### ⬜ Unit 3.2a: Web And REST Shopping Adapters - Tests
**What**: Add failing route/API tests for manual and recipe adds/restores, REST idempotency and outgoing service inputs, fresh ordering, rollback, and unchanged check/delete/clear responses.
**Output**: Red web/REST adapter tests.
**Acceptance**: Tests fail on current separate read-then-write writers.

### ⬜ Unit 3.2b: Web And REST Shopping Adapters - Implementation
**What**: Route web shopping and REST manual/recipe additions through the shared service while preserving existing response/idempotency contracts.
**Output**: Thin web and REST add adapters.
**Acceptance**: Focused route/API tests and OpenAPI compatibility tests pass.

### ⬜ Unit 3.2c: Web And REST Shopping Adapters - Verification
**What**: Reach 100% adapter coverage, run full shopping/API/full gates, and obtain API review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Outgoing inputs, auth, rollback, and error branches are covered and review converges.

### ⬜ Unit 3.3a: MCP, Legacy, And Native Sync Shopping - Tests
**What**: Add failing MCP/legacy/native-sync tests for shared manual/recipe additions, restored ordering, monotonic timestamps, readback/tombstones, and explicit absence of web/MCP exactly-once claims.
**Output**: Red MCP/legacy/native-sync adapter tests.
**Acceptance**: Tests fail on the independent MCP/legacy writers and MCP sort defect.

### ⬜ Unit 3.3b: MCP, Legacy, And Native Sync Shopping - Implementation
**What**: Route MCP and remaining legacy add callers through the shared service and preserve native-sync serialization.
**Output**: One add/restore behavior across all existing writers.
**Acceptance**: Focused MCP/legacy/native tests pass with unchanged non-add contracts.

### ⬜ Unit 3.3c: MCP, Legacy, And Native Sync Shopping - Verification
**What**: Run the shared cross-surface matrix, 100% coverage, full gates, and fresh API/sync review.
**Output**: Matrix, coverage, and reviewer evidence.
**Acceptance**: All surfaces pass one state matrix and review converges.

### ⬜ Unit 4.1a: Neutral Recipe Metadata - Tests
**What**: Add failing serializer/API/MCP/OpenAPI tests for nullable course and deterministic tags on bounded recipe reads, with no personalized save state.
**Output**: Red metadata contract tests.
**Acceptance**: Tests fail because course/tags are absent from shared serializers and schemas.

### ⬜ Unit 4.1b: Neutral Recipe Metadata - Implementation
**What**: Add shared metadata serialization and wire REST recipe reads, MCP recipe reads, OpenAPI, generated playground, and developer docs.
**Output**: Neutral course/tag read parity.
**Acceptance**: Focused metadata/API/MCP/OpenAPI tests pass and generated output is stable.

### ⬜ Unit 4.1c: Neutral Recipe Metadata - Verification
**What**: Reach 100% serializer/adapter coverage and obtain API compatibility review.
**Output**: Coverage, generated diff, and reviewer evidence.
**Acceptance**: Every empty/order/privacy branch is covered and review converges.

### ⬜ Unit 4.2a: Read-Time Scaling - Tests
**What**: Add failing pure/REST/MCP tests for optional finite `scale` `0.1..100`, six-decimal quantity rounding, unchanged servings/storage/default payload, scale metadata, and adapter-native invalid-input errors.
**Output**: Red scaling-helper and adapter tests.
**Acceptance**: Tests fail because the shared validator/scaler and arguments are absent.

### ⬜ Unit 4.2b: Read-Time Scaling - Implementation
**What**: Add the pure scaling helper and wire REST detail query plus MCP `get_recipe` argument without changing stored quantities or default responses.
**Output**: One read-only scaling contract across REST and MCP.
**Acceptance**: Focused scaling/API/MCP tests and typecheck/build pass.

### ⬜ Unit 4.2c: Read-Time Scaling - Verification
**What**: Reach 100% validation/rounding/serialization coverage and obtain API review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Null/NaN/infinite/bounds/precision/default branches are covered and review converges.

### ⬜ Unit 4.3a: Neutral Boundary - Tests
**What**: Add failing source/runtime tests for no Pebble categorization/fixtures, no first-party import UI, no AI tagging surface, stable navigation, and no personalized save metadata in MCP/public reads.
**Output**: Red `test/config/clem-feedback-boundaries.test.ts` evidence.
**Acceptance**: Tests fail on the existing Pebble-specific analytics branch/fixtures only.

### ⬜ Unit 4.3b: Neutral Boundary - Implementation
**What**: Remove Pebble-specific runtime categorization and replace fixtures with neutral clients; add the focused boundary oracle without modifying import/navigation behavior.
**Output**: Partner-neutral runtime and executable rejection guard.
**Acceptance**: Boundary tests and existing navigation/import tests pass.

### ⬜ Unit 4.3c: Neutral Boundary - Verification
**What**: Reach 100% boundary/analytics coverage, scan changed source/docs, and obtain scope review.
**Output**: Coverage, scan, and reviewer evidence.
**Acceptance**: No prohibited runtime behavior remains and review converges.

### ⬜ Unit 5.1a: Saved Service And Cursor - Tests
**What**: Add failing service/query tests for explicit save/unsave, cookbook independence, owner scoping, soft/hard deletion, SQL search, versioned cursor validation, descending ties, 24-row bounds, and no full materialization.
**Output**: Red `test/lib/saved-recipes.server.test.ts` query/service tests.
**Acceptance**: Focused tests fail because the canonical service/cursor is absent.

### ⬜ Unit 5.1b: Saved Service And Cursor - Implementation
**What**: Add `app/lib/saved-recipes.server.ts` with owner-scoped mutations, list query, cursor codec, and deletion rules.
**Output**: One private SavedRecipe data/query service.
**Acceptance**: Focused service tests, typecheck, and build pass.

### ⬜ Unit 5.1c: Saved Service And Cursor - Verification
**What**: Reach 100% service/cursor coverage and obtain data/privacy review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every cursor/query/error/boundary branch is covered and review converges.

### ⬜ Unit 5.2a: Saved REST API - Tests
**What**: Add failing REST/OpenAPI tests for `GET /saved-recipes`, idempotent PUT/DELETE, kitchen scopes, owner privacy, malformed cursor, no-store/vary headers, soft deletion, replay, and outgoing service inputs.
**Output**: Red REST/OpenAPI adapter tests.
**Acceptance**: Tests fail because the saved routes/contracts are absent.

### ⬜ Unit 5.2b: Saved REST API - Implementation
**What**: Add API v1 list/PUT/DELETE handlers, operation mapping, scopes/idempotency, OpenAPI, generated playground, and docs using the saved service.
**Output**: Private documented SavedRecipe REST contract.
**Acceptance**: Focused API/OpenAPI tests and generated diff pass.

### ⬜ Unit 5.2c: Saved REST API - Verification
**What**: Reach 100% REST adapter coverage and obtain API/security review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Auth/cache/idempotency/error branches and outgoing inputs are covered; review converges.

### ⬜ Unit 5.3a: Saved Web Experience - Tests
**What**: Add failing route/component tests for paginated `/saved-recipes`, dedicated save/unsave, distinct cookbook control/copy, backfill independence, empty/search/error states, and keyboard behavior.
**Output**: Red saved-page and recipe-detail UI tests.
**Acceptance**: Tests fail because web still derives saves from cookbook membership.

### ⬜ Unit 5.3b: Saved Web Experience - Implementation
**What**: Convert `saved-recipes.tsx` to the service and add dedicated save plus unambiguous cookbook controls on recipe detail.
**Output**: Independent private saved-recipe web workflow.
**Acceptance**: Focused route/component tests and app typecheck/build pass.

### ⬜ Unit 5.3c: Saved Web Experience - Verification
**What**: Reach 100% route/component coverage, run full gates, and obtain product/accessibility/privacy review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every UI/action/empty/error branch is covered and review converges.

### ⬜ Unit 5.4: Saved Web Visual QA
**What**: Run `visual-qa-dogfood` on recipe save/cookbook controls and saved empty/populated/search/pagination states at mobile and desktop sizes.
**Output**: Screenshots, metrics, and closed absurdity ledger.
**Acceptance**: Controls are distinct, keyboard reachable, non-overlapping, and visually coherent.

### ⬜ Unit 6.1a: Tag Normalization And Storage - Tests
**What**: Add failing tests for course enum/null, NFKC/whitespace/lowercase comparison, control rejection, 40-code-point and ten-tag limits, first-spelling duplicates, deterministic order, owner checks, and atomic replacement/concurrency.
**Output**: Red `test/lib/recipe-tags.server.test.ts` tests.
**Acceptance**: Tests fail because validation/storage services are absent.

### ⬜ Unit 6.1b: Tag Normalization And Storage - Implementation
**What**: Add tag validation and owner-authorized atomic storage/query service.
**Output**: One canonical recipe-owned tag/course service.
**Acceptance**: Focused service tests, typecheck, and build pass.

### ⬜ Unit 6.1c: Tag Normalization And Storage - Verification
**What**: Reach 100% validation/storage coverage and obtain data/concurrency review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every invalid/boundary/duplicate/concurrent/error branch is covered and review converges.

### ⬜ Unit 6.2a: Tag Authoring - Tests
**What**: Add failing RecipeBuilder/new/edit tests for course selection, custom-tag editing, hidden payload, validation errors, owner-only create/edit, and atomic recipe/tag writes.
**Output**: Red authoring route/component tests.
**Acceptance**: Tests fail because authoring fields and action wiring are absent.

### ⬜ Unit 6.2b: Tag Authoring - Implementation
**What**: Add accessible RecipeBuilder controls and create/edit transaction wiring through the tag service.
**Output**: Manual course/tag authoring on new and edit flows.
**Acceptance**: Focused authoring tests and typecheck/build pass.

### ⬜ Unit 6.2c: Tag Authoring - Verification
**What**: Reach 100% component/action coverage and obtain product/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every payload/validation/rollback/keyboard branch is covered and review converges.

### ⬜ Unit 6.3a: Tag Filters And Search - Tests
**What**: Add failing My Recipes/search tests for course, repeated-tag AND semantics, pre-limit SQL predicates, safe page parsing, URL preservation, reset behavior, and search-freshness changes.
**Output**: Red query/route/filter tests.
**Acceptance**: Tests fail because tag predicates and freshness inputs are absent.

### ⬜ Unit 6.3b: Tag Filters And Search - Implementation
**What**: Add bounded query/filter helpers and accessible My Recipes/search controls with safe pagination/link preservation and freshness integration.
**Output**: Course/tag discovery on existing bounded surfaces.
**Acceptance**: Focused query/route tests and build pass; no home/profile expansion occurs.

### ⬜ Unit 6.3c: Tag Filters And Search - Verification
**What**: Reach 100% query/UI coverage and obtain SQL/search/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Empty/malformed/multi-filter/pagination/freshness branches are covered and review converges.

### ⬜ Unit 6.4a: Tag Read Parity - Tests
**What**: Add failing detail/card/REST/MCP parity tests against persisted tags/course, deterministic order, public visibility, and no write/AI/save metadata.
**Output**: Red read-surface integration tests.
**Acceptance**: Tests fail until persisted tag data reaches every planned read surface.

### ⬜ Unit 6.4b: Tag Read Parity - Implementation
**What**: Complete recipe query includes and displays/serializers so persisted tags/course reach detail, bounded cards, REST, and MCP.
**Output**: End-to-end manual metadata read parity.
**Acceptance**: Focused parity tests and generated contracts pass.

### ⬜ Unit 6.4c: Tag Read Parity - Verification
**What**: Reach 100% integration coverage, run full gates, and obtain API/product review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: All empty/order/privacy branches are covered and review converges.

### ⬜ Unit 6.5: Tag Visual QA
**What**: Run `visual-qa-dogfood` on authoring, recipe metadata, My Recipes, and search at mobile and desktop sizes.
**Output**: Screenshots, metrics, and closed absurdity ledger.
**Acceptance**: Long tags fit, controls are keyboard accessible, filter state is legible, and no layout defect remains.

### ⬜ Unit 7.1a: Cook Contracts And Auth - Tests
**What**: Add failing pure/Worker tests for v1 snapshot/state/command schemas, server-built snapshots, route grammar, auth, same-origin validation, server-derived DO identity, private no-store responses, malformed bodies, and WebSocket 101 non-cloning.
**Output**: Red cook-contract and Worker-router tests.
**Acceptance**: Focused tests fail against the inert bootstrap/runtime router.

### ⬜ Unit 7.1b: Cook Contracts And Auth - Implementation
**What**: Add shared cook contract validators/serializers and authenticated Worker routing with canonical D1 snapshot construction.
**Output**: Secure typed HTTP/WebSocket transport boundary.
**Acceptance**: Focused pure/Worker tests, typecheck, and build pass.

### ⬜ Unit 7.1c: Cook Contracts And Auth - Verification
**What**: Reach 100% contract/router coverage and obtain security/API review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every auth/origin/cache/validation/upgrade branch is covered and review converges.

### ⬜ Unit 7.2a: Cook State Machine - Tests
**What**: Add failing Workers-runtime tests for SQLite initialization, concurrent start convergence, server-minted attempts, revision/stale-attempt conflicts, mutation replay, snapshot persistence/eviction, update validation, idempotent terminal commands, and atomic edit restart.
**Output**: Red real-DO state-machine tests.
**Acceptance**: Tests fail because the inert class has no state machine.

### ⬜ Unit 7.2b: Cook State Machine - Implementation
**What**: Implement the SQLite-backed `CookSession` attempt/snapshot/progress/mutation-receipt state machine.
**Output**: Durable canonical cook state independent of D1 projection.
**Acceptance**: Focused Workers tests pass under serialized shared storage.

### ⬜ Unit 7.2c: Cook State Machine - Verification
**What**: Reach 100% state-machine coverage and obtain concurrency/model review.
**Output**: Workers coverage and reviewer evidence.
**Acceptance**: Every transition/conflict/replay/eviction/error branch is covered and review converges.

### ⬜ Unit 7.3a: Projection And Alarm - Tests
**What**: Add failing Workers tests for metadata allowlist/bounds, synchronous initial projection/503 retry, conditional highest-revision upsert, delayed failure retry, terminal non-resurrection, persisted backoff, one-alarm collision scheduling, and bounded privacy-safe telemetry.
**Output**: Red projection/scheduler tests using real D1/DO storage.
**Acceptance**: Tests fail because projection and scheduler behavior is absent.

### ⬜ Unit 7.3b: Projection And Alarm - Implementation
**What**: Implement metadata-only D1 projection plus persisted monotonic retry/alarm scheduler and observability.
**Output**: Durable private registry/discovery projection.
**Acceptance**: Focused Workers projection/alarm tests pass and D1 contains no progress field.

### ⬜ Unit 7.3c: Projection And Alarm - Verification
**What**: Reach 100% projection/scheduler coverage and obtain Cloudflare/data/privacy review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every retry/fencing/collision/telemetry branch is covered and review converges.

### ⬜ Unit 7.4a: Cook WebSockets - Tests
**What**: Add failing real-runtime tests for authenticated upgrade, canonical initial snapshot, hibernatable fan-out, reconnect after eviction, stale socket/attempt rejection, close behavior, and HTTP-response security separation.
**Output**: Red WebSocket tests under `--max-workers=1 --no-isolate`.
**Acceptance**: Tests fail because socket handling is absent.

### ⬜ Unit 7.4b: Cook WebSockets - Implementation
**What**: Implement hibernatable WebSocket attachment/fan-out/reconnect/close behavior on the DO and Worker route.
**Output**: Live canonical cross-device snapshot channel.
**Acceptance**: Focused real-runtime WebSocket tests pass without response cloning or warnings.

### ⬜ Unit 7.4c: Cook WebSockets - Verification
**What**: Reach 100% socket coverage and obtain Cloudflare/security review.
**Output**: Workers coverage and reviewer evidence.
**Acceptance**: Every upgrade/message/reconnect/stale/close branch is covered and review converges.

### ⬜ Unit 7.5a: Retention And Purge - Tests
**What**: Add failing Workers tests for 24-hour terminal retention, replay during retention, active-list exclusion, projection-before-purge ordering, socket closure, `deleteAlarm`, storage deletion, owner-only purge, partial failure retry, and known-object cleanup.
**Output**: Red retention/purge/cleanup tests.
**Acceptance**: Tests fail because terminal lifecycle and purge are absent.

### ⬜ Unit 7.5b: Retention And Purge - Implementation
**What**: Implement terminal retention, ordered purge, owner cleanup helper, and active registry list/detail/purge endpoints.
**Output**: Recoverable lifecycle cleanup with complete D1 registry until purge.
**Acceptance**: Focused Workers/API cleanup tests pass and zero-residue assertions succeed.

### ⬜ Unit 7.5c: Retention And Purge - Verification
**What**: Reach 100% retention/purge coverage, run full Workers/app gates, and obtain privacy/recovery review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every retention/deletion/failure/retry branch is covered and review converges.

### ⬜ Unit 8.1a: Cook Client Transport - Tests
**What**: Add failing hook/client tests for authenticated start/get/update/terminal/restart/purge requests, outgoing URL/body/headers, revision/mutation IDs, socket snapshots, reconnect/backoff, 409 reconciliation, and error states.
**Output**: Red `test/hooks/useCookSession.test.tsx` transport tests.
**Acceptance**: Tests fail because the authenticated client transport is absent.

### ⬜ Unit 8.1b: Cook Client Transport - Implementation
**What**: Add the authenticated cook client and `useCookSession` transport/state hook.
**Output**: One tested browser adapter for the cook API/WebSocket.
**Acceptance**: Focused hook tests, typecheck, and build pass.

### ⬜ Unit 8.1c: Cook Client Transport - Verification
**What**: Reach 100% hook/client coverage and obtain adapter/reconnect review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every request/reconnect/conflict/error branch and outgoing shape is covered; review converges.

### ⬜ Unit 8.2a: Cook Mode UI - Tests
**What**: Add failing route/component tests for extracted cook panel, authenticated start/resume, step/checklist/scale updates, mismatch choices, completion/abandonment, reconnect/error feedback, and preserved anonymous local reload behavior.
**Output**: Red cook-panel and recipe-route tests.
**Acceptance**: Tests fail because authenticated cook mode still uses local-only route state.

### ⬜ Unit 8.2b: Cook Mode UI - Implementation
**What**: Extract `CookModePanel` and integrate authenticated hook state while retaining the anonymous local adapter.
**Output**: Dual authenticated/anonymous cook UI with explicit mismatch and terminal actions.
**Acceptance**: Focused route/component tests and build pass.

### ⬜ Unit 8.2c: Cook Mode UI - Verification
**What**: Reach 100% route/component coverage and obtain product/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every UI state/action/error branch is covered and review converges.

### ⬜ Unit 8.3a: Home Cook Discovery - Tests
**What**: Add failing loader/component/fake-timer tests for private newest-first rows, immediate mount/focus/visibility/online refresh, five-second empty polling, hidden/offline stop, found-session stop, and no visitor polling.
**Output**: Red home discovery tests.
**Acceptance**: Tests fail because the continue-cooking section and revalidator are absent.

### ⬜ Unit 8.3b: Home Cook Discovery - Implementation
**What**: Add the private active-session query/card and bounded home revalidation controller.
**Output**: Recipe-ID-free second-device discovery.
**Acceptance**: Focused home tests and build pass with maximum five-second visible/online discovery.

### ⬜ Unit 8.3c: Home Cook Discovery - Verification
**What**: Reach 100% loader/timer/event coverage and obtain privacy/performance review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every visibility/network/list-state branch is covered and review converges.

### ⬜ Unit 8.4a: Principal Isolation - Tests
**What**: Add failing browser-state tests for anonymous -> user A -> logout -> user B, stale sockets, legacy `spoonjoy-cook-progress:*` keys, account change, and zero anonymous upload/read by authenticated code.
**Output**: Red principal-transition tests.
**Acceptance**: Tests fail on missing authenticated isolation teardown only, while anonymous local behavior remains green.

### ⬜ Unit 8.4b: Principal Isolation - Implementation
**What**: Add logout/unmount/socket teardown and principal-scoped in-memory reset without reading, migrating, or deleting anonymous recipe progress.
**Output**: Explicit browser principal isolation.
**Acceptance**: Focused transition tests pass with no cross-user state exposure.

### ⬜ Unit 8.4c: Principal Isolation - Verification
**What**: Reach 100% teardown/storage coverage and obtain security/privacy review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every stale/unmount/logout/storage branch is covered and review converges.

### ⬜ Unit 8.5a: Two-Context Cook Flow - Tests
**What**: Add failing Playwright flow for initially empty second home, start on device A, discovery on B, bidirectional step/checklist/scale sync, reconnect, mismatch choice, terminal removal, and disposable cleanup.
**Output**: Red `e2e/cook-session-cross-device.spec.ts` evidence.
**Acceptance**: The browser flow fails only on missing integrated behavior.

### ⬜ Unit 8.5b: Two-Context Cook Flow - Implementation
**What**: Fix integration-only gaps and add deterministic e2e setup/cleanup hooks without changing the approved contracts.
**Output**: Passing real two-context flow.
**Acceptance**: Focused Playwright test passes repeatedly with zero residue.

### ⬜ Unit 8.5c: Two-Context Cook Flow - Verification
**What**: Run repeated focused Playwright plus app/Workers/full gates and obtain end-to-end review.
**Output**: Browser stability and reviewer evidence.
**Acceptance**: Repeated runs pass without flake/warning and review converges.

### ⬜ Unit 8.6: Cook Experience Visual QA
**What**: Run `visual-qa-dogfood` on anonymous/authenticated cook mode, continue-cooking, mismatch, reconnect, terminal, and long-content states at mobile and desktop sizes.
**Output**: Screenshots, pixel/interaction metrics, and closed absurdity ledger.
**Acceptance**: No overlap/truncation/unreachable control exists; the workflow remains calm and usable.

### ⬜ Unit 9.1a: Feature Smoke Runner - Tests
**What**: Add failing runner tests for two-client cook, shopping restore, save independence, tags/filters, REST/MCP scaling/metadata, exact target/version checks, sanitized artifacts, and failure propagation.
**Output**: Red existing-smoke-runner extension tests.
**Acceptance**: Focused tests fail because Clem feature smoke coverage is absent.

### ⬜ Unit 9.1b: Feature Smoke Runner - Implementation
**What**: Extend the existing live smoke/API smoke helpers with the focused feature scenarios and no new orchestration layer.
**Output**: One reusable QA/production Clem feature smoke mode.
**Acceptance**: Focused runner tests, script typecheck, and build pass.

### ⬜ Unit 9.1c: Feature Smoke Runner - Verification
**What**: Reach 100% runner coverage and obtain security/API/release review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every target/version/failure/sanitization branch is covered and review converges.

### ⬜ Unit 9.2a: Feature Cleanup - Tests
**What**: Add failing cleanup tests for socket closure, known DO purge, CookSessionIndex/SavedRecipe/RecipeTag/shopping/user deletion order, partial failure retry, local/QA/production target isolation, and zero-residue assertions.
**Output**: Red cleanup-helper/script tests.
**Acceptance**: Tests fail because new feature residue is not yet enumerated/purged.

### ⬜ Unit 9.2b: Feature Cleanup - Implementation
**What**: Extend existing cleanup helpers/scripts for the new D1/DO/data graph with dry-run and explicit apply behavior.
**Output**: Idempotent target-scoped feature cleanup.
**Acceptance**: Focused cleanup tests and script typecheck pass; no remote mutation occurs in tests.

### ⬜ Unit 9.2c: Feature Cleanup - Verification
**What**: Reach 100% cleanup coverage and obtain privacy/destructive-operation review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every ordering/retry/target/error branch is covered and review converges.

### ⬜ Unit 9.3: Final Local Verification And Cold Reviews
**What**: Run cleanup, Prisma generation/push, numeric migrations twice, generated-contract diff, script/app typechecks, full app/Workers coverage, Playwright, build, boundary oracle, and clean-tree checks; run fresh implementation, test, security/privacy, migration/release, API, and design reviews.
**Output**: Final local logs and converged reviewer reports.
**Acceptance**: Every command passes with 100% new-code coverage and zero warnings; no review has an open BLOCKER/MAJOR; branch is clean and pushed.

### ⬜ Unit 9.4: Product QA
**What**: Apply migration/deploy to QA, verify exact version, run two-client and REST/MCP feature smoke plus visual QA, then run feature cleanup and zero-residue checks.
**Output**: Sanitized QA deployment/smoke/visual/cleanup evidence.
**Acceptance**: Every QA scenario passes and no disposable D1/DO/R2/user data remains.

### ⬜ Unit 9.5: Product PR And CI
**What**: Open the product PR, complete self/cold review, resolve all required comments and CI failures, rerun changed gates, and merge only the exact reviewed head.
**Output**: Product PR URL, review disposition, and exact merge SHA.
**Acceptance**: Required reviews/checks are green, no unresolved comment remains, and merged tree equals the final reviewed product tree.

### ⬜ Unit 9.6: Production Canary Deployment
**What**: Follow the automatic post-boundary version upload, 0% candidate smoke, 100% promotion, and exact merge-SHA/version/canonical-health verification; use only post-boundary rollback on a candidate failure.
**Output**: Sanitized production release/version evidence.
**Acceptance**: The product merge SHA is the sole 100% production version or the prior post-boundary version is restored with a recorded failure requiring repair.

### ⬜ Unit 9.7: Production Smoke, Visual QA, And Cleanup
**What**: Run production Clem feature smoke, two-client flow, `visual-qa-dogfood`, canonical health, cleanup, and zero-residue assertions against the promoted version.
**Output**: Production smoke/visual/cleanup evidence and closed absurdity ledger.
**Acceptance**: All product and visual checks pass on `spoonjoy.app`; no disposable production data remains.

### ⬜ Unit 9.8: Task Closure
**What**: Synchronize planning/doing checklists and status, run the durable continuation scan across task docs/feedback/PR/smoke/cleanup, archive Desk state, clean obsolete worktrees/branches when safe, and notify Slugger.
**Output**: Done task docs, archived Desk record, cleanup receipt, and Slugger completion message.
**Acceptance**: No ready required work or residue remains and every terminal artifact points to the shipped production merge.

## Execution
- **TDD strictly enforced**: tests -> red -> implement -> green -> refactor.
- Commit after each phase and push after every atomic commit.
- Run the full app suite before closing every implementation/refactor unit; run the Workers suite for every Worker/DO change.
- Run `visual-qa-dogfood` before closing every UI unit.
- Save logs, screenshots, reviews, and QA outputs under `./2026-07-19-1505-doing-clem-feedback-ship/`.
- Update this doing doc, the planning checklist, Desk continuity, and branch/PR/deploy state after each material phase.
- Use fresh sub-agent review for non-trivial units and fixes; surface only true credential/capability or unsafe destructive-production blockers.

## Progress Log
- 2026-07-19 15:34 Created from the approved focused planning doc.
