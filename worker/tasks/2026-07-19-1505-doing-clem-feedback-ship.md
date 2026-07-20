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
- [ ] Real Workers-runtime tests prove authenticated cook ownership, SQLite DO persistence, concurrent start convergence on one attempt, stale-attempt/revision conflicts, mutation replay, hibernatable WebSocket fan-out and frame ordering, upgrade/purge races in both lock orders, eviction recovery, idempotent terminal transitions, projection retry fencing, scheduler collisions, and purge.
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
- [ ] QA and the bootstrap PR create migration `v1_cook_session` through atomic `wrangler deploy`; bootstrap Worker/DO protocol-v1 stubs and cross-version tests make eventual-consistency overlap retryable. The product PR activates protocol v1 atomically with forward repair only; a workflow-only follow-up restores 0% candidate smoke, 100% promotion, and rollback between protocol-v1-capable versions.
- [ ] All changed code has 100% statement, branch, function, and line coverage; unit, Workers, Playwright, typecheck, build, and migration commands fail on warnings and pass cleanly in CI.
- [ ] Changed UI passes keyboard/accessibility checks and `visual-qa-dogfood` at mobile and desktop viewports with no overlap, truncation, unreachable controls, or open absurdity findings.
- [ ] QA migration/deploy, two-client smoke, REST/MCP shopping/save/tag/scaling smoke, and cleanup pass before merge; cleanup closes sockets, purges the known DO, removes its D1 projection and disposable save/tag/shopping rows, then proves zero residue.
- [ ] The reviewed bootstrap/product/canary-restoration PR chain merges in order with green CI; each automatic production workflow deploys its exact merge SHA, canonical health identifies it, production smoke passes, and disposable data is removed.
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
- Unit and Workers setups fail unexpected console/process warnings; every Playwright spec uses the shared browser warning/page-error fixture; a tested diagnostic-aware command wrapper fails actual typecheck, build, generated-contract, and Prisma/Wrangler migration warnings without false-positive matching ordinary output.

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
**What**: Record clean branch/upstream state, plan/source hashes, Node/pnpm/Cloudflare versions, and baseline gates. Create the fixture with the exact foreign-key-safe reset order, including `UPDATE Recipe SET sourceRecipeId = NULL` before recipe deletion, and every literal value/FK frozen in planning; record raw-fixture SHA-256 and the migration-set SHA-256 generated by bytewise filename order with `filename NUL bytes NUL`; map every feedback row.
**Output**: Baseline logs, fixture/hash manifest, and feedback-to-unit map in the artifacts directory plus the committed seed fixture.
**Acceptance**: 7,226 existing tests pass at 100% app coverage; fixture atop migrations 0000-0023 clears seeded application rows and yields exactly five total memberships/three active duplicates; foreign-key check is empty; typecheck/build pass; `git status --porcelain` is empty after commit; every source row maps to a unit or explicit rejection test.

### ⬜ Unit 1.1a: Workers Test Lane - Tests
**What**: Add failing tests for `vitest.workers.config.ts`, `wrangler.workers-test.json`, exact Vitest `4.1.10`/Workers pool `0.18.6`, Istanbul 100% thresholds, serialized shared storage, package commands, and CI invocation. In `test/config/warning-policy.test.ts`, test a new diagnostic-aware `scripts/run-with-warning-policy.mjs` against representative Node/Vite/Wrangler warning forms plus benign output containing the word "warning"; require app/Workers Vitest hooks to fail unexpected `console.warn`, unowned `console.error`, and process warnings; require a new `e2e/fixtures.ts` to fail browser `warning`/`error` console events and `pageerror`; and require every Playwright spec/setup file that imports `test` or `expect` to use that fixture while type-only support imports remain from `@playwright/test`.
**Output**: Red Workers-lane, warning-policy, fixture-inventory, and workflow-contract evidence.
**Acceptance**: Focused tests fail only because the Workers lane and warning-enforcement infrastructure are absent.

### ⬜ Unit 1.1b: Workers Test Lane - Implementation
**What**: Upgrade all Vitest packages to `4.1.10`; add `@cloudflare/vitest-pool-workers@0.18.6`, `vitest.workers.config.ts`, `vitest.workers.setup.ts`, `wrangler.workers-test.json`, `test:workers`/`test:workers:coverage`, and the mandatory CI job. Add the tested warning wrapper and route typecheck, build, generated-contract checks, and local/QA migration rehearsals through it in verification/CI. Replace `test/setup.ts`'s blanket act/SQLite suppression with fail-after-test warning capture: tests that intentionally exercise logging must own an exact spy, React tests repair their act boundary, and Node SQLite processes use the runtime's warning-disable flag so no warning is emitted. Add the shared Playwright fixture and mechanically switch every test-bearing existing spec/setup import to it.
**Output**: Executable official Workers-runtime lane and repo-wide zero-warning enforcement.
**Acceptance**: Injected sentinel warnings fail in every runner, benign text does not; `pnpm run test:workers`, app coverage, Playwright, typecheck, build, and migration rehearsals pass with no warning emitted or suppressed.

### ⬜ Unit 1.1c: Workers Test Lane - Verification
**What**: Run both app and Workers coverage, the complete Playwright suite, wrapped typecheck/build/generated-contract/migration commands, and warning-sentinel self-tests; review config/CI isolation and prove no blanket suppression remains.
**Output**: Dual 100% coverage reports, zero-warning gate logs, and reviewer result.
**Acceptance**: New config/warning logic reaches 100%; the empty Workers lane passes; app remains 100%; every intentional sentinel fails for the expected diagnostic, every clean command passes, and fresh test-infrastructure review converges.

