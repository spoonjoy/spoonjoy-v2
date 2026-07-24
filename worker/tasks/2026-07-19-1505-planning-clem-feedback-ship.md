# Planning: Ship Clem Feedback

**Status**: READY_FOR_EXECUTION (2026-07-21 audited review converged)
**Created**: 2026-07-19 15:05
**Revised**: 2026-07-21 11:59 PDT

## Goal
Ship Clem's accepted feedback as focused Spoonjoy behavior: cross-device cooking, consistent shopping restoration, private saves, manual tags, and neutral recipe metadata/scaling. Preserve navigation and the agent/API-only import model while adding no Pebble-specific behavior.

## Scope

### In Scope
- Keep anonymous cook progress entirely browser-local.
- Store all authenticated cook state, discovery metadata, receipts, scheduling, and live connections in one SQLite-backed Cloudflare Durable Object per owner. D1 stores recipe source data but no cook state or cook index.
- Make authenticated cook progress discoverable and resumable across devices without a recipe identifier, with hibernatable WebSocket synchronization.
- Pin each active attempt to its starting recipe snapshot and use revision plus idempotency checks for every mutation.
- Add operator/future-account-workflow owner deletion with a permanent fail-closed tombstone before relational user deletion, gated by a reserved short-lived deletion-intent credential.
- Route web, REST v1, MCP, and legacy shopping additions through one atomic add/restore behavior.
- Add canonical private `SavedRecipe` state distinct from cookbook membership and social activity.
- Add one controlled course and up to ten owner-authored recipe tags, with neutral read parity and filtering.
- Add optional read-time scaling to REST detail and MCP `get_recipe` without changing stored values.
- Add one forward-compatible numeric D1 migration, `0025_clem_feedback_product.sql`, for SavedRecipe, RecipeTag, Recipe.course, and shopping repair only.
- Preserve the shipped SQLite Durable Object namespace and staged release lifecycle, then activate the product atomically and restore canaries only after both versions speak protocol v1.
- Preserve current navigation unless implementation exposes a concrete accessibility defect; validate every changed surface on mobile and desktop.

### Out of Scope
- First-party recipe import/upload UI. Existing legacy agent/API import remains supported and documented; `import_recipe_from_url` is not an MCP tool.
- AI tag inference, proposal storage, confidence/provenance, or review UI. The schema and service boundary must remain ready for a later non-canonical suggestion system.
- Any addition, removal, or reinterpretation of Pebble-specific fields, routes, names, fixtures, telemetry, documentation, or behavior; the exact existing baseline remains untouched.
- Any cook progress, cook discovery row, receipt, or projection in D1.
- Cross-user collaborative cooking, public cook history, or automatic `RecipeSpoon` creation.
- Global tag administration, cookbook tags, personalized `isSaved` recipe-read enrichment, or SavedRecipe native-sync/tombstone expansion.
- End-user account deletion UI/API. This task provides an operator-only reserved deletion-intent phase used by disposable cleanup and a future account-delete workflow; ordinary sessions/personal/OAuth credentials cannot invoke it.
- Broad navigation, search architecture, or deployment-system rewrites.

