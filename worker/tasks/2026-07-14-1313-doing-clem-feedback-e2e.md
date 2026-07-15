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
- **direct**: Execute sequentially in this session; selected. The explicit reviewer matrix in `Execution` applies.

## Objective
Ship every accepted Clem feedback item end to end: correct shopping restoration, authenticated cross-device cook continuity, private saves, accepted manual tags, and backward-compatible API metadata. Preserve agentic-only import, current navigation, and neutral non-Pebble boundaries.

## Contract Authority
- `./2026-07-14-1313-planning-clem-feedback-e2e.md` defines exact shopping, cook, SavedRecipe, RecipeTag, REST v1, privacy, purge, and deployment behavior.
- Any contract change requires an immediate planning-doc update and fresh reviewer convergence before implementation resumes.

## Normative Execution Constants
- Cook HTTP uses the planning doc's exact `{ ok, requestId, data|error }` envelopes, request-id rule, operation union, status/code/message table, bodyless 204, and private/no-store headers. Cook revisions start at 0; an accepted PATCH or first terminal transition increments once; only accepted mutations enter the 24-hour non-evicting 256-record ledger. A received stale revision is retried after rebase with a fresh UUID; network uncertainty first retries the original request/id. Start has its separate 64-record ledger and creates a new 201 attempt after terminal state. Mutation ids are UUID v4.
- Cook WebSockets are read-only and emit only `snapshot`/`error` server frames. Client data closes `1003 Read-only subscription`; attempt replacement closes `4000 Attempt replaced`; purge closes `4001 Session purged`; hibernation attachments carry version/user/recipe/attempt.
- Recipe hashing uses the planning doc's exact snapshot schemas, nested sort orders, recursive lexicographic object-key ordering, explicit nulls, finite ECMAScript JSON numbers with negative zero normalized, unchanged stored strings, UTF-8, and lowercase SHA-256 hex.
- Projection retry delays are exactly 2, 4, 8, 16, 32, then 60 seconds forever. Purge tests separately inject every seven persistence/broadcast/D1/crash/local-transaction boundaries listed in planning; a test named only "partial failure" is insufficient.
- D1 projection uses the planning doc's exact `CookSessionIndex` columns/indexes and version-1 UPSERT/DELETE queue schema. Remote cleanup proves both owner-only residue counts and `CookSessionIndex` attempt-row count zero before deleting the smoke user.
- Saved REST list is newest-first with default 20/max 50 and `v1.<base64url({ createdAt, recipeId })>` cursor; response data is `{ limit, cursor, nextCursor, hasMore, recipes }`. PUT/DELETE source `clientMutationId` body -> `X-Client-Mutation-Id` -> query and return the exact 200 `{ recipeId, saved, mutation }` payload.
- Tag normalization is trim + Unicode-whitespace collapse + NFKC lowercase identity, 1..40 code points, 10 custom tags max, course-word reservation, first-label display casing, and normalized-label/id order. Filters are one `course`, repeatable `tag`, AND across all scopes/tags, with malformed/over-limit input returning 400.
- Shopping batches use the planning doc's list-level version/lease transaction, empty-list zero allocator, original-order aggregate override rule, eight-attempt fixed backoff, and exact web/REST/MCP busy errors. Cook idempotency hashes canonical validated payloads, applies ordered duplicate operations last-wins, and atomically rejects any invalid operation.
- Authenticated offline state uses the exact user-scoped v1 record/queue schema and 256/64 bounds in planning. Deploy correctness is proven by no-store `/health` body/header build SHA, not deployment timestamps.

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
**What**: Run and capture exactly: `git status --short --branch`, `node --version`, `pnpm --version`, `gh auth status`, `pnpm exec wrangler whoami`, `pnpm cleanup:qa`, `pnpm exec wrangler d1 migrations list DB --local`, `pnpm run typecheck`, `pnpm build`, and `pnpm exec vitest run test/routes/shopping-list-route.test.ts test/routes/api-v1-shopping-mutations.test.ts test/lib/mcp/spoonjoy-tools.server.test.ts test/routes/recipes-id.test.tsx test/routes/index.test.tsx test/routes/my-recipes.test.tsx test/lib/search.server.test.ts test/routes/api-v1-recipes.test.ts test/components/navigation/mobile-nav.test.tsx`. Verify QA/prod command target safety from scripts/config.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-0-research.md` plus command logs.
**Acceptance**: Artifact records `0023_recipe_cover_prompt_lineage.sql` as current plus exact cleanup/deploy/smoke commands, and every named baseline command is green with no disposable residue. A pre-existing failure does not permit execution to continue: reproduce it on untouched `origin/main`, open a focused red/fix/green sub-unit on this branch, and rerun Unit 0 until green.

### ⬜ Unit 1a: Shopping Mutation Matrix Tests
**What**: Add red tests for active-unchecked, active-checked, tombstone, null quantity, three-state and last-explicit aggregate category/icon override, aggregation order, repeated calls, mandatory version-first/items-second reads, paused races before/during/after item read proving stale bases cannot acquire, version/UUID-lease guarded no-op, all-or-nothing multi-pair batch, empty-list zero allocator, atomic contiguous range allocation, every move-to-end writer, both D1 commit orders, exact-once numeric sums, fixed 5..320 ms seven-delay/eight-attempt retry, exhaustion adapter errors, and concurrent web/v1/MCP behavior; test exact/rerunnable migration backfill.
**Output**: `test/lib/shopping-list-mutations.server.test.ts`, `test/routes/shopping-list-route.test.ts`, `test/routes/api-v1-shopping-mutations.test.ts`, `test/routes/api-v1-shopping-d1.test.ts`, `test/lib/mcp/spoonjoy-tools.server.test.ts`, `test/scripts/migration-0024-shopping-list-mutation-coordination.test.ts`.
**Acceptance**: The targeted Vitest command fails only on the missing shared semantics.

### ⬜ Unit 1b: Shopping Mutation Matrix Implementation
**What**: Add list-level mutationVersion/mutationLease/nextSortIndex schema/migration; implement guarded non-interactive batch, fixed retry, `ShoppingListBusyError`, and allocator in `app/lib/shopping-list-mutations.server.ts`; route every item mutation/move-to-end plus web, v1, and MCP add/restore through shared primitives; add v1 `write_conflict`; update public behavior descriptions/examples.
**Output**: `prisma/schema.prisma`, `migrations/0024_shopping_list_mutation_coordination.sql`, `prisma/migrations/20260715095500_shopping_list_mutation_coordination/migration.sql`, `app/lib/shopping-list-mutations.server.ts`, `app/lib/shopping-list.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/api-v1-contract.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`.
**Acceptance**: Unit 1a tests and OpenAPI/generator tests pass; every mutation increments version, every end allocation is unique/monotonic, and no duplicate add/restore or max-plus-one allocator remains.

### ⬜ Unit 1c: Shopping Verification
**What**: Run the complete Unit 1a suite with coverage, Prisma generation, local migration/rerun, generator idempotency, typecheck, and build; record evidence only.
**Output**: `unit-1-shopping.log`.
**Acceptance**: New helper coverage is 100%, targeted tests pass twice, generator is idempotent, build and `git diff --check` pass.

### ⬜ Unit 2a: Workers Runtime Harness Tests
**What**: Add red config tests requiring official Workers Vitest, SQLite DO/D1 bindings, separate worker coverage, normal-pool exclusion, and CI execution.
**Output**: `test/config/workers-vitest.test.ts`, `test/repo-hygiene.test.ts`, `test/workers-runtime/runtime.test.ts`.
**Acceptance**: Targeted tests fail because scripts/config/CI are absent.

### ⬜ Unit 2b: Workers Runtime Harness Implementation
**What**: Install/configure `@cloudflare/vitest-pool-workers` without moving happy-dom tests.
**Output**: `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `vitest.config.workers.ts`, `test/workers-runtime/env.d.ts`, `.github/workflows/ci.yml`.
**Acceptance**: Unit 2a passes; `pnpm test:workers` includes exactly `test/workers-runtime/**/*.test.ts`; normal Vitest excludes exactly `test/workers-runtime/**` and retains existing Node-mocked `test/workers/app.test.ts`; `pnpm test:workers:coverage` enforces 100%; CI adds required job/check `workers-coverage` alongside `coverage` and `e2e`.

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
**What**: Add red tests for omitted factor defaulting to returned `scaleFactor: 1` with always-present rounded `scaledQuantity`, exactly one supplied unsigned decimal `scaleFactor`, `0.25..50`, invalid/multiple/nonfinite forms, required numeric quantities, shortest-decimal/scientific expansion, exact base-10 multiplication, below/at/above half ties away from zero, trailing-zero JSON numbers, negative zero, Number.MAX_VALUE boundary and `1e308*50` overflow `400 validation_error` message/no-null, immutable recipe data, and unchanged list/search behavior.
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
**What**: Add red tests for every exact `CookSessionIndex` column/type/nullability/foreign key/index; no full content; per-attempt rows; nullable unique activeKey; exact sequence/projection-id constraints; version-1 UPSERT/DELETE ordering/idempotency; old/no-op/new behavior; history/privacy; and exact dual migration files.
**Output**: `test/models/cook-session-index.test.ts`, `test/scripts/migration-0025-cook-session-index.test.ts`, `test/lib/cook-session-index.server.test.ts`.
**Acceptance**: Tests fail because model/migration/helper are absent.

