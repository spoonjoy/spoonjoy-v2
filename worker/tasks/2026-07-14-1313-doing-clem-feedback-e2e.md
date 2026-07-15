# Doing: Clem Feedback E2E

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-07-14 13:26
**Rebuilt**: 2026-07-15 after latest-model audit
**Planning**: ./2026-07-14-1313-planning-clem-feedback-e2e.md
**Feedback Source**: ./2026-07-14-1313-clem-feedback-source.md
**Artifacts**: ./2026-07-14-1313-doing-clem-feedback-e2e/
**External Desk Task**: /Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/task.md
**External Desk Artifacts**: /Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/

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
- Cook HTTP uses the planning doc's exact `{ ok, requestId, data|error }` envelopes, request-id rule, operation union, status/code/message table, bodyless 204, and private/no-store headers. Cook revisions start at 0; an accepted PATCH or first terminal transition increments once; only accepted mutations create live records in the exact 24-hour attempt-scoped 256 ledger, while expiry pruning is maintenance. A received stale revision is retried after rebase with a fresh UUID; network uncertainty first retries the original request/id. Start has its global 64-record/tombstone ledger and creates a new 201 attempt after terminal state. Mutation ids are UUID v4.
- Cook WebSockets are read-only and emit only `snapshot`/`error` server frames. Client data closes `1003 Read-only subscription`; attempt replacement closes `4000 Attempt replaced`; purge closes `4001 Session purged`; hibernation attachments carry version/user/recipe/attempt.
- Recipe hashing uses the planning doc's exact snapshot schemas, nested sort orders, recursive lexicographic object-key ordering, explicit nulls, finite ECMAScript JSON numbers with negative zero normalized, unchanged stored strings, UTF-8, and lowercase SHA-256 hex.
- Projection retry delays are exactly 2, 4, 8, 16, 32, then 60 seconds forever. Purge tests separately inject every named persistence/broadcast/socket-drain/D1/crash/local-transaction boundary in planning; a test named only "partial failure" is insufficient.
- D1 projection uses the planning doc's exact `CookSessionIndex` columns/indexes and version-1 UPSERT/DELETE queue schema. Remote cleanup proves owner-only residue zero, current/purged D1 absence before disposable-user deletion, and all of that user's D1 history gone after cascade.
- Saved REST list is newest-first with default 20/max 50 and the planning doc's canonical unpadded byte-exact `v1.<base64url(JSON)>` cursor; response data is `{ limit, cursor, nextCursor, hasMore, recipes }`. PUT/DELETE source `clientMutationId` body -> `X-Client-Mutation-Id` -> query and return the exact 200 `{ recipeId, saved, mutation }` payload.
- Tag normalization is trim + Unicode-whitespace collapse + NFKC lowercase identity, 1..40 code points, 10 custom tags max, course-word reservation, first-label display casing, and normalizedLabel/id Unicode-scalar/BINARY order. Database triggers/partial uniqueness enforce concurrency invariants; immutable migration 0027 creates the singleton search lease. Filters are one `course`, repeatable `tag`, AND across all scopes/tags before rank/limit, with malformed/over-limit input returning 400.
- Shopping batches use the planning doc's list-level version/lease transaction, empty-list zero allocator, original-order aggregate override rule, eight-attempt fixed backoff, and exact web/REST/MCP busy errors. Cook idempotency hashes canonical validated payloads, applies ordered duplicate operations last-wins, and atomically rejects any invalid operation.
- Authenticated offline state uses the exact user/recipe/client-tab-scoped v1 record/queue/command schema and 256/64 bounds in planning; tabs never share a local queue and converge through the DO. Deploy correctness is proven by no-store `/health` body/header build SHA, not deployment timestamps.

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
**What**: Add red tests for no-row, active unchecked/checked, and every tombstone affordance combination: omitted independently preserves each stored non-null category/icon and infers only each stored null, while explicit null/string overrides. Run that matrix across web/v1/MCP/recipe batches plus quantity/timestamps/order, aggregate sentinels, version-first races, lease no-op, atomic batch/allocator, both commit orders, sums, fixed retry/exhaustion, and rerunnable migration. Prove aborted retries consume no range while successful checked/tombstone moves and deletes may leave only their vacated sort-index gaps.
**Output**: `test/lib/shopping-list-mutations.server.test.ts`, `test/routes/shopping-list-route.test.ts`, `test/routes/api-v1-shopping-mutations.test.ts`, `test/routes/api-v1-shopping-d1.test.ts`, `test/lib/mcp/spoonjoy-tools.server.test.ts`, `test/scripts/migration-0024-shopping-list-mutation-coordination.test.ts`.
**Acceptance**: The targeted Vitest command fails only on the missing shared semantics.

