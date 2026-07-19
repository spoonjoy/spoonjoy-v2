# Planning: Ship Clem Feedback

**Status**: NEEDS_REVIEW
**Created**: 2026-07-19 15:05

## Goal
Ship Clem's accepted feedback as focused Spoonjoy product behavior: cross-device cooking, consistent shopping restoration, private saves, manual tags, and neutral recipe metadata/scaling. Preserve the existing navigation and agent-first import model while removing Pebble-specific behavior.

## Upstream Work Items
- `./2026-07-14-1313-clem-feedback-source.md` is the item-by-item feedback and disposition authority.
- The superseded 2026-07-14 planning/doing bundle is retained only in git history. Its custom release ledger, secure-launch sandbox, evidence runtime, repair-successor, and Slugger transport will not be implemented in Spoonjoy.

## Scope

### In Scope
- Make authenticated cook progress canonical in one SQLite-backed Cloudflare Durable Object per user and recipe, with atomic start/resume, same-owner cross-device discovery, and live synchronization.
- Keep anonymous cook progress local-only and prevent authenticated code from reading or uploading anonymous state.
- Pin active cook sessions to the recipe snapshot they started from; support revision-checked progress updates, idempotent completion/abandonment, recipe-edit conflict choices, private resume discovery, projection retry, retention, and owner-authorized purge.
- Store only a complete private registry/discovery projection for unpurged cook objects in D1; never store step, checklist, scale, or recipe-snapshot progress there.
- Route web, REST v1, MCP, and legacy shared shopping additions through one add/restore behavior: checked or deleted items return unchecked at the fresh end position, while active unchecked items preserve position and accumulate quantity.
- Add canonical private `SavedRecipe` state distinct from cookbook membership and social activity, with one-time migration of existing cookbook-derived saved expectations, owner-only paginated search, web controls, and REST v1 endpoints.
- Add recipe-owned manual tags: one controlled course and up to ten custom labels, authoring/editing, bounded filters on My Recipes/search, public read metadata, and REST/MCP read parity.
- Add optional read-time recipe scaling to REST detail and MCP `get_recipe` through one pure shared helper without changing stored quantities or existing field types.
- Add one forward-compatible numeric D1 migration for the new data models, one-time save backfill, and shopping identity repair/index; keep the existing Prisma migration mirror and unrelated migration tooling unchanged.
- Add a dedicated official Workers Vitest project and CI command for the DO/Worker paths, upgrading Vitest to `^4.1.0` and locking a compatible Workers pool, with Istanbul coverage and serialized shared-storage WebSocket execution.
- Add the `CookSession` namespace through the supported legacy `migrations` array using `new_sqlite_classes`. Ship the inert namespace/test/deploy bootstrap in its own reviewed PR with one atomic production deploy, then retain the existing version-upload/canary/promotion path for the product PR and later code-only releases.
- Remove existing Pebble-specific runtime categorization and fixtures while preserving neutral API-provider behavior.
- Preserve current navigation unless implementation reveals a concrete accessibility defect; validate every changed surface on mobile and desktop.
- Ship through the repository's existing CI, QA, pull-request, merge, and automatic production workflow, with exact deployed-revision health checks and disposable-data cleanup.

### Out of Scope
- First-party import/upload UI; existing agent/API import remains supported.
- AI tag suggestions, inference jobs, confidence/provenance storage, or proposal-review UI.
- Pebble-specific fields, routes, names, telemetry categories, documentation, or behavior.
- Cross-user collaborative cook sessions, public cook history, or automatic `RecipeSpoon` creation.
- A global tag catalog, tag merge administration, cookbook tags, or personalized save state in MCP/public recipe responses.
- Personalized `isSaved` enrichment on recipe-read endpoints, ongoing cookbook-to-save coupling, or a full rewrite of shopping check/update/delete/clear operations.
- SavedRecipe native-sync/tombstone expansion in this release.
- Deleting `prisma/migrations`, replacing Spoonjoy's CI/deploy system, adding a production deployment ledger, sandboxing Wrangler, or implementing Work Suite/Desk/Slugger orchestration inside the product repository.
- A broad navigation redesign or unrelated search/index architecture rewrite.

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

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code.
- All branches covered, including auth, malformed input, conflict, reconnect, retry, rollback, empty, boundary, and cleanup paths.
- Cloudflare-specific DO/D1/WebSocket behavior runs in a dedicated official Workers Vitest integration with Istanbul and `--max-workers=1 --no-isolate`; browser behavior runs in existing app tests and Playwright.
- No warnings are allowed in focused tests, the full suite, typecheck, build, migration validation, or browser runs.

