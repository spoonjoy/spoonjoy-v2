# Doing: Clem Feedback E2E

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-07-14 13:26
**Planning**: ./2026-07-14-1313-planning-clem-feedback-e2e.md
**Artifacts**: ./2026-07-14-1313-doing-clem-feedback-e2e/

## Execution Mode

- **pending**: Explicit human approval before each unit; not selected.
- **spawn**: Use a sub-agent for an isolated unit.
- **direct**: Execute sequentially in this session; selected. The explicit reviewer matrix in `Execution` applies.

## Objective
Ship every accepted Clem feedback item end to end: correct shopping restoration, authenticated cross-device cook continuity, private saves, accepted manual tags, and backward-compatible API metadata. Preserve agentic-only import, current navigation, and neutral non-Pebble boundaries.

## Upstream Work Items
- `./2026-07-14-1313-clem-feedback-source.md` is the durable source-of-truth and item-by-item disposition.

## Completion Criteria
- [ ] Every feedback-source row has shipped proof or an explicit rejected disposition.
- [ ] Shopping behavior matches the matrix across web, REST v1, and MCP under repeated/concurrent calls.
- [ ] Authenticated cook state is DO-canonical, operation-revisioned, cross-device, owner-private, edit-safe, and purgeable; anonymous state stays local-only.
- [ ] SavedRecipe is private canonical save state with safe backfill, every writer bridge, viewer-scoped search, UI, and REST endpoints.
- [ ] Manual course/custom tags author, display, filter, search, and project through REST; no AI suggestion surface exists.
- [ ] REST v1, OpenAPI, contract registry, generator, playground, native-sync, cookbook, search, and write suites pass compatibly.
- [ ] Current mobile navigation remains stable and changed UI passes desktop/mobile visual QA.
- [ ] QA deploy plus two-client smoke/cleanup pass before merge.
- [ ] The exact merge SHA's successful CI `push` triggers the selected production `workflow_run`; its promoted canary artifact attests the exact source/tree/Worker version before readiness, web/API/two-client smoke, and cleanup pass.
- [ ] All tests/builds pass with zero warnings and 100% coverage on every new code path, including `workers/**` and the exact closed task-owned executable-script set.
- [ ] Cleanup evidence reports relational/content-bearing state zero and exact retained identifier-bearing DO metadata as separate truths; it never calls retained metadata product-data zero or erased.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No coverage exclusions on new code.
- Cover every branch, auth/error response, null/empty input, numeric boundary, retry, conflict, race, and cleanup path.
- `workers/**` uses the real Cloudflare Workers Vitest project; app code uses the existing project.
- Focused script tests import and measure every touched executable; Unit30 preserves the exact eleven-script pre-visual subset and Unit31 adds the tested production visual runner as the twelfth member, without removing inherited entries such as `scripts/advisory-scan.ts`. Unit31 then runs full 100% coverage over the resulting superset before release convergence. Excluded config files contain declarative wiring only; branch-bearing build-SHA logic lives in measured `scripts/vite-build-sha.ts`.
- Unit29.2 creates and measures pure non-executable `scripts/release-artifact-contract.mjs`; full-suite coverage and script typecheck include it additively without counting it as a thirteenth executable.

## TDD Requirements
1. In each `a` unit, write every behavioral/error/coverage test named by the group, capture the expected red command/output, then commit and push that intentional-red test checkpoint.
2. In the matching `b` unit, implement without changing the `a` tests, run green plus build/typecheck, then commit and push the green implementation checkpoint.
3. The matching `c` unit is verification-only: run coverage/refactor/build commands and record evidence; do not add behavioral tests or implementation. If `c` finds a gap, reopen `a` with a new failing test, repeat `b`, then rerun `c`.
4. A group is complete only after `c` passes; update all three emojis/progress entries and run a fresh group review. Commit/push docs and verification artifacts according to Work Doer.

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

### ⬜ Unit 0a: Cleanup Assert Oracle Tests
**What**: Before dependency setup or red tests, verify the final planner handoff already committed/pushed doing status `READY_FOR_EXECUTION`, task `planning_complete:true`, task/track `processing`, the active Desk iteration path and exact reviewed checkpoint/gate; Unit0 must not perform any lifecycle transition. Require active-iteration `feedback-source.md`, `planning.md`, `doing.md`, and `continuity.md` are byte-equal by `diff -q` to exact task-local repository source/planning/doing paths and `./2026-07-14-1313-doing-clem-feedback-e2e/AUTOPILOT-STATE.md`; explicitly reject repository-root `AUTOPILOT-STATE.md` as another task's state. Mismatch blocks until both repos are synchronized, committed, and pushed. Fetch `origin/main` without pull and require it is already an ancestor of HEAD; otherwise perform no red test or implementation and follow planning's merge/re-audit/full-review/restart gate. Perform dependency-only setup exactly `pnpm install --frozen-lockfile`; `pnpm prisma:generate`; require no tracked diff. Add red tests proving unknown arguments and `--assert-clean --apply` fail before commands, while exact mutually exclusive `--assert-clean` local/QA/production execution never mutates and accepts only one complete exact `{item,count}` row set with every count a safe nonnegative zero. Cover positive, negative, unsafe, missing, duplicate, malformed, extra, command-error, stdout/stderr, exit-code, D1, and R2 branches; prove plain dry-run remains inspection-only and cannot satisfy the strict result type.
**Output**: `test/scripts/cleanup-local-qa-data.test.ts`.
**Acceptance**: Exact `pnpm exec vitest run test/scripts/cleanup-local-qa-data.test.ts` fails only because strict argument rejection and the nonmutating zero-residue oracle do not exist.

### ⬜ Unit 0b: Cleanup Assert Oracle Implementation
**What**: Implement the planning-defined strict parser/unknown-argument rejection, `--assert-clean`/`--apply` mutual exclusion, exact row-set validator, nonmutating target execution, and exit semantics in the existing cleanup script. Do not change Unit0a tests or add release orchestration.
**Output**: `scripts/cleanup-local-qa-data.mjs`.
**Acceptance**: Unit0a passes with zero warnings; every invalid or nonzero oracle exits nonzero without mutation and every complete all-zero oracle exits zero.

### ⬜ Unit 0c: Reliability And Baseline Inventory
**What**: Verify the already-processing Desk task/track exact values. Complete baseline setup exactly `DATABASE_URL="file:./test.db?connection_limit=1&socket_timeout=60" pnpm prisma:push`; `pnpm exec wrangler d1 migrations apply DB --local`; `pnpm cleanup:qa -- --assert-clean`; require no tracked diff. Then capture git/tool/auth/whoami, migration list, latest production workflow/job/artifact status including open canary issue state, `pnpm run typecheck`, `pnpm run build`, exact `pnpm exec vitest run test/routes/shopping-list-route.test.ts test/routes/api-v1-shopping-mutations.test.ts test/lib/mcp/spoonjoy-tools.server.test.ts test/routes/recipes-id.test.tsx test/routes/index.test.tsx test/routes/my-recipes.test.tsx test/routes/my-recipes-query-boundary.test.ts test/lib/my-recipes-search.server.test.ts test/lib/search.server.test.ts test/routes/api-v1-recipes.test.ts test/components/navigation/mobile-nav.test.tsx test/lib/apple-oauth.server.test.ts test/lib/env.server.test.ts test/lib/oauth-route.server.test.ts test/routes/auth-apple.test.ts test/routes/redwood-functions-auth-oauth.test.ts test/lib/recipe-cover-service-architecture.test.ts test/lib/recipe-cover-service.server.test.ts test/scripts/advisory-scan.test.ts test/release-workflow-security.test.ts`, and exact `pnpm exec playwright test e2e/home-hero-viewport.spec.ts`. Verify QA/production target safety; record the integrated main canary mismatch as the Unit29.1 release blocker without performing a production mutation.
**Output**: `./2026-07-14-1313-doing-clem-feedback-e2e/unit-0-research.md` plus command logs.
**Acceptance**: Artifact records `0023_recipe_cover_prompt_lineage.sql` as current plus exact cleanup/deploy/smoke commands and the latest production canary failure evidence, and every named local baseline command is green with no disposable residue. Shared cover-service architecture and advisory script/workflow gates are explicitly green. The known canary failure is routed to Unit29.1; any other pre-existing failure does not permit execution to continue: reproduce it on untouched `origin/main`, open a focused red/fix/green sub-unit on this branch, and rerun Unit0c until green.

### ⬜ Unit 1a: Shopping Mutation Matrix Tests
**What**: Add red tests for the complete planning row-state matrix: unchecked->checked moves to a fresh end slot with one accepted timestamp; checked->unchecked preserves sort; same-state/delete/clear no-ops do not change version/time; delete preserves content/check/order while setting deletedAt; clear-completed/all affect only eligible rows. Prove empty add and missing-list set/delete/clear do not bootstrap, while only a validated nonempty content-producing add uses concurrent `ON CONFLICT(authorId)` bootstrap. Cover exact web/REST/MCP category/icon omission/null/empty/File/repeated/unknown mappings and quantity overflow. Cover migration's checked/checkedAt legacy repair, duplicate winner order `(deletedAt,sortIndex,updatedAt,id)`, summed content, partial null-unit unique index, finite-sum and `0..2_147_483_646` sort validation with atomic rollback, changed-row/list timestamping, version-first races, lease no-op, 32-bit version/range exhaustion, legal `2_147_483_646` final allocation and `2_147_483_647` exhausted sentinel, every writer, commit order, fixed retry/exhaustion, IngredientRef/Unit creation outside user-list atomicity, and migration rerun.
**Output**: `test/lib/shopping-list-mutations.server.test.ts`, `test/routes/shopping-list-route.test.ts`, `test/routes/api-v1-shopping-mutations.test.ts`, `test/routes/api-v1-shopping-d1.test.ts`, `test/lib/mcp/spoonjoy-tools.server.test.ts`, `test/scripts/migration-0024-shopping-list-mutation-coordination.test.ts`.
**Acceptance**: The targeted Vitest command fails only on the missing shared semantics.

### ⬜ Unit 1b: Shopping Mutation Matrix Implementation
**What**: Implement the exact migration repair/partial null-unit uniqueness, idempotent `ON CONFLICT(authorId)` list bootstrap, version/lease/index fields, full transition matrix, monotonic acceptedAt timestamp, exhausted sentinel, guarded content-changing batch, finite/32-bit checks, fixed retry, busy/capacity errors, and non-compacting allocator in the shared helper. Keep IngredientRef/Unit canonical get-or-create outside list atomicity, then route every web/v1/MCP/recipe writer through the helper; add exact write_conflict/capacity mappings and docs.
**Output**: `prisma/schema.prisma`, `migrations/0024_shopping_list_mutation_coordination.sql`, `prisma/migrations/20260715095500_shopping_list_mutation_coordination/migration.sql`, `app/lib/shopping-list-mutations.server.ts`, `app/lib/shopping-list.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/api-v1-contract.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`.
**Acceptance**: Unit 1a tests and OpenAPI/generator tests pass; every content-changing mutation increments once, no-op mutations increment never, every allocated legal index is unique/monotonic, `2_147_483_647` is never stored as an item index, and no duplicate add/restore or compaction path remains.

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
**Acceptance**: Unit 2a passes; `pnpm test:workers` includes exactly `test/workers-runtime/**/*.test.ts`; normal Vitest excludes exactly `test/workers-runtime/**` and retains existing Node-mocked `test/workers/app.test.ts`; `pnpm test:workers:coverage` enforces 100%; CI adds mandatory job/check `workers-coverage`, which Unit35 gates in addition to every live branch-protection context.

### ⬜ Unit 2c: Workers Harness Verification
**What**: Run Workers/app coverage, CI-config tests, typecheck, and build.
**Output**: `unit-2-workers-harness.log`.
**Acceptance**: All commands pass with zero warnings.

### ⬜ Unit 3a: REST And MCP Base Metadata Tests
**What**: Add red tests for stepCount as RecipeStep row count independent of numbering and sourceDisplayName derived only from existing WHATWG sourceHost, covering the planning table for null/absolute/whitespace/credentials/port/case/one-www/trailing-dot/punycode/IPv4/bracketed-IPv6/malformed-surrogate. Require byte-equivalent neutral values across REST v1 summary/detail/search/native-sync/cookbook consumers and MCP `search_recipes`/`get_recipe`; prove the two transports call one shared helper, preserve legacy fields/scopes, expose no MCP `isSaved`, and keep every unrelated MCP tool schema stable.
**Output**: `test/lib/recipe-api-metadata.server.test.ts`, `test/routes/api-v1-recipes.test.ts`, `test/routes/api-v1-search.test.ts`, `test/routes/api-v1-native-sync.test.ts`, `test/routes/api-v1-recipe-writes.test.ts`, `test/routes/api-v1-cookbooks.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/scripts/generate-api-playground.test.ts`, `test/routes/developers-playground.test.tsx`, `test/lib/spoonjoy-api-spoons.test.ts`, `test/lib/mcp/spoonjoy-tools.server.test.ts`, `test/routes/mcp.test.ts`, `test/routes/mcp-page.test.tsx`.
**Acceptance**: Named tests fail only on missing shared REST/MCP base metadata.

### ⬜ Unit 3b: REST And MCP Base Metadata Implementation
**What**: Implement `stepCount` and `sourceDisplayName` once in the transport-neutral helper, use it from REST builders and MCP `search_recipes`/`get_recipe`, and preserve `sourceHost`, `servings`, scopes, tool names, and all existing field types.
**Output**: `app/lib/recipe-api-metadata.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/mcp/spoonjoy-tools.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/lib/api-v1-contract.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.playground.tsx`, `app/routes/developers.tsx`, `app/routes/mcp.tsx`, `docs/api.md`.
**Acceptance**: Unit 3a passes; malformed host yields null, REST/MCP values agree, MCP omits private save state, and shared response consumers remain compatible.

### ⬜ Unit 3c: REST And MCP Base Metadata Verification
**What**: Run the complete Unit 3a suite with coverage, generator idempotency, typecheck, and build; record evidence only.
**Output**: `unit-3-api-metadata.log`.
**Acceptance**: Helper coverage is 100%; targeted cross-contract suite, typecheck, and build pass.

### ⬜ Unit 4a: REST And MCP Scaling Projection Tests
**What**: Add red tests for omitted factor defaulting to returned `scaleFactor: 1` with always-present rounded `scaledQuantity`, REST's exactly one supplied unsigned-decimal query value, MCP `get_recipe`'s optional JSON number and schema, parsed-Number range `0.25..50`, invalid/multiple/nonfinite/direct-call forms, required numeric quantities, shortest-decimal/scientific expansion, exact base-10 multiplication from the parsed factor's ECMAScript shortest round-trip value rather than raw lexeme (including REST `0.25000000000000001 -> 0.25`), below/at/above half ties away from zero, trailing-zero JSON numbers, negative zero, Number.MAX_VALUE boundary and `1e308*50` overflow using each surface's exact error/no-null contract, immutable recipe data, unchanged REST list/search and MCP `search_recipes`, and byte-equivalent REST/MCP detail quantities for the same accepted Number. Source assertions require both transports to call one shared helper and reject duplicate scaling math.
**Output**: `test/lib/recipe-api-scaling.server.test.ts`, `test/routes/api-v1-recipes.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/scripts/generate-api-playground.test.ts`, `test/routes/developers-playground.test.tsx`, `test/lib/spoonjoy-api-spoons.test.ts`, `test/lib/mcp/spoonjoy-tools.server.test.ts`, `test/routes/mcp.test.ts`, `test/routes/mcp-page.test.tsx`.
**Acceptance**: Named tests fail only on absent shared REST/MCP scaling projection/validation.

