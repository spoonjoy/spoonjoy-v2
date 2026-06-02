# Planning: Spoonjoy Developer Platform API And Docs

**Status**: approved
**Created**: 2026-06-01 18:31

## Goal
Expose Spoonjoy as a developer-friendly platform layer on top of the existing public-by-default Chef graph, so external clients can safely read, mutate, sync, and document Spoonjoy data through stable contracts. Deliver a deployed API documentation surface that can be sent to an external developer, while keeping MCP, REST, OAuth, API tokens, and future client profiles aligned through one source of truth.

## Upstream Work Items
- None

## Scope

### In Scope
- Establish a canonical public platform frame: Spoonjoy is a public-by-default Chef graph; recipes, chefs, cookbooks, spoons/cooks, and eventual public feeds are public surfaces unless explicitly protected; shopping lists, credentials, account settings, drafts/import previews, and other private or mutating surfaces require authenticated scoped access.
- Create versioned API contracts for developer clients, centered on `/api/v1` resources rather than exposing raw operation names as the public contract. The first shipped `/api/v1` resources are: discovery/health, OpenAPI/spec, public recipe search, public recipe detail, public cookbook search, public cookbook detail, authenticated shopping-list read, authenticated shopping-list sync, authenticated shopping-list item add/check/remove, and authenticated personal API token list/create/revoke metadata.
- Keep the existing shared operation layer as the implementation spine for REST, MCP, and future SDK/docs generation.
- Add or harden machine-readable API documentation, including OpenAPI/JSON Schema coverage, stable response/error shapes, examples, and a deployed `/developers` docs page suitable for external developers.
- Add fine-grained scope and credential concepts for public clients, personal API tokens, OAuth/PKCE clients, MCP clients, and device/delegated auth, without requiring developers to understand `ownerEmail` or database-user internals. The first scope taxonomy is `public:read`, `recipes:read`, `shopping_list:read`, `shopping_list:write`, `cookbooks:read`, `tokens:read`, `tokens:write`, and `offline_access`. First-slice implementation stores scopes on `ApiCredential`, maps legacy `kitchen:read` and `kitchen:write` grants to the equivalent first-slice fine-grained scopes for backward compatibility, and enforces scopes in the v1 route layer before operation dispatch. OAuth Dynamic Client Registration remains available at `/oauth/register` and documented, but authenticated OAuth app-management resources are out of scope for the first implementation.
- Enforce this first-slice v1 scope matrix:
  - `GET /api/v1`, `GET /api/v1/health`, and `GET /api/v1/openapi.json`: anonymous allowed; authenticated callers need no additional scope.
  - `GET /api/v1/recipes` and `GET /api/v1/recipes/:id`: anonymous allowed; authenticated callers with scoped bearer credentials require `recipes:read` or legacy `kitchen:read`.
  - `GET /api/v1/cookbooks` and `GET /api/v1/cookbooks/:id`: anonymous allowed; authenticated callers with scoped bearer credentials require `cookbooks:read` or legacy `kitchen:read`.
  - `GET /api/v1/shopping-list` and `GET /api/v1/shopping-list/sync`: authenticated only; require `shopping_list:read` or legacy `kitchen:read`.
  - `POST /api/v1/shopping-list/items`, `PATCH /api/v1/shopping-list/items/:itemId`, and `DELETE /api/v1/shopping-list/items/:itemId`: authenticated only; require `shopping_list:write` or legacy `kitchen:write`.
  - `GET /api/v1/tokens`: authenticated only; require `tokens:read` or legacy `kitchen:read`.
  - `POST /api/v1/tokens` and `DELETE /api/v1/tokens/:credentialId`: authenticated only; require `tokens:write` or legacy `kitchen:write`.
- Add integration-safety primitives needed by multiple client classes: idempotency keys, request IDs, rate-limit headers or docs, cursor pagination/sync, shopping-list item tombstones, and machine-readable errors. In the first proving slice, idempotency applies to shopping-list item add/check/remove mutations, sync cursors apply to shopping-list items, tombstones apply to removed shopping-list items, and stale/conflict handling is documented as last-writer-wins for shopping-list checked/delete state.
- Prioritize a small proving slice that exercises the platform substrate end to end, with shopping-list sync and mutation as the first private/authenticated workflow.
- Document client profiles and examples for web/browser clients, native/mobile clients, wearable/tiny-device clients, AI/MCP clients, CLI/scripts, portability/import-export bridges, social/public-feed clients, kitchen hardware, and developer tooling. Public feeds are documented as a future client profile in this wave; public feed endpoints are out of scope for the first implementation unless needed for docs navigation.
- Include deployed verification of `https://spoonjoy.app/developers` and relevant API docs/spec endpoints before completion.