### ⬜ Unit 1b: Shopping Mutation Matrix Implementation
**What**: Add list-level mutationVersion/mutationLease/nextSortIndex schema/migration; implement the complete no-row/active/tombstone matrix, omitted/null sentinel semantics, guarded non-interactive batch, fixed retry, `ShoppingListBusyError`, and allocator in `app/lib/shopping-list-mutations.server.ts`; route every item mutation/move-to-end plus web, v1, MCP, and recipe add/restore through shared primitives; add v1 `write_conflict`; update public behavior descriptions/examples.
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
**What**: Add red tests for omitted factor defaulting to returned `scaleFactor: 1` with always-present rounded `scaledQuantity`, exactly one supplied unsigned decimal `scaleFactor`, parsed-Number range `0.25..50`, invalid/multiple/nonfinite forms, required numeric quantities, shortest-decimal/scientific expansion, exact base-10 multiplication from the parsed factor's ECMAScript shortest round-trip value rather than raw lexeme (including `0.25000000000000001 -> 0.25`), below/at/above half ties away from zero, trailing-zero JSON numbers, negative zero, Number.MAX_VALUE boundary and `1e308*50` overflow `400 validation_error` message/no-null, immutable recipe data, and unchanged list/search behavior.
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
**What**: Add red tests for every exact CookSessionIndex column/type/nullability/foreign key/index; no full content; per-attempt rows; nullable unique activeKey; and the exact persisted projection union. Assert every UPSERT field/status/ISO timestamp/revision-sequence shape, DELETE's owner/recipe-only payload, projection-id components, no PURGING upsert, matching-id no-op, greater apply, lower no-op, equal-sequence/different-id corruption with no overwrite/delete, missing-row behavior, history/privacy, and exact dual migrations.
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
**What**: Add red pure tests for exact snapshots including legal zero/negative stepNum, outputStepNum, and duration with activeStepIndex addressing sorted position; empty stored title/name/description preservation; no migration/renumber; stable-id/nonfinite rejection only. Cover all scalar/null/status/timestamp invariants, nested ordering, canonical keys/null/Unicode/numbers/-0/SHA-256, malformed/empty recipes, excluded fields, and every pinned edit.
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
**What**: Add red pure tests for revision-zero defaults/equal timestamps, structural versus pinned-semantic operation validation, canonical payload hash, duplicate last-wins, whole-request rejection, scale, same-value monotonic increment, stale/terminal precedence, accepted-only replay ledger while current, and atomic replacement/purge conversion to non-content 410 tombstones. Fix integer-ms `expiresAtMs=acceptedAtMs+86_400_000`, live-at-before/expired-at-equality, prune-before-lookup maintenance, start-global versus mutation-attempt capacity including tombstones, newer-attempt isolation, exact oldest-expiry Retry-After, natural bound, hash conflict, and client rebase order.
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
**What**: Add red pure tests for exact AdoptionInput fields using lowercase `^[0-9a-f]{64}$` recipeFingerprint with uppercase rejected/no normalization and no updatedAt/null/unknowns; anonymous-v2 mapping drops updatedAt; persisted null omits wire field; the state-independent hash excludes mutation/request ids, distinguishes omission, includes every present field, and lexicographically sorts checked arrays before and after state creation. Cover structural-before-state, pristine semantic validation with pinned-order applied state, structural-only server-won behavior, all outcomes, changed/deleted ACTIVE resume, exact visibility/snapshot SELECT linearization under start-before-delete/edit and delete/edit-before-start, replay, terminal/purge/race ledger rules.
**Output**: `test/lib/cook-session-start.test.ts`.
**Acceptance**: Tests fail because start coordinator is absent.

### ⬜ Unit 8b: Start And Adoption Arbitration Implementation
**What**: Implement attempt UUID creation, coordinator metadata, adoption outcomes, and non-evicting start replay ledger.
**Output**: `app/lib/cook-session-start.ts`, `app/lib/cook-session-types.ts`, `app/lib/cook-session-state.ts`.
**Acceptance**: Unit 8a passes; client time is ignored; parallel starts produce one attempt; every accepted response has the declared outcome; unexpired replay is exact or 429 backpressure applies.

