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

### ⬜ Unit 1a: Lifecycle Bootstrap - Tests
**What**: Add failing config/runtime/release tests for a `CookSession` SQLite DO export, top-level/QA bindings, retained `v1_cook_session` `new_sqlite_classes` migration, Vitest 4.1 Workers pool, serialized WebSocket coverage command, CI invocation, one-time atomic bootstrap deployment, exact-SHA health verification, and post-boundary canary restoration.
**Output**: Red tests in `test/workers/`, `test/scripts/deploy-production-canary.test.ts`, and config/workflow contract tests; red log in artifacts.
**Acceptance**: Tests fail only because the bootstrap class/config/tooling/deploy path is absent.

### ⬜ Unit 1b: Lifecycle Bootstrap - Implementation
**What**: Add the inert exported `workers/cook-session.ts` class, bindings/types/migration config, `vitest.workers.config.ts`, isolated Workers test config, Vitest 4.1.10 and compatible Workers pool dependencies/scripts, CI lane, and source-controlled one-time atomic production branch in the existing deploy script and docs.
**Output**: Working SQLite DO bootstrap and release path in `workers/`, `wrangler.json`, `app/cloudflare-env.d.ts`, `package.json`, lockfile, Vitest config, CI, deploy script/tests, and deployment docs.
**Acceptance**: Focused bootstrap tests and Workers runtime smoke pass; app tests remain green; typecheck/build pass; no warning is emitted.

### ⬜ Unit 1c: Lifecycle Bootstrap - Coverage And Review
**What**: Reach 100% app/script/Worker coverage for bootstrap code, run migration/config validation, and obtain a fresh implementation/security/release review.
**Output**: Coverage/build/reviewer evidence in artifacts.
**Acceptance**: All bootstrap code is 100% covered, review has no BLOCKER/MAJOR finding, and the branch is clean and pushed.

### ⬜ Unit 1d: Lifecycle Bootstrap - QA And Production Boundary
**What**: Deploy the inert namespace to QA, smoke and clean it, open/merge the bootstrap PR after CI/review, follow its atomic production workflow, verify exact merge SHA/version and namespace behavior, then create the product branch from the verified post-boundary main state with the canary path restored.
**Output**: Bootstrap PR/deploy URLs and sanitized QA/production verification/cleanup logs in artifacts.
**Acceptance**: QA and production have `v1_cook_session`; no disposable data remains; the pre-boundary rollback is disabled; a post-boundary canary dry contract is green; product work continues on a clean pushed product branch.

### ⬜ Unit 2a: Product Schema And Migration - Tests
**What**: Add failing schema/migration tests for `SavedRecipe`, `RecipeTag`, nullable controlled `Recipe.course`, metadata-only `CookSessionIndex`, deterministic SavedRecipe backfill, shopping duplicate reconciliation and active-identity index, empty/frozen-baseline application, FK integrity, and previous-Worker compatibility.
**Output**: Red migration/model/release-gate tests and frozen `220954a1` fixture in artifacts/tests.
**Acceptance**: Tests fail because migration `0024_clem_feedback_product.sql`, Prisma models, and narrowly reviewed migration-gate support do not exist.

### ⬜ Unit 2b: Product Schema And Migration - Implementation
**What**: Add migration `0024_clem_feedback_product.sql`, matching Prisma models/relations, deterministic reconciliation/backfill SQL, indexes/checks, and the minimal existing production-gate extension with D1 recovery bookmark/preflight/verification.
**Output**: Deployable D1 migration, generated Prisma client, schema types, and release-gate implementation.
**Acceptance**: Migration tests pass from empty and frozen baseline; rerun/list behavior is correct; exact backfill/reconciliation/index/FK/Prisma parity assertions pass; old Worker reads/writes remain compatible.

### ⬜ Unit 2c: Product Schema And Migration - Coverage And Review
**What**: Cover every SQL parser/gate/schema branch, rehearse local D1 application twice, run full gates, and obtain fresh data/release review.
**Output**: Migration rehearsal, coverage, and review evidence.
**Acceptance**: New migration/gate code is 100% covered; all review findings are closed; clean pushed branch.

