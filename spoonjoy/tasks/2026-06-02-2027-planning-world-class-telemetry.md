# Planning: World-Class Telemetry

**Status**: NEEDS_REVIEW
**Created**: 2026-06-02 20:29

## Goal
Give Spoonjoy full production visibility across client behavior, REST API usage, OAuth/delegated auth, and MCP clients through PostHog-backed telemetry, while preserving the existing privacy posture that avoids free text, request bodies, cookies, token secrets, and raw query strings.

## Upstream Work Items
- None

## Scope

### In Scope
- Add reusable server-side PostHog event capture for non-exception telemetry in `app/lib/analytics-server.ts`.
- Instrument every `/api/v1/*` request at the centralized `app/lib/api-v1.server.ts` handler with operation, route template, auth mode, principal id when known, credential id when known, OAuth client/resource when known, method, status, error code, request id, request byte count, latency, rate-limit outcomes, and safe request context such as origin/referrer host and user-agent family.
- Instrument legacy `/api/*` operation dispatch in `app/routes/api.$.ts` with the same safe request lifecycle shape.
- Instrument `/mcp` in `app/lib/mcp/http-mcp.server.ts` with authenticated principal id, OAuth client/resource when present, JSON-RPC method/tool name when safely known, status, latency, and auth/rate-limit failures.
- Instrument OAuth registration, authorize, token, and revoke routes with lifecycle events that include client id/name only when safely available, grant type, scope/resource, decision, status, latency, and error code, without sending authorization codes, refresh tokens, access tokens, redirect query strings, or request bodies.
- Ensure client analytics is actually enabled only by build-time `VITE_POSTHOG_KEY`, and document the exact deployment setup needed for both client and server keys.
- Add tests for server event payload construction, privacy redaction, disabled/missing-key behavior, and each instrumented route surface.
- Update `docs/analytics-privacy.md`, `.env.example`, `README.md`, deployment documentation, and Cloudflare env typing as needed.
- Verify whether `POSTHOG_KEY` is present in Cloudflare and, after the key is provided or retrieved through a signed-in PostHog session, set the needed Cloudflare secret and build-time Vite env before deploy.
- Deploy and live-smoke the telemetry plumbing without requiring PostHog availability for request success.

### Out of Scope
- Capturing user-entered free text, request bodies, response bodies, raw query strings, cookies, authorization headers, token values, authorization codes, refresh tokens, access tokens, or full IP addresses.
- Building a billing-grade or audit-grade usage ledger in D1.
- Creating PostHog dashboards, insights, cohorts, or billing reports inside the PostHog UI.
- Adding paid observability services beyond PostHog.
- Changing API behavior, auth semantics, rate-limit limits, or response wire formats except for existing safe telemetry side effects.

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

## Open Questions
- [ ] Confirm the telemetry privacy boundary: use internal ids, credential ids, OAuth client ids, scopes, endpoint templates, status/error, byte counts, latency, origin/referrer host, and coarse user-agent family; never send user free text, raw query strings, request/response bodies, cookies, authorization headers, tokens, codes, secrets, or full IP addresses.
- [ ] Provide or allow retrieval of the PostHog project API key so `POSTHOG_KEY` can be set as a Cloudflare secret and `VITE_POSTHOG_KEY` can be present for production builds.
- [ ] Decide whether “world-class telemetry” also requires a durable first-party usage ledger later; this plan intentionally treats PostHog as the analytics sink, not as a billing/audit database.

## Decisions Made
- PostHog is the telemetry sink because the repo already has `posthog-js`, `@posthog/react`, client initialization, and a server-side PostHog exception wrapper.
- Server telemetry will be best-effort through `ctx.waitUntil`, never blocking or failing user/API requests when PostHog is down.
- Instrumentation should live at route choke points instead of endpoint-by-endpoint code to avoid duplication and missed coverage.
- Privacy-safe metadata is preferred over payload capture; route templates and controlled enum-like fields answer the product questions without leaking kitchen content.
- Cloudflare currently lists no `POSTHOG_KEY` secret, so production server capture is not active yet.

## Context / References
- `app/lib/analytics.ts`
- `app/lib/analytics-server.ts`
- `app/entry.client.tsx`
- `app/entry.server.tsx`
- `workers/app.ts`
- `app/lib/api-v1.server.ts`
- `app/routes/api.$.ts`
- `app/lib/mcp/http-mcp.server.ts`
- `app/lib/oauth-routes.server.ts`
- `app/routes/oauth.register.ts`
- `app/routes/oauth.authorize.tsx`
- `app/routes/oauth.token.ts`
- `app/routes/oauth.revoke.ts`
- `docs/analytics-privacy.md`
- `wrangler.json`
- `app/cloudflare-env.d.ts`
- `test/lib/analytics-server.test.ts`
- `test/routes/api-v1-*.test.ts`
- `test/lib/mcp/http-mcp.server.test.ts`

## Notes
Existing telemetry is partial: client pageviews/recipe-detail events are wired when `VITE_POSTHOG_KEY` is present, and server exception capture exists for some error paths when `POSTHOG_KEY` is present. Cloudflare secret listing does not include `POSTHOG_KEY`, and `.env`/`.env.local` do not advertise PostHog vars, so the sink is not currently complete.

Tinfoil hat pass: PostHog is useful for product analytics but is not a guaranteed audit trail. The plan should not promise billing-grade metering unless a durable first-party ledger is added later. API telemetry must be captured after response construction where possible so status/error and latency are available, but before unsafe body inspection. Secret-bearing operations need explicit tests to prove no token/code/refresh/access values reach event payloads.

## Progress Log
- 2026-06-02 20:29 Created