### ⬜ Unit 8c: Start And Adoption Verification
**What**: Run the complete Unit 8a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-8-cook-start.log`.
**Acceptance**: New code is 100% covered and commands pass.

### ⬜ Unit 9a: Durable Object Binding And Storage Tests
**What**: Add real Workers red tests for deterministic user/recipe arbitration and the exact seven-key SQLite schema: coordinator, current attempt, live start/mutation ledgers, projection queue/retry, and replay tombstones. Assert exact values/versions/invariants, empty-key deletion, five-key attempt-bearing residue count, runtime-only socket exclusion, immutable identity, corruption fail-closed behavior, attempt replacement/restart/purge conversion, Env/export, production/QA binding/migration, and preflight checks.
**Output**: `test/workers-runtime/cook-session-do-storage.test.ts`, `test/config/wrangler-durable-objects.test.ts`, `test/scripts/deployment-preflight.test.ts`.
**Acceptance**: Worker/config tests fail because class/bindings/checks are absent.

### ⬜ Unit 9b: Durable Object Binding And Storage Implementation
**What**: Implement the exact versioned storage-key/value schema, validation/residue accounting, start/progress dispatch, and `new_sqlite_classes` production/QA configuration.
**Output**: `workers/cook-session-do.ts`, `workers/app.ts`, `wrangler.json`, `app/cloudflare-env.d.ts`, `scripts/deployment-preflight.ts`.
**Acceptance**: Unit 9a passes; parallel starts serialize; restart persists state; both envs bind/export the class.

### ⬜ Unit 9c: Durable Object Storage Verification
**What**: Run the complete Unit 9a Workers/config suite with coverage, Wrangler source/generated-config validation, typecheck, and build; record evidence only.
**Output**: `unit-9-do-storage.log`.
**Acceptance**: Worker class paths are 100% covered; preflight, typecheck, and build pass.

### ⬜ Unit 10a: Internal Cook HTTP Lifecycle Tests
**What**: Add real Worker red tests for every planning-defined start/get/patch/complete/abandon request and success/error envelope; active resume and pinned access after edit/soft-delete versus new/terminal-to-new SELECT-linearized visibility; current evolved start replay; request ids/messages/exact ledger expiry/Retry-After/Allow/HEAD/unknown; structural versus pinned-semantic validation; accepted ledger; and pairwise compound-fault precedence for route/method, auth, origin, JSON/schema, corrupt projection head, expiry pruning, replay/hash/tombstone, attempt, purge, terminal target/state, semantic target, revision, visibility, capacity, and injected storage failure. Prove corrupt head returns 500 even for replay/conflict/tombstone and that both start/delete-edit race orders follow the snapshot SELECT linearization; verify no OpenAPI/React Router registration.
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
**What**: Add real Workers red tests for same-origin upgrade, 101 retention, snapshots, attachments/restart, and every failure boundary. Assert the purge matrix: pre-fence sockets receive PURGING snapshot then `4001 Session purged` with no error; post-101 fence races receive `session_purging` plus snapshot then 4001; retry closes add no frame. Retain exact replacement 4000, missing 4000, read-only 1003, and internal/initial/broadcast 1011 reasons. Cover send-failure still closing, independent fanout, accepted state, purge fence/alarm, failed silent close retries, 202/residue until no sockets, then 204.
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
**What**: Add real Workers red tests for exact UPSERT/DELETE serialization and enqueue/dequeue validation, ordered create/update/terminal, terminal-old-before-active-new, matching-id replay, greater/lower/equal-different sequence matrix, and every malformed/version/field/id/owner/revision/timestamp/status head remaining queued while every state-changing HTTP path including replay/conflict/tombstone/purge returns 500 and alarm throws without D1. Cover transient D1 failure, persisted 2/4/8/16/32/60 retry, reset, new-attempt retention, and stale-card recovery. Inject setAlarm failure into every transition to prove full rollback/no ledger; inject retry-transaction failure to prove throw/no half state.
**Output**: `test/workers-runtime/cook-session-projection.test.ts`, `test/lib/cook-session-index.server.test.ts`.
**Acceptance**: Tests fail because alarm-backed projection is absent.

### ⬜ Unit 12b: D1 Projection Alarm Implementation
**What**: Implement exact projection union serialization/validation and fail-closed corrupt-head behavior. Persist each transition's state/ledger/revision/queue and immediate alarm atomically; persist retry count/next alarm atomically after D1 failure, throw when that transaction fails, and drain valid FIFO without making D1 canonical.
**Output**: `workers/cook-session-do.ts`, `app/lib/cook-session-index.server.ts`.
**Acceptance**: Unit 12a passes; no transition is accepted without its alarm, accepted DO mutations survive D1 failure/new attempt, and repeated alarms do not duplicate history.

### ⬜ Unit 12c: D1 Projection Verification
**What**: Run the complete Unit 12a Workers/app suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-12-cook-projection.log`.
**Acceptance**: New projection code is 100% covered; no RecipeSpoon/notification integration appears.

### ⬜ Unit 13a: Cook Purge Fence Tests
**What**: Add real Workers red tests for exact DELETE/precedence/residue/PURGING/socket/FIFO behavior; old-terminal/new-attempt/purge; delayed start/progress/terminal replays as correct replaced/purged 410 tombstones with no response content; exact expiry/capacity; newer-attempt isolation; five-key residue accounting; runtime socket exclusion; atomic live-key deletion/conversion; and separate injected failure boundaries. Include corrupt-head purge 500 and a silent socket whose close throws across alarms: PURGING/content/barrier persist and DELETE remains 202 until a later successful close removes it, then and only then commit zero-socket residue and 204.
**Output**: `test/workers-runtime/cook-session-purge.test.ts`, `test/workers-runtime/app-cook-session-http.test.ts`, `test/workers-runtime/app-cook-session-websocket.test.ts`, `test/workers-runtime/cook-session-do-websocket.test.ts`.
**Acceptance**: Tests fail because purge state machine is absent.

### ⬜ Unit 13b: Cook Purge Fence Implementation
**What**: Implement PURGING fence, FIFO barrier, idempotent D1 delete, alarm/event/wake socket-close retries, zero-`getWebSockets()` completion gate, atomic attempt-key deletion, and retained non-content coordinator/replay tombstone.
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
**What**: Add red hook/controller tests for exact canonical local record, pending/InFlight/Command unions/invariants/bounds, atomic localStorage/Web Lock/prefix cleanup, and exact StartFresh chain with preallocated ids. Cover session/local read errors, invalid client/version/fields/invariants, preserved bytes, explicit scoped reset, coalescing and 257th rejection/no eviction. Inject every StartFresh crash/write boundary; same-attempt terminal conflict/GET must advance StartFresh while ordinary terminal behavior clears. Add one-confirmation equal-revision conflict/no-loop tests and the full 4001 matrix with frame/no-frame canonical GET. Retain exact snapshot overlays and one-socket close/watchdog/GET/backoff/offline/status/duplicate tests plus ordinary command/adoption paths.
**Output**: `test/hooks/use-cook-session.test.ts`, `test/routes/recipes-id.test.tsx`.
**Acceptance**: Tests fail because hook/controller is absent.

### ⬜ Unit 15b: Cook Client Reconciliation Implementation
**What**: Implement `useCookSession` with exact canonical record parser/serializer and fail-closed reset/overflow UI, atomic localStorage/prefix cleanup/Web Lock, persisted two-phase StartFresh reducer with its terminal override, one-confirmation protocol guard, 4001 frame/GET state matrix, anonymous AdoptionInput mapping, exact snapshot display gates, and single-generation reconnect controller.
**Output**: `app/hooks/useCookSession.ts`, `app/routes/recipes.$id.tsx`.
**Acceptance**: Unit 15a passes; client time never overrides server; every authenticated mutation is recoverable after an unknown response; anonymous state clears only after successful 200/201 start plus authenticated persistence; queue/command transitions follow the exhaustive persisted disposition table.

