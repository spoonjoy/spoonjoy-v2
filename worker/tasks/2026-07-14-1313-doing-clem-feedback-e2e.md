# Doing: Clem Feedback E2E

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-07-14 13:26
**Rebuilt**: 2026-07-15 after latest-model audit
**Planning**: ./2026-07-14-1313-planning-clem-feedback-e2e.md
**Feedback Source**: ./2026-07-14-1313-clem-feedback-source.md
**Artifacts**: ./2026-07-14-1313-doing-clem-feedback-e2e/

## Execution Mode

- **pending**: Explicit human approval before each unit; not selected.
- **spawn**: Use a sub-agent for an isolated unit.
- **direct**: Execute sequentially in this session; selected. Fresh reviewers still gate non-trivial units.

## Objective
Ship every accepted Clem feedback item end to end: correct shopping restoration, authenticated cross-device cook continuity, private saves, accepted manual tags, and backward-compatible API metadata. Preserve agentic-only import, current navigation, and neutral non-Pebble boundaries.

## Contract Authority
- `./2026-07-14-1313-planning-clem-feedback-e2e.md` defines exact shopping, cook, SavedRecipe, RecipeTag, REST v1, privacy, purge, and deployment behavior.
- Any contract change requires an immediate planning-doc update and fresh reviewer convergence before implementation resumes.

## Completion Criteria
- [ ] Every feedback-source row has shipped proof or an explicit rejected disposition.
- [ ] Shopping behavior matches the matrix across web, REST v1, and MCP under repeated/concurrent calls.
- [ ] Authenticated cook state is DO-canonical, operation-revisioned, cross-device, owner-private, edit-safe, and purgeable; anonymous state stays local-only.
- [ ] SavedRecipe is private canonical save state with safe backfill, every writer bridge, viewer-scoped search, UI, and REST endpoints.
- [ ] Manual course/custom tags author, display, filter, search, and project through REST; no AI suggestion surface exists.
- [ ] REST v1, OpenAPI, contract registry, generator, playground, native-sync, cookbook, search, and write suites pass compatibly.
- [ ] Current mobile navigation remains stable and changed UI passes desktop/mobile visual QA.
- [ ] QA deploy plus two-client smoke/cleanup pass before merge.
- [ ] The exact merge SHA's automatic production deploy passes readiness, web/API/two-client smoke, and cleanup.
- [ ] All tests/builds pass with zero warnings and 100% coverage on every new code path, including `workers/**`.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No coverage exclusions on new code.
- Cover every branch, auth/error response, null/empty input, numeric boundary, retry, conflict, race, and cleanup path.
- `workers/**` uses the real Cloudflare Workers Vitest project; app code uses the existing project.

## TDD Requirements
1. In each `a` unit, write every behavioral/error/coverage test named by the group, capture the expected red command/output, then commit and push that intentional-red test checkpoint.
2. In the matching `b` unit, implement without changing the `a` tests, run green plus build/typecheck, then commit and push the green implementation checkpoint.
3. The matching `c` unit is verification-only: run coverage/refactor/build commands and record evidence; do not add behavioral tests or implementation. If `c` finds a gap, reopen `a` with a new failing test, repeat `b`, then rerun `c`.
4. A group is complete only after `c` passes; update all three emojis/progress entries and run a fresh group review. Commit/push docs and verification artifacts according to Work Doer.

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

### ⬜ Unit 0: Reliability And Baseline Inventory
**What**: Verify branch/worktree, Node/pnpm/Cloudflare/GitHub auth, local residue, migration order, QA/prod command safety, and baseline typecheck/build/targeted tests.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-0-research.md` plus command logs.
**Acceptance**: Artifact records `0023_recipe_cover_prompt_lineage.sql` as current, exact cleanup/deploy/smoke commands, and a green baseline or isolated pre-existing failure.

### ⬜ Unit 1a: Shopping Mutation Matrix Tests
**What**: Add red tests for active-unchecked, active-checked, tombstone, null quantity, category/icon override, aggregation, unique end ordering, repeated calls, and concurrent web/v1/MCP behavior.
**Output**: `test/lib/shopping-list-mutations.server.test.ts`, `test/routes/shopping-list-route.test.ts`, `test/routes/api-v1-shopping-mutations.test.ts`, `test/routes/api-v1-shopping-d1.test.ts`, `test/lib/mcp/spoonjoy-tools.server.test.ts`.
**Acceptance**: The targeted Vitest command fails only on the missing shared semantics.

### ⬜ Unit 1b: Shopping Mutation Matrix Implementation
**What**: Implement `app/lib/shopping-list-mutations.server.ts`; route web, v1, and MCP additions through it; update public behavior descriptions/examples.
**Output**: `app/lib/shopping-list-mutations.server.ts`, `app/lib/shopping-list.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`.
**Acceptance**: Unit 1a tests and OpenAPI/generator tests pass; no duplicate add/restore implementation remains.

### ⬜ Unit 1c: Shopping Verification
**What**: Run the complete Unit 1a suite with coverage, generator idempotency, typecheck, and build; record evidence only.
**Output**: `unit-1-shopping.log`.
**Acceptance**: New helper coverage is 100%, targeted tests pass twice, generator is idempotent, build and `git diff --check` pass.

### ⬜ Unit 2a: Workers Runtime Harness Tests
**What**: Add red config tests requiring official Workers Vitest, SQLite DO/D1 bindings, separate worker coverage, normal-pool exclusion, and CI execution.
**Output**: `test/config/workers-vitest.test.ts`, `test/repo-hygiene.test.ts`, `test/workers-runtime/runtime.test.ts`.
**Acceptance**: Targeted tests fail because scripts/config/CI are absent.

### ⬜ Unit 2b: Workers Runtime Harness Implementation
**What**: Install/configure `@cloudflare/vitest-pool-workers` without moving happy-dom tests.
**Output**: `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `vitest.config.workers.ts`, `test/workers-runtime/env.d.ts`, `.github/workflows/ci.yml`.
**Acceptance**: Unit 2a passes; `pnpm test:workers` includes exactly `test/workers-runtime/**/*.test.ts`; normal Vitest excludes exactly `test/workers-runtime/**` and retains existing Node-mocked `test/workers/app.test.ts`; worker coverage enforces 100%.

