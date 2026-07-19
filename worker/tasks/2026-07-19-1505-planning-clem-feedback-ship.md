# Planning: Ship Clem Feedback

**Status**: NEEDS_REVIEW
**Created**: 2026-07-19 15:05

## Goal
Ship Clem's accepted feedback as focused Spoonjoy product behavior: cross-device cooking, consistent shopping restoration, private saves, manual tags, and neutral recipe metadata/scaling. Preserve the existing navigation and agent-first import model while removing Pebble-specific behavior.

## Upstream Work Items
- `./2026-07-14-1313-clem-feedback-source.md` is the item-by-item feedback and disposition authority.
- `./2026-07-14-1313-planning-clem-feedback-e2e.md` and its doing bundle are historical planning only; their custom release ledger, secure-launch sandbox, evidence runtime, repair-successor, and Slugger transport are explicitly superseded and will not be implemented in Spoonjoy.

## Scope

### In Scope
- Make authenticated cook progress canonical in one SQLite-backed Cloudflare Durable Object per user and recipe, with same-owner cross-device start/resume and live synchronization.
- Keep anonymous cook progress local-only and prevent authenticated code from reading or uploading anonymous state.
- Pin active cook sessions to the recipe snapshot they started from; support progress updates, completion, abandonment, recipe-edit conflict choices, private resume discovery, and owner-authorized cleanup.
- Store only private session discovery/history metadata in D1; never store step, checklist, scale, or recipe-snapshot progress there.
- Route web, REST v1, MCP, and legacy shared shopping additions through one add/restore behavior: checked or deleted items return unchecked at the fresh end position, while active unchecked items preserve position and accumulate quantity.
- Add canonical private `SavedRecipe` state distinct from cookbook membership and social activity, with one-time migration of existing cookbook-derived saved expectations, owner-only paginated search, web controls, and REST v1 endpoints.
- Add recipe-owned manual tags: one controlled course and up to ten custom labels, authoring/editing, bounded filters on My Recipes/search, public read metadata, and REST/MCP read parity.
- Add optional read-time recipe scaling to REST detail and MCP `get_recipe` through one pure shared helper without changing stored quantities or existing field types.
- Keep numeric `migrations/*.sql` as the only deployable history, retire the incomplete `prisma/migrations` mirror, and keep Prisma schema/db-push for generated client types and disposable development databases only.
- Remove existing Pebble-specific runtime categorization and fixtures while preserving neutral API-provider behavior.
- Preserve current navigation unless implementation reveals a concrete accessibility defect; validate every changed surface on mobile and desktop.
- Ship through the repository's existing CI, QA, pull-request, merge, and automatic production workflow, with exact deployed-revision health checks and disposable-data cleanup.

### Out of Scope
- First-party import/upload UI; existing agent/API import remains supported.
- AI tag suggestions, inference jobs, confidence/provenance storage, or proposal-review UI.
- Pebble-specific fields, routes, names, telemetry categories, documentation, or behavior.
- Cross-user collaborative cook sessions, public cook history, or automatic `RecipeSpoon` creation.
- A global tag catalog, tag merge administration, cookbook tags, or personalized save state in MCP/public recipe responses.
- SavedRecipe native-sync/tombstone expansion in this release.
- Replacing Spoonjoy's existing CI/deploy system, adding a production deployment ledger, sandboxing Wrangler, or implementing Work Suite/Desk/Slugger orchestration inside the product repository.
- A broad navigation redesign or unrelated search/index architecture rewrite.