### ⬜ Unit 15c: Cook Client Reconciliation Verification
**What**: Run the complete Unit 15a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-15-cook-client-state.log`.
**Acceptance**: New hook code is 100% covered and anonymous regressions pass.

### ⬜ Unit 16a: Recipe Cook Lifecycle UI Tests
**What**: Add red route tests for server state, all adoption outcomes/errors, edit warning, and every persisted StartFresh boundary/reload while showing one disabled transition state. Cover Continue original, complete/abandon/reconnect/terminal/error UI, and pinned inaccessible fallback; only that fallback forbids terminal restart.
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
**What**: Add red loader/render/interaction tests for at most 12 owner active cards ordered updatedAt/attemptId descending; activation GET ACTIVE navigation to exact `/recipes/<recipeId>#cook`; terminal/404 hide/revalidate; exact `session_purging` immediate-alarm rearm, hide, single `Finishing cleanup...` status, and eventual removal; retryable errors retaining Retry; contract errors retaining surfaced explicit Retry; no same-mount reappearance; eventual repair; soft-deleted pinned/no-current cases; and strict visitor absence/query suppression.
**Output**: `test/routes/index.test.tsx`, `test/components/recipe/ContinueCookingList.test.tsx`, `test/components/navigation/mobile-nav.test.tsx`.
**Acceptance**: Tests fail only because owner-only section is absent; dock links remain unchanged.

### ⬜ Unit 17b: Owner-Only Continue Cooking Implementation
**What**: Load D1 active projection only for owner; implement every canonical activation disposition including PURGING status/alarm rearm and retry classes; invalidate non-active cards locally, revalidate, and render the unframed list without dock edits.
**Output**: `app/routes/_index.tsx`, `app/components/recipe/ContinueCookingList.tsx`, `app/lib/cook-session-client.ts`, `workers/cook-session-do.ts`.
**Acceptance**: Unit 17a passes; stale cards cannot navigate/resurface in the same mount, active cards navigate, later D1 loader repairs, and non-owner loader/query contains no private metadata.

### ⬜ Unit 17c: Continue Cooking Verification
**What**: Run the complete Unit 17a app suite plus affected Workers alarm/GET suite with both coverage projects, typecheck, and build; record evidence only.
**Output**: `unit-17-continue-cooking.log`.
**Acceptance**: New code is 100% covered and nav/privacy regressions pass.

### ⬜ Unit 17d: Continue Cooking Visual QA
**What**: Invoke visual QA for owner/non-owner My Kitchen desktop/mobile with empty/active/stale/purging/retry/error states.
**Output**: `visual-kitchen-cooking/` evidence and closed ledgers.
**Acceptance**: No private leakage, overlap, dock churn, or ready visual issue remains.

### ⬜ Unit 18a: SavedRecipe Migration Tests
**What**: Add red tests for composite `(userId, recipeId)` primary key, required cascade foreign keys, createdAt default, `(userId, createdAt, recipeId)` index, explicit hard-delete unsave, soft-delete hide/restore, and exact migration. Backfill must derive owner from Cookbook, exclude deleted recipes, use the minimum matching RecipeInCookbook.createdAt across that owner's memberships, preserve it on rerun/conflict, and never use addedById.
**Output**: `test/models/saved-recipe.test.ts`, `test/scripts/migration-0026-saved-recipes.test.ts`, `test/lib/saved-recipes.server.test.ts`.
**Acceptance**: Tests fail because schema/migration/helper are absent.

### ⬜ Unit 18b: SavedRecipe Migration Implementation
**What**: Add the exact composite-key/default/cascade/index schema and migration plus canonical save/unsave/get/list helpers; implement deterministic minimum-membership-time backfill only in SQL.
**Output**: `prisma/schema.prisma`, `migrations/0026_saved_recipes.sql`, `prisma/migrations/20260715101000_saved_recipes/migration.sql`, `app/lib/saved-recipes.server.ts`.
**Acceptance**: Unit 18a passes; owner/time/cascades are exact; rerun is harmless; unsave only deletes SavedRecipe.

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
**What**: Add red tests for private GET `/api/v1/me/saved-recipes`, session/bearer auth, `recipes:read`, no-store, default-20/max-50 and repeated/blank parameter validation, `(createdAt DESC, recipeId DESC)` pagination, and exact canonical unpadded cursor. Cover alphabet/padding/UTF-8/base64url, byte-exact two-key JSON order, extra/missing/types, canonical ISO round-trip, nonempty recipeId, raw re-encoding equality, null/raw cursor echo and canonical nextCursor, ties, exact `{ limit, cursor, nextCursor, hasMore, recipes }` data, `isSaved: true`, soft-deleted omission, empty/error envelopes, route registry, and OpenAPI.
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
**What**: Add red tests for `/saved-recipes` loader/query/empty states and exact recipe-page POST FormData `saveRecipe|unsaveRecipe` intents. Assert route-id source; inspect every intent before dispatch; exactly one string save intent and no other entry; bodyless 400 for save-first/other-first mixed intents, repeated/extra/File/blank save bodies and missing/blank/unknown general intent; pre-parse cookie-auth 302 to `/login?redirectTo=/recipes/<id>`; exact private no-store/Pragma/Vary 200 JSON; bodyless 404 deleted/missing; already-state idempotency; no client mutation id; disabled non-optimistic fetcher; only matched intent/recipe success updates; route/network/malformed/mismatched/non-200 responses preserve state with exact inline error/Retry; and cookbook independence plus unchanged existing non-save action handling.
**Output**: `test/routes/saved-recipes.test.tsx`, `test/routes/recipes-id.test.tsx`, `test/components/recipe/SaveRecipeButton.test.tsx`.
**Acceptance**: Tests fail because route derives membership and control is absent.