### ⬜ Unit 1.2a: Namespace Bootstrap - Tests
**What**: Using the Unit 1.1 Workers lane, add failing config/runtime tests for class `CookSession`, binding `COOK_SESSIONS`, top-level/QA `v1_cook_session` `new_sqlite_classes`, environment types, SQLite storage, and the frozen public/internal probe paths, header, body, object name, success body, and two-run idempotence. Also cover every syntactically valid future public `/api/cook-sessions` method/path, including an upgrade request, and every recognized future internal request with `X-Spoonjoy-Cook-Protocol: 1`: after the frozen session/bearer scope and mutation/upgrade origin checks, each returns the exact HTTP 503 `cook_session_protocol_unavailable` envelope, `Retry-After: 1`, and `Cache-Control: private, no-store` without upgrade or storage mutation; malformed/unrecognized/bootstrap-disabled probe requests return 404.
**Output**: Red `test/config/cook-session-binding.test.ts` and Workers-lane `test/workers/cook-session-bootstrap.test.ts` evidence.
**Acceptance**: Config test and `pnpm run test:workers -- test/workers/cook-session-bootstrap.test.ts` fail only on absent namespace code/config.

### ⬜ Unit 1.2b: Namespace Bootstrap - Implementation
**What**: Add the inert `workers/cook-session.ts` export and bootstrap/protocol-stub routing in `workers/app.ts` plus `wrangler.json` production/QA binding, `COOK_SESSION_BOOTSTRAP_MODE=1`, legacy migration, and `app/cloudflare-env.d.ts` types. The DO probe creates/reads/drops its private table and deletes all storage before returning the exact planning-contract body; recognized future protocol-v1 requests return only the frozen retryable response and never touch storage.
**Output**: One deployable, forward-compatible inert SQLite DO namespace.
**Acceptance**: Unit 1.2a tests pass and `pnpm run typecheck` plus `pnpm run build` are green.

### ⬜ Unit 1.2c: Namespace Bootstrap - Verification
**What**: Cover every namespace/config branch and review storage/lifecycle correctness.
**Output**: Focused coverage and reviewer report.
**Acceptance**: Namespace code is 100% covered and a fresh Cloudflare review has no BLOCKER/MAJOR finding.

### ⬜ Unit 1.3a: Bootstrap Deployment Mode - Tests
**What**: Add failing tests in `test/scripts/deploy-production-canary.test.ts`, `test/scripts/deployment-preflight.test.ts`, and `test/release-workflow-security.test.ts` for `.github/workflows/production-deploy.yml`'s three source-controlled phases: atomic bootstrap, atomic first-product activation, and protocol-v1-only gradual canary. Freeze exact-SHA/version/probe verification, no rollback to a pre-boundary/inert version, sanitized artifact output, and 0%/100% canary behavior only in the final phase.
**Output**: Red named deploy/workflow contract tests.
**Acceptance**: Focused tests fail only because lifecycle-aware deployment behavior is absent.

### ⬜ Unit 1.3b: Bootstrap Deployment Mode - Implementation
**What**: Extend `scripts/deploy-production-canary.ts`, `.github/workflows/production-deploy.yml`, and `docs/deployment.md` with explicit source-controlled atomic-bootstrap, atomic-product-activation, and protocol-v1-canary branches, without a new orchestrator; commit the bootstrap branch as active in this PR.
**Output**: One reviewed lifecycle- and protocol-aware production deployment mode.
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
**What**: On `worker/clem-feedback-e2e`, run final gates and open a PR to `main`. Enforce the planning-contract allowlist: focused task docs/artifacts, frozen `test/fixtures/clem-feedback-pre-feature.sql`, package/lockfile, Wrangler/env types, Worker app/new inert class, Workers-test config/tests, CI/production workflow, and existing deploy script/tests/docs only; resolve review/CI and merge.
**Output**: Bootstrap PR URL and exact merge SHA.
**Acceptance**: Required reviews/CI are green and the merge SHA contains only docs plus lifecycle/test/deploy bootstrap scope.

### ⬜ Unit 1.6: Production Lifecycle Boundary
**What**: Follow the automatic atomic production deploy, verify exact merge SHA/version, call the same frozen bootstrap probe twice, assert matching version/body and zero residue, and record the no-pre-boundary-rollback rule.
**Output**: Sanitized production deployment/version/health/cleanup evidence.
**Acceptance**: Production has the SQLite namespace, canonical health identifies the bootstrap merge, zero residue remains, and failure recovery is forward-only across this boundary.

### ⬜ Unit 1.7: Product Branch Handoff
**What**: Create `/Users/arimendelow/Projects/spoonjoy-v2-clem-feedback-product` on `worker/clem-feedback-product` from the verified bootstrap merge with future base `main`, and record merge/deploy/version/ancestry/branch/worktree/task paths in `bootstrap-handoff.md` without changing runtime code.
**Output**: Initial handoff manifest and clean pushed product branch at the bootstrap merge.
**Acceptance**: Merge-base succeeds, task docs and the frozen fixture remain reachable, `git status --porcelain` is empty, and the initial product branch equals the verified bootstrap merge.

### ⬜ Unit 1.8a: Product Deployment Mode - Tests
**What**: On the product branch, change config/runtime/deploy contract tests to require no `COOK_SESSION_BOOTSTRAP_MODE`, public probe 404 with the private inert probe still covered, retained binding/migration, the source-controlled atomic-product-activation workflow branch, and explicit rejection of versions-upload/canary before the product smoke boundary.
**Output**: Red updated binding/bootstrap/deploy tests.
**Acceptance**: Focused tests fail only because the checked-in config/workflow still enables bootstrap deployment mode.