### ⬜ Unit 2c: Workers Harness Verification
**What**: Run Workers/app coverage, CI-config tests, typecheck, and build.
**Output**: `unit-2-workers-harness.log`.
**Acceptance**: All commands pass with zero warnings.

### ⬜ Unit 3a: REST Base Metadata Tests
**What**: Add red tests for additive `stepCount`, `sourceDisplayName` normalization/null/malformed handling, unchanged legacy fields, OpenAPI/contract/generator/playground propagation, and anonymous list/detail/search behavior.
**Output**: `test/lib/api-v1-recipe-metadata.server.test.ts`, `test/routes/api-v1-recipes.test.ts`, `test/routes/api-v1-search.test.ts`, `test/routes/api-v1-native-sync.test.ts`, `test/routes/api-v1-recipe-writes.test.ts`, `test/routes/api-v1-cookbooks.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/scripts/generate-api-playground.test.ts`, `test/routes/developers-playground.test.tsx`.
**Acceptance**: Named tests fail only on missing base metadata.

### ⬜ Unit 3b: REST Base Metadata Implementation
**What**: Implement `stepCount` and `sourceDisplayName` exactly; preserve `sourceHost`, `servings`, and all existing field types.
**Output**: `app/lib/api-v1-recipe-metadata.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/lib/api-v1-contract.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.playground.tsx`, `app/routes/developers.tsx`, `docs/api.md`.
**Acceptance**: Unit 3a passes; malformed host yields null and shared response consumers remain compatible.

### ⬜ Unit 3c: REST Base Metadata Verification
**What**: Run the complete Unit 3a suite with coverage, generator idempotency, typecheck, and build; record evidence only.
**Output**: `unit-3-api-metadata.log`.
**Acceptance**: Helper coverage is 100%; targeted cross-contract suite, typecheck, and build pass.

### ⬜ Unit 4a: REST Scaling Projection Tests
**What**: Add red tests for exactly one unsigned decimal `scaleFactor`, `0.25..50`, invalid/multiple/nonfinite forms, required numeric quantities, six-decimal rounding, negative-zero normalization, immutable recipe data, and unchanged list/search behavior.
**Output**: `test/lib/api-v1-recipe-scaling.server.test.ts`, `test/routes/api-v1-recipes.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/scripts/generate-api-playground.test.ts`, `test/routes/developers-playground.test.tsx`.
**Acceptance**: Named tests fail only on absent scaling projection/validation.

### ⬜ Unit 4b: REST Scaling Projection Implementation
**What**: Add detail-only `scaleFactor` and `scaledQuantity` while preserving original `quantity`/`servings` and performing no writes.
**Output**: `app/lib/api-v1-recipe-scaling.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/lib/api-v1-contract.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.playground.tsx`, `app/routes/developers.tsx`, `docs/api.md`.
**Acceptance**: Unit 4a passes; invalid input uses existing `validation_error`; stored quantities remain unchanged.

### ⬜ Unit 4c: REST Scaling Verification
**What**: Run the complete Unit 4a suite with coverage, generator idempotency, typecheck, and build; record evidence only.
**Output**: `unit-4-api-scaling.log`.
**Acceptance**: New helper coverage is 100%; targeted suite, typecheck, and build pass.

### ⬜ Unit 5a: Cook Index Migration Tests
**What**: Add red tests for per-attempt rows, nullable unique activeKey projection integrity, owner/recipe/status/timestamps, ordered idempotent projection, history, privacy, and exact dual migration files.
**Output**: `test/models/cook-session-index.test.ts`, `test/scripts/migration-0024-cook-session-index.test.ts`, `test/lib/cook-session-index.server.test.ts`.
**Acceptance**: Tests fail because model/migration/helper are absent.

### ⬜ Unit 5b: Cook Index Migration Implementation
**What**: Add model/migrations and helpers for ordered projection upsert, owner-only active/history list, and attempt delete.
**Output**: `prisma/schema.prisma`, `migrations/0024_cook_session_index.sql`, `prisma/migrations/20260715100000_cook_session_index/migration.sql`, `app/lib/cook-session-index.server.ts`.
**Acceptance**: Unit 5a passes; terminal-old then active-new preserves one active row; other users see nothing.

### ⬜ Unit 5c: Cook Index Verification
**What**: Run the complete Unit 5a suite with coverage, Prisma generation, local D1 migration/rerun, typecheck, and build; record evidence only.
**Output**: `unit-5-cook-index.log`.
**Acceptance**: Commands pass with 100% helper coverage and no migration collision/warning.

### ⬜ Unit 6a: Recipe Snapshot And Fingerprint Tests
**What**: Add red pure tests for server-trusted snapshot fields/order, canonical JSON, SHA-256 fingerprint stability, malformed/empty recipes, and edit detection.
**Output**: `test/lib/cook-recipe-snapshot.test.ts`.
**Acceptance**: Test fails because snapshot module is absent.

### ⬜ Unit 6b: Recipe Snapshot And Fingerprint Implementation
**What**: Implement shared snapshot types plus server builder without browser/server import leakage.
**Output**: `app/lib/cook-session-types.ts`, `app/lib/cook-recipe-snapshot.ts`, `app/lib/cook-recipe-snapshot.server.ts`, `app/lib/recipe-detail.server.ts`.
**Acceptance**: Unit 6a passes; canonical fingerprint is stable and changes for every pinned content/quantity/unit/stable-id edit.

### ⬜ Unit 6c: Recipe Snapshot Verification
**What**: Run the complete Unit 6a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-6-cook-snapshot.log`.
**Acceptance**: New modules are 100% covered with no server-only client import.

### ⬜ Unit 7a: Cook Progress State Tests
**What**: Add red pure tests for initialization, stable-id set operations, scale bounds, revisions, stale-attempt/revision responses, terminal rules, progress mutation dedupe, and client rebase order.
**Output**: `test/lib/cook-session-state.test.ts`.
**Acceptance**: Tests fail because state module is absent.

### ⬜ Unit 7b: Cook Progress State Implementation
**What**: Implement deterministic operation-based transitions and rebase helpers.
**Output**: `app/lib/cook-session-state.ts`, `app/lib/cook-session-types.ts`.
**Acceptance**: Unit 7a passes; unknown stable ids fail; set operations are replay-safe; terminal sessions reject progress changes.

### ⬜ Unit 7c: Cook Progress State Verification
**What**: Run the complete Unit 7a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-7-cook-state.log`.
**Acceptance**: New code is 100% covered and commands pass.