### ⬜ Unit 21b: Saved Controls And Route Implementation
**What**: Use SavedRecipe on `/saved-recipes` and recipe detail; implement the exact strict save-intent branch, generic missing/blank/unknown-intent 400 fallback, response headers/body, and non-optimistic retry UI without changing field handling for existing non-save intents or cookbook controls.
**Output**: `app/routes/saved-recipes.tsx`, `app/routes/recipes.$id.tsx`, `app/components/recipe/SaveRecipeButton.tsx`, `app/components/recipe/SaveToCookbookDropdown.tsx`.
**Acceptance**: Unit 21a passes; save mutation/retry is exact and save/cookbook copy/actions are distinct.

### ⬜ Unit 21c: Saved Controls Verification
**What**: Run the complete Unit 21a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-21-saved-controls.log`.
**Acceptance**: New code is 100% covered and commands pass.

### ⬜ Unit 21d: Saved Controls Visual QA
**What**: Invoke visual QA for recipe detail and `/saved-recipes` desktop/mobile states.
**Output**: `visual-saved-controls/` evidence and closed ledgers.
**Acceptance**: Controls are clear/reachable with no ready visual issue.

### ⬜ Unit 22a: Saved Search Privacy Tests
**What**: Add red tests for a dedicated viewer-scoped SQL intersection before ordering, query/empty states, anonymous/cross-user isolation, and absence of save metadata/duplicate docs in global SearchDocument. Prove blank-query complete ordering by saved createdAt/recipeId; FTS ordering by rank/title/recipeId; no web limit/pagination; and completeness with more than 50 matching saves so post-limit filtering cannot pass.
**Output**: `test/lib/search.server.test.ts`, `test/routes/saved-recipes.test.tsx`, `test/routes/search.test.tsx`.
**Acceptance**: Tests fail because viewer-scoped saved search is absent.

### ⬜ Unit 22b: Saved Search Privacy Implementation
**What**: Implement the dedicated all-results SavedRecipe/SearchDocument SQL path that intersects active saved ids before blank/FTS ordering; use it from `/saved-recipes` without indexing private state or reusing the global 50-result limit.
**Output**: `app/lib/search.server.ts`, `app/routes/saved-recipes.tsx`.
**Acceptance**: Unit 22a passes; the full viewer result set and ordering are deterministic, while global metadata has no private save state or duplicate recipe results.

### ⬜ Unit 22c: Saved Search Verification
**What**: Run the complete Unit 22a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-22-saved-search.log`.
**Acceptance**: New code is 100% covered and search regressions pass.

### ⬜ Unit 23a: Owner-Only Saved Kitchen Tests
**What**: Add red tests for owner saved section limited to 12 active saves ordered createdAt/recipeId descending with `/saved-recipes` link, plus strict loader/query/render absence for authenticated and anonymous visitors.
**Output**: `test/routes/index.test.tsx`.
**Acceptance**: Tests fail because owner section is absent.

### ⬜ Unit 23b: Owner-Only Saved Kitchen Implementation
**What**: Load/render the exact limited/ordered SavedRecipe section and all-saves link only when viewer owns the kitchen; do not edit dock.
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
**What**: Add red tests for exact RecipeTag id default/PK, every NOT NULL, timestamp defaults/update, Recipe/User cascade FKs, kind/source CHECKs, unique normalized identity, three supporting indexes, soft-delete preservation/hiding, and both parent hard-deletes. Cover owner/MANUAL/course, Unicode/NFKC/casing/bounds/reserved, explicit SQL BINARY and JavaScript scalar-value normalizedLabel/id ordering with non-ASCII fixtures/no localeCompare, partial COURSE index, ten-tag trigger, parent-updatedAt triggers, singleton search lease seed/rerun, every race commit order, exact 400 versus 409 tag_conflict, and no partial write.
**Output**: `test/models/recipe-tag.test.ts`, `test/lib/recipe-tags.server.test.ts`, `test/scripts/migration-0027-recipe-tags.test.ts`.
**Acceptance**: Tests fail because tag schema/service/migration are absent.

### ⬜ Unit 24b: RecipeTag Migration And Service Implementation
**What**: Add the exact RecipeTag Prisma/SQL schema, constraints/cascades/indexes/timestamps, explicit canonical collation/comparator, partial COURSE uniqueness, custom-count and parent-updatedAt triggers, immutable singleton SearchRebuildLease DDL/seed, and owner-only declarative helpers for existing-recipe mutations. Map trigger races exactly; leave new-recipe nested creation to Unit 25; add no AI state.
**Output**: `prisma/schema.prisma`, `migrations/0027_recipe_tags.sql`, `prisma/migrations/20260715102000_recipe_tags/migration.sql`, `app/lib/recipe-tags.server.ts`.
**Acceptance**: Unit 24a passes; database constraints preserve one course/ten customs and parent freshness under both race orders; normalization is deterministic; source is MANUAL.

