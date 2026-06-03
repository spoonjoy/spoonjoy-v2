# Doing: World-Class Telemetry

**Status**: drafting
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

### ⬜ Unit 0: Setup/Research
**What**: Record current telemetry state, confirm PostHog Cloudflare secret/build-time env state, and save route choke-point notes for `/api/v1/*`, legacy `/api/*`, `/mcp`, and OAuth routes.
**Output**: `spoonjoy/tasks/2026-06-02-2027-doing-world-class-telemetry/setup-notes.md` with secret presence only, no secret values.
**Acceptance**: Notes identify whether `POSTHOG_KEY` exists in Cloudflare, whether local deploy env has `VITE_POSTHOG_KEY`, and the exact implementation files to edit.

### ⬜ Unit 1a: Server Analytics Helper — Tests
**What**: Add failing tests in `test/lib/analytics-server.test.ts` for generic PostHog event payload construction, disabled/missing-key no-op behavior, host trimming, safe property merge, capture failure swallowing, and privacy exclusion of unsafe keys.
**Output**: Failing tests proving `captureEvent`/payload helper behavior before implementation.
**Acceptance**: Focused analytics-server tests fail because the generic event capture helper does not exist or does not yet enforce the new contract.

### ⬜ Unit 1b: Server Analytics Helper — Implementation
**What**: Extend `app/lib/analytics-server.ts` with reusable `captureEvent` and pure payload builder functions that share PostHog config behavior with `captureException`.
**Output**: Generic PostHog event capture with controlled event names, explicit distinct id, timestamp, `$lib: "spoonjoy-server"`, safe properties, and swallowed network failures.
**Acceptance**: `test/lib/analytics-server.test.ts` passes without changing existing exception-capture behavior.

### ⬜ Unit 1c: Server Analytics Helper — Coverage & Refactor
**What**: Run focused analytics tests with coverage expectations, refactor duplicated endpoint-posting logic if useful, and ensure no unsafe property allow/deny branches are uncovered.
**Output**: Clean helper code with test coverage for enabled, disabled, missing-key, trailing-slash host, fetch failure, and unsafe property handling.
**Acceptance**: Focused analytics-server tests pass with no warnings.

### ⬜ Unit 2a: API v1 Telemetry — Tests
**What**: Add failing tests for `app/lib/api-v1.server.ts` through existing API v1 test files or a new focused API v1 telemetry test. Cover successful anonymous public reads, authenticated session/bearer reads, token-auth metadata, write responses, validation errors, auth failures, rate limits, method/not-found errors, and internal errors.
**Output**: Tests proving API v1 emits safe `spoonjoy.api_v1.request` lifecycle events through `waitUntil`.
**Acceptance**: Tests fail before implementation and assert no request body, raw query, cookie, authorization header, token value, or free-text payload appears in telemetry.

### ⬜ Unit 2b: API v1 Telemetry — Implementation
**What**: Instrument `handleApiV1Request` in `app/lib/api-v1.server.ts` at the centralized handler. Capture route template/resource, method, status, error code, request id, auth mode, principal id, credential id, OAuth client/resource, scopes, latency, request byte count, cache/privacy class, rate-limit outcome, origin/referrer host, and coarse user-agent family.
**Output**: Best-effort `ctx.waitUntil(captureEvent(...))` API v1 telemetry on success and error paths.
**Acceptance**: API v1 telemetry tests pass and existing API v1 behavior/wire format is unchanged.

### ⬜ Unit 2c: API v1 Telemetry — Coverage & Refactor
**What**: Run focused API v1 telemetry and existing API v1 route tests, then refactor helpers such as route-template resolution or safe request metadata extraction if needed.
**Output**: Covered, centralized API v1 telemetry helpers with no duplicated per-endpoint capture calls.
**Acceptance**: Focused API v1 tests pass with no warnings.

### ⬜ Unit 3a: Legacy API Telemetry — Tests
**What**: Add failing tests in `test/routes/route-shell-coverage.test.ts` or a focused legacy API route test for `app/routes/api.$.ts`. Cover success, `ApiAuthError`, not-found, rate-limit, and unexpected-error capture.
**Output**: Tests proving `spoonjoy.legacy_api.request` emits operation name, auth/source metadata when known, status/error, request id if present, latency, and safe request context.
**Acceptance**: Tests fail before implementation and prove legacy API telemetry does not send args/request bodies or secrets.

### ⬜ Unit 3b: Legacy API Telemetry — Implementation
**What**: Instrument `handleApiRequest` in `app/routes/api.$.ts` without duplicating operation logic. Preserve existing exception capture while adding lifecycle telemetry.
**Output**: Best-effort legacy API lifecycle telemetry for REST/MCP bootstrap operations routed through `/api/*`.
**Acceptance**: Legacy API telemetry tests pass and existing route-shell tests still pass.

### ⬜ Unit 3c: Legacy API Telemetry — Coverage & Refactor
**What**: Run focused legacy route tests and refactor shared safe telemetry helpers if API v1 and legacy API need common code.
**Output**: Covered legacy API telemetry with shared helpers where they reduce real duplication.
**Acceptance**: Focused legacy API tests pass with no warnings.