### ⬜ Unit 1.8b: Product Deployment Mode - Implementation
**What**: Remove `COOK_SESSION_BOOTSTRAP_MODE`, retain private probe compatibility through Unit 7.1, and select the workflow/script's atomic-product-activation branch; do not change the Durable Object binding or migration and do not restore canaries yet.
**Output**: Atomic product-activation configuration with an unreachable public bootstrap probe and preserved namespace.
**Acceptance**: Unit 1.8a tests, Workers/app coverage, typecheck, and build pass; no production/QA config enables the public probe.

### ⬜ Unit 1.8c: Product Deployment Mode - Verification
**What**: Run all three deployment-phase contract tests and a fresh release/Cloudflare review, then finalize `bootstrap-handoff.md` with the product-activation-mode commit and pushed head.
**Output**: Verified handoff manifest and clean pushed product branch.
**Acceptance**: Review converges, `git status --porcelain` is empty, branch is pushed, and Unit 2.1 starts only from this checkpoint.

### ⬜ Unit 2.1a: Product Models - Tests
**What**: From Unit 1.8c, add failing Prisma/schema tests for every Prisma-expressible product shape and shopping `@@unique` removal; add seed-source/behavior coverage proving `prisma/seed.ts` no longer uses `shoppingListId_unitId_ingredientRefId` and remains idempotent; and add focused shopping service tests proving its current recipe-add callsite no longer requires that generated selector while preserving pre-feature lookup/update-or-create behavior. Raw SQL checks belong to Unit 2.2 and final atomic shopping behavior to Unit 3.2. Before generating the new client, add a byte-shape test around MCP `import_recipe_from_url` proving a full imported Prisma row is projected to the pre-feature mutation contract and cannot leak `course` or future schema fields.
**Output**: Red `test/models/clem-feedback-schema.test.ts` evidence.
**Acceptance**: Focused tests fail only because the models/columns and explicit MCP import mutation projection are absent.

### ⬜ Unit 2.1b: Product Models - Implementation
**What**: First replace `import_recipe_from_url`'s raw imported-recipe response in `app/lib/spoonjoy-api.server.ts` with an explicit pre-feature mutation projection. Then, in the same atomic implementation, replace generated compound-selector use in both `prisma/seed.ts` and `app/lib/shopping-list.server.ts` with tested interim active-row `findFirst` plus update-or-create behavior before removing the shopping constraint in `prisma/schema.prisma`; implement the remaining frozen models/relations/indexes, regenerate client, and update `test/utils.ts` plus cleanup order. Unit 3.2 replaces the interim service path with final raw-SQL atomicity.
**Output**: Prisma-modeled product schema aligned with tombstone-preserving shopping identity and generated types.
**Acceptance**: Model/seed/interim-shopping tests, MCP import byte-shape regression, Prisma generation/push, typecheck, and build pass in this unit; no source references the removed generated selector and adding `Recipe.course` does not alter import output.

### ⬜ Unit 2.1c: Product Models - Verification
**What**: Cover model helpers/cleanup branches and review ownership/FK/privacy boundaries.
**Output**: Coverage and data-review evidence.
**Acceptance**: New helper code is 100% covered and review converges.

### ⬜ Unit 2.2a: Product Schema And SavedRecipe Backfill Migration - Tests
**What**: Add failing migration assertions for empty/fixture application, every frozen SavedRecipe/RecipeTag/Recipe.course/CookSessionIndex schema detail, exactly four saves, user-a/recipe-r1 Jan 3 savedAt, FK integrity, and saved-row soft/hard recipe deletion behavior; do not assert shopping repair yet.
**Output**: Red product-schema and saved-backfill sections of `test/scripts/migration-0024-clem-feedback-product.test.ts`.
**Acceptance**: Focused migration tests fail only because migration 0024 and all of its required schema/backfill behavior are absent.

### ⬜ Unit 2.2b: Product Schema And SavedRecipe Backfill Migration - Implementation
**What**: Create the exact frozen SavedRecipe/course/tag/cook-index schema, raw checks/indexes, and deterministic SavedRecipe backfill portion of `migrations/0024_clem_feedback_product.sql`.
**Output**: Additive new tables/column and one-time saved-state backfill.
**Acceptance**: Every schema, absence-of-progress-state, index, constraint, FK, and saved-backfill assertion passes from both fixtures with exact counts and preserved FKs.

### ⬜ Unit 2.2c: Product Schema And SavedRecipe Backfill Migration - Verification
**What**: Rehearse the current schema/backfill-only 0024 under a newly created temporary Node SQLite database and a newly isolated local Wrangler D1 state directory, then delete both and review prior-Worker compatibility; do not reuse this migration state in Unit 2.3.
**Output**: Rehearsal and reviewer evidence.
**Acceptance**: Both engines agree, no existing table contract breaks, and review converges.

### ⬜ Unit 2.3a: Shopping Repair Migration - Tests
**What**: Add failing migration tests for the frozen shopping repair and raw index, plus a config/setup test requiring `test/setup.ts` to create the exact same `ShoppingListItem_active_identity_key` after cleanup so Prisma-pushed `test.db` supports the service upsert.
**Output**: Red shopping section of the migration 0024 test.
**Acceptance**: Tests fail because repair/index SQL is absent.