### ⬜ Unit 24c: RecipeTag Data Verification
**What**: Run the complete Unit 24a suite with coverage, Prisma generation, local migrations/rerun, typecheck, and build; record evidence only.
**Output**: `unit-24-tags-data.log`.
**Acceptance**: New service is 100% covered and commands pass.

### ⬜ Unit 25a: Tag Authoring Tests
**What**: Add red tests for exactly one `course` plus repeated `customTag` FormData, missing/repeated/blank/invalid handling, first-occurrence normalization and canonical non-ASCII scalar-value ordering, new-recipe nested atomicity as the explicit declarative-SQL exception, owner auth, submitted-value 400 and tag-conflict 409 display, and no AI wording. For existing-recipe edit, force execution-time current-state full replacement: delete absent rows first, conflict-ignore every desired normalized insert to retain then-current casing, then update recipe; inject rollback at every statement and both commit orders against concurrent delta/course/delete-readd writes.
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
**What**: Add red tests for canonically BINARY/scalar-ordered non-ASCII tags in fingerprints/documents and lazy rebuild plus exact singleton CAS. Capture one guardNowMs and force live time across expiry before every delete/insert-batch/metadata boundary; all statements must use the fixed predicate and commit a complete index or all no-op, never partial. Prove post-commit fresh-time expiry returns error/no query but leaves completeness. Retain authenticated/anonymous stale-complete reads, initial-index 25..1600 waits, 60-second recovery, three rebuild/postcheck cycles, statement/lease/release/crash boundaries, and old-or-new-only observations; direct REST projections remain immediate separately.
**Output**: `test/lib/search.server.test.ts`, `test/lib/recipe-tags.server.test.ts`.
**Acceptance**: The exact two-file Vitest run fails because tag indexing is absent.

### ⬜ Unit 27.1b: Tag Search Index Implementation
**What**: Include tags/fingerprint without synchronous rebuild; use existing lease, structural freshness split, stale-complete reads, and a fixed-clock same-predicate serialized replacement transaction. Implement fresh-time postcheck, initial wait/recheck, bounded rebuild, release, and no-query failure policy.
**Output**: `app/lib/search.server.ts`, `app/lib/recipe-tags.server.ts`.
**Acceptance**: Unit 27.1a passes; migrations remain immutable, every race observes a complete index, saved privacy remains intact, and only canonical accepted tags are indexed.

### ⬜ Unit 27.1c: Tag Search Index Verification
**What**: Run search/tag coverage, typecheck, and build without adding behavior.
**Output**: `unit-27.1-tags-index.log`.
**Acceptance**: New index/reindex code is 100% covered and commands pass.

### ⬜ Unit 27.2a: Tag REST Projection Tests
**What**: Add red tests for lowercase singular course, custom-only tags preserving display casing and canonical BINARY/scalar normalizedLabel/id order with non-ASCII cases, anonymous/authenticated list/detail/search/native-sync/cookbook propagation, OpenAPI/contract/generator/playground/docs, and no AI contract.
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
**What**: Add red tests for parser/AND semantics plus exact GET controls on My Recipes, owner My Kitchen, and Search. Assert All/four course options; canonical non-ASCII checkbox options sourced from visible active scope before filters, grouped lowest-BINARY-id casing and scalar-value sorted; explicit Apply/no autosubmit; max-ten disabling and server 400; q/scope/unrelated repeated-param preservation; replace/remove/clear URL semantics; filters under nonrecipe Search scope yielding no matches; empty/unfiltered order/privacy. Use more than the current 30-result web limit with higher-ranked nonmatches to prove course/tag intersection occurs before BM25 ordering/limit.
**Output**: `test/lib/recipe-tag-filter.test.ts`, `test/routes/my-recipes.test.tsx`, `test/routes/index.test.tsx`, `test/routes/search.test.tsx`, `test/components/recipe/RecipeTagFilters.test.tsx`, `test/components/pantry/RecipeGrid.test.tsx`.
**Acceptance**: Tests fail because filters are absent.

### ⬜ Unit 28b: Tag Discovery Filter Implementation
**What**: Add shared parser/query/option builder and exact GET filter component to all three discovery surfaces without dock edits.
**Output**: `app/lib/recipe-tag-filter.ts`, `app/components/recipe/RecipeTagFilters.tsx`, `app/routes/my-recipes.tsx`, `app/routes/_index.tsx`, `app/routes/search.tsx`, `app/components/pantry/RecipeGrid.tsx`.
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
**What**: Add red script tests for exactly attempts A/B. A's start helper observes accepted 201 headers but deliberately discards body/id; residue then GET must rediscover A before both clients synchronize and complete it. B synchronizes and abandons; cleanup purges B, permits A terminal history pre-delete, then proves all rows gone. The malformed decoder is injected against A only in unit tests and never creates C. Cover stop-immediately-after-discard cleanup, edit warning, owner-only residue, identities, and artifacts.
**Output**: `test/scripts/smoke-live-cook-session.test.ts`.
**Acceptance**: Tests fail because lifecycle smoke is absent.

### ⬜ Unit 30b: Two-Client Smoke Implementation
**What**: Extend smoke with the exact discarded-A-response rediscovery, two-attempt/two-context lifecycle, terminal-history evidence, and no-third-attempt guard.
**Output**: `scripts/smoke-live.mjs`, `scripts/smoke-live-helpers.mjs`.
**Acceptance**: Unit 30a passes; successful and failed synchronization produce useful artifacts, and an accepted start with no usable response remains discoverable for cleanup.

