# Planning: Clem Feedback E2E

**Status**: NEEDS_REVIEW
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
- `POST /api/cook-sessions` accepts `{ recipeId, mutationId, adoption? }`, uses API-safe 401/403/404 responses, and atomically creates or resumes one active attempt per `(userId, recipeId)`. `adoption`, when present, is `{ version: 1, fingerprint, activeStepIndex, scaleFactor, checkedIngredientIds, checkedStepOutputIds }` and is validated against the server-built current recipe snapshot. Start requests have a separate DO idempotency ledger: unexpired records are retained for 24 hours and replay the recorded attempt/outcome; at 64 unexpired unique records the DO returns `429` rather than evicting a replay guarantee.
- The Worker derives the canonical DO address as `idFromName("${userId}:${recipeId}")`. That deterministic per-user/per-recipe object, not D1, arbitrates start/resume and guarantees one active attempt. Parallel starts serialize in the same object.
- Every new attempt gets a random `attemptId` UUID stored inside the DO and returned in snapshots. D1 stores one history/index row per attempt and retains nullable unique `activeKey = "${userId}:${recipeId}"` as a projection integrity check, but start/resume never consults D1 to decide canonical state.
- `GET /api/cook-sessions/recipes/:recipeId` returns the current attempt snapshot from the authenticated user's deterministic DO.
- `PATCH /api/cook-sessions/recipes/:recipeId` accepts `{ attemptId, baseRevision, mutationId, operations }`. Stable-id operations set active step, scale factor, ingredient check state, and step-output check state. Mutation IDs are bounded/deduplicated in the DO. An old attempt id cannot mutate a newer attempt.
- A stale base revision returns `409` with the latest snapshot. The client rebases queued operations on that snapshot and retries; unrelated fields merge, and the reconnecting same-field operation wins when accepted.
- `GET /api/cook-sessions/recipes/:recipeId/live` requires a same-origin WebSocket upgrade and emits an initial snapshot plus snapshots after accepted mutations or terminal transitions. Socket attachments include `attemptId`; stale sockets are closed when a new attempt begins.
- `POST .../complete` and `POST .../abandon` include `attemptId` and are idempotent terminal transitions that enqueue an ordered D1 projection clearing `activeKey`. Completion is private history only and never creates a `RecipeSpoon` or notification.
- `DELETE /api/cook-sessions/recipes/:recipeId` includes `attemptId` and initiates owner-authorized current-attempt purge for smoke cleanup or explicit deletion. The DO atomically persists `PURGING`, appends a purge barrier after every older projection, broadcasts that terminal state, and closes existing sockets with code `4001`. While PURGING, start/resume, snapshot, patch, complete, abandon, and new upgrades return `409 session_purging` and append nothing; repeated DELETE returns `202`. The alarm drains all earlier projections in FIFO order, idempotently deletes the current attempt row at the barrier, and only then calls `deleteAll()`. A DELETE against an already-empty object returns `204`; smoke retries until `204`. Injected tests cover every request interleaving, `old terminal pending -> new attempt -> purge`, and every failure boundary so neither private DO state nor an unrepairable D1 row is orphaned.
- State-changing HTTP requests and upgrades enforce same-origin `Origin`; all endpoints use cookie sessions and are intentionally excluded from public v1/OpenAPI. Every non-101 cook response, including errors and terminal responses, sets `Cache-Control: private, no-store`.

### Cook Snapshot, Offline, And Projection
- The server creates a normalized snapshot from recipe id/title/cover, ordered stable step ids and text, ingredient ids/reference ids/names/quantities/unit ids+names, and step-output-use ids. A deterministic SHA-256 of canonical JSON is the fingerprint.
- The DO key already encodes authenticated owner/recipe identity; storage repeats and verifies immutable owner/recipe ids. It stores the current attempt id, pinned recipe snapshot/fingerprint, revision, active step, scale factor bounded to `0.25..50`, checked stable ids, status, timestamps, bounded mutation ids, and an ordered pending D1 projection queue.
- Active cooking renders the pinned snapshot. When the current recipe fingerprint differs, the UI offers `Continue original` or `Start fresh`; start-fresh abandons the old attempt before creating a new one.
- For authenticated users, local storage may cache a snapshot and queued operations for offline UX but is never authoritative. Anonymous versioned local progress remains local-only. Adoption never trusts client time: a server object with any current or prior attempt always wins and ignores adoption. Only a pristine object may atomically create its first attempt from a same-fingerprint, bounds-valid adoption; parallel blank/adopt starts serialize and the first accepted start wins. Replaying an unexpired start `mutationId` within 24 hours returns its recorded attempt/outcome; expired ids are outside the retry guarantee and clients must generate a fresh UUID for a new logical start. The response reports `adoptionOutcome: "adopted" | "server_won" | "not_requested"`, after which the authenticated client clears the anonymous record.
- The DO is canonical. D1 contains owner-private active/history metadata needed for My Kitchen and may temporarily show a stale card; opening it rechecks the DO and revalidates the page. Create/update/complete/abandon projections are processed in attempt order, idempotently, so a terminal old attempt clears its active key before a new attempt claims it. A persisted queue plus a DO alarm retries transient failures and reschedules after exhausted platform retries. Starting a new attempt never discards an older pending terminal projection.