### ⬜ Unit 2.3b: Shopping Repair Migration - Implementation
**What**: Add the frozen repair/drop/partial index to migration 0024 and add exact `CREATE UNIQUE INDEX IF NOT EXISTS ShoppingListItem_active_identity_key ... WHERE deletedAt IS NULL` setup via Prisma raw execution in `test/setup.ts` immediately after shopping-row cleanup.
**Output**: One database-enforced active shopping identity per list/ingredient/unit.
**Acceptance**: All repair/index fixtures pass and the pre-feature Worker remains compatible with the migrated schema.

### ⬜ Unit 2.3c: Shopping Repair Migration - Verification
**What**: Create fresh temporary Node SQLite and isolated local Wrangler D1 state after Unit 2.3b, apply the complete final 0024 from migrations 0000-0023 plus fixture, run duplicate/rollback-failure checks, run apply/list twice in that fresh state, review data, then delete both states.
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
**What**: Add failing tests for top-level `course`/`tags` on read-specific wrappers around `recipeDetail`, `formatRecipe`, and `formatRecipeSummary`, and actual MCP `get_recipe`/`search_recipes`/`search_spoonjoy`, plus REST list/detail/search, OpenAPI, and playground, with no personalized save state. Require new OpenAPI `RecipeReadSummary`/`RecipeReadDetail` schemas only on REST recipe GETs while existing `RecipeSummary`/`RecipeDetail` remain on cookbook/native/mutation schemas. Add real `SearchDocument` recipe metadata and freshness tests requiring course/tags plus a deterministic SHA-256 tag-content hash; include replacement with identical count/max timestamp but different label. Add byte-shape regression fixtures proving the base serializers remain unchanged for native sync; REST recipe create/update/fork, step create/update/delete, ingredient create/delete, step reorder/output-use replace, and import/recovery responses; MCP create/update/import; cookbook summaries; and generated mutation examples.
**Output**: Red metadata contract tests.
**Acceptance**: Read-surface/search/OpenAPI tests fail because isolated course/tags projection is absent, while every named non-read consumer retains its pre-feature byte shape.

### ⬜ Unit 4.1b: Neutral Recipe Metadata - Implementation
**What**: Add read-specific metadata wrappers without changing the base serializer output, and wire only REST list/detail/search plus MCP `get_recipe`/`search_recipes`; update `app/lib/search.server.ts` recipe documents and freshness fingerprint so MCP `search_spoonjoy` receives persisted course/tags. Fingerprint RecipeTag with lowercase SHA-256 of fixed-key JSON rows ordered by recipeId, normalizedLabel, then id, normalizing timestamps exactly like existing cover hashing. Add OpenAPI `RecipeReadSummary`/`RecipeReadDetail` and point only REST recipe list/detail GET contracts to them; keep existing `RecipeSummary`/`RecipeDetail` on native, cookbook, import, and mutation schemas/examples. Regenerate `app/lib/generated/api-v1-playground.ts` and update existing developer API docs. Keep native sync, every named REST/MCP mutation or recovery response, and cookbook summaries on unchanged base serializers.
**Output**: Neutral course/tag read parity.
**Acceptance**: Focused metadata/API/MCP/SearchDocument/freshness/OpenAPI tests and every non-read byte-shape regression pass; two consecutive playground generations leave no git diff.

### ⬜ Unit 4.1c: Neutral Recipe Metadata - Verification
**What**: Reach 100% read-wrapper/adapter coverage, rerun the named base-serializer consumer matrix, and obtain API compatibility review.
**Output**: Coverage, generated diff, and reviewer evidence.
**Acceptance**: Every empty/order/privacy branch is covered, all enumerated mutation/native/cookbook contracts remain byte-identical, and review converges.

### ⬜ Unit 4.2a: Read-Time Scaling - Tests
**What**: Add failing pure/REST/MCP/OpenAPI/playground/docs tests for the exact frozen `GET /api/v1/recipes/:id?scale=` and MCP `get_recipe({scale})` contract: finite `0.1..100`, top-level scale metadata, six-decimal ingredient quantity rounding, unchanged servings/storage, absent-argument byte compatibility with Unit 4.1's new post-metadata unscaled read payload, REST `validation_error` field `scale`, MCP invalid-argument mapping, an OpenAPI number query parameter with inclusive bounds, and optional `scale` metadata only on `RecipeReadDetail`.
**Output**: Red scaling-helper and adapter tests.
**Acceptance**: Tests fail because the shared validator/scaler and arguments are absent.

### ⬜ Unit 4.2b: Read-Time Scaling - Implementation
**What**: Add the pure scaling helper and wire REST detail query plus MCP `get_recipe` argument without changing stored quantities or default responses. Add the bounded `scale` query parameter and optional response metadata to `RecipeReadDetail` in `app/lib/api-v1-openapi.server.ts`, regenerate `app/lib/generated/api-v1-playground.ts`, and update `docs/api.md` plus `app/routes/developers.tsx` with scaled and unscaled detail examples.
**Output**: One read-only scaling contract across REST and MCP.
**Acceptance**: Focused scaling/API/MCP/OpenAPI/playground/docs tests, two stable generations, typecheck, and build pass.

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
**What**: Add failing tests for `RecipeBuilder`, `createRecipeDraft`, and route `action` in `app/routes/recipes.new.tsx`/`app/routes/recipes.$id.edit.tsx`: course selection, custom-tag editing, hidden payload, validation errors, owner-only create/edit, nested tags in the initial recipe create, create failure never leaving a recipe without its requested tags, edit batch transaction shape, and edit rollback on tag replacement failure.
**Output**: Red authoring route/component tests.
**Acceptance**: Tests fail because authoring fields and action wiring are absent.

