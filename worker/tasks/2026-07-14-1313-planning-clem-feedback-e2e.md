# Planning: Clem Feedback E2E

**Status**: approved
**Created**: 2026-07-14 13:15
**Re-audited**: 2026-07-15 against `origin/main` at `b22c5fec`

## Goal
Ship every accepted part of Clem's feedback as coherent Spoonjoy primitives: reliable cross-device cooking, correct shopping-list restoration, private saved recipes, useful manual categorization, and neutral API metadata. Explicitly reject first-party import UI, premature AI categorization, and Pebble-specific work.

## Upstream Work Items
- `./2026-07-14-1313-clem-feedback-source.md` is the durable source-of-truth and item-by-item disposition.

## Scope

### In Scope
- Preserve the current navigation model and change it only for a demonstrated accessibility or reachability defect.
- Centralize web, REST v1, and MCP shopping-list add/restore behavior in `app/lib/shopping-list-mutations.server.ts`.
- Add a SQLite-backed Cloudflare Durable Object as the canonical authenticated cook-session owner, explicitly bound and migrated in production and QA.
- Add a real `@cloudflare/vitest-pool-workers` test project and CI gate for Durable Object, alarm, D1, WebSocket, and full Worker-response behavior.
- Add an internal same-origin cookie-session cook API at `/api/cook-sessions`; it is not a public v1 API and is excluded from OpenAPI.
- Add start/resume, snapshot, operation patch, live subscription, complete, abandon, and owner-authorized current-attempt purge lifecycle contracts.
- Keep authenticated offline state as a non-canonical operation queue; reconcile through revisioned, deduplicated operations when connectivity returns.
- Keep anonymous cook progress entirely in localStorage and allow explicit one-time adoption only when the deterministic server object has never created an attempt.
- Pin a normalized recipe snapshot and fingerprint in each active Durable Object so recipe edits never silently remap progress.
- Store only owner-private query/history projection data in D1 for My Kitchen; reconcile every projection change from the Durable Object with idempotent alarms.
- Add private `SavedRecipe` state distinct from cookbook membership, with migration backfill, web UI, privacy-safe search, and private REST v1 endpoints.
- Add accepted-only manual `RecipeTag` state: one controlled course and owner-authored custom tags, with authoring, filtering, search indexing, and REST v1 projections.
- Add backward-compatible REST v1 metadata and scale projections: `stepCount`, `sourceDisplayName`, `course`, `tags`, authenticated `isSaved`, and detail-only scaled quantities.
- Update OpenAPI, contract registries, generated playground, MCP metadata where behavior changes, developer docs, smoke scripts, deployment preflight, and cleanup.
- Deploy to QA before merge, validate two-client synchronization and cleanup, then merge and verify the exact merge SHA's automatic production deployment.

### Out of Scope
- First-party import/upload UI for URLs, PDFs, cookbooks, or videos; existing agent/API import remains available.
- AI tag suggestion tables, endpoints, inference jobs, or review UI.
- Pebble-specific fields, routes, naming, documentation, or partner behavior.
- Public saved counts, collaborative cook sessions between different users, public cook history, or automatic social `RecipeSpoon` creation.
- Replacing freeform `servings`, changing existing v1 field types, or mutating stored recipes during scaling.
- Broad mobile dock redesign.

## Product And Data Contracts

### Shopping-List State Matrix

| Existing row | Quantity after add | Checked state | Ordering | Category/icon |
| --- | --- | --- | --- | --- |
| Active, unchecked | If requested is `null`, retain existing; otherwise `(existing ?? 0) + requested` | Unchecked | Unchanged | Preserve unless request explicitly overrides |
| Active, checked | If requested is `null`, retain existing; otherwise `(existing ?? 0) + requested` | Reset unchecked; clear `checkedAt` | Move to a newly allocated end position | Preserve unless request explicitly overrides |
| Deleted tombstone | Requested quantity exactly, including `null`; never add stale quantity | Reset unchecked; clear `checkedAt` and `deletedAt` | Move to a newly allocated end position | Preserve unless request explicitly overrides; infer recipe category/icon only when absent |

Recipe batch adds aggregate equal ingredient-reference/unit pairs before mutation: numeric requested quantities sum, while an all-null group remains null. They allocate distinct monotonic sort indices. Web, REST, and MCP call the same D1-safe helper.

