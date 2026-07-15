# Doing: Clem Feedback E2E

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-07-14 13:26
**Rebuilt**: 2026-07-15 after latest-model audit
**Planning**: ./2026-07-14-1313-planning-clem-feedback-e2e.md
**Feedback Source**: ./2026-07-14-1313-clem-feedback-source.md
**Artifacts**: ./2026-07-14-1313-doing-clem-feedback-e2e/

## Execution Mode

- **pending**: Awaiting explicit human approval before each unit; not selected.
- **spawn**: Use a sub-agent for a unit with an isolated write set.
- **direct**: Execute units sequentially in this session; selected. Independent audits or isolated implementations may still be delegated and reviewed.

## Objective
Ship the accepted Clem feedback end to end: correct shopping-list restoration, authenticated cross-device cook continuity, private saves, accepted manual tags, and backward-compatible API metadata. Preserve agentic-only import, current navigation, and neutral non-Pebble product boundaries.

## Contract Authority
- Product and technical behavior is defined in `./2026-07-14-1313-planning-clem-feedback-e2e.md`, especially the shopping matrix, cook lifecycle, SavedRecipe, RecipeTag, and REST v1 compatibility sections.
- Each unit below must preserve those exact contracts. A contract change requires an immediate planning-doc update and fresh reviewer convergence before implementation continues.

## Completion Criteria
- [ ] Every feedback item has shipped proof or an explicit rejected disposition.
- [ ] Shopping-list behavior is identical across web, REST v1, and MCP and passes concurrent/tombstone tests.
- [ ] Authenticated cook state is Durable Object-canonical, operation-revisioned, cross-device, owner-private, edit-safe, and purgeable.
- [ ] Anonymous cook state remains local-only; authenticated local cache/queue is non-canonical.
- [ ] SavedRecipe is private canonical save state with safe migration, all writer bridges, viewer-scoped search, UI, and REST v1 endpoints.
- [ ] Manual course/custom tags author, filter, search, and project through REST; no AI suggestion surface exists.
- [ ] REST v1 compatibility, OpenAPI, contract registry, generator, playground, native-sync, cookbook, search, and write suites pass.
- [ ] Current mobile dock remains stable and changed UI passes desktop/mobile visual QA.
- [ ] QA deploy and two-client smoke pass with cleanup before merge.
- [ ] The exact merged SHA deploys automatically to production and passes readiness/web/API smoke with cleanup.
- [ ] 100% coverage on all new code, all tests/builds pass, and no warnings remain.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No coverage exclusions on new code.
- Cover every branch, error, null/empty case, numeric boundary, authorization path, retry, conflict, and cleanup path.
- `workers/**` is covered by the real Cloudflare Workers Vitest project; app code remains covered by the existing project.

## TDD Requirements
1. Write the named failing tests first.
2. Run the exact targeted command and capture the expected red result in the unit artifact.
3. Implement only that unit's contract.
4. Run the targeted command green, refactor, then rerun.
5. Commit the logical unit and push immediately.

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

### ⬜ Unit 0: Reliability And Baseline Inventory
**What**: Verify worktree/branch, Node/pnpm/Cloudflare/GitHub auth, local residue, current migration order, QA/prod command safety, and baseline test/build health before feature code.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-0-research.md`; command logs for `git status --short --branch`, `pnpm cleanup:qa`, `pnpm run typecheck`, `pnpm build`, and targeted existing shopping/recipe/index/saved/nav tests.
**Acceptance**: Artifact names exact QA and production deploy/smoke/cleanup commands, records `0023_recipe_cover_prompt_lineage.sql` as current, and either shows a green baseline or isolates pre-existing failures without hiding them.

### ⬜ Unit 1a: Shopping Mutation Matrix Tests
**What**: Add red tests for the planning matrix: active unchecked, active checked, deleted tombstone, null quantities, explicit versus inferred category/icon, batch aggregation, unique end ordering, repeated calls, and concurrent D1-safe calls across web, REST v1, and MCP.
**Output**: `test/lib/shopping-list-mutations.server.test.ts`, `test/routes/shopping-list-route.test.ts`, `test/routes/api-v1-shopping-mutations.test.ts`, `test/routes/api-v1-shopping-d1.test.ts`, `test/lib/mcp/spoonjoy-tools.server.test.ts`.
**Acceptance**: `pnpm exec vitest run test/lib/shopping-list-mutations.server.test.ts test/routes/shopping-list-route.test.ts test/routes/api-v1-shopping-mutations.test.ts test/routes/api-v1-shopping-d1.test.ts test/lib/mcp/spoonjoy-tools.server.test.ts` fails only on missing/corrected shared semantics.

### ⬜ Unit 1b: Shopping Mutation Matrix Implementation
**What**: Implement `app/lib/shopping-list-mutations.server.ts`; route recipe/manual additions from web, v1, and MCP through it; update public behavior descriptions/examples.
**Output**: `app/lib/shopping-list-mutations.server.ts`, `app/lib/shopping-list.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, regenerated `app/lib/generated/api-v1-playground.ts`.
**Acceptance**: Unit 1a command and `pnpm exec vitest run test/lib/api-v1-openapi.server.test.ts test/scripts/generate-api-playground.test.ts` pass with no direct add/restore implementation left in the three callers.

