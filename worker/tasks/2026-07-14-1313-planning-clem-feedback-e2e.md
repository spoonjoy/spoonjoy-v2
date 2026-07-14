# Planning: Clem Feedback E2E

**Status**: drafting
**Created**: 2026-07-14 13:13

## Goal
Turn Clem's feedback into shipped Spoonjoy product primitives: reliable live cooking continuity across devices, correct shopping-list behavior, usable recipe organization, and neutral API metadata while explicitly rejecting first-party import UI and Pebble-specific work.

## Upstream Work Items
- None

## Scope

### In Scope
- Gate the work on Spoonjoy reliability checks using existing health, smoke, cleanup, and deployment-preflight scripts against the correct QA and production targets.
- Fix shopping-list re-add semantics consistently across the web route, REST API v1, and MCP tool surfaces.
- Add a canonical shopping-list mutation helper so web/API/MCP do not drift after the fix.
- Add a Cloudflare Durable Object class and Wrangler bindings/migrations for logged-in live cook sessions.
- Replace logged-in recipe cook progress localStorage as source of truth with server-backed cook sessions while retaining localStorage as anonymous/offline fallback.
- Add D1 cook-session index/history rows only for querying, My Kitchen resume cards, completion history, and idempotent DO-to-D1 completion handoff.
- Add recipe snapshot/fingerprint protection so in-progress cooking handles recipe edits without silently applying progress to the wrong step or ingredient.
- Keep scaling as cook-session state and API projection; never mutate stored recipe ingredients while scaling.
- Add private saved recipes separate from cookbook membership, with recipe detail, My Kitchen, search/API state, and tests.
- Add typed recipe tags for accepted/manual tags that power recipe filtering/search/API; reserve AI tag suggestions for a later reviewed-suggestion layer only after accepted tags are useful.
- Add API-neutral metadata improvements: explicit step count, normalized source display name, yield/servings consistency, tag/course fields, authenticated saved state, and structured scale projections for parseable quantities.
- Update OpenAPI, generated playground data, MCP/API docs, route contracts, and developer-facing docs where public behavior changes.
- Improve My Kitchen/navigation only after underlying cook sessions, saved recipes, and tags exist.
- Run visual QA for changed UI surfaces and smoke/cleanup checks for any live validation.
- Commit atomic logical units and push after each committable unit.

### Out of Scope
- First-party import/upload UI for URLs, PDFs, cookbooks, or videos.
- Pebble-specific fields, routes, naming, or partner behavior.
- Real-time collaborative editing beyond same-user cross-device cook progress.
- Public saved-count metrics unless privacy and aggregation rules are explicitly defined in a future task.
- Explicit author follow/favorite semantics unless saved recipes expose a hard dependency that cannot be solved otherwise.
- High-fidelity cookbook PDF formatting, forewords, photos, or book-layout preservation in the product UI.
- Broad redesign of the existing mobile dock before the supporting primitives exist.

## Completion Criteria
- [ ] Reliability gate identifies the canonical QA/prod smoke commands, confirms cleanup safety, and passes or records a true credential/capability blocker.
- [ ] Shopping-list clear/remove then re-add of the same recipe restores only the newly requested quantity across web, REST API v1, and MCP.
- [ ] Active shopping-list duplicate adds still merge quantities consistently and keep ordering/check-state behavior tested.
- [ ] Logged-in cook progress syncs across two clients through a Durable Object-backed session; anonymous cook progress remains local-only.
- [ ] Cook-session completion is idempotent, creates/updates cook history, clears active resume state, and tolerates DO-to-D1 retry after transient failure.
- [ ] Recipe edits during an active cook session are detected and do not silently remap progress to different steps or ingredients.
- [ ] Scaling persists in cook sessions and API projections expose original quantities plus scaled structured quantities without mutating recipe data.
- [ ] Saved recipes are private, distinct from cookbook membership, and appear on recipe detail, My Kitchen, and authenticated API responses.
- [ ] Accepted typed recipe tags power at least one user-facing filter/search path and API response path.
- [ ] API responses and OpenAPI/playground docs expose step count, normalized source display name, tags/course data, authenticated saved state, and scaling semantics.
- [ ] Import feedback is explicitly rejected in product UI and documented as agentic/API-only.
- [ ] No Pebble-specific behavior is introduced.
- [ ] My Kitchen/navigation updates surface Continue Cooking, Your Recipes, Saved Recipes, Cookbooks, and Tags without destabilizing the mobile dock.
- [ ] Visual QA evidence is captured for changed UI surfaces.
- [ ] Live/manual smoke data is disposable, named according to repo rules, and cleaned up in the same run.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings
- [ ] If UI/rendering/layout changed: `visual-qa-dogfood` evidence captured, absurdity ledger closed, and automated visual metrics still pass

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- None; Ari delegated the v1 product decisions in chat. Human input is needed only if Cloudflare/GitHub credentials are unavailable, billing/capability limits block Durable Objects, or a production operation would be destructive without a safe staged path.