### SavedRecipe
- `SavedRecipe(userId, recipeId, createdAt)` is hard-deleted on explicit unsave and unique by `(userId, recipeId)`.
- Migration `0025_saved_recipes.sql` backfills active recipes with `SELECT DISTINCT Cookbook.authorId, RecipeInCookbook.recipeId`, conflict-ignore semantics, and no replacement/deletion. `addedById` does not determine ownership. Rerunning is harmless.
- Adding cookbook membership through `recipe-detail.server.ts`, `cookbooks.$id.tsx`, `spoonjoy-api.server.ts`, or `api-v1.server.ts` ensures the cookbook owner has a saved row. Removing membership never unsaves; explicit unsave never removes cookbook membership. Re-save is idempotent. Soft-deleted recipes remain referenced but are hidden until restored.
- `/saved-recipes` and owner-only My Kitchen sections use SavedRecipe. Saved search intersects recipe-search results with the viewer's saved ids; private save state is never written to global `SearchDocument` metadata.
- Public v1 adds private `GET /api/v1/me/saved-recipes` and idempotent `PUT`/`DELETE /api/v1/me/saved-recipes/:recipeId` with existing `recipes:read`/`recipes:write` scope, error, idempotency, and private no-store conventions.

### RecipeTag
- `RecipeTag(id, recipeId, label, normalizedLabel, kind, source, createdById, createdAt, updatedAt)` stores accepted canonical tags only.
- `kind` is `COURSE` or `CUSTOM`; `source` is `MANUAL` in this release. Only the recipe owner may mutate tags. Manual tags are canonical immediately and have no acceptance transition.
- Course is optional and singular; allowed normalized values are `main`, `side`, `appetizer`, and `dessert`. Custom tags are normalized case-insensitively and unique per recipe.
- Accepted course/custom labels participate in public recipe search fingerprints and documents. Future AI proposals require a separate non-canonical model and explicit acceptance workflow.

### REST v1 Compatibility
- Existing field types and meanings remain unchanged. Any incompatible change requires v2.
- Recipe summary/detail add `stepCount: number`, `course: string | null`, `tags: string[]`, and `isSaved: boolean | null`; anonymous/public-token responses use `null` only for `isSaved`, while an authenticated user receives a boolean. `course` is the lowercase controlled course. `tags` contains custom tags only, preserving the owner's trimmed/collapsed display casing and sorting by `normalizedLabel` then id.
- Attribution preserves raw `sourceHost` and adds `sourceDisplayName`. Null/empty/malformed raw hosts yield null; otherwise parse as a hostname, lowercase it, remove a trailing dot and one leading `www.`, and return the URL parser's ASCII hostname form.
- Detail-only `GET /api/v1/recipes/{id}?scaleFactor=<number>` accepts exactly one unsigned decimal matching `^(?:\d+(?:\.\d*)?|\.\d+)$` and numeric range `0.25..50`; signs, exponent/hex notation, whitespace-only, malformed, multiple, nonfinite, and out-of-range values return the existing `validation_error` shape. List/search behavior is unchanged.
- Detail preserves ingredient `quantity` and adds `scaledQuantity`; the response includes `scaleFactor`. For non-null numeric quantities, multiplication is rounded to at most six decimal places and negative zero is normalized to zero. Null quantities remain null. Scaling does not write recipe data. `servings` remains the original nullable freeform string.
- OpenAPI, `api-v1-contract.server.ts`, generator output, developer playground, examples, REST tests, and MCP shopping metadata remain synchronized.

## Completion Criteria
- [ ] Every line of the feedback source has an implemented or explicitly rejected disposition.
- [ ] Shopping re-add behavior matches the state matrix across web, REST v1, and MCP under repeated and concurrent calls.
- [ ] Workers-runtime tests prove deterministic user/recipe arbitration, first-writer/server-wins adoption, SQLite DO persistence, attempt isolation, revision conflict/rebase, mutation dedupe, ordered alarms, purge barriers, private no-store responses, hibernation WebSockets, and the full Worker 101 response path.
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
- `vitest.config.ts` uses happy-dom/forks and excludes `workers/**`; a separate Workers pool is required.
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