### Out of Scope
- A workspace, organization, household, or paid-creator ownership model as a prerequisite for this platform layer.
- Authenticated OAuth app-management resources beyond the existing standards endpoints `/oauth/register`, `/oauth/authorize`, and `/oauth/token`.
- Moving delegated/MCP bootstrap operations under `/api/v1`; `start_agent_connection`, `poll_agent_connection`, `/mcp`, and OAuth protected-resource discovery remain existing documented surfaces in the first slice.
- Reframing the public product noun away from Chef.
- Private-by-default recipes or cookbooks as the baseline platform assumption.
- Full native app, Pebble app, browser extension, smart-appliance app, or CLI product implementation beyond sample/demo clients needed to prove docs and contracts.
- Billing, app marketplace review, partner approval workflows, commercial entitlements, or paid recipe products.
- Complete pantry inventory, meal-planning, production-batch, allergen/nutrition, and venue-management domains.
- A broad redesign of existing Spoonjoy UI unrelated to developer settings/docs, token/app management, or audit visibility.

## Completion Criteria
- [ ] Public developer docs are deployed and reachable at `https://spoonjoy.app/developers`.
- [ ] A versioned `/api/v1` contract exists for discovery/health, OpenAPI/spec, public recipe search/detail, public cookbook search/detail, authenticated shopping-list read/sync/item mutations, and authenticated personal API token list/create/revoke metadata; ordinary first-slice workflows do not require raw `/api/tools/:operation`.
- [ ] Machine-readable API reference exists for the supported developer surface, with request schemas, response schemas, examples, errors, auth requirements, and scope requirements.
- [ ] Docs clearly explain public-by-default Chef graph semantics and authenticated/private or mutating surfaces.
- [ ] Auth docs and implementation distinguish personal API tokens, OAuth/PKCE apps, MCP clients, and delegated/device-style authorization.
- [ ] Existing OAuth/API/MCP docs drift is resolved, including refresh-token behavior and any mismatch between REST coverage and operation-layer coverage.
- [ ] Fine-grained scopes `public:read`, `recipes:read`, `shopping_list:read`, `shopping_list:write`, `cookbooks:read`, `tokens:read`, `tokens:write`, and `offline_access` are represented in docs, stored on API credentials, backward-compatible with existing `kitchen:read` / `kitchen:write` grants, and enforced for the supported v1 surface.
- [ ] The supported `/api/v1` surface follows the explicit per-endpoint scope matrix from this plan, including anonymous access for public recipe/cookbook reads and authenticated-only access for shopping-list and token surfaces.
- [ ] Integration-safety primitives are implemented and documented for the proving slice: idempotent shopping-list add/check/remove mutations, machine-readable errors, request IDs, rate-limit guidance, shopping-list cursor/sync behavior, shopping-list item tombstones, and documented last-writer-wins semantics for shopping-list checked/delete state.
- [ ] At least one sample or guide demonstrates an external client using the docs to authenticate and operate against Spoonjoy.
- [ ] The implemented docs/spec do not drift from REST/MCP operation metadata for the supported surface.
- [ ] Deployed verification proves the docs URL and relevant API endpoints work after deployment.
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
- [ ] None. The canonical frame is accepted: dev-friendly Spoonjoy platform layer on the existing public-by-default Chef graph, with no workspace/org model in the first moonshot plan.