### ⬜ Unit 4b: REST And MCP Scaling Projection Implementation
**What**: Add detail-only `scaleFactor` and `scaledQuantity` through one transport-neutral exact-decimal helper; wire REST detail query parsing and MCP `get_recipe` JSON-number parsing/tool metadata to it while preserving original `quantity`/`servings`, leaving both search surfaces unchanged, and performing no writes.
**Output**: `app/lib/recipe-api-scaling.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/mcp/spoonjoy-tools.server.ts`, `app/lib/api-v1-openapi.server.ts`, `app/lib/api-v1-contract.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.playground.tsx`, `app/routes/developers.tsx`, `app/routes/mcp.tsx`, `docs/api.md`.
**Acceptance**: Unit 4a passes; REST invalid input uses existing `validation_error`, MCP uses the planning-defined exact errors, shared results agree, and stored quantities remain unchanged.

### ⬜ Unit 4c: REST And MCP Scaling Verification
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
**What**: Add red pure tests for exact snapshots including legal zero/negative source integers, unsafe rejection, sorted active index, checked identities/order, scalar/null/status/timestamps, exact UUID/hash, and every pinned edit. Cover exact canonical UTF-8 byte measurement, recipe snapshot `262_144` byte boundary, response/frame `1_000_000` byte boundary helpers, server Date ceiling, and revision `0..2_147_483_646`/purge projection `2_147_483_647` numeric boundaries.
**Output**: `test/lib/cook-recipe-snapshot.test.ts`, `test/lib/cook-session-size.test.ts`.
**Acceptance**: The exact two-file run fails because snapshot and size modules are absent.

### ⬜ Unit 6b: Recipe Snapshot And Fingerprint Implementation
**What**: Implement shared snapshot types plus server builder without browser/server import leakage.
**Output**: `app/lib/cook-session-types.ts`, `app/lib/cook-session-size.ts`, `app/lib/cook-recipe-snapshot.ts`, `app/lib/cook-recipe-snapshot.server.ts`, `app/lib/recipe-detail.server.ts`.
**Acceptance**: Unit 6a passes; canonical fingerprint is stable and changes for every pinned content/quantity/unit/stable-id edit.

### ⬜ Unit 6c: Recipe Snapshot Verification
**What**: Run the complete Unit 6a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-6-cook-snapshot.log`.
**Acceptance**: New modules are 100% covered with no server-only client import.

### ⬜ Unit 7a: Cook Progress State Tests
**What**: Add red pure tests for exact operations/hashes, checked order, duplicate last-wins, revisions/timestamps, expiry/count capacity, content-free live replay entries with exact acceptedRevision, eventual-tombstone byte reservation/backpressure, tombstone bound, and rebase. Freeze PURGING precedence: every structurally valid non-DELETE lifecycle request returns purging before replay/hash/tombstone/attempt; after commit old ids return purged. Prove replacement atomically converts all start and mutation records, exposes only before/after states, and no replay record stores recipe/progress snapshots.
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
**What**: Add red pure tests for exact AdoptionInput/hash/outcomes/replay/resume plus permanent `history:v1`: only its absence adopts, first accepted attempt creates it atomically, and full purge/coordinator expiry never renews adoption eligibility. D1 batch races remain Unit10.
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
**What**: Add real Workers red tests for deterministic arbitration and exact eight-key canonical-JSON-string/no-extra-field schemas, including `retry-state:v1` with exact independent nullable projection/socket channels, order, cross-key/DO identity invariants, content-free replay entries/acceptedRevision, permanent history, empty-key deletion, five-key residue, corruption, restart, and metadata logical/physical expiry primitives. Test every key at/beyond 1,500,000 bytes, malformed/noncanonical/oversized stored strings, and transaction-wide size preflight with no partial write. Prove `storageIdComponent` is unpadded base64url of UTF-8 exact `JSON.stringify(id)`, pair key is `cook.v1.<encoded-user>.<encoded-recipe>`, raw-colon/control/lone-surrogate inputs cannot alias, and both `idFromName` and D1 `activeKey` use that pair key. Assert exact class `CookSessionDurableObject`, `COOK_SESSIONS` Env/production/QA bindings, migration tag `v1_cook_sessions`, generated config and preflight. Unit13 owns purge transition.
**Output**: `test/workers-runtime/cook-session-do-storage.test.ts`, `test/config/wrangler-durable-objects.test.ts`, `test/scripts/deployment-preflight.test.ts`.
**Acceptance**: Worker/config tests fail because class/bindings/checks are absent.

### ⬜ Unit 9b: Durable Object Binding And Storage Implementation
**What**: Implement the exact encoded identity/pair-key helper, canonical JSON storage codec/byte guards, eight-key schema/order/cross-key validator including combined retry state, content-free replay metadata, tombstone byte reservation, history arbitration, residue accounting, dispatch, class/binding/export, and production/QA SQLite migration configuration.
**Output**: `workers/cook-session-do.ts`, `workers/app.ts`, `wrangler.json`, `app/cloudflare-env.d.ts`, `scripts/deployment-preflight.ts`.
**Acceptance**: Unit 9a passes; parallel starts serialize; restart persists state; both envs bind/export the class.

### ⬜ Unit 9c: Durable Object Storage Verification
**What**: Run the complete Unit 9a Workers/config suite with coverage, Wrangler source/generated-config validation, typecheck, and build; record evidence only.
**Output**: `unit-9-do-storage.log`.
**Acceptance**: Worker class paths are 100% covered; preflight, typecheck, and build pass.

### ⬜ Unit 10a: Internal Cook HTTP Lifecycle Tests
**What**: Add real Worker red tests for start/get/PATCH/terminal envelopes, headers, pinned/replay/hash/numeric/precedence, exact complete/abandon body `{attemptId,baseRevision,mutationId}` with unknown/extra/type-invalid 422, and exact 413 at recipe/current/response-frame byte boundaries with no write/send. Cover start/mutation count and tombstone-byte ledger backpressure. Exercise the per-instance promise-tail FIFO across fetch, alarm, and state-reading WebSocket message under deferred D1, parallel starts, alarm/message interleaving, rejection release, and restart. Distinguish one D1 snapshot `batch()` from atomic DO acceptance; prove D1-success/DO-commit-failure accepts nothing and retry rereads. Every cook route first requires signed-session User existence; deleted user gets 401+expired cookie, D1 auth failure 500. For every state-changing route and `/residue`, prove the shared origin guard accepts exact request-origin plus absent/exact `same-origin` fetch metadata, but rejects absent/null/duplicate/comma-joined/malformed/mismatched Origin and every present non-`same-origin` `Sec-Fetch-Site` as private 403 before body parse or DO namespace lookup, with zero state mutation. Snapshot GET alone is exempt. Malformed complete projection queue makes lifecycle GET/write/live ordinary 500, while residue alone reports exact diagnostic invalidity, key-presence attempt count, and deterministic pending-count fallback. Exclude purge state until Unit13.
**Output**: `test/workers-runtime/app-cook-session-http.test.ts`, `test/workers/app.test.ts`.
**Acceptance**: Tests fail because Worker-level HTTP handler is absent.

### ⬜ Unit 10b: Internal Cook HTTP Lifecycle Implementation
**What**: Intercept cook API before Router; implement route/method, existing-User cookie auth, one shared exact Origin/optional fetch-metadata guard at the planning-defined precedence, encoded DO derivation, per-instance fetch/alarm/state-reading-message FIFO, lifecycle routes and exact terminal bodies, in-DO D1 snapshot batch plus byte preflight and later atomic acceptance commit, corruption/numeric/size/replay/header contracts; leave purge route/state for Unit13.
**Output**: `app/lib/cook-session-http.server.ts`, `workers/app.ts`, `workers/cook-session-do.ts`.
**Acceptance**: Unit 10a passes; D1 freshness is irrelevant to auth/start; all non-101 responses are private no-store.

### ⬜ Unit 10c: Internal Cook HTTP Verification
**What**: Run the complete Unit 10a Workers suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-10-cook-http.log`.
**Acceptance**: New HTTP/Worker code is 100% covered and commands pass.

### ⬜ Unit 11a: Cook WebSocket Tests
**What**: Add real Workers red tests for the exhaustive handler matrix: after auth, both upgrade and non-upgrade `/live` requests run the same Unit10 origin/fetch-metadata matrix before WebSocket allocation, DO lookup, 426, or 101; every rejection is private 403 with zero subscription. An origin-valid non-upgrade is 426 `upgrade_required` / `WebSocket upgrade required.` with `Upgrade: websocket`; an origin-valid upgrade yields 101. `webSocketMessage` runs in the FIFO, validates state, then closes purged/stale/missing/client-data with exact 4001/4000/1003 precedence; `webSocketClose` synchronously attempts `close(code,reason)`; `webSocketError` synchronously attempts `1011 WebSocket error`; close/error never access storage. Cover snapshots, attachments/restart, program-order synchronous `send()`/`close()` calls and thrown exceptions, fanout isolation, and ordinary state. Reserve PURGING transition for Unit13, where sends are repeated best-effort with no acknowledgement and duplicate byte-equivalent PURGING frames across crashes are legal/client-idempotent.
**Output**: `test/workers-runtime/app-cook-session-websocket.test.ts`, `test/workers-runtime/cook-session-do-websocket.test.ts`.
**Acceptance**: Tests fail because live subscription is absent.

### ⬜ Unit 11b: Cook WebSocket Implementation
**What**: Add recipe-keyed live handling with hibernation and the exact origin-before-upgrade/upgrade/message/close/error matrix, reusing Unit10's shared guard and including FIFO-owned state-reading messages and synchronous storage-free close/error callbacks; leave PURGING transition wiring for Unit13.
**Output**: `app/lib/cook-session-http.server.ts`, `workers/app.ts`, `workers/cook-session-do.ts`.
**Acceptance**: Unit 11a passes; subscribers receive accepted snapshots, hibernated sockets recover metadata, and no socket failure rolls back accepted state or skips an independent peer.

### ⬜ Unit 11c: Cook WebSocket Verification
**What**: Run the complete Unit 11a Workers suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-11-cook-websocket.log`.
**Acceptance**: New WebSocket paths are 100% covered and commands pass.

### ⬜ Unit 12a: D1 Projection Alarm Tests
**What**: Add real Workers red tests for exact projection serialization and whole-queue validation: length `0..1_024`, canonical bytes at/beyond 1,500,000, unique projectionId, owner/recipe equality, one contiguous block per attempt, strict append sequence inside each block, at most one DELETE and DELETE last, old-attempt blocks before new, no re-sort, and every wrapper/entry/order corruption. Residue reports `projectionHeadValid` only for an entirely valid queue, pending count zero without an exact entries array or raw length with one, and `liveStateKeyCount` by current/start/mutation/queue/retry key presence while separately reporting retained tombstone count/expiry. Enforce count plus exact synthetic-max-sequence purge DELETE byte reservation: ordinary append that leaves no slot/byte reserve returns exact 503/Retry-After60 atomically, no eviction/coalescing; a previously accepted queue always admits purge; replays/non-appends remain available. Alarm drains at most 32 sequential heads, each successful D1 application followed by exact DO head deletion and immediate rearm when more remain. Test exact `retry-state:v1` with independent nullable projection/socket channels; projection failures 1..5 => 2/4/8/16/32 seconds, already-5 => 60 indefinitely, and projection success clears only that channel. Validate safe minimum alarms with a not-due socket channel and metadata expiry. Purge append/socket transitions remain Unit13.
**Output**: `test/workers-runtime/cook-session-projection.test.ts`, `test/lib/cook-session-index.server.test.ts`.
**Acceptance**: Tests fail because alarm-backed projection is absent.

### ⬜ Unit 12b: D1 Projection Alarm Implementation
**What**: Implement exact count/byte-bounded projection union, synthetic purge slot/byte reservation/backpressure, fail-closed whole-queue validator/residue fallback, at-most-32 sequential drain, combined retry-state codec with independent projection channel, persisted saturating retry/rearm, and atomic ordinary alarms; leave socket/purge wiring to Unit13.
**Output**: `workers/cook-session-do.ts`, `app/lib/cook-session-index.server.ts`.
**Acceptance**: Unit 12a passes; no transition is accepted without its alarm, accepted DO mutations survive D1 failure/new attempt, and repeated alarms do not duplicate history.

### ⬜ Unit 12c: D1 Projection Verification
**What**: Run the complete Unit 12a Workers/app suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-12-cook-projection.log`.
**Acceptance**: New projection code is 100% covered; no RecipeSpoon/notification integration appears.

### ⬜ Unit 13a: Cook Purge Fence Tests
**What**: Add real Workers red tests for the entire purge contract: matching/repeated pending DELETE exact 202 `{snapshot,purgeStatus:"pending"}`, stale/no-current/204, sole equal-revision transition, pre-reserved queue/tombstone/current/response/frame bytes at every limit, D1/socket gate, all failure boundaries, and guaranteed no-overflow conversion of every live replay to content-free tombstones. Prove PURGING response precedence and the repeated-best-effort/duplicate-frame crash matrix without claiming delivery acknowledgement. Exhaustively cover independent projection/socket retry counters and resets, initial/due socket sweeps, both-due alarms where one or both concerns fail, minimum next-alarm precedence, socket-only retries, 32-head immediate rearm, and finalization only after DELETE barrier plus zero sockets. Test history persistence, logical coordinator/tombstone expiry, eventual alarm retry (not false 24h physical SLA), exact diagnostic residue/presentKeys pre-delete allowlist, and fresh-start clearing only coordinator expiry.
**Output**: `test/workers-runtime/cook-session-purge.test.ts`, `test/workers-runtime/app-cook-session-http.test.ts`, `test/workers-runtime/app-cook-session-websocket.test.ts`, `test/workers-runtime/cook-session-do-websocket.test.ts`.
**Acceptance**: Tests fail because purge state machine is absent.

### ⬜ Unit 13b: Cook Purge Fence Implementation
**What**: Implement exact purge route/fence/202/204, global PURGING precedence, repeated best-effort duplicate-tolerant frames, reserved FIFO barrier, independent persisted D1/socket retry channels composed under one alarm, atomic five-key deletion/all replay conversion, permanent history, and logical/eventual physical metadata expiry with minimum alarm scheduling.
**Output**: `workers/cook-session-do.ts`, `app/lib/cook-session-http.server.ts`.
**Acceptance**: Unit 13a passes; purge cannot erase older repair/newer attempt; purged start replay cannot recreate/adopt state.