### ⬜ Unit 8a: Start And Adoption Arbitration Tests
**What**: Add red pure tests for exact adoption schema, same-fingerprint/bounds validation, pristine-only adoption, first-writer/server-wins races, 24-hour/64-entry start ledger, backpressure, expiry, and recorded outcomes.
**Output**: `test/lib/cook-session-start.test.ts`.
**Acceptance**: Tests fail because start coordinator is absent.

### ⬜ Unit 8b: Start And Adoption Arbitration Implementation
**What**: Implement attempt UUID creation, coordinator metadata, adoption outcomes, and non-evicting start replay ledger.
**Output**: `app/lib/cook-session-start.ts`, `app/lib/cook-session-types.ts`, `app/lib/cook-session-state.ts`.
**Acceptance**: Unit 8a passes; client time is ignored; parallel starts produce one attempt; unexpired replay is exact or 429 backpressure applies.

### ⬜ Unit 8c: Start And Adoption Verification
**What**: Run the complete Unit 8a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-8-cook-start.log`.
**Acceptance**: New code is 100% covered and commands pass.

### ⬜ Unit 9a: Durable Object Binding And Storage Tests
**What**: Add real Workers red tests for deterministic user/recipe arbitration, SQLite storage, coordinator/attempt key separation, immutable identity, attempt replacement, restart, Env/export, production/QA binding/migration, and preflight checks.
**Output**: `test/workers-runtime/cook-session-do-storage.test.ts`, `test/config/wrangler-durable-objects.test.ts`, `test/scripts/deployment-preflight.test.ts`.
**Acceptance**: Worker/config tests fail because class/bindings/checks are absent.

### ⬜ Unit 9b: Durable Object Binding And Storage Implementation
**What**: Implement storage/start/progress dispatch and configure `new_sqlite_classes` explicitly for production/QA.
**Output**: `workers/cook-session-do.ts`, `workers/app.ts`, `wrangler.json`, `app/cloudflare-env.d.ts`, `scripts/deployment-preflight.ts`.
**Acceptance**: Unit 9a passes; parallel starts serialize; restart persists state; both envs bind/export the class.

### ⬜ Unit 9c: Durable Object Storage Verification
**What**: Run the complete Unit 9a Workers/config suite with coverage, Wrangler source/generated-config validation, typecheck, and build; record evidence only.
**Output**: `unit-9-do-storage.log`.
**Acceptance**: Worker class paths are 100% covered; preflight, typecheck, and build pass.

### ⬜ Unit 10a: Internal Cook HTTP Lifecycle Tests
**What**: Add real Worker red tests for recipe-keyed start/get/patch/complete/abandon, API-safe auth, initial visibility, same-origin, exact bodies/statuses, attempt/revision conflicts, no-store responses/errors, malformed methods/body, and no OpenAPI/route registration.
**Output**: `test/workers-runtime/app-cook-session-http.test.ts`, `test/workers/app.test.ts`.
**Acceptance**: Tests fail because Worker-level HTTP handler is absent.

### ⬜ Unit 10b: Internal Cook HTTP Lifecycle Implementation
**What**: Intercept `/api/cook-sessions` before React Router, authenticate with `getUserId`, derive DO from user+recipe, provide snapshot on pristine start, and implement non-WebSocket lifecycle routes.
**Output**: `app/lib/cook-session-http.server.ts`, `workers/app.ts`, `workers/cook-session-do.ts`.
**Acceptance**: Unit 10a passes; D1 freshness is irrelevant to auth/start; all non-101 responses are private no-store.

### ⬜ Unit 10c: Internal Cook HTTP Verification
**What**: Run the complete Unit 10a Workers suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-10-cook-http.log`.
**Acceptance**: New HTTP/Worker code is 100% covered and commands pass.

### ⬜ Unit 11a: Cook WebSocket Tests
**What**: Add real Workers red tests for same-origin upgrade, 101 handle retention through default export, initial/broadcast snapshots, hibernation attachments/restart, stale-attempt closure, malformed messages, and close/error paths.
**Output**: `test/workers-runtime/app-cook-session-websocket.test.ts`, `test/workers-runtime/cook-session-do-websocket.test.ts`.
**Acceptance**: Tests fail because live subscription is absent.

### ⬜ Unit 11b: Cook WebSocket Implementation
**What**: Add recipe-keyed `/live` handling with hibernation APIs; bypass response rebuilding only for 101 and retain ordinary security/no-store behavior.
**Output**: `app/lib/cook-session-http.server.ts`, `workers/app.ts`, `workers/cook-session-do.ts`.
**Acceptance**: Unit 11a passes; subscribers receive accepted snapshots and hibernated sockets recover metadata.

### ⬜ Unit 11c: Cook WebSocket Verification
**What**: Run the complete Unit 11a Workers suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-11-cook-websocket.log`.
**Acceptance**: New WebSocket paths are 100% covered and commands pass.

### ⬜ Unit 12a: D1 Projection Alarm Tests
**What**: Add real Workers red tests for ordered create/update/terminal projections, terminal-old-before-active-new, idempotent replay, transient D1 failure, retry exhaustion/reschedule, and stale My Kitchen card recovery.
**Output**: `test/workers-runtime/cook-session-projection.test.ts`, `test/lib/cook-session-index.server.test.ts`.
**Acceptance**: Tests fail because alarm-backed projection is absent.

### ⬜ Unit 12b: D1 Projection Alarm Implementation
**What**: Persist/drain FIFO projection queue and reschedule alarms without making D1 canonical.
**Output**: `workers/cook-session-do.ts`, `app/lib/cook-session-index.server.ts`.
**Acceptance**: Unit 12a passes; accepted DO mutations survive D1 failure/new attempt; repeated alarms do not duplicate history.

### ⬜ Unit 12c: D1 Projection Verification
**What**: Run the complete Unit 12a Workers/app suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-12-cook-projection.log`.
**Acceptance**: New projection code is 100% covered; no RecipeSpoon/notification integration appears.

### ⬜ Unit 13a: Cook Purge Fence Tests
**What**: Add real Workers red tests for matching/stale/repeated DELETE, PURGING rejection for every other HTTP/upgrade, code-4001 closure, FIFO barrier, old-terminal/new-attempt/purge order, delayed start replay 410, newer-attempt isolation, atomic content deletion, and every D1/local failure boundary.
**Output**: `test/workers-runtime/cook-session-purge.test.ts`, `test/workers-runtime/app-cook-session-http.test.ts`, `test/workers-runtime/app-cook-session-websocket.test.ts`, `test/workers-runtime/cook-session-do-websocket.test.ts`.
**Acceptance**: Tests fail because purge state machine is absent.