### ⬜ Unit 1c: Shopping Coverage And Refactor
**What**: Cover every new helper branch, run generator stability, and remove duplicated mutation logic without changing unrelated shopping behavior.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-1-shopping.log`.
**Acceptance**: Targeted tests pass twice, new helper coverage is 100%, `pnpm run api:playground:generate` is idempotent, and `git diff --check` is clean.

### ⬜ Unit 2a: Workers Runtime Harness Tests
**What**: Add red repository/config tests requiring an official Workers Vitest project, SQLite DO/D1 bindings, separate worker coverage, normal-pool exclusion, and CI execution.
**Output**: `test/config/workers-vitest.test.ts`, updates to `test/repo-hygiene.test.ts`.
**Acceptance**: `pnpm exec vitest run test/config/workers-vitest.test.ts test/repo-hygiene.test.ts` fails because the harness/scripts/CI step do not exist.

### ⬜ Unit 2b: Workers Runtime Harness Implementation
**What**: Install and configure `@cloudflare/vitest-pool-workers`; add the isolated worker project and CI scripts without moving existing happy-dom tests.
**Output**: `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, new `vitest.config.workers.ts`, new `test/workers/env.d.ts`, new `test/workers/runtime.test.ts`, `.github/workflows/ci.yml`.
**Acceptance**: Unit 2a passes; `pnpm test:workers` starts the real Workers pool and passes the binding/runtime smoke test; `pnpm test:workers:coverage` enforces 100% for new `workers/**`; normal `pnpm test:coverage` excludes `test/workers/**`.

### ⬜ Unit 2c: Workers Harness Verification
**What**: Run the empty/baseline Workers project, app coverage, typecheck, and CI-config tests.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-2-workers-harness.log`.
**Acceptance**: `pnpm test:workers:coverage`, `pnpm exec vitest run test/config/workers-vitest.test.ts`, and `pnpm run typecheck` pass with zero warnings.

### ⬜ Unit 3a: REST Recipe Metadata Contract Tests
**What**: Add red tests for additive `stepCount`, source normalization, nullable/empty placeholder shapes for later `course`/`tags`/`isSaved`, detail-only `scaleFactor=0.25..50`, invalid/multiple/nonfinite input, null quantity, immutable stored quantity, and unchanged list/search semantics. Functional authenticated `isSaved` and tag values are tested only after their data primitives exist in Units 14 and 18.
**Output**: `test/lib/api-v1-recipe-metadata.server.test.ts`, `test/routes/api-v1-recipes.test.ts`, `test/routes/api-v1-search.test.ts`, `test/routes/api-v1-native-sync.test.ts`, `test/routes/api-v1-recipe-writes.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/scripts/generate-api-playground.test.ts`, `test/routes/developers-playground.test.tsx`.
**Acceptance**: The named Vitest files fail only on absent metadata/scaling contracts; existing v1 field assertions remain unchanged.

### ⬜ Unit 3b: REST Recipe Metadata Implementation
**What**: Add `stepCount`, `sourceDisplayName`, `scaleFactor`, and `scaledQuantity` now; reserve `course`, `tags`, and functional `isSaved` wiring for later units while schemas expose their nullable/empty backward-compatible shape.
**Output**: New `app/lib/api-v1-recipe-metadata.server.ts`; updates to `app/lib/api-v1.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/lib/api-v1-contract.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.playground.tsx`, `app/routes/developers.tsx`, `docs/api.md`.
**Acceptance**: Unit 3a files pass; `quantity` and `servings` retain existing types/values; unauthenticated placeholder values are `course: null`, `tags: []`, and `isSaved: null`; scaled reads perform no writes; invalid scale uses existing `validation_error`.

### ⬜ Unit 3c: REST Metadata Coverage
**What**: Cover normalization/scaling boundaries and run every response-builder consumer affected by shared schemas.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-3-api-metadata.log`.
**Acceptance**: `pnpm exec vitest run test/routes/api-v1-recipes.test.ts test/routes/api-v1-search.test.ts test/routes/api-v1-native-sync.test.ts test/routes/api-v1-recipe-writes.test.ts test/routes/api-v1-cookbooks.test.ts test/lib/api-v1-openapi.server.test.ts test/routes/api-v1-openapi.test.ts test/scripts/generate-api-playground.test.ts test/routes/developers-playground.test.tsx` passes; helper coverage is 100%.

### ⬜ Unit 4a: Cook Index Migration Tests
**What**: Add red tests for `CookSessionIndex`, per-attempt UUID rows, nullable unique `activeKey` as projection integrity (not arbitration), owner/recipe/status/timestamp metadata, terminal history, foreign keys, and exact dual migration files.
**Output**: `test/models/cook-session-index.test.ts`, `test/scripts/migration-0024-cook-session-index.test.ts`, `test/lib/cook-session-index.server.test.ts`.
**Acceptance**: Targeted tests fail because schema, migration `0024`, and helper are absent.