### ⬜ Unit 13c: Cook Purge Verification
**What**: Run the complete Unit 13a Workers suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-13-cook-purge.log`.
**Acceptance**: New purge code is 100% covered and commands pass.

### ⬜ Unit 14a: Cook Client Transport Tests
**What**: Add red browser tests for every exact fetch constructor: same-origin credentials, no-store, Accept, fresh physical X-Request-Id, JSON-only Content-Type/body, exact terminal body, retry request-id versus stable mutation body; exact encoded ws/wss same-host URL and no subprotocol. Cover 202 pending data, bodyless204, 413 permanent size error, 426 upgrade-required, purging snapshot, 401/403/404/409/410/429/503/network/malformed decoding.
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
**What**: Add red controller/provider tests for exact encoded user/recipe/client record/reset/generation keys, record unions/bounds/StartFresh, and crash-persistent reset/logout. Mount a root-owned `CookSessionDeviceProvider` above Outlet across navigation; assert its lifetime client Web Lock, shared per-user lock for every ordinary record mutation, exclusive per-user reset/logout lock, fixed lock ordering, identity-change barrier, `CookSessionLogoutForm`, and both existing logout forms. Exhaustively test generation initialization/+1/exhaustion, exact marker fromGeneration/toGeneration creation and current-equals-from-or-to crash resume without double increment, corrupt/unknown/extra/mismatched markers/generations, exact fail-closed copy, explicit scoped overwrite versus global marker-only removal, valid conflicting-user serialization, server-401/external-cookie cleanup ordering, and cross-tab blocking before incoming bootstrap. Pause a late writer before shared-lock acquisition, complete cleanup with delayed storage events, and prove stale generations cannot restore bytes; prove an already-held shared writer completes before exclusive deletion; hold app logout's marker/exclusive lock across `/logout` POST and root-loader revalidation, proving 302/status alone does not release it, null/different loader identity does, and failed/unknown/unchanged identity retains it; on resume prove authenticated identity reposts while already-absent/different identity does not. Prove exact pending->inFlight persisted move, display base then inFlight then pending, unknown-response retention, unsolicited-base rebase, accepted clear, stale fresh-id rebase, different-attempt clear, and accepted-write-failure memory/disk split. Assert exact copies `Cook progress on this device is corrupted.`, `This device already has 256 pending cook changes. Reconnect or retry before adding more.`, `Cook progress could not be synchronized because the server returned conflicting state.`, and `Keep this tab open until cook progress finishes syncing.` plus the exact `beforeunload` predicate/`preventDefault()`/`returnValue=""` handler. Define 404/purged exact idle record and 401 cleanup marker transition. Prove destroyed-context records remain inert until reset/logout with no auto-send or garbage collection. Retain equal-PURGING exemption, duplicate best-effort PURGING frames/4001, anonymous v2, sockets/backoff, and every persistence boundary.
**Output**: `test/hooks/use-cook-session.test.ts`, `test/components/CookSessionDeviceProvider.test.tsx`, `test/components/CookSessionLogoutForm.test.tsx`, `test/root-navbar.test.tsx`, `test/routes/users-identifier.test.tsx`, `test/routes/recipes-id.test.tsx`.
**Acceptance**: The exact six-file run fails because hook/controller/provider/logout integration is absent.

### ⬜ Unit 15b: Cook Client Reconciliation Implementation
**What**: Implement root-owned `CookSessionDeviceProvider`/`CookSessionLogoutForm` plus `useCookSession` with exact encoded key helpers, lifetime client and shared/exclusive per-user Web Locks, persistent user/recipe generations, record/marker/generation parsers, explicit corrupt-marker recovery, identity barrier, late-writer-proof cross-tab cleanup, exact persisted overlay/401/404 transitions, StartFresh reducer, orphan retention, beforeunload guard, PURGING duplicate tolerance, protocol guard/copy, anonymous mapping, and reconnect controller.
**Output**: `app/root.tsx`, `app/routes/users.$identifier.tsx`, `app/components/CookSessionDeviceProvider.tsx`, `app/components/CookSessionLogoutForm.tsx`, `app/hooks/useCookSession.ts`, `app/routes/recipes.$id.tsx`.
**Acceptance**: Unit 15a passes; client time never overrides server; every authenticated mutation is recoverable after an unknown response; anonymous state clears only after successful 200/201 start plus authenticated persistence; queue/command transitions follow the exhaustive persisted disposition table.

### ⬜ Unit 15c: Cook Client Reconciliation Verification
**What**: Run the complete Unit 15a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-15-cook-client-state.log`.
**Acceptance**: New hook code is 100% covered and anonymous regressions pass.

### ⬜ Unit 16a: Recipe Cook Lifecycle UI Tests
**What**: Add red route tests for server state, all adoption outcomes/errors, edit warning, and every persisted StartFresh boundary/reload while showing one disabled transition state. Cover Continue original, complete/abandon/reconnect/terminal/error UI, pinned inaccessible fallback (only that fallback forbids terminal restart), and authenticated recipe-detail/pinned-fallback `Cache-Control: private, no-store`, `Pragma: no-cache`, and deduplicated `Vary: Cookie` while anonymous caching stays unchanged.
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
**What**: Add red loader/render/controller tests for ordered owner cards and exact activation matrix: ACTIVE navigate; terminal/404 permanent mount invalidation; purging required snapshot/alarm rearm/status; network/408/425/5xx and malformed Retry-After fixed 1/2/4/8/16/30/30 schedule; valid 429 override; focus/online immediate; one timer/request; 401 cleanup; contract/malformed explicit Retry only; reset/stop/unmount and no reappearance. Retain privacy/cache/visitor/pinned cases.
**Output**: `test/routes/index.test.tsx`, `test/components/recipe/ContinueCookingList.test.tsx`, `test/components/navigation/mobile-nav.test.tsx`.
**Acceptance**: Tests fail only because owner-only section is absent; dock links remain unchanged.

### ⬜ Unit 17b: Owner-Only Continue Cooking Implementation
**What**: Load D1 active projection only for owner; implement every canonical activation disposition including PURGING status/alarm rearm and retry classes; invalidate non-active cards locally, revalidate, and render the unframed list without dock edits.
**Output**: `app/routes/_index.tsx`, `app/components/recipe/ContinueCookingList.tsx`, `app/lib/cook-session-client.ts`, `workers/cook-session-do.ts`.
**Acceptance**: Unit 17a passes; stale cards cannot navigate/resurface in the same mount, active cards navigate, later D1 loader repairs, and non-owner loader/query contains no private metadata.

### ⬜ Unit 17c: Continue Cooking Verification
**What**: Run the complete Unit 17a app suite plus affected Workers alarm/GET suite with both coverage projects, `pnpm exec playwright test e2e/home-hero-viewport.spec.ts`, typecheck, and build; record evidence only.
**Output**: `unit-17-continue-cooking.log`.
**Acceptance**: New code is 100% covered; nav/privacy regressions and all three guest-home viewport cases pass.

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
**What**: Add red tests for private GET `/api/v1/me/saved-recipes`, session/bearer auth, `kitchen:read`, no-store, default-20/max-50 and repeated/blank parameter validation, and `(createdAt DESC, recipeId DESC)` keyset pagination. Require exact canonical unpadded `v1.<base64url>` cursor: alphabet/padding/UTF-8, byte-exact `JSON.stringify({ createdAt, recipeId })` key order, extra/missing/type failures, canonical ISO round-trip, nonempty recipeId, and raw re-encoding equality. Prove strict continuation predicate `createdAt < cursor.createdAt OR (createdAt = cursor.createdAt AND recipeId < cursor.recipeId)` even after the cursor row is deleted; query `limit+1`; return only `limit`; set hasMore iff the extra row exists; emit nextCursor from the last returned row only when hasMore, otherwise null. Cover null/raw cursor echo, ties, exact `{ limit, cursor, nextCursor, hasMore, recipes }` data, `isSaved: true`, soft-deleted omission, empty/error envelopes, route registry, and OpenAPI.
**Output**: `test/routes/api-v1-saved-recipes.test.ts`, `test/routes/api-v1-scopes.test.ts`, `test/config/api-v1-route-coverage.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`.
**Acceptance**: The exact five-file Vitest run fails because the list endpoint is absent.

### ⬜ Unit 20.1b: Saved REST List Implementation
**What**: Implement the private paginated GET endpoint with exact canonical cursor validation, strict keyset predicate, `limit+1` continuation semantics independent of cursor-row existence, and existing v1 auth/error/no-store conventions; document it.
**Output**: `app/lib/api-v1.server.ts`, `app/lib/api-v1-contract.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.tsx`, `docs/api.md`.
**Acceptance**: Unit 20.1a passes; only the authenticated viewer's active recipes are returned with private no-store.

### ⬜ Unit 20.1c: Saved REST List Verification
**What**: Run list endpoint coverage, generator idempotency, typecheck, and build without adding behavior.
**Output**: `unit-20.1-saved-list.log`.
**Acceptance**: New list code is 100% covered and all commands pass.

### ⬜ Unit 20.2a: Saved REST Mutation Tests
**What**: Add red tests for idempotent PUT/DELETE `/api/v1/me/saved-recipes/:recipeId`, body-over-header-over-query `clientMutationId` precedence, unknown fields, exact 200 `{ recipeId, saved, mutation }` payload/replay flag, already-saved/already-unsaved success, `kitchen:write`, session/bearer auth, replay/conflict/in-progress errors, missing/deleted recipe 404, no-store, route registry, and OpenAPI.
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
**What**: Add red tests across summary/detail/search/native-sync/cookbook payloads for: no principal -> `isSaved:null` with existing public Cache-Control/ETag; cookie-session and trusted-environment principals -> viewer boolean; bearer with exact normalized `kitchen:read` -> viewer boolean; and valid read-capable bearer with only `public:read`, only `recipes:read`, `kitchen:write` without `kitchen:read`, or every other scope combination -> null with no SavedRecipe query. Invalid/ordinary-insufficient principals retain existing errors. Assert every valid principal, including public-only null, uses `private, no-store`/Pragma and deduplicated `Vary: Cookie, Authorization`; only no-principal uses public caching. Cover true/false/null, another user's save, query-count/oracle, OpenAPI/examples, and no public count or cache leak.
**Output**: `test/routes/api-v1-recipes.test.ts`, `test/routes/api-v1-search.test.ts`, `test/routes/api-v1-native-sync.test.ts`, `test/routes/api-v1-recipe-writes.test.ts`, `test/routes/api-v1-cookbooks.test.ts`, `test/routes/api-v1-scopes-public-tokens.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/scripts/generate-api-playground.test.ts`.
**Acceptance**: The targeted run fails because functional isSaved projection is absent.

### ⬜ Unit 20.3b: Recipe isSaved Projection Implementation
**What**: Add nullable `isSaved` to v1 contracts and gate the shared builder's viewer-scoped SavedRecipe lookup exactly: session/environment or bearer containing `kitchen:read` gets boolean; no principal or any other bearer gets null, with no private lookup for the latter. Preserve public caching only for no-principal and apply private no-store to every valid principal.
**Output**: `app/lib/api-v1.server.ts`, `app/lib/api-v1-contract.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.playground.tsx`, `app/routes/developers.tsx`, `docs/api.md`.
**Acceptance**: Unit 20.3a passes; only a kitchen-read-entitled principal receives a boolean, public-only bearers receive null without lookup, caches cannot cross principal boundaries, and save state never becomes a public count.

### ⬜ Unit 20.3c: Recipe isSaved Projection Verification
**What**: Run every shared builder consumer, coverage, generator idempotency, typecheck, and build without adding behavior.
**Output**: `unit-20.3-is-saved.log`.
**Acceptance**: New projection branches are 100% covered and cross-contract suite passes.

### ⬜ Unit 21a: Saved Controls And Route Tests
**What**: Add red tests for `/saved-recipes` loader/query/empty states with authenticated `private, no-store`/Pragma/deduplicated Vary Cookie, and exact recipe-page POST FormData `saveRecipe|unsaveRecipe` intents. Assert route-id source; inspect every intent before dispatch; exactly one string save intent and no other entry; bodyless 400 for save-first/other-first mixed intents, repeated/extra/File/blank save bodies and missing/blank/unknown general intent; pre-parse cookie-auth 302 to `/login?redirectTo=/recipes/<id>`; exact private no-store/Pragma/Vary 200 JSON; bodyless 404 deleted/missing; already-state idempotency; no client mutation id; disabled non-optimistic fetcher; only matched intent/recipe success updates; route/network/malformed/mismatched/non-200 responses preserve state with exact inline error/Retry; and cookbook independence plus unchanged existing non-save action handling.
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
**What**: Add red tests for owner saved section limited to 12 active saves ordered createdAt/recipeId descending with `/saved-recipes` link, owner-response private no-store/Pragma/deduplicated Vary Cookie, plus strict loader/query/render absence and unchanged existing cache behavior for authenticated and anonymous visitors.
**Output**: `test/routes/index.test.tsx`.
**Acceptance**: Tests fail because owner section is absent.

### ⬜ Unit 23b: Owner-Only Saved Kitchen Implementation
**What**: Load/render the exact limited/ordered SavedRecipe section and all-saves link only when viewer owns the kitchen; do not edit dock.
**Output**: `app/routes/_index.tsx`, `app/components/recipe/SavedRecipeList.tsx`.
**Acceptance**: Unit 23a passes; no private save data enters visitor loader output.

### ⬜ Unit 23c: Saved Kitchen Verification
**What**: Run the complete Unit 23a suite with coverage, `pnpm exec playwright test e2e/home-hero-viewport.spec.ts`, typecheck, and build; record evidence only.
**Output**: `unit-23-saved-kitchen.log`.
**Acceptance**: New code is 100% covered; nav/privacy tests and all three guest-home viewport cases pass.

### ⬜ Unit 23d: Saved Kitchen Visual QA
**What**: Invoke visual QA for owner/non-owner My Kitchen desktop/mobile saved states.
**Output**: `visual-saved-kitchen/` evidence and closed ledgers.
**Acceptance**: No privacy exposure, dock churn, or ready visual issue remains.

### ⬜ Unit 24a: RecipeTag Migration And Service Tests
**What**: Add red schema/service tests including exact whitespace plus unpaired-surrogate rejection/scalar vectors, reserved four course words, partial course unique, exact INSERT/UPDATE custom-limit trigger including duplicate/no-op behavior, parent CURRENT_TIMESTAMP trigger events/equality, singleton lease, and exact 400 messages/409 submittedTags response with no partial write. Force both serialization orders of simultaneous full replacements: later commit owns normalized membership/course, retained overlap preserves execution-time existing casing/id, and a delete-then-later-insert uses later casing. Cover rollback and injected unique/limit trigger conflicts; assert there is no delta add/remove service.
**Output**: `test/models/recipe-tag.test.ts`, `test/lib/recipe-tags.server.test.ts`, `test/scripts/migration-0027-recipe-tags.test.ts`.
**Acceptance**: Tests fail because tag schema/service/migration are absent.

### ⬜ Unit 24b: RecipeTag Migration And Service Implementation
**What**: Implement exact RecipeTag schema, well-formed Unicode canonicalizer/comparator, indexes, insert/update limit and parent timestamp triggers, immutable lease, typed validation/conflict errors, and owner full-replacement declarative helper with no delta API; leave nested create to Unit25 and add no AI.
**Output**: `prisma/schema.prisma`, `migrations/0027_recipe_tags.sql`, `prisma/migrations/20260715102000_recipe_tags/migration.sql`, `app/lib/recipe-tags.server.ts`.
**Acceptance**: Unit 24a passes; database constraints preserve one course/ten customs and parent freshness under both race orders; normalization is deterministic; source is MANUAL.