### ⬜ Unit 3a: Shopping Add And Restore - Tests
**What**: Add one failing shared matrix for manual and recipe adds across web, REST, MCP, and legacy callers: active/checked/deleted rows, unitless identity, null quantities, duplicate repair, concurrent adds, fresh-end ordering, unchanged check/delete/clear behavior, REST idempotency, rollback, `updatedAt`, and native sync.
**Output**: Red service/adapter/route/MCP tests, including outgoing SQL/input assertions.
**Acceptance**: Tests fail on the current separate read-then-write implementations and MCP ordering defect.

### ⬜ Unit 3b: Shopping Add And Restore - Implementation
**What**: Add `app/lib/shopping-list-mutations.server.ts` with the single atomic SQLite upsert contract and route all existing add writers in `shopping-list.server.ts`, `api-v1.server.ts`, and `spoonjoy-api.server.ts` through it without widening other mutation contracts.
**Output**: One shared add/restore service and thin adapters.
**Acceptance**: The full shared matrix passes under local SQLite and D1-compatible adapters; no false exactly-once claim is added to web/MCP.

### ⬜ Unit 3c: Shopping Add And Restore - Coverage And Review
**What**: Reach 100% coverage, run shopping/native-sync/OpenAPI/MCP/full gates, and obtain fresh concurrency/API review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: All new shopping branches and adapter requests are covered; full suite/typecheck/build pass; review converges.

### ⬜ Unit 4a: Recipe Metadata And Scaling - Tests
**What**: Add failing pure/API/MCP/OpenAPI tests for course/tag serialization and optional finite `scale` `0.1..100`, six-decimal quantity rounding, unchanged servings/storage/default payload, matching invalid-input behavior, deterministic metadata order, and absence of personalized save state.
**Output**: Red helper, REST, MCP, OpenAPI, playground, and compatibility tests.
**Acceptance**: Tests fail because shared metadata/scaling helpers and contract fields are absent.

### ⬜ Unit 4b: Recipe Metadata And Scaling - Implementation
**What**: Add shared pure metadata/scaling helpers, include course/tags in bounded recipe reads, implement REST detail query and MCP `get_recipe` argument handling, update OpenAPI/generated playground/developer docs, and remove Pebble-specific analytics categorization/fixtures.
**Output**: Neutral REST/MCP metadata and read-time scaling with no persistence.
**Acceptance**: REST/MCP parity and compatibility tests pass; default responses are unchanged; no Pebble runtime branch remains.

### ⬜ Unit 4c: Recipe Metadata And Scaling - Coverage And Review
**What**: Reach 100% coverage, run contract generation/diff, full gates, and fresh API compatibility review.
**Output**: Coverage/generated-contract/review evidence.
**Acceptance**: All validation/rounding/serialization/error branches are covered and review converges.

### ⬜ Unit 5a: Private Saved Recipes - Tests
**What**: Add failing data/service/web/REST tests for explicit save/unsave, one-time cookbook-author backfill independence, no cookbook bridge, owner privacy, no-store/vary headers, soft/hard deletion, idempotency, SQL search, versioned cursor validation, tie ordering, 24-row bounds, and no full materialization.
**Output**: Red SavedRecipe service, route, detail-control, API/OpenAPI, and query-shape tests.
**Acceptance**: Tests fail because canonical save state and dedicated controls/endpoints are absent.

### ⬜ Unit 5b: Private Saved Recipes - Implementation
**What**: Add the SavedRecipe service/cursor, convert `saved-recipes.tsx` to owner-scoped SQL pagination/search, add a dedicated save control and unambiguous cookbook control/copy on recipe detail, and implement REST list/PUT/DELETE with existing scopes/idempotency.
**Output**: Independent private saves across web and REST.
**Acceptance**: Save/cookbook state remains independent after backfill; all privacy/query/idempotency/API tests pass.