## Completion Criteria
- [ ] Every feedback row has shipped behavior or an executable rejection regression.
- [ ] Real Workers tests prove owner isolation, owner-name guards, SQLite persistence, direct active-list reads, concurrent start convergence, exact mutation replay/conflict, stale attempt/revision behavior, quotas, scheduler collisions, WebSocket fan-out/order, deletion races, eviction recovery, retention, recipe purge, and permanent owner deletion.
- [ ] After ordinary D1-backed authentication, `GET /api/cook-sessions` reads no D1 cook state, recipe IDs, or discovery index; it reads the authenticated owner's DO directly and returns active sessions newest-first.
- [ ] Two authenticated browser contexts discover and synchronize one active cook attempt within five seconds without manual reload or a recipe ID.
- [ ] Anonymous progress survives local reload but never reaches the authenticated Worker/DO path or crosses principals.
- [ ] D1 contains no cook-state/index table, model, row, receipt, metadata, or cleanup projection.
- [ ] Recipe edits never silently remap active progress; terminal transitions have no social side effects.
- [ ] Reserved-intent owner deletion moves the DO through `active -> deleting -> deleted`, closes all application-OPEN sockets, removes cook rows/receipts/alarms, retains only the minimal permanent tombstone, and makes every later otherwise-valid authenticated non-delete operation return 410 `owner_deleted`; malformed/unauthorized requests retain normal validation/auth precedence.
- [ ] Web, REST, MCP, and legacy shopping add paths pass one restoration/concurrency matrix with database-enforced active identity uniqueness.
- [ ] SavedRecipe is private, paginated, searchable, independent from cookbooks/social activity, and backfilled exactly once.
- [ ] Course/tags enforce the frozen normalization, ownership, count, ordering, filtering, and public-read contracts with no AI endpoint/source.
- [ ] REST/OpenAPI/generated playground and MCP reads expose neutral metadata and optional scaling with adapter-native validation and no persistence.
- [ ] Existing legacy import outputs and docs remain compatible, no first-party import entry point is added, and existing Pebble-specific behavior is source-preserved rather than expanded or removed.
- [ ] Migration 0025 applies from empty and from the frozen fixture atop numeric migrations 0000-0024, preserves foreign keys, yields exactly four saves, repairs the three unitless shopping duplicates, and contains no cook table.
- [x] Bootstrap PR #283, forward probe repair PR #285, and hydration/warning repair PR #286 merged; main CI and atomic production deployment of `d50b8ff5730c68597f6b80077df799927a56e3bf` are green.
- [ ] Product activation is forward-only, exact-version verified, and never rolls back to the inert bootstrap Worker after product state can exist.
- [ ] All changed code has 100% statement, branch, function, and line coverage, zero warnings, clean typecheck/build/migration/Playwright runs, and converged cold reviews.
- [ ] Changed UI passes keyboard/accessibility and `visual-qa-dogfood` checks at 390x844 and 1440x900 with no open absurdity finding.
- [ ] QA/production smoke and cleanup prove zero cook rows, receipts, application-OPEN sockets, alarms, and disposable relational data; a deleted-owner tombstone is expected state, not residue.
- [ ] The product and canary-restoration PRs merge in order, their exact merge SHAs reach production, and Slugger is notified only after every required unit is complete.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code and zero warnings.**
- No coverage exclusions on new code.
- Cover every auth, malformed input, conflict, replay, quota, reconnect, retry, deletion, retention, alarm, cleanup, and boundary branch.
- Cloudflare DO/D1/WebSocket behavior runs in the official Workers Vitest integration with Istanbul and serialized shared storage.
- App services/routes/components run under the full Istanbul gate; browser behavior runs in Playwright through the shared warning fixture.
- Typecheck, build, generated-contract, and Prisma/Wrangler migration commands run through the tested diagnostic-aware warning wrapper.

## Open Questions
- None. Ari delegated the product decisions. Ask only for unavailable credentials, billing/capability changes, or a destructive production action without a safe staged path.

## Decisions Made

The exact product contracts are frozen in `./2026-07-19-1505-doing-clem-feedback-ship/cook-session-protocol-v1.md` and `./2026-07-19-1505-doing-clem-feedback-ship/product-data-contract.md`. Those files are normative for bodies, responses, errors, schemas, indexes, normalization, transitions, retry timing, compatibility, and cleanup proof; this plan summarizes ownership and delivery.

### Cook Ownership And Routing
- The Worker derives exactly one object per authenticated owner with `COOK_SESSIONS.idFromName("owner:v1:" + userId)`. User IDs are never reused after deletion/tombstoning.
- The internal owner sentinel is `/api/cook-sessions/__owner__`. The Worker constructs fresh internal requests and never forwards inbound internal headers.
- Every internal request carries `X-Spoonjoy-Cook-Protocol: 1` and one exact `X-Spoonjoy-Cook-Operation`: `owner-list`, `owner-delete`, or `recipe`. Method, path, and operation mismatches return 404.
- `ctx.id.name` is fail-closed: only `bootstrap:*` objects may run the private bootstrap probe; only `owner:v1:*` objects may run owner/recipe operations; an undefined or mismatched name returns 404. The Worker uses only `idFromName`.
- The shipped #283 DO remains overlap-compatible: a new Worker calling its owner sentinel receives the frozen retryable 503 without mutation. Exact #283 Worker source historically omits public owner DELETE, so the mandatory Unit 1.9 compatibility release adds that authenticated retryable route before product activation. The product DO retains the private bootstrap probe for old-Worker/new-DO overlap.
- Cross-version tests execute immutable #283 DO source plus the exact deployed Unit 1.9 compatibility Worker. Their committed executable bundle pins merge/tree/blob/source/bundle hashes with deterministic full-history verification; CI never substitutes a hand-written facsimile.
- Public recipe routes remain `POST /api/cook-sessions/:recipeId/start`, `GET|PATCH|DELETE /api/cook-sessions/:recipeId`, `POST .../{complete|abandon|restart}`, and `GET .../socket`. `GET /api/cook-sessions` is owner-list. `DELETE /api/cook-sessions` is permanent owner cook deletion. Public recipe ID `__owner__` is reserved and rejected before routing to the internal sentinel.
- Session principals retain first-party access except owner deletion. Bearer list/detail/socket uses `kitchen:read`; recipe mutations use `kitchen:write`. Owner deletion rejects sessions and requires a short-lived bearer with `account:write` plus reserved `oauthResource=urn:spoonjoy:account-delete-intent:v1`; operator cleanup also grants `kitchen:read` for post-delete proof and never `kitchen:write`. Exact configured Origin is required for every recipe mutation, recipe purge, socket upgrade, and owner deletion. Successful 101 responses bypass response reconstruction so their WebSocket handle survives.

