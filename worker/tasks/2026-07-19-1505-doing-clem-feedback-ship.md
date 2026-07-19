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
- [ ] The numeric migration applies from empty and from `test/fixtures/clem-feedback-pre-feature.sql` atop migrations 0000-0023, preserves foreign keys, reconciles its specified three unitless duplicates without quantity loss, produces exactly four saved rows, and matches Prisma-modeled tables/columns plus documented raw indexes.
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
**What**: Record clean branch/upstream state, plan/source hashes, Node/pnpm/Cloudflare versions, and baseline gates. Create the fixture with every literal value/FK frozen in planning; record raw-fixture SHA-256 and the migration-set SHA-256 generated by bytewise filename order with `filename NUL bytes NUL`; map every feedback row.
**Output**: Baseline logs, fixture/hash manifest, and feedback-to-unit map in the artifacts directory plus the committed seed fixture.
**Acceptance**: 7,226 existing tests pass at 100% app coverage; fixture atop migrations 0000-0023 yields the exact five memberships/three active duplicates; typecheck/build pass; `git status --porcelain` is empty after commit; every source row maps to a unit or explicit rejection test.

### ⬜ Unit 1.1a: Namespace Bootstrap - Tests
**What**: Add failing config/runtime tests for class `CookSession`, binding `COOK_SESSIONS`, top-level/QA `v1_cook_session` `new_sqlite_classes`, environment types, SQLite storage, and the frozen public/internal probe paths, header, body, object name, success body, two-run idempotence, and mismatch/bootstrap-disabled 404s.
**Output**: Red `test/config/cook-session-binding.test.ts` and `test/workers/cook-session-bootstrap.test.ts` evidence.
**Acceptance**: `pnpm exec vitest run test/config/cook-session-binding.test.ts test/workers/cook-session-bootstrap.test.ts` fails only on absent namespace code/config.

### ⬜ Unit 1.1b: Namespace Bootstrap - Implementation
**What**: Add the inert `workers/cook-session.ts` export and bootstrap route in `workers/app.ts` plus `wrangler.json` production/QA binding, `COOK_SESSION_BOOTSTRAP_MODE=1`, legacy migration, and `app/cloudflare-env.d.ts` types. The DO probe creates/reads/drops its private table and deletes all storage before returning the exact planning-contract body.
**Output**: One deployable inert SQLite DO namespace.
**Acceptance**: Unit 1.1a tests pass and `pnpm run typecheck` plus `pnpm run build` are green.

### ⬜ Unit 1.1c: Namespace Bootstrap - Verification
**What**: Cover every namespace/config branch and review storage/lifecycle correctness.
**Output**: Focused coverage and reviewer report.
**Acceptance**: Namespace code is 100% covered and a fresh Cloudflare review has no BLOCKER/MAJOR finding.

### ⬜ Unit 1.2a: Workers Test Lane - Tests
**What**: Add failing tests for `vitest.workers.config.ts`, `wrangler.workers-test.json`, exact Vitest `4.1.10`/Workers pool `0.18.6`, Istanbul 100% thresholds, serialized shared storage, warning failure, package commands, and CI invocation.
**Output**: Red `test/config/workers-vitest-lane.test.ts` and workflow-contract evidence.
**Acceptance**: Focused tests fail only because the Workers lane/dependencies are absent.

### ⬜ Unit 1.2b: Workers Test Lane - Implementation
**What**: Upgrade all Vitest packages to `4.1.10`, add `@cloudflare/vitest-pool-workers@0.18.6`, `vitest.workers.config.ts`, `wrangler.workers-test.json`, `test:workers`/`test:workers:coverage`, and the mandatory CI job.
**Output**: Executable official Workers-runtime test and coverage lane.
**Acceptance**: `pnpm run test:workers` and app typecheck/build pass with no warnings.

### ⬜ Unit 1.2c: Workers Test Lane - Verification
**What**: Run both app and Workers coverage and review config/CI isolation.
**Output**: Dual 100% coverage reports and reviewer result.
**Acceptance**: Worker bootstrap files and new config logic reach 100%; app remains 100%; fresh test-infrastructure review converges.

### ⬜ Unit 1.3a: Bootstrap Deployment Mode - Tests
**What**: Add failing tests in `test/scripts/deploy-production-canary.test.ts`, `test/scripts/deployment-preflight.test.ts`, and `test/release-workflow-security.test.ts` for `.github/workflows/production-deploy.yml` atomic bootstrap mode, exact-SHA/version/probe verification, no pre-boundary rollback, sanitized artifact output, and restored canary mode.
**Output**: Red named deploy/workflow contract tests.
**Acceptance**: Focused tests fail only because lifecycle-aware deployment behavior is absent.

### ⬜ Unit 1.3b: Bootstrap Deployment Mode - Implementation
**What**: Extend `scripts/deploy-production-canary.ts`, `.github/workflows/production-deploy.yml`, and `docs/deployment.md` with the one-time atomic `wrangler deploy` branch and post-boundary canary branch, without a new orchestrator.
**Output**: One reviewed lifecycle-aware production deployment mode.
**Acceptance**: Focused deploy/workflow tests, typecheck, build, and full app coverage pass.

### ⬜ Unit 1.3c: Bootstrap Deployment Mode - Verification
**What**: Cover every deployment decision/failure/artifact branch and obtain release/security review.
**Output**: 100% deploy-script coverage and reviewer report.
**Acceptance**: No secret reaches logs/artifacts; no invalid rollback is possible; review converges.