## Open Questions
- None. Ari delegated the product decisions; ask only for unavailable credentials, billing/capability changes, or a destructive production action without a safe staged path.

## Decisions Made
- Authenticated cook state is Durable Object-canonical; anonymous state is browser-local; D1 is metadata-only.
- The SQLite-backed `CookSession` class uses Cloudflare's fully supported legacy lifecycle: explicit top-level and QA bindings plus retained migration `v1_cook_session` with `new_sqlite_classes`. Declarative `exports` is deferred because its permanent prohibition on version upload would remove Spoonjoy's existing canary controls without providing a required capability.
- The bootstrap PR contains the inert exported class, bindings, migration, Workers test lane, and a source-controlled one-time atomic production path. It proves the lifecycle boundary before the product PR enables endpoints; failure before boundary verification is repaired forward. The product PR restores the existing canary path, and DO protocols remain forward/backward compatible during gradual deployments.
- Exact same-origin `/api/cook-sessions/:recipeId/*` HTTP/WebSocket endpoints authenticate in the Worker, validate `Origin` for mutations/upgrades, derive the user and DO name server-side, and return `private, no-store`; WebSocket upgrade responses bypass response cloning.
- Private `GET /api/cook-sessions` reads only the authenticated owner's D1 active rows ordered by `updatedAt DESC, recipeId DESC`. The home polls it every five seconds only while its initial list is empty and the page is visible/online, with immediate revalidation on mount, focus, visibility, and online events.
- The recipe-scoped contract is `POST .../start`, `GET/PATCH .../:recipeId`, `POST .../:recipeId/{complete|abandon|restart}`, `GET .../:recipeId/socket`, and owner-only `DELETE .../:recipeId` for purge. The Worker builds start/restart snapshots from D1; clients never submit trusted recipe content.
- Snapshot version 1 pins title, servings, ordered step IDs/numbers/titles/descriptions/durations, ingredient IDs/names/quantities/units, and step-output-use IDs/links plus a deterministic content hash. The DO stores it with `active|completed|abandoned` state.
- The DO mints `attemptId`; every mutation carries `attemptId`, `expectedRevision`, and `mutationId`. Duplicate mutation IDs replay their result, stale attempts/revisions return 409 with the canonical revision/snapshot, simultaneous starts resume one active attempt, and restart creates a new attempt only by atomically abandoning the old one. Recipe mismatch offers `continue original` or `abandon and start current`; no command silently remaps IDs.
- Canonical state and a highest-revision pending projection persist before D1 writes. Start returns success only after a conditional initial projection; later failures retry monotonically without resurrecting terminal rows. One persisted scheduler owns projection retry and 24-hour terminal retention, then closes sockets, deletes its alarm/storage, and removes the registry row.
- D1 is the complete registry for every unpurged object. Test/smoke cleanup enumerates owner rows, purges each DO first, verifies projection removal, then deletes disposable owner data; partial failures remain retryable and emit bounded privacy-safe errors through existing observability.
- Shopping uses one SQLite `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` statement and a partial unique active-identity index over `shoppingListId`, `ingredientRefId`, and `COALESCE(unitId, '')`. The migration merges active duplicates into the earliest-position/ID row, sums non-null quantities, preserves unchecked state when any duplicate is unchecked, tombstones extras, then installs the index. Active unchecked and checked re-adds retain the same row ID; checked rows move to a newly allocated end position and become unchecked; deleted rows retain their tombstone while re-add creates a new active ID. SQLite/D1 serializes each statement, every successful mutation advances `updatedAt`, no application retry risks double-add, and a failed statement leaves no partial write and surfaces the existing adapter error.
- SavedRecipe key is `(userId, recipeId)` with `savedAt`; backfill deduplicates memberships by `Cookbook.authorId` and sets `savedAt = MAX(RecipeInCookbook.updatedAt)`. Afterward only explicit save/unsave changes it. REST uses `GET /api/v1/saved-recipes`, idempotent `PUT`/`DELETE /api/v1/saved-recipes/:recipeId`, existing kitchen scopes/idempotency, and `Cache-Control: private, no-store` plus credential-varying headers. Lists order by `savedAt DESC, recipeId DESC`; a versioned base64url JSON cursor carries both values and applies the matching strict-less-than predicate, with malformed cursors returning 400.
- Tags are recipe-owned manual metadata. Course is nullable `main|side|appetizer|dessert`. Labels are NFKC-normalized, whitespace-collapsed, reject control characters, count at most 40 Unicode code points, compare by locale-independent lowercasing, keep the first spelling for duplicates, sort by normalized key, and allow ten. Repeated tag filters are AND.
- Optional REST query/MCP argument `scale` is finite `0.1..100`. It multiplies ingredient quantities only, rounds to at most six decimal places, leaves free-form `servings` and stored data unchanged, and adds scale metadata only when requested; absent scale preserves existing payload shape and invalid values produce adapter-native invalid-argument responses from one validator.
- Course/tags filter My Recipes and existing bounded global search. Search freshness includes tag/course changes; home and public profiles are not expanded with new unbounded filter/hydration work.
- Numeric migrations remain deployment authority for production D1. This task leaves the existing Prisma migration mirror and unrelated `dev:sync` compatibility path in place.
- The D1 migration is previous-Worker-compatible. The existing production gate is extended only for the reviewed deterministic backfill/duplicate-reconciliation/index forms, with D1 recovery bookmark, duplicate/backfill preflight, migration verification, and no destructive rollback. The product Worker then follows the restored canary path; a failed release leaves a compatible schema and restores only to the post-bootstrap Worker.
- Existing release workflows and Work Suite provide delivery/recovery evidence; generic orchestration does not become Spoonjoy product code.