### Cook-Session Ownership And Lifecycle
- Every JSON cook response carries `X-Request-Id` and uses one exact envelope. Success is `{ ok: true, requestId, data }`. Error is `{ ok: false, requestId, error: { code, message, status }, data? }`; `data` is present as `{ snapshot }` on stale attempt/revision conflicts when a current attempt exists. Every non-101 response sets `Cache-Control: private, no-store` and `Pragma: no-cache`.
- `POST /api/cook-sessions` accepts `{ recipeId, mutationId, adoption? }`, where mutation ids are UUID v4 strings. A newly created attempt returns `201`; resume or exact replay returns `200`; data is `{ snapshot, adoptionOutcome }`. `adoption`, when present, is `{ version: 1, fingerprint, activeStepIndex, scaleFactor, checkedIngredientIds, checkedStepOutputIds }` and is validated against the server-built current recipe snapshot. Start requests have a separate DO idempotency ledger: unexpired records are retained for 24 hours and replay the recorded attempt/outcome while it exists, or `410 attempt_purged` after its purge; reusing an id with another payload returns `409 mutation_conflict`; at 64 unexpired unique records the DO returns `429 mutation_ledger_full` rather than evicting a replay guarantee.
- The Worker derives the canonical DO address as `idFromName("${userId}:${recipeId}")`. That deterministic per-user/per-recipe object, not D1, arbitrates start/resume and guarantees one active attempt. Parallel starts serialize in the same object.
- Every new attempt gets a random `attemptId` UUID stored inside the DO and returned in snapshots. D1 stores one history/index row per attempt and retains nullable unique `activeKey = "${userId}:${recipeId}"` as a projection integrity check, but start/resume never consults D1 to decide canonical state.
- `GET /api/cook-sessions/recipes/:recipeId` returns `200 { snapshot }` from the authenticated user's deterministic DO. `PATCH` accepts `{ attemptId, baseRevision, mutationId, operations }`, with one to 64 operations from exactly: `{ type: "set_active_step", stepIndex }`, `{ type: "set_scale_factor", scaleFactor }`, `{ type: "set_ingredient_checked", ingredientId, checked }`, and `{ type: "set_step_output_checked", stepOutputId, checked }`. Accepted and replayed mutations return `200 { snapshot }`.
- Revision zero is the initial attempt. Each accepted non-replayed PATCH increments revision exactly once regardless of operation count. `POST .../complete` and `POST .../abandon` accept `{ attemptId, baseRevision, mutationId }`, increment revision once on the first accepted transition, return `200 { snapshot }`, and enqueue an ordered D1 projection clearing `activeKey`. Repeating the same terminal target with a fresh mutation id returns the current snapshot without another increment; requesting the opposite terminal target returns `409 terminal_conflict`. Completion is private history only and never creates a `RecipeSpoon` or notification.
- The progress/terminal mutation ledger is attempt-scoped, retains up to 256 unexpired UUID-v4 records for 24 hours, and never evicts an unexpired replay guarantee. Replay lookup and request-hash comparison happen before attempt/revision validation; an exact replay returns its recorded status/snapshot without incrementing revision, while reuse with another payload returns `409 mutation_conflict`. A new mutation at capacity returns `429 mutation_ledger_full`. An old attempt id cannot mutate a newer attempt. A stale base revision returns `409 stale_revision` with the latest snapshot; the client rebases queued operations on that snapshot and retries, so unrelated fields merge and the reconnecting same-field operation wins when accepted.
- `GET /api/cook-sessions/recipes/:recipeId/live` requires a same-origin WebSocket upgrade. Server frames are exactly `{ type: "snapshot", snapshot }` and `{ type: "error", error: { code, message }, snapshot? }`. The server sends an initial snapshot and broadcasts after accepted progress or terminal transitions. This is a read-only subscription: any client text or binary data frame closes with code `1003` and reason `Read-only subscription`; normal client close uses `1000`. Hibernation attachments are `{ version: 1, userId, recipeId, attemptId }`. A new attempt closes stale sockets with `4000 Attempt replaced`; purge closes them with `4001 Session purged`.
- `DELETE /api/cook-sessions/recipes/:recipeId` accepts `{ attemptId }` and is not mutation-ledger-backed. A matching purge returns `202 { status: "purging", attemptId }` until the coordinator tombstone commits; repeated pending requests also return `202`, then matching/already-purged requests return bodyless `204`. A mismatch returns non-mutating `409 stale_attempt`; an unknown/no-current id returns `404 not_found`. A valid purge atomically persists `PURGING`, appends a purge barrier after every older projection, broadcasts that terminal state, and closes existing sockets. While PURGING, start/resume, snapshot, patch, complete, abandon, and new upgrades return `409 session_purging` and append nothing. The alarm drains all earlier projections FIFO, idempotently deletes the current D1 attempt row at the barrier, then atomically deletes every attempt-bearing DO key: pinned recipe, progress, current attempt, mutation cache, projection queue, retry state, and sockets. It retains only non-content coordinator metadata: `everStarted`, `lastPurgedAttemptId`, and unexpired 24-hour start-idempotency records. Those starts replay as `410 attempt_purged` after purge and can never recreate/adopt state. A fresh mutation id may start a new empty attempt after purge, but `everStarted` makes adoption resolve `server_won`.
- Failure behavior is fixed: local persistence failure before the PURGING fence leaves state unchanged and returns `500`; broadcast/socket-close failure after persistence never rolls back the fence; older-projection D1 failure retains queue/barrier/content; current-row D1 delete failure retains barrier/content; a crash after D1 delete retries that delete idempotently; failed atomic attempt-key deletion/tombstone write retains content/barrier and retries; success is reported only after the tombstone is committed and attempt-bearing keys are absent.
- State-changing HTTP requests and upgrades enforce same-origin `Origin`; all endpoints use cookie sessions and are intentionally excluded from public v1/OpenAPI. Status/code mapping is exact: `400 invalid_json`, `401 authentication_required`, `403 invalid_origin`, `404 not_found`, `405 method_not_allowed`, `409 stale_attempt|stale_revision|mutation_conflict|terminal_conflict|session_terminal|session_purging`, `410 attempt_purged`, `422 validation_error`, `429 mutation_ledger_full`, and `500 internal_error`. Upgrade auth/origin failures are ordinary non-101 JSON responses.