### ⬜ Unit 5b: Cook Index Migration Implementation
**What**: Add model/migrations and helpers for ordered projection upsert, owner-only active/history list, and attempt delete.
**Output**: `prisma/schema.prisma`, `migrations/0025_cook_session_index.sql`, `prisma/migrations/20260715100000_cook_session_index/migration.sql`, `app/lib/cook-session-index.server.ts`.
**Acceptance**: Unit 5a passes; create sequence 0, revision sequences, purge revision+1, projection id, field projection, terminal-old/new-active ordering, and scoped deletes match planning; other users see nothing.

### ⬜ Unit 5c: Cook Index Verification
**What**: Run the complete Unit 5a suite with coverage, Prisma generation, local D1 migration/rerun, typecheck, and build; record evidence only.
**Output**: `unit-5-cook-index.log`.
**Acceptance**: Commands pass with 100% helper coverage and no migration collision/warning.

### ⬜ Unit 6a: Recipe Snapshot And Fingerprint Tests
**What**: Add red pure tests for every exact typed `CookRecipeSnapshot`/`CookSessionSnapshot` scalar/null/integer/status/timestamp invariant, step/ingredient/output-use order, recursive object-key order, explicit-null/undefined behavior, unchanged Unicode/case/whitespace, finite number serialization, negative zero, SHA-256 UTF-8 lowercase-hex stability, malformed/empty recipes, excluded timestamps, and every pinned edit.
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
**What**: Add red pure tests for revision-zero defaults/equal timestamps, operations/bounds, canonical payload hash, duplicate last-wins, whole-request rejection, scale, same-value monotonic increment, stale/terminal rules, accepted-only replay ledger while current, atomic replacement/purge conversion to non-content 410 tombstones, 24-hour expiry/natural bound, hash conflict, and client rebase order.
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
**What**: Add red pure tests for exact typed adoption schema, duplicate/unknown/misordered checked ids, canonicalized order, same-fingerprint/index/scale validation, pristine-only adoption, first-writer/server-wins races, ACTIVE resume, terminal-to-new 201 attempt, atomic old-record conversion, persisted-before-4000 replacement closure, old 410 `attempt_replaced` replay, purge 410 `attempt_purged` replay, 24-hour/64-entry ledger, hash conflict, backpressure, expiry, and recorded outcomes.
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
**What**: Add real Worker red tests for every planning-defined start/get/patch/complete/abandon request and success/error envelope; active resume and pinned access after edit/soft-delete versus new/terminal-to-new visibility 404; current evolved start replay; request ids/messages/Retry-After/Allow/HEAD/unknown; canonical validation; accepted ledger; and pairwise compound-fault precedence for route/method, auth, origin, JSON/schema, replay/hash/tombstone, attempt, purge, terminal target/state, revision, visibility, capacity, and injected storage failure; verify no OpenAPI/React Router registration.
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
**What**: Add real Workers red tests for same-origin upgrade, 101 handle retention, initial/broadcast snapshots, exact hibernation attachment/restart, and every failure boundary. Cover attachment failure returning 500 before 101; initial-send failure attempting 1011 even when close throws; every error-frame send failure still attempting its specified close; replacement handling every old socket independently; accepted non-purge fanout committing before broadcast, continuing healthy sockets, attempting 1011 for failed sends, swallowing close failure, preserving HTTP 200, and scheduling no fanout alarm; and purge persisting its fence/barrier/alarm before independently attempting PURGING plus 4001 on every socket regardless of send/close failures.
**Output**: `test/workers-runtime/app-cook-session-websocket.test.ts`, `test/workers-runtime/cook-session-do-websocket.test.ts`.
**Acceptance**: Tests fail because live subscription is absent.

