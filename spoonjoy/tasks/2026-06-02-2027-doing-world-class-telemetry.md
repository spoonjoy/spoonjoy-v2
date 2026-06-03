# Doing: World-Class Telemetry

**Status**: in-progress
**Execution Mode**: direct
**Created**: 2026-06-02 21:32
**Planning**: ./2026-06-02-2027-planning-world-class-telemetry.md
**Artifacts**: ./2026-06-02-2027-doing-world-class-telemetry/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (interactive)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Give Spoonjoy full production visibility across client behavior, REST API usage, OAuth/delegated auth, and MCP clients through PostHog-backed telemetry, while preserving the existing privacy posture that avoids free text, request bodies, cookies, token secrets, and raw query strings.

## Upstream Work Items
- None

## Completion Criteria
- [ ] Server telemetry captures safe lifecycle events for `/api/v1/*`, legacy `/api/*`, `/mcp`, OAuth registration/authorize/token/revoke, and rate-limit/auth/error paths.
- [ ] Captured event payloads answer who, why, when, and how much using ids, auth/source metadata, operation names, scopes, status/error codes, latency, and byte/count fields without unsafe content.
- [ ] PostHog server capture is enabled in production when `POSTHOG_KEY` is configured and remains a no-op when missing or disabled.
- [ ] Client PostHog setup is documented and verified for production build-time `VITE_POSTHOG_KEY`.
- [ ] Developer docs/playground client telemetry captures safe UX lifecycle events without token/body/query leakage.
- [ ] Documentation states the telemetry contract, privacy exclusions, and deployment setup clearly.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## TDD Requirements
**Strict TDD — no exceptions:**
1. **Tests first**: Write failing tests BEFORE any implementation
2. **Verify failure**: Run tests, confirm they FAIL (red)
3. **Minimal implementation**: Write just enough code to pass
4. **Verify pass**: Run tests, confirm they PASS (green)
5. **Refactor**: Clean up, keep tests green
6. **No skipping**: Never write implementation without failing test first

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

**CRITICAL: Every unit header MUST start with status emoji (⬜ for new units).**

### ✅ Unit 0: Setup/Research
**What**: Record current telemetry state, confirm PostHog Cloudflare secret/build-time env state, and save route choke-point notes for `/api/v1/*`, legacy `/api/*`, `/mcp`, and OAuth routes.
**Output**: `spoonjoy/tasks/2026-06-02-2027-doing-world-class-telemetry/setup-notes.md` with secret presence only, no secret values.
**Acceptance**: Notes identify whether `POSTHOG_KEY` exists in Cloudflare, whether local deploy env has `VITE_POSTHOG_KEY`, and the exact implementation files to edit.

### ✅ Unit 1a: Server Analytics Helper — Tests
**What**: Add failing tests in `test/lib/analytics-server.test.ts` for generic PostHog event payload construction, disabled/missing-key no-op behavior, host trimming, safe property merge, capture failure swallowing, and privacy exclusion of unsafe keys.
**Output**: Failing tests proving `captureEvent`/payload helper behavior before implementation.
**Acceptance**: Focused analytics-server tests fail because the generic event capture helper does not exist or does not yet enforce the new contract.

### ✅ Unit 1b: Server Analytics Helper — Implementation
**What**: Extend `app/lib/analytics-server.ts` with reusable `captureEvent` and pure payload builder functions that share PostHog config behavior with `captureException`.
**Output**: Generic PostHog event capture with controlled event names, explicit distinct id, timestamp, `$lib: "spoonjoy-server"`, safe properties, and swallowed network failures.
**Acceptance**: `test/lib/analytics-server.test.ts` passes without changing existing exception-capture behavior.

### ✅ Unit 1c: Server Analytics Helper — Coverage & Refactor
**What**: Run focused analytics tests with coverage expectations, refactor duplicated endpoint-posting logic if useful, and ensure no unsafe property allow/deny branches are uncovered.
**Output**: Clean helper code with test coverage for enabled, disabled, missing-key, trailing-slash host, fetch failure, and unsafe property handling.
**Acceptance**: Focused analytics-server tests pass with no warnings.

### ✅ Unit 2a: API v1 WaitUntil Context — Tests
**What**: Add failing tests or type-focused route-shell coverage proving `app/lib/api-v1.server.ts` can receive a `waitUntil` function from React Router Cloudflare context before it attempts telemetry capture.
**Output**: Tests proving API v1 telemetry can be scheduled through the Worker execution context without blocking the response.
**Acceptance**: Tests fail before implementation because `ApiV1RouteArgs` only types `context.cloudflare.env` and no API v1 telemetry scheduling hook is exposed.

### ✅ Unit 2b: API v1 WaitUntil Context — Implementation
**What**: Update `ApiV1RouteArgs` in `app/lib/api-v1.server.ts` so `context.cloudflare.ctx` is typed, and update `app/routes/api.v1.$.ts` only if TypeScript requires a route-shell binding to preserve the existing call signature.
**Output**: API v1 has the same best-effort background scheduling capability already used by legacy `/api/*` and `/mcp`.
**Acceptance**: Unit 2a tests pass and API v1 route behavior/wire format is unchanged.