### Cook Snapshot, Offline, And Projection
- `CookRecipeSnapshot` is exactly `{ version: 1, id, title, coverImageUrl, steps }`; `coverImageUrl` is nullable. Each step is `{ id, stepNum, stepTitle, description, duration, ingredients, stepOutputUses }`, with nullable `stepTitle`/`duration`. Each ingredient is `{ id, ingredientRefId, name, quantity, unit: { id, name } }`. Each step-output use is `{ id, outputStepId, outputStepNum, outputStepTitle }`, with nullable `outputStepTitle`.
- Snapshot construction sorts steps by `(stepNum, id)`, ingredients within a step by `id`, and step-output uses by `(outputStepNum, id)`. Canonicalization recursively sorts object keys lexicographically; preserves array order, stored Unicode code points, case, and whitespace; includes every schema field and emits nullable values as JSON `null`; never emits `undefined`; rejects non-finite numbers; normalizes `-0` to `0`; and otherwise uses ECMAScript JSON number serialization. The fingerprint is lowercase hexadecimal SHA-256 of the UTF-8 canonical recipe-snapshot JSON. Database timestamps and other non-schema fields are excluded.
- `CookSessionSnapshot` is exactly `{ version: 1, attemptId, recipeId, recipeFingerprint, recipe, revision, status, activeStepIndex, scaleFactor, checkedIngredientIds, checkedStepOutputIds, startedAt, updatedAt, completedAt, abandonedAt }`. Status is `ACTIVE|COMPLETED|ABANDONED|PURGING`; timestamps are ISO strings and terminal timestamps are nullable. Checked-id arrays serialize in pinned recipe traversal order, not mutation arrival order.
- The DO key already encodes authenticated owner/recipe identity; storage repeats and verifies immutable owner/recipe ids. Coordinator metadata stores `everStarted`, current/last-purged attempt ids, and start replay records. Attempt-bearing storage holds the pinned recipe snapshot/fingerprint, revision, active step, scale factor bounded to `0.25..50`, checked stable ids, status, timestamps, the 256-entry progress ledger, and an ordered pending D1 projection queue; purge removes this entire attempt-bearing set.
- Active cooking renders the pinned snapshot. When the current recipe fingerprint differs, the UI offers `Continue original` or `Start fresh`; start-fresh abandons the old attempt before creating a new one.
- For authenticated users, local storage may cache a snapshot and queued operations for offline UX but is never authoritative. Anonymous versioned local progress remains local-only. Adoption never trusts client time: a server object with any current or prior attempt always wins and ignores adoption. Only a pristine object may atomically create its first attempt from a same-fingerprint, bounds-valid adoption; parallel blank/adopt starts serialize and the first accepted start wins. Replaying an unexpired start `mutationId` within 24 hours returns its recorded attempt/outcome; expired ids are outside the retry guarantee and clients must generate a fresh UUID for a new logical start. The response reports `adoptionOutcome: "adopted" | "server_won" | "not_requested"`, after which the authenticated client clears the anonymous record.
- The DO is canonical. D1 contains owner-private active/history metadata needed for My Kitchen and may temporarily show a stale card; opening it rechecks the DO and revalidates the page. Create/update/complete/abandon projections are processed in attempt order, idempotently, so a terminal old attempt clears its active key before a new attempt claims it. On a failed queue head, the alarm increments persisted retry count from zero to `n` and schedules `now + min(2^n seconds, 60 seconds)`, yielding 2, 4, 8, 16, 32, then 60 seconds forever until success. A successful head resets retry count to zero before draining the next item. Starting a new attempt never discards an older pending terminal projection.

