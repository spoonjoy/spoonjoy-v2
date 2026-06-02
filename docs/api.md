# Spoonjoy API

Spoonjoy's public developer surface starts at `/developers` and the machine-readable contract lives at `/api/v1/openapi.json`. API v1 is designed for small devices, mobile apps, scripts, browser clients, and agent clients that need to build on the public-by-default Chef graph while keeping private shopping-list data owner-scoped.

## Base URLs

- Production docs: `https://spoonjoy.app/developers`
- API discovery: `https://spoonjoy.app/api/v1`
- OpenAPI 3.1: `https://spoonjoy.app/api/v1/openapi.json`
- Remote MCP: `https://spoonjoy.app/mcp`

## Response Shape

Successful JSON responses use an envelope except for the raw OpenAPI document:

```json
{
  "ok": true,
  "requestId": "req_example",
  "data": {}
}
```

Errors include a stable code, message, HTTP status, and request id:

```json
{
  "ok": false,
  "requestId": "req_example",
  "error": {
    "code": "authentication_required",
    "message": "Authentication required",
    "status": 401
  }
}
```

## Authentication

Spoonjoy accepts the normal signed-in Spoonjoy session for same-origin browser requests. In the playground, leave auth on Session and private endpoints will treat the logged-in chef as the authenticated owner. There is no token to mint or paste for playground calls.

External clients that run outside the Spoonjoy browser session use bearer credentials through `Authorization: Bearer sj_...`. Public recipe and cookbook reads work without a token, but authenticated external requests can use scoped tokens to read private resources, mutate the owner shopping list, or manage token metadata.

Supported entry points:

- Bearer credentials: `GET /api/v1/tokens`, `POST /api/v1/tokens`, and `DELETE /api/v1/tokens/{credentialId}`
- OAuth/DCR clients: `POST /oauth/register`, `GET /oauth/authorize`, and `POST /oauth/token`
- Delegated agent connection: `POST /api/tools/start_agent_connection` and `POST /api/tools/poll_agent_connection`
- MCP clients: `POST /mcp`

OAuth access tokens are normal Spoonjoy API credentials. OAuth token responses also include a rotating `refresh_token`; each refresh-token grant rotates the presented token and rejects replay.

## Token Acquisition

Token acquisition is separate from token usage. `Authorization: Bearer sj_...` is how an external request authenticates after a token exists; the sections below are where that token comes from.

### No token: signed-in browser

A same-origin browser client does not fetch or store a bearer token. The chef signs into Spoonjoy with password, passkey, or any configured Google, GitHub, or Apple provider, and private API calls use the resulting session cookie.

```ts
await fetch("/api/v1/shopping-list", {
  credentials: "same-origin",
});
```

### Personal token: signed-in chef creates one

For a script, tiny device, or developer-owned client, the chef signs in first and runs `POST /api/v1/tokens` from Session auth, such as through the generated playground. An existing bearer credential with `tokens:write` can also create another token, but never with broader scopes than it already has. Spoonjoy returns the raw `sj_...` secret once; save it outside browser bundles.

```http
POST /api/v1/tokens
Auth: Session cookie or Bearer sj_... with tokens:write
Content-Type: application/json

{
  "name": "Kitchen script",
  "scopes": ["recipes:read", "shopping_list:read"]
}
```

### Delegated token: OAuth/PKCE

For a third-party app, use OAuth/PKCE. The client registers with `POST /oauth/register`, redirects the chef to `GET /oauth/authorize`, then exchanges the authorization code with `POST /oauth/token`.

If the chef is not signed in, Spoonjoy redirects to `/login?redirectTo=...`. That login page supports password, passkeys, and any configured Google, GitHub, or Apple provider; each path returns to the original OAuth consent request. Those provider buttons are Spoonjoy sign-in methods, not external token grants. The client never handles the chef's password.

```text
POST /oauth/register
GET /oauth/authorize?response_type=code&scope=kitchen%3Aread+kitchen%3Awrite&code_challenge_method=S256
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=...&code=...&code_verifier=...
```

The token response contains `access_token: "sj_..."`, `token_type: "Bearer"`, `expires_in`, `scope`, and a rotating `refresh_token`.

### Delegated token: approval link

For agents or devices that cannot run a browser-based OAuth callback, use the delegated approval link. Call `POST /api/tools/start_agent_connection`, show the returned `authorizationUrl` to the chef, then poll `POST /api/tools/poll_agent_connection` with the returned `deviceCode`. The approval page also uses Spoonjoy's full login surface before issuing a one-time `sj_...` token.

```text
POST /api/tools/start_agent_connection -> authorizationUrl + deviceCode
POST /api/tools/poll_agent_connection -> token: sj_...
```

### No password-token API