## Completion Criteria
- [ ] Every feedback-source row has either shipped behavior or a regression test for its explicit rejection.
- [ ] Real Workers-runtime tests prove authenticated cook ownership, SQLite DO persistence, revision conflicts, hibernatable WebSocket fan-out, eviction recovery, idempotent terminal transitions, projection retry, and purge.
- [ ] Two authenticated browser contexts can begin from an initially empty second-device home, discover the same active session without a manual reload or recipe identifier, and synchronize step, checklist, and scale changes.
- [ ] Anonymous progress remains usable across local reloads but never reaches the authenticated DO/D1 path; account changes and logout cannot expose another user's cook state.
- [ ] D1 cook rows contain only owner/recipe/attempt/status/revision/timestamps and bounded display metadata; schema and tests reject progress fields.
- [ ] Recipe edits never silently remap an active session; completion and abandonment remove resume state without social side effects.
- [ ] Web, REST, MCP, and legacy shared shopping paths pass one restoration/concurrency matrix, including unitless identity uniqueness, quantity aggregation, rollback, native-sync readback, and fresh-end ordering.
- [ ] SavedRecipe migration backfills existing cookbook-derived saved expectations once; subsequent save/unsave and cookbook membership changes are independent and private.
- [ ] `/saved-recipes` performs owner-scoped SQL search and keyset pagination, renders at most 24 recipes, returns private no-store responses, and never materializes the full saved collection in Worker memory.
- [ ] Recipe tags enforce one controlled course, ten normalized custom labels, per-recipe uniqueness, length/Unicode validation, owner-only writes, and no AI source or endpoint.
- [ ] My Recipes and global search apply course/tag predicates before their existing result limits; My Recipes rejects unsafe page values and never sends an unsafe SQLite offset.
- [ ] REST v1 contracts, OpenAPI, generated playground, and MCP recipe reads expose the same neutral course/tags metadata and shared detail-only scaling math without persisting scaled values.
- [ ] Existing import remains agent/API-only, current navigation remains reachable, and application/docs/tests contain no Pebble-specific runtime behavior.
- [ ] Numeric migrations apply from empty and against a current pre-feature database, rerun safely where expected, preserve foreign keys, and match the Prisma-modeled tables/columns while allowing documented raw indexes/triggers.
- [ ] All changed code has 100% statement, branch, function, and line coverage; all focused and full tests, typechecks, builds, migration checks, and repository warning gates pass with zero warnings.
- [ ] Changed UI passes keyboard/accessibility checks and `visual-qa-dogfood` at mobile and desktop viewports with no overlap, truncation, unreachable controls, or open absurdity findings.
- [ ] QA migration/deploy, two-client smoke, REST/MCP shopping/save/tag/scaling smoke, cleanup, and residue checks pass before merge.
- [ ] A reviewed PR merges with green CI; the existing automatic production workflow deploys the merge SHA or an independently verified descendant, canonical health identifies that deployment, production smoke passes, and disposable data is removed.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code.
- All branches covered, including auth, malformed input, conflict, reconnect, retry, rollback, empty, boundary, and cleanup paths.
- Cloudflare-specific DO/D1/WebSocket behavior runs in the official Workers Vitest integration; browser behavior runs in existing app tests and Playwright.
- No warnings are allowed in focused tests, the full suite, typecheck, build, migration validation, or browser runs.

## Open Questions
- None. Ari delegated the product decisions; ask only for unavailable credentials, billing/capability changes, or a destructive production action without a safe staged path.

## Decisions Made
- Authenticated cook state is Durable Object-canonical; anonymous state is browser-local; D1 is metadata-only.
- Cloudflare's declarative `exports` lifecycle and SQLite storage back the new `CookSession` class; top-level and QA bindings are configured explicitly.
- Cook mutations use authenticated HTTP with revision checks; WebSockets carry canonical snapshot fan-out and reconnect state.
- A successful cook start waits for its initial D1 discovery row, while failed later projections remain durable DO retry work. The owner home revalidates only while its initial active-session result is empty; visitors never poll private state.
- Shopping reuses existing REST idempotency and adds one shared transactional add/restore service. Web/MCP do not gain a false exactly-once claim.
- SavedRecipe receives a one-time cookbook-membership backfill, then remains independent. Cookbook add/remove operations do not save or unsave recipes after migration.
- Tags are recipe-owned manual metadata, normalized with NFKC, collapsed whitespace, case-folded comparison, a 40-character label limit, one course, and ten custom labels.
- Course/tags filter My Recipes and existing bounded global search. Home and public profiles are not expanded with new unbounded filter/hydration work.
- Numeric migrations are deployment authority. The broken partial Prisma migration history is removed instead of extended.
- Existing release workflows and Work Suite provide delivery/recovery evidence; generic orchestration does not become Spoonjoy product code.

## Context / References
- `./2026-07-14-1313-clem-feedback-source.md`
- `app/routes/recipes.$id.tsx` contains current anonymous local cook progress.
- `workers/app.ts`, `wrangler.json`, and `app/cloudflare-env.d.ts` own the Worker and Cloudflare bindings.
- `app/lib/shopping-list.server.ts`, `app/lib/api-v1.server.ts`, and `app/lib/spoonjoy-api.server.ts` contain the current shopping writers.
- `app/routes/saved-recipes.tsx` currently derives saves from cookbook membership and must become canonical SavedRecipe-backed state.
- `prisma/schema.prisma` and `migrations/*.sql` are the current model and deployable D1 history.
- Cloudflare Durable Object class lifecycle: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
- Cloudflare Workers Vitest integration: https://developers.cloudflare.com/workers/testing/vitest-integration/

## Notes
The historical plan was comprehensive but mis-scoped: it spent most of its surface implementing generic delivery machinery inside Spoonjoy. This replacement keeps the accepted product outcomes and moves delivery responsibility back to the existing repository workflows and Work Suite.

## Progress Log
- 2026-07-19 15:05 Created after the latest-model audit rejected the Round121 release/runtime expansion and remapped the current product code paths.