### ⬜ Unit 1.4: Bootstrap QA
**What**: Deploy the inert namespace to QA; call `POST /.well-known/spoonjoy-cook-session-bootstrap` twice; assert `{ok:true,storage:'sqlite',workerVersionId:<deployed version>,residue:0}` and matching version header; then confirm no `CookSessionIndex` row or probe storage remains.
**Output**: Sanitized QA deployment, smoke, and cleanup logs.
**Acceptance**: QA has `v1_cook_session`, the inert DO responds, and no disposable D1/DO row remains.

### ⬜ Unit 1.5: Bootstrap PR And Merge
**What**: On `worker/clem-feedback-e2e`, run final gates and open a PR to `main`. Enforce the planning-contract allowlist: focused task docs/artifacts, package/lockfile, Wrangler/env types, Worker app/new inert class, Workers-test config/tests, CI/production workflow, and existing deploy script/tests/docs only; resolve review/CI and merge.
**Output**: Bootstrap PR URL and exact merge SHA.
**Acceptance**: Required reviews/CI are green and the merge SHA contains only docs plus lifecycle/test/deploy bootstrap scope.

### ⬜ Unit 1.6: Production Lifecycle Boundary
**What**: Follow the automatic atomic production deploy, verify exact merge SHA/version, call the same frozen bootstrap probe twice, assert matching version/body and zero residue, and record the no-pre-boundary-rollback rule.
**Output**: Sanitized production deployment/version/health/cleanup evidence.
**Acceptance**: Production has the SQLite namespace, canonical health identifies the bootstrap merge, zero residue remains, and failure recovery is forward-only across this boundary.

### ⬜ Unit 1.7: Product Branch Handoff
**What**: Create `/Users/arimendelow/Projects/spoonjoy-v2-clem-feedback-product` on `worker/clem-feedback-product` from the verified merge, future base `main`; remove `COOK_SESSION_BOOTSTRAP_MODE` but retain its gated route code until Unit 7.1; rewrite `test/config/cook-session-binding.test.ts` to keep binding/migration and assert no bootstrap var, rewrite `test/workers/cook-session-bootstrap.test.ts` to assert the public probe is 404 while its internal inert probe remains covered, and switch deploy tests back to canary expectations; record all identities/paths in `bootstrap-handoff.md`.
**Output**: `bootstrap-handoff.md` and clean pushed product branch.
**Acceptance**: Merge-base succeeds; task docs remain reachable; updated binding/bootstrap/deploy tests, Workers/app coverage, typecheck, and build pass; no production config enables the public probe; Unit 2.1 starts only here.

### ⬜ Unit 2.1a: Product Models - Tests
**What**: From the Unit 1.7 handoff, add failing Prisma/schema tests for every exact scalar type/default, named relation field, key/index, FK action, and raw check frozen in planning, including nullable/no-default `Recipe.course`, SavedRecipe's sole timestamp, RecipeTag timestamps, CookSessionIndex's no-default timestamps/no recipe relation/no progress columns, and shopping `@@unique` removal.
**Output**: Red `test/models/clem-feedback-schema.test.ts` evidence.
**Acceptance**: Focused tests fail only because the models/columns are absent.

### ⬜ Unit 2.1b: Product Models - Implementation
**What**: Implement the exact frozen `Recipe.course`, `SavedRecipe`, `RecipeTag`, and `CookSessionIndex` Prisma shapes, relation fields, modeled indexes, and shopping-constraint removal in `prisma/schema.prisma`; regenerate the client and update `test/utils.ts` plus cleanup order.
**Output**: Prisma-modeled product schema aligned with tombstone-preserving shopping identity and generated types.
**Acceptance**: Model tests, Prisma generation/push, typecheck, and build pass.

### ⬜ Unit 2.1c: Product Models - Verification
**What**: Cover model helpers/cleanup branches and review ownership/FK/privacy boundaries.
**Output**: Coverage and data-review evidence.
**Acceptance**: New helper code is 100% covered and review converges.

### ⬜ Unit 2.2a: Product Schema And SavedRecipe Backfill Migration - Tests
**What**: Add failing migration assertions for empty/fixture application, every frozen schema detail, exactly four saves, user-a/recipe-r1 Jan 3 savedAt, item-b quantity 3/sort 1/unchecked/checkedAt null/deletedAt null plus selected category/icon/advanced updatedAt, item-a/item-c preserved except tombstone/advanced updatedAt, FK integrity, and deletion behavior.
**Output**: Red product-schema and saved-backfill sections of `test/scripts/migration-0024-clem-feedback-product.test.ts`.
**Acceptance**: Focused migration tests fail only because migration 0024 and all of its required schema/backfill behavior are absent.

### ⬜ Unit 2.2b: Product Schema And SavedRecipe Backfill Migration - Implementation
**What**: Create the exact frozen SavedRecipe/course/tag/cook-index schema, raw checks/indexes, and deterministic SavedRecipe backfill portion of `migrations/0024_clem_feedback_product.sql`.
**Output**: Additive new tables/column and one-time saved-state backfill.
**Acceptance**: Every schema, absence-of-progress-state, index, constraint, FK, and saved-backfill assertion passes from both fixtures with exact counts and preserved FKs.

