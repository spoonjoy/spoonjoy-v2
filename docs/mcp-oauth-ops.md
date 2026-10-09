# MCP OAuth Operations

Spoonjoy's Claude connector depends on the remote MCP endpoint at `https://spoonjoy.app/mcp`, OAuth dynamic client registration, the `/oauth/authorize` consent UI, `/oauth/token`, and resource-bound refresh/access credentials.

## Health Signals

- **Post-deploy gate**: `.github/workflows/production-deploy.yml` deploys to Cloudflare, then runs the MCP OAuth canary before the deploy workflow can finish green.
- **Scheduled canary**: `.github/workflows/mcp-oauth-canary.yml` runs the live canary hourly and writes `mcp-oauth-canary-results.json` plus screenshots.
- **D1 invariant audit**: `.github/workflows/mcp-oauth-d1-audit.yml` dry-runs the grant backfill, runs the readonly D1 audit, and writes both `oauth-grant-backfill-report.json` and `mcp-oauth-d1-audit-results.json`.
- **Telemetry**: PostHog events `spoonjoy.oauth.authorize`, `spoonjoy.oauth.token`, and `spoonjoy.mcp.request` expose status/error, client/resource metadata, and latency buckets without raw tokens or request bodies.

## Canary Failure Issue

The canonical GitHub issue title is **MCP OAuth canary failing**. The scheduled canary and production-deploy canary use `scripts/report-mcp-oauth-canary.mjs` to:

- write a GitHub job summary
- scan text artifacts for leaked `sj_`, `ort_`, `oac_`, `Bearer`, `Authorization`, `code=`, and `client_secret` values
- open or comment on the canonical failure issue
- close/comment recovery only when a production deploy supplies a validated `production-release.json` and a matching complete canary result

Scheduled canaries may open or update the failure issue, but they do not close it. They do not yet carry an independently observed deployed source-SHA/Worker-version tuple, so treating scheduled success as recovery would recreate the false-green path this gate prevents. A later exact-SHA production deploy with matching canary evidence is the current recovery authority.

Start with the workflow run linked in the issue body. The summary tells which check failed, cleanup status, target environment, resource URL, and commit SHA.

## Triage Flow

1. Open the latest failed workflow run linked from the issue.
2. Read the job summary before downloading artifacts.
3. Download `mcp-oauth-canary-artifacts` only if the summary is insufficient.
4. Inspect `mcp-oauth-canary-results.json`.
5. Check whether cleanup succeeded. If cleanup failed, look for `codex-mcp-canary-*` data before rerunning.
6. Compare the failed check against the likely surface:
   - `protected-resource metadata`: `/.well-known/oauth-protected-resource/mcp`
   - `dynamic client registration`: `/oauth/register`
   - `authorize consent UI and approve redirect`: `/oauth/authorize` page, form action, or redirect handling
   - `authorization_code token exchange`: `/oauth/token` authorization-code grant
   - `refresh rotation and replay rejection`: refresh-token grant and replay protection
   - `mcp initialize and tools/list`: `/mcp` auth/resource binding or JSON-RPC handling
   - `legacy Claude refresh token promotion`: null-resource legacy refresh-token compatibility

## Support References

Claude may show support references such as `ofid_...` when connector authorization fails. Treat that reference as the user's handle for the incident:

- Search PostHog for nearby `spoonjoy.oauth.authorize`, `spoonjoy.oauth.token`, and `spoonjoy.mcp.request` failures.
- Match by time, client/resource class, status/error code, and route.
- Do not ask the user for raw OAuth codes, bearer tokens, refresh tokens, or callback URLs.
- If the reference cannot be correlated, preserve it in the incident issue/comment and add any available workflow run links.

## Token Lifetimes

- MCP-bound access tokens (the Claude connector) expire after 90 days and token responses carry `expires_in: 7776000`. They had no expiry before migration `0031_oauth_token_expiry`. Access credentials issued earlier still have `expiresAt` NULL in D1 and stop working on 2027-01-07 (`LEGACY_OAUTH_ACCESS_EXPIRES_AT`); the connector should refresh when its token runs out, but no live check has shown Claude refreshing after a `401` yet. Before the cutover, prove it on QA with a short-lived MCP token and watch for Claude refreshes with `outcome: "refreshed"` in the token telemetry. Refresh tokens issued earlier are accepted until 2027-04-07 (`LEGACY_OAUTH_REFRESH_EXPIRES_AT`).
- Generic OAuth access tokens, including the iPhone app's, expire after 15 minutes.
- Every refresh token is accepted for 180 days after it was issued. Rotation issues a fresh 180-day one, so a client that refreshes at least every 180 days stays connected. An expired refresh token is refused with `invalid_grant` ("Refresh token expired") and its grant moves to `revoked` / `inactivity_expiry`.
- A refresh token that was already rotated is refused with `invalid_grant`. If it arrives more than 15 minutes after its rotation while the connection is still active, every refresh and access token on that connection is revoked, including access tokens from before connection keys (migration 0026) that this client holds for the chef, and the grant moves to `compromised` / `refresh_reuse`. Inside 15 minutes it is only refused, because the iPhone app's main app, root view and App Intents each refresh on their own, and a suspended App Intent can send the token it read minutes earlier.
- Rotation leaves the access token issued with the old refresh token valid until its own expiry (15 minutes for generic clients, 90 days for MCP), so in-flight requests from another process of the same client keep working. Reuse detection, disconnect, sign-out-everywhere and expiry revoke it.
- A chef who reports being signed out of Claude or the app with a `compromised` grant had a copy of an old refresh token replayed: treat it as either a possible token leak or a client refresh race. Check the refresh telemetry timing: two refreshes from the same client minutes apart point to a race in the client, not a leak.