## Decisions Made
- Use Chef-facing product language externally; avoid exposing database `User` or `ownerEmail` as the public mental model.
- Treat Spoonjoy content as public by default for recipes, chefs, cookbooks, spoons/cooks, and public feeds; protect shopping lists, credentials, account settings, drafts/import previews, and mutating actions through authenticated scoped access.
- Do not make workspace/org/household ownership a prerequisite for the first developer-platform implementation; defer it as a separate platform-scale product expansion.
- Make versioned REST resources and machine-readable docs the primary public developer contract; keep MCP and raw operation metadata aligned but not the default human-developer interface.
- Use `/developers` as the public developer documentation route for the first deployed docs surface.
- Use shopping-list sync/mutation as the first private proving slice because it exercises auth, scopes, idempotency, sync, tombstones, errors, docs, and real external-client ergonomics.
- Treat public feed APIs as future platform work in this wave: document the social/public-feed client profile and the public-by-default premise, but do not ship feed endpoints as part of the first implementation.
- Ship public cookbook search/detail in `/api/v1` to match the accepted public-by-default cookbook premise, while keeping cookbook mutation and personal token management authenticated.
- Store first-slice scopes on `ApiCredential`; map existing broad `kitchen:read` / `kitchen:write` values to the fine-grained first-slice scope set so existing tokens and OAuth connectors keep working.
- Limit first-slice credential resources to personal API token list/create/revoke metadata under `/api/v1`; document OAuth/DCR, MCP OAuth, and delegated/device flows, but leave authenticated OAuth app-management resources for later work.
- Keep delegated/MCP bootstrap operations on their existing routes for this slice: `/mcp`, OAuth metadata/routes, and raw `/api/tools/start_agent_connection` / `/api/tools/poll_agent_connection` are documented but not mirrored under `/api/v1`.
- Use sub-agent reviewer gates for planning and doing review passes, then use work-doer for execution after the reviewed doing document is ready.

## Context / References
- `/Users/arimendelow/Projects/spoonjoy-v2/AGENTS.md` — repo workflow, branch/task-doc conventions, testing/coverage/deploy expectations.
- `/Users/arimendelow/Projects/spoonjoy-v2/docs/api.md` — current REST API documentation.
- `/Users/arimendelow/Projects/spoonjoy-v2/docs/claude-connector.md` — current remote MCP/OAuth connector documentation.
- `/Users/arimendelow/Projects/spoonjoy-v2/docs/ouroboros-mcp.md` — current stdio MCP/tooling documentation.
- `/Users/arimendelow/Projects/spoonjoy-v2/app/routes/api.$.ts` — current REST dispatcher and CORS/rate-limit behavior.
- `/Users/arimendelow/Projects/spoonjoy-v2/app/lib/spoonjoy-api.server.ts` — shared operation registry and formatter implementation used by REST/MCP.
- `/Users/arimendelow/Projects/spoonjoy-v2/app/lib/spoonjoy-api-request.server.ts` — shared request principal/context helpers.
- `/Users/arimendelow/Projects/spoonjoy-v2/app/lib/api-auth.server.ts` — API token generation, hashing, and principal resolution.
- `/Users/arimendelow/Projects/spoonjoy-v2/app/lib/oauth-server.server.ts` and `/Users/arimendelow/Projects/spoonjoy-v2/app/lib/oauth-routes.server.ts` — current OAuth/DCR/PKCE/refresh-token implementation.
- `/Users/arimendelow/Projects/spoonjoy-v2/prisma/schema.prisma` — current data model for chefs/users, API credentials, recipes, cookbooks, shopping list items, spoons, covers, OAuth clients, and refresh tokens.
- `/Users/arimendelow/Projects/spoonjoy-v2/test/routes/api.test.ts` and `/Users/arimendelow/Projects/spoonjoy-v2/test/lib/spoonjoy-api-request.server.test.ts` — current API route and shared request-helper coverage patterns.
- Ten client advocate passes from this planning session: wearable/tiny device, native mobile, browser/web, AI/MCP, CLI/scripts, kitchen hardware, portability/import-export, social/public feeds, business/creator, and developer ecosystem.

## Notes
The long-term moon includes many client profiles, but the first implementation should build platform primitives once and prove them through a narrow slice rather than creating one-off Pebble, mobile, or agent APIs. The first slice should leave room for future archive/export, public feed, webhook, SDK, and app-registration work without forcing those domains into the initial PRs. The required deployment target is Spoonjoy production, so doing units must include build/test verification, deployment, and live smoke checks before completion.

## Progress Log
- 2026-06-01 18:31 Created
- 2026-06-01 18:32 Tightened Tinfoil Hat findings: concrete docs route, OAuth-doc drift, and deployed verification
- 2026-06-01 18:32 Marked planning doc NEEDS_REVIEW for sub-agent reviewer gate
- 2026-06-01 18:34 Addressed reviewer findings: first v1 resources, scope taxonomy, feed boundary, and shopping-list safety semantics
- 2026-06-01 18:37 Addressed Round 2 reviewer findings: public cookbook v1 boundary, scope storage/mapping/enforcement, and first-slice credential resources
- 2026-06-01 18:38 Added explicit v1 scope matrix and delegated/MCP bootstrap route boundary
- 2026-06-01 18:39 Approved after sub-agent reviewer gate and boundary fixes converged