### ⬜ Unit 4b: Cook Index Migration Implementation
**What**: Add the D1/Prisma model and deterministic helper operations for active insert race recovery, owner lookup, projection upsert, terminal transition, owner-only list, and purge.
**Output**: `prisma/schema.prisma`, `migrations/0024_cook_session_index.sql`, `prisma/migrations/20260715100000_cook_session_index/migration.sql`, `app/lib/cook-session-index.server.ts`.
**Acceptance**: Unit 4a passes; projection upsert is idempotent by attemptId; ordered terminal-then-new-active writes preserve one active row; completed/abandoned rows have null activeKey; other-user list/delete returns no private data.

### ⬜ Unit 4c: Cook Index Coverage And Migration Verification
**What**: Run Prisma generation, local D1 migration application, migration rerun checks, helper coverage, and typecheck.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-4-cook-index.log`.
**Acceptance**: `pnpm prisma:generate`, local migration tests, targeted coverage, and `pnpm run typecheck` pass with no warning or migration collision.

### ⬜ Unit 5a: Cook State Core Tests
**What**: Add red pure tests for canonical snapshot serialization/SHA-256 fingerprint, attempt initialization/replacement, stable-id operations, scale boundaries, revision conflicts, stale attempt rejection, bounded progress-mutation dedupe, 24-hour/64-entry non-evicting start-request idempotency and backpressure, terminal/PURGING request fencing, exact adoption schema/validation/outcomes, first-writer/server-wins arbitration, and rebase ordering.
**Output**: `test/lib/cook-session-state.test.ts`.
**Acceptance**: `pnpm exec vitest run test/lib/cook-session-state.test.ts` fails because `app/lib/cook-session-state.ts` and `app/lib/cook-session-types.ts` are absent.

### ⬜ Unit 5b: Cook State Core Implementation
**What**: Implement client/server-safe types and pure deterministic state transitions exactly matching the planning contract.
**Output**: `app/lib/cook-session-types.ts`, `app/lib/cook-session-state.ts`, updates to `app/lib/recipe-detail.server.ts` for server-trusted snapshot creation.
**Acceptance**: Unit 5a passes; no operation accepts unknown ids, terminal sessions reject progress mutation, and canonical fingerprints are stable across object-key order.

### ⬜ Unit 5c: Cook State Core Coverage
**What**: Cover all core branches and verify the shared modules contain no server-only import used by the browser.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-5-cook-state.log`.
**Acceptance**: Core coverage is 100%, `pnpm run typecheck` and `pnpm build` pass.

### ⬜ Unit 6a: Durable Object Binding And Storage Tests
**What**: Add real Workers red tests for deterministic `idFromName(userId:recipeId)` arbitration, SQLite-backed `CookSessionDurableObject`, immutable identity, attempt replacement, storage restart, revision/dedupe behavior, top-level and QA bindings/migrations, Env types, export, and generated deployment config checks.
**Output**: `test/workers/cook-session-do.test.ts`, `test/config/wrangler-durable-objects.test.ts`, updates to `test/scripts/deployment-preflight.test.ts`.
**Acceptance**: `pnpm test:workers -- test/workers/cook-session-do.test.ts` and config tests fail because class/bindings/checks are absent.

### ⬜ Unit 6b: Durable Object Binding And Storage Implementation
**What**: Implement SQLite DO persistence and configure `new_sqlite_classes` explicitly for production and QA; export the class and extend Cloudflare Env types/preflight checks.
**Output**: `workers/cook-session-do.ts`, `workers/app.ts`, `wrangler.json`, `app/cloudflare-env.d.ts`, `scripts/deployment-preflight.ts`.
**Acceptance**: Unit 6a passes; both envs bind `COOK_SESSIONS`; parallel starts serialize to one attempt; state survives object restart; owner/recipe identity cannot be reinitialized differently.