### ✅ Unit 2c: API v1 WaitUntil Context — Coverage & Refactor
**What**: Run the focused API v1 route-shell/type tests. Refactor only within `app/lib/api-v1.server.ts` and `app/routes/api.v1.$.ts`.
**Output**: Covered API v1 context plumbing ready for later telemetry units.
**Acceptance**: Focused tests pass with no warnings.

### ✅ Unit 3a: API v1 Public/Discovery Telemetry — Tests
**What**: Add failing tests for `app/lib/api-v1.server.ts` covering anonymous GET `/api/v1`, `/health`, OpenAPI docs, recipe list/detail, and cookbook list/detail.
**Output**: Tests proving `spoonjoy.api_v1.request` emits route template/resource, method, status, request id, auth mode `anonymous`, latency, request byte count, cache/privacy class, origin/referrer host, and coarse user-agent family.
**Acceptance**: Tests fail before implementation and assert no raw query string, cookies, authorization header, request body, response body, recipe title, cookbook title, or other free text appears in telemetry.

### ✅ Unit 3b: API v1 Public/Discovery Telemetry — Implementation
**What**: Instrument `handleApiV1Request` in `app/lib/api-v1.server.ts` for public/discovery success paths using shared helper functions in `app/lib/analytics-server.ts`; any API v1-only helper must stay inside `app/lib/api-v1.server.ts`.
**Output**: Best-effort `ctx.waitUntil(captureEvent(...))` public API v1 telemetry.
**Acceptance**: Unit 3a tests pass and existing public API v1 tests still pass.

### ✅ Unit 3c: API v1 Authenticated Metadata — Tests
**What**: Add failing tests for session and bearer authenticated API v1 reads, including bearer credential id, OAuth client id/resource when present, principal id, scopes, and auth source.
**Output**: Tests proving authenticated API v1 telemetry identifies who called without leaking token values or Authorization headers.
**Acceptance**: Tests fail before implementation and assert no email, username, bearer token, token prefix, raw header, cookie, or free text appears in telemetry.

### ✅ Unit 3d: API v1 Authenticated Metadata — Implementation
**What**: Extend API v1 telemetry to include principal/source/scope metadata after `authorizeApiV1Route` resolves a principal.
**Output**: Authenticated API v1 telemetry for session, personal bearer, OAuth bearer, and self-revoke cases.
**Acceptance**: Unit 3c tests pass and existing auth/scopes API v1 tests still pass.

### ✅ Unit 3e: API v1 Mutation And Validation Telemetry — Tests
**What**: Add failing tests for shopping-list create/check/delete, token list/create/revoke, idempotency replay/in-progress/conflict, JSON validation errors, and not-found validation paths.
**Output**: Tests proving mutation telemetry includes controlled operation names, status/error code, idempotency outcome, request byte count, and latency without payload contents.
**Acceptance**: Tests fail before implementation and assert no shopping item name, unit name, token name, returned token secret, clientMutationId raw value, or request/response body appears in telemetry.

### ✅ Unit 3f: API v1 Mutation And Validation Telemetry — Implementation
**What**: Extend centralized API v1 telemetry so mutation and validation branches report controlled operation/resource names, error codes, idempotency class, and status.
**Output**: API v1 mutation telemetry that preserves existing response wire formats.
**Acceptance**: Unit 3e tests pass and existing shopping-list/token API v1 tests still pass.

### ✅ Unit 3g: API v1 Rate-Limit/Internal-Error Telemetry — Tests
**What**: Add failing tests for rate-limited requests, method-not-allowed, unknown path, authentication required, insufficient scope, invalid token, and internal errors.
**Output**: Tests proving API v1 error telemetry emits safe error code/status/rate-limit scope and preserves existing exception logging/capture behavior.
**Acceptance**: Tests fail before implementation and assert internal error telemetry includes no stack trace except through the existing `$exception` capture path.

### ✅ Unit 3h: API v1 Rate-Limit/Internal-Error Telemetry — Implementation
**What**: Extend API v1 telemetry across early rate-limit returns and catch blocks, preserving `logApiV1InternalError` and any existing response behavior.
**Output**: API v1 error/rate-limit lifecycle telemetry.
**Acceptance**: Unit 3g tests pass and existing API v1 route tests still pass.

### ✅ Unit 3i: API v1 Telemetry — Coverage & Refactor
**What**: Run focused API v1 telemetry and existing API v1 route tests. Refactor only within `app/lib/api-v1.server.ts` and `app/lib/analytics-server.ts`; any new cross-surface helper file or broader extraction requires updating this doing doc first.
**Output**: Covered, centralized API v1 telemetry helpers with no duplicated per-endpoint capture calls.
**Acceptance**: Focused API v1 tests pass with no warnings.