## Context / References
- `./2026-07-14-1313-clem-feedback-source.md`
- `app/routes/recipes.$id.tsx` contains current anonymous local cook progress.
- `workers/app.ts`, `wrangler.json`, and `app/cloudflare-env.d.ts` own the Worker and Cloudflare bindings.
- `app/lib/shopping-list.server.ts`, `app/lib/api-v1.server.ts`, and `app/lib/spoonjoy-api.server.ts` contain the current shopping writers.
- `app/routes/saved-recipes.tsx` currently derives saves from cookbook membership and must become canonical SavedRecipe-backed state.
- `prisma/schema.prisma`, `migrations/*.sql`, `scripts/deploy-production-canary.ts`, and `.github/workflows/*.yml` own the current model and delivery path.
- Cloudflare Durable Object class lifecycle: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
- Cloudflare legacy Durable Object migrations: https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/
- Cloudflare gradual deployments with Durable Objects: https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/
- Cloudflare rollback binding limits: https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- Cloudflare Workers Vitest integration: https://developers.cloudflare.com/workers/testing/vitest-integration/

## Notes
The historical plan was comprehensive but mis-scoped: it spent most of its surface implementing generic delivery machinery inside Spoonjoy. This replacement keeps the accepted product outcomes, isolates the one Cloudflare-required lifecycle bootstrap, and leaves delivery orchestration in the existing workflows and Work Suite.

## Progress Log
- 2026-07-19 15:05 Created after the latest-model audit rejected the Round121 release/runtime expansion and remapped the current product code paths.
- 2026-07-19 15:05 Incorporated first-round product, Cloudflare, data, and delivery review findings; corrected stale source dispositions and froze executable contracts.
- 2026-07-19 15:20 Incorporated Round 2 findings; selected the legacy lifecycle to preserve canaries and fixed discovery, pagination, and shopping atomicity contracts.
