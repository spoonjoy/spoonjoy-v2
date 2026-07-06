# MCP OAuth Operations

Spoonjoy's Claude connector depends on the remote MCP endpoint at `https://spoonjoy.app/mcp`, OAuth dynamic client registration, the `/oauth/authorize` consent UI, `/oauth/token`, and resource-bound refresh/access credentials.

## Health Signals

- **Post-deploy gate**: `.github/workflows/production-deploy.yml` deploys to Cloudflare, then runs the MCP OAuth canary before the deploy workflow can finish green.
- **Scheduled canary**: `.github/workflows/mcp-oauth-canary.yml` runs the live canary hourly and writes `mcp-oauth-canary-results.json` plus screenshots.
- **D1 invariant audit**: `.github/workflows/mcp-oauth-d1-audit.yml` runs a readonly D1 audit and writes `mcp-oauth-d1-audit-results.json`.
- **Telemetry**: PostHog events `spoonjoy.oauth.authorize`, `spoonjoy.oauth.token`, and `spoonjoy.mcp.request` expose status/error, client/resource metadata, and latency buckets without raw tokens or request bodies.

## Canary Failure Issue

The canonical GitHub issue title is **MCP OAuth canary failing**. The scheduled canary and production-deploy canary use `scripts/report-mcp-oauth-canary.mjs` to:

- write a GitHub job summary
- scan text artifacts for leaked `sj_`, `ort_`, `oac_`, `Bearer`, `Authorization`, `code=`, and `client_secret` values
- open or comment on the canonical failure issue
- close/comment recovery when a later run succeeds

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

## D1 Audit Interpretation

`mcp-oauth-d1-audit-results.json` contains normalized invariant rows:

- `active_refresh_missing_resource`: active Claude MCP refresh tokens without the MCP resource. Non-MCP OAuth clients, such as native app flows, can legitimately have `resource = NULL`.
- `duplicate_active_connection_keys`: more than one active refresh token for a connection key. Refresh rotation should leave only one active row.
- `access_refresh_resource_mismatch`: live OAuth access credentials with no active refresh token for the same user/client/resource. Expired access credentials are ignored.
- `canary_user_residue`: disposable canary users left behind.
- `canary_refresh_residue`: disposable canary refresh-token rows left behind.
- `claude_redirect_client_count`: informational count of registered Claude redirect clients.

The audit is readonly. Do not use broad production cleanup. Any production cleanup must be exact, reviewed against the artifact, and limited to disposable canary identifiers.

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
node scripts/report-mcp-oauth-canary.mjs --artifact-dir mcp-oauth-canary-artifacts --status failure
```