### Owner SQLite Model
- `owner_meta` is a singleton state machine: missing initializes `active`; delete commits `deleting`, closes application-OPEN sockets, transactionally deletes sessions/receipts and commits `deleted`, then deletes and verifies absence of the alarm before returning 204. `deleting` resumes the sequence. `deleted` defensively repeats every zero-row/open-socket/alarm postcondition before 204, repairing crashes after the tombstone transaction. Otherwise-valid non-delete work in either state returns 410 `owner_deleted` before receipt lookup; validation/auth/scope/Origin still precede DO access.
- Owner storage is never `deleteAll`'d. A minimal deleted tombstone remains permanently so a later request or ambiguous relational deletion cannot resurrect cook data.
- `cook_session` is keyed by recipe ID and stores the frozen snapshot, active/terminal progress, attempt/revision, and retention deadline. It supports multiple recipes in one owner object.
- `mutation_receipt` is recipe-scoped and keyed by `(recipe_id, mutation_id)`, then indexed by `(recipe_id, attempt_id)`. Same-recipe UUID reuse with different intent conflicts; cross-recipe reuse is independent. It stores operation, normalized client-intent SHA-256, result attempt/revision, response status, and at most 4096 bytes of compact summary JSON.
- There is no `pending_projection` and no cook model/table in D1. Active list, cleanup enumeration, retention, and discovery all read owner SQLite directly under one owner mutex.
- Hibernatable sockets use both `recipe:<recipeId>` and `attempt:<attemptId>` tags plus durable ready/pending/quarantined attachments with a private recipe socket-generation UUID and `-1` unsent sentinel. Every delivery persists pending before send and ready after send; post-send failure stays quarantined across eviction, and receipt replay catches up only lagging ready handles after post-commit alarm/delivery failure. Invalid client messages rotate the canonical generation before fallible quarantine/close work. Fan-out/quota require a valid ready OPEN attachment whose recipe/attempt/generation matches canonical active SQLite state, so failed terminal/restart/purge or invalid-message closes cannot remain quota-counted. Principal/transport epoch plus connection generation/attempt/revision guards reject stale asynchronous fetches, timers, frames, or duplicate delivery.
- Twenty-four hours is an exact logical expiry enforced on every read/lookup, while physical alarm cleanup is eventual. One alarm deletes at most 256 due receipts and then 32 receipt-free due sessions per invocation. Remaining due work schedules `Date.now()`; otherwise the minimum deadline is scheduled or the alarm is deleted. Every owner entrypoint repairs a missing alarm so Cloudflare's finite automatic retries cannot violate logical expiry. Unit ownership is explicit: detail/receipt/mutation/scheduler in 7.3, socket admission in 7.4, and owner list plus recipe purge in 7.5, each with its own later-entrypoint missing-alarm regression.