### ⬜ Unit 4a: MCP Telemetry — Tests
**What**: Add failing tests in `test/lib/mcp/http-mcp.server.test.ts` for unauthenticated challenge, invalid token, wrong-resource token, rate limit, successful `tools/list`, successful `tools/call`, JSON-RPC error, notification 202, and internal tool error.
**Output**: Tests proving `/mcp` emits `spoonjoy.mcp.request` events with principal id, credential id, OAuth client/resource, JSON-RPC method, tool name when present, status, latency, and safe error code.
**Acceptance**: Tests fail before implementation and prove no JSON-RPC args/body/token values are captured.

### ⬜ Unit 4b: MCP Telemetry — Implementation
**What**: Instrument `handleMcpHttpRequest` in `app/lib/mcp/http-mcp.server.ts`; parse only JSON-RPC method and `params.name` when safe, never full params.
**Output**: Best-effort MCP lifecycle telemetry plus existing exception capture for tool dispatch errors.
**Acceptance**: MCP telemetry tests pass and existing MCP behavior is unchanged.

### ⬜ Unit 4c: MCP Telemetry — Coverage & Refactor
**What**: Run focused MCP tests, cover malformed JSON/body edge cases, and refactor shared safe JSON-RPC metadata helpers if needed.
**Output**: Covered MCP telemetry without duplicating auth/rate-limit logic.
**Acceptance**: Focused MCP tests pass with no warnings.

### ⬜ Unit 5a: OAuth Telemetry — Tests
**What**: Add failing tests around `app/lib/oauth-routes.server.ts` and OAuth route shells for registration, authorize loader/action, token exchange, refresh, revoke, rate-limit, and OAuth error paths.
**Output**: Tests proving OAuth emits safe events such as `spoonjoy.oauth.register`, `spoonjoy.oauth.authorize`, `spoonjoy.oauth.token`, and `spoonjoy.oauth.revoke`.
**Acceptance**: Tests fail before implementation and prove no authorization code, code verifier, access token, refresh token, raw redirect URI query, raw form body, or token secret reaches telemetry.

### ⬜ Unit 5b: OAuth Telemetry — Implementation
**What**: Add route-shell or library-level instrumentation for OAuth endpoints with grant type, decision, scope/resource, client id/name only when safely available, status, error code, latency, and rate-limit state.
**Output**: Best-effort OAuth lifecycle telemetry through `waitUntil`.
**Acceptance**: OAuth telemetry tests pass and OAuth wire formats remain standards-compatible.

### ⬜ Unit 5c: OAuth Telemetry — Coverage & Refactor
**What**: Run focused OAuth tests and existing OAuth route/server tests; refactor common event metadata extraction if needed.
**Output**: Covered OAuth telemetry with privacy assertions.
**Acceptance**: Focused OAuth tests pass with no warnings.

### ⬜ Unit 6a: Docs/Config/Sink Setup — Tests
**What**: Add failing documentation/config/preflight tests where applicable so `POSTHOG_KEY`, `POSTHOG_HOST`, `POSTHOG_DISABLED`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, and `VITE_POSTHOG_DISABLED` are consistently documented and typed.
**Output**: Failing tests or doc assertions for telemetry setup and privacy contract updates.
**Acceptance**: Tests fail before docs/config updates where the repository has existing doc/config test coverage.

### ⬜ Unit 6b: Docs/Config/Sink Setup — Implementation
**What**: Update `docs/analytics-privacy.md`, `.env.example`, `README.md`, `DEPLOY.md`, `app/cloudflare-env.d.ts`, and deployment-preflight docs/tests as needed. Retrieve/set `POSTHOG_KEY` and build-time `VITE_POSTHOG_KEY` if available from PostHog/browser access without exposing values in logs.
**Output**: Updated docs/config plus Cloudflare secret/build-time env setup path.
**Acceptance**: Docs/config tests pass; `wrangler secret list` shows `POSTHOG_KEY` present after setup if the key was available.

### ⬜ Unit 6c: Docs/Config/Sink Setup — Coverage & Refactor
**What**: Run focused docs/config/preflight tests and verify environment checks do not print secret values.
**Output**: Complete telemetry setup documentation and safe deployment checks.
**Acceptance**: Focused docs/config tests pass with no warnings.

### ⬜ Unit 7: Final Verification And Deploy
**What**: Run `pnpm run typecheck`, focused telemetry-related tests, full `pnpm exec vitest run`, `pnpm run build`, `pnpm run deploy`, `pnpm run smoke:live`, and `pnpm run smoke:api`. Verify deployed `/api/playground`, `/api/v1/health`, `/mcp` challenge, and OAuth metadata still respond.
**Output**: Deployment version id, live smoke artifact paths, final git commit/push, and Slugger completion notification.
**Acceptance**: All checks pass, deployment succeeds, production does not require PostHog to respond to serve app/API traffic, and no secret values appear in command output or committed files.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-02-2027-doing-world-class-telemetry/`
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-02 21:32 Created from planning doc