### ⬜ Unit 6.2b: Tag Authoring - Implementation
**What**: Add controls to `app/components/recipe/RecipeBuilder.tsx`; extend `app/lib/recipe-create.server.ts` so `createRecipeDraft` accepts course/tags and nests tag creates in the initial `recipe.create`; add `app/lib/recipe-tags.server.ts`; and wire create/edit actions. Edit batches recipe/course update, tag delete/recreate, and native-sync invalidation in one Prisma array transaction.
**Output**: Manual course/tag authoring on new and edit flows.
**Acceptance**: Focused authoring/create failure/edit rollback tests and typecheck/build pass; create cannot expose a recipe missing requested tags and edit is all-or-nothing.

### ⬜ Unit 6.2c: Tag Authoring - Verification
**What**: Reach 100% component/action coverage and obtain product/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every payload/validation/rollback/keyboard branch is covered and review converges.

### ⬜ Unit 6.3a: Tag Filters And Search - Tests
**What**: Add failing tests in the named route/service tests for `%20`/`+` input equivalence, raw count rejection before normalization, first-occurrence dedupe/order, SQL AND, canonical URLSearchParams `q/course/tag*/page` links with `+` spaces, reset preserving q, invalid-filter 400, pre-limit predicates, and page normalization; assert Unit 4.1's SearchDocument metadata/freshness contract remains green rather than redefining it here.
**Output**: Red query/route/filter tests.
**Acceptance**: Tests fail because tag/course predicates and filter UI/query handling are absent.

### ⬜ Unit 6.3b: Tag Filters And Search - Implementation
**What**: Update exactly `app/routes/my-recipes.tsx`, `app/lib/my-recipes-search.server.ts`, `app/routes/search.tsx`, and `app/lib/search.server.ts` with query/filter helpers, accessible controls, SQL predicates against Unit 4.1's existing course/tag metadata, and safe pagination/link preservation; do not change `_index.tsx`, `users.$identifier.tsx`, or the already-complete freshness fingerprint.
**Output**: Course/tag discovery on existing bounded surfaces.
**Acceptance**: Focused query/route tests and build pass; no home/profile expansion occurs.

### ⬜ Unit 6.3c: Tag Filters And Search - Verification
**What**: Reach 100% query/UI coverage and obtain SQL/search/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Empty/malformed/multi-filter/pagination/freshness branches are covered and review converges.

### ⬜ Unit 6.4a: Web Tag Read Parity - Tests
**What**: Add failing persisted-data tests only for recipe-detail metadata, My Recipes cards, and global-search cards; assert deterministic public course/tags and no AI/save metadata. REST/MCP serializers are already complete in Unit 4.1 and remain regression tests, not red targets.
**Output**: Red web read-surface integration tests.
**Acceptance**: Tests fail only because persisted tag data does not yet reach the three named web surfaces.

### ⬜ Unit 6.4b: Web Tag Read Parity - Implementation
**What**: Complete includes/displays in `app/lib/recipe-detail.server.ts`, `app/routes/recipes.$id.tsx`, `app/routes/my-recipes.tsx`, `app/routes/search.tsx`, and `app/lib/search.server.ts` for the three Unit 6.4a web surfaces; do not change REST/MCP serializers.
**Output**: End-to-end manual metadata web read parity.
**Acceptance**: Focused web parity tests pass and Unit 4.1 REST/MCP regressions remain green without generated diffs.

### ⬜ Unit 6.4c: Web Tag Read Parity - Verification
**What**: Reach 100% web integration coverage, run full gates, and obtain product/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: All empty/order/privacy branches are covered and review converges.

### ⬜ Unit 6.5: Tag Visual QA
**What**: Run `visual-qa-dogfood` on authoring, recipe metadata, My Recipes, and search at 390x844 and 1440x900, including ten 40-code-point tags and empty filters.
**Output**: Screenshots, metrics, and closed absurdity ledger.
**Acceptance**: No horizontal overflow, overlap, or truncation occurs; all controls have reachable focus and at least 44px targets; active filters have programmatic selected state and visible labels; the absurdity ledger has no open item.

### ⬜ Unit 7.1a: Cook Contracts And Auth - Tests
**What**: Add failing tests for every exact cook route/contract/security/hash and for removal of the public `/.well-known/spoonjoy-cook-session-bootstrap` route while retaining the private probe, binding, and migration lifecycle assertions. Cover session access; bearer `kitchen:read` on list/detail/WebSocket; bearer `kitchen:write` on start/PATCH/complete/abandon/restart/purge; wrong/missing bearer scopes; and distinct 403 `insufficient_scope` versus `origin_forbidden` envelopes. Add frozen cross-version harnesses: old bootstrap Worker -> new product DO still completes the private probe, and new product Worker -> old bootstrap DO sends `X-Spoonjoy-Cook-Protocol: 1` and propagates exact 503 `cook_session_protocol_unavailable`, `Retry-After: 1`, and private/no-store without response cloning, upgrade, or storage mutation.
**Output**: Red cook-contract and Worker-router tests.
**Acceptance**: Focused tests fail against the inert bootstrap/runtime router.

### ⬜ Unit 7.1b: Cook Contracts And Auth - Implementation
**What**: Remove only the public bootstrap route/obsolete public expectations; replace inert public behavior with `app/lib/cook-session-contract.ts`, `workers/cook-session-api.ts`, and exact authenticated routing from `workers/app.ts`, while retaining the private probe plus class/binding/migration. Add `X-Spoonjoy-Cook-Protocol: 1` to every Worker -> DO request and propagate the frozen old-DO retry response. After `authenticateApiRequest`, enforce expanded `kitchen:read` or `kitchen:write` per the frozen route matrix before deriving/calling the DO, including WebSocket upgrades.
**Output**: Secure typed HTTP/WebSocket transport boundary.
**Acceptance**: Focused pure/Worker tests, typecheck, and build pass.