### ⬜ Unit 30c: Two-Client Smoke Verification
**What**: Run the complete Unit 30a script suite with coverage and script typecheck; record evidence only.
**Output**: `unit-30-smoke-sync.log`.
**Acceptance**: New lifecycle smoke logic is 100% covered and commands pass.

### ⬜ Unit 31a: Smoke Purge And Cleanup Tests
**What**: Add red fake-clock tests for primary and exact recovery traces with independent 20-request/90-second cook budgets. Cover user-exists branching; prior-204 + null/zero residue + lastPurged idempotent DELETE consuming one request then final residue; null/zero with no prior 204 skipping DELETE; user absent after accepted/unknown delete making zero owner requests and retrying retained-preproof/user/D1 proof only. Retain discovery/status/socket/deadline/backoff/stale/fatal, pre/post-delete D1 history, result flags, tombstones, and artifact coverage.
**Output**: `test/scripts/smoke-live-cleanup.test.ts`, `test/scripts/smoke-live-helpers.test.ts`.
**Acceptance**: Tests fail because cleanup reliability is absent.

### ⬜ Unit 31b: Smoke Purge And Cleanup Implementation
**What**: Implement the phase-recording primary pass and one exact user-existence-aware recovery trace, including idempotent prior-204 confirmation, post-user-delete proof-only recovery, separate cook budgets, retained pre-delete evidence, and exact cleanup flags. Preserve all discovery/socket/D1/history/tombstone rules.
**Output**: `scripts/smoke-live.mjs`, `scripts/smoke-live-helpers.mjs`.
**Acceptance**: Unit 31a passes; functional smoke failure still cleans; recoverable cleanup failure gets one bounded clean recovery; irrecoverable cleanup is never reported clean and blocks ship until a later rerun proves zero content/residue.

### ⬜ Unit 31c: Smoke Cleanup Verification
**What**: Run the complete Unit 31a script suite with coverage, script typecheck, and local dry-run residue inspection; record evidence only.
**Output**: `unit-31-smoke-cleanup.log`.
**Acceptance**: New cleanup logic is 100% covered and `pnpm cleanup:qa` reports no disposable local data.

### ⬜ Unit 32: Final Local Validation
**What**: Before freezing, require exact external task `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/task.md` and artifact root `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/` to exist and match this task/branch. Freeze all in-repo task docs/artifacts, then mirror continuity only there. From a clean branch HEAD, run and capture exactly: `pnpm cleanup:qa`; `pnpm prisma:generate`; `pnpm exec wrangler d1 migrations apply DB --local` twice; `pnpm run api:playground:generate`; `git diff --exit-code -- app/lib/generated/api-v1-playground.ts`; `pnpm run typecheck`; `pnpm run typecheck:scripts`; `pnpm test:workers:coverage`; `pnpm test:coverage`; `pnpm test:e2e`; `pnpm build`; `git diff --check`; `git status --short`. Then run fresh implementation, test, security/privacy, and migration/config reviewers against that exact HEAD.
**Output**: `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/unit-32-local-validation.md` plus raw logs; do not change tracked branch files after the gate.
**Acceptance**: Every command exits zero with zero warnings and 100% new-code coverage; local migrations are rerunnable; generated output is clean; every actionable reviewer finding is fixed and the full command/review gate rerun on the resulting HEAD; git/local disposable residue is clean.

### ⬜ Unit 33: QA Deploy And Cross-Device Gate
**What**: Record `HEAD=$(git rev-parse HEAD)` and `pnpm exec wrangler deployments list --env qa --json` before deploy; run `pnpm cleanup:remote:qa`, `pnpm run qa:preflight`, `pnpm deploy:qa`, and the same deployment-list command after, preserving all new ids/output. Use the tested attestation helper to poll cache-busted QA `/health` every 5s for max 180s until body and `X-Spoonjoy-Build-Sha` both equal HEAD; timeout/wrong mismatch fails before smoke. Then run QA web/API/two-client smoke. Require zero `/residue`, purged-current/no-active D1 proof before disposable-user deletion, and all-user D1 zero after cascade. In `finally` run exact cleanup and post `pnpm cleanup:remote:qa`.
**Output**: `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/unit-33-qa.md`, deploy version/URL, smoke screenshots/logs, cleanup and DO/D1 residue logs; no tracked branch edit.
**Acceptance**: QA deploy/smokes exit zero for the exact recorded branch HEAD SHA before PR merge, including primary cleanup without recovery; DO/current-row/pre-delete and all-history/post-delete D1 oracles pass; no disposable data remains.

### ⬜ Unit 34: PR Creation And Fresh Review
**What**: Invoke `work-merger`; `git fetch origin main`; integrate the exact current `origin/main`; record `TESTED_BASE_SHA=$(git rev-parse origin/main)` and require it is an ancestor of HEAD; rerun affected conflict tests; and push. Any HEAD change for any reason, including that integration, a history-only rewrite, or tracked evidence, invalidates the prior exact-SHA gate and requires Units 32-33 on the new HEAD. After a successful Unit 33, do not amend, rebase, merge, or commit. Open a ready PR and run newly spawned implementation, design/visual, test/coverage, security/privacy, migration/DO, and API-compatibility reviewers against that PR head. A reviewer fix changes HEAD and loops through Units 32-33 plus all PR reviews again while preserving/updating the tested base as applicable.
**Output**: PR URL and `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/unit-34-pr-review.md`.
**Acceptance**: PR head exactly equals the last Unit 33 SHA; `TESTED_BASE_SHA` is recorded and contained in that head; no post-QA rewrite/commit exists; every actionable review finding is fixed and the resulting head has rerun Units 32-33/reviews.

