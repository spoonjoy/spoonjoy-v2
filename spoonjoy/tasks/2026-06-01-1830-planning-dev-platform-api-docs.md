# Planning: Spoonjoy Developer Platform API And Docs

**Status**: NEEDS_REVIEW
**Created**: 2026-06-01 18:31

## Goal
Expose Spoonjoy as a developer-friendly platform layer on top of the existing public-by-default Chef graph, so external clients can safely read, mutate, sync, and document Spoonjoy data through stable contracts. Deliver a deployed API documentation surface that can be sent to an external developer, while keeping MCP, REST, OAuth, API tokens, and future client profiles aligned through one source of truth.

## Upstream Work Items
- None

**DO NOT include time estimates (hours/days) — planning should focus on scope and criteria, not duration.**

## Scope

### In Scope
- Establish a canonical public platform frame: Spoonjoy is a public-by-default Chef graph; recipes, chefs, cookbooks, spoons/cooks, and public feeds are public surfaces unless explicitly protected; shopping lists, credentials, account settings, drafts/import previews, and other private or mutating surfaces require authenticated scoped access.
- Create versioned API contracts for developer clients, centered on `/api/v1` resources rather than exposing raw operation names as the public contract.
- Keep the existing shared operation layer as the implementation spine for REST, MCP, and future SDK/docs generation.
- Add or harden machine-readable API documentation, including OpenAPI/JSON Schema coverage, stable response/error shapes, examples, and a deployed `/developers` docs page suitable for external developers.
- Add fine-grained scope and credential concepts for public clients, personal API tokens, OAuth/PKCE clients, MCP clients, and device/delegated auth, without requiring developers to understand `ownerEmail` or database-user internals.
- Add integration-safety primitives needed by multiple client classes: idempotency keys, request IDs, rate-limit headers or docs, conflict-aware writes where needed, cursor pagination/sync, tombstones for deletions, and machine-readable errors.
- Prioritize a small proving slice that exercises the platform substrate end to end, with shopping-list sync and mutation as the first private/authenticated workflow.
- Document client profiles and examples for web/browser clients, native/mobile clients, wearable/tiny-device clients, AI/MCP clients, CLI/scripts, portability/import-export bridges, social/public-feed clients, kitchen hardware, and developer tooling.
- Include deployed verification of `https://spoonjoy.app/developers` and relevant API docs/spec endpoints before completion.

### Out of Scope
- A workspace, organization, household, or paid-creator ownership model as a prerequisite for this platform layer.
- Reframing the public product noun away from Chef.
- Private-by-default recipes or cookbooks as the baseline platform assumption.
- Full native app, Pebble app, browser extension, smart-appliance app, or CLI product implementation beyond sample/demo clients needed to prove docs and contracts.
- Billing, app marketplace review, partner approval workflows, commercial entitlements, or paid recipe products.
- Complete pantry inventory, meal-planning, production-batch, allergen/nutrition, and venue-management domains.
- A broad redesign of existing Spoonjoy UI unrelated to developer settings/docs, token/app management, or audit visibility.

## Completion Criteria
- [ ] Public developer docs are deployed and reachable at `https://spoonjoy.app/developers`.
- [ ] A versioned `/api/v1` contract exists for the first supported resources and does not require clients to call raw `/api/tools/:operation` for ordinary workflows.
- [ ] Machine-readable API reference exists for the supported developer surface, with request schemas, response schemas, examples, errors, auth requirements, and scope requirements.
- [ ] Docs clearly explain public-by-default Chef graph semantics and authenticated/private or mutating surfaces.
- [ ] Auth docs and implementation distinguish personal API tokens, OAuth/PKCE apps, MCP clients, and delegated/device-style authorization.
- [ ] Existing OAuth/API/MCP docs drift is resolved, including refresh-token behavior and any mismatch between REST coverage and operation-layer coverage.
- [ ] Fine-grained scopes are represented in docs and enforced for the supported v1 surface.
- [ ] Integration-safety primitives are implemented and documented for the proving slice: idempotency, machine-readable errors, request IDs, cursor/sync behavior, and deletion/tombstone behavior where applicable.
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