### ✅ Unit 4a: Legacy API Telemetry — Tests
**What**: Add failing tests in `test/routes/route-shell-coverage.test.ts` or a focused legacy API route test for `app/routes/api.$.ts`. Cover success, `ApiAuthError`, not-found, rate-limit, and unexpected-error capture.
**Output**: Tests proving `spoonjoy.legacy_api.request` emits operation name, auth/source metadata when known, status/error, request id if present, latency, and safe request context.
**Acceptance**: Tests fail before implementation and prove legacy API telemetry does not send args/request bodies or secrets.

### ✅ Unit 4b: Legacy API Telemetry — Implementation
**What**: Instrument `handleApiRequest` in `app/routes/api.$.ts` without duplicating operation logic. Preserve existing exception capture while adding lifecycle telemetry.
**Output**: Best-effort legacy API lifecycle telemetry for REST/MCP bootstrap operations routed through `/api/*`.
**Acceptance**: Legacy API telemetry tests pass and existing route-shell tests still pass.

### ✅ Unit 4c: Legacy API Telemetry — Coverage & Refactor
**What**: Run focused legacy route tests. Refactor only within `app/routes/api.$.ts` and `app/lib/analytics-server.ts`; any new cross-surface helper file or broader extraction requires updating this doing doc first.
**Output**: Covered legacy API telemetry with shared helpers where they reduce real duplication.
**Acceptance**: Focused legacy API tests pass with no warnings.

### ✅ Unit 5a: MCP Auth/Rate-Limit Telemetry — Tests
**What**: Add failing tests in `test/lib/mcp/http-mcp.server.test.ts` for non-POST 405, unauthenticated challenge, malformed/invalid token, wrong-resource token, and rate limit.
**Output**: Tests proving `/mcp` emits safe `spoonjoy.mcp.request` events for auth/rate-limit outcomes with status, error code, auth source, latency, and request byte count.
**Acceptance**: Tests fail before implementation and prove no bearer token, Authorization header, request body, or JSON-RPC params are captured.

### ✅ Unit 5b: MCP Auth/Rate-Limit Telemetry — Implementation
**What**: Instrument `handleMcpHttpRequest` in `app/lib/mcp/http-mcp.server.ts` for early method/auth/rate-limit branches.
**Output**: Best-effort MCP auth/rate-limit lifecycle telemetry.
**Acceptance**: Unit 5a tests pass and existing MCP auth tests still pass.

### ✅ Unit 5c: MCP Success Metadata — Tests
**What**: Add failing tests for successful `tools/list` and `tools/call` requests.
**Output**: Tests proving MCP telemetry includes principal id, credential id, OAuth client/resource, JSON-RPC method, and tool name when safely present.
**Acceptance**: Tests fail before implementation and prove no JSON-RPC args or tool argument values are captured.

### ✅ Unit 5d: MCP Success Metadata — Implementation
**What**: Extend MCP telemetry to parse only top-level JSON-RPC `method` and string `params.name` for `tools/call` after authentication.
**Output**: MCP success telemetry for tool listing and tool calls.
**Acceptance**: Unit 5c tests pass and existing MCP success tests still pass.

### ✅ Unit 5e: MCP Error/Notification Telemetry — Tests
**What**: Add failing tests for JSON-RPC error responses, notifications returning 202, malformed JSON/body cases, and internal tool errors.
**Output**: Tests proving MCP telemetry includes response status, JSON-RPC error code when present, notification flag, and existing exception capture remains intact.
**Acceptance**: Tests fail before implementation and prove no JSON-RPC body, params, bearer token, or stack trace appears in lifecycle events.

### ✅ Unit 5f: MCP Error/Notification Telemetry — Implementation
**What**: Extend MCP telemetry across JSON-RPC response/null/error branches while preserving existing `onError` exception capture.
**Output**: MCP error and notification lifecycle telemetry.
**Acceptance**: Unit 5e tests pass and existing MCP error tests still pass.

### ✅ Unit 5g: MCP Telemetry — Coverage & Refactor
**What**: Run focused MCP tests. Refactor only within `app/lib/mcp/http-mcp.server.ts` and `app/lib/analytics-server.ts`; any new cross-surface helper file or broader extraction requires updating this doing doc first.
**Output**: Covered MCP telemetry without duplicated auth/rate-limit logic.
**Acceptance**: Focused MCP tests pass with no warnings.

### ✅ Unit 6a: OAuth Register Telemetry — Tests
**What**: Add failing tests for `/oauth/register` success, invalid metadata, invalid redirect, unsupported scope, method errors, and rate limit.
**Output**: Tests proving `spoonjoy.oauth.register` emits status/error code, client id when created, redirect URI count, scope metadata class, latency, and safe request context.
**Acceptance**: Tests fail before implementation and prove no raw redirect URI query, raw JSON body, client supplied free-text beyond controlled counts/ids, or request body appears in telemetry.