Spoonjoy does not support an OAuth password grant or API endpoint where a third-party client trades a chef's password for a token. Email/password login creates a session cookie, not an API token. Clients should use OAuth/PKCE or delegated approval so Spoonjoy, not the client, handles password, passkey, and provider login.

```text
Do not implement: grant_type=password
Use instead: OAuth/PKCE or delegated approval link
```

## Auth Implementation

Choose one credential mode per request. Same-origin browser code should use the signed-in Spoonjoy session; external clients should use `Authorization: Bearer ...`; delegated browser or mobile apps should use OAuth/PKCE. If an Authorization header is present, bearer auth wins over the session.

### Same-origin browser session

After a chef signs in, your logged-in Spoonjoy session is the credential. Call relative `/api/v1` URLs with `credentials: "same-origin"`. Do not send Authorization from same-origin browser code.

```ts
const response = await fetch("/api/v1/shopping-list", {
  credentials: "same-origin",
  headers: { "X-Request-Id": "web-shopping-list" },
});
```

This is the default mode for the generated playground. There is no token to mint or paste for playground calls; private endpoints use the chef represented by the existing session cookie.

### External REST client

Use bearer credentials only when a client cannot share the logged-in Spoonjoy session, such as a CLI, server job, tiny device, or Bearer-mode test. In the playground, leave auth on Session and run the generated `POST /api/v1/tokens` operation, then store the `sj_...` secret outside browser bundles.

```bash
curl 'https://spoonjoy.app/api/v1/shopping-list' \
  -H 'Authorization: Bearer sj_client_token' \
  -H 'X-Request-Id: client-shopping-list'
```

When a signed-in session creates a token and omits `scopes`, Spoonjoy uses the default personal REST scopes. When a bearer credential creates another token and omits `scopes`, the new token inherits the caller's scopes except `offline_access`. Bearer callers cannot create a token with broader scopes than they already have.

### OAuth/PKCE app

Use OAuth/PKCE when a third-party app needs the chef to consent without embedding a long-lived secret. Register a public client with `token_endpoint_auth_method: none`; there is no client secret. Redirect URIs must be HTTPS, with HTTP allowed only for `localhost` and `127.0.0.1`.

OAuth accepts only `kitchen:read` and `kitchen:write` scopes. Omitting `scope` grants both. Redirect the chef through consent, then exchange the single-use 60-second code with a form-encoded `POST /oauth/token` request. If the chef is not signed in, Spoonjoy routes them through `/login` first, where password, passkey, and configured Google, GitHub, or Apple sign-in all return to consent. Those provider buttons are Spoonjoy sign-in methods; external clients still use the `/oauth/*` endpoints.

```text
POST /oauth/register
GET /oauth/authorize?response_type=code&scope=kitchen%3Aread+kitchen%3Awrite&code_challenge_method=S256
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=...&code=...&code_verifier=...
```

The returned `access_token` is a normal `sj_...` Bearer credential that expires after 30 days. The returned refresh_token rotates on every refresh grant as an `ort_...` token, and a replayed refresh token is rejected.

### Auth failures

Public recipe and cookbook endpoints can be called anonymously. If you send credentials to an optional public endpoint, Spoonjoy validates them and checks the matching read scope. Private endpoints require the authenticated chef plus the listed scopes.

Treat `authentication_required` and `invalid_token` as `401` responses. Treat `insufficient_scope` as `403`. A malformed `Authorization` header returns `validation_error`. Send your own `X-Request-Id` when you have one, and log the response `requestId` so failures can be traced.

## Scopes

Fine-grained REST scopes are attached to bearer tokens and OAuth-issued API credentials. A signed-in Spoonjoy session already represents the current chef for same-origin playground requests.

| Scope | Purpose |
| --- | --- |
| `recipes:read` | Read public recipes and recipe detail. |
| `cookbooks:read` | Read public cookbook lists and cookbook detail. |
| `shopping_list:read` | Read the authenticated owner's active shopping list and sync feed. |
| `shopping_list:write` | Add, check, or remove items from the authenticated owner's shopping list. |
| `tokens:read` | List token metadata for the authenticated owner. |
| `tokens:write` | Create or revoke scoped bearer credentials for the authenticated owner. |

OAuth/MCP consent uses broader `kitchen:read` and `kitchen:write` scopes. The API maps those delegated credentials onto the owner-scoped kitchen operations while preventing cross-owner access.

## Rate Limiting

API v1 is rate limited by IP and credential before authentication work. Anonymous requests are keyed by IP; bearer requests are keyed by the credential hash. Rate-limited responses return HTTP `429`, a `Retry-After` header, and an error envelope with code `rate_limited`.

## Endpoints