### ⬜ Unit 6c: Durable Object Storage Coverage
**What**: Exercise all DO storage/state errors in the Workers pool and validate Wrangler source/generated config.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-6-do-storage.log`.
**Acceptance**: Worker coverage for the class is 100%; `pnpm run deploy:preflight` and QA preflight source-mode checks pass without remote mutation.

### ⬜ Unit 7a: Internal Cook HTTP And WebSocket Tests
**What**: Add real Worker red tests for deterministic user/recipe routing, blank/adoption start races, 24-hour replay, ledger expiry/full backpressure, API-safe 401, same-origin checks, initial recipe visibility, attempt-bound snapshot/patch/409 payloads, private no-store on every non-101 response/error, complete/abandon/purge idempotency, PURGING rejection for every non-delete method/upgrade, WebSocket 101 retention, initial/broadcast snapshots, purge code-4001 closure, stale-attempt socket closure, hibernation attachments, malformed methods/bodies, and missing attempts.
**Output**: `test/workers/app-cook-sessions.test.ts`, additions to `test/workers/cook-session-do.test.ts`, `test/workers/app.test.ts`.
**Acceptance**: `pnpm test:workers -- test/workers/app-cook-sessions.test.ts test/workers/cook-session-do.test.ts` fails because the Worker-level internal API is absent.

### ⬜ Unit 7b: Internal Cook HTTP And WebSocket Implementation
**What**: Intercept `/api/cook-sessions` in `workers/app.ts` before React Router; authenticate with `getUserId`; derive the DO from authenticated user id plus route/body recipe id; provide a server-built recipe snapshot only when a pristine DO starts its first attempt; implement exact `/api/cook-sessions/recipes/:recipeId` lifecycle routing and hibernation WebSockets; bypass response rebuilding only for 101 while applying security/no-store headers to ordinary responses.
**Output**: `app/lib/cook-session-http.server.ts`, `workers/app.ts`, `workers/cook-session-do.ts`, `app/lib/cook-session-index.server.ts`.
**Acceptance**: Unit 7a passes; no cook route is registered in `app/routes.ts` or OpenAPI; D1 freshness is not required for authorization or start/resume; any server attempt wins over client adoption; old attempt ids cannot mutate new attempts; PURGING appends no new work; ordinary responses are private no-store; full default-export WebSocket tests receive a usable socket.

### ⬜ Unit 7c: Internal Cook API Coverage
**What**: Cover HTTP parser/auth/origin/proxy failures and WebSocket close/error/message branches in the Workers runtime.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-7-cook-api.log`.
**Acceptance**: New Worker/API code is 100% covered; `pnpm test:workers:coverage`, `pnpm run typecheck`, and `pnpm build` pass.

### ⬜ Unit 8a: D1 Projection Alarm Tests
**What**: Add real Workers red tests for ordered projection-queue persistence on create/update/complete/abandon, idempotent D1 writes, terminal-old-before-active-new ordering, at-least-once alarm replay, transient failure, retry exhaustion/reschedule, stale My Kitchen projection recovery, FIFO purge barriers, `old terminal pending -> new attempt -> purge`, and failures before/after D1 delete and before DO `deleteAll()`.
**Output**: `test/workers/cook-session-alarm.test.ts`, additions to `test/lib/cook-session-index.server.test.ts`.
**Acceptance**: Targeted worker/app tests fail because all projection transitions and retry markers are not alarm-driven.

### ⬜ Unit 8b: D1 Projection Alarm Implementation
**What**: Persist one ordered projection queue in the DO, schedule/reschedule alarms, reconcile every lifecycle mutation to D1 without making D1 canonical, and execute purge as persisted PURGING -> drain older FIFO projections -> idempotent current-attempt D1 delete -> DO `deleteAll()`.
**Output**: `workers/cook-session-do.ts`, `app/lib/cook-session-index.server.ts`.
**Acceptance**: Unit 8a passes; accepted DO mutations and older terminal projections survive D1 failure/new-attempt creation; repeated alarms do not duplicate history; purge cannot erase an older repair; every purge failure resumes safely; completion creates no RecipeSpoon or notification.

### ⬜ Unit 8c: Projection Coverage
**What**: Cover alarm retries and verify no RecipeSpoon integration was added.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-8-projection.log`.
**Acceptance**: Worker/index coverage is 100%; `test/models/recipe-spoon.test.ts` and notification regression tests remain green.

### ⬜ Unit 9a: Cook Client Controller Tests
**What**: Add red browser tests for recipe-keyed create/resume discovery, exact adoption body, adopted/server-won/not-requested outcomes, anonymous record cleanup, attempt-bound operation queueing, WebSocket snapshots, stale-attempt handling, 409 rebase/retry, reconnect same-field precedence, offline cache as non-canonical, anonymous local mode, and storage failure.
**Output**: `test/lib/cook-session-client.test.ts`, updates to `test/routes/recipes-id.test.tsx` for loader inputs only.
**Acceptance**: Targeted tests fail because `app/lib/cook-session-client.ts` and `app/hooks/useCookSession.ts` are absent.

### ⬜ Unit 9b: Cook Client Controller Implementation
**What**: Implement fetch/WebSocket transport and `useCookSession`; retain current versioned local parser for anonymous mode and use a separate authenticated cache/operation queue.
**Output**: `app/lib/cook-session-client.ts`, `app/hooks/useCookSession.ts`, targeted exports/loader data in `app/routes/recipes.$id.tsx`.
**Acceptance**: Unit 9a passes; authenticated UI never compares client time to override server state; it clears the anonymous record after any start outcome; queued operations survive reconnect and clear only after server acceptance.

### ⬜ Unit 9c: Cook Client Coverage
**What**: Cover network, JSON, socket, 401/403/404/409, retry, unload, and storage-unavailable branches.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-9-cook-client.log`.
**Acceptance**: New client/hook code is 100% covered and existing anonymous progress tests remain green.

### ⬜ Unit 10a: Recipe Cook Lifecycle UI Tests
**What**: Add red route tests for server snapshot rendering, cross-client updates, persisted scale/check/step state, adoption choice, recipe fingerprint warning, Continue original, Start fresh abandon/create order, complete, abandon, and terminal UI.
**Output**: `test/routes/recipes-id.test.tsx`, `test/routes/recipes-id-scaling.test.tsx`.
**Acceptance**: Targeted tests fail only on missing lifecycle UI integration.