### ✅ Unit 6b: OAuth Register Telemetry — Implementation
**What**: Instrument `app/routes/oauth.register.ts` for route-shell timing/rate-limit metadata and `app/lib/oauth-routes.server.ts` for registration result/error metadata.
**Output**: Safe OAuth registration telemetry.
**Acceptance**: Unit 6a tests pass and existing OAuth registration tests still pass.

### ✅ Unit 6c: OAuth Authorize Telemetry — Tests
**What**: Add failing tests for authorize loader login-gate redirect, consent view, client error view, action approve, action deny, action errors, and rate limit.
**Output**: Tests proving `spoonjoy.oauth.authorize` emits decision/state class, status, client id, scope/resource, principal id when consent is reached, and latency.
**Acceptance**: Tests fail before implementation and prove no authorization code, state value, code challenge, redirect URI query, or raw form body appears in telemetry.

### ✅ Unit 6d: OAuth Authorize Telemetry — Implementation
**What**: Instrument `app/routes/oauth.authorize.tsx` for loader/action timing/rate-limit metadata and `app/lib/oauth-routes.server.ts` for authorize result/error/decision metadata.
**Output**: Safe OAuth authorize telemetry.
**Acceptance**: Unit 6c tests pass and existing OAuth authorize tests still pass.

### ✅ Unit 6e: OAuth Token/Refresh Telemetry — Tests
**What**: Add failing tests for authorization-code exchange success, refresh-token rotation success, unsupported grant, invalid grant, invalid form body, method errors, and rate limit.
**Output**: Tests proving `spoonjoy.oauth.token` emits grant type, status/error code, client id when safely known, scope/resource when returned safely, latency, and safe request context.
**Acceptance**: Tests fail before implementation and prove no authorization code, code verifier, access token, refresh token, token prefix, raw form body, or request body appears in telemetry.

### ✅ Unit 6f: OAuth Token/Refresh Telemetry — Implementation
**What**: Instrument `app/routes/oauth.token.ts` for route-shell timing/rate-limit metadata and `app/lib/oauth-routes.server.ts` for token/refresh result/error metadata.
**Output**: Safe OAuth token/refresh telemetry.
**Acceptance**: Unit 6e tests pass and existing OAuth token tests still pass.

### ✅ Unit 6g: OAuth Revoke Telemetry — Tests
**What**: Add failing tests for revoke success, invalid token/client binding, invalid form body, method errors, and rate limit.
**Output**: Tests proving `spoonjoy.oauth.revoke` emits status/error code, token type hint class when present, client id when safely known, latency, and safe request context.
**Acceptance**: Tests fail before implementation and prove no refresh token, access token, raw form body, or token value appears in telemetry.

### ✅ Unit 6h: OAuth Revoke Telemetry — Implementation
**What**: Instrument `app/routes/oauth.revoke.ts` for route-shell timing/rate-limit metadata and `app/lib/oauth-routes.server.ts` for revoke result/error metadata.
**Output**: Safe OAuth revoke telemetry.
**Acceptance**: Unit 6g tests pass and existing OAuth revoke tests still pass.

### ✅ Unit 6i: OAuth Telemetry — Coverage & Refactor
**What**: Run focused OAuth tests. Refactor only within OAuth route shells, `app/lib/oauth-routes.server.ts`, and `app/lib/analytics-server.ts`; any new cross-surface helper file or broader extraction requires updating this doing doc first.
**Output**: Covered OAuth telemetry with privacy assertions.
**Acceptance**: Focused OAuth tests pass with no warnings.

### ✅ Unit 7a: Client PostHog Bootstrap — Tests
**What**: Add failing tests for `app/lib/analytics.ts` and the client bootstrap contract in `app/entry.client.tsx`/`app/vite-env.d.ts`: missing/blank `VITE_POSTHOG_KEY` disables initialization, truthy `VITE_POSTHOG_DISABLED` disables initialization, configured host is honored, pageview URL remains origin+pathname only, session recording masks text and inputs, and exception capture remains enabled only when PostHog initializes.
**Output**: Tests proving client analytics is build-time gated by `VITE_POSTHOG_KEY` and never always-on.
**Acceptance**: Tests fail before any needed implementation/doc fixes and prove no query string, hash, or page text is included in the client pageview helper.

### ✅ Unit 7b: Client PostHog Bootstrap — Implementation
**What**: Update `app/lib/analytics.ts`, `app/entry.client.tsx`, and `app/vite-env.d.ts` only if Unit 7a exposes a gap; otherwise record in the test commit that existing bootstrap behavior satisfies the contract.
**Output**: Verified client PostHog initialization that is disabled without `VITE_POSTHOG_KEY`, kill-switchable by `VITE_POSTHOG_DISABLED`, and privacy-masked when enabled.
**Acceptance**: Unit 7a tests pass and existing client analytics/pageview tests still pass.

