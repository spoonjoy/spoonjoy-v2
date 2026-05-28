# Planning: Spoonjoy Claude Connector (remote MCP over Streamable HTTP)

**Status**: approved
**Created**: 2026-05-28 00:03

## Goal
Let Claude use a user's real Spoonjoy kitchen (recipes, cookbooks, shopping list, search) via a remote MCP connector served by the Cloudflare Worker, sharing the existing Ouro MCP substrate, authenticated with a delegated bearer token. Must be installed and confirmed working in this Claude Code tonight without interactive OAuth.

## Scope

### In Scope
- A stateless remote Streamable-HTTP MCP endpoint at `POST /mcp` on the Worker.
- Transport-agnostic JSON-RPC core: refactor `app/lib/mcp/json-rpc.server.ts` to expose `handleJsonRpcMessage(parsed, router, options)` reused by both the stdio bridge and the new HTTP route; keep `handleJsonRpcLine` working (it delegates to the new core).
- `initialize` protocol-version negotiation: echo the client's requested `params.protocolVersion` when it's a non-empty string, else fall back to the current default (`2024-11-05`).
- `initialize` + `tools/list` are open (discovery, no auth). `tools/call` authenticates via `authenticateApiRequest` and enforces the same public-bootstrap-tool allowance + cross-owner `ownerEmail` rejection as `app/routes/api.$.ts`.
- Notifications (JSON-RPC messages with no `id`) return HTTP 202 with empty body.
- Rate limiting on `/mcp` reusing `app/lib/rate-limit.server.ts` (token + IP), returning JSON-RPC-shaped 429 semantics.
- Delegated auth: reuse the existing device-code flow in `app/lib/agent-connection.server.ts` as-is. No new auth backend.
- Docs: a new `docs/claude-connector.md` covering the remote connector + token-acquisition (delegated device-code) path; cross-link from `docs/ouroboros-mcp.md` and README.
- Autonomous confirmation: deploy; mint an `sj_` token for the demo user (`demo@spoonjoy.com`); `claude mcp add --transport http spoonjoy https://spoonjoy.app/mcp --header "Authorization: Bearer sj_…"`; confirm `tools/list` and at least one real `tools/call`.
- BACKLOG.md: add `SJ-039` (this connector, done) and `SJ-040` (OAuth 2.1 for claude.ai one-click, proposed/follow-up).

### Out of Scope (tonight)
- Full OAuth 2.1 authorization server / dynamic client registration / claude.ai one-click consent UI (tracked as `SJ-040`).
- SSE / `text/event-stream` streaming + server-initiated notifications.
- JSON-RPC batch (array) request bodies.
- `Mcp-Session-Id` stateful sessions.
- Changing the stdio bridge's behavior beyond the shared-core refactor.

## Completion Criteria
- [x] `POST /mcp` handles `initialize`, `tools/list`, `tools/call`, and notifications.
- [x] `tools/call` enforces bearer auth + cross-owner guard; bootstrap tools work unauthenticated.
- [x] Shared JSON-RPC core used by both stdio and HTTP; stdio bridge behavior unchanged.
- [x] Protocol-version negotiation works (echo client version).
- [x] `/mcp` is rate-limited.
- [x] 100% test coverage on all new code.
- [x] All tests pass; no warnings; `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, `pnpm test:e2e` green.
- [x] Deployed; connector added to this Claude Code and a real `tools/call` confirmed.
- [x] Docs written; BACKLOG updated.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No istanbul-ignore on new code except genuine defensive/DI-seam branches, with `-- @preserve` justification (repo convention).
- All branches covered (auth/no-auth, bootstrap vs protected tool, valid/invalid JSON, notification vs request, rate-limited vs allowed, protocol-version present vs absent).
- Error paths tested (parse error, invalid request, method not found, tool error, auth failure).

## Open Questions
- [ ] None blocking. (OAuth-for-claude.ai deferred to SJ-040 by decision below.)

## Decisions Made
- **Self-approved under Ari's overnight autonomous mandate.** Ari (the human) explicitly authorized proceeding without waking him ("don't return control until totally done… what would Ari do, then do that"). This planning doc's approval gate is satisfied by that standing delegation; recorded honestly rather than simulating a separate human sign-off.
- **Transport: remote Streamable-HTTP at `/mcp`, `application/json` responses, stateless.** Fits Workers; no SSE needed for request/response tool calls; reuses the deployed Worker. (Ideation Surviving Shape.)
- **Delegated auth = existing device-code flow + bearer token; NOT a new OAuth server tonight.** It is real delegated auth, already shipped, and confirmable autonomously (Claude Code accepts `--header`). OAuth 2.1 for claude.ai is `SJ-040`.
- **Discovery is open; mutation is gated.** `initialize`/`tools/list` need no auth (clients must discover tools pre-auth); `tools/call` enforces auth per the existing bootstrap/owner rules.
- **Endpoint path `/mcp`** (MCP convention), not `/api/mcp`.

## Context / References
- `app/lib/mcp/json-rpc.server.ts` — JSON-RPC handler (`handleJsonRpcLine`, `JsonRpcToolRouter`, codes). Refactor target.
- `app/lib/mcp/spoonjoy-tools.server.ts` — `listSpoonjoyMcpTools()`, `callSpoonjoyMcpTool(name, args, ctx)`; `SpoonjoyMcpContext = SpoonjoyApiContext`.
- `app/routes/api.$.ts` — auth pattern: `authenticateApiRequest`, `PUBLIC_BOOTSTRAP_OPERATIONS`, cross-owner guard, env/bucket/waitUntil context assembly, rate-limit wiring.
- `app/lib/api-auth.server.ts` — `authenticateApiRequest(db, request, env)`, `ApiAuthError`, principal shape.
- `app/lib/rate-limit.server.ts` — `enforceRateLimit`, `rateLimitedResponse`.
- `app/lib/agent-connection.server.ts` — device-code delegated auth (`startAgentConnection`, `approveAgentConnectionRequest`, `pollAgentConnection`).
- `app/routes.ts` — route registration.
- `docs/ouroboros-mcp.md` — existing MCP docs to cross-link.
- MCP Streamable HTTP: single endpoint, POST JSON-RPC → `application/json` response; notifications → 202.

## Notes
- The HTTP route must assemble the same `SpoonjoyApiContext` as `api.$.ts` (db, principal, env subset, bucket, waitUntil, `allowOwnerEmailFallback: false`).
- `tools/list` should reflect the same tool set as `/api/tools`.
- Confirmation token: prefer minting directly via `createApiCredential` for `demo@spoonjoy.com`; optionally exercise the full device-code path (`startAgentConnection` → `approveAgentConnectionRequest` → `pollAgentConnection`) to prove delegated auth end-to-end.
- Coverage gotcha: route `.ts` files under `app/routes/` are NOT in the coverage include (`app/routes/**/*.tsx` only), but `app/lib/**/*.ts` IS — so the JSON-RPC core + any new lib helper need 100%; the route file mirrors `api.$.ts` (also a `.ts`, not coverage-measured) but should still be tested for correctness.

## Progress Log
- 2026-05-28 00:03 Created (ideation handoff → planning), tinfoil pass folded in, self-approved under overnight mandate.