### ⬜ Unit 2.2c: Product Schema And SavedRecipe Backfill Migration - Verification
**What**: Rehearse the saved/schema migration under Node SQLite and local Wrangler D1 and review prior-Worker compatibility.
**Output**: Rehearsal and reviewer evidence.
**Acceptance**: Both engines agree, no existing table contract breaks, and review converges.

### ⬜ Unit 2.3a: Shopping Repair Migration - Tests
**What**: Add failing migration tests for dropping `ShoppingListItem_shoppingListId_unitId_ingredientRefId_key`, active unitless/unit identities, deterministic duplicate survivor/state/quantity/sort handling, tombstoned extras, partial unique index enforcement, retained-tombstone re-adds with non-null units, `updatedAt`, and no quantity loss.
**Output**: Red shopping section of the migration 0024 test.
**Acceptance**: Tests fail because repair/index SQL is absent.

### ⬜ Unit 2.3b: Shopping Repair Migration - Implementation
**What**: In migration 0024, deterministically reconcile shopping duplicates, drop the existing full `ShoppingListItem_shoppingListId_unitId_ingredientRefId_key`, and create the partial expression unique index for active rows only.
**Output**: One database-enforced active shopping identity per list/ingredient/unit.
**Acceptance**: All repair/index fixtures pass and the pre-feature Worker remains compatible with the migrated schema.

### ⬜ Unit 2.3c: Shopping Repair Migration - Verification
**What**: Run duplicate-heavy migration/rollback-failure fixtures, local D1 apply/list twice, and data review.
**Output**: Shopping migration verification and review evidence.
**Acceptance**: Migration is applied once, second apply is a no-op, no data is lost, and review converges.

### ⬜ Unit 2.4a: Reviewed Migration Gate - Tests
**What**: Add failing deploy-script tests for D1 recovery bookmark, acceptance of the exact reviewed `DROP INDEX ShoppingListItem_shoppingListId_unitId_ingredientRefId_key` and 0024 statements, rejection of every unrelated `DROP INDEX`/DML/unique-index form, duplicate/backfill preflight, and post-apply verification.
**Output**: Red migration-gate tests.
**Acceptance**: Tests fail because the existing additive gate rejects the reviewed 0024 forms and lacks recovery checks.

### ⬜ Unit 2.4b: Reviewed Migration Gate - Implementation
**What**: Extend only the existing production migration gate for the deterministic 0024 forms, including the one exact reviewed legacy-index drop, recovery bookmark, preflight, and verification.
**Output**: Narrowly safe automatic product-migration path.
**Acceptance**: Gate tests pass, unrelated destructive SQL remains rejected, and script typecheck/build are green.

### ⬜ Unit 2.4c: Reviewed Migration Gate - Verification
**What**: Reach 100% gate/parser coverage and obtain migration/release/security review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every allow/reject/failure branch is covered and review converges.

### ⬜ Unit 3.1a: Atomic Shopping Service - Tests
**What**: Add failing captured-SQL tests for all frozen quantity/category/icon merges; checkedAt/deletedAt clearing; active unchecked/checked/deleted ID rules; fresh end `COALESCE(MAX,-1)+1` including empty-list index 0; unitless identity; concurrency; strictly advancing updatedAt; and atomic failure.
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
**What**: Add failing tests around `handleShoppingListAction` in `app/lib/shopping-list.server.ts` and `handleShoppingItemCreate` plus the recipe-add branch in `app/lib/api-v1.server.ts` for manual/recipe adds/restores, REST idempotency and outgoing service inputs, fresh ordering, rollback, and byte-shape-compatible check/delete/clear responses.
**Output**: Red web/REST adapter tests.
**Acceptance**: Tests fail on current separate read-then-write writers.

### ⬜ Unit 3.2b: Web And REST Shopping Adapters - Implementation
**What**: Route exactly those web/REST add symbols through the shared service while leaving their check/delete/clear branches untouched and preserving existing response/idempotency contracts.
**Output**: Thin web and REST add adapters.
**Acceptance**: Focused route/API tests and OpenAPI compatibility tests pass.

### ⬜ Unit 3.2c: Web And REST Shopping Adapters - Verification
**What**: Reach 100% adapter coverage, run full shopping/API/full gates, and obtain API review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Outgoing inputs, auth, rollback, and error branches are covered and review converges.

### ⬜ Unit 3.3a: MCP, Legacy, And Native Sync Shopping - Tests
**What**: Add failing tests around `addShoppingListItemTool` and `addRecipeToShoppingListTool` in `app/lib/spoonjoy-api.server.ts`, plus existing native-sync shopping readback, for shared additions, restored ordering, monotonic timestamps, tombstones, and explicit absence of web/MCP exactly-once claims.
**Output**: Red MCP/legacy/native-sync adapter tests.
**Acceptance**: Tests fail on the independent MCP/legacy writers and MCP sort defect.

### ⬜ Unit 3.3b: MCP, Legacy, And Native Sync Shopping - Implementation
**What**: Route exactly `addShoppingListItemTool` and `addRecipeToShoppingListTool` through the shared service and preserve native-sync serialization; do not change MCP check/remove operations.
**Output**: One add/restore behavior across all existing writers.
**Acceptance**: Focused MCP/legacy/native tests pass with unchanged non-add contracts.