### ⬜ Unit 13b: Cook Purge Fence Implementation
**What**: Implement PURGING fence, FIFO barrier, idempotent D1 delete, atomic attempt-key deletion, and retained non-content coordinator/replay tombstone.
**Output**: `workers/cook-session-do.ts`, `app/lib/cook-session-http.server.ts`.
**Acceptance**: Unit 13a passes; purge cannot erase older repair/newer attempt; purged start replay cannot recreate/adopt state.

### ⬜ Unit 13c: Cook Purge Verification
**What**: Run the complete Unit 13a Workers suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-13-cook-purge.log`.
**Acceptance**: New purge code is 100% covered and commands pass.

### ⬜ Unit 14a: Cook Client Transport Tests
**What**: Add red browser tests for exact start/get/patch/complete/abandon/delete requests, headers/bodies/credentials, WebSocket URL/messages, response decoding, and 401/403/404/409/410/429/network failures.
**Output**: `test/lib/cook-session-client.test.ts` with captured outgoing request assertions.
**Acceptance**: Tests fail on missing `app/lib/cook-session-client.ts`, with failures proving outbound shape.

### ⬜ Unit 14b: Cook Client Transport Implementation
**What**: Implement typed fetch/WebSocket adapter matching internal contracts.
**Output**: `app/lib/cook-session-client.ts`.
**Acceptance**: Unit 14a passes; every outbound URL/body/header is asserted independently from response handling.

### ⬜ Unit 14c: Cook Client Transport Verification
**What**: Run the complete Unit 14a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-14-cook-client-transport.log`.
**Acceptance**: Adapter is 100% covered and commands pass.

### ⬜ Unit 15a: Cook Client Reconciliation Tests
**What**: Add red hook/controller tests for operation queue, optimistic state, WebSocket snapshots, 409 rebase/retry, same-field reconnect precedence, stale attempts, offline cache non-authority, exact adoption outcomes, anonymous mode, record cleanup, and storage failure.
**Output**: `test/hooks/use-cook-session.test.ts`, `test/routes/recipes-id.test.tsx`.
**Acceptance**: Tests fail because hook/controller is absent.

### ⬜ Unit 15b: Cook Client Reconciliation Implementation
**What**: Implement `useCookSession`; retain anonymous local parser and separate authenticated cache/operation queue.
**Output**: `app/hooks/useCookSession.ts`, `app/routes/recipes.$id.tsx`.
**Acceptance**: Unit 15a passes; client time never overrides server; anonymous record clears after any start outcome; queue clears only after acceptance.

### ⬜ Unit 15c: Cook Client Reconciliation Verification
**What**: Run the complete Unit 15a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-15-cook-client-state.log`.
**Acceptance**: New hook code is 100% covered and anonymous regressions pass.

### ⬜ Unit 16a: Recipe Cook Lifecycle UI Tests
**What**: Add red route tests for server snapshot, persisted step/check/scale, adoption outcome, edit warning, Continue original, Start fresh order, complete, abandon, reconnect, and terminal/error UI.
**Output**: `test/routes/recipes-id.test.tsx`, `test/routes/recipes-id-scaling.test.tsx`, `test/components/recipe/CookSessionStatus.test.tsx`.
**Acceptance**: Tests fail only on missing UI integration.

### ⬜ Unit 16b: Recipe Cook Lifecycle UI Implementation
**What**: Wire `useCookSession` into authenticated cook mode; add compact status/warning/terminal controls; preserve anonymous behavior/layout.
**Output**: `app/routes/recipes.$id.tsx`, `app/components/recipe/CookSessionStatus.tsx`.
**Acceptance**: Unit 16a passes; edits never remap silently; Start fresh abandons before start; scale persists via DO operations.

### ⬜ Unit 16c: Recipe Cook UI Verification
**What**: Run the complete Unit 16a route/component suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-16-cook-ui.log`.
**Acceptance**: New UI code is 100% covered and recipe/dock regressions pass.

### ⬜ Unit 16d: Recipe Cook UI Visual QA
**What**: Invoke `visual-qa-dogfood` for desktop/mobile cook, edit warning, reconnect, complete, error, and anonymous states.
**Output**: `visual-cook/` screenshots, metrics, interaction and absurdity ledgers.
**Acceptance**: No ready visual issue, overlap, layout shift, inaccessible control, or dock collision remains.

### ⬜ Unit 17a: Owner-Only Continue Cooking Tests
**What**: Add red loader/render tests for owner active cards, stale/empty/terminal removal, soft-deleted recipe, and strict absence/query suppression for authenticated/anonymous visitors.
**Output**: `test/routes/index.test.tsx`, `test/components/recipe/ContinueCookingList.test.tsx`, `test/components/navigation/mobile-nav.test.tsx`.
**Acceptance**: Tests fail only because owner-only section is absent; dock links remain unchanged.

### ⬜ Unit 17b: Owner-Only Continue Cooking Implementation
**What**: Load D1 active projection only for owner and render unframed Continue Cooking without dock edits.
**Output**: `app/routes/_index.tsx`, `app/components/recipe/ContinueCookingList.tsx`.
**Acceptance**: Unit 17a passes; non-owner loader data/query contains no private session metadata.