### ⬜ Unit 35: CI Convergence
**What**: Run `gh pr checks "$PR" --watch` and require workflow `CI` jobs/checks `coverage`, `workers-coverage`, and `e2e` on the exact PR head. Diagnose/fix any failure and rerun reviewers for repairs. Any repair or other HEAD change reopens and reruns Units 32-33 plus all PR reviews, then refreshes CI for the new head.
**Output**: Green check URLs and `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/unit-35-ci.md`.
**Acceptance**: Every required check is green for current head SHA with no unresolved review comment.

### ⬜ Unit 36: Merge
**What**: Immediately before merge run `git fetch origin main`; require `git rev-parse origin/main == $TESTED_BASE_SHA`, require that base is an ancestor of the PR head, and require `gh pr view "$PR" --json headRefOid,mergeStateStatus,reviewDecision,statusCheckRollup` reports the Unit 33 head, clean merge state, and green checks/reviews. If main advanced or merge state is not clean, integrate latest main and rerun Units 32-35. Recheck cache-busted QA `/health` body/header equals that head, merge through `work-merger`, then record `gh pr view "$PR" --json state,mergedAt,mergeCommit` without manual production deployment.
**Output**: Merge evidence and `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/unit-36-merge.md`.
**Acceptance**: Current PR head equals the latest Unit 33 SHA, current origin/main equals tested base, merge state is clean, and every check/review is green; the resulting tested tree is merged and exact merge SHA recorded.

### ⬜ Unit 37: Production Deploy, Smoke, Cleanup, And Handoff
**What**: Before the first workflow-discovery poll, capture production `pnpm exec wrangler deployments list --json` as the immutable before set. Poll `gh run list --workflow "Production Deploy" --commit "$MERGE_SHA" --limit 20 --json databaseId,headSha,status,conclusion,url,createdAt,event` every 10s for max 5m until an exact-head candidate exists; retain all candidates, choose newest non-cancelled by `createdAt` then `databaseId`, and poll `gh run view "$RUN_ID" --json headSha,status,conclusion,jobs,url` for at most 30m. Require exact head, workflow success, and job named `deploy` success. Immediately capture the after deployment list and select the newest deployment id absent from the before set. Poll cache-busted canonical `/health` to exact merge SHA, then run readiness and production web/API/two-client smoke. Require owner residue zero, purged-current/no-active D1 proof before user deletion, all-user D1 zero after cascade, and exact cleanup. Run continuation scan, close Desk/git/worktree, and notify Slugger.
**Output**: `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/unit-37-production.md`, workflow/version URLs, `https://spoonjoy.app` evidence, cleanup/continuation logs, and `ouro msg --to slugger "Done: shipped Clem feedback end to end"` result.
**Acceptance**: Exact SHA is live; all smokes pass; no disposable data or ready in-scope follow-up remains; git/Desk terminal and clean; Slugger notified.

## Execution
- Tests -> confirmed red -> implementation -> green -> refactor for every a/b/c group.
- Commit/push each intentional-red `a` checkpoint and green `b` checkpoint; keep `c` verification-only, then update group emojis/progress and run a newly spawned, context-independent group reviewer after every a/b/c group (Units 1-28, 29.1, and 30-31). "Fresh" means a new sub-agent given only the approved planning/doing docs, current diff/commits, and test evidence. Every actionable finding is fixed with a new red/green cycle and re-reviewed; no severity is silently waived.
- Every `d` unit runs `visual-qa-dogfood` plus a newly spawned visual reviewer after fixes. Units 29, 32, and 34 are their own explicit audit/review gates; Units 0 and 33-37 use their named acceptance gates rather than the group-review rule.
- Store every command/log/screenshot in the artifact directory.
- Before Unit 32, commit/push the final in-repo doing/progress/AUTOPILOT state and verify/adopt exact external task `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/task.md`; Units 32-37 write operational evidence only under its `artifacts/` root plus GitHub/Cloudflare surfaces. They must not create an unvalidated branch HEAD. Any later tracked change invalidates the gate and loops through Units 32-33.
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
- 2026-07-15 Ambiguity Round 9 fixed purge socket drainage, per-tab local queues, complete-index rebuild availability, two-attempt smoke cleanup, adoption outcomes, new shopping rows, exact SavedRecipe DDL/backfill, complete saved search, immutable migration sequencing, and recovery discovery.
- 2026-07-15 Ambiguity Round 10 fixed post-delete recovery traces, atomic localStorage/prefix cleanup, WebSocket reconnect, exact RecipeTag DDL, faulted-attempt smoke placement, projection payloads/corruption, PURGING cards, same-attempt persistence rendering, and server-won adoption validation.
- 2026-07-15 Ambiguity Round 11 fixed the adoption wire/hash, legal recipe snapshot integers, crash-safe Start Fresh chain, tombstone affordances, transaction-wide search lease time, web save mutation, tag filter controls, and exact purge close reason; the latest-model self-audit then made save-action handling and adoption replay hashing fully state-independent.
- 2026-07-15 Ambiguity Round 12 fixed 24 findings spanning structural/semantic/corruption precedence, exact DO and browser persistence schemas, ledger expiry, snapshot conflicts, Start Fresh and purge sockets, D1 start races, projection sequence conflicts, scaling lexemes, tag collation/search limits, saved cursors/actions/cards, merge-base drift, deployment evidence timing, Desk ownership, and shopping allocator gaps.