### ⬜ Unit 5c: Private Saved Recipes - Coverage And Review
**What**: Reach 100% coverage, run full gates, and obtain fresh privacy/data/API review.
**Output**: Coverage and review evidence.
**Acceptance**: Every cursor/auth/cache/error/empty/boundary branch is covered; review converges.

### ⬜ Unit 5d: Private Saved Recipes - Visual QA
**What**: Run `visual-qa-dogfood` on recipe save/cookbook controls and `/saved-recipes` empty/populated/search/pagination states at mobile and desktop sizes.
**Output**: Screenshots, metrics, and closed absurdity ledger.
**Acceptance**: Controls are distinct, keyboard reachable, non-overlapping, and visually coherent with the current kitchen UI.

### ⬜ Unit 6a: Manual Tags And Filters - Tests
**What**: Add failing normalization/validation/data/form/query/UI tests for course enum/null, NFKC/collapsed whitespace/lowercase comparison, control rejection, 40-code-point and ten-tag limits, duplicate spelling, owner-only writes, atomic replacement, AND filters, safe page parsing, URL preservation, search freshness, and no AI endpoints.
**Output**: Red helper/create/edit/My Recipes/search/detail/card/API/MCP tests.
**Acceptance**: Tests fail because authoring/filter/data behavior is absent.

### ⬜ Unit 6b: Manual Tags And Filters - Implementation
**What**: Add tag validation/storage/query services, RecipeBuilder authoring controls, create/edit transaction wiring, course/tag display, My Recipes and bounded global-search filters, safe pagination handling, and search-freshness integration.
**Output**: Manual recipe-owned tags and course across authoring/discovery/read surfaces.
**Acceptance**: All normalization/ownership/filter/freshness/UI tests pass; no AI path or global catalog is added.

### ⬜ Unit 6c: Manual Tags And Filters - Coverage And Review
**What**: Reach 100% coverage, run full gates, and obtain fresh data/search/accessibility review.
**Output**: Coverage and review evidence.
**Acceptance**: All invalid/boundary/concurrent/error paths are covered and review converges.

### ⬜ Unit 6d: Manual Tags And Filters - Visual QA
**What**: Run `visual-qa-dogfood` on new/edit authoring, recipe metadata, My Recipes, and search states at mobile and desktop sizes.
**Output**: Screenshots, metrics, and closed absurdity ledger.
**Acceptance**: Long tags fit, controls remain keyboard accessible, filter state is legible, and no layout defect remains.

### ⬜ Unit 7a: CookSession Runtime And API - Tests
**What**: Add failing pure and Workers-runtime tests for the v1 snapshot/state/command schemas, auth/origin/cache boundaries, server-built snapshots, one-attempt concurrency, revision/attempt/mutation replay, edit restart, metadata-only monotonic D1 projection, initial 503/retry, alarm scheduling, hibernatable sockets, eviction, terminal retention, purge, cleanup, and WebSocket 101 preservation.
**Output**: Red contract, Worker API, DO, projection, and cleanup tests with real SQLite DO/D1/WebSocket behavior.
**Acceptance**: Tests fail against the inert bootstrap class for the intended missing behavior.

### ⬜ Unit 7b: CookSession Runtime And API - Implementation
**What**: Implement shared cook contracts, authenticated Worker routing, D1 snapshot construction, `CookSession` SQLite state machine, monotonic projection/retry scheduler, list/detail/mutation/purge endpoints, hibernatable WebSocket fan-out, observability, and cleanup helpers.
**Output**: Durable server-canonical cook sessions and private active registry API.
**Acceptance**: Focused pure and Workers suites pass every ownership/concurrency/recovery/cleanup case with no progress fields in D1.

### ⬜ Unit 7c: CookSession Runtime And API - Coverage And Review
**What**: Reach 100% Worker/app coverage, run serialized Workers/full gates, and obtain fresh Cloudflare/security/state-machine review.
**Output**: Worker/app coverage, build, and review evidence.
**Acceptance**: Every DO/API/alarm/socket/projection branch is covered and review converges.