### ⬜ Unit 17c: Continue Cooking Verification
**What**: Run the complete Unit 17a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-17-continue-cooking.log`.
**Acceptance**: New code is 100% covered and nav/privacy regressions pass.

### ⬜ Unit 17d: Continue Cooking Visual QA
**What**: Invoke visual QA for owner/non-owner My Kitchen desktop/mobile with empty/active/stale states.
**Output**: `visual-kitchen-cooking/` evidence and closed ledgers.
**Acceptance**: No private leakage, overlap, dock churn, or ready visual issue remains.

### ⬜ Unit 18a: SavedRecipe Migration Tests
**What**: Add red tests for hard-delete saves, unique pair, owner-derived distinct backfill with explicit Recipe join/`deletedAt IS NULL`, rerun, soft-delete hide/restore, and exact migration.
**Output**: `test/models/saved-recipe.test.ts`, `test/scripts/migration-0025-saved-recipes.test.ts`, `test/lib/saved-recipes.server.test.ts`.
**Acceptance**: Tests fail because schema/migration/helper are absent.

### ⬜ Unit 18b: SavedRecipe Migration Implementation
**What**: Add schema/migrations and canonical save/unsave/get/list helpers; backfill only in SQL.
**Output**: `prisma/schema.prisma`, `migrations/0025_saved_recipes.sql`, `prisma/migrations/20260715101000_saved_recipes/migration.sql`, `app/lib/saved-recipes.server.ts`.
**Acceptance**: Unit 18a passes; owner is `Cookbook.authorId`; rerun harmless; unsave only deletes SavedRecipe.

### ⬜ Unit 18c: SavedRecipe Data Verification
**What**: Run the complete Unit 18a suite with coverage, Prisma generation, migration/rerun, typecheck, and build; record evidence only.
**Output**: `unit-18-saved-data.log`.
**Acceptance**: New helper is 100% covered and commands pass.

### ⬜ Unit 19a: Cookbook Writer Compatibility Tests
**What**: Add red tests for all four membership writers ensuring owner save, repeat idempotency, non-interactive array-transaction batching, remove-without-unsave, unsave-without-membership-removal, auth, and unchanged notifications.
**Output**: `test/lib/recipe-detail.server.test.ts`, `test/routes/cookbooks-id.test.tsx`, `test/lib/spoonjoy-api-cookbook-notification.test.ts`, `test/routes/api-v1-cookbooks.test.ts`, `test/lib/saved-recipes.server.test.ts`.
**Acceptance**: Tests fail because membership creation does not ensure SavedRecipe.

### ⬜ Unit 19b: Cookbook Writer Compatibility Implementation
**What**: Route all four membership writers through one canonical helper that batches membership create/upsert plus SavedRecipe upsert with non-interactive `$transaction([promise, promise])`; do not use callback/interactive transactions.
**Output**: `app/lib/recipe-detail.server.ts`, `app/routes/cookbooks.$id.tsx`, `app/lib/spoonjoy-api.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/saved-recipes.server.ts`, new `app/lib/cookbook-recipe-save.server.ts`.
**Acceptance**: Unit 19a passes across web/MCP/REST; removal/unsave remain independent; notifications unchanged.

### ⬜ Unit 19c: Cookbook Writer Verification
**What**: Run the complete Unit 19a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-19-saved-compat.log`.
**Acceptance**: Changed branches are 100% covered and cookbook/MCP/API suites pass.

### ⬜ Unit 20.1a: Saved REST List Tests
**What**: Add red tests for private GET `/api/v1/me/saved-recipes`, session/bearer auth, `recipes:read`, no-store, pagination/cursors, soft-deleted recipes, empty/error envelopes, route registry, and OpenAPI.
**Output**: `test/routes/api-v1-saved-recipes.test.ts`, `test/routes/api-v1-scopes.test.ts`, `test/config/api-v1-route-coverage.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`.
**Acceptance**: The exact five-file Vitest run fails because the list endpoint is absent.

### ⬜ Unit 20.1b: Saved REST List Implementation
**What**: Implement the private paginated GET endpoint with existing v1 auth/error/no-store conventions and document it.
**Output**: `app/lib/api-v1.server.ts`, `app/lib/api-v1-contract.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.tsx`, `docs/api.md`.
**Acceptance**: Unit 20.1a passes; only the authenticated viewer's active recipes are returned with private no-store.

### ⬜ Unit 20.1c: Saved REST List Verification
**What**: Run list endpoint coverage, generator idempotency, typecheck, and build without adding behavior.
**Output**: `unit-20.1-saved-list.log`.
**Acceptance**: New list code is 100% covered and all commands pass.

### ⬜ Unit 20.2a: Saved REST Mutation Tests
**What**: Add red tests for idempotent PUT/DELETE `/api/v1/me/saved-recipes/:recipeId`, `clientMutationId` body/header/query conventions, `recipes:write`, session/bearer auth, replay/conflict/in-progress errors, missing/deleted recipe, no-store, route registry, and OpenAPI.
**Output**: `test/routes/api-v1-saved-recipes.test.ts`, `test/routes/api-v1-idempotent-recovery.test.ts`, `test/routes/api-v1-scopes.test.ts`, `test/config/api-v1-route-coverage.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`.
**Acceptance**: The targeted run fails because mutation endpoints are absent.

### ⬜ Unit 20.2b: Saved REST Mutation Implementation
**What**: Implement PUT/DELETE with canonical SavedRecipe helper and existing v1 idempotency/auth/error envelopes; update contracts/generated docs.
**Output**: `app/lib/api-v1.server.ts`, `app/lib/api-v1-contract.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.tsx`, `docs/api.md`.
**Acceptance**: Unit 20.2a passes; retries replay safely; unsave does not remove cookbook memberships.

### ⬜ Unit 20.2c: Saved REST Mutation Verification
**What**: Run mutation/idempotency coverage, generator idempotency, typecheck, and build without adding behavior.
**Output**: `unit-20.2-saved-mutations.log`.
**Acceptance**: New mutation code is 100% covered and commands pass.

### ⬜ Unit 20.3a: Recipe isSaved Projection Tests
**What**: Add red tests for `isSaved: null` on anonymous/public-token summary/detail/search/native-sync/cookbook payloads and viewer-specific boolean on authenticated equivalents, with no public count or cache leak.
**Output**: `test/routes/api-v1-recipes.test.ts`, `test/routes/api-v1-search.test.ts`, `test/routes/api-v1-native-sync.test.ts`, `test/routes/api-v1-recipe-writes.test.ts`, `test/routes/api-v1-cookbooks.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/scripts/generate-api-playground.test.ts`.
**Acceptance**: The targeted run fails because functional isSaved projection is absent.

### ⬜ Unit 20.3b: Recipe isSaved Projection Implementation
**What**: Add the nullable `isSaved` field to v1 contracts, wire viewer-scoped SavedRecipe lookup into shared recipe builders, and preserve anonymous caching.
**Output**: `app/lib/api-v1.server.ts`, `app/lib/api-v1-contract.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.playground.tsx`, `app/routes/developers.tsx`, `docs/api.md`.
**Acceptance**: Unit 20.3a passes; anonymous/public-token is null, authenticated is boolean, and save state never becomes a public count.