## D1 Audit Interpretation

`mcp-oauth-d1-audit-results.json` contains normalized invariant rows:

- `active_refresh_missing_resource`: active Claude MCP refresh tokens without the MCP resource. Non-MCP OAuth clients, such as native app flows, can legitimately have `resource = NULL`.
- `duplicate_active_connection_keys`: more than one active refresh token for a connection key. Refresh rotation should leave only one active row.
- `access_refresh_resource_mismatch`: live OAuth access credentials with no active refresh token for the same user/client/resource. Expired access credentials are ignored.
- `canary_user_residue`: disposable canary users left behind.
- `canary_refresh_residue`: disposable canary refresh-token rows left behind.
- `foreign_key_violations`: rows reported by SQLite/D1 `foreign_key_check`.
- `active_refresh_without_grant`: active refresh tokens that are not linked to an existing durable grant.
- `active_access_without_grant`: live OAuth access credentials that are not linked to an existing durable grant.
- `active_grant_without_active_refresh`: active grants without an active linked refresh token.
- `grant_identity_mismatch`: linked refresh/access rows whose user, client, issuer, resource, connection, or canonical access scope disagrees with the grant.
- `oauth_grant_count`: informational count of durable grants.
- `claude_redirect_client_count`: informational count of registered Claude redirect clients.

The audit script and scheduled workflow are readonly. The workflow's manual `apply_oauth_grant_backfill` input is the only mutation path: first run a dry-run, review its stable issue categories and counts, then rerun with the exact `planSha256` as `oauth_grant_plan_sha256`. The command re-reads D1, refuses a changed digest, uses guarded idempotent writes, and requires a post-apply scan with zero remaining planned mutations. Ambiguous connections remain visible and unmodified. Never guess lineage or ownership from timestamps.

Connector issue, rotation, promotion, and disconnect state is authoritative only after its D1 write completes; no Worker memory, cache, or queue is a persistence boundary. Legacy resource promotion recognizes only its exact null-to-canonical intermediate states, so a new Worker process can safely retry after any individual committed write. Any other grant/token identity mismatch fails closed and must be investigated through the invariant audit.

Do not use broad production cleanup. Any production cleanup must be exact, reviewed against the artifact, and limited to disposable canary identifiers.

## PostHog Monitor Guidance

Recommended monitors:

- `spoonjoy.oauth.authorize` error-rate spike by `error_code`, `decision`, and `resource`.
- `spoonjoy.oauth.token` error-rate spike by `grant_type`, `error_code`, and returned resource class.
- Missing `spoonjoy.oauth.token` success events for production MCP over a canary interval.
- `spoonjoy.mcp.request` 401/403 spike, especially wrong-resource or missing-resource auth challenges.
- Latency spike on `/oauth/token` or `/mcp` request events.

PostHog payloads must remain controlled enum/id/count data. Never add request bodies, response bodies, raw URLs, authorization headers, bearer tokens, OAuth codes, code verifiers, refresh tokens, or free text.

## Real-Claude Manual Smoke

CI emulates Claude's MCP OAuth shape, but a real hosted Claude session remains a manual smoke:

1. Open Claude's connector UI.
2. Add `https://spoonjoy.app/mcp`.
3. Confirm Spoonjoy opens the simplified consent page.
4. Click **Allow access**.
5. Confirm Claude returns to a connected state.
6. Ask Claude to list available Spoonjoy tools or read the shopping list.
7. Disconnect from Spoonjoy account settings and confirm Claude no longer has access.

Capture screenshots of the connector state and Spoonjoy consent page when filing a failure. Do not capture OAuth callback URLs or token-bearing network details.

## Local Commands

```bash
pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts
pnpm run audit:mcp:oauth -- --out mcp-oauth-d1-audit-artifacts
pnpm run backfill:oauth:grants -- --out oauth-grant-backfill-report.json
node scripts/report-mcp-oauth-canary.mjs --artifact-dir mcp-oauth-canary-artifacts --status failure
```