### Idempotency, Limits, And State
- Clients send canonical UUID `mutationId` values; the server mints `attemptId`. Recipe IDs are at most 64 characters.
- Receipt lookup happens in the owner DO before any D1 recipe resolution. Same operation/hash replays exactly; a reused ID with different intent returns 409 `mutation_id_conflict`. A miss on start/restart causes the Worker to read/authorize the D1 recipe, build a canonical snapshot, and call apply; apply rechecks the receipt under the owner mutex before mutating.
- The request hash covers operation, recipe ID, expected attempt, and normalized validated client payload. It excludes mutation ID, raw JSON bytes, and the server-built snapshot.
- State mutation and receipt insertion are one SQLite transaction. Pre-commit failures are not receipted. If the transaction commits but post-commit alarm repair or required snapshot delivery fails, the public response is indeterminate 503 while the receipt remains authoritative; same-ID retry repairs scheduling, catches up only lagging ready sockets without duplicating pending/current delivery, then replays success. `owner_meta.cook_epoch` is captured before start/restart releases the mutex for D1; recipe purge increments it transactionally with deletion, so delayed apply returns unreceipted 409 instead of recreating state. Exactly-once behavior intentionally ends at purge or owner deletion.
- A maximum of 32 active sessions and 32 application-OPEN owner sockets applies, with at most 8 OPEN sockets per recipe. Only unexpired active sessions admit a socket; terminal returns 409 before quota and expired/missing returns 404. Snapshot JSON is at most 262,144 UTF-8 bytes; zero-step recipes return 422 `recipe_not_cookable`; HTTP mutation bodies and received WebSocket messages are at most 65,536 bytes; oversized socket messages close 1009.
- Public handling has one exact precedence: route/ID/query, authentication, scope/deletion intent, Origin, Upgrade, body size/schema, then owner-state/receipt/epoch work. Unexpected DO/storage/transaction/alarm faults map to private retryable `cook_session_unavailable`; owner-delete reconciliation uses `owner_delete_incomplete`; no cook route leaks a platform 500 envelope.
- Physical receipts are capped at 4096. Active attempts reserve one terminal receipt (`receipts + active sessions <= 4096` after bounded cleanup). Each active attempt may hold 511 nonterminal receipts; its terminal mutation may insert the 512th. After state validation, active-session capacity precedes per-attempt receipt capacity when work would add an active row, then physical/reserved receipt capacity is checked; that fixed order determines competing 429s. Quota errors are private/no-store and never partially mutate.
- Start/resume receipts attach to the resulting active attempt with no expiry. Restart gives old-attempt receipts `now+24h` and inserts its receipt on the new attempt. Complete/abandon insert their terminal receipt and set all still-null receipts for the attempt to the same terminal+24h deadline. Expired exact keys are deleted and treated as misses.
- Snapshot v1 pins title, servings, ordered steps/ingredients/uses and a deterministic SHA-256 content hash. Progress contains active step, scale, checked ingredients, and checked step outputs. Recipe mismatch offers continue-original or abandon-and-start-current; no mutation silently remaps identifiers.
- Mutation responses are compact summaries; detail and the initial socket snapshot carry full state.
- Reconnect failure count resets only after 30 seconds continuously open or later useful progress, not on a short-lived open. Recipe DELETE retries bodylessly on network/retryable 5xx, waits for 204, then start-current uses a fresh mutation ID.

### Product Data And Adapters
- `SavedRecipe`, `RecipeTag`, nullable `Recipe.course`, and the shopping active-identity repair are the only D1 schema additions. Their exact models, indexes, cursors, response bodies, tag ordering, scaling metadata, import projections, and shopping SQL are frozen in `product-data-contract.md`. Migration filename is `migrations/0025_clem_feedback_product.sql`; baseline numeric migrations are 0000-0024.
- SavedRecipe key is `(userId, recipeId)` with canonical 24-byte UTC-text `savedAt`; its raw CHECK rejects null `strftime` results. Backfill uses frozen numeric rounding/ranges and five accepted timestamp grammars, then keeps the latest instant by cookbook owner. Migration 0025 installs exact membership insert/delete fence triggers after backfill. One shared QA/production helper has initial, same-target reconcile, ordinary product-to-product repair, and repeatable post-restoration repair paths, with exact source/version/trigger evidence and idempotent `IF EXISTS` unlock. Initial targets need only descend from compatibility, including indirectly descended pre-merge QA candidates; same-target reconciliation preserves historical base without a new edge; literal target-base/lineage equality is reserved for ordinary and post-restoration repairs. Every attempt freezes environment-specific predecessor, lineage-parent, tree, and Worker/DO bundle identities. Production is exact-source-only; QA may alias its active candidate to the canonical production predecessor only with byte-identical tree and bundles, and is rebound after each production merge.
- Course is nullable `main|side|appetizer|dessert`. Tags use exact NFKC-first, Category-C rejection, Unicode-White-Space collapse, `Array.from` counting, and locale-independent lowercase rules; they are recipe-owned, unique, deterministically ordered, and capped at ten.
- Optional REST/MCP scaling is finite `0.1..100`, multiplies ingredient quantities only, rejects any non-finite product/rounded result, otherwise uses exact shared `Number((quantity * factor).toFixed(6))` rounding, and never persists.
- `import_recipe_from_url` is a legacy agent/API operation. Before `Recipe.course` enters generated Prisma output, it receives an explicit pre-feature projection; persisted and dry-run output shapes remain compatible. `docs/api.md`, `app/routes/developers.tsx`, and `docs/claude-connector.md` retain the legacy import contract. No MCP/import UI is added.
- Before migration 0025, a separate compatibility Worker makes all six runtime shopping writers active-first/tombstone-second with one conflict reread; recipe bulk paths coalesce duplicate identities, reject non-finite arithmetic, and run one transaction. The seed remains exact set-not-add. It recognizes owner DELETE as retryable protocol work and maps a bounded real-engine-tested fence token into exact web/REST/legacy/MCP transient envelopes. Migration captures one static-SQL clock in a temporary ordinary helper table, repairs duplicates, drops that helper, and installs the collision-free partial expression index. Final repair/add rejects non-finite arithmetic and advances canonical `updatedAt` beyond the owner account-global native-sync high-water across profile, active recipes, cookbooks, tombstones, shopping lists, and all active/deleted shopping items, so neither a newer non-shopping cursor nor a lower new item ID can hide the mutation.