### ⬜ Unit 24c: RecipeTag Data Verification
**What**: Run the complete Unit 24a suite with coverage, Prisma generation, local migrations/rerun, typecheck, and build; record evidence only.
**Output**: `unit-24-tags-data.log`.
**Acceptance**: New service is 100% covered and commands pass.

### ⬜ Unit 25a: Tag Authoring Tests
**What**: Add red FormData/authoring tests for exact one course, repeated custom rows, empty/whitespace omission, unpaired-surrogate/length/reserved/limit messages, exact `{errors.tags,submittedTags}` 400/409 payload and UI restoration, first casing/order, nested create, declarative edit, every rollback/race, owner auth, and no AI.
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
**What**: Add red tests for controlled course/custom display order/casing on detail, recipe list, and RecipeGrid cards, including empty/dense states. For the live profile-card path, require `users.$identifier` loader selection/mapping to supply ordered public tags to RecipeGrid for owner, authenticated visitor, and anonymous visitor without exposing private saves/cook history or soft-deleted/private recipe data; render the route and assert the card tags rather than only testing RecipeGrid with fabricated props.
**Output**: `test/routes/recipes-id.test.tsx`, `test/routes/recipes-index.test.tsx`, `test/components/pantry/RecipeGrid.test.tsx`, `test/routes/users-identifier.test.tsx`.
**Acceptance**: Tests fail because display is absent.

### ⬜ Unit 26b: Tag Display Implementation
**What**: Add compact course/custom display using existing design primitives and extend the actual `users.$identifier` profile loader/mapping so its RecipeGrid receives the same public ordered tags.
**Output**: `app/routes/recipes.$id.tsx`, `app/routes/recipes._index.tsx`, `app/routes/users.$identifier.tsx`, `app/components/pantry/RecipeGrid.tsx`.
**Acceptance**: Unit 26a passes; casing/order match contract, empty tags add no chrome, the live profile cards render tags for every viewer class, and profile privacy is unchanged.

### ⬜ Unit 26c: Tag Display Verification
**What**: Run the complete Unit 26a suite with coverage, typecheck, and build; record evidence only.
**Output**: `unit-26-tags-display.log`.
**Acceptance**: New display code is 100% covered and commands pass.

### ⬜ Unit 26d: Tag Display Visual QA
**What**: Invoke visual QA for detail/list/cards desktop/mobile with dense tags.
**Output**: `visual-tags-display/` evidence and closed ledgers.
**Acceptance**: No card crowding, overflow, or ready visual issue remains.

### ⬜ Unit 27.1a: Tag Search Index Tests
**What**: Add red tests for exact SearchDocument tag projection, RecipeTag source hash (`sha256:<lowercase hex>` over UTF-8 JSON with exact row/key/BINARY order), source fingerprint count/latest/hash, and the one-statement expected/actual key-set completeness result with all eight counters. Cover absent/duplicate/extra/missing/metadata/table/type failures. Freeze fixed-guard replacement: immediate lease; complete-stale loser queries old; incomplete loser waits 25/50/100/200/400/800/1600 with completeness-before-reacquire; exact 503 `Search is temporarily unavailable.` from `recipes._index`, `search`, v1, and every MCP search operation; max-three source-change cycles; owner/loss/expiry/release/statement exception complete-index fallback; no incomplete query. Retain atomic old/new and immediate REST.
**Output**: `test/lib/search.server.test.ts`, `test/lib/recipe-tags.server.test.ts`, `test/routes/recipes-index.test.tsx`, `test/routes/search.test.tsx`, `test/routes/api-v1-search.test.ts`, `test/lib/mcp/spoonjoy-tools.server.test.ts`.
**Acceptance**: The exact six-file Vitest run fails because tag indexing and unavailable-response mappings are absent.

### ⬜ Unit 27.1b: Tag Search Index Implementation
**What**: Implement exact projection/content hash/source fingerprint/one-statement completeness plus the planning-defined immediate/wait/three-cycle/fallback/unavailable state machine and every web/v1/MCP mapping.
**Output**: `app/lib/search.server.ts`, `app/lib/recipe-tags.server.ts`, `app/lib/api-v1.server.ts`, `app/routes/recipes._index.tsx`, `app/routes/search.tsx`, `app/routes/api.$.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/mcp/spoonjoy-tools.server.ts`.
**Acceptance**: Unit 27.1a passes; migrations remain immutable, every race observes a complete index, saved privacy remains intact, and only canonical accepted tags are indexed.

### ⬜ Unit 27.1c: Tag Search Index Verification
**What**: Run search/tag coverage, typecheck, and build without adding behavior.
**Output**: `unit-27.1-tags-index.log`.
**Acceptance**: New index/reindex code is 100% covered and commands pass.