### ⬜ Unit 3.3c: MCP, Legacy, And Native Sync Shopping - Verification
**What**: Run the shared cross-surface matrix, 100% coverage, full gates, and fresh API/sync review.
**Output**: Matrix, coverage, and reviewer evidence.
**Acceptance**: All surfaces pass one state matrix and review converges.

### ⬜ Unit 4.1a: Neutral Recipe Metadata - Tests
**What**: Add failing tests for top-level `course`/`tags` on `recipeDetail` in `app/lib/api-v1.server.ts`, `formatRecipe`/`formatRecipeSummary` and MCP `get_recipe`/`list_recipes`/`search_spoonjoy` in `app/lib/spoonjoy-api.server.ts`, their REST list/detail/search routes, OpenAPI, and generated playground, with no personalized save state.
**Output**: Red metadata contract tests.
**Acceptance**: Tests fail because course/tags are absent from shared serializers and schemas.

### ⬜ Unit 4.1b: Neutral Recipe Metadata - Implementation
**What**: Add shared metadata serialization and wire exactly the Unit 4.1a symbols/routes plus `app/lib/api-v1-openapi.server.ts`, `app/lib/generated/api-v1-playground.ts`, and existing developer API docs.
**Output**: Neutral course/tag read parity.
**Acceptance**: Focused metadata/API/MCP/OpenAPI tests pass and two consecutive playground generations leave no git diff.

### ⬜ Unit 4.1c: Neutral Recipe Metadata - Verification
**What**: Reach 100% serializer/adapter coverage and obtain API compatibility review.
**Output**: Coverage, generated diff, and reviewer evidence.
**Acceptance**: Every empty/order/privacy branch is covered and review converges.

### ⬜ Unit 4.2a: Read-Time Scaling - Tests
**What**: Add failing pure/REST/MCP tests for the exact frozen `GET /api/v1/recipes/:id?scale=` and MCP `get_recipe({scale})` contract: finite `0.1..100`, top-level scale metadata, six-decimal ingredient quantity rounding, unchanged servings/storage, absent-argument payload compatibility, REST `validation_error` field `scale`, and MCP invalid-argument mapping.
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
**What**: Add failing source/runtime tests targeting `app/lib/analytics-server.ts` and the current Pebble fixtures in `test/lib/analytics-server.test.ts`, `test/routes/agent-connect.test.tsx`, and `test/routes/api-v1-telemetry.test.ts`; also assert no first-party import UI, AI tagging surface, navigation change, or personalized save metadata in MCP/public reads.
**Output**: Red `test/config/clem-feedback-boundaries.test.ts` evidence.
**Acceptance**: Tests fail on the existing Pebble-specific analytics branch/fixtures only.

### ⬜ Unit 4.3b: Neutral Boundary - Implementation
**What**: Remove only the Pebble branch in `app/lib/analytics-server.ts`, replace only those named fixtures with neutral client strings, and add the focused boundary oracle without modifying import/navigation behavior.
**Output**: Partner-neutral runtime and executable rejection guard.
**Acceptance**: Boundary tests and existing navigation/import tests pass.

### ⬜ Unit 4.3c: Neutral Boundary - Verification
**What**: Reach 100% boundary/analytics coverage, scan changed source/docs, and obtain scope review.
**Output**: Coverage, scan, and reviewer evidence.
**Acceptance**: No prohibited runtime behavior remains and review converges.

### ⬜ Unit 5.1a: Saved Service And Cursor - Tests
**What**: Add failing service/query tests for the frozen search fields/normalization, exact unpadded cursor JSON, explicit save/unsave, cookbook independence, owner scoping, soft/hard deletion, strict descending tie predicate, 24-row bound, and SQL `LIMIT 25` next-page detection without full materialization.
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
**What**: Add failing `test/routes/api-v1-saved-recipes.test.ts` plus existing API v1 OpenAPI/route-coverage/developer-doc tests for the exact envelopes/statuses/bodies, scopes, privacy, malformed semantic errors, cache headers, soft deletion, replay, and outgoing service inputs.
**Output**: Red saved REST/OpenAPI/contract/docs adapter tests.
**Acceptance**: Tests fail because the saved routes/contracts are absent.

### ⬜ Unit 5.2b: Saved REST API - Implementation
**What**: Add handlers in `app/lib/api-v1.server.ts`, operation/scope mapping in `app/lib/api-v1-contract.server.ts`, schemas/routes in `app/lib/api-v1-openapi.server.ts`, regenerated `app/lib/generated/api-v1-playground.ts`, and documentation in `docs/api.md` plus `app/routes/developers.tsx`, all using the saved service.
**Output**: Private documented SavedRecipe REST contract.
**Acceptance**: Focused API/OpenAPI tests and generated diff pass.

### ⬜ Unit 5.2c: Saved REST API - Verification
**What**: Reach 100% REST adapter coverage and obtain API/security review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Auth/cache/idempotency/error branches and outgoing inputs are covered; review converges.

### ⬜ Unit 5.3a: Saved Web Experience - Tests
**What**: Add failing `test/routes/saved-recipes.test.tsx`, `test/lib/recipe-detail.server.test.ts`, and `test/routes/recipes-id.test.tsx` cases for paginated `/saved-recipes`, recipe-detail save/unsave action/UI, distinct cookbook copy/control, independence, empty/search/error states, and keyboard behavior.
**Output**: Red saved-page and recipe-detail UI tests.
**Acceptance**: Tests fail because web still derives saves from cookbook membership.