### Delivery And Cleanup
- PR #283 introduced the inert namespace and atomic-bootstrap release. Its first production workflow promoted successfully but reported failure because the public probe omitted explicit `Content-Length: 0`; rollback was correctly disallowed.
- PR #285 repaired the probe. Its main CI exposed a real fellow-chef hydration mismatch. PR #286 froze server-rendered relative labels and settled a latent form-test action warning. Main CI run 29829965212 and production run 29831028729 then succeeded.
- Verified bootstrap source is `d50b8ff5730c68597f6b80077df799927a56e3bf`; production deployment is `aef2ca40-d9f0-4dbf-8602-bd45068b9a2b`; active Worker version is `3a7cdc3b-0097-4da3-842a-d39f104d4ff0` at 100%. Canonical health and two strict probes matched that version and returned residue 0; production D1 had zero cook tables.
- Product work happens on `worker/clem-feedback-product` in `/Users/arimendelow/Projects/spoonjoy-v2-clem-feedback-product`. Compatibility is first frozen 100% in QA and production on schema 0024. Product activation is atomic and forward-only: initial activation starts from compatibility plus two fences and checks descent rather than literal first-parent equality; same-target reconciliation preserves its historical base; ordinary exact-parent product repair accepts zero/one/two and requires literal base/lineage equality. QA freezes candidate source/tree/bundles, and any later byte change reruns QA before merge-tree equality is accepted. Strict cutover artifacts record each phase and predecessor binding without secrets.
- Unit 9.3 is the last tracked progress/evidence update on the product candidate. QA acceptance hashes, release/smoke/cleanup receipts, and completion status from Unit 9.4 onward live in `$DESK` plus immutable CI/deployment artifacts, so recording evidence cannot change the candidate it attests. The workflow-only canary-restoration merge is the task's final product-repository mutation; Unit 9.11 closes Desk/worktrees and notifies Slugger without another commit or production trigger.
- The first real protocol-v1 implementation commit adds `workers/cook-session-protocol-v1-boundary` exactly once. One-shot canary restoration reads active-runtime mode from full history and pins runtime rollback to final accepted product. The initial restoration directly bases on that floor; after a failed merged attempt, a workflow-only repair descends from the floor/latest failed restoration while runtime is restored to the floor. If candidate smoke instead exposes a runtime defect, a narrowly recognized atomic-product repair chain freezes the floor and original failed restoration while each pre-activation failed repair becomes the next first-parent lineage head. Every target removes the canary delta and passes environment-bound skew/QA/smoke/cleanup; once a repair activates, later failures use ordinary exact-active-source repair. A wholly successful repair becomes the new floor before restoration restarts. Once restoration is active, later canary releases use their immediate compatible predecessor rather than the historical floor.
- Disposable/user cleanup mints a five-minute reserved-resource bearer with `account:write kitchen:read`, calls owner deletion before removing the relational user, and revokes the credential in `finally`. A successful 204 returns exact zero-row/application-OPEN-socket/alarm proof headers; cleanup verifies them twice, then verifies later list/detail 410s. Workers fault-injection tests prove header truthfulness. On ambiguous D1 user-delete failure cleanup checks whether the user still exists and retries owner deletion only while valid credentials remain. “Zero residue” means zero cook rows/receipts/application-OPEN sockets/alarms plus the expected minimal deleted-owner tombstone.