### ⬜ Unit 27.2a: Tag REST And MCP Projection Tests
**What**: Add red tests for lowercase singular course, custom-only tags preserving display casing and canonical BINARY/scalar normalizedLabel/id order with non-ASCII cases, anonymous/authenticated REST list/detail/search/native-sync/cookbook propagation, and byte-equivalent MCP `search_recipes`/`get_recipe` neutral projections. Cover MCP tool metadata/docs, empty/dense tags, accepted MANUAL data only, exact omission of private `isSaved`, unchanged scopes/tool names, OpenAPI/contract/generator/playground/docs, and no AI contract or suggestion data on either transport.
**Output**: `test/routes/api-v1-recipes.test.ts`, `test/routes/api-v1-search.test.ts`, `test/routes/api-v1-native-sync.test.ts`, `test/routes/api-v1-cookbooks.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, `test/routes/api-v1-openapi.test.ts`, `test/scripts/generate-api-playground.test.ts`, `test/routes/developers-playground.test.tsx`, `test/lib/spoonjoy-api-spoons.test.ts`, `test/lib/mcp/spoonjoy-tools.server.test.ts`, `test/routes/mcp.test.ts`, `test/routes/mcp-page.test.tsx`, `test/docs/developer-platform-docs.test.ts`, `test/docs/developer-platform-guide.test.ts`.
**Acceptance**: The targeted run fails because shared REST/MCP tag projection is absent.

### ⬜ Unit 27.2b: Tag REST And MCP Projection Implementation
**What**: Populate REST and MCP recipe-read course/tags through the shared metadata projection with exact casing/order; update REST contracts/generated/public docs and existing MCP tool descriptions/docs without adding a new tool or private field.
**Output**: `app/lib/recipe-api-metadata.server.ts`, `app/lib/api-v1.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/mcp/spoonjoy-tools.server.ts`, `app/lib/api-v1-contract.server.ts`, `app/lib/api-v1-openapi.server.ts`, `scripts/generate-api-playground.ts`, `app/lib/generated/api-v1-playground.ts`, `app/routes/developers.playground.tsx`, `app/routes/developers.tsx`, `app/routes/mcp.tsx`, `docs/api.md`.
**Acceptance**: Unit 27.2a passes; REST/MCP neutral values agree, existing field types/scopes/caches remain compatible, MCP omits `isSaved`, and no AI contract appears.

### ⬜ Unit 27.2c: Tag REST And MCP Projection Verification
**What**: Run all shared response consumers, coverage, generator idempotency, typecheck, and build without adding behavior.
**Output**: `unit-27.2-tags-api.log`.
**Acceptance**: New projection code is 100% covered and cross-contract suite passes.

### ⬜ Unit 28a: Tag Discovery Filter Tests
**What**: Add red parser/AND/GET-control tests including absent versus one empty course, repeated-empty invalid, raw/normalized-empty tag ignored, malformed-surrogate/overlength/reserved invalid, canonical control emission, max ten, query preservation, privacy, scopes, and pre-rank/limit intersection over >30 results. For My Recipes, capture outgoing SQL/arguments and prove the existing owner/deletedAt/q semantics, 50+1 bounded pagination, deterministic order, and no corpus materialization/legacy ingredient lookup survive while course/custom-tag predicates execute before limit/offset; cover combined q/course/tag and visible options before filtering. Assert Previous/Next clone original query-pair order, preserve q/course/repeated-tag order and every unrelated pair, replace duplicate page entries with one target page >1, and omit page for target 1.
**Output**: `test/lib/recipe-tag-filter.test.ts`, `test/lib/recipe-tag-filter.server.test.ts`, `test/lib/my-recipes-search.server.test.ts`, `test/routes/my-recipes.test.tsx`, `test/routes/my-recipes-query-boundary.test.ts`, `test/routes/index.test.tsx`, `test/routes/search.test.tsx`, `test/components/recipe/RecipeTagFilters.test.tsx`, `test/components/pantry/RecipeGrid.test.tsx`.
**Acceptance**: Tests fail because filters and filter-preserving pagination are absent; every integrated bounded-search/pagination case remains green.

### ⬜ Unit 28b: Tag Discovery Filter Implementation
**What**: Add browser-safe parser/query helpers in `recipe-tag-filter.ts`, DB-backed visible-option and pre-rank intersection helpers in server-only `recipe-tag-filter.server.ts`/`search.server.ts`, extend `my-recipes-search.server.ts` with owner-scoped SQL predicates before order/limit/offset, make My Recipes pagination clone/preserve the exact current query contract, and add the exact GET filter component to all three discovery surfaces without dock edits.
**Output**: `app/lib/recipe-tag-filter.ts`, `app/lib/recipe-tag-filter.server.ts`, `app/lib/my-recipes-search.server.ts`, `app/lib/search.server.ts`, `app/components/recipe/RecipeTagFilters.tsx`, `app/routes/my-recipes.tsx`, `app/routes/_index.tsx`, `app/routes/search.tsx`, `app/components/pantry/RecipeGrid.tsx`.
**Acceptance**: Unit 28a passes; unfiltered/q-only My Recipes results and bounded pagination are unchanged, every pagination link retains filters/unrelated parameters exactly, combined filters execute in SQL, and private kitchen sections remain owner-only.

### ⬜ Unit 28c: Tag Discovery Verification
**What**: Run the complete Unit 28a suite with coverage, `pnpm exec playwright test e2e/home-hero-viewport.spec.ts`, typecheck, and build; record evidence only.
**Output**: `unit-28-tags-filters.log`.
**Acceptance**: New code is 100% covered, bounded My Recipes search/pagination passes, and the guest hero reveal remains green at all three viewports.

### ⬜ Unit 28d: Tag Discovery Visual QA
**What**: Invoke visual QA for filters/results/empty states, mobile My Kitchen/navigation, and the guest home hero/continuation at 390x844, 1440x900, and 1920x1080.
**Output**: `visual-tags-discovery/` evidence and closed ledgers.
**Acceptance**: No dock churn, overlap, crowding, horizontal overflow, lost first-viewport continuation, or ready visual issue remains.

### ⬜ Unit 29: Feedback Boundary And Disposition Audit
**What**: Add and run `test/config/clem-feedback-boundaries.test.ts`, the planning-defined automated registered-route/surface oracle that forbids first-party web import UI, AI tag workflow/contract, Pebble behavior/copy, and dock drift while allowing developer/API/agent import surfaces. Freeze the accepted recipe-read boundary: REST v1 and existing MCP `search_recipes`/`get_recipe` expose shared neutral metadata/tags, REST detail and MCP get expose shared read-time scaling, MCP has no `isSaved`, and no new MCP recipe tool exists. Run scoped existing navigation/repo-hygiene/developer-doc tests plus integrated-main My Recipes bounded-query, guest-hero, dual-Apple-OAuth, shared cover-service architecture, and advisory script/workflow regression oracles; inspect the completed product-feature diff from Units 1–28, and map every feedback-source row to code/test evidence or its explicit rejection. Units 29.1–31 touch deployment/smoke/cleanup infrastructure only.
**Output**: `test/config/clem-feedback-boundaries.test.ts`, `unit-29-feedback-audit.md`; logs for that test, `test/components/navigation/mobile-nav.test.tsx`, `test/repo-hygiene.test.ts`, `test/docs/developer-platform-docs.test.ts`, `test/docs/developer-platform-guide.test.ts`, `test/lib/my-recipes-search.server.test.ts`, `test/routes/my-recipes-query-boundary.test.ts`, `e2e/home-hero-viewport.spec.ts`, `test/lib/apple-oauth.server.test.ts`, `test/lib/env.server.test.ts`, `test/lib/oauth-route.server.test.ts`, `test/routes/auth-apple.test.ts`, `test/routes/redwood-functions-auth-oauth.test.ts`, `test/lib/recipe-cover-service-architecture.test.ts`, `test/lib/recipe-cover-service.server.test.ts`, `test/scripts/advisory-scan.test.ts`, and `test/release-workflow-security.test.ts`.
**Acceptance**: Automated and manual oracles pass; no source item is missing/silently deferred; REST/MCP metadata/scaling is present only on the frozen surfaces with its private-field boundary; and no first-party import UI, AI tag surface, Pebble contract, unproven dock edit, cover-service duplication, or advisory release-gate regression exists.

### ⬜ Unit 29.1a: Deployment SHA Attestation Tests
**What**: Adopt and preserve integrated `origin/main@1bea760b`, including `edf22ce1`'s dual Apple OAuth callback/env/deployment contract, `42267511`'s bounded My Recipes SQL path, `2f392840`'s guest-home viewport oracle, `b07d787e`'s production-run-29465177528 browser+APIRequest repair, `dcf296bd`'s redirect-safe CDP routing/readiness probe, `405d6149`'s shared cover-service boundary, and `1bea760b`'s measured advisory script plus mandatory CI/production gate; do not recreate landed work. Add red `test/scripts/vite-build-sha.test.ts` for a pure measured build-SHA resolver covering exact lowercase 40-hex HEAD, explicit dev literal, dirty/missing/invalid git output, and nondevelopment failure; keep `test/config/vite-build-sha.test.ts` as a source oracle that excluded `vite.config.ts` only imports/invokes that module and wires its result into `define`. Extend pure health tests and add public route-level `test/routes/health.test.ts` for exact body/header SHA equality, `Cache-Control: no-store`, JSON content type, DB/auth independence, dev literal handling, and production/QA rejection of `development` through the build contract. Add red tests that require the final three consecutive three-channel candidate cycles rather than landed two, plus reset-on-any-failure, one-second spacing, 120-second deadline/equality, `min(10 seconds, remaining)` per-request cap, no product/stateful mutation before stability, readiness-POST-only exception, override/assertion on every later same-origin request, no cross-origin override leak, and rollback on a later mismatch. Revalidate `test/routes/release-readiness.test.tsx`. In new `test/scripts/release-provenance.test.ts`, add red cases for discovering only a completed-success exact-SHA canonical CI `push`; discovering and freezing the newest exact automatic production `workflow_run` while it is queued, in progress, or completed; watching only that ID to terminal success; failing terminal non-success/timeout/identity drift; rejecting manual/wrong-path/wrong-head runs; downloading/hash-validating the named canary artifact; parsing its exact promoted source/tree/migration/version contract; and matching candidate Worker version to public health. Add a complete `verify-deploy-job` red matrix for immediate success, queued/in-progress polling, exact selected run/source identity, missing or duplicate `deploy`, terminal non-success, malformed/extra response data, request error, equality/timeout exhaustion, and fresh-out atomicity: every failure leaves no partial result, while success writes the sole no-extra-fields result only after one exact completed-success job. Add `test/config/release-script-gates.test.ts` red source/JSON assertions that both new script modules are explicitly included by repo-wide `vitest.config.ts` coverage and `tsconfig.scripts.json` typecheck while inherited `scripts/advisory-scan.ts` remains in both. Extend `test/scripts/deployment-preflight.test.ts` with a regression oracle that rejects stale deployment docs claiming production is a direct push trigger. Revalidate the overlapping workflow, advisory, canary orchestrator, package, Wrangler, health, dual-Apple-OAuth, and docs surfaces from integrated main.
The deploy-job matrix is exhaustive against the planning schema: zero matching jobs retries then times out; duplicate matches fail immediately; each nonterminal `queued`, `in_progress`, `waiting`, `requested`, and `pending` with null conclusion/completedAt polls; each completed conclusion `success`, `failure`, `cancelled`, `skipped`, `timed_out`, `action_required`, `neutral`, `stale`, and `startup_failure` is covered and only success passes. Separate red cases corrupt or omit envelope/jobs, id, runId, runAttempt, headSha, name, status, conclusion, url, startedAt, and completedAt; change frozen id/runAttempt/SHA; return unknown status/conclusion or illegal null/time combinations; cross the exact deadline; and forge a partial success file on every error.
**Output**: `test/config/vite-build-sha.test.ts`, `test/config/release-script-gates.test.ts`, `test/lib/health.server.test.ts`, `test/routes/health.test.ts`, `test/release-workflow-security.test.ts`, `test/routes/release-readiness.test.tsx`, `test/scripts/deploy-production-canary.test.ts`, `test/scripts/smoke-live-helpers.test.ts`, `test/scripts/deployment-preflight.test.ts`, `test/scripts/release-provenance.test.ts`, `test/scripts/vite-build-sha.test.ts`.
**Acceptance**: The exact eleven-file targeted command preserves all current-main cases and fails only on the newly missing measured build-SHA resolver plus declarative Vite declaration/wiring, exact health body/header/no-store route contract, three-consecutive-cycle/request-budget canary delta, release-provenance CLI plus coverage/typecheck script gates, and workflow-run/artifact-selection/deployment-doc freshness contracts.

### ⬜ Unit 29.1b: Deployment SHA Attestation Implementation
**What**: Implement exact HEAD/dev/nondevelopment behavior in measured `scripts/vite-build-sha.ts`; make excluded `vite.config.ts` only invoke it and define `__SPOONJOY_BUILD_SHA__`, declare the constant in `app/vite-env.d.ts`, extend the pure health payload, and return exact public no-store body/header/content-type attestation from the thin route without DB/auth. Tighten integrated `waitForWorkerChannelsReady` from two to exact three consecutive cycles and close the remaining per-request `min(10 seconds, remaining)` budget tests while preserving landed navigation+API+browser-mutation probes, redirect-safe CDP routing, deadline guards, later per-request assertions, rollback, and no-product-mutation-before-stability behavior. Implement reusable parsers plus CLI subcommands `discover-ci`, `discover-production`, `watch-workflow`, `verify-deploy-job`, `download-artifact`, and `verify-health` in new `scripts/release-provenance.ts`; require explicit `--repo`, `--source-sha`, and `--workflow-path` for workflow commands, explicit `--run-id` for run/job/artifact commands, `--job-name` for job verification, `--artifact-name` plus `--tree-sha` for artifact download, `--base-url` plus `--worker-version-id` for health, and `--out <fresh command-attempt out directory>` for every command. Each writes one no-extra-fields JSON result only after success and exits nonzero without partial result on timeout/schema/equality failure. Add exact package script `"release:provenance":"tsx scripts/release-provenance.ts"`; update deployment docs to describe the real `workflow_run` source-SHA gate and stable three-channel canary.
**Output**: `scripts/vite-build-sha.ts`, `vite.config.ts`, `app/vite-env.d.ts`, `app/lib/health.server.ts`, `app/routes/health.ts`, `scripts/smoke-live-helpers.mjs`, `scripts/smoke-mcp-oauth-live.mjs`, `scripts/release-provenance.ts`, `vitest.config.ts`, `tsconfig.scripts.json`, `docs/deployment.md`, `package.json`.
**Acceptance**: Unit 29.1a passes; the docs and reusable selectors match the live workflow-run/canary contract; existing production supply-chain, rollback, build-SHA, and health tests do not regress.

### ⬜ Unit 29.1c: Deployment SHA Attestation Verification
**What**: Run these literal commands in order and record each output with zero warnings: `pnpm exec vitest run --coverage test/config/vite-build-sha.test.ts test/config/release-script-gates.test.ts test/lib/health.server.test.ts test/routes/health.test.ts test/release-workflow-security.test.ts test/routes/release-readiness.test.tsx test/scripts/deploy-production-canary.test.ts test/scripts/smoke-live-helpers.test.ts test/scripts/deployment-preflight.test.ts test/scripts/release-provenance.test.ts test/scripts/vite-build-sha.test.ts`; `pnpm run typecheck:scripts`; `pnpm run deploy:preflight`; `pnpm run typecheck`; `pnpm run build`; `test -n "$(rg --fixed-strings --files-with-matches "$(git rev-parse HEAD)" build/server)"`; `git diff --exit-code`; `git diff --cached --exit-code`; `test -z "$(git status --porcelain --untracked-files=all)"`. Record evidence only; if any command exposes a gap, reopen Unit29.1a with a red test rather than editing in verification.
**Output**: `unit-29.1-deploy-attestation.log`.
**Acceptance**: Every named Unit29.1c command exits zero with zero warnings; new provenance and build-SHA modules are 100% covered, excluded Vite config has only source-asserted declarative wiring, build/health/readiness code retains coverage, deployment preflight passes, the local production build reports current HEAD, and final git status is clean.

### ⬜ Unit 29.2a: Release Evidence Manifest Tests
**What**: Add red script tests for the planning-defined no-extra-fields manifest/writerId/ReleaseRun/StageRun/command/evidence union, including immutable branchHeadTreeSha and exact SquashCommit/CI/workflow-run/ProductionRelease/Visual types; exact one-time initialization plus pre/post-manifest crash recovery; ISO/SHA/task-relative regular-file path/hash validation before and after simulated Desk archival; temp-file and parent-directory-fsync atomicity; exact hard-link lock acquisition/release plus every lock/candidate live/dead/cross-host/malformed/different-writer/race/crash-recovery branch, especially the legal byte-identical same-token/same-device/same-inode lock+candidate crash pair versus different-inode/content rejection, and terminal sidecar-zero scan. Cover lifecycle/dependency/SHA/required-logical-name invariants including `release-continuity-transfer` and `production-visual-dogfood`; every repository warning format including Wrangler/esbuild `▲ [WARNING]` and `warningCount`; immutable release-run/unit/stage/logical-name/command-attempt-qualified paths with no cross-ReleaseRun collisions; interrupted-command recovery; same-HEAD failed-stage retry while ReleaseRun stays active; explicit non-retryable ReleaseRun failure; HEAD/tree-change supersession; exact Check headSha/strict/linear-history evidence; failed health samples; queued/in-progress/completed production discovery, frozen newest-candidate identity, terminal watch success/failure/timeout, exact closed 14-file smoke and 30-file production-visual sets/hashes/no extras; and remote side-effect reconciliation without duplicate deploy/PR/squash/workflow selection. Cover every invalid/missing/extra/null/running/interrupted/failed/passed combination, Unit36 exact squash SHA/sole-parent/tree verification, Unit37 exact CI->workflow_run->promoted source/tree artifact chain, and truthful top-level cleanup. For each Cleanup, cover exact outcome/phase/fact basename mapping, six primary-only distinct/non-aliased paths, optional seventh recovery path, every no-extra-fields schema, identity and cross-hash equality, exact row-registry set, canonical ordering, immutable phase files, terminal-204 target completion, no non-target DELETE, retired-attempt report/residue hashes, one-user deletion, post-delete all-zero rows, no-post-delete owner trace, derived booleans, and rejection of every omission/extra/alias/mutation/hash/count/time/order/sequence failure. Require production Visual exact 21 screenshots plus zero-ready/zero-reviewer-gated proof, product-pass/archive immutability, and squash-aware cleanup preconditions; Slugger is intentionally outside the manifest and Unit37 acceptance. Extend the Unit29.1 release-script gate so both new release-evidence scripts must be explicitly present in repo-wide coverage and script typecheck allowlists.
Apply the same schema/derivation matrix to top-level Unit33/37 lifecycle-smoke Cleanup with reportAttempts exactly A+B, purgeTargets exactly B, and exact hashed A retirement. Reject a forged `noPostDeleteDoCall:true` extra field, a trace ending before post-delete observation, any non-target DELETE or owner call at/after deletion, an asserted flag that disagrees with recomputation, a recovery artifact in release evidence, and the pre-Unit31 eight-file smoke set; final release smoke union must have exactly 14 files.
Add artifact-ingestion red tests that parse every referenced lifecycle/visual report/log/JSON before hash acceptance, require the exact finite sanitized location/header/body/frame/diagnostic/failure schemas, reject raw/non-allowlisted or unknown strings and secret sentinels in file bytes/stdout/stderr, and prove manifest hashes are accepted only after semantic sanitization validation. Runtime sanitizer failure and partial-output deletion remain Unit30 ownership.
All ingestion cases build their complete immutable smoke/visual trees under a fresh test temp directory from literal fixture builders declared in `release-evidence.test.ts`; they import only the release-evidence module/re-exported pure projector and Node test utilities. Before any persisted-tree case, exhaustively call `projectCookHttpBody(transportStatus,rawEnvelope)` for every valid snapshot 200/201, purge 202, residue 200, and exact null body 204 success; every exact CookWireErrorCode/mapped transport status; required stale/revision/purging data snapshot; forbidden data for every other error; malformed/extra envelopes; and identity/revision mismatch. Cross every otherwise-valid error envelope with 2xx, another error's status, and every adjacent wrong status; cross every success body kind with every other success status; reject null outside 204, any body under 204, every non-object parsed value, and unsafe/missing/noninteger status; prove CookErrorEvidence.status and the enclosing SanitizedExchange.status equal the same validated transportStatus; and assert exact projected bytes/rejection before output. Exhaustively project all six raw WebSocket error codes with required/forbidden snapshot and equality. Cover `resolveCommandAttemptPaths` against exact repository cwd/task root, active run/stage/logicalName/attempt matching, fresh attempt/out creation, existing-parent non-symlink proof, absolute-to-relative normalization, archive re-rooting, supported-output command specs, log-only ordinary pnpm/gh/git/Wrangler commands, and every absolute/escape/alias/symlink/worktree-local rejection without executing a process. Source/import-graph assertions require one pure `release-artifact-contract.mjs`, reject another raw projector, and reject any `smoke-live`, `smoke-live-helpers`, or `production-visual-dogfood` import, dynamic import, child process, or runtime execution from Unit29.2 code/tests. Unit29.2b/c must pass at this point in sequence before Unit30's sanitizer/functional smoke changes and Unit31's cleanup/visual runner exist.
Require Unit32's exact 22-name command order and Unit37's exact `production-visual-qa-review`/`production-visual-design-review` positions. Literal fixtures cover the actual route registry (`home`, `cook_recipe`, `recipe_detail`, `recipe_edit`, `my_recipes`, `recipes_index`, `user_kitchen`), the ordered 21 captures, dimension-matched PNG decoding/no textual metadata or trailing bytes, per-metric screenshot hash equality, VisualReport/VisualMetrics schemas, exact closed-ledger bytes, output-relative-basename/BINARY-sorted 30-file aggregate serialization/hash, exact eight-line canonical review reports, distinct-role/agent VisualReviewer evidence, and matching one-report command outputs outside the runner tree. Reject every missing/extra/reordered capture/metric/command/report line, registry/image/privacy/current-snapshot mismatch, bad metric, alternate aggregate path form/order/hash drift, duplicate/swapped reviewer, unsupported synthetic `--out`, and non-clean/open-finding evidence.
**Output**: `test/scripts/release-evidence.test.ts`, `test/config/release-script-gates.test.ts`.
**Acceptance**: Tests fail because the manifest helper is absent.

### ⬜ Unit 29.2b: Release Evidence Manifest Implementation
**What**: Implement pure transport-status-bound raw HTTP/frame projection plus exact artifact schema parsers in `release-artifact-contract.mjs`; import/re-export them from the typed release-evidence helper, then implement writer/lock/run/stage/command/warning/artifact/evidence helpers, command-spec-aware Desk attempt/log/optional-output resolver/normalizer, visual semantic parsers, and reconciliation guards from planning. The pure module has no side effects/runtime imports and no release command is executed here.
**Output**: `scripts/release-artifact-contract.mjs`, `scripts/release-evidence.ts`, `scripts/release-evidence-cli.ts`, `vitest.config.ts`, `tsconfig.scripts.json`, `package.json`.
**Acceptance**: Unit 29.2a passes from self-contained literal artifact trees only; malformed, incomplete, SHA-drifting, or command-plan-skipping evidence cannot be marked passed, later runtime modules are neither imported nor executed, and interrupted valid runs resume without overwriting evidence or repeating remote side effects.

### ⬜ Unit 29.2c: Release Evidence Verification
**What**: Run Unit 29.2a with coverage, script typecheck, CLI dry-run against a temporary directory, typecheck, and build.
**Output**: `unit-29.2-release-evidence.log`.
**Acceptance**: New helper is 100% covered, creates no tracked file, and all commands pass.

### ⬜ Unit 30a: Two-Client Smoke Tests
**What**: Add red fake/browser script tests for the complete planning A/B oracle: exact two-step/ingredient/output fixture; discarded A 201; residue rediscovery; two contexts/sockets; rev1 active step, rev2 ingredient, rev3 output+scale, edit mismatch screenshot/Continue original, rev4 complete; B rev0, rev1 scale, rev2 abandon; purge/D1/user cleanup. Assert exact 10s HTTP, 15s frame, 60s D1, and hard 120s functional deadline; independent primary90+handoff5+recovery90 cleanup budget and 305s total upper bound; frame order; no C; every stop boundary; canonical production default; and the pre-Unit31 exact fresh-output file sets (`api-smoke-results.json`; lifecycle report plus six named screenshots) with task-relative report paths and no extras. Unit31 deliberately extends that lifecycle set with six primary-only cleanup files before release. Revalidate that runtime normalizes exact zero-length body bytes to null, rejects nonempty invalid JSON before projection, passes each response's actual transport status into Unit29.2's exact raw projector, and uses that same validated value for SanitizedExchange.status; add integration red cases proving mismatched status/envelope fails before write and projected CookWireErrorCode/data plus six CookFrameErrorCode/snapshot rules are used. Do not duplicate the exhaustive pure matrix. Add the remaining planning sanitizer red matrix: finite location/query/body/diagnostic enums and strict retained-header value grammars; URL userinfo/path-parameter/query-key/query-value/fragment sentinels; every sensitive header and normalized secret JSON key at every nesting/casing; schema-valid recipe text/URLs and disposable-email projection; auth/signup/unknown-body redaction without raw name/length/hash; exception name/code/message/cause/stack and stdout/stderr scrubbing into no-message NDJSON diagnostics; screenshot-after-auth ordering; recursive output-byte scans before hash acceptance; sanitized-byte hashes; and partial-output deletion on failure. Add `test/config/clem-feedback-coverage-gates.test.ts` to parse `vitest.config.ts` and require the exact eleven-script pre-visual task subset plus pure contract module in the full-suite coverage allowlist while preserving every inherited current-main entry, including advisory, existing smoke, QA-preflight, and canary scripts; every present task-owned script/module must be import-safe/measurable and focused tests must load each touched module.
Exhaustively test no-extra-fields CookSnapshot/Purge/Residue/Error evidence, SanitizedBody/Exchange/Frame/Diagnostic unions, finite headers/error codes, contiguous sequence/canonical-time rules, and the exact authoritative lifecycleEvents sequence/hash serialization; reject duplicate/missing A terminal, B start, or final-residue events before Unit31 consumes those hashes.
**Output**: `test/scripts/smoke-live-cook-session.test.ts`, `test/config/clem-feedback-coverage-gates.test.ts`.
**Acceptance**: Tests fail because lifecycle smoke and the pre-visual executable-script coverage allowlist are incomplete.

### ⬜ Unit 30b: Two-Client Smoke Implementation
**What**: Implement the exact A/B lifecycle/oracles/independent functional-cleanup deadlines/closed pre-cleanup artifact sets and shared fail-closed pre-write sanitizer by importing Unit29.2's sole raw projector into `smoke-live-helpers.mjs`, then change `smoke:live`/production script default to `https://spoonjoy.app`; retain QA target and no-keep cleanup ownership. Raw transport/auth data remains memory-only; every report/log/frame/error is sanitized before console/filesystem/hash. Keep executable entrypoints import-safe, put branch-bearing behavior in directly imported helpers, and preserve/add the exact eleven pre-visual task-owned scripts plus pure contract module in the existing full-suite coverage allowlist without removing inherited entries or bypassing thresholds.
**Output**: `scripts/smoke-live.mjs`, `scripts/smoke-live-helpers.mjs`, `scripts/script-environment.mjs`, `package.json`, `scripts/deployment-preflight.ts`, `vitest.config.ts`; Unit29.2's `scripts/release-artifact-contract.mjs` remains unchanged and is imported as the sole projector.
**Acceptance**: Unit 30a passes; successful and failed synchronization produce useful sanitized artifacts, an accepted start with no usable response remains discoverable for cleanup, and every pre-visual task executable is measured by the full-suite threshold.