### ⬜ Unit 10b: Recipe Cook Lifecycle UI Implementation
**What**: Replace authenticated local state wiring in `app/routes/recipes.$id.tsx` with `useCookSession`; add compact warning/terminal controls using existing button/icon conventions; keep anonymous behavior and recipe detail layout.
**Output**: `app/routes/recipes.$id.tsx`, new `app/components/recipe/CookSessionStatus.tsx`.
**Acceptance**: Unit 10a passes; recipe edits never silently remap; Start fresh abandons before create; complete/abandon remove active state; scale persists through DO operations.

### ⬜ Unit 10c: Recipe Cook UI Coverage
**What**: Cover every UI state/error/action and run route/build tests.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-10-cook-ui.log`.
**Acceptance**: New component/route branches are 100% covered; recipe detail, scaling, dock-integration, and build suites pass.

### ⬜ Unit 10d: Recipe Cook UI Visual QA
**What**: Invoke `visual-qa-dogfood` for desktop/mobile cook mode, edit warning, reconnect, complete, and anonymous states.
**Output**: Screenshots, overflow metrics, interaction ledger, and absurdity ledger under `./2026-07-14-1313-doing-clem-feedback-e2e/visual-cook/`.
**Acceptance**: No ready visual issue, overlap, layout shift, inaccessible control, or mobile-dock collision remains.

### ⬜ Unit 11a: Owner-Only Continue Cooking Tests
**What**: Add red loader/render tests for owner active cards, empty/terminal removal, recipe soft-delete handling, and strict absence for authenticated visitors and anonymous visitors viewing another kitchen.
**Output**: `test/routes/index.test.tsx`, `test/components/navigation/mobile-nav.test.tsx`.
**Acceptance**: Tests fail because owner-only Continue Cooking is absent; existing dock destinations stay asserted unchanged.

### ⬜ Unit 11b: Owner-Only Continue Cooking Implementation
**What**: Load D1 active metadata only when `viewer.id === kitchenUser.id` and render an unframed Continue Cooking section without changing mobile dock/drawer links.
**Output**: `app/routes/_index.tsx`, new `app/components/recipe/ContinueCookingList.tsx`.
**Acceptance**: Unit 11a passes; private queries are not executed for non-owner views; no private session id/title/progress enters visitor loader data.

### ⬜ Unit 11c: Continue Cooking Coverage And Visual QA
**What**: Cover owner/privacy states and visually inspect My Kitchen desktop/mobile with and without active sessions.
**Output**: Coverage log and screenshots under `./2026-07-14-1313-doing-clem-feedback-e2e/visual-kitchen-cooking/`.
**Acceptance**: New code is 100% covered; privacy tests and navigation tests pass; visual ledger is closed.

### ⬜ Unit 12a: SavedRecipe Migration Tests
**What**: Add red schema/migration tests for hard-delete saves, unique pair, owner-derived distinct active-recipe backfill, conflict-ignore rerun, soft-delete hide/restore, and migration numbering.
**Output**: `test/models/saved-recipe.test.ts`, `test/scripts/migration-0025-saved-recipes.test.ts`, `test/lib/saved-recipes.server.test.ts`.
**Acceptance**: Tests fail because SavedRecipe and `0025_saved_recipes.sql` do not exist.

### ⬜ Unit 12b: SavedRecipe Migration Implementation
**What**: Add schema/migrations and canonical save/unsave/get/list helpers; put the backfill in SQL, not runtime code.
**Output**: `prisma/schema.prisma`, `migrations/0025_saved_recipes.sql`, `prisma/migrations/20260715101000_saved_recipes/migration.sql`, `app/lib/saved-recipes.server.ts`.
**Acceptance**: Unit 12a passes; rerun is harmless; `Cookbook.authorId`, not `addedById`, owns the backfilled save; explicit unsave hard-deletes only SavedRecipe.

### ⬜ Unit 12c: SavedRecipe Migration Coverage
**What**: Run Prisma generation, local migration/rerun, model/helper coverage, and typecheck.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-12-saved-data.log`.
**Acceptance**: Commands pass with 100% new helper coverage and no migration residue/warning.

### ⬜ Unit 13a: Cookbook Writer Compatibility Tests
**What**: Add red tests for all four membership writers ensuring owner save, idempotent repeat, remove-without-unsave, unsave-without-membership-removal, authorization, and unchanged notifications.
**Output**: `test/lib/recipe-detail.server.test.ts`, `test/routes/cookbooks-id.test.tsx`, `test/lib/spoonjoy-api-cookbook-notification.test.ts`, `test/routes/api-v1-cookbooks.test.ts`, `test/lib/saved-recipes.server.test.ts`.
**Acceptance**: Targeted tests fail because membership creation does not ensure SavedRecipe.

### ⬜ Unit 13b: Cookbook Writer Compatibility Implementation
**What**: Call the canonical SavedRecipe helper after membership creation in every writer, inside the existing transaction boundary where one exists; do not couple removal paths.
**Output**: `app/lib/recipe-detail.server.ts`, `app/routes/cookbooks.$id.tsx`, `app/lib/spoonjoy-api.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/saved-recipes.server.ts`.
**Acceptance**: Unit 13a passes for web, MCP, and REST; notification assertions are unchanged; removal/unsave independence is proven.