### ⬜ Unit 7.1c: Cook Contracts And Auth - Verification
**What**: Reach 100% contract/router coverage and obtain security/API review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every auth/origin/cache/validation/upgrade/protocol-skew branch is covered in both old/new directions and review converges.

### ⬜ Unit 7.2a: Cook State Machine - Tests
**What**: Add failing Workers-runtime tests for every frozen session/receipt/projection column type, NOT NULL/check/no-default rule, exact response_status/response_json replay; concurrent start; normalized hash ordering; stale conflicts including differing receipt hash; progress validation; eviction; terminal idempotence; and atomic restart.
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
**What**: Add failing real D1/DO integration tests for the exact CookSessionIndex allowlist/schema and 200-code-point title bound; one per-object promise mutex serializes every state-changing request, WebSocket upgrade, and alarm across external D1 I/O; brand-new start writes a conditional revision-0 D1 row before SQLite state; D1 failure returns 503 with no DO state; SQLite failure after D1 returns 503 and conditionally deletes the exact attempt/revision; failed compensation leaves an enumerable D1 row whose detail is 404; cleanup racing the handshake waits and rechecks; crash/restart plus no local state conditionally removes the exact orphan before retrying start. Also test later DO-first revision-fenced projection, retry delays `1/5/30/120/600` seconds, terminal non-resurrection, one alarm choosing the earlier deadline with due purge first, and the frozen telemetry allowlist/clamps.
**Output**: Red projection/scheduler tests using real D1/DO storage.
**Acceptance**: Tests fail because the initial registry handshake, compensated failure paths, later projection, and scheduler behavior are absent.

### ⬜ Unit 7.3b: Projection And Alarm - Implementation
**What**: Implement one per-instance promise mutex used by start, PATCH, complete, abandon, restart, purge/cleanup, WebSocket upgrade, and alarm entrypoints. Every operation re-reads SQLite after acquisition; hold the mutex across the D1-first initial registry handshake, SQLite commit, and exact-attempt/revision compensation. Cleanup acquires it and re-reads state, a new start repairs an exact no-state orphan before retrying, and alarms/upgrades never act on pre-lock state. Preserve failed compensation as an enumerable orphan registry row with no fabricated detail. After initial success, implement metadata-only DO-first revision projection, the exact persisted retry schedule/alarm precedence, and only the frozen privacy-safe telemetry fields in `workers/cook-session.ts`.
**Output**: Durable private registry/discovery projection.
**Acceptance**: Focused Workers projection/alarm tests pass, no failure can leave an unindexed DO, orphan registry rows remain discoverable for cleanup, and D1 contains no progress field.

### ⬜ Unit 7.3c: Projection And Alarm - Verification
**What**: Reach 100% initial-handshake/compensation/projection/scheduler coverage and obtain Cloudflare/data/privacy review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every initial D1 failure, SQLite failure, compensation success/failure, orphan-detail 404, retry/fencing/collision/telemetry branch is covered and review converges.

### ⬜ Unit 7.4a: Cook WebSockets - Tests
**What**: Add failing real-runtime tests for authenticated upgrade and the exact frame union `{type:'snapshot',state:<CookState>} | {type:'error',error:{code,message,retryable}}`; require exactly one current snapshot before a successful upgrade response returns. Prove each committed PATCH emits one snapshot per attached live socket; complete/abandon emit one terminal snapshot then close `1000/session-terminal`; restart emits no new-attempt snapshot to old-attempt sockets and closes `4009/stale-attempt`; purge emits no frame and closes `1000/session-purged`. Revisions must strictly increase per live socket with no duplicate same-revision fan-out; receive-only client data gets error `client_messages_unsupported` then close `1003/client-messages-unsupported`; hibernatable reconnect works; and no frame is sent after close or purge begins. Cover HTTP security separation and upgrade-versus-purge in both mutex acquisition orders: upgrade-first accepts/snapshots then purge closes it, while purge-first yields HTTP 404 without upgrade.
**Output**: Red WebSocket tests under `--max-workers=1 --no-isolate`.
**Acceptance**: Tests fail because socket handling is absent.

### ⬜ Unit 7.4b: Cook WebSockets - Implementation
**What**: Implement server-to-client-only hibernatable WebSocket attachment/fan-out/reconnect and exact frame/ordering/close-code behavior on `CookSession` and `workers/cook-session-api.ts`; admit upgrades inside the shared mutex after a fresh SQLite read, send the initial snapshot inside that lock, dedupe fan-out by socket revision, and reject client data with the frozen error frame then close.
**Output**: Live canonical cross-device snapshot channel.
**Acceptance**: Focused real-runtime WebSocket tests pass without response cloning or warnings.

### ⬜ Unit 7.4c: Cook WebSockets - Verification
**What**: Reach 100% socket coverage and obtain Cloudflare/security review.
**Output**: Workers coverage and reviewer evidence.
**Acceptance**: Every upgrade/message/reconnect/stale/ordering/deduplication/close/race branch is covered and review converges.

### ⬜ Unit 7.5a: Retention And Purge - Tests
**What**: Add failing Workers tests for 24-hour terminal/receipt retention, replay during retention, active-list exclusion, due-purge alarm precedence, close -> D1 delete -> alarm/storage delete ordering, exact 503 `purge_incomplete`, 60-second retry with storage preserved, owner-only purge, and D1-row-enumerated cleanup including a failed-initial-compensation orphan whose DO detail is 404. Assert all cleanup goes through the addressed DO mutex, an enumerated attempt/revision fences orphan deletion, and no direct caller-side index delete exists. Race restart and WebSocket upgrade independently against a due purge in both acquisition orders: restart-first preserves the new active attempt after alarm re-read; upgrade-first accepts/snapshots and is then closed; purge-first removes state so later restart/upgrade return 404 with no surviving socket.
**Output**: Red retention/purge/cleanup tests.
**Acceptance**: Tests fail because terminal lifecycle and purge are absent.