### ✅ Unit 7c: Client PostHog Bootstrap — Coverage & Refactor
**What**: Run focused client analytics tests. Refactor only within `app/lib/analytics.ts`, `app/entry.client.tsx`, and `app/vite-env.d.ts`.
**Output**: Covered client bootstrap and analytics config behavior.
**Acceptance**: Focused client analytics tests pass with no warnings.

### ✅ Unit 7d: Developer Docs/Playground Client Telemetry — Tests
**What**: Add failing tests for safe client-side developer telemetry helpers in `test/lib/analytics.test.ts` and focused component/route tests for `app/routes/developers.tsx` and `app/routes/developers.playground.tsx`.
**Output**: Tests proving docs/playground events use controlled event names, generated operation ids/groups, auth mode, request method, response status class, latency bucket, and outcome fields.
**Acceptance**: Tests fail before implementation and prove no bearer token, OAuth code, form body, request body, response body, raw query string, raw URL, header value, free-text example, or clientMutationId reaches client telemetry.

### ✅ Unit 7e: Developer Docs/Playground Client Telemetry — Implementation
**What**: Add typed safe-event helpers in `app/lib/analytics.ts`, then instrument `app/routes/developers.tsx` and `app/routes/developers.playground.tsx` for docs view, operation selection, auth-mode selection, sign-in handoff, request submitted, and response received events. Use operation metadata from `app/lib/generated/api-v1-playground.ts`; do not duplicate the API surface by hand.
**Output**: Safe PostHog client events for the developer-facing API docs and playground journey.
**Acceptance**: Unit 7d tests pass, existing generated-playground tests still pass, and playground request behavior/auth behavior is unchanged.

### ✅ Unit 7f: Developer Docs/Playground Client Telemetry — Coverage & Refactor
**What**: Run focused analytics, developers-route, and playground tests. Refactor only within `app/lib/analytics.ts`, `app/routes/developers.tsx`, and `app/routes/developers.playground.tsx`.
**Output**: Covered developer client telemetry with shared helper code and no duplicated operation taxonomy.
**Acceptance**: Focused client/developer telemetry tests pass with no warnings.

### ✅ Unit 8a: Docs/Config/Sink Setup — Tests
**What**: Add failing documentation/config/preflight tests in `test/scripts/deployment-preflight.test.ts`, `test/scripts/production-readiness.test.ts`, or existing docs tests when those tests already cover the relevant documentation surface. If no existing test covers a documentation file, record that file in Unit 8c verification notes instead of inventing broad snapshot coverage.
**Output**: Failing tests or doc assertions for telemetry setup and privacy contract updates.
**Acceptance**: Tests fail before docs/config updates where the repository has existing doc/config test coverage.

### ✅ Unit 8b: Docs/Config/Sink Setup — Implementation
**What**: Update `docs/analytics-privacy.md`, `.env.example`, `README.md`, `DEPLOY.md`, `app/cloudflare-env.d.ts`, and the deployment-preflight docs/tests named by Unit 8a failures.
**Output**: Updated docs/config explaining server/client telemetry setup, privacy exclusions, and operational checks.
**Acceptance**: Docs/config tests pass and no documentation suggests printing secret values.

### ✅ Unit 8c: Docs/Config/Sink Setup — Coverage & Refactor
**What**: Run focused docs/config/preflight tests and verify environment checks do not print secret values.
**Output**: Complete telemetry setup documentation and safe deployment checks.
**Acceptance**: Focused docs/config tests pass with no warnings.

### ✅ Unit 8d: PostHog Secret And Build Env Setup
**What**: Retrieve the PostHog project API key only through user-authorized PostHog/browser access or user-provided value, then set `POSTHOG_KEY` with `wrangler secret put POSTHOG_KEY` and ensure production deploy builds receive `VITE_POSTHOG_KEY` without committing it. If the key is unavailable, record the blocker in `setup-notes.md` and continue only with code/docs verification.
**Output**: Secret presence verification through `wrangler secret list` and build-env setup notes, with no secret value printed or committed.
**Acceptance**: `wrangler secret list` shows `POSTHOG_KEY` when a key is available; otherwise `setup-notes.md` states the remaining external setup blocker.

### ✅ Unit 9a: Final Verification
**What**: Run `pnpm run typecheck`, all focused telemetry-related tests, full `pnpm exec vitest run`, and `pnpm run build`.
**Output**: Final verification command summaries saved in `spoonjoy/tasks/2026-06-02-2027-doing-world-class-telemetry/final-verification.md`.
**Acceptance**: All checks pass with no warnings, no secret values appear in output or artifacts, and `final-verification.md` explicitly states whether Unit 8d completed or remains blocked by unavailable PostHog key access.