| Method | Path | Auth | Required scopes |
| --- | --- | --- | --- |
| `GET` | `/api/v1` | Optional | none |
| `GET` | `/api/v1/health` | Optional | none |
| `GET` | `/api/v1/openapi.json` | Optional | none |
| `GET` | `/api/v1/recipes` | Optional | `recipes:read` when authenticated |
| `GET` | `/api/v1/recipes/{id}` | Optional | `recipes:read` when authenticated |
| `GET` | `/api/v1/cookbooks` | Optional | `cookbooks:read` when authenticated |
| `GET` | `/api/v1/cookbooks/{id}` | Optional | `cookbooks:read` when authenticated |
| `GET` | `/api/v1/shopping-list` | Authenticated chef | `shopping_list:read` |
| `GET` | `/api/v1/shopping-list/sync` | Authenticated chef | `shopping_list:read` |
| `POST` | `/api/v1/shopping-list/items` | Authenticated chef | `shopping_list:write` |
| `PATCH` | `/api/v1/shopping-list/items/{itemId}` | Authenticated chef | `shopping_list:write` |
| `DELETE` | `/api/v1/shopping-list/items/{itemId}` | Authenticated chef | `shopping_list:write` |
| `GET` | `/api/v1/tokens` | Authenticated chef | `tokens:read` |
| `POST` | `/api/v1/tokens` | Authenticated chef | `tokens:write` |
| `DELETE` | `/api/v1/tokens/{credentialId}` | Authenticated chef | `tokens:write` |

## Sync And Mutations

`GET /api/v1/shopping-list/sync?cursor=...` returns owner-scoped shopping-list changes after the supplied ISO timestamp cursor. Sync responses include active rows and tombstone records so offline or tiny-device clients can remove locally cached items after server-side deletion.

Shopping-list writes accept a `clientMutationId`. Reusing the same mutation id with the same request body returns the recorded response as an idempotency replay; reusing it with a different body returns `409 idempotency_conflict`.

```bash
curl -X POST https://spoonjoy.app/api/v1/shopping-list/items \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"device-uuid-1","name":"Eggs","quantity":12,"unit":"Each"}'
```

## External Client Guide

These starting points fit different client shapes without changing the underlying API:

- Tiny-device clients: use cursor sync, compact responses, and idempotent writes so a device can recover from interrupted network calls.
- Mobile apps: read the public Chef graph before sign-in, then request shopping-list scopes after the chef connects their account.
- CLI/script clients: use bearer credentials, curl, and the OpenAPI contract only when the script cannot share a Spoonjoy session.
- Browser clients: use OAuth/PKCE and Dynamic Client Registration instead of embedding long-lived secrets.
- Agent clients: use MCP or delegated connection endpoints when a chef needs to approve an external runtime.

### Read the public Chef graph

Public recipe and cookbook reads work without credentials. Add bearer auth later only when a client needs private state.

```bash
curl 'https://spoonjoy.app/api/v1/recipes?query=pasta&limit=20'
curl 'https://spoonjoy.app/api/v1/cookbooks?limit=20'
```

### Use your Spoonjoy session

Sign into Spoonjoy, open the playground, and leave auth on Session. There is no token to mint or paste for playground calls; the browser sends your normal Spoonjoy session cookie, and private endpoints treat that as the authenticated chef.

```text
https://spoonjoy.app/developers/playground
```

### Use bearer only outside the session

Bearer mode is for clients that cannot use the logged-in Spoonjoy browser session. The generated `POST /api/v1/tokens` operation is available in the playground because it is part of API v1, not because private playground calls need a separate token.

```json
{
  "name": "External client",
  "scopes": ["recipes:read", "cookbooks:read", "shopping_list:read", "shopping_list:write"]
}
```

### Sync a private shopping list

Shopping-list sync requires `shopping_list:read`. Pass a `cursor` after the first sync to fetch active rows and tombstones for removed rows.

```bash
curl 'https://spoonjoy.app/api/v1/shopping-list/sync?cursor=2026-06-01T00:00:00.000Z' \
  -H 'Authorization: Bearer sj_client_token'
```

### Perform an idempotent shopping-list mutation

Shopping-list mutations require `shopping_list:write`. Include a stable `clientMutationId`; retry the same body with the same id after network failure, and Spoonjoy will replay the recorded result instead of duplicating the write.

```bash
curl -X POST https://spoonjoy.app/api/v1/shopping-list/items \
  -H 'Authorization: Bearer sj_client_token' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"device-uuid-1","name":"Eggs","quantity":12,"unit":"Each"}'
```

### Start delegated agent auth

```bash
curl -X POST https://spoonjoy.app/api/tools/start_agent_connection \
  -H 'Content-Type: application/json' \
  -d '{"agentName":"client","baseUrl":"https://spoonjoy.app"}'
```

The legacy `/api/*` routes still exist for the app and existing integrations, but new external clients should target `/api/v1`, `/developers`, and the OpenAPI document.