### ⬜ Unit 7.5b: Retention And Purge - Implementation
**What**: Implement the exact frozen retention/purge sequence and errors in `workers/cook-session.ts`/`workers/cook-session-api.ts`, plus owner cleanup that enumerates `CookSessionIndex` rows before calling each server-derived DO through the shared mutex; after acquiring the mutex, cleanup conditionally removes only the enumerated attempt/revision when local state is absent. Alarm purge re-reads state after mutex acquisition and exits when restart cleared the due terminal state; while still holding the mutex, purge marks closing, closes every attached socket, and prevents later frames before D1/alarm/storage deletion. List returns only `status='active'` ordered by `updatedAt DESC, recipeId DESC`; no route/script deletes an index row directly.
**Output**: Recoverable lifecycle cleanup with complete D1 registry until purge.
**Acceptance**: Focused Workers/API cleanup tests pass and zero-residue assertions succeed.

### ⬜ Unit 7.5c: Retention And Purge - Verification
**What**: Reach 100% retention/purge coverage, run full Workers/app gates, and obtain privacy/recovery review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every retention/deletion/failure/retry branch is covered and review converges.

### ⬜ Unit 8.1a: Cook Client Transport - Tests
**What**: Add failing client/hook tests for outgoing shapes and the total frozen close/detail table: different-active adoption, same-active-after-4009 `stale_attempt_reconciliation_failed`, terminal/404 stop/list refresh, 401/403/other 4xx stop, 409 canonical active-or-terminal, 503 `cook_session_protocol_unavailable` honoring `Retry-After: 1`, other 5xx/network backoff, unlisted close protocol-stop, offline/online, successful-open reset, and every named delay.
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
**What**: Extend `test/scripts/cleanup-local-qa-data.test.ts` and `test/scripts/smoke-live-helpers.test.ts` with failing cases for socket closure; D1-enumerated owner purge; random five-minute bearer generation with only hash/prefix persisted; outgoing DELETE with exact `Authorization` and `Origin: target.origin`; credential deletion in `finally`; CookSessionIndex-zero verification before SavedRecipe/RecipeTag/shopping/user deletion; refusal on auth/purge/verification failure; partial retry; local/QA/production target isolation; live-smoke session retention through purge; secret sanitization; and zero-residue assertions.
**Output**: Red named cleanup-helper/script tests.
**Acceptance**: Tests fail because new feature residue is not yet enumerated/purged.

### ⬜ Unit 9.2b: Feature Cleanup - Implementation
**What**: Extend only `scripts/cleanup-local-qa-data.mjs` and cleanup exports in `scripts/smoke-live-helpers.mjs`: remote QA apply validates the exact disposable user, mints a random five-minute `kitchen:read kitchen:write` API credential through its existing D1 admin channel, stores only SHA-256/prefix, calls the normal owner-only DELETE route for every enumerated recipe ID with exact target-origin and bearer headers, deletes the credential in `finally`, verifies zero CookSessionIndex rows, then permits relational/user cleanup. Keep the live smoke browser session open through its purge. Preserve dry-run, explicit apply, and production broad-read-only behavior.
**Output**: Idempotent target-scoped feature cleanup.
**Acceptance**: Focused cleanup tests and script typecheck pass; captured requests prove owner authentication, no token enters output/artifacts, no remote mutation occurs in tests, and user deletion is impossible while any index row remains.

### ⬜ Unit 9.2c: Feature Cleanup - Verification
**What**: Reach 100% cleanup coverage and obtain privacy/destructive-operation review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every ordering/retry/target/error branch is covered and review converges.

### ⬜ Unit 9.3: Final Local Verification And Cold Reviews
**What**: Run cleanup, Prisma generation/push, numeric migrations twice, generated-contract diff, script/app typechecks, full app/Workers coverage, Playwright, build, boundary oracle, and clean-tree checks; execute every relevant command through its Unit 1.1 warning hook/wrapper and save the clean output. Run fresh implementation, test, security/privacy, migration/release, API, and design reviews.
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

### ⬜ Unit 9.6: Atomic Product Activation
**What**: Follow the source-controlled atomic-product-activation workflow, verify exact product merge SHA/version/canonical health, and prove the deployment never invokes versions-upload or a traffic split. Because protocol/state can now exist, any failure is repaired forward: keep this unit incomplete, create/merge a reviewed repair from the failed product head, and repeat the atomic activation; never restore the inert bootstrap Worker.
**Output**: Sanitized successful atomic production release/version evidence; failed attempts retain forward-repair evidence without satisfying the unit.
**Acceptance**: The final product or repair merge SHA is the sole 100% production version and canonical health identifies it; no rollback to the inert bootstrap version occurs and failure alone never permits Unit 9.7.

### ⬜ Unit 9.7: Production Smoke And Visual QA
**What**: Run production Clem feature smoke, two-client continuation, `visual-qa-dogfood`, and canonical health against the atomically activated version. On any failure, capture identifiers/evidence, clean all created residue, keep Unit 9.7 incomplete, create/merge a reviewed forward repair, and repeat Units 9.6-9.7 without restoring the inert bootstrap Worker.
**Output**: Successful production smoke/visual evidence and closed absurdity ledger; failed attempts retain cleanup/forward-repair evidence without satisfying the unit.
**Acceptance**: Every product/visual scenario passes on `spoonjoy.app`, canonical health identifies the atomically activated product/repair merge, all disposable IDs are captured for Unit 9.8, and only successful forward repair permits Unit 9.8.