### ✅ Unit 9b: Deploy And Live Smoke
**What**: Run `pnpm run deploy`, `pnpm run smoke:live`, and `pnpm run smoke:api`. Verify deployed `/api/playground`, `/api/v1/health`, `/mcp` challenge, and OAuth metadata still respond.
**Output**: Deployment version id and live smoke artifact paths recorded in `final-verification.md`.
**Acceptance**: Deployment succeeds only after Unit 8d is complete or explicitly documented as externally blocked, live smoke checks pass, production does not require PostHog to respond to serve app/API traffic, and no secret values appear in command output or committed files.

### ⬜ Unit 9c: Completion Notification
**What**: Commit/push final state and notify Slugger with a concise completion summary.
**Output**: Final git commit/push and Slugger notification.
**Acceptance**: `git status --short` is clean, branch is pushed, Slugger acknowledges completion, and final response includes the deployed API docs/playground link plus verification summary.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-02-2027-doing-world-class-telemetry/`
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away
- **Command style**: Use `pnpm` commands consistently in docs, verification notes, and final reporting.

## Progress Log
- 2026-06-02 21:32 Created from planning doc
- 2026-06-02 21:32 Granularity pass Round 1 addressed by splitting API v1, MCP, OAuth, and sink setup units into smaller slices
- 2026-06-02 21:32 Granularity pass Round 2 converged
- 2026-06-02 21:32 Validation pass Round 1 addressed by adding API v1 waitUntil context plumbing units before API v1 telemetry work
- 2026-06-02 21:32 Validation pass Round 2 converged
- 2026-06-02 21:32 Ambiguity pass converged after retrying two rate-limited reviewer attempts
- 2026-06-02 21:32 Quality pass converged
- 2026-06-02 21:32 Scrutiny pass 6 Tinfoil Hat addressed by adding explicit client PostHog bootstrap units
- 2026-06-02 21:32 Scrutiny pass 6 Tinfoil Hat Round 2 converged; minor hardening added for pnpm consistency and PostHog-key blocker reporting
- 2026-06-02 22:04 Local Stranger fallback finding addressed by adding explicit safe developer docs/playground client telemetry units
- 2026-06-03 07:16 Execution approved by repeated user "go on"; marked Unit 0 in progress
- 2026-06-03 07:18 Unit 0 complete: recorded PostHog secret/build env presence and route chokepoints in setup notes
- 2026-06-03 07:18 Unit 1a started: server analytics helper tests
- 2026-06-03 07:19 Unit 1a complete: focused analytics-server tests fail red on missing generic event helpers
- 2026-06-03 07:19 Unit 1b started: implement server event capture helper
- 2026-06-03 07:22 Unit 1b complete: server event capture helper implemented and focused tests/build pass
- 2026-06-03 07:22 Unit 1c started: analytics helper coverage/refactor check
- 2026-06-03 07:24 Unit 1c complete: analytics-server helper reached 100% per-file coverage; global focused coverage threshold behavior documented
- 2026-06-03 07:24 Unit 2a started: API v1 waitUntil context tests
- 2026-06-03 07:26 Unit 2a complete: API v1 shell tests fail red on missing waitUntil scheduler helper
- 2026-06-03 07:26 Unit 2b started: implement API v1 waitUntil context helper
- 2026-06-03 07:28 Unit 2b complete: API v1 waitUntil context helper implemented and focused test/build pass
- 2026-06-03 07:28 Unit 2c started: focused API v1 context verification
- 2026-06-03 07:30 Unit 2c complete: API v1 waitUntil context tests, typecheck, and build pass after AppLoadContext refactor
- 2026-06-03 07:30 Unit 3a started: API v1 public/discovery telemetry tests
- 2026-06-03 07:32 Unit 3a complete: API v1 public/discovery telemetry tests fail red on missing capture scheduling
- 2026-06-03 07:32 Unit 3b started: implement API v1 public/discovery telemetry
- 2026-06-03 07:38 Unit 3b complete: public/discovery API v1 request telemetry implemented with focused tests, regressions, typecheck, and build passing
- 2026-06-03 07:38 Unit 3c started: authenticated API v1 metadata tests
- 2026-06-03 07:41 Unit 3c complete: authenticated API v1 private-read tests fail red on missing request telemetry
- 2026-06-03 07:41 Unit 3d started: implement authenticated API v1 metadata telemetry
- 2026-06-03 07:42 Unit 3b reviewer found authenticated metadata had landed too early on optional public routes; remediated by constraining Unit 3b and adding supplemental Unit 3c red coverage
- 2026-06-03 07:48 Unit 3d complete: authenticated API v1 metadata telemetry implemented with focused telemetry tests, API v1 regressions, typecheck, and build passing
- 2026-06-03 07:48 Unit 3e started: API v1 mutation and validation telemetry tests
- 2026-06-03 07:52 Unit 3e complete: API v1 mutation, idempotency, token, validation, and not-found telemetry tests fail red on missing operation/error/idempotency metadata
- 2026-06-03 07:52 Unit 3f started: implement API v1 mutation and validation telemetry
- 2026-06-03 07:56 Unit 3f complete: API v1 operation, error code, idempotency, and request byte telemetry implemented with focused tests, regressions, typecheck, and build passing
- 2026-06-03 07:56 Unit 3g started: API v1 rate-limit and internal-error telemetry tests
- 2026-06-03 07:59 Unit 3g complete: API v1 rate-limit/internal-error telemetry tests fail red on early-response/internal-error gaps and missing known-principal insufficient-scope metadata
- 2026-06-03 07:59 Unit 3h started: implement API v1 rate-limit and internal-error telemetry
- 2026-06-03 08:03 Unit 3h complete: API v1 rate-limit/internal-error telemetry implemented, Unit 3f reviewer path-template blocker remediated, focused tests/regressions/typecheck/build passing
- 2026-06-03 08:03 Unit 3i started: API v1 telemetry coverage and refactor verification
- 2026-06-03 08:08 Unit 3i complete: API v1 telemetry coverage/refactor tests added; focused API v1 tests/typecheck/build pass; coverage command limitation documented for pre-existing route-module gaps
- 2026-06-03 08:08 Unit 4a started: legacy API telemetry tests
- 2026-06-03 08:14 Unit 4a complete: legacy REST telemetry tests fail red on missing lifecycle capture for success, auth error, not-found, rate-limit, and unexpected-error paths
- 2026-06-03 08:19 Unit 4b complete: legacy REST lifecycle telemetry implemented with shared analytics request-context helpers; focused legacy/API v1 analytics tests, typecheck, and build pass
- 2026-06-03 08:20 Unit 4c started: focused legacy telemetry coverage and refactor verification
- 2026-06-03 08:25 Unit 4c complete: legacy route and shared analytics helper coverage reached 100% statements/branches/functions/lines; typecheck and build pass
- 2026-06-03 08:28 Unit 5a started: MCP auth/rate-limit telemetry tests
- 2026-06-03 08:32 Unit 5a complete: MCP auth/rate-limit telemetry tests fail red on missing `spoonjoy.mcp.request` lifecycle capture
- 2026-06-03 08:34 Unit 5b complete: MCP auth/rate-limit lifecycle telemetry implemented; focused MCP tests, related telemetry regressions, typecheck, and build pass
- 2026-06-03 08:36 Unit 5c started: MCP success metadata telemetry tests
- 2026-06-03 08:38 Unit 5c complete: MCP success metadata tests fail red on missing `tools/list` and `tools/call` lifecycle capture
- 2026-06-03 08:40 Unit 5d complete: MCP success lifecycle telemetry implemented with allowlisted JSON-RPC method/tool metadata; focused MCP tests, related telemetry regressions, typecheck, and build pass
- 2026-06-03 08:41 Unit 5e started: MCP error and notification telemetry tests
- 2026-06-03 08:42 Unit 5e complete: MCP notification/error telemetry tests fail red on missing 202 notification lifecycle capture
- 2026-06-03 08:44 Unit 5f complete: MCP notification and JSON-RPC error lifecycle telemetry implemented while preserving exception capture; focused MCP tests, related telemetry regressions, typecheck, and build pass
- 2026-06-03 08:45 Unit 5g started: MCP telemetry coverage and refactor verification
- 2026-06-03 08:47 Unit 5g complete: MCP handler and shared analytics helper coverage reached 100% statements/branches/functions/lines; telemetry regressions, typecheck, and build pass
- 2026-06-03 08:48 Unit 6a started: OAuth register telemetry tests
- 2026-06-03 08:51 Unit 6a complete: OAuth register telemetry tests fail red on missing `spoonjoy.oauth.register` lifecycle capture
- 2026-06-03 08:54 Unit 6b complete: OAuth register telemetry implemented for success, validation errors, method errors, and rate limits; focused register/OAuth regression tests, typecheck, and build pass
- 2026-06-03 09:02 Unit 6c started: OAuth authorize telemetry tests
- 2026-06-03 09:04 Unit 6c complete: OAuth authorize telemetry tests fail red on missing `spoonjoy.oauth.authorize` lifecycle capture
- 2026-06-03 09:05 Unit 6d started: implement OAuth authorize telemetry
- 2026-06-03 09:10 Unit 6d complete: OAuth authorize telemetry implemented for loader/action success, errors, decisions, and rate limits; focused tests, OAuth regressions, typecheck, and build pass
- 2026-06-03 09:11 Unit 6e started: OAuth token/refresh telemetry tests
- 2026-06-03 09:14 Unit 6e complete: OAuth token/refresh telemetry tests fail red on missing `spoonjoy.oauth.token` lifecycle capture
- 2026-06-03 09:14 Unit 6f started: implement OAuth token/refresh telemetry
- 2026-06-03 09:20 Unit 6f complete: OAuth token/refresh telemetry implemented for code exchange, refresh, method/form/grant errors, and rate limits; focused tests, OAuth regressions, typecheck, and build pass
- 2026-06-03 09:21 Unit 6g started: OAuth revoke telemetry tests
- 2026-06-03 09:23 Unit 6g complete: OAuth revoke telemetry tests fail red on missing `spoonjoy.oauth.revoke` lifecycle capture
- 2026-06-03 09:24 Unit 6h started: implement OAuth revoke telemetry
- 2026-06-03 09:27 Unit 6h complete: OAuth revoke telemetry implemented for success, not-found, binding/form/method errors, and rate limits; focused tests, OAuth regressions, typecheck, and build pass
- 2026-06-03 09:28 Unit 6i started: OAuth telemetry coverage and refactor verification
- 2026-06-03 09:40 Unit 6i complete: OAuth route shells reached 100% focused coverage; defensive OAuth helper coverage, focused OAuth regressions, typecheck, and build pass; global focused coverage threshold limitation documented
- 2026-06-03 09:40 Unit 6i reviewer gate converged: tests/docs only, focused OAuth suite rerun passed, no runtime changes
- 2026-06-03 09:40 Unit 7a started: client PostHog bootstrap tests
- 2026-06-03 09:44 Unit 7a complete: client analytics and entry-client bootstrap tests cover build-time key gate, disable flag, custom host, masked session recording, exception capture, hydration without init, and query/hash-free page URLs; tests passed immediately because existing bootstrap already satisfies the contract
- 2026-06-03 09:44 Unit 7b started: client PostHog bootstrap implementation verification
- 2026-06-03 09:46 Unit 7b complete: no app-code change required; focused bootstrap tests, typecheck, and build confirm existing PostHog initialization is gated, kill-switchable, host-configurable, exception-enabled only when initialized, and session-recording masked
- 2026-06-03 09:46 Unit 7c started: client PostHog bootstrap coverage/refactor verification
- 2026-06-03 09:48 Unit 7c complete: focused client bootstrap tests passed under coverage; `app/lib/analytics.ts` reached 100% statements/branches/functions/lines; global threshold limitation documented for unrelated app files
- 2026-06-03 09:48 Unit 7d started: developer docs/playground client telemetry tests
- 2026-06-03 09:54 Unit 7d complete: red tests prove missing safe client telemetry helpers and docs/playground event capture, while existing route behavior remains green
- 2026-06-03 09:54 Unit 7e started: implement safe developer docs/playground client telemetry
- 2026-06-03 10:00 Unit 7e complete: safe developer docs/playground client telemetry implemented with generated operation metadata, allowlisted client events/properties, privacy scrubbing, focused tests, generated playground regressions, typecheck, and build passing
- 2026-06-03 10:00 Unit 7f started: developer docs/playground client telemetry coverage/refactor verification
- 2026-06-03 10:04 Unit 7f complete: focused developer telemetry tests pass; `app/lib/analytics.ts` reached 100% statements/branches/functions/lines; typecheck and build pass; global coverage threshold limitation documented for unrelated app files
- 2026-06-03 10:04 Unit 8a started: docs/config/sink setup tests
- 2026-06-03 10:09 Unit 8a complete: deployment-preflight tests now fail red on missing telemetry docs/env validation and incomplete analytics/privacy documentation
- 2026-06-03 10:10 Unit 8b started: implement telemetry docs/config/preflight checks
- 2026-06-03 10:15 Unit 8b complete: telemetry docs, `.env.example`, README/DEPLOY/checklist guidance, and deployment-preflight checks updated; focused preflight tests, typecheck, build, and secret scan pass
- 2026-06-03 10:16 Unit 8c started: verify docs/config/preflight coverage and secret-safe outputs
- 2026-06-03 10:19 Unit 8c complete: fixed reviewer docs-channel finding, added regression coverage for public Vite build vars vs Worker secrets, verified preflight output is secret-safe, and recorded targeted deployment-preflight coverage
- 2026-06-03 10:20 Unit 8d started: verify PostHog Cloudflare secret and production build-time client env without printing values
- 2026-06-03 10:22 Unit 8d complete: Cloudflare secret names and local build env names checked without printing values; `POSTHOG_KEY`/`VITE_POSTHOG_KEY` are unavailable, so setup-notes record the remaining external PostHog key step and telemetry remains disabled by default
- 2026-06-03 10:23 Unit 9a started: final typecheck, focused telemetry tests, full Vitest, build, and secret scan
- 2026-06-03 10:30 Unit 9a complete: typecheck, focused telemetry tests (25 files/264 tests), full Vitest (286 files/5,452 tests), build, and secret scan completed; final verification artifact records Unit 8d unavailable-key status
- 2026-06-03 10:31 Unit 9b started: deploy production Worker and run live smoke/API smoke checks
- 2026-06-03 10:34 Unit 9b complete: deployed Worker version `1b0cc956-4d31-4446-a03c-57739fc7a230`, live smoke and API smoke passed, explicit `/api`, `/api/playground`, `/api/v1/health`, `/mcp`, and OAuth metadata probes passed, and remote smoke user cleanup changed 8 rows