### ⬜ Unit 13c: Cookbook Compatibility Coverage
**What**: Cover duplicate, missing recipe, non-owner, deleted recipe, and transaction failure branches.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-13-saved-compat.log`.
**Acceptance**: Changed branches are 100% covered and cookbook/MCP/API regression suites pass.

### ⬜ Unit 14a: Saved REST v1 Tests
**What**: Add red tests for private list and idempotent put/delete endpoints, scopes, session/bearer auth, no-store, pagination/error envelopes, ownership, soft-deleted recipes, and `isSaved` on recipe summary/detail.
**Output**: `test/routes/api-v1-saved-recipes.test.ts`, `test/routes/api-v1-recipes.test.ts`, `test/routes/api-v1-scopes.test.ts`, `test/config/api-v1-route-coverage.test.ts`, OpenAPI/contract/generator/playground tests.
**Acceptance**: Named tests fail because `/api/v1/me/saved-recipes` contracts and functional `isSaved` are absent.

### ⬜ Unit 14b: Saved REST v1 Implementation
**What**: Register and implement `GET /api/v1/me/saved-recipes` plus `PUT`/`DELETE /api/v1/me/saved-recipes/:recipeId` with existing v1 conventions; wire viewer-specific `isSaved` without public counts.
**Output**: `app/lib/api-v1.server.ts`, `app/lib/api-v1-contract.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/routes/api.$.ts`, `scripts/generate-api-playground.ts`, generated playground, developer API docs.
**Acceptance**: Unit 14a passes; anonymous/public token `isSaved` is null; authenticated value is boolean; private responses are no-store and scope-safe.

### ⬜ Unit 14c: Saved REST Coverage
**What**: Run all recipe/list/search/native-sync/write/cookbook/OpenAPI/generator consumers and cover every new endpoint branch.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-14-saved-api.log`.
**Acceptance**: New API code is 100% covered and all named cross-contract suites pass.

### ⬜ Unit 15a: Saved UI And Search Privacy Tests
**What**: Add red tests for `/saved-recipes` canonical data, viewer-scoped query intersection, explicit save control separate from cookbook control, owner-only My Kitchen section, empty/query states, and owner/authenticated-visitor/anonymous privacy.
**Output**: `test/routes/saved-recipes.test.tsx`, `test/routes/recipes-id.test.tsx`, `test/routes/index.test.tsx`, `test/lib/search.server.test.ts`.
**Acceptance**: Tests fail because UI still derives saves from cookbook membership and search lacks viewer overlay.

### ⬜ Unit 15b: Saved UI And Search Privacy Implementation
**What**: Use SavedRecipe in `/saved-recipes`, recipe detail, and owner My Kitchen; add an explicit save button; implement search-result intersection without putting private state in global SearchDocument.
**Output**: `app/routes/saved-recipes.tsx`, `app/routes/recipes.$id.tsx`, `app/routes/_index.tsx`, new `app/components/recipe/SaveRecipeButton.tsx`, existing `app/components/recipe/SaveToCookbookDropdown.tsx`, `app/lib/search.server.ts`.
**Acceptance**: Unit 15a passes; save and cookbook controls have distinct copy/actions; non-owner kitchens load/render no private saves; global index metadata contains no user save state.

### ⬜ Unit 15c: Saved UI Coverage And Visual QA
**What**: Cover UI/search/privacy branches and invoke visual QA on recipe detail, `/saved-recipes`, and My Kitchen desktop/mobile.
**Output**: Coverage log and screenshots under `./2026-07-14-1313-doing-clem-feedback-e2e/visual-saved/`.
**Acceptance**: New code is 100% covered; search/privacy tests pass; visual ledger is closed with controls clearly distinct.

### ⬜ Unit 16a: RecipeTag Migration And Service Tests
**What**: Add red tests for accepted-only schema, owner authorization, manual source, singular controlled course, normalized custom uniqueness, validation boundaries, delete/re-add, soft-deleted recipe behavior, and exact migrations.
**Output**: `test/models/recipe-tag.test.ts`, `test/lib/recipe-tags.server.test.ts`, `test/scripts/migration-0026-recipe-tags.test.ts`.
**Acceptance**: Tests fail because RecipeTag, service, and migration `0026` are absent.

### ⬜ Unit 16b: RecipeTag Migration And Service Implementation
**What**: Add schema/migrations and exact owner-only replace-course/add/remove/list service operations; do not add AI proposal state.
**Output**: `prisma/schema.prisma`, `migrations/0026_recipe_tags.sql`, `prisma/migrations/20260715102000_recipe_tags/migration.sql`, `app/lib/recipe-tags.server.ts`.
**Acceptance**: Unit 16a passes; one course maximum; allowed courses only; custom normalization is deterministic; source is MANUAL.

