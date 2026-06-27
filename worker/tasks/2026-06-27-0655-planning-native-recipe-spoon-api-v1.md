# Planning: Native Recipe Spoon API V1

**Status**: drafting
**Created**: 2026-06-27 13:55

## Goal
Add first-class API v1 REST endpoints for recipe spoons so the native Apple app can list, create, update, and soft-delete spoon events using its existing request builders. The endpoints must reuse the existing recipe spoon domain logic, API v1 auth/idempotency patterns, and spoon photo cover activation rules.

## Upstream Work Items
- None

**DO NOT include time estimates (hours/days) — planning should focus on scope and criteria, not duration.**

## Scope

### In Scope
- Add `GET /api/v1/recipes/{id}/spoons` as a public/auth-optional read with `recipes:read` optional scope semantics like recipe list/detail.
- Add idempotent bearer `kitchen:write` mutations for `POST /api/v1/recipes/{id}/spoons`, `PATCH /api/v1/recipes/{id}/spoons/{spoonId}`, and `DELETE /api/v1/recipes/{id}/spoons/{spoonId}`.
- Support JSON fields from the native builder: `clientMutationId`, `note`, `nextTime`, `cookedAt`, `photoUrl`, and `useAsRecipeCover` where applicable.
- Return spoon payloads shaped for native `RecipeDetailRecentSpoon`: `id`, `chefId`, `recipeId`, `cookedAt`, `photoUrl`, `note`, `nextTime`, `deletedAt`, `createdAt`, `updatedAt`, and `chef`.
- Use opaque `limit` plus `cursor` pagination for spoon reads, ordered by `cookedAt desc, id desc`.
- Preserve web cover invariants for spoon photos: origin-cook auto-seed in auto mode without a real cover, and owner `useAsRecipeCover` manual opt-in.
- Update API v1 contract metadata, OpenAPI, generated playground manifest, docs, and tests.

### Out of Scope
- Do not touch the Apple/native repo.
- Do not add recipe creation/import APIs or arbitrary photo upload APIs.
- Do not change existing web form spoon behavior.
- Do not change existing recipe cover management endpoint semantics except where shared helper metadata needs to include spoon mutations.

## Completion Criteria
- [ ] Spoon list returns non-deleted spoons for a non-deleted recipe in `cookedAt desc, id desc` order with `limit`, `cursor`, `nextCursor`, and `hasMore`.
- [ ] Spoon list is anonymous-public, validates authenticated credentials/scopes when provided, and rejects insufficient authenticated scopes like recipe list/detail.
- [ ] Spoon create requires `kitchen:write`, is idempotent by `clientMutationId`, calls `createSpoon`, returns native-shaped spoon data, and creates/activates a cover when existing spoon cover decision rules say to.
- [ ] Spoon update requires `kitchen:write`, is idempotent by `clientMutationId`, is owner-only through `updateSpoon`, checks the path recipe id, and supports `note`, `nextTime`, `cookedAt`, and `photoUrl`.
- [ ] Spoon delete requires `kitchen:write`, accepts `clientMutationId` from JSON body, query, or `X-Client-Mutation-Id`, is owner-only through `deleteSpoon`, checks the path recipe id, and soft-deletes.
- [ ] API v1 discovery, scope requirements, OpenAPI full/SDK profiles, generated playground, docs, and route coverage tests include the spoon endpoints.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- [x] Should list pagination be cursor or offset? Use cursor because the native builder already sends `limit` plus `cursor`.
- [x] Should REST spoon cover creation follow web or MCP/internal logic? Use the newer web detail flow because it supports both origin-cook auto-seed and explicit owner `useAsRecipeCover`.

## Decisions Made
- Use `worker/tasks/` because the branch is `worker/native-recipe-spoon-api-v1` and this repo derives task docs from the first branch segment.
- Keep spoon read public/auth-optional with `recipes:read` and `public:read` alternatives via the existing API v1 scope semantics.
- Return public absolute spoon `photoUrl` values via the existing `publicAssetUrl` helper; data URLs remain hidden as `null`.
- Use the existing idempotency table/helper for spoon mutations, extending its operation metadata beyond shopping-list and cover mutations.

## Context / References
- `app/lib/api-v1.server.ts` centralizes API v1 routing, auth, idempotency, response envelopes, telemetry, and recipe cover handlers.
- `app/lib/api-v1-contract.server.ts` is the source for resource discovery and scope requirements.
- `app/lib/api-v1-openapi.server.ts` generates full, SDK, and connector OpenAPI profiles plus playground metadata.
- `app/lib/recipe-spoon.server.ts` owns `createSpoon`, `updateSpoon`, `deleteSpoon`, and `listSpoonsForRecipe`.
- `app/lib/recipe-detail.server.ts` contains the current web spoon cover creation flow.
- `app/lib/spoon-cover-decision.server.ts` and `app/lib/spoon-cover-activation.server.ts` hold reusable cover decision and activation rules.
- `test/routes/api-v1-recipe-covers.test.ts` shows API v1 owner-scoped mutation/idempotency test patterns.
- `test/routes/api-v1-recipes.test.ts` shows optional public auth and cursor behavior for recipe reads.
- `docs/api.md` documents API v1 resources, scopes, sync/mutation semantics, and examples.

## Notes
Implementation should prefer small local helpers in `api-v1.server.ts` for spoon cursor parsing, date parsing, spoon payload formatting, and spoon error normalization. Generated playground should be refreshed by `pnpm run api:playground:generate`.

## Progress Log
- 2026-06-27 13:55 Created