### ⬜ Unit 11b: Cook WebSocket Implementation
**What**: Add recipe-keyed `/live` handling with hibernation APIs and the exhaustive pre/post-upgrade send/close failure dispositions; bypass response rebuilding only for 101 and retain ordinary security/no-store behavior.
**Output**: `app/lib/cook-session-http.server.ts`, `workers/app.ts`, `workers/cook-session-do.ts`.
**Acceptance**: Unit 11a passes; subscribers receive accepted snapshots, hibernated sockets recover metadata, and no socket failure rolls back accepted state or skips an independent peer.

### ⬜ Unit 11c: Cook WebSocket Verification
**What**: Run the complete Unit 11a Workers suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-11-cook-websocket.log`.
**Acceptance**: New WebSocket paths are 100% covered and commands pass.

### ⬜ Unit 12a: D1 Projection Alarm Tests
**What**: Add real Workers red tests for ordered create/update/terminal projections, terminal-old-before-active-new, idempotent replay, transient D1 failure, persisted retry count, fake-clock delays 2/4/8/16/32/60/60, indefinite retry, reset after successful queue head, queue retention across new attempt, and stale My Kitchen card recovery. Inject `setAlarm` failure into start/progress/terminal/purge transactions and prove state, revision, ledgers, and queue all roll back with 500/no recorded mutation; prove first enqueue schedules an immediate alarm. Inject retry-state/setAlarm transaction failure inside `alarm()` and prove the handler throws for platform retry without half-persisted retry state.
**Output**: `test/workers-runtime/cook-session-projection.test.ts`, `test/lib/cook-session-index.server.test.ts`.
**Acceptance**: Tests fail because alarm-backed projection is absent.

### ⬜ Unit 12b: D1 Projection Alarm Implementation
**What**: Persist each transition's state/ledger/revision/queue and `setAlarm(Date.now())` atomically in one explicit top-level-storage transaction. Persist retry count and next alarm atomically after D1 failure, throw when that retry transaction fails, and drain FIFO without making D1 canonical.
**Output**: `workers/cook-session-do.ts`, `app/lib/cook-session-index.server.ts`.
**Acceptance**: Unit 12a passes; no transition is accepted without its alarm, accepted DO mutations survive D1 failure/new attempt, and repeated alarms do not duplicate history.

### ⬜ Unit 12c: D1 Projection Verification
**What**: Run the complete Unit 12a Workers/app suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-12-cook-projection.log`.
**Acceptance**: New projection code is 100% covered; no RecipeSpoon/notification integration appears.

### ⬜ Unit 13a: Cook Purge Fence Tests
**What**: Add real Workers red tests for exact DELETE/precedence/residue/PURGING/socket/FIFO behavior; old-terminal/new-attempt/purge; delayed start/progress/terminal replays as correct replaced/purged 410 tombstones with no response content; natural tombstone bound/expiry; newer-attempt isolation; atomic content deletion/conversion; and separate seven injected failure boundaries.
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
**What**: Add red hook/controller tests for the authenticated discriminated record with mutually exclusive PATCH `inFlight` and start/complete/abandon `command`; write-before-send for every mutation; progress draining before terminal commands; abandon-then-start-fresh ordering; canonical base versus optimistic rendering; and accepted-response persistence failure rendering accepted base plus pending-only. Cover only visible Retry-saving/window-focus local-write retries with no timer/network retry; every-mount bootstrap replaying a persisted command before GET or resolving inFlight after same-attempt GET; offline/read-error hidden disk state and disabled controls; same/different-attempt persistence/quarantine/reload; the exhaustive snapshot/error disposition table; and anonymous v2/legacy clearing only after both successful start and authenticated persistence.
**Output**: `test/hooks/use-cook-session.test.ts`, `test/routes/recipes-id.test.tsx`.
**Acceptance**: Tests fail because hook/controller is absent.