### ⬜ Unit 9.8: Production Cleanup
**What**: Close all production test sockets, purge every known disposable cook-session DO, remove its D1 projection rows and all disposable feature/user data, then run zero-residue assertions across D1, DO-accessible state, R2, and test users.
**Output**: Sanitized production cleanup receipt and zero-residue evidence.
**Acceptance**: Cleanup targets the exact Unit 9.7 identifiers, every deletion succeeds or proves absence, and all residue assertions return zero before canary restoration begins.

### ⬜ Unit 9.9a: Canary Restoration - Tests
**What**: From the shipped product merge, create a fresh `worker/clem-feedback-canary-restoration` branch/worktree and add failing workflow/deploy contract tests requiring protocol-v1-canary mode, 0% candidate override smoke, 100% promotion, exact SHA/version checks, rollback targets restricted to protocol-v1-capable versions, and no runtime/product/schema changes in the PR.
**Output**: Red workflow-only restoration tests and exact changed-file allowlist.
**Acceptance**: Tests fail only because the product merge intentionally remains in atomic-product-activation mode.

### ⬜ Unit 9.9b: Canary Restoration - Implementation
**What**: Change only `.github/workflows/production-deploy.yml`, its existing deployment script/tests, and `docs/deployment.md` as required to select the already-tested protocol-v1-canary branch; do not alter Worker, DO, app, schema, migration, or feature code.
**Output**: Minimal workflow-only restoration patch.
**Acceptance**: Focused release tests, full app coverage, typecheck, and build pass through zero-warning gates; changed-file allowlist contains only the named delivery files/tests/docs.

### ⬜ Unit 9.9c: Canary Restoration - Verification
**What**: Run the release/security test suite and obtain fresh Cloudflare/release/security review of the workflow-only diff and rollback floor.
**Output**: Converged restoration review and clean pushed branch.
**Acceptance**: Every deployment-phase branch remains covered, reviewers find no BLOCKER/MAJOR, and branch status is clean/pushed.

### ⬜ Unit 9.10: Canary Restoration PR And Deployment
**What**: Open and merge the workflow-only PR after green CI, then follow its automatic version upload, 0% candidate override smoke, 100% promotion, and exact merge-SHA/version/canonical-health verification. The previous product version is the rollback floor; on failure restore only that protocol-v1 version, create/merge a reviewed workflow repair, and repeat this unit. Clean any candidate-smoke residue and prove zero rows/objects/users remain.
**Output**: Restoration PR URL/merge SHA plus sanitized candidate, promotion, rollback-floor, and cleanup evidence.
**Acceptance**: The restoration merge SHA is 100% in production, canonical health identifies it, the 0%/100% path passed between protocol-v1-compatible versions, and all candidate-smoke residue is zero.

### ⬜ Unit 9.11: Task Closure
**What**: After Unit 9.10 succeeds, synchronize planning/doing checklists and status, scan task docs/feedback/PR/smoke/cleanup for ready work, archive Desk state, remove a worktree only when its status is empty and its merge is an ancestor of `origin/main`, delete only the corresponding merged local branch, and notify Slugger.
**Output**: Done task docs, archived Desk record, cleanup receipt, and Slugger completion message.
**Acceptance**: Unit 9.10 is accepted, no ready required work or residue remains, and every terminal artifact points to the shipped production restoration merge.

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
- 2026-07-19 17:06 Final ambiguity convergence fixes specified receipt/projection fields and same-attempt stale reconciliation.
- 2026-07-19 17:10 Ambiguity Pass 4 converged with no executor-blocking findings.
- 2026-07-19 17:17 Quality Round 1 fixed Workers-lane ordering, migration-test ownership, product-mode TDD, and rollback completion semantics.
- 2026-07-19 17:23 Quality Round 2 isolated Prisma checks and guaranteed fresh migration rehearsal state.
- 2026-07-19 17:29 Quality redesign separated REST/MCP from web tag parity and added post-promotion recovery.
- 2026-07-19 17:33 Quality Pass 5 converged across all 114 units.
- 2026-07-19 17:38 Scrutiny Pass 6 fixed seed/raw-index integration, actual MCP naming, and bootstrap cleanup ownership.
- 2026-07-19 17:45 Scrutiny Pass 7 fixed initial registry atomicity and isolated metadata read serializers from mutation/native contracts.
- 2026-07-19 18:18 Scrutiny Pass 8 addressed six findings: handshake cleanup mutex, authenticated remote purge, schema-time import shielding, read-only OpenAPI schemas, search projection ownership, and fixture reset.
- 2026-07-19 18:37 Scrutiny Pass 8 Round 2 addressed five findings: scale contract ownership, tag content hashing, cleanup origin, atomic authoring, and self-reference reset.
- 2026-07-19 18:57 Scrutiny redesign addressed cook scope enforcement, fixture survival across bootstrap, and restart/purge serialization.
- 2026-07-19 19:20 Scrutiny redesign added cross-version atomic activation, exact socket admission/frame ordering, compile-safe Prisma sequencing, and owned zero-warning enforcement.
- 2026-07-19 19:33 Scrutiny Pass 8 Tinfoil converged with no BLOCKER or MAJOR findings.
- 2026-07-19 19:35 Scrutiny Pass 9 Stranger converged with no BLOCKER or MAJOR findings.