## Decisions Made
- Use a SQLite-backed Cloudflare Durable Object as the canonical owner for logged-in active cook-session state because the feature is stateful coordination across a user's devices.
- Do not require Ari to create a Durable Object manually; implement the exported Worker class, `wrangler.json` binding, and Durable Object migration in code.
- Use a session id for each cook attempt while enforcing one active cook session per logged-in user and recipe in v1.
- Store live progress in the Durable Object; store only query/index/history metadata in D1.
- Keep anonymous cooking progress local-only.
- Adopt local progress into a server session on login/current-recipe open only when no newer active server session exists.
- Treat deleted shopping-list rows as tombstones/history, not quantities to accumulate from; restore resets to the requested quantity and moves the item to the end unchecked.
- Keep import agentic/API-only and do not add a first-party import flow.
- Build accepted typed tags before AI suggestions; AI categorization must never silently become canonical truth.
- Add `SavedRecipe` as a private primitive distinct from cookbook membership.
- Defer explicit author follow/favorite semantics; existing fellow-chef pages remain derived from spoons, forks, and cookbook saves.
- Add only API-neutral provider fields and reject Pebble-specific behavior.
- Run reliability/smoke validation before claiming the product work is shipped.

## Context / References
- `app/routes/recipes.$id.tsx` currently owns cook progress in `localStorage` under `spoonjoy-cook-progress:${recipeId}`.
- `workers/app.ts` is the Cloudflare Worker entrypoint and currently has no Durable Object export.
- `wrangler.json` currently defines D1, R2, rate-limit bindings, and QA env config, but no Durable Object binding or migration.
- `app/cloudflare-env.d.ts` currently defines `Env` without a Durable Object namespace binding.
- `prisma/schema.prisma` has Recipe, RecipeStep, Ingredient, Cookbook, RecipeInCookbook, ShoppingList, ShoppingListItem, and RecipeSpoon but no cook-session index, saved-recipe, tag, or follow models.
- `app/lib/shopping-list.server.ts`, `app/lib/api-v1.server.ts`, and `app/lib/spoonjoy-api.server.ts` all currently restore deleted shopping-list rows by adding old quantity to new quantity.
- `app/lib/api-v1.server.ts` recipe detail returns steps but does not expose explicit `stepCount`; attribution exposes raw `sourceHost`.
- `app/lib/spoonjoy-api.server.ts` MCP recipe summaries already expose `stepCount`, so REST/API and MCP behavior must be reconciled intentionally.
- `app/lib/fellow-chefs.server.ts` derives fellow chefs from spoons, forks, and cookbook saves; explicit follows should not be conflated with this graph.
- `app/components/navigation/mobile-nav.tsx` already gives the mobile dock My Kitchen, Search, and Shopping List.
- `scripts/smoke-live.mjs`, `scripts/smoke-api-live.mjs`, `scripts/cleanup-local-qa-data.mjs`, `scripts/deployment-preflight.ts`, and `scripts/production-readiness.ts` are the reliability/smoke starting points.
- Cloudflare Durable Objects overview: https://developers.cloudflare.com/durable-objects/
- Cloudflare Durable Object WebSocket hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare Durable Object migrations: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/

## Notes
The implementation should prefer shared service helpers over fixing identical behavior independently in routes/API/MCP. Durable Object and D1 state must have explicit ownership boundaries: DO for live progress, D1 for queryable metadata, history, idempotency, and recovery surfaces.

## Progress Log
- 2026-07-14 13:13 Created