### SavedRecipe
- `SavedRecipe(userId, recipeId, createdAt)` is hard-deleted on explicit unsave and unique by `(userId, recipeId)`.
- Migration `0025_saved_recipes.sql` backfills active recipes with `SELECT DISTINCT Cookbook.authorId, RecipeInCookbook.recipeId` plus an explicit `JOIN Recipe ON Recipe.id = RecipeInCookbook.recipeId WHERE Recipe.deletedAt IS NULL`, conflict-ignore semantics, and no replacement/deletion. `addedById` does not determine ownership. Rerunning is harmless.
- Adding cookbook membership through `recipe-detail.server.ts`, `cookbooks.$id.tsx`, `spoonjoy-api.server.ts`, or `api-v1.server.ts` uses one shared D1-safe helper that submits membership create/upsert and SavedRecipe upsert together through Prisma's non-interactive `$transaction([promise, promise])` batch form; callback/interactive transactions are forbidden for this helper. Removing membership never unsaves; explicit unsave never removes cookbook membership. Re-save is idempotent. Soft-deleted recipes remain referenced but are hidden until restored.
- `/saved-recipes` and owner-only My Kitchen sections use SavedRecipe. Saved search intersects recipe-search results with the viewer's saved ids; private save state is never written to global `SearchDocument` metadata.
- Public v1 adds private `GET /api/v1/me/saved-recipes` and idempotent `PUT`/`DELETE /api/v1/me/saved-recipes/:recipeId` with existing `recipes:read`/`recipes:write` scope, error, idempotency, and private no-store conventions. GET uses `limit` default 20/max 50; orders `(SavedRecipe.createdAt DESC, recipeId DESC)`; and uses an opaque `v1.<base64url(JSON)>` cursor whose JSON is `{ createdAt: <ISO string>, recipeId }`. Its exact data is `{ limit, cursor, nextCursor, hasMore, recipes }`, where recipes use the authenticated recipe-summary contract and `isSaved: true`; soft-deleted recipes are omitted. Invalid limits/cursors use existing v1 errors.
- PUT and DELETE accept `clientMutationId` from JSON body, then `X-Client-Mutation-Id`, then query string, in that precedence order; unknown body fields are rejected. Both return `200` with `{ recipeId, saved: true|false, mutation: { clientMutationId, replayed: false } }`; existing idempotency replay changes only `replayed` to true while retaining the recorded status/body. PUT of an already-saved recipe and DELETE of an already-unsaved active recipe are successful. Missing or soft-deleted recipes return `404`; unsave never changes cookbook membership.