### ⬜ Unit 20.3c: Recipe isSaved Projection Verification
**What**: Run every shared builder consumer, coverage, generator idempotency, typecheck, and build without adding behavior.
**Output**: `unit-20.3-is-saved.log`.
**Acceptance**: New projection branches are 100% covered and cross-contract suite passes.

### ⬜ Unit 21a: Saved Controls And Route Tests
**What**: Add red tests for `/saved-recipes` canonical loader/query/empty states and explicit recipe save control distinct from cookbook control.
**Output**: `test/routes/saved-recipes.test.tsx`, `test/routes/recipes-id.test.tsx`, `test/components/recipe/SaveRecipeButton.test.tsx`.
**Acceptance**: Tests fail because route derives membership and control is absent.

### ⬜ Unit 21b: Saved Controls And Route Implementation
**What**: Use SavedRecipe on `/saved-recipes` and recipe detail; add explicit save button without changing cookbook control.
**Output**: `app/routes/saved-recipes.tsx`, `app/routes/recipes.$id.tsx`, `app/components/recipe/SaveRecipeButton.tsx`, `app/components/recipe/SaveToCookbookDropdown.tsx`.
**Acceptance**: Unit 21a passes; save/cookbook copy/actions are distinct.

### ⬜ Unit 21c: Saved Controls Verification
**What**: Run the complete Unit 21a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-21-saved-controls.log`.
**Acceptance**: New code is 100% covered and commands pass.

### ⬜ Unit 21d: Saved Controls Visual QA
**What**: Invoke visual QA for recipe detail and `/saved-recipes` desktop/mobile states.
**Output**: `visual-saved-controls/` evidence and closed ledgers.
**Acceptance**: Controls are clear/reachable with no ready visual issue.

### ⬜ Unit 22a: Saved Search Privacy Tests
**What**: Add red tests for viewer-id intersection, query/empty states, anonymous/cross-user isolation, and absence of save metadata/duplicate docs in global SearchDocument.
**Output**: `test/lib/search.server.test.ts`, `test/routes/saved-recipes.test.tsx`, `test/routes/search.test.tsx`.
**Acceptance**: Tests fail because viewer-scoped saved search is absent.

### ⬜ Unit 22b: Saved Search Privacy Implementation
**What**: Intersect recipe search with authenticated saved ids without indexing private state.
**Output**: `app/lib/search.server.ts`, `app/routes/saved-recipes.tsx`.
**Acceptance**: Unit 22a passes; global metadata has no private save state and no duplicate recipe results.

### ⬜ Unit 22c: Saved Search Verification
**What**: Run the complete Unit 22a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-22-saved-search.log`.
**Acceptance**: New code is 100% covered and search regressions pass.

### ⬜ Unit 23a: Owner-Only Saved Kitchen Tests
**What**: Add red tests for owner saved section plus strict loader/query/render absence for authenticated and anonymous visitors.
**Output**: `test/routes/index.test.tsx`.
**Acceptance**: Tests fail because owner section is absent.

### ⬜ Unit 23b: Owner-Only Saved Kitchen Implementation
**What**: Load/render SavedRecipe section only when viewer owns the kitchen; do not edit dock.
**Output**: `app/routes/_index.tsx`, `app/components/recipe/SavedRecipeList.tsx`.
**Acceptance**: Unit 23a passes; no private save data enters visitor loader output.

### ⬜ Unit 23c: Saved Kitchen Verification
**What**: Run the complete Unit 23a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-23-saved-kitchen.log`.
**Acceptance**: New code is 100% covered and nav/privacy tests pass.

### ⬜ Unit 23d: Saved Kitchen Visual QA
**What**: Invoke visual QA for owner/non-owner My Kitchen desktop/mobile saved states.
**Output**: `visual-saved-kitchen/` evidence and closed ledgers.
**Acceptance**: No privacy exposure, dock churn, or ready visual issue remains.

### ⬜ Unit 24a: RecipeTag Migration And Service Tests
**What**: Add red tests for accepted-only schema, owner auth, MANUAL source, singular controlled course, normalized custom uniqueness, validation, delete/re-add, soft-delete, and exact migration.
**Output**: `test/models/recipe-tag.test.ts`, `test/lib/recipe-tags.server.test.ts`, `test/scripts/migration-0026-recipe-tags.test.ts`.
**Acceptance**: Tests fail because tag schema/service/migration are absent.

### ⬜ Unit 24b: RecipeTag Migration And Service Implementation
**What**: Add schema/migrations and owner-only replace-course/add/remove/list helpers; no AI proposal state.
**Output**: `prisma/schema.prisma`, `migrations/0026_recipe_tags.sql`, `prisma/migrations/20260715102000_recipe_tags/migration.sql`, `app/lib/recipe-tags.server.ts`.
**Acceptance**: Unit 24a passes; one allowed course maximum; normalization deterministic; source MANUAL.

### ⬜ Unit 24c: RecipeTag Data Verification
**What**: Run the complete Unit 24a suite with coverage, Prisma generation, local migrations/rerun, typecheck, and build; record evidence only.
**Output**: `unit-24-tags-data.log`.
**Acceptance**: New service is 100% covered and commands pass.

### ⬜ Unit 25a: Tag Authoring Tests
**What**: Add red tests for optional course/custom controls, create/edit persistence, owner auth, server validation display, duplicate normalization, and no AI wording.
**Output**: `test/components/recipe/RecipeBuilder.test.tsx`, `test/routes/recipes-new.test.tsx`, `test/routes/recipes-id-edit.test.tsx`, `test/lib/recipe-create.server.test.ts`, `test/lib/recipe-detail.server.test.ts`.
**Acceptance**: Tests fail because authoring is absent.

### ⬜ Unit 25b: Tag Authoring Implementation
**What**: Add course/custom fields to RecipeBuilder and create/edit services/routes.
**Output**: `app/components/recipe/RecipeBuilder.tsx`, `app/lib/recipe-create.server.ts`, `app/lib/recipe-detail.server.ts`, `app/routes/recipes.new.tsx`, `app/routes/recipes.$id.edit.tsx`.
**Acceptance**: Unit 25a passes; only owners mutate and invalid input is server-rejected.

### ⬜ Unit 25c: Tag Authoring Verification
**What**: Run the complete Unit 25a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-25-tags-authoring.log`.
**Acceptance**: New authoring code is 100% covered and commands pass.