### ⬜ Unit 5.3b: Saved Web Experience - Implementation
**What**: Convert `app/routes/saved-recipes.tsx` to `app/lib/saved-recipes.server.ts`; add the dedicated save action in `app/lib/recipe-detail.server.ts` and save UI alongside distinctly labeled cookbook controls in `app/routes/recipes.$id.tsx`.
**Output**: Independent private saved-recipe web workflow.
**Acceptance**: Focused route/component tests and app typecheck/build pass.

### ⬜ Unit 5.3c: Saved Web Experience - Verification
**What**: Reach 100% route/component coverage, run full gates, and obtain product/accessibility/privacy review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every UI/action/empty/error branch is covered and review converges.

### ⬜ Unit 5.4: Saved Web Visual QA
**What**: Run `visual-qa-dogfood` on recipe save/cookbook controls and saved empty/populated/search/pagination states at 390x844 and 1440x900.
**Output**: Screenshots, metrics, and closed absurdity ledger.
**Acceptance**: Save and cookbook controls have distinct accessible names, keyboard focus, and at least 44px targets; screenshots show no horizontal overflow, overlap, or truncation; the absurdity ledger has no open item.

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
**What**: Add failing tests for `RecipeBuilder` and route `action` in `app/routes/recipes.new.tsx`/`app/routes/recipes.$id.edit.tsx`: course selection, custom-tag editing, hidden payload, validation errors, owner-only create/edit, and atomic recipe/tag writes through the new service.
**Output**: Red authoring route/component tests.
**Acceptance**: Tests fail because authoring fields and action wiring are absent.

### ⬜ Unit 6.2b: Tag Authoring - Implementation
**What**: Add controls to `app/components/recipe/RecipeBuilder.tsx`, service `app/lib/recipe-tags.server.ts`, and transaction calls in the two named route actions.
**Output**: Manual course/tag authoring on new and edit flows.
**Acceptance**: Focused authoring tests and typecheck/build pass.

### ⬜ Unit 6.2c: Tag Authoring - Verification
**What**: Reach 100% component/action coverage and obtain product/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every payload/validation/rollback/keyboard branch is covered and review converges.

### ⬜ Unit 6.3a: Tag Filters And Search - Tests
**What**: Add failing tests in the named route/service tests for `%20`/`+` input equivalence, raw count rejection before normalization, first-occurrence dedupe/order, SQL AND, canonical URLSearchParams `q/course/tag*/page` links with `+` spaces, reset preserving q, invalid-filter 400, pre-limit predicates, page normalization, and freshness.
**Output**: Red query/route/filter tests.
**Acceptance**: Tests fail because tag predicates and freshness inputs are absent.

### ⬜ Unit 6.3b: Tag Filters And Search - Implementation
**What**: Update exactly `app/routes/my-recipes.tsx`, `app/lib/my-recipes-search.server.ts`, `app/routes/search.tsx`, and `app/lib/search.server.ts` with query/filter helpers, accessible controls, safe pagination/link preservation, and freshness integration; do not change `_index.tsx` or `users.$identifier.tsx`.
**Output**: Course/tag discovery on existing bounded surfaces.
**Acceptance**: Focused query/route tests and build pass; no home/profile expansion occurs.

### ⬜ Unit 6.3c: Tag Filters And Search - Verification
**What**: Reach 100% query/UI coverage and obtain SQL/search/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Empty/malformed/multi-filter/pagination/freshness branches are covered and review converges.

### ⬜ Unit 6.4a: Tag Read Parity - Tests
**What**: Add failing persisted-data parity tests for recipe detail, My Recipes cards, global-search cards, REST recipe list/detail/search, and MCP `get_recipe`/`list_recipes`/`search_spoonjoy`; assert deterministic tags, public course/tags, and no write/AI/save metadata.
**Output**: Red read-surface integration tests.
**Acceptance**: Tests fail until persisted tag data reaches recipe detail, My Recipes cards, global-search cards, REST recipe list/detail/search, and MCP `get_recipe`/`list_recipes`/`search_spoonjoy`.

### ⬜ Unit 6.4b: Tag Read Parity - Implementation
**What**: Complete includes/displays/serializers in `app/lib/recipe-detail.server.ts`, `app/routes/recipes.$id.tsx`, `app/routes/my-recipes.tsx`, `app/routes/search.tsx`, `app/lib/search.server.ts`, `app/lib/api-v1.server.ts`, and `app/lib/spoonjoy-api.server.ts` for exactly the Unit 6.4a surfaces.
**Output**: End-to-end manual metadata read parity.
**Acceptance**: Focused parity tests and generated contracts pass.

### ⬜ Unit 6.4c: Tag Read Parity - Verification
**What**: Reach 100% integration coverage, run full gates, and obtain API/product review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: All empty/order/privacy branches are covered and review converges.

### ⬜ Unit 6.5: Tag Visual QA
**What**: Run `visual-qa-dogfood` on authoring, recipe metadata, My Recipes, and search at 390x844 and 1440x900, including ten 40-code-point tags and empty filters.
**Output**: Screenshots, metrics, and closed absurdity ledger.
**Acceptance**: No horizontal overflow, overlap, or truncation occurs; all controls have reachable focus and at least 44px targets; active filters have programmatic selected state and visible labels; the absurdity ledger has no open item.