## Context / References
- `./2026-07-14-1313-clem-feedback-source.md`
- `./2026-07-19-1505-doing-clem-feedback-ship.md`
- `./2026-07-19-1505-doing-clem-feedback-ship/bootstrap-handoff.md`
- `./2026-07-19-1505-doing-clem-feedback-ship/cook-session-protocol-v1.md`
- `./2026-07-19-1505-doing-clem-feedback-ship/product-data-contract.md`
- `workers/app.ts`, `workers/cook-session.ts`, `wrangler.json`, and `app/cloudflare-env.d.ts`
- `prisma/schema.prisma`, `migrations/*.sql`, `scripts/deploy-production-canary.ts`, and `.github/workflows/*.yml`
- Cloudflare Durable Object migrations: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
- Cloudflare gradual deployments with Durable Objects: https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/

## Notes
The 2026-07-21 latest-model audit found one material architecture error in the previously approved plan: a per-user/recipe object plus D1 registry still made D1 part of cook-state ownership and complicated cross-device discovery, exactly contrary to Clem's point. This audited revision replaces it with one owner-scoped SQLite DO and no cook data in D1. Historical progress lines below are retained; this revision supersedes their old contract text.

## Progress Log
- 2026-07-19 15:05 Created after the latest-model audit rejected the Round121 release/runtime expansion and remapped the current product code paths.
- 2026-07-19 15:05 Incorporated first-round product, Cloudflare, data, and delivery review findings; corrected stale source dispositions and froze executable contracts.
- 2026-07-19 15:20 Incorporated Round 2 findings; selected the legacy lifecycle to preserve canaries and fixed discovery, pagination, and shopping atomicity contracts.
- 2026-07-19 15:34 Approved after the fresh final planning reviewer returned `CONVERGED`.
- 2026-07-19 16:31 Reopened for ambiguity review and froze schema, protocol, inventory, bootstrap, and branch contracts.
- 2026-07-19 16:43 Replaced the stale baseline claim and completed scalar, snapshot, SQLite, infrastructure, inventory, shopping, and query contracts.
- 2026-07-19 16:52 Canonicalized mutation hashing/reconnect behavior and completed literal fixture plus saved/filter inventories.
- 2026-07-19 17:06 Completed receipt/projection SQL and same-attempt stale-socket reconciliation.
- 2026-07-19 17:10 Re-approved after the fresh final ambiguity reviewer returned `CONVERGED`.
- 2026-07-19 17:38 Scrutiny Pass 6 aligned seed/test raw indexes, real MCP names, and bootstrap-probe removal ownership.
- 2026-07-19 17:45 Scrutiny Pass 7 fixed initial registry atomicity and isolated metadata read serializers from mutation/native contracts.
- 2026-07-19 18:18 Scrutiny Pass 8 closed the start/cleanup race, made remote purge authenticated and ordered, shielded schema-time imports, split OpenAPI read schemas, moved search projection ownership, and froze fixture reset order.
- 2026-07-19 18:37 Scrutiny Pass 8 Round 2 completed scale contracts, collision-safe tag freshness, exact cleanup origin, atomic create/edit metadata ownership, and self-reference-safe fixture reset.
- 2026-07-19 18:57 Scrutiny redesign froze cook bearer scopes, retained the migration fixture across bootstrap handoff, and serialized restart against due purge alarms.
- 2026-07-19 19:20 Scrutiny redesign made bootstrap/product activation cross-version-safe, serialized WebSocket admission with purge, repaired Prisma schema-change ordering, and assigned executable zero-warning gates.
- 2026-07-19 19:35 Final Tinfoil and Stranger scrutiny passes converged consecutively; the 118-unit doing document was ready for execution under the superseded per-recipe/D1-index contract.
- 2026-07-21 05:43 Reopened after an exhaustive latest-model audit, replaced per-recipe/D1-index cook ownership with one owner-scoped DO, corrected migration/import/cleanup contracts, and submitted this revision to fresh reviewer gates.
- 2026-07-21 11:59 Re-approved after six cold-review rounds closed product/data, Durable Object/security, release/cleanup, and cross-contract findings; the final product, release, and integration reviewers each returned `CONVERGED`.