### ⬜ Unit 25d: Tag Authoring Visual QA
**What**: Invoke visual QA for create/edit desktop/mobile controls and validation states.
**Output**: `visual-tags-authoring/` evidence and closed ledgers.
**Acceptance**: No crowding, overflow, ambiguity, or ready visual issue remains.

### ⬜ Unit 26a: Tag Display Tests
**What**: Add red tests for controlled course/custom display order/casing on detail, recipe list, and RecipeGrid cards, including empty/dense states.
**Output**: `test/routes/recipes-id.test.tsx`, `test/routes/recipes-index.test.tsx`, `test/components/pantry/RecipeGrid.test.tsx`.
**Acceptance**: Tests fail because display is absent.

### ⬜ Unit 26b: Tag Display Implementation
**What**: Add compact course/custom display using existing design primitives.
**Output**: `app/routes/recipes.$id.tsx`, `app/routes/recipes._index.tsx`, `app/components/pantry/RecipeGrid.tsx`.
**Acceptance**: Unit 26a passes; casing/order match contract and empty tags add no chrome.

### ⬜ Unit 26c: Tag Display Verification
**What**: Run the complete Unit 26a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-26-tags-display.log`.
**Acceptance**: New display code is 100% covered and commands pass.

### ⬜ Unit 26d: Tag Display Visual QA
**What**: Invoke visual QA for detail/list/cards desktop/mobile with dense tags.
**Output**: `visual-tags-display/` evidence and closed ledgers.
**Acceptance**: No card crowding, overflow, or ready visual issue remains.

### ⬜ Unit 27.1a: Tag Search Index Tests
**What**: Add red tests for accepted course/custom labels in SearchDocument content/fingerprint, reindex on add/remove/replace-course, normalized order, no private save metadata, and no AI proposal content.
**Output**: `test/lib/search.server.test.ts`, `test/lib/recipe-tags.server.test.ts`.
**Acceptance**: The exact two-file Vitest run fails because tag indexing is absent.

### ⬜ Unit 27.1b: Tag Search Index Implementation
**What**: Include accepted manual tags in recipe search documents/fingerprints and trigger reindex from tag mutations.
**Output**: `app/lib/search.server.ts`, `app/lib/recipe-tags.server.ts`.
**Acceptance**: Unit 27.1a passes; saved privacy remains intact and only canonical accepted tags are indexed.

### ⬜ Unit 27.1c: Tag Search Index Verification
**What**: Run search/tag coverage, typecheck, and build without adding behavior.
**Output**: `unit-27.1-tags-index.log`.
**Acceptance**: New index/reindex code is 100% covered and commands pass.

### ⬜ Unit 27.2a: Tag REST Projection Tests
**What**: Add red tests for lowercase singular course, custom-only tags preserving display casing and normalized order, anonymous/authenticated list/detail/search/native-sync/cookbook propagation, OpenAPI/contract/generator/playground/docs, and no AI contract.
**Output**: `test/routes/api-v1-recipes.test.ts`, `test/routes/api-v1-search.test.ts`, `test/routes/api-v1-native-sync.test.ts`, `test/routes/api-v1-cookbooks.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/scripts/generate-api-playground.test.ts`, `test/routes/developers-playground.test.tsx`, `test/docs/developer-platform-docs.test.ts`, `test/docs/developer-platform-guide.test.ts`.
**Acceptance**: The targeted run fails because REST tag projection is absent.

### ⬜ Unit 27.2b: Tag REST Projection Implementation
**What**: Populate REST course/tags in shared builders with exact casing/order and update contracts/generated/public docs.
**Output**: `app/lib/api-v1.server.ts`, `app/lib/api-v1-contract.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.playground.tsx`, `app/routes/developers.tsx`, `docs/api.md`.
**Acceptance**: Unit 27.2a passes; existing field types/caches remain compatible and no AI contract appears.

### ⬜ Unit 27.2c: Tag REST Projection Verification
**What**: Run all shared response consumers, coverage, generator idempotency, typecheck, and build without adding behavior.
**Output**: `unit-27.2-tags-api.log`.
**Acceptance**: New projection code is 100% covered and cross-contract suite passes.

### ⬜ Unit 28a: Tag Discovery Filter Tests
**What**: Add red tests for exact course/custom filters, URL/query behavior, combinations, empty results, and unfiltered behavior in My Recipes, owner My Kitchen, and Search.
**Output**: `test/routes/recipes-index.test.tsx`, `test/routes/index.test.tsx`, `test/routes/search.test.tsx`, `test/components/pantry/RecipeGrid.test.tsx`.
**Acceptance**: Tests fail because filters are absent.

### ⬜ Unit 28b: Tag Discovery Filter Implementation
**What**: Add shared tag filter parsing/querying and controls to the three discovery surfaces without dock edits.
**Output**: `app/lib/recipe-tag-filter.ts`, `app/routes/recipes._index.tsx`, `app/routes/_index.tsx`, `app/routes/search.tsx`, `app/components/pantry/RecipeGrid.tsx`.
**Acceptance**: Unit 28a passes; unfiltered results unchanged and private kitchen sections remain owner-only.

### ⬜ Unit 28c: Tag Discovery Verification
**What**: Run the complete Unit 28a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-28-tags-filters.log`.
**Acceptance**: New code is 100% covered and discovery regressions pass.

### ⬜ Unit 28d: Tag Discovery Visual QA
**What**: Invoke visual QA for filters/results/empty states and mobile My Kitchen/navigation.
**Output**: `visual-tags-discovery/` evidence and closed ledgers.
**Acceptance**: No dock churn, overlap, crowding, or ready visual issue remains.

### ⬜ Unit 29: Feedback Boundary And Disposition Audit
**What**: Run scoped existing navigation/repo-hygiene/developer-doc tests, inspect the completed product-feature diff from Units 1–28 for import UI/AI/Pebble/dock changes, and map every feedback-source row to code/test evidence or its explicit rejection. Units 30–31 touch smoke/cleanup infrastructure only.
**Output**: `unit-29-feedback-audit.md`; logs for `test/components/navigation/mobile-nav.test.tsx`, `test/repo-hygiene.test.ts`, `test/docs/developer-platform-docs.test.ts`, and `test/docs/developer-platform-guide.test.ts`.
**Acceptance**: Tests pass; no source item is missing/silently deferred; no first-party import UI, AI tag surface, Pebble contract, or unproven dock edit exists.