### ⬜ Unit 7.1a: Cook Contracts And Auth - Tests
**What**: Add failing tests for every exact cook HTTP route/status/envelope/body/error, exact nested snapshot/list item/SQLite scalar contract, SHA-256 snapshot/request hashing and sort order, 200-code-point projection truncation, same-origin/auth/cache rule, `idFromName(JSON.stringify([userId,recipeId]))`, and WebSocket 101 non-cloning frozen in planning.
**Output**: Red cook-contract and Worker-router tests.
**Acceptance**: Focused tests fail against the inert bootstrap/runtime router.

### ⬜ Unit 7.1b: Cook Contracts And Auth - Implementation
**What**: Add `app/lib/cook-session-contract.ts` validators/serializers and `workers/cook-session-api.ts`; dispatch the exact routes from `workers/app.ts` before React Router, authenticate with existing session helpers, derive the DO identity server-side, and build the pinned snapshot from D1.
**Output**: Secure typed HTTP/WebSocket transport boundary.
**Acceptance**: Focused pure/Worker tests, typecheck, and build pass.

### ⬜ Unit 7.1c: Cook Contracts And Auth - Verification
**What**: Reach 100% contract/router coverage and obtain security/API review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every auth/origin/cache/validation/upgrade branch is covered and review converges.

### ⬜ Unit 7.2a: Cook State Machine - Tests
**What**: Add failing Workers-runtime tests for every frozen SQLite NOT NULL/check/no-default rule; concurrent start; server-minted attempts; normalized operation/body keys plus `(a<b?-1:a>b?1:0)` checked-ID ordering before SHA-256; stale conflicts; progress validation; eviction; terminal idempotence; and atomic restart.
**Output**: Red real-DO state-machine tests.
**Acceptance**: Tests fail because the inert class has no state machine.

### ⬜ Unit 7.2b: Cook State Machine - Implementation
**What**: Implement the exact frozen SQLite-backed tables and transition/error contract in `workers/cook-session.ts`; retain receipts for the attempt plus terminal window and reject a reused mutation ID whose request hash differs.
**Output**: Durable canonical cook state independent of D1 projection.
**Acceptance**: Focused Workers tests pass under serialized shared storage.

### ⬜ Unit 7.2c: Cook State Machine - Verification
**What**: Reach 100% state-machine coverage and obtain concurrency/model review.
**Output**: Workers coverage and reviewer evidence.
**Acceptance**: Every transition/conflict/replay/eviction/error branch is covered and review converges.

### ⬜ Unit 7.3a: Projection And Alarm - Tests
**What**: Add failing Workers tests for the exact CookSessionIndex allowlist/schema, 200-code-point title bound, synchronous initial projection/503 error, revision-fenced upsert, retry delays `1/5/30/120/600` seconds, terminal non-resurrection, one alarm choosing the earlier deadline with due purge first, and the frozen telemetry allowlist/clamps.
**Output**: Red projection/scheduler tests using real D1/DO storage.
**Acceptance**: Tests fail because projection and scheduler behavior is absent.

### ⬜ Unit 7.3b: Projection And Alarm - Implementation
**What**: Implement metadata-only D1 projection, exact persisted retry schedule/alarm precedence, and only the frozen privacy-safe telemetry fields in `workers/cook-session.ts`.
**Output**: Durable private registry/discovery projection.
**Acceptance**: Focused Workers projection/alarm tests pass and D1 contains no progress field.

### ⬜ Unit 7.3c: Projection And Alarm - Verification
**What**: Reach 100% projection/scheduler coverage and obtain Cloudflare/data/privacy review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every retry/fencing/collision/telemetry branch is covered and review converges.

### ⬜ Unit 7.4a: Cook WebSockets - Tests
**What**: Add failing real-runtime tests for authenticated upgrade, exact snapshot/error envelopes, receive-only behavior, client-message error `client_messages_unsupported` then close `1003/client-messages-unsupported`, hibernatable fan-out/reconnect, old-attempt `4009/stale-attempt`, terminal/purge `1000/session-terminal|session-purged`, and HTTP security separation.
**Output**: Red WebSocket tests under `--max-workers=1 --no-isolate`.
**Acceptance**: Tests fail because socket handling is absent.

### ⬜ Unit 7.4b: Cook WebSockets - Implementation
**What**: Implement server-to-client-only hibernatable WebSocket attachment/fan-out/reconnect and exact envelope/close-code behavior on `CookSession` and `workers/cook-session-api.ts`; reject client data messages with the frozen protocol error.
**Output**: Live canonical cross-device snapshot channel.
**Acceptance**: Focused real-runtime WebSocket tests pass without response cloning or warnings.

### ⬜ Unit 7.4c: Cook WebSockets - Verification
**What**: Reach 100% socket coverage and obtain Cloudflare/security review.
**Output**: Workers coverage and reviewer evidence.
**Acceptance**: Every upgrade/message/reconnect/stale/close branch is covered and review converges.

### ⬜ Unit 7.5a: Retention And Purge - Tests
**What**: Add failing Workers tests for 24-hour terminal/receipt retention, replay during retention, active-list exclusion, due-purge alarm precedence, close -> D1 delete -> alarm/storage delete ordering, exact 503 `purge_incomplete`, 60-second retry with storage preserved, owner-only purge, and D1-row-enumerated cleanup.
**Output**: Red retention/purge/cleanup tests.
**Acceptance**: Tests fail because terminal lifecycle and purge are absent.