### ⬜ Unit 15b: Cook Client Reconciliation Implementation
**What**: Implement `useCookSession`; add anonymous v2 parser/writer while retaining v1 local-only behavior; implement write-gated authenticated pending/single-inFlight PATCH plus persisted discriminated start/terminal command state, bootstrap replay, local-write recovery triggers, and exact reconciliation/error rules.
**Output**: `app/hooks/useCookSession.ts`, `app/routes/recipes.$id.tsx`.
**Acceptance**: Unit 15a passes; client time never overrides server; every authenticated mutation is recoverable after an unknown response; anonymous state clears only after successful 200/201 start plus authenticated persistence; queue/command transitions follow the exhaustive persisted disposition table.

### ⬜ Unit 15c: Cook Client Reconciliation Verification
**What**: Run the complete Unit 15a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-15-cook-client-state.log`.
**Acceptance**: New hook code is 100% covered and anonymous regressions pass.

### ⬜ Unit 16a: Recipe Cook Lifecycle UI Tests
**What**: Add red route tests for server snapshot, persisted step/check/scale, adoption outcome, edit warning, Continue original, Start fresh order, complete, abandon, reconnect, terminal/error UI, and cook-only fallback after recipe soft-delete/inaccessibility for an authenticated caller with that caller's own pinned attempt; anonymous callers and authenticated callers with no own attempt remain 404, and terminal-to-new is forbidden.
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
**What**: Add red loader/render/interaction tests for owner active cards; activation preflight GET ACTIVE navigation; terminal/404 local invalidation plus alarm scheduling/revalidator behavior and no same-mount reappearance; eventual loader repair; network retry without hiding; stale/empty removal; soft-deleted recipe with active DO retained via pinned projection versus soft-deleted/no-current stale projection removal; and strict absence/query suppression for authenticated/anonymous visitors.
**Output**: `test/routes/index.test.tsx`, `test/components/recipe/ContinueCookingList.test.tsx`, `test/components/navigation/mobile-nav.test.tsx`.
**Acceptance**: Tests fail only because owner-only section is absent; dock links remain unchanged.

### ⬜ Unit 17b: Owner-Only Continue Cooking Implementation
**What**: Load D1 active projection only for owner; make Continue Cooking activation preflight the canonical DO, schedule pending projection alarm through GET, invalidate stale cards locally, and revalidate the owner route; render unframed list without dock edits.
**Output**: `app/routes/_index.tsx`, `app/components/recipe/ContinueCookingList.tsx`, `app/lib/cook-session-client.ts`, `workers/cook-session-do.ts`.
**Acceptance**: Unit 17a passes; stale cards cannot navigate/resurface in the same mount, active cards navigate, later D1 loader repairs, and non-owner loader/query contains no private metadata.

### ⬜ Unit 17c: Continue Cooking Verification
**What**: Run the complete Unit 17a app suite plus affected Workers alarm/GET suite with both coverage projects, typecheck, and build; record evidence only.
**Output**: `unit-17-continue-cooking.log`.
**Acceptance**: New code is 100% covered and nav/privacy regressions pass.

### ⬜ Unit 17d: Continue Cooking Visual QA
**What**: Invoke visual QA for owner/non-owner My Kitchen desktop/mobile with empty/active/stale states.
**Output**: `visual-kitchen-cooking/` evidence and closed ledgers.
**Acceptance**: No private leakage, overlap, dock churn, or ready visual issue remains.

### ⬜ Unit 18a: SavedRecipe Migration Tests
**What**: Add red tests for hard-delete saves, unique pair, owner-derived distinct backfill with explicit Recipe join/`deletedAt IS NULL`, rerun, soft-delete hide/restore, and exact migration.
**Output**: `test/models/saved-recipe.test.ts`, `test/scripts/migration-0026-saved-recipes.test.ts`, `test/lib/saved-recipes.server.test.ts`.
**Acceptance**: Tests fail because schema/migration/helper are absent.

### ⬜ Unit 18b: SavedRecipe Migration Implementation
**What**: Add schema/migrations and canonical save/unsave/get/list helpers; backfill only in SQL.
**Output**: `prisma/schema.prisma`, `migrations/0026_saved_recipes.sql`, `prisma/migrations/20260715101000_saved_recipes/migration.sql`, `app/lib/saved-recipes.server.ts`.
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
**What**: Add red tests for private GET `/api/v1/me/saved-recipes`, session/bearer auth, `recipes:read`, no-store, default-20/max-50 validation, `(createdAt DESC, recipeId DESC)` pagination, exact `v1.<base64url({ createdAt, recipeId })>` cursor validation/ties, exact `{ limit, cursor, nextCursor, hasMore, recipes }` data, `isSaved: true`, soft-deleted omission, empty/error envelopes, route registry, and OpenAPI.
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
**What**: Add red tests for idempotent PUT/DELETE `/api/v1/me/saved-recipes/:recipeId`, body-over-header-over-query `clientMutationId` precedence, unknown fields, exact 200 `{ recipeId, saved, mutation }` payload/replay flag, already-saved/already-unsaved success, `recipes:write`, session/bearer auth, replay/conflict/in-progress errors, missing/deleted recipe 404, no-store, route registry, and OpenAPI.
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
**What**: Add red tests for `isSaved: null` only with no principal and viewer-specific boolean for session, bearer, and environment principals across summary/detail/search/native-sync/cookbook payloads, including bearer scope enforcement; assert anonymous existing public Cache-Control/ETag plus deduplicated `Vary: Cookie, Authorization`, and principal `private, no-store`/Pragma/same Vary, with no public count or cache leak.
**Output**: `test/routes/api-v1-recipes.test.ts`, `test/routes/api-v1-search.test.ts`, `test/routes/api-v1-native-sync.test.ts`, `test/routes/api-v1-recipe-writes.test.ts`, `test/routes/api-v1-cookbooks.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/scripts/generate-api-playground.test.ts`.
**Acceptance**: The targeted run fails because functional isSaved projection is absent.

### ⬜ Unit 20.3b: Recipe isSaved Projection Implementation
**What**: Add the nullable `isSaved` field to v1 contracts, wire viewer-scoped SavedRecipe lookup into shared recipe builders, and preserve anonymous caching.
**Output**: `app/lib/api-v1.server.ts`, `app/lib/api-v1-contract.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.playground.tsx`, `app/routes/developers.tsx`, `docs/api.md`.
**Acceptance**: Unit 20.3a passes; no-principal is null, every valid user-bound principal is boolean subject to existing scope checks, and save state never becomes a public count.

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
**What**: Add red tests for accepted-only schema, owner auth, MANUAL source, singular lowercase controlled course, Unicode-whitespace collapse, NFKC/lowercase identity, duplicate-keeps-existing casing, hard-delete/re-add-resets casing, 1/40/41-code-point bounds, reserved course words, normalized uniqueness/order, blank service rejection/form omission, soft-delete, and exact migration. Prove the partial unique COURSE index, BEFORE INSERT 10-custom-tag trigger that ignores normalized duplicates, and AFTER INSERT/DELETE/UPDATE parent `Recipe.updatedAt` triggers; inject both commit orders for simultaneous course replacement, full-replace versus delta, two adds observed at nine, and delete/re-add casing. Assert ordinary over-limit is 400 while a trigger race maps exactly to `409 tag_conflict` / `Tags changed; review and retry.` with no partial write.
**Output**: `test/models/recipe-tag.test.ts`, `test/lib/recipe-tags.server.test.ts`, `test/scripts/migration-0027-recipe-tags.test.ts`.
**Acceptance**: Tests fail because tag schema/service/migration are absent.

### ⬜ Unit 24b: RecipeTag Migration And Service Implementation
**What**: Add schema/migrations, partial COURSE uniqueness, custom-count and parent-updatedAt triggers, and owner-only declarative current-state replace-course/add/remove/list helpers. Map trigger races to the exact tag-conflict response; keep ordinary validation at 400 and add no AI proposal state.
**Output**: `prisma/schema.prisma`, `migrations/0027_recipe_tags.sql`, `prisma/migrations/20260715102000_recipe_tags/migration.sql`, `app/lib/recipe-tags.server.ts`.
**Acceptance**: Unit 24a passes; database constraints preserve one course/ten customs and parent freshness under both race orders; normalization is deterministic; source is MANUAL.

### ⬜ Unit 24c: RecipeTag Data Verification
**What**: Run the complete Unit 24a suite with coverage, Prisma generation, local migrations/rerun, typecheck, and build; record evidence only.
**Output**: `unit-24-tags-data.log`.
**Acceptance**: New service is 100% covered and commands pass.

### ⬜ Unit 25a: Tag Authoring Tests
**What**: Add red tests for exactly one `course` plus repeated `customTag` FormData, missing/repeated/blank/invalid handling, first-occurrence normalization/order, create nested atomicity, owner auth, submitted-value 400 and tag-conflict 409 display, and no AI wording. For edit, force execution-time current-state full replacement: delete absent rows first, conflict-ignore every desired normalized insert to retain then-current casing, then update recipe; inject rollback at every statement and both commit orders against concurrent delta/course/delete-readd writes.
**Output**: `test/components/recipe/RecipeBuilder.test.tsx`, `test/routes/recipes-new.test.tsx`, `test/routes/recipes-id-edit.test.tsx`, `test/lib/recipe-create.server.test.ts`, `test/lib/recipe-detail.server.test.ts`.
**Acceptance**: Tests fail because authoring is absent.

### ⬜ Unit 25b: Tag Authoring Implementation
**What**: Add exact course/custom fields and parser to RecipeBuilder; create tags through nested recipe create; edit through a current-state declarative non-interactive transaction that deletes absent rows, conflict-ignores desired inserts to preserve execution-time casing, and applies the recipe update. Surface the exact race-conflict response with submitted values intact.
**Output**: `app/components/recipe/RecipeBuilder.tsx`, `app/lib/recipe-create.server.ts`, `app/lib/recipe-detail.server.ts`, `app/routes/recipes.new.tsx`, `app/routes/recipes.$id.edit.tsx`.
**Acceptance**: Unit 25a passes; only owners mutate, invalid input is server-rejected, and concurrent writes serialize to one complete invariant-valid state.

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
**What**: Add red tests for accepted labels in SearchDocument content and RecipeTag count/latest/content fingerprint; lazy rebuild on add/remove/replace-course; mutation success without synchronous rebuild; and the runtime `SearchRebuildLease` acquisition oracle. Use fake time to prove one immediate attempt followed by exact 25/50/100/200/400/800/1600 ms waits before attempts two through eight, 60-second expiry recovery, non-holder searches never querying under a live lease, and a holder performing at most three fresh fingerprint/build/guarded-transaction/postcheck cycles. Inject every replacement statement, postcheck mismatch, lease-loss, release, and crash boundary; prove readers see only an old or complete new index, failures never query, and the matching postcheck is the response consistency point.
**Output**: `test/lib/search.server.test.ts`, `test/lib/recipe-tags.server.test.ts`.
**Acceptance**: The exact two-file Vitest run fails because tag indexing is absent.

### ⬜ Unit 27.1b: Tag Search Index Implementation
**What**: Include accepted manual tags and RecipeTag source fingerprint in search; make tag mutations rely on transactional parent freshness without synchronous rebuild. Implement the expiring runtime rebuild lease, guarded single-transaction document/metadata replacement, postcheck/rebuild loop, best-effort release, and no-query failure policy while retaining existing cache/privacy behavior.
**Output**: `app/lib/search.server.ts`, `app/lib/recipe-tags.server.ts`, `prisma/schema.prisma`, `migrations/0027_recipe_tags.sql`, `prisma/migrations/20260715102000_recipe_tags/migration.sql`.
**Acceptance**: Unit 27.1a passes; concurrent rebuilds have an executable serialization oracle, saved privacy remains intact, and only canonical accepted tags are indexed.

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
**What**: Add red tests for one `course` plus repeatable `tag` parameter names, normalization/deduplication, ignored empty tags, 10-tag cap, 400 on repeated/invalid course or invalid/over-limit custom input, AND across search/owner/course/every custom tag, URL control behavior, empty results, and unchanged unfiltered ordering in My Recipes, owner My Kitchen, and Search.
**Output**: `test/routes/my-recipes.test.tsx`, `test/routes/index.test.tsx`, `test/routes/search.test.tsx`, `test/components/pantry/RecipeGrid.test.tsx`.
**Acceptance**: Tests fail because filters are absent.

### ⬜ Unit 28b: Tag Discovery Filter Implementation
**What**: Add shared tag filter parsing/querying and controls to the three discovery surfaces without dock edits.
**Output**: `app/lib/recipe-tag-filter.ts`, `app/routes/my-recipes.tsx`, `app/routes/_index.tsx`, `app/routes/search.tsx`, `app/components/pantry/RecipeGrid.tsx`.
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
**What**: Run scoped existing navigation/repo-hygiene/developer-doc tests, inspect the completed product-feature diff from Units 1–28 for import UI/AI/Pebble/dock changes, and map every feedback-source row to code/test evidence or its explicit rejection. Units 29.1–31 touch deployment/smoke/cleanup infrastructure only.
**Output**: `unit-29-feedback-audit.md`; logs for `test/components/navigation/mobile-nav.test.tsx`, `test/repo-hygiene.test.ts`, `test/docs/developer-platform-docs.test.ts`, and `test/docs/developer-platform-guide.test.ts`.
**Acceptance**: Tests pass; no source item is missing/silently deferred; no first-party import UI, AI tag surface, Pebble contract, or unproven dock edit exists.

### ⬜ Unit 29.1a: Deployment SHA Attestation Tests
**What**: Add red tests for compile-time 40-char lowercase HEAD resolution/validation, non-development failure, public `/health` additive `buildSha`, matching header, no-store, and smoke helpers that poll 5 seconds up to 180 seconds and reject body/header mismatch or wrong SHA.
**Output**: `test/config/vite-build-sha.test.ts`, `test/lib/health.server.test.ts`, `test/scripts/smoke-live-helpers.test.ts`.
**Acceptance**: The exact three-file run fails because build/deploy attestation is absent.

### ⬜ Unit 29.1b: Deployment SHA Attestation Implementation
**What**: Define exact `__SPOONJOY_BUILD_SHA__` from git HEAD through Vite without generated-file writes; use literal development only in dev; add build SHA to health body/header/no-store; implement cache-busted exact-SHA polling and deployment-record capture helpers.
**Output**: `vite.config.ts`, `app/lib/health.server.ts`, `app/routes/health.ts`, `app/cloudflare-env.d.ts`, `scripts/smoke-live-helpers.mjs`, `scripts/deployment-preflight.ts`.
**Acceptance**: Unit 29.1a passes; production builds fail without valid SHA; local development uses explicit `development`; health remains auth/DB independent.

### ⬜ Unit 29.1c: Deployment SHA Attestation Verification
**What**: Run the complete Unit 29.1a suite with coverage, script typecheck, deployment preflight, typecheck, and build; record evidence only.
**Output**: `unit-29.1-deploy-attestation.log`.
**Acceptance**: New build/health/polling code is 100% covered and a local production build reports current HEAD without dirtying git.

### ⬜ Unit 30a: Two-Client Smoke Tests
**What**: Add red script tests for two authenticated browser contexts sharing one attempt, WebSocket step/check/scale sync, edit warning, complete/abandon, owner-only residue inspection, attempt-id capture, and failure artifact capture. Force start to commit while its response is lost or malformed and prove cleanup discovers the unknown accepted attempt from owner `/residue` without trusting the browser response.
**Output**: `test/scripts/smoke-live-cook-session.test.ts`.
**Acceptance**: Tests fail because lifecycle smoke is absent.

### ⬜ Unit 30b: Two-Client Smoke Implementation
**What**: Extend smoke to create disposable `codex-smoke-*` recipe/user state and validate two-context lifecycle synchronization.
**Output**: `scripts/smoke-live.mjs`, `scripts/smoke-live-helpers.mjs`.
**Acceptance**: Unit 30a passes; successful and failed synchronization produce useful artifacts, and an accepted start with no usable response remains discoverable for cleanup.

### ⬜ Unit 30c: Two-Client Smoke Verification
**What**: Run the complete Unit 30a script suite with coverage and script typecheck; record evidence only.
**Output**: `unit-30-smoke-sync.log`.
**Acceptance**: New lifecycle smoke logic is 100% covered and commands pass.

### ⬜ Unit 31a: Smoke Purge And Cleanup Tests
**What**: Add red fake-clock tests for the exact cleanup state machine and one 20-request/90-second budget shared by owner-residue discovery, DELETE, and final residue. Cover discovery retry/fatal parsing; unknown accepted start after lost/malformed response; null current plus zero counts skipping DELETE; null plus nonzero counts failing; deadline before request/sleep; per-request abort; DELETE retry/status/Retry-After/stale-target/fatal classifications; 500ms exponential cap-5s; no final over-deadline sleep; post-204 residue/D1/user proof; primary failure then exact 5-second wait and one fresh-budget recovery; functional failure with clean cleanup; recovery success incident; double-failure `cleanupIncomplete`/retained user; bounded non-content tombstones; and complete artifacts.
**Output**: `test/scripts/smoke-live-cleanup.test.ts`, `test/scripts/smoke-live-helpers.test.ts`.
**Acceptance**: Tests fail because cleanup reliability is absent.

### ⬜ Unit 31b: Smoke Purge And Cleanup Implementation
**What**: Implement the planning-defined pass in `finally`: discover the canonical current attempt through owner `/residue` before DELETE, share the exact request/deadline budget across discovery/delete/proof, and handle null-current zero/nonzero residue exactly. Implement the exact two-pass recovery. Emit separate `residueClean`, `cleanupRecovered`, and `cleanupIncomplete`; exit zero only for functional success plus primary cleanup success. Recovery success deletes the user but exits nonzero; double failure leaves it for external cleanup. Require final owner residue and environment-safe remote D1 attempt count zero before user delete; bounded non-content replay tombstones are allowed/recorded.
**Output**: `scripts/smoke-live.mjs`, `scripts/smoke-live-helpers.mjs`.
**Acceptance**: Unit 31a passes; functional smoke failure still cleans; recoverable cleanup failure gets one bounded clean recovery; irrecoverable cleanup is never reported clean and blocks ship until a later rerun proves zero content/residue.

### ⬜ Unit 31c: Smoke Cleanup Verification
**What**: Run the complete Unit 31a script suite with coverage, script typecheck, and local dry-run residue inspection; record evidence only.
**Output**: `unit-31-smoke-cleanup.log`.
**Acceptance**: New cleanup logic is 100% covered and `pnpm cleanup:qa` reports no disposable local data.

### ⬜ Unit 32: Final Local Validation
**What**: Freeze all in-repo task docs/artifacts first and mirror subsequent continuity to the external Desk iteration. From a clean branch HEAD, run and capture exactly: `pnpm cleanup:qa`; `pnpm prisma:generate`; `pnpm exec wrangler d1 migrations apply DB --local` twice; `pnpm run api:playground:generate`; `git diff --exit-code -- app/lib/generated/api-v1-playground.ts`; `pnpm run typecheck`; `pnpm run typecheck:scripts`; `pnpm test:workers:coverage`; `pnpm test:coverage`; `pnpm test:e2e`; `pnpm build`; `git diff --check`; `git status --short`. Then run fresh implementation, test, security/privacy, and migration/config reviewers against that exact HEAD.
**Output**: external Desk iteration `artifacts/unit-32-local-validation.md` plus raw logs; do not change tracked branch files after the gate.
**Acceptance**: Every command exits zero with zero warnings and 100% new-code coverage; local migrations are rerunnable; generated output is clean; every actionable reviewer finding is fixed and the full command/review gate rerun on the resulting HEAD; git/local disposable residue is clean.

### ⬜ Unit 33: QA Deploy And Cross-Device Gate
**What**: Record `HEAD=$(git rev-parse HEAD)` and `pnpm exec wrangler deployments list --env qa --json` before deploy; run `pnpm cleanup:remote:qa`, `pnpm run qa:preflight`, `pnpm deploy:qa`, and the same deployment-list command after, preserving all new ids/output. Use the tested attestation helper to poll cache-busted QA `/health` every 5s for max 180s until body and `X-Spoonjoy-Build-Sha` both equal HEAD; timeout/wrong mismatch fails before smoke. Then run QA web/API/two-client smoke. Before user deletion require zero `/residue` counts and zero remote D1 attempt row. In `finally` run the exact purge retry/user cleanup and post `pnpm cleanup:remote:qa`.
**Output**: external Desk iteration `artifacts/unit-33-qa.md`, deploy version/URL, smoke screenshots/logs, cleanup and DO/D1 residue logs; no tracked branch edit.
**Acceptance**: QA deploy/smokes exit zero for the exact recorded branch HEAD SHA before PR merge, including primary-pass cleanup without `cleanupRecovered`; owner DO diagnostic and D1 query prove no attempt content/row; no disposable data remains.

### ⬜ Unit 34: PR Creation And Fresh Review
**What**: Invoke `work-merger`; `git fetch origin main`; integrate origin/main before the final gates; rerun affected conflict tests; and push. Any HEAD change for any reason, including a history-only rewrite or tracked task-doc/evidence commit, invalidates the prior exact-SHA gate and requires Units 32-33 on the new HEAD. After a successful Unit 33, do not amend, rebase, merge, or commit on the branch. Open a ready PR and run newly spawned implementation, design/visual, test/coverage, security/privacy, migration/DO, and API-compatibility reviewers against that PR head. A reviewer fix changes HEAD and loops through Units 32-33 plus all PR reviews again.
**Output**: PR URL and external Desk iteration `artifacts/unit-34-pr-review.md`.
**Acceptance**: PR head exactly equals the last Unit 33 SHA; no post-QA rewrite/commit exists; every actionable review finding is fixed and the resulting head has rerun Units 32-33/reviews.

### ⬜ Unit 35: CI Convergence
**What**: Run `gh pr checks "$PR" --watch` and require workflow `CI` jobs/checks `coverage`, `workers-coverage`, and `e2e` on the exact PR head. Diagnose/fix any failure and rerun reviewers for repairs. Any repair or other HEAD change reopens and reruns Units 32-33 plus all PR reviews, then refreshes CI for the new head.
**Output**: Green check URLs and external Desk iteration `artifacts/unit-35-ci.md`.
**Acceptance**: Every required check is green for current head SHA with no unresolved review comment.

### ⬜ Unit 36: Merge
**What**: Run `gh pr view "$PR" --json headRefOid,mergeStateStatus,reviewDecision,statusCheckRollup`; verify head equals Unit 33 SHA, all checks/reviews green, and a cache-busted QA `/health` body/header still equal that head immediately before merge. Any mismatch reruns Unit 33. Merge through `work-merger`; then record `gh pr view "$PR" --json state,mergedAt,mergeCommit` without manual production deployment.
**Output**: Merge evidence and external Desk iteration `artifacts/unit-36-merge.md`.
**Acceptance**: Current PR head SHA exactly equals the SHA recorded by the latest successful Unit 33 QA gate; every required check/review is green for that head; PR is merged and exact merge SHA recorded.

### ⬜ Unit 37: Production Deploy, Smoke, Cleanup, And Handoff
**What**: Poll `gh run list --workflow "Production Deploy" --commit "$MERGE_SHA" --limit 20 --json databaseId,headSha,status,conclusion,url,createdAt,event` every 10s for max 5m until an exact-head candidate exists; retain all candidates, choose newest non-cancelled by `createdAt` then `databaseId`, and poll `gh run view "$RUN_ID" --json headSha,status,conclusion,jobs,url` for at most 30m. Require exact head, workflow success, and job named `deploy` success. Record production `pnpm exec wrangler deployments list --json` before/after and newest post-run deployment. Use the tested helper to poll cache-busted canonical `/health` every 5s for max 180s until body/header both equal merge SHA; this is authoritative live proof. Then run readiness, production web/API/two-client smoke, owner residue zero, remote D1 row zero, and exact purge/user cleanup. Run continuation scan, close Desk/git/worktree, and notify Slugger.
**Output**: external Desk iteration `artifacts/unit-37-production.md`, workflow/version URLs, `https://spoonjoy.app` evidence, cleanup/continuation logs, and `ouro msg --to slugger "Done: shipped Clem feedback end to end"` result.
**Acceptance**: Exact SHA is live; all smokes pass; no disposable data or ready in-scope follow-up remains; git/Desk terminal and clean; Slugger notified.