### ⬜ Unit 30c: Two-Client Smoke Verification
**What**: Run the complete Unit 30a script suite with focused coverage, then exact `pnpm run test:coverage`, script typecheck, typecheck, and build; record evidence only.
**Output**: `unit-30-smoke-sync.log`.
**Acceptance**: New lifecycle smoke and shared sanitizer logic is 100% covered, the pre-Unit31 eight-file functional set is exact, the full suite enforces 100% over the exact eleven-script pre-visual subset plus inherited allowlist, and all commands pass with zero warnings.

### ⬜ Unit 31a: Smoke Purge And Cleanup Tests
**What**: Add red fake-clock tests for exact independent 90s/30-total/20-cook counters, `now>=deadline` and `now+delay>=deadline`, timeout, per-operation attempt reset, strict Retry-After grammar/fallback, owner/D1/admin retry classes, and exact 5s recovery handoff. Cover the standard residue envelope plus exact data parser/presentKeys/history/logical-expiry allowlist, `liveStateKeyCount`, target DELETE 202/purging/terminal-204 confirmation, fatal stale-other/404/non-target paths, pre-delete proof, deleted-user zero owner calls, existing-User auth inaccessibility, D1 cascade, and exact truthful flags `relationalProductRowsZero`, `contentBearingDoStateZero`, and `identifierBearingDoMetadataRetained`; reject `productDataZero` and any physical-erasure claim. Add red final-artifact tests for the planning-schema outcome/phase/fact JSONs; lifecycle reportAttempts A+B versus purgeTargets B; exact no-extra-fields RetiredAttempt hashes linking A rev4 terminal, later B start, final live-zero residue, D1 zero, and user deletion without DELETE A; Visual sole report/target attempt; each purge target's unique cross-linked terminal DELETE 204/purgeCompletedAt; immutable create-once phase/proof files; final outcome cross-hashes; primary-only provenance; present-user recovery; absent-user recovery that byte-verifies primary, makes zero owner calls, and adds only recovery phase/post-delete evidence; exact finite failure enums/pass arrays; all seven derived Cleanup flags; diagnostic-only terminal-failure/incomplete outcomes; forged/mutated/hash/no-trace/relabelled-phase rejection; exact 14-file primary API+lifecycle set; and recovered extra-phase non-release set. Add red `test/scripts/production-visual-dogfood.test.ts` for import safety, required flags, fresh-out, exact health identity, one user/anonymous contexts, exact 21-capture registry/order/route/viewport/fixture/basename mappings, DOM privacy preflight and sentinel failures, exact dimension PNGs without textual metadata/trailing bytes, no-extra-fields VisualReport/VisualMetrics, exact per-metric PNG hash equality, numeric metric bounds, literal closed-ledger bytes, exact output-relative-basename/BINARY-sorted 30-file aggregate serialization/hash, shared sanitizer/cleanup imports, primary cleanup, atomic output, and exact 30-file success; upgrade the coverage gate from the exact eleven pre-visual scripts to the final twelve-member set. Treat Unit0's cleanup `--assert-clean` contract as an already-green dependency; do not duplicate its tests here.
Explicitly reject duplicate cross-phase PurgeCompletion, a recovery DELETE after primary completion, duplicate/different candidate final residues, retiredAttempts outside the retained-proof-producing phase, and any proof hash claimed by zero or multiple phases.
Add red D1/admin tests for the parameterized terminal-projection retirement command and parser: exact userId plus RetiredAttempt ids, terminal-status predicate, A-only lifecycle deletion, visual no-op, SQL-injection resistance, retry classes/budgets, changes/remaining parsing, another-user/B/table safety, immutable nested receipt, and pre-delete zero only after receipt success.
**Output**: `test/scripts/smoke-live-cleanup.test.ts`, `test/scripts/smoke-live-helpers.test.ts`, `test/scripts/production-visual-dogfood.test.ts`, `test/config/clem-feedback-coverage-gates.test.ts`.
**Acceptance**: Tests fail only because cleanup reliability, the production visual runner, and its twelfth coverage/typecheck entry are absent.

### ⬜ Unit 31b: Smoke Purge And Cleanup Implementation
**What**: Implement the planning smoke cleanup state machine/counters/classifier, exact reportAttempts/purgeTargets, terminal-204 completion, immutable phase evidence, create-once fact proofs, and final cross-hashed outcome written last; instrument the complete owner trace, derive Cleanup, and support post-delete proof-only recovery. Purge current B only; prove retired A through hashed terminal/replacement/residue/D1/deletion evidence. Recovery byte-verifies primary and every existing proof without overwrite/relabel, adds only evidence first produced in recovery, and refuses Cleanup release construction for failed/incomplete final evidence. Implement import-safe `production-visual-dogfood.mjs` on this now-green cleanup engine and Unit30's shared sanitizer with explicit base/SHA/version/out flags, one disposable user, anonymous contexts, the immutable 21-capture registry executed against each exact changed route (`home`, `cook_recipe`, `recipe_detail`, `recipe_edit`, `my_recipes`, `recipes_index`, `user_kitchen`), DOM privacy proof, exact VisualReport/VisualMetrics/literal ledger, primary cleanup, and atomic 30-file output; add it as the twelfth measured task script. Never call DO after user absence, call retained identifier metadata product-data zero, or claim physical metadata deletion. Preserve Unit0's already-green broad cleanup oracle unchanged.
Implement the scoped Wrangler D1 terminal-projection retirement in `smoke-live-helpers.mjs`: validate canonical user/recipe/attempt identifiers, quote only validated values through existing `sqlString`, and transactionally delete only identity.userId plus exact terminal RetiredAttempt tuples while returning changes/same-user remaining rows; parse those exact results under bounded D1/admin retries, emit the nested ProjectionRetirementReceipt, and never translate this operation into a cook-session DELETE.
**Output**: `scripts/smoke-live.mjs`, `scripts/smoke-live-helpers.mjs`, `scripts/production-visual-dogfood.mjs`, `package.json`, `vitest.config.ts`, `tsconfig.scripts.json`; runtime primary `cleanup-outcome.json`, `cleanup-phase-primary.json`, `cleanup-pre-delete-rows.json`, `cleanup-user-delete.json`, `cleanup-post-delete-rows.json`, and `cleanup-retained-do-allowlist.json`, plus `cleanup-phase-recovery.json` only when recovery runs.
**Acceptance**: Unit 31a passes; primary lifecycle output is the exact final 13-file set and API+lifecycle union is 14; every Cleanup flag is recomputed from immutable cross-linked evidence; the visual runner cannot write unsanitized bytes and is fully measured; functional smoke failure still cleans; recoverable cleanup failure gets one bounded clean diagnostic recovery but cannot pass release; irrecoverable cleanup is never reported clean and blocks ship until a later rerun proves relational/content-bearing/live-state zero plus the exact retained-metadata inventory.

### ⬜ Unit 31c: Smoke Cleanup Verification
**What**: Run the complete Unit 31a smoke/visual script suite with focused coverage, exact full `pnpm run test:coverage` over the final twelve-script task subset plus inherited scripts, script typecheck, plain local dry-run inspection, and `pnpm cleanup:qa -- --assert-clean`; record evidence only.
**Output**: `unit-31-smoke-cleanup.log`.
**Acceptance**: New cleanup/proof/visual-runner logic is 100% covered with zero warnings; the final primary-only 14-file API+lifecycle and 30-file visual sets have no extras and hash-validate, recovery adds only its declared phase file and is release-ineligible, plain dry-run reports inspection data, and exact `--assert-clean` proves no disposable local data.

### ⬜ Unit 32: Final Local Validation
**What**: Verify the already-processing Desk task exact values. Begin release convergence only now: `git fetch origin main` without `git pull`, merge exact origin/main into the agent branch when needed, never update canonical local main, and finish all tracked code/docs/progress before evidence. Commit/push the final task-local AUTOPILOT snapshot stating Units0-31 completion and exact transfer of release continuity/status/checklists to external Desk task/active `continuity.md`/manifest; after that commit, no Unit32-37 generic progress write may touch tracked planning/doing/AUTOPILOT files. Set TESTED_BASE_SHA=origin/main, BRANCH_HEAD_SHA=HEAD, and BRANCH_HEAD_TREE_SHA=`HEAD^{tree}`; require ancestor/clean/pushed, perform exact one-time manifest initialization or its proven crash recovery, append the planning-schema ReleaseRun and unit32 StageRun whose run numbers qualify every artifact path, then execute `release-continuity-transfer` as the stage's first required logical command before any local-validation command. That command creates/updates external Desk release continuity with the frozen SHAs and records the transfer in its immutable attempt artifacts. Run the planning doc's literal `--assert-clean` local sequence from cleanup through final empty status, with each command captured in its immutable qualified attempt directory and zero warnings by the exact classifier. Run fresh implementation/test/security_privacy/migration_config reviewers. Fixes supersede the run and restart Unit32; any tracked fix updates the transfer snapshot before recapture. Pass only through tested manifest/helper/external-continuity evidence.
Initialize the planning-defined release command executor with exact REPO_CWD and active DESK_TASK_ROOT before the first command; execute Unit32's exact 22 logical names in order. Every Unit32-37 process runs in REPO_CWD with resolver-produced absolute Desk attempt/log paths, only command specs with a native/output-writer contract receive optional out, and manifest entries remain task-relative.
**Output**: `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-32/stage-<StageRun.run>/unit-32-local-validation.md`, external Desk `continuity.md`, and immutable command-attempt logs; do not change tracked branch files after SHA capture.
**Acceptance**: Every command exits zero with zero warnings and 100% new-code coverage; local migrations are rerunnable; generated output is clean; every actionable reviewer finding is fixed and the full command/review gate rerun on the resulting HEAD; tracked HEAD stays clean/pushed while external Desk continuity records the current release state and next action.

### ⬜ Unit 33: QA Deploy And Cross-Device Gate
**What**: At unchanged BRANCH_HEAD_SHA/BRANCH_HEAD_TREE_SHA append unit33 StageRun. Capture normalized QA deployments before; run exact commands `pnpm cleanup:remote:qa:apply`, `pnpm cleanup:remote:qa -- --assert-clean`, `pnpm run qa:preflight`, and `pnpm run deploy:qa`; capture after/diff; poll health at t=0,5..180 to BRANCH_HEAD_SHA with exact body/header. Run API and lifecycle smoke into each command's exact fresh `artifacts/release-<releaseRun>/unit-33/stage-<stageRun>/<logicalName>/attempt-<commandAttempt>/out/`, never a reused release/unit directory; finally run `pnpm cleanup:remote:qa -- --assert-clean`. Require the exact closed 14-file smoke artifact set/hashes and parser-derived top-level Cleanup from exact primary outcome/phase/fact proofs, including B terminal 204, hashed A retirement, pre-delete DO allowlist/D1 proof, post-delete user+D1 zero, no traced post-delete owner call, and no recovery phase. Persist exact Unit33 evidence through helper; any tracked/head/tree change supersedes and loops Unit32.
The manifest path shown above is the stored task-relative suffix; the executor runs every process in REPO_CWD, captures absolute Desk logs for all attempts, and passes resolver-produced absolute `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/.../out` only to the two smoke CLIs that declare `--out`.
**Output**: `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-33/stage-<StageRun.run>/unit-33-qa.md`, deploy version/URL, smoke screenshots/logs, cleanup and DO/D1 residue logs; no tracked branch edit.
**Acceptance**: QA deploy/smokes exit zero for the exact recorded branch HEAD SHA before PR merge, including primary cleanup without recovery; DO/current-row/pre-delete and all-history/post-delete D1 oracles pass; no disposable relational or content-bearing cook state remains, and retained identifier-bearing DO metadata is explicitly inventoried.

### ⬜ Unit 34: PR Creation And Fresh Review
**What**: Invoke work-merger exactly once now with this doing doc/branch and an explicit brief that this task contract overrides its generic merge-method, cleanup, and tracked continuity/progress defaults: after its permitted fetch/integration loop it must skip generic merge-first/fallback, use only Unit36 squash, defer branch/worktree cleanup until Unit37, and route every required Arc/AUTOPILOT/status/checklist update to external Desk task/continuity/manifest without modifying frozen tracked files. That same invocation owns Units34-37. It fetches main without pull; if main differs from TESTED_BASE_SHA, merge it into the agent branch and supersede/loop Units32-33. Otherwise open/reuse one ready PR at exact BRANCH_HEAD_SHA, then run fresh implementation/design_visual/test/security_privacy/migration_config/api_compatibility reviewers. Fixes supersede and loop Units32-34. Record exact PR/reviewer/continuity evidence through helper; no rewrite after QA.
**Output**: PR URL and `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-34/stage-<StageRun.run>/unit-34-pr-review.md`.
**Acceptance**: PR head exactly equals the last Unit 33 SHA; `TESTED_BASE_SHA` is recorded and contained in that head; no post-QA rewrite/commit exists; every actionable review finding is fixed and the resulting head has rerun Units 32-33/reviews.