### RecipeTag
- `RecipeTag(id, recipeId, label, normalizedLabel, kind, source, createdById, createdAt, updatedAt)` stores accepted canonical tags only.
- `kind` is `COURSE` or `CUSTOM`; `source` is `MANUAL` in this release. Only the recipe owner may mutate tags. Manual tags are canonical immediately and have no acceptance transition.
- Course is optional and singular; allowed normalized/storage values are `main`, `side`, `appetizer`, and `dessert`. Custom display labels trim ends, collapse every Unicode whitespace run to one ASCII space, preserve the first accepted display casing, and must contain 1..40 Unicode code points after collapse. `normalizedLabel` is `label.normalize("NFKC").toLowerCase()`; uniqueness uses that value. Course words are reserved and rejected as custom labels. A recipe may have at most 10 custom tags; explicit service add of blank/over-limit/reserved input is a validation error, while blank form rows are omitted before service calls.
- Accepted course/custom labels participate in public recipe search fingerprints and documents. Future AI proposals require a separate non-canonical model and explicit acceptance workflow.
- Discovery filters use one optional `course=<controlled-value>` and repeatable `tag=<custom-label>` query parameters. Empty tag parameters are ignored; custom filters use the same normalization, deduplicate by normalized label, and cap at 10. Multiple course parameters, invalid course/custom values, or an over-limit tag set produce an HTTP 400 loader response. Search text, owner/visibility scope, course, and tags combine with AND; every distinct custom tag must match (AND, not OR). Unfiltered behavior and ordering stay unchanged.

### REST v1 Compatibility
- Existing field types and meanings remain unchanged. Any incompatible change requires v2.
- Recipe summary/detail add `stepCount: number`, `course: string | null`, `tags: string[]`, and `isSaved: boolean | null`; anonymous/public-token responses use `null` only for `isSaved`, while an authenticated user receives a boolean. `course` is the lowercase controlled course. `tags` contains custom tags only, preserving the owner's trimmed/collapsed display casing and sorting by `normalizedLabel` then id.
- Attribution preserves raw `sourceHost` and adds `sourceDisplayName`. Null/empty/malformed raw hosts yield null; otherwise parse as a hostname, lowercase it, remove a trailing dot and one leading `www.`, and return the URL parser's ASCII hostname form.
- Detail-only `GET /api/v1/recipes/{id}?scaleFactor=<number>` accepts exactly one unsigned decimal matching `^(?:\d+(?:\.\d*)?|\.\d+)$` and numeric range `0.25..50`; signs, exponent/hex notation, whitespace-only, malformed, multiple, nonfinite, and out-of-range values return the existing `validation_error` shape. List/search behavior is unchanged.
- Detail preserves required numeric ingredient `quantity` and adds required numeric `scaledQuantity`; the response includes `scaleFactor`. Multiplication is rounded to at most six decimal places and negative zero is normalized to zero. Scaling does not write recipe data. `servings` remains the original nullable freeform string.
- OpenAPI, `api-v1-contract.server.ts`, generator output, developer playground, examples, REST tests, and MCP shopping metadata remain synchronized.

## Completion Criteria
- [ ] Every line of the feedback source has an implemented or explicitly rejected disposition.
- [ ] Shopping re-add behavior matches the state matrix across web, REST v1, and MCP under repeated and concurrent calls.
- [ ] Workers-runtime tests prove deterministic user/recipe arbitration, first-writer/server-wins adoption, post-purge replay fencing, stale-delete isolation, SQLite DO persistence, attempt isolation, revision conflict/rebase, mutation dedupe, ordered alarms, purge barriers, private no-store responses, hibernation WebSockets, and the full Worker 101 response path.
- [ ] Two authenticated clients start/resume one session and synchronize step, checklist, and scale state; anonymous progress remains local-only.
- [ ] Recipe edits display pinned-state choices and never silently remap progress.
- [ ] My Kitchen cook/saved sections are owner-only for owner, authenticated visitor, and anonymous visitor cases.
- [ ] Completion and abandon clear resume state, preserve private history as intended, and create no RecipeSpoon/social side effect.
- [ ] SavedRecipe migration/backfill and all four cookbook membership writers obey the compatibility contract.
- [ ] Saved search is viewer-scoped without global-index leakage; private REST saved endpoints and `isSaved` are no-store and ownership-safe.
- [ ] Manual course/custom tags author, filter, search, and project through REST without any AI suggestion surface.
- [ ] REST v1 additions pass compatibility, OpenAPI, contract, generator, list/detail/search/native-sync/write/cookbook tests.
- [ ] Current mobile dock remains stable; changed UI passes desktop/mobile visual QA with no overlap or unreachable controls.
- [ ] QA deploy, two-client smoke, purge, and residue inspection pass before merge.
- [ ] The exact merged SHA's automatic production workflow completes, then readiness/web/API smoke and cleanup pass.
- [ ] All tests and builds pass with zero warnings and 100% coverage on all new code, including `workers/**`.

