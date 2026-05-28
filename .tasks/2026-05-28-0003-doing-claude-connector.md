# Doing: Spoonjoy Claude Connector (remote MCP over Streamable HTTP)

**Status**: READY_FOR_EXECUTION
**Execution Mode**: direct
**Created**: 2026-05-28 00:03
**Planning**: ./2026-05-28-0003-planning-claude-connector.md
**Artifacts**: ./2026-05-28-0003-doing-claude-connector/

## Execution Mode
direct — executed in-session with strict TDD by the orchestrating agent (Ari asleep; confirmation step needs this Claude Code session, so a detached sub-agent isn't suitable).

## Objective
Stateless remote Streamable-HTTP MCP endpoint at `POST /mcp`, sharing the Ouro MCP substrate, bearer-authenticated with delegated tokens, installed + confirmed in this Claude Code tonight.

## Completion Criteria
- [ ] `POST /mcp` handles initialize / tools/list / tools/call / notifications.
- [ ] tools/call enforces bearer auth + cross-owner guard; bootstrap tools open.
- [ ] Shared JSON-RPC core; stdio bridge unchanged.
- [ ] Protocol-version negotiation.
- [ ] `/mcp` rate-limited.
- [ ] 100% coverage; typecheck/coverage/build/e2e green; no warnings.
- [ ] Deployed; connector added to this Claude Code; real tools/call confirmed.
- [ ] Docs + BACKLOG updated.

## Code Coverage Requirements
100% on all new lib code; istanbul-ignore only for genuine DI/defensive seams with `-- @preserve`.

## TDD Requirements
Tests first → red → minimal impl → green → refactor. Commit per unit.

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

### ⬜ Unit 1a: JSON-RPC core refactor — Tests
**What**: In `test/lib/mcp/json-rpc.server.test.ts` (extend existing if present), add failing tests for a new exported `handleJsonRpcMessage(parsed: unknown, router, options?: { defaultProtocolVersion?: string })`:
- returns parse-independent results for an already-parsed object (no JSON string).
- `initialize` echoes `params.protocolVersion` when it's a non-empty string; falls back to default `2024-11-05` when absent/blank/non-string.
- `tools/list` / `tools/call` route to the router; notifications (no `id`) return `null`.
- invalid request (not object / wrong jsonrpc / missing method) → INVALID_REQUEST failure.
- `tools/call` error → INVALID_PARAMS; other handler error → INTERNAL_ERROR.
- existing `handleJsonRpcLine` still passes (parse error path retained) and now delegates to the core.
**Output**: failing tests.
**Acceptance**: tests exist and FAIL (red).

### ⬜ Unit 1b: JSON-RPC core refactor — Implementation
**What**: Extract `handleJsonRpcMessage(parsed, router, options?)` from `handleJsonRpcLine`. `handleJsonRpcLine` becomes: JSON.parse (catch → PARSE_ERROR) then delegate to `handleJsonRpcMessage`. Add protocol-version negotiation in `initialize` using `options.defaultProtocolVersion ?? "2024-11-05"` and the client's `params.protocolVersion` when a non-empty string.
**Output**: refactored `app/lib/mcp/json-rpc.server.ts`.
**Acceptance**: all json-rpc tests PASS; stdio bridge (`scripts/spoonjoy-mcp-server.ts`) still typechecks; no warnings.

### ⬜ Unit 1c: JSON-RPC core — Coverage
**What**: Verify 100% branch coverage on json-rpc.server.ts (protocolVersion present/absent/blank/non-string, notification, all error codes).
**Acceptance**: 100% coverage on the file.

### ⬜ Unit 2a: /mcp route handler lib — Tests
**What**: Create `app/lib/mcp/http-mcp.server.ts` (coverage-measured) exposing `handleMcpHttpRequest({ request, db, env, ctx, principalResolver?, limiter? })` returning a `Response`. Write failing tests in `test/lib/mcp/http-mcp.server.test.ts`:
- non-POST (GET) → 405.
- POST notification (no id) → 202 empty body.
- POST `initialize` → 200 JSON with negotiated protocolVersion; no auth required.
- POST `tools/list` (no auth) → 200 with tool list.
- POST `tools/call` for a bootstrap tool (e.g. `health`) without auth → 200.
- POST `tools/call` for a protected tool without auth → JSON-RPC error (auth required) with appropriate status.
- POST `tools/call` with valid bearer (mocked principal) → dispatches via `callSpoonjoyMcpTool`.
- cross-owner `ownerEmail` mismatch → rejected (reuse api-auth guard semantics).
- invalid JSON body → JSON-RPC PARSE_ERROR.
- rate-limited (mock limiter denies) → 429 with Retry-After.
**Output**: failing tests.
**Acceptance**: red.

### ⬜ Unit 2b: /mcp route handler lib — Implementation
**What**: Implement `handleMcpHttpRequest`. Build a `JsonRpcToolRouter` whose `listTools()` = `{ tools: listSpoonjoyMcpTools() mapped to MCP tool shape }` and `callTool(name,args)` resolves the principal (bearer via `authenticateApiRequest`, allowing the bootstrap-tool exception), assembles `SpoonjoyApiContext` (db, principal, env subset, bucket, waitUntil, allowOwnerEmailFallback:false), and calls `callSpoonjoyMcpTool`. Run `enforceRateLimit` before dispatch. Parse body via the shared JSON-RPC core (`handleJsonRpcMessage`). Auth errors surface as JSON-RPC errors with HTTP status preserved where sensible.
**Output**: `app/lib/mcp/http-mcp.server.ts`.
**Acceptance**: green; 100% coverage on the file.

### ⬜ Unit 2c: /mcp route handler lib — Coverage & refactor
**What**: Cover all branches (auth/no-auth, bootstrap/protected, rate-limit, parse error, notification, GET). DI seams (`principalResolver`, `limiter`, `now`) for testability; `-- @preserve` ignores only where truly unreachable.
**Acceptance**: 100% coverage.

### ⬜ Unit 3: /mcp route file + registration
**What**: Create `app/routes/mcp.ts` with `loader` (405 for GET) + `action` delegating to `handleMcpHttpRequest`, assembling db via `getRequestDb` and the cloudflare env/ctx like `api.$.ts`. Register `route("mcp", "routes/mcp.ts")` in `app/routes.ts`. Add a route-level test `test/routes/mcp.test.ts` (node env, like `auth-webauthn.test.ts`) for an end-to-end initialize + tools/list + an authed tools/call using a real `createApiCredential` token against the local test db.
**Output**: route + registration + route test.
**Acceptance**: route tests pass; typecheck green.

### ⬜ Unit 4: Docs + BACKLOG
**What**: New `docs/claude-connector.md` (remote connector URL, `claude mcp add --transport http` usage, delegated device-code token path, security posture). Cross-link from `docs/ouroboros-mcp.md` + README features. Add `SJ-039` (Claude connector, done) and `SJ-040` (OAuth 2.1 for claude.ai one-click, proposed) to BACKLOG.md.
**Acceptance**: docs render; BACKLOG updated; `test/repo-hygiene.test.ts` + any doc-referencing tests still pass.

### ⬜ Unit 5: Full verify + deploy + confirm in Claude Code
**What**: `pnpm typecheck`, `pnpm test:coverage` (100%), `pnpm build`, `pnpm test:e2e --workers=1`. Open PR, CI green, merge. Deploy (`pnpm deploy:auto`), `pnpm smoke:live` against spoonjoy.app. Mint an `sj_` token for `demo@spoonjoy.com` (createApiCredential; optionally via the device-code flow end-to-end). `claude mcp add --transport http spoonjoy https://spoonjoy.app/mcp --header "Authorization: Bearer sj_…"`. Run `tools/list` + a real `tools/call` (e.g. search) through the connector to confirm. Save confirmation transcript to the artifacts dir.
**Acceptance**: connector listed in `claude mcp list`, a real tool call returns Spoonjoy data.

## Execution
- TDD strictly; commit per unit; push after units; full suite before done.
- Artifacts → `./2026-05-28-0003-doing-claude-connector/`.
- Decisions/blockers handled inline (Ari asleep), logged here.

## Progress Log
- 2026-05-28 00:03 Created from planning doc; scrutiny framings applied (see below).

## Scrutiny (applied during conversion)
- **Tinfoil Hat:** Confirmed `listSpoonjoyMcpTools` returns tool metadata that must be mapped to MCP `{ tools: [...] }` shape (MCP `tools/list` result is `{ tools }`, not a bare array) — Unit 2b maps it. Confirmed notifications must not return a JSON-RPC body (202). Confirmed auth must be enforced at `callTool` time (per-tool), not at transport, because `tools/list` is open. Confirmed rate-limit must run before auth so invalid tokens can't burn DB.
- **Stranger With Candy:** "Route coverage" trap — `app/routes/mcp.ts` is a `.ts` route NOT in the coverage include, so the real logic must live in `app/lib/mcp/http-mcp.server.ts` (coverage-measured) with the route as a thin shell, mirroring how `api.$.ts` delegates. "Tool shape" trap — the stdio path returns tool results already JSON-stringified via the adapter; verify `callSpoonjoyMcpTool` return shape and wrap to MCP `content` form if needed. Set-Cookie/JSON trap from WebAuthn does not apply (no cookies here).