### ⬜ Unit 35: CI Convergence
**What**: In the same work-merger invocation, append unit35; require live main branch protection `strict:true` and `required_linear_history.enabled:true`, capture its required status-check contexts, form their sorted unique union with mandatory `workers-coverage`, and require every resulting Check `{name,url,conclusion:"success",headSha:BRANCH_HEAD_SHA}`. The current observed protected set is `coverage`, `e2e`, and `build-storybook`, but the live capture is authoritative if it changes. Any repair/protection mismatch supersedes and loops Units32-35/reviews. Persist exact protection/Check/set evidence; no unresolved comment.
**Output**: Green check URLs and `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-35/stage-<StageRun.run>/unit-35-ci.md`.
**Acceptance**: Every required check is green for current head SHA with no unresolved review comment.

### ⬜ Unit 36: Merge
**What**: In the same work-merger invocation append unit36. Immediately fetch main and reread protection; require exact TESTED_BASE_SHA, `strict:true`, linear history, ancestor/head/tree/clean reviews+checks, otherwise merge the new base into the agent branch and supersede/loop Units32-35. Recheck QA health exact head at t=0,5..180. Immediately before squash capture immutable normalized production deployments. Run exact `gh pr merge <pr> --repo <repo> --squash --match-head-commit <BRANCH_HEAD_SHA>` with no merge/rebase/admin fallback; a concurrent base advance must be rejected by strict protection and loop. Discover exact `SquashCommit={sha,parents:[Sha],treeSha}`; require `sha===mergeSha`, `parents===[TESTED_BASE_SHA]`, and `treeSha===BRANCH_HEAD_TREE_SHA`, then persist Unit36 evidence/top-level mergeSha. Never invoke work-merger again.
**Output**: Squash evidence and `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-36/stage-<StageRun.run>/unit-36-squash.md`.
**Acceptance**: Current PR head equals the latest Unit 33 SHA, current origin/main equals tested base, merge state is clean, and every check/review is green; the resulting tested tree is merged and exact merge SHA recorded.

### ⬜ Unit 37: Production Deploy, Smoke, Cleanup, And Handoff
**What**: In the same work-merger invocation append unit37 and carry Unit36 deployments. The executor runs every process from `/Users/arimendelow/Projects/spoonjoy-v2-clem-feedback`; every attempt gets resolver-created absolute Desk logs, only release-provenance/smoke/visual command specs receive their native absolute Desk output path, and the manifest stores the normalized `artifacts/...` suffix. Run exact `pnpm release:provenance -- discover-ci --repo spoonjoy/spoonjoy-v2 --source-sha <mergeSha> --workflow-path .github/workflows/ci.yml --out /Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-37/stage-<StageRun.run>/ci-workflow-discovery/attempt-<Command.attempt>/out`; exact `pnpm release:provenance -- discover-production --repo spoonjoy/spoonjoy-v2 --source-sha <mergeSha> --workflow-path .github/workflows/production-deploy.yml --out /Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-37/stage-<StageRun.run>/workflow-discovery/attempt-<Command.attempt>/out`; exact `pnpm release:provenance -- watch-workflow --repo spoonjoy/spoonjoy-v2 --run-id <selectedId> --source-sha <mergeSha> --workflow-path .github/workflows/production-deploy.yml --out /Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-37/stage-<StageRun.run>/workflow-watch/attempt-<Command.attempt>/out`; exact `pnpm release:provenance -- verify-deploy-job --repo spoonjoy/spoonjoy-v2 --run-id <selectedId> --source-sha <mergeSha> --job-name deploy --out /Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-37/stage-<StageRun.run>/deploy-job/attempt-<Command.attempt>/out`; and exact `pnpm release:provenance -- download-artifact --repo spoonjoy/spoonjoy-v2 --run-id <selectedId> --source-sha <mergeSha> --tree-sha <BRANCH_HEAD_TREE_SHA> --artifact-name mcp-oauth-canary-artifacts --out /Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-37/stage-<StageRun.run>/release-artifact-download/attempt-<Command.attempt>/out`. These enforce completed-success exact-merge CI `push`, t=0,10..300 newest exact automatic production candidate freezing, t=0,10..1800 immutable-ID watch to success, exact deploy success, and one hash-valid promoted `production-release.json` with source/tree/migration/version contract. Capture normalized production after/diff without claiming id correlation. Run exact `pnpm release:provenance -- verify-health --base-url https://spoonjoy.app --source-sha <mergeSha> --worker-version-id <candidateVersionId> --out /Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-37/stage-<StageRun.run>/production-health/attempt-<Command.attempt>/out` at t=0,5..180; require build body/header/Worker-version equality. Run exact `pnpm run production:readiness`, pre-smoke `pnpm cleanup:production -- --assert-clean`, and API/lifecycle smokes with resolver-created absolute Desk `out/` directories. Under `production-visual-dogfood`, run exact `pnpm run production:visual-dogfood -- --base-url https://spoonjoy.app --source-sha <mergeSha> --worker-version-id <candidateVersionId> --out /Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-37/stage-<StageRun.run>/production-visual-dogfood/attempt-<Command.attempt>/out`; require its shared sanitizer/proof writer, one disposable authenticated user plus anonymous contexts, complete mobile/desktop/guest-wide cook/save/tag/home matrix, and atomic closed 30-file primary-only output whose VisualReport/VisualMetrics/literal ledger parse exactly and whose lexicographically sorted file-hash list yields visualArtifactSetSha256. Next execute required logical command `production-visual-qa-review`: invoke `visual-qa-dogfood` read-only against the live site and immutable runner output and write/hash exactly `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-37/stage-<StageRun.run>/production-visual-qa-review/attempt-<Command.attempt>/out/visual-qa-review.md`. Then execute `production-visual-design-review` with a fresh distinct design reviewer and write/hash exactly `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-37/stage-<StageRun.run>/production-visual-design-review/attempt-<Command.attempt>/out/visual-design-review.md`. Neither review edits the runner output or persists raw reviewer prose: a non-CONVERGED verdict fails without a report, while CONVERGED is projected into the planning-defined canonical eight-line report. Each canonical report must cross-link the same source/artifact-set hash and yields exact VisualReviewer evidence; any finding triggers a code fix and full Unit32-37 loop. Both lifecycle and visual runners persist exact outcome/phase/fact evidence; parsers require target terminal 204, hashed retirement/projection receipt, no recovery, no non-target DELETE, and no owner call after deletion. Run final `pnpm cleanup:production -- --assert-clean`. Require the closed 14-file smoke set, semantically parsed closed 30-file Visual set/aggregate hash, two canonical parsed and hashed review reports, both primary-only Cleanup objects, exact retained metadata, and zero disposable relational/content-bearing state. Run continuation scan, pass/push product manifest and external continuity, transition/archive Desk, and revalidate/push archive. Before deferred cleanup prove origin/main/PR/squash tree evidence, remote feature ref absent-or-exact, and clean task worktree; then remove the task worktree, use recorded squash proof for the explicit local `branch -D` exception, delete the exact remote branch without force, prune, and prove task path/local ref/remote ref absent plus canonical repo/Desk clean. This terminalizes product/task completion; Slugger is post-completion and outside this unit.
**Output**: Active `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-37/stage-<StageRun.run>/unit-37-production.md`, moved unchanged at archive to `/Users/arimendelow/desk/spoonjoy-v2/_archive/clem-feedback-e2e/artifacts/release-<ReleaseRun.run>/unit-37/stage-<StageRun.run>/unit-37-production.md`, plus CI/workflow/canary/version URLs and artifact, `https://spoonjoy.app` smoke/visual evidence, closed absurdity ledger/metrics/screenshots, hashed `visual-qa-review.md` and `visual-design-review.md`, cleanup/external-continuation logs, and clean terminal git/Desk state.
**Acceptance**: Exact SHA is live; all smokes and deployed production visual dogfood pass; both distinct visual reviewer commands/evidence pass with no open finding; no visual ledger item, disposable relational/content-bearing state, or ready in-scope follow-up remains; retained identifier-bearing DO metadata is truthfully inventoried; git/Desk/worktree state is terminal and clean.