### ⬜ Unit 8a: Cross-Device Cook Experience - Tests
**What**: Add failing hook/route/component/Playwright tests for anonymous local reloads, authenticated start/resume, initial-empty five-second discovery, two-context live step/checklist/scale sync, reconnect, recipe mismatch choices, completion/abandonment, visibility/online polling, logout/account switching, stale sockets, and legacy local keys.
**Output**: Red app and multi-context browser tests.
**Acceptance**: Tests fail because authenticated cook mode still uses local-only route state and no home resume UI exists.

### ⬜ Unit 8b: Cross-Device Cook Experience - Implementation
**What**: Extract `CookModePanel`, add `useCookSession`, integrate authenticated server state while preserving anonymous local state, add mismatch/reconnect/terminal UX, and add the private home continue-cooking section with bounded revalidation.
**Output**: End-to-end authenticated cross-device cooking and unchanged anonymous cooking.
**Acceptance**: App and two-context browser tests pass; navigation remains reachable and private state never crosses principals.

### ⬜ Unit 8c: Cross-Device Cook Experience - Coverage And Review
**What**: Reach 100% hook/route/component coverage, run app/Workers/Playwright/full gates, and obtain fresh product/security/accessibility review.
**Output**: Coverage, browser, and review evidence.
**Acceptance**: Every client state/error/reconnect/event branch is covered and review converges.

### ⬜ Unit 8d: Cross-Device Cook Experience - Visual QA
**What**: Run `visual-qa-dogfood` on anonymous/authenticated cook mode, continue-cooking, mismatch, reconnect, terminal, and long-content states at mobile and desktop sizes.
**Output**: Screenshots, pixel/interaction metrics, and closed absurdity ledger.
**Acceptance**: No overlap/truncation/unreachable control exists; the cook workflow remains calm and usable across viewports.

### ⬜ Unit 9a: Boundaries, Smoke, And Cleanup - Tests
**What**: Add failing source-boundary and live-runner tests proving no import UI, AI tag surface, Pebble runtime behavior, navigation drift, social cook side effects, or forbidden private metadata; extend QA/production smoke and cleanup contracts for shopping/save/tag/scaling/two-client/DO residue.
**Output**: Red boundary, smoke, cleanup, and release-flow tests.
**Acceptance**: Tests fail only on missing feature smoke/cleanup coverage and any remaining prohibited runtime fixture.

### ⬜ Unit 9b: Boundaries, Smoke, And Cleanup - Implementation
**What**: Implement the focused boundary oracle and extend existing smoke/cleanup/release scripts without adding a new orchestration framework; update API/deployment/user docs and generated artifacts.
**Output**: Existing delivery paths cover all shipped/rejected feedback and remove disposable D1/DO/data residue.
**Acceptance**: Boundary/smoke/cleanup tests pass; scripts contain no secret values or custom release ledger; docs match behavior.

### ⬜ Unit 9c: Final Local Verification And Cold Reviews
**What**: Run cleanup, Prisma generation/push, numeric migrations twice, generated-contract diff, script/app typechecks, full app and Workers coverage, Playwright, build, source boundaries, and clean-tree checks; run fresh implementation, test, security/privacy, migration/release, API, and design reviews.
**Output**: Final local evidence and converged reviews in artifacts.
**Acceptance**: Every command passes with 100% new-code coverage and zero warnings; no review has an open BLOCKER/MAJOR; worktree is clean and pushed.

### ⬜ Unit 9d: Product QA, PR, Merge, And Production
**What**: Apply/deploy QA, run two-client and REST/MCP feature smoke plus cleanup/residue proof, open the product PR, resolve review/CI, merge, follow exact-SHA canary deployment, verify canonical health and post-boundary rollback capability, run production product/visual smoke, remove disposable data, close task/Desk state, and notify Slugger.
**Output**: Merged product PR, exact production deployment, smoke/cleanup evidence, archived task state, and completion notification.
**Acceptance**: Product merge SHA is live on `spoonjoy.app`; all feature and visual smoke passes; no QA/production/local residue or open required work remains.

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