## Execution
- Tests -> confirmed red -> implementation -> green -> refactor for every a/b/c group.
- Commit/push each intentional-red `a` checkpoint and green `b` checkpoint; keep `c` verification-only, then update group emojis/progress and run a newly spawned, context-independent group reviewer after every a/b/c group (Units 1-28, 29.1, and 30-31). "Fresh" means a new sub-agent given only the approved planning/doing docs, current diff/commits, and test evidence. Every actionable finding is fixed with a new red/green cycle and re-reviewed; no severity is silently waived.
- Every `d` unit runs `visual-qa-dogfood` plus a newly spawned visual reviewer after fixes. Units 29, 32, and 34 are their own explicit audit/review gates; Units 0 and 33-37 use their named acceptance gates rather than the group-review rule.
- Store every command/log/screenshot in the artifact directory.
- Before Unit 32, commit/push the final in-repo doing/progress/AUTOPILOT state and hand continuity to the adopted external Desk iteration. Units 32-37 write operational evidence only to external Desk/GitHub/Cloudflare surfaces; they must not create an unvalidated branch HEAD. Any later tracked change invalidates the gate and loops through Units 32-33.
- Invoke `visual-qa-dogfood` for every d unit, `work-merger` at Unit 34, and `stay-in-turn` through CI/deploy.
- Never leave smoke/manual users, recipes, sessions, saves, or tags behind.