### ⬜ Unit 7.5b: Retention And Purge - Implementation
**What**: Implement the exact frozen retention/purge sequence and errors in `workers/cook-session.ts`/`workers/cook-session-api.ts`, plus owner cleanup that enumerates `CookSessionIndex` rows before calling each server-derived DO; list returns only `status='active'` ordered by `updatedAt DESC, recipeId DESC`.
**Output**: Recoverable lifecycle cleanup with complete D1 registry until purge.
**Acceptance**: Focused Workers/API cleanup tests pass and zero-residue assertions succeed.

### ⬜ Unit 7.5c: Retention And Purge - Verification
**What**: Reach 100% retention/purge coverage, run full Workers/app gates, and obtain privacy/recovery review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every retention/deletion/failure/retry branch is covered and review converges.

### ⬜ Unit 8.1a: Cook Client Transport - Tests
**What**: Add failing client/hook tests for outgoing shapes and the total frozen close/detail response table: active adoption, terminal/404 stop/list refresh, 401/403/other 4xx stop, 409 canonical active-or-terminal, 5xx/network backoff, unlisted close protocol-stop, offline/online, successful-open reset, and every named close/reconnect delay.
**Output**: Red `test/hooks/useCookSession.test.tsx` transport tests.
**Acceptance**: Tests fail because the authenticated client transport is absent.

### ⬜ Unit 8.1b: Cook Client Transport - Implementation
**What**: Add `app/lib/cook-session-client.ts` and `app/hooks/useCookSession.ts` as the sole authenticated browser transport/state hook.
**Output**: One tested browser adapter for the cook API/WebSocket.
**Acceptance**: Focused hook tests, typecheck, and build pass.

### ⬜ Unit 8.1c: Cook Client Transport - Verification
**What**: Reach 100% hook/client coverage and obtain adapter/reconnect review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every request/reconnect/conflict/error branch and outgoing shape is covered; review converges.

### ⬜ Unit 8.2a: Cook Mode UI - Tests
**What**: Add failing `test/components/recipe/CookModePanel.test.tsx` and `test/routes/recipes-id.test.tsx` cases for authenticated start/resume, progress, mismatch choices, terminal actions, reconnect/errors, and preserved anonymous local reload behavior.
**Output**: Red cook-panel and recipe-route tests.
**Acceptance**: Tests fail because authenticated cook mode still uses local-only route state.

### ⬜ Unit 8.2b: Cook Mode UI - Implementation
**What**: Extract `app/components/recipe/CookModePanel.tsx`; integrate it and `useCookSession` only in `app/routes/recipes.$id.tsx`, retaining that route's anonymous local adapter without reading it in authenticated mode.
**Output**: Dual authenticated/anonymous cook UI with explicit mismatch and terminal actions.
**Acceptance**: Focused route/component tests and build pass.

### ⬜ Unit 8.2c: Cook Mode UI - Verification
**What**: Reach 100% route/component coverage and obtain product/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every UI state/action/error branch is covered and review converges.

### ⬜ Unit 8.3a: Home Cook Discovery - Tests
**What**: Add failing `test/hooks/useCookSessionDiscovery.test.tsx` and `test/routes/index.test.tsx` cases for exact private list items/order, immediate mount/focus/visibility/online refresh, five-second initially-empty polling, hidden/offline stop, found-session stop, and no visitor polling.
**Output**: Red home discovery tests.
**Acceptance**: Tests fail because the continue-cooking section and revalidator are absent.

### ⬜ Unit 8.3b: Home Cook Discovery - Implementation
**What**: Add `app/hooks/useCookSessionDiscovery.ts`; wire its active-session card/list only in `app/routes/_index.tsx` using `GET /api/cook-sessions`.
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
**Output**: Red `e2e/flows/cook-session-cross-device.spec.ts` evidence.
**Acceptance**: The browser flow fails only on missing integrated behavior.

### ⬜ Unit 8.5b: Two-Context Cook Flow - Implementation
**What**: Fix integration-only gaps and add deterministic e2e setup/cleanup hooks without changing the approved contracts.
**Output**: Passing real two-context flow.
**Acceptance**: The focused Playwright test passes three consecutive times and each run's cleanup assertions report zero residue.

### ⬜ Unit 8.5c: Two-Context Cook Flow - Verification
**What**: Run the focused Playwright test three consecutive times plus app/Workers/full gates and obtain end-to-end review.
**Output**: Browser stability and reviewer evidence.
**Acceptance**: All three runs pass without retry, flake, or warning and review converges.

### ⬜ Unit 8.6: Cook Experience Visual QA
**What**: Run `visual-qa-dogfood` on anonymous/authenticated cook mode, continue-cooking, mismatch, reconnect, terminal, and long-content states at 390x844 and 1440x900.
**Output**: Screenshots, pixel/interaction metrics, and closed absurdity ledger.
**Acceptance**: Screenshots show no horizontal overflow, overlap, or truncation; all actions are keyboard reachable with at least 44px targets; focus order follows the workflow; the absurdity ledger has no open item.