## Execution
- External Desk task is exact `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/task.md`; Units32-37 artifacts root is exact `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/artifacts/` until archive.
- `./2026-07-14-1313-planning-clem-feedback-e2e.md` defines exact shopping, cook, SavedRecipe, RecipeTag, REST v1, privacy, purge, and deployment behavior. Any contract change requires an immediate planning-doc update and fresh reviewer convergence before implementation resumes.
- Cook HTTP uses exact envelopes/request ids/messages/headers; every non-101 including bodyless 204 carries request-id/private headers. UUIDs match exact lowercase `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`; all wire/storage integers are safe and satisfy declared bounds. PATCH/first terminal increments once; terminal timestamp equals monotonic updatedAt; PURGING alone preserves revision/updatedAt while changing status. Live replay returns recorded status/outcome plus current evolved snapshot. Start has global 64 live/tombstone capacity; mutation ledger is 256 per attempt.
- Cook WebSockets are read-only and emit only `snapshot`/`error` server frames. Client data closes `1003 Read-only subscription`; attempt replacement closes `4000 Attempt replaced`; purge closes `4001 Session purged`; hibernation attachments carry version/user/recipe/attempt.
- Recipe hashing uses the planning doc's exact snapshot schemas, nested sort orders, recursive lexicographic object-key ordering, explicit nulls, finite ECMAScript JSON numbers with negative zero normalized, unchanged stored strings, UTF-8, and lowercase SHA-256 hex.
- Projection retry delays are exactly 2, 4, 8, 16, 32, then 60 seconds forever. Purge tests separately inject every named persistence/broadcast/socket-drain/D1/crash/local-transaction boundary in planning; a test named only "partial failure" is insufficient.
- D1 projection uses the planning doc's exact `CookSessionIndex` columns/indexes and version-1 UPSERT/DELETE queue schema. Remote cleanup proves owner-only residue zero, current/purged D1 absence before disposable-user deletion, and all of that user's D1 history gone after cascade.
- Saved REST list is newest-first with default 20/max 50 and the planning doc's canonical unpadded byte-exact `v1.<base64url(JSON)>` cursor; response data is `{ limit, cursor, nextCursor, hasMore, recipes }`. PUT/DELETE source `clientMutationId` body -> `X-Client-Mutation-Id` -> query and return the exact 200 `{ recipeId, saved, mutation }` payload.
- Tag display canonicalization removes leading/trailing and collapses interior runs of exactly U+0009..000D, U+0020, U+0085, U+00A0, U+1680, U+2000..200A, U+2028, U+2029, U+202F, U+205F, and U+3000; U+FEFF is preserved. It then enforces 1..40 Unicode scalar values and computes NFKC-lowercase identity. `trim()`, `\s`, and `localeCompare` are forbidden. Ten custom tags max, course-word reservation, first-label display casing, and normalizedLabel/id Unicode-scalar/BINARY order apply. Database triggers/partial uniqueness enforce concurrency invariants; immutable migration 0027 creates the singleton search lease. Filters are one `course`, repeatable `tag`, AND across all scopes/tags before rank/limit, with malformed/over-limit input returning 400.
- Shopping batches use the planning doc's list-level version/lease transaction, empty-list zero allocator, original-order aggregate override rule, eight-attempt fixed backoff, and exact web/REST/MCP busy errors. Cook idempotency hashes canonical validated payloads, applies ordered duplicate operations last-wins, and atomically rejects any invalid operation.
- Authenticated offline state uses the exact user/recipe/client-tab-scoped v1 record/queue/command schema and 256/64 bounds in planning; tabs never share a local queue and converge through the DO. Deploy correctness is proven by no-store `/health` body/header build SHA, not deployment timestamps.
- Tests -> confirmed red -> implementation -> green -> refactor for every a/b/c group.
- Commit/push each intentional-red `a` checkpoint and green `b` checkpoint; keep `c` verification-only, then update group emojis/progress and run a newly spawned, context-independent group reviewer after every a/b/c group (Unit 0, Units 1-28, 29.1, 29.2, and 30-31). "Fresh" means a new sub-agent given only the approved planning/doing docs, current diff/commits, and test evidence. Every actionable finding is fixed with a new red/green cycle and re-reviewed; no severity is silently waived.
- Every `d` unit runs `visual-qa-dogfood` plus a newly spawned visual reviewer after fixes. Units 29, 32, and 34 are their own explicit audit/review gates; Units 33-37 use their named acceptance gates rather than the group-review rule.
- Every `a` and `c` unit whose paired implementation edits `app/lib/api-v1.server.ts` or `app/lib/spoonjoy-api.server.ts` includes existing `test/lib/recipe-cover-service-architecture.test.ts` in its targeted command as a must-remain-green invariant; the task does not edit that oracle or duplicate cover orchestration without a new scoped red/fix/green sub-unit.
- Store every command/log/screenshot in the artifact directory.
- Initial adoption before the first Work Doer entry keeps the exact external task `/Users/arimendelow/desk/spoonjoy-v2/clem-feedback-e2e/task.md` drafting with `planning_complete:false` and synchronizes its adopted iteration after each reviewer checkpoint. The initial final Work Planner convergence handoff alone sets doing `READY_FOR_EXECUTION`, task `planning_complete:true`, and task/track `processing`, then synchronizes and pushes the in-repo doing/progress/AUTOPILOT state and all Desk mirrors before invoking Work Doer. If Unit0 subsequently reopens planning for main drift, keep the already-started task/track `processing` with `planning_complete:true` throughout that reviewer detour; planning becomes `NEEDS_REVIEW`, doing becomes `drafting`, and reviewed/gate metadata reopen, then reconvergence restores `approved`/`READY_FOR_EXECUTION` before Unit0 restarts. Unit0 only verifies committed lifecycle state. Through Unit31, tracked task-local AUTOPILOT is authoritative and Desk continuity mirrors it. Unit32's final tracked transfer commit explicitly makes external Desk task/continuity/manifest authoritative for Units32-37; thereafter every generic Work Doer/Work Merger Arc, status, emoji, checklist, and progress write is recorded there instead of frozen tracked files. Units32-37 write operational evidence only under its `artifacts/` root plus GitHub/Cloudflare surfaces. They must not create an unvalidated branch HEAD. Any later tracked change invalidates the gate and loops through Units 32-33.
- Commit/push the Desk task plus complete artifact/manifest state after every terminal Unit32-37 StageRun; never begin the next stage/retry from an unpushed terminal evidence checkpoint. Unit37 pushes passed evidence before a separate done/archive commit/push.
- Invoke `visual-qa-dogfood` for every d unit, invoke `work-merger` exactly once at Unit 34 to own Units 34-37, and use `stay-in-turn` through CI/deploy.
- Never leave smoke/manual users, recipes, saves, tags, or content-bearing/live cook state behind; record the exact allowed identifier-bearing DO arbitration metadata separately.
- After Unit37 acceptance and all terminal cleanup, attempt exact `ouro msg --to slugger "Done: shipped Clem feedback end to end"` once as a best-effort final external handoff with no later mutation. Its known failure is reported without reopening the shipped task; reconcile an uncertain outcome through the Ouroboros oracle before any retry.

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
- 2026-07-15 Ambiguity Round 13 fixed 23 findings spanning evolved replay/PURGING semantics, unit sequencing, in-DO D1 linearization, exact hashes/target order/transport, crash-persistent cross-tab cleanup, private caches, retained metadata boundaries, cleanup budgets/classifiers, cursor continuation, tag whitespace/search projection, production-before evidence, timestamps/numeric bounds, malformed anonymous v2, tombstone capacity, and the atomic release manifest.
- 2026-07-15 Ambiguity Round 14 fixed 37 reviewer findings spanning purge precedence/responses, replacement and permanent adoption history, exact DO storage/bindings/auth, bounded projection queues, client transport/state/retries, nullable-unit shopping races and sentinels, tag/search boundaries, deterministic smoke oracles, and crash-resumable single-invocation release delivery; the latest-model local audit also fixed two fresh-worktree bootstrap omissions.
- 2026-07-15 Ambiguity Round 15 fixed all 34 frozen-checkpoint findings plus the latest-model self-audit: correct shopping ownership/legacy repair/transitions/timestamps/capacity; collision-free DO/client identity; one FIFO linearization boundary and exhaustive WebSocket/alarm behavior; complete tag hash/index/consumer contracts; independent smoke/cleanup deadlines and assert-clean proof; automated import/AI/Pebble/navigation boundaries; exact health/deployment capture; and a locked, warning-aware, archive-portable release manifest with retryable stage semantics, strict base-race-safe merge, deferred Work Merger cleanup, and truthful final notification ordering.
- 2026-07-15 Ambiguity Round 16 fixed 11 fresh findings: live linear-history protection now drives exact squash/sole-parent/tree verification; Slugger is a non-state-bearing post-completion handoff; DO snapshots/replay/tombstones/queues have exact canonical byte limits and reserved cleanup capacity; no-op shopping never bootstraps; concurrent tags have one casing rule; manifest initialization and retry artifacts are crash-safe/immutable; all search/provider file/test owners are explicit; repository warning formats and the deployment test command are closed.
- 2026-07-15 Ambiguity Round 17 integrated current main and fixed all seven fresh findings: workflow-run/canary source provenance, late-writer-proof user locks and generations, independent DO retry channels, same-inode lock recovery, release-qualified paths, exact SquashCommit, and task-contract Work Merger merge/cleanup precedence.
- 2026-07-15 Ambiguity Round 18 integrated `origin/main@e7b0e9ec` and self-fixed idempotent generation markers, cleanup-lock exceptions, retry-state/fsync invariants, explicit release-provenance files, completed-success workflow selection, canary migration/version validation, and public candidate-version evidence; the stalled fresh reviewer produced no verdict and does not count toward convergence.
- 2026-07-15 Ambiguity Round 19 inspected production run 29465177528 and issue #265, proving integrated main's one-shot candidate readiness is unstable across transports; Unit29.1 now owns a three-cycle dual-transport red/fix/green repair and exact provenance CLI. A second stalled fresh reviewer produced no verdict and does not count.
- 2026-07-15 Ambiguity Round 20 converged at pushed checkpoint `e27beb37` under a fresh, read-only context-independent reviewer; three earlier stalled reviewer attempts produced no verdict and do not count. The active gate advances to a fresh Quality review.
- 2026-07-15 Quality converged at pushed checkpoint `c5412fe7` under a fresh, read-only context-independent reviewer; all 120 units retained concrete output/acceptance contracts, strict red/green/verify ordering, and executable coverage, warning, review, merge, and release gates. Scrutiny starts with Tinfoil Hat.
- 2026-07-15 Tinfoil Round 1 found an ordering blocker and stale continuation metadata. Unit0 is now an explicit red/green/baseline group that implements and proves strict `--assert-clean` before invoking it; Unit31 no longer claims duplicate ownership. Quality must re-run because the unit structure changed, then Tinfoil restarts at zero clean passes.
- 2026-07-15 Quality re-converged at synchronized checkpoint `c9011544` under a fresh, read-only context-independent reviewer; all 122 revised units have matched output/acceptance contracts and coherent red/green/verify dependencies. Scrutiny restarts at zero clean passes with a fresh Tinfoil review.
- 2026-07-15 Tinfoil Round 2 found three issues: stale checkpoint labels, newer overlapping main, and incomplete server-side same-origin tests. Integrated `origin/main@7b06c496` (including landed cross-channel canary repair), recast Unit29.1 as adoption plus strict delta, added a pre-Unit0 main gate, and made exact Origin/fetch-metadata rejection a shared Unit10/11 red contract. State synchronization follows this content checkpoint; Quality and Scrutiny restart because planning changed.
- 2026-07-15 Quality re-converged on the current-main/same-origin revision at synchronized state HEAD `6c043d2f` under a fresh, read-only context-independent reviewer. Scrutiny restarts at zero clean passes with Tinfoil.
- 2026-07-15 Tinfoil Round 3 found three ownership/synchronization gaps. Unit29.1/29.2 now own explicit repo-wide coverage and script-typecheck allowlists plus red config gates; the active Desk iteration must byte-mirror all four repository task docs, its preserved-bundle path is corrected, and Unit0a blocks before setup when Desk/repo state differs. Quality and Scrutiny restart because planning changed.
- 2026-07-15 Quality re-converged on the release-script/Desk-mirror revision at synchronized state HEAD `a602166b` under a fresh, read-only context-independent reviewer. Scrutiny restarts at zero clean passes with Tinfoil.
- 2026-07-15 Tinfoil Round 4 found only lagging operational review metadata at reviewer-input HEAD `2ea77f5d`; no planning/product contract changed. Continuation now distinguishes the reviewed contract checkpoint from the latest completed reviewer input HEAD and records the exact active gate; Tinfoil re-runs on this state-only record commit.
- 2026-07-15 Tinfoil Round 5 converged with no findings at exact reviewer-input HEAD `d817e911`; this is clean Scrutiny pass one. No contract changed; a fresh Stranger With Candy pass runs immediately on the resulting record commit.
- 2026-07-15 Stranger Round 1 found one lifecycle-owner blocker, resetting the clean pair. The final Work Planner convergence handoff now solely owns `READY_FOR_EXECUTION`/`planning_complete:true`/Desk processing and synchronized pushes before Work Doer; Unit0a is verification-only. Quality and Scrutiny restart because workflow ownership changed.
- 2026-07-15 Quality re-converged on the lifecycle-owner correction at exact reviewer-input HEAD `4334fb42` under a fresh, read-only context-independent reviewer. Scrutiny restarts at zero clean passes with Tinfoil.
- 2026-07-16 Tinfoil Round 6 found one continuity-path ambiguity, and session resync found overlapping `origin/main@dcf296bd`. The task-local AUTOPILOT file is now the sole explicit Clem authority; root state is excluded. Integrated main's redirect-safe three-channel readiness work is adopted, while Unit29.1 retains only the stricter three-consecutive-cycle, request-budget, and release-provenance delta. Quality and Scrutiny restart.
- 2026-07-16 Quality re-converged on the continuity/current-main revision at exact reviewer-input HEAD `08ef7082` under a fresh local-files-only reviewer. One isolated subprocess keychain failure produced no document review and is discarded as a non-verdict. Scrutiny restarts at zero clean passes with Tinfoil.
- 2026-07-16 Tinfoil Round 7 found one implementation-owner blocker. Unit29.1 now explicitly owns Vite build-SHA resolution/declaration plus health helper/route implementation and adds a route-level red test; its complete targeted suite is ten files. Quality and Scrutiny restart.
- 2026-07-16 Quality Round 7 found two Unit29.1 acceptance gaps. The red gate now enumerates every owned missing contract as the only allowed failure set, and verification requires every named command green with zero warnings, coverage, exact-HEAD build proof, and clean git. Quality re-runs before Scrutiny.
- 2026-07-16 Quality Round 8 converged with no findings at exact reviewer-input HEAD `8f183fc1` under a fresh local-files-only reviewer. Scrutiny restarts at zero clean passes with Tinfoil.
- 2026-07-16 Tinfoil Round 8 found one executor ambiguity: Unit29.1c named categories rather than commands. It now prints the literal ten-file coverage invocation, every typecheck/preflight/build command, exact built-HEAD search, index/worktree diff checks, and final empty status oracle. Quality and Scrutiny restart.
- 2026-07-16 Quality Round 9 converged with no findings at exact reviewer-input HEAD `9f706dbb` under a fresh local-files-only reviewer. Scrutiny restarts at zero clean passes with Tinfoil.
- 2026-07-16 Tinfoil Round 9 converged with no findings at exact reviewer-input HEAD `5db28582`; this is clean Scrutiny pass one. No contract changed; a fresh Stranger With Candy pass runs immediately on the resulting record commit.
- 2026-07-16 Stranger Round 2 converged with no findings at exact reviewer-input HEAD `e4dbbfb0`, immediately after clean Tinfoil with no contract change. The required consecutive Scrutiny pair is complete; the final planner handoff marks this doing doc ready and Desk processing before Work Doer starts Unit0a.
- 2026-07-16 09:25 Unit0 main-freshness preflight stopped before dependency setup/red tests, merged `origin/main@2f392840`, audited all three overlapping commits, and reopened Quality plus consecutive Scrutiny review at content checkpoint `2e55c06c`.
- 2026-07-16 Quality Round 10 found one lifecycle contradiction in the execution appendix; initial adoption now owns drafting/incomplete state, while post-start main-drift review explicitly preserves processing/complete state. Quality re-runs before scrutiny.
- 2026-07-16 Quality Round 11 converged with no findings at exact reviewer-input HEAD `2e7ce49b`; current-main overlap ownership, unit structure, lifecycle state, and validation gates are coherent. Scrutiny restarts at zero clean passes with Tinfoil.
- 2026-07-16 Tinfoil Round 10 found template, retained-metadata evidence, executable-script coverage, and My Recipes pagination blockers at reviewer-input `149d1699`. All four are fixed at contract checkpoint `23afdf16`; Quality and scrutiny restart because behavior/evidence ownership changed.
- 2026-07-16 Quality Round 12 converged with no findings at exact reviewer-input HEAD `fa7841e0`; template compliance, truthful cleanup evidence, closed script coverage, pagination ownership, and all 122 unit contracts are coherent. Scrutiny restarts at zero with Tinfoil.
- 2026-07-16 Tinfoil Round 11 found three release-convergence gaps at reviewer-input `f5f6d52c`: tracked AUTOPILOT writes after SHA freeze, unmeasured Vite SHA branches, and missing deployed production visual dogfood. All three are fixed, and Unit32 now creates its ReleaseRun/StageRun before executing the stage-owned continuity-transfer command. Quality and scrutiny restart.
- 2026-07-16 A second Unit0 freshness check found and merged `origin/main@1bea760b`. Units0/29 now prove the shared cover-service and advisory gates; every overlapping adapter group keeps the cover architecture test green; coverage additions preserve inherited script entries. Quality and scrutiny restart on the new base.
- 2026-07-16 Quality Round 13 converged with no findings at exact reviewer-input `8ca84e9e`; templates, all 122 units, current-main regression ownership, and complete delivery gates are executable. Scrutiny restarts at zero with fresh Tinfoil.
- 2026-07-16 Tinfoil Round 12 found three release blockers at reviewer-input `0eaa35ff`: production discovery could never reach its long watcher for a slow queued run, visual cook state lacked its own DO purge proof, and production screenshots skipped tag display. The contract now freezes a nonterminal candidate before watching, gives the sole visual user nested Cleanup evidence, and closes a 29-file/21-screenshot visual set across detail/list/card display. Quality and scrutiny restart.
- 2026-07-16 Quality Round 14 found three executor gaps at reviewer-input `9cb7174f`: no deploy-job red matrix, asserted rather than derived visual cleanup, and incomplete Unit37 command lines. Tests now cover every deploy-job state/error; five exact cleanup schemas derive nested Cleanup; every provenance command has complete flags and its own qualified out path. Quality restarts.
- 2026-07-16 Quality Round 15 found three evidence gaps at reviewer-input `b93da825`: a forged no-post-delete flag, asserted top-level smoke Cleanup, and incomplete deploy-job status/parser cases. Unit31 now adds five proof files and finalizes a 13-file smoke set; both Cleanup objects are derived from traces through post-delete observation; every job state/conclusion/field branch is explicit. Quality restarts.
- 2026-07-16 Quality Round 16 found three evidence/security gaps at reviewer-input `d50d2d56`: lifecycle A was incorrectly treated as a purge target, recovery flags lacked pass provenance, and persisted lifecycle artifacts could retain credentials. Tests and implementation now separate reportAttempts/purgeTargets, preserve primary versus recovery evidence without relabelling, derive every Cleanup flag, and fail closed on unsanitized persisted or logged bytes. Quality restarts.
- 2026-07-16 Quality Round 17 found four execution blockers at reviewer-input `cdaecb59`: retirement and terminal purge lacked exact cross-links, recovery would mutate primary evidence, sanitizer strings were not finite, and production visual dogfood lacked an owned runner. Units29.2-31 and Unit37 now test and implement immutable phase/outcome evidence, exact A/B proof, finite sanitization, a twelve-script coverage set, and the exact production visual command. Quality restarts.
- 2026-07-16 Quality Round 18 found six execution gaps at reviewer-input `54924c2b`: retained A projection versus pre-delete zero, descriptive sanitizer/event schemas, Unit29.2 runtime coupling, relative release outputs, and untracked visual review gates. Units29.2-31/37 now test and implement A-only projection retirement receipts, literal evidence unions, self-contained fixtures, absolute Desk output resolution, and two required hashed visual reviewer reports. Quality restarts.
- 2026-07-16 Quality Round 19 found three deterministic-execution gaps at reviewer-input `514fd9a3`: visual report/metric/ledger/reviewer contents were not finite, sanitized cook error names did not map every exact wire code, and the release executor incorrectly implied unsupported `--out` flags while leaving Unit32 names unfrozen. Units29.2-31/37 now test and implement exact visual registries/schemas/canonical reports, exact CookWireErrorCode/status mapping, command-spec-aware attempt/log/output resolution, and Unit32's frozen 22-name order. Quality restarts.
- 2026-07-16 Quality Round 20 found three evidence cross-link gaps at reviewer-input `903dc524`: sanitized HTTP error current-state fields lacked code-dependent identity/null rules, VisualMetric omitted its screenshot hash, and the 30-file aggregate did not define serialized path bytes. Units29.2/30/31 now test and implement exact stale/purging snapshot identity, metric-to-PNG hashes, and BINARY-sorted output-relative-basename aggregate serialization. Quality restarts.
- 2026-07-16 Quality Round 21 found two proof-ownership gaps at reviewer-input `052b72a2`: four visual families targeted neighboring routes instead of their changed surfaces, and raw HTTP/frame projection was first tested after persisted ingestion. The registry now targets authenticated home, recipes index, and user kitchen exactly; Unit29.2 owns one pure exhaustively tested projector imported by release evidence and later smoke/visual runtimes. Quality restarts.
- 2026-07-16 Quality Round 22 found four contract gaps at reviewer-input `4bde26bf`: public-only bearer principals could receive private `isSaved`, raw HTTP projection could not compare transport status, profile RecipeGrid tags lacked loader ownership, and MCP recipe metadata/scaling had no disposition. Units3/4/20.3/26/27.2/29/29.2 now enforce exact entitlement, transport binding, live-route data mapping, and shared REST/MCP neutral read projections. Quality restarts.