## Progress Log
- 2026-07-14 13:26 Initial doing doc created.
- 2026-07-14 13:46 Initial review chain did not converge.
- 2026-07-15 Latest-model audit rebuilt contracts and planning converged after five hostile rounds.
- 2026-07-15 Granularity Round 1 split metadata/scaling, every cook layer, saved UI/search/kitchen, tag authoring/display/index/filters, smoke lifecycle/cleanup, visual QA, PR review, CI, and merge into atomic units.
- 2026-07-15 Granularity converged after six fresh rounds; red/green/verify boundaries, exact outputs, and QA-to-PR-head ordering are explicit.
- 2026-07-15 Validation converged after three fresh rounds; every existing path/convention and planned-new file family aligns with current HEAD.
- 2026-07-15 Ambiguity Round 1 fixed the full cook wire protocol, revision/ledger/retry/purge transitions, canonical hashing, saved pagination/mutation envelopes, tag normalization/filter semantics, baseline policy, reviewer definition, and exact local/QA/CI/production commands.
- 2026-07-15 Ambiguity Round 2 fixed exact-SHA gate deadlock, rejected mutation/rebase semantics, terminal restart, projection schema, recipe visibility, principal-scoped saves, typed adoption, concurrent shopping coordination, remote residue proof, request ids/messages, decimal ties, and tag casing reset.
- 2026-07-15 Ambiguity Round 3 fixed transactional shopping retry/oracles, canonical cook mutations/defaults/methods/WebSockets, authenticated offline reconciliation, stale-card repair ownership, atomic tag replacement, DELETE/smoke retry precedence, and health-based deployment SHA attestation.
- 2026-07-15 Ambiguity Round 4 fixed post-replacement/purge mutation tombstones, single-inFlight offline batching and storage-write safety, fingerprinted anonymous v2 with legacy isolation, scaling overflow, and exact cleanup retry classification/deadline order.
- 2026-07-15 Ambiguity Round 5 fixed version-first shopping reads, exhaustive client error/persistence behavior, principal cache partitions, bounded cleanup recovery, terminal/start precedence, anonymous clear timing, and omitted-factor projection.
- 2026-07-15 Ambiguity Round 6 fixed request/error precedence, same-attempt terminal retry safety, attempt-replacement persistence failure, exact cleanup oracle, and pinned-session behavior after recipe deletion.
- 2026-07-15 Ambiguity Round 7 fixed cleanup exit/result separation, accepted-response rendering, authenticated bootstrap quarantine, fanout failure isolation, lazy tag-index repair/cache consistency, and hard-delete scope.
- 2026-07-15 Ambiguity Round 8 fixed persisted start/terminal commands, unknown-attempt cleanup discovery, serialized search rebuilds, atomic projection alarms, every WebSocket failure path, and concurrent tag invariants.