### ⬜ Unit 16c: RecipeTag Data Coverage
**What**: Run Prisma generation, migrations, model/service coverage, and typecheck.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-16-tags-data.log`.
**Acceptance**: New service coverage is 100%; migration rerun and typecheck pass.

### ⬜ Unit 17a: Tag Authoring Tests
**What**: Add red tests for course segmented/select control, custom-tag entry/removal, server validation display, create/edit persistence, owner-only mutation, and recipe detail/card display density.
**Output**: `test/components/recipe/RecipeBuilder.test.tsx`, `test/routes/recipes-new.test.tsx`, `test/routes/recipes-id-edit.test.tsx`, `test/routes/recipes-id.test.tsx`, `test/routes/recipes-index.test.tsx`, `test/components/pantry/RecipeGrid.test.tsx`.
**Acceptance**: Tests fail only because tag authoring/display is absent.

### ⬜ Unit 17b: Tag Authoring Implementation
**What**: Add optional course and custom-tag fields to RecipeBuilder and create/edit services; display compact tags on detail/list cards using existing design primitives.
**Output**: `app/components/recipe/RecipeBuilder.tsx`, `app/lib/recipe-create.server.ts`, `app/lib/recipe-detail.server.ts`, `app/routes/recipes.new.tsx`, `app/routes/recipes.$id.edit.tsx`, `app/routes/recipes.$id.tsx`, `app/routes/recipes._index.tsx`, `app/components/pantry/RecipeGrid.tsx`.
**Acceptance**: Unit 17a passes; only owners mutate; server rejects invalid course/tag input; no AI wording/control exists.

### ⬜ Unit 17c: Tag Authoring Coverage And Visual QA
**What**: Cover authoring/display branches and visually inspect create/edit/detail/cards at desktop/mobile widths.
**Output**: Coverage and screenshots under `./2026-07-14-1313-doing-clem-feedback-e2e/visual-tags-authoring/`.
**Acceptance**: New code is 100% covered; no text overflow/card crowding; visual ledger closed.

### ⬜ Unit 18a: Tag Discovery And API Tests
**What**: Add red tests for tag/course filters in My Recipes, My Kitchen, and Search; global SearchDocument fingerprint/content; summary/detail REST fields; OpenAPI/contract/generator/playground/docs; no AI suggestion contract.
**Output**: `test/lib/search.server.test.ts`, `test/routes/recipes-index.test.tsx`, `test/routes/index.test.tsx`, `test/routes/search.test.tsx`, `test/components/pantry/RecipeGrid.test.tsx`, `test/routes/api-v1-recipes.test.ts`, `test/routes/api-v1-search.test.ts`, OpenAPI/contract/generator/docs tests.
**Acceptance**: Tests fail because accepted tags do not yet power discovery/API.

### ⬜ Unit 18b: Tag Discovery And API Implementation
**What**: Include accepted tags in recipe search fingerprints/documents; add exact course/custom filters to the three discovery surfaces; populate REST `course` and `tags`; update generated/public docs.
**Output**: `app/lib/search.server.ts`, `app/routes/recipes._index.tsx`, `app/routes/_index.tsx`, `app/routes/search.tsx`, `app/components/pantry/RecipeGrid.tsx`, API v1 contract/OpenAPI/server/generator/playground/developer files.
**Acceptance**: Unit 18a passes; only accepted manual tags are indexed/projected; saved privacy remains intact; list/search behavior without filters is unchanged.

### ⬜ Unit 18c: Tag Discovery/API Coverage And Visual QA
**What**: Cover filter/index/API branches, run all shared response consumers, and visually inspect compact filters/cards/mobile My Kitchen.
**Output**: Coverage and screenshots under `./2026-07-14-1313-doing-clem-feedback-e2e/visual-tags-discovery/`.
**Acceptance**: New code 100% covered; API/doc generation stable; no dock churn or crowded cards; visual ledger closed.

### ⬜ Unit 19a: Feedback Boundary Regression Tests
**What**: Add scoped regression assertions that current mobile dock/drawer destinations remain unchanged, no new first-party import entry point exists, agent/API import docs remain, changed API/product copy has no Pebble-specific contract, and no AI tag surface exists.
**Output**: `test/components/navigation/mobile-nav.test.tsx`, `test/repo-hygiene.test.ts`, `test/docs/developer-platform-docs.test.ts`, `test/docs/developer-platform-guide.test.ts`.
**Acceptance**: Tests are green or fail only on stale changed-surface copy; they do not ban existing unrelated telemetry strings or target redirect-only `app/routes/api.docs.ts`.

### ⬜ Unit 19b: Feedback Boundary Cleanup
**What**: Make only evidence-backed copy/doc fixes from Unit 19a; do not edit `mobile-nav.tsx` unless an automated or visual defect proves a focused change is required.
**Output**: `app/routes/developers.tsx`, `app/routes/mcp.tsx`, `docs/api.md`, and generated API docs only when a failing assertion requires them.
**Acceptance**: Unit 19a and all nav/docs tests pass; no product import UI, AI suggestion UI, Pebble-specific API field, or unnecessary dock change is present.

### ⬜ Unit 19c: Feedback Disposition Audit
**What**: Re-read `2026-07-14-1313-clem-feedback-source.md` against the final diff and record proof/rejection for every row.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-19-feedback-audit.md`.
**Acceptance**: No source item is missing, silently deferred, or represented by a claim without test/code evidence.