## Open Questions
- None. Ari delegated the product decisions in chat. Human input is needed only for unavailable Cloudflare/GitHub credentials, a billing/capability limitation, or an unsafe destructive production action.

## Decisions Made
- Use a SQLite-backed Durable Object for authenticated live state and D1 only as a private, retryable query/history projection.
- Route the internal cook API at Worker level before React Router so WebSocket upgrades retain the Cloudflare `webSocket` handle. Preserve security headers on ordinary responses and test the full default export.
- Use operation-based optimistic concurrency instead of whole-snapshot last-write-wins.
- Use one deterministic DO per user/recipe and one active attempt UUID inside it, with explicit complete, abandon/start-fresh, and partial-failure-safe current-attempt purge lifecycle.
- Do not create RecipeSpoon entries from private cooking progress.
- Keep anonymous cooking local; authenticated local cache/queue is non-canonical.
- Adopt anonymous local progress only into a pristine server object; any server attempt wins regardless of client timestamp.
- Add SavedRecipe as private canonical save state and bridge all cookbook writers for compatibility.
- Keep global recipe search free of private save metadata.
- Ship manual accepted tags only; defer AI suggestions until a review model and UX exist.
- Preserve current navigation unless evidence warrants a focused fix.
- Keep import agent/API-only and reject Pebble-specific behavior.

## Context / References
- `./2026-07-14-1313-clem-feedback-source.md`
- `app/routes/recipes.$id.tsx` currently stores `spoonjoy-cook-progress:${recipeId}` locally and already bounds scale to `0.25..50`.
- `workers/app.ts` is the Worker entrypoint; `withSecurityHeaders` currently rebuilds responses and drops a Cloudflare WebSocket attachment.
- `vitest.config.ts` uses happy-dom/forks and currently includes existing Node-mocked `test/workers/app.test.ts`. The new Workers pool must include only `test/workers-runtime/**/*.test.ts`; the normal pool must exclude exactly `test/workers-runtime/**` while retaining `test/workers/**`.
- `migrations/0023_recipe_cover_prompt_lineage.sql` is current, so new D1 migrations are `0024`, `0025`, and `0026`.
- `app/routes/_index.tsx` can render another user's kitchen, so private sections must be loaded/rendered only for the owner.
- `app/lib/search.server.ts` uses global recipe documents; SavedRecipe must remain a viewer-scoped overlay.
- Cookbook membership writers exist in `app/lib/recipe-detail.server.ts`, `app/routes/cookbooks.$id.tsx`, `app/lib/spoonjoy-api.server.ts`, and `app/lib/api-v1.server.ts`.
- Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/
- Workers Vitest integration: https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/
- WebSocket hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Durable Object alarms: https://developers.cloudflare.com/durable-objects/api/alarms/
- Wrangler environments: https://developers.cloudflare.com/durable-objects/reference/environments/

## Notes
The task is deliberately broad because the feedback describes an end-to-end product boundary. Delivery stays reviewable through strict TDD units, atomic commits, QA-before-merge sequencing, and a final continuation scan rather than by dropping any accepted thread.

## Progress Log
- 2026-07-14 13:15 Created.
- 2026-07-14 13:24 Initial planning approved after two review rounds.
- 2026-07-15 Latest-model audit invalidated stale assumptions after eight upstream commits.
- 2026-07-15 Added durable feedback disposition, real Workers testing, executable cook lifecycle, privacy boundaries, exact data/API contracts, and QA-before-merge sequencing; returned to `NEEDS_REVIEW`.
- 2026-07-15 Planning re-approved after five fresh hostile rounds converged on deterministic DO arbitration, ordered projection, adoption replay, purge fencing, and exact REST compatibility contracts.