### ⬜ Unit 9.1a: Feature Smoke Runner - Tests
**What**: Add failing tests for a `--include-clem-feedback-smoke` mode in `scripts/smoke-live.mjs`/`scripts/smoke-live-helpers.mjs` and matching scenarios in `scripts/smoke-api-live.mjs`: two-client cook, shopping restore, save independence, tags/filters, REST/MCP scaling/metadata, exact target/version checks, sanitized artifacts, and failure propagation.
**Output**: Red `test/scripts/smoke-live-helpers.test.ts` and `test/scripts/smoke-api-live.test.ts` evidence.
**Acceptance**: Focused tests fail because Clem feature smoke coverage is absent.

### ⬜ Unit 9.1b: Feature Smoke Runner - Implementation
**What**: Implement that exact feature flag/scenario set in `scripts/smoke-live.mjs`, `scripts/smoke-live-helpers.mjs`, and `scripts/smoke-api-live.mjs`, reusing their existing target/version/artifact model and adding no new orchestrator.
**Output**: One reusable QA/production Clem feature smoke mode.
**Acceptance**: Focused runner tests, script typecheck, and build pass.

### ⬜ Unit 9.1c: Feature Smoke Runner - Verification
**What**: Reach 100% runner coverage and obtain security/API/release review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every target/version/failure/sanitization branch is covered and review converges.

### ⬜ Unit 9.2a: Feature Cleanup - Tests
**What**: Extend `test/scripts/cleanup-local-qa-data.test.ts` and `test/scripts/smoke-live-helpers.test.ts` with failing cases for socket closure; D1-enumerated DO purge; CookSessionIndex -> SavedRecipe/RecipeTag/shopping -> user deletion order; partial retry; local/QA/production target isolation; and zero-residue assertions.
**Output**: Red named cleanup-helper/script tests.
**Acceptance**: Tests fail because new feature residue is not yet enumerated/purged.

### ⬜ Unit 9.2b: Feature Cleanup - Implementation
**What**: Extend only `scripts/cleanup-local-qa-data.mjs` and the cleanup exports in `scripts/smoke-live-helpers.mjs` for the new D1/DO/data graph, preserving dry-run and requiring explicit apply for mutation.
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

### ⬜ Unit 9.7: Production Smoke And Visual QA
**What**: Run production Clem feature smoke, the two-client continuation flow, `visual-qa-dogfood`, and canonical-health verification against the promoted version; close the absurdity ledger from observed production behavior.
**Output**: Production smoke/visual evidence and closed absurdity ledger.
**Acceptance**: Every product and visual scenario passes on `spoonjoy.app`, canonical health identifies the promoted merge/version, and all disposable resource identifiers are captured for cleanup.

### ⬜ Unit 9.8: Production Cleanup
**What**: Close all production test sockets, purge every known disposable cook-session DO, remove its D1 projection rows and all disposable feature/user data, then run zero-residue assertions across D1, DO-accessible state, R2, and test users.
**Output**: Sanitized production cleanup receipt and zero-residue evidence.
**Acceptance**: Cleanup targets the exact Unit 9.7 identifiers, every deletion succeeds or proves absence, and all residue assertions return zero before task closure begins.

### ⬜ Unit 9.9: Task Closure
**What**: After Unit 9.8 succeeds, synchronize planning/doing checklists and status, scan task docs/feedback/PR/smoke/cleanup for ready work, archive Desk state, remove a worktree only when its status is empty and its merge is an ancestor of `origin/main`, delete only the corresponding merged local branch, and notify Slugger.
**Output**: Done task docs, archived Desk record, cleanup receipt, and Slugger completion message.
**Acceptance**: Unit 9.8 is accepted, no ready required work or residue remains, and every terminal artifact points to the shipped production merge.

## Execution
- **TDD strictly enforced**: tests -> red -> implement -> green -> refactor.
- Commit after each phase and push after every atomic commit.
- Run the full app suite before closing every implementation/refactor unit; run the Workers suite for every Worker/DO change.
- Run `visual-qa-dogfood` before closing every UI unit.
- Save logs, screenshots, reviews, and QA outputs under `./2026-07-19-1505-doing-clem-feedback-ship/`.
- Update this doing doc, the planning checklist, Desk continuity, and branch/PR/deploy state after every completed unit and remote deploy/merge operation.
- Use a fresh sub-agent review for every code, SQL, workflow, API, security/privacy, or UI unit and every substantive fix; surface only true credential/capability or unsafe destructive-production blockers.

## Progress Log
- 2026-07-19 15:34 Created from the approved focused planning doc.
- 2026-07-19 16:12 Granularity Round 2 covered every migration schema addition and separated production cleanup from smoke/visual QA.
- 2026-07-19 16:20 Validation Round 1 aligned shopping uniqueness, saved REST, and Playwright paths with the current repository.
- 2026-07-19 16:24 Validation Round 2 converged against repository paths, names, and conventions.
- 2026-07-19 16:31 Ambiguity Round 1 froze bootstrap, schema, protocol, inventory, branch, and measurable verification contracts.
- 2026-07-19 16:43 Ambiguity redesign replaced the stale baseline and completed scalar, hash, infrastructure, inventory, quantity, and repeated-query contracts.
- 2026-07-19 16:52 Ambiguity harsh review completed canonical hash/socket behavior, literal fixture values, and saved/filter file inventories.
- 2026-07-19 17:00 Final ambiguity findings fixed SQL constraints, total reconnects, shopping metadata, bootstrap tests, fixture hashing, and canonical links.