### ⬜ Unit 20a: Live Smoke Lifecycle Tests
**What**: Add red script tests for two authenticated browser contexts sharing one session, WebSocket step/check/scale sync, recipe-edit warning, complete/abandon, owner purge, D1 user cleanup, and post-run residue inspection.
**Output**: `test/scripts/smoke-live.test.ts`, `test/scripts/smoke-live-helpers.test.ts`.
**Acceptance**: Tests fail because live smoke does not exercise or purge Durable Object state.

### ⬜ Unit 20b: Live Smoke Lifecycle Implementation
**What**: Extend smoke helpers to create disposable `codex-smoke-*` state, validate two-context synchronization, purge each current attempt through its recipe-keyed deterministic DO before deleting D1 users, and verify no D1/DO test residue remains.
**Output**: `scripts/smoke-live.mjs`, `scripts/smoke-live-helpers.mjs`.
**Acceptance**: Unit 20a passes; cleanup executes in `finally`; smoke retries asynchronous purge to `204` before deleting the user; failed smoke still attempts purge/user cleanup and records residue.

### ⬜ Unit 20c: Smoke Coverage
**What**: Cover successful/failing/partial cleanup branches and dry-run local residue checks.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-20-smoke.log`.
**Acceptance**: Script tests are 100% covered for new logic and `pnpm cleanup:qa` reports no disposable local residue.

### ⬜ Unit 21: Final Local Validation
**What**: Run `pnpm cleanup:qa`, `pnpm prisma:generate`, local D1 migrations, `pnpm run api:playground:generate`, `pnpm run typecheck`, `pnpm run typecheck:scripts`, `pnpm test:workers:coverage`, `pnpm test:coverage`, `pnpm test:e2e`, `pnpm build`, `git diff --check`, and a fresh implementation review.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-21-local-validation.md` plus raw logs.
**Acceptance**: Every command passes with zero warnings and 100% new-code coverage; harsh review has no BLOCKER/MAJOR; repository and local QA residue are clean.

### ⬜ Unit 22: QA Deploy And Cross-Device Gate
**What**: Inspect remote QA residue, run `pnpm deploy:qa`, execute QA readiness/web/API/two-client smoke against `https://spoonjoy-v2-qa.mendelow-studio.workers.dev`, purge smoke sessions/users, and inspect residue again.
**Output**: QA deploy URL/version, smoke screenshots/logs, cleanup dry-run logs, and `./2026-07-14-1313-doing-clem-feedback-e2e/unit-22-qa.md`.
**Acceptance**: QA deploy and all smokes pass before merge; no disposable D1/DO state remains. Stop only for a true credential/capability blocker, not a product/test failure.

### ⬜ Unit 23: PR Review, CI, And Merge
**What**: Invoke `work-merger`; sync `origin/main`, resolve conflicts with task docs, open a ready PR, run fresh harsh implementation/design/test/security reviews, wait for all CI including Workers coverage/e2e, repair failures, and merge.
**Output**: PR URL, review evidence, green CI run URLs, merge commit SHA, and `./2026-07-14-1313-doing-clem-feedback-e2e/unit-23-merge.md`.
**Acceptance**: Ready PR is merged to main with no unresolved review or CI finding; exact merge SHA is recorded.

### ⬜ Unit 24: Production Deploy, Smoke, Cleanup, And Handoff
**What**: Wait for the automatic `Production Deploy` workflow for the exact merge SHA; do not race it with manual deploy. After success, run `pnpm production:readiness`, production web/API smoke, two-client cook smoke, purge/cleanup, continuation scan, worktree/branch cleanup, and Slugger notification.
**Output**: Production workflow URL/version, `https://spoonjoy.app` smoke evidence, cleanup logs, continuation scan, and `ouro msg --to slugger "Done: shipped Clem feedback end to end"` result.
**Acceptance**: Exact merged SHA is live, readiness/web/API/cross-device checks pass, no disposable data or ready in-scope follow-up remains, git/Desk state is terminal and clean, and Slugger is notified.

## Execution
- Tests -> confirmed red -> implementation -> green -> refactor for every a/b/c group.
- Update each unit emoji as work progresses; record commands/results in the artifact directory.
- Commit and push every logical unit immediately.
- Invoke `visual-qa-dogfood` for Units 10d, 11c, 15c, 17c, and 18c.
- Invoke `work-merger` at Unit 23 and `stay-in-turn` while CI/deploy is running.
- Never leave smoke/manual users, recipes, cook sessions, saves, or tags behind.

## Progress Log
- 2026-07-14 13:26 Initial doing doc created.
- 2026-07-14 13:46 Initial granularity/validation/ambiguity rounds completed but review chain did not converge.
- 2026-07-15 Latest-model audit found missing lifecycle, privacy, Workers runtime, WebSocket, migration, API compatibility, and deploy-order contracts.
- 2026-07-15 Rebuilt from the re-audited planning doc with exact TDD units and QA-before-merge sequencing; status remains `drafting` pending the mandatory fresh review chain.