### ⬜ Unit 30a: Two-Client Smoke Tests
**What**: Add red script tests for two authenticated browser contexts sharing one attempt, WebSocket step/check/scale sync, edit warning, complete/abandon, and failure artifact capture.
**Output**: `test/scripts/smoke-live-cook-session.test.ts`.
**Acceptance**: Tests fail because lifecycle smoke is absent.

### ⬜ Unit 30b: Two-Client Smoke Implementation
**What**: Extend smoke to create disposable `codex-smoke-*` recipe/user state and validate two-context lifecycle synchronization.
**Output**: `scripts/smoke-live.mjs`, `scripts/smoke-live-helpers.mjs`.
**Acceptance**: Unit 30a passes; successful and failed synchronization produce useful artifacts.

### ⬜ Unit 30c: Two-Client Smoke Verification
**What**: Run the complete Unit 30a script suite with coverage and script typecheck; record evidence only.
**Output**: `unit-30-smoke-sync.log`.
**Acceptance**: New lifecycle smoke logic is 100% covered and commands pass.

### ⬜ Unit 31a: Smoke Purge And Cleanup Tests
**What**: Add red tests for finally cleanup, async DELETE retry to 204, D1 row/content-state removal, tolerated coordinator tombstone, user deletion, partial failure, and residue reporting.
**Output**: `test/scripts/smoke-live-cleanup.test.ts`, `test/scripts/smoke-live-helpers.test.ts`.
**Acceptance**: Tests fail because cleanup reliability is absent.

### ⬜ Unit 31b: Smoke Purge And Cleanup Implementation
**What**: Purge every current attempt before user deletion, retry to 204, inspect D1/DO attempt residue, and always record unresolved residue.
**Output**: `scripts/smoke-live.mjs`, `scripts/smoke-live-helpers.mjs`.
**Acceptance**: Unit 31a passes; failed smoke still cleans and reports; only documented non-content tombstone may remain before user cleanup.

### ⬜ Unit 31c: Smoke Cleanup Verification
**What**: Run the complete Unit 31a script suite with coverage, script typecheck, and local dry-run residue inspection; record evidence only.
**Output**: `unit-31-smoke-cleanup.log`.
**Acceptance**: New cleanup logic is 100% covered and `pnpm cleanup:qa` reports no disposable local data.

### ⬜ Unit 32: Final Local Validation
**What**: Run cleanup, Prisma generation/local migrations, generator, typechecks, Workers coverage, app coverage, e2e, build, diff check, and fresh implementation review.
**Output**: `unit-32-local-validation.md` plus raw logs.
**Acceptance**: Every command passes with zero warnings/100% new-code coverage; review has no BLOCKER/MAJOR; git/local residue clean.

### ⬜ Unit 33: QA Deploy And Cross-Device Gate
**What**: Inspect QA residue, run `pnpm deploy:qa`, QA readiness/web/API/two-client smoke, purge/cleanup, and post-run residue inspection.
**Output**: `unit-33-qa.md`, deploy version/URL, smoke screenshots/logs, cleanup logs.
**Acceptance**: QA deploy/smokes pass for the recorded current branch HEAD SHA before PR merge and leave no disposable attempt/D1 data.

### ⬜ Unit 34: PR Creation And Fresh Review
**What**: Invoke `work-merger`, sync origin/main, resolve conflicts from task docs, open ready PR, and run fresh implementation/design/test/security reviews. Any code, migration, config, UI, or smoke behavior change after Unit 33 reopens and reruns Units 32–33 before this unit may complete.
**Output**: PR URL and `unit-34-pr-review.md`.
**Acceptance**: PR exists with no unresolved BLOCKER/MAJOR review finding; all fixes are committed/pushed.

### ⬜ Unit 35: CI Convergence
**What**: Wait for every PR check including Workers coverage/e2e; diagnose/fix failures and rerun reviews for substantive repairs. Any code, migration, config, UI, or smoke behavior repair reopens and reruns Units 32–33, then refreshes PR review and CI for the new head.
**Output**: Green check URLs and `unit-35-ci.md`.
**Acceptance**: Every required check is green for current head SHA with no unresolved review comment.

### ⬜ Unit 36: Merge
**What**: Reconfirm merge readiness, merge the ready PR, and record exact merge SHA without manual production deployment.
**Output**: Merge evidence and `unit-36-merge.md`.
**Acceptance**: Current PR head SHA exactly equals the SHA recorded by the latest successful Unit 33 QA gate; every required check/review is green for that head; PR is merged and exact merge SHA recorded.

### ⬜ Unit 37: Production Deploy, Smoke, Cleanup, And Handoff
**What**: Wait for automatic Production Deploy on exact merge SHA; then run readiness, production web/API/two-client smoke, purge/cleanup, continuation scan, Desk/git/worktree cleanup, and Slugger notification.
**Output**: Workflow/version URLs, `https://spoonjoy.app` evidence, cleanup/continuation logs, and `ouro msg --to slugger "Done: shipped Clem feedback end to end"` result.
**Acceptance**: Exact SHA is live; all smokes pass; no disposable data or ready in-scope follow-up remains; git/Desk terminal and clean; Slugger notified.

## Execution
- Tests -> confirmed red -> implementation -> green -> refactor for every a/b/c group.
- Commit/push each intentional-red `a` checkpoint and green `b` checkpoint; keep `c` verification-only, then update group emojis/progress and run a fresh group review.
- Store every command/log/screenshot in the artifact directory.
- Invoke `visual-qa-dogfood` for every d unit, `work-merger` at Unit 34, and `stay-in-turn` through CI/deploy.
- Never leave smoke/manual users, recipes, sessions, saves, or tags behind.

## Progress Log
- 2026-07-14 13:26 Initial doing doc created.
- 2026-07-14 13:46 Initial review chain did not converge.
- 2026-07-15 Latest-model audit rebuilt contracts and planning converged after five hostile rounds.
- 2026-07-15 Granularity Round 1 split metadata/scaling, every cook layer, saved UI/search/kitchen, tag authoring/display/index/filters, smoke lifecycle/cleanup, visual QA, PR review, CI, and merge into atomic units.
- 2026-07-15 Granularity converged after six fresh rounds; red/green/verify boundaries, exact outputs, and QA-to-PR-head ordering are explicit.
