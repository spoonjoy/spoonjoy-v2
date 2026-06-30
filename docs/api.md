# Spoonjoy API

Spoonjoy's public developer surface starts at `/api`, with compatibility aliases at `/developers`, `/api/docs`, and `/api/developers`. The generated playground lives at `/api/playground`, and the machine-readable contract lives at `/api/v1/openapi.json`. API v1 is designed for small devices, mobile apps, scripts, browser clients, and agent clients that need to build on the public-by-default Chef graph while keeping private shopping-list data owner-scoped.

## Base URLs

- Production docs: `https://spoonjoy.app/api`
- Playground: `https://spoonjoy.app/api/playground`
- API discovery: `https://spoonjoy.app/api/v1`
- OpenAPI 3.1: `https://spoonjoy.app/api/v1/openapi.json`
- SDK OpenAPI 3.1: `https://spoonjoy.app/api/v1/openapi.sdk.json`
- No-code connector OpenAPI 3.0: `https://spoonjoy.app/api/v1/openapi.connector.json`
- Remote MCP: `https://spoonjoy.app/mcp`
- OAuth authorization-server metadata: `https://spoonjoy.app/.well-known/oauth-authorization-server`
- OAuth protected-resource metadata: `https://spoonjoy.app/.well-known/oauth-protected-resource`

## Current API Boundary

Available now:

- Public recipe and cookbook reads
- Cross-product API search across public recipes, public cookbooks, chefs, and authorized shopping-list items
- Authenticated recipe import from URL, video URL, text, or JSON-LD
- Public recipe spoon history plus authenticated recipe spoon create, update, and delete
- Owner-scoped recipe cover candidate management for the authenticated chef's recipes
- Owner-scoped shopping-list read, sync, add, recipe-add, check, clear, and remove
- Native account profile, profile-photo, notification-preference, token, and OAuth app connection settings
- Session-created and bearer-created API tokens
- OAuth/PKCE delegated access
- Delegated agent/device approval links
- Remote MCP endpoint

Not in API v1 yet:

- General recipe create, edit, delete, or export endpoints beyond recipe import and owner cover management
- Private recipe-library endpoints
- Inventory or pantry stock APIs
- Meal plan or "today's recipes" APIs
- Full account export APIs
- Canonical unit registry or density-based ingredient conversion
- webhooks, REST Hooks, SSE, and event subscriptions
- Arbitrary bulk shopping-list import or batch mutation endpoints
- Corporate tenant, admin, employee, or org-export APIs

If something is not in API v1 yet, treat it as future API surface rather than a hidden endpoint. New external clients should use `/api/v1`, `/api`, `/api/playground`, and the OpenAPI document; legacy app-only `/api/*` routes are not the external contract and reject OAuth access tokens that are audience-bound to `/mcp`.

No-code connector builders that need an OpenAPI 3.0 REST-only import should use `/api/v1/openapi.connector.json`; it omits OAuth redirect screens, delegated approval helpers, and MCP JSON-RPC operations that connector importers often misclassify as normal actions.

Generated SDKs should use `/api/v1/openapi.sdk.json`; it keeps REST v1 resources, OAuth register/authorize/token/revoke operations, delegated approval helpers, and bearer/OAuth security metadata while omitting MCP JSON-RPC, same-origin cookie auth, and raw spec endpoints.

| Surface | Build with it | Current boundary |
| --- | --- | --- |
| REST API v1 | Public catalog clients, global search, shopping-list sync, native recipe import, native recipe spoon and recipe-cover management, bearer-token scripts, generated SDKs | No general recipe create/edit/delete/export or private library endpoints yet. |
| No-code connector profile | Zapier/Make/n8n-style searches, actions, and polling triggers | No webhooks, REST Hooks, SSE, event subscriptions, or DELETE request bodies. |
| OAuth/PKCE | Third-party mobile, SaaS, extension, and connector account linking | Public clients only; no client secret, password grant, token-management scopes, or custom schemes. |
| Delegated approval | CLIs, appliances, voice clients, and agents without a callback URL | Custom Spoonjoy approval flow, not OAuth Device Authorization Grant. |
| Remote MCP | Assistant runtimes using Spoonjoy tools | Uses raw kitchen scopes for the MCP tool surface and may expose private kitchen data; it is not the REST v1 SDK surface. |

## Terminal Quickstart

This quickstart uses curl + jq.

Anonymous public reads work immediately:

```bash
export SJ_BASE='https://spoonjoy.app'
umask 077
state_dir="$(mktemp -d "${TMPDIR:-/tmp}/spoonjoy.XXXXXX")"
trap 'rm -rf "$state_dir"' EXIT

curl -fsS "$SJ_BASE/api/v1/health" | jq
curl -fsS "$SJ_BASE/api/v1/recipes?query=pasta&limit=5" \
  | jq -r '.data.recipes[] | [.id, .title] | @tsv'
curl -fsS "$SJ_BASE/api/v1/search?q=pasta&scope=all&limit=5" \
  | jq -r '.data.results[] | [.type, .id, .title] | @tsv'
```

For your first CLI, keep that split: public recipe/cookbook calls omit `Authorization`; private shopping-list calls use a shopping-list token. If you send a narrow shopping-list token to public recipe/cookbook endpoints, Spoonjoy validates it and can return `403 insufficient_scope` instead of falling back to anonymous.

For the first external shopping-list token without browser cookies, use delegated approval. A client shows the approval URL, the chef signs into Spoonjoy, and polling returns a one-time-display `sj_...` bearer token.

```bash
curl -fsS "$SJ_BASE/api/tools/start_agent_connection" \
  -H 'Content-Type: application/json' \
  --data '{"agentName":"Kitchen CLI","scopes":"shopping_list:read shopping_list:write"}' \
  > "$state_dir/start.json"

jq -r '.data.authorizationUrl' "$state_dir/start.json"
jq -r '.data.verificationUri' "$state_dir/start.json"
jq -r '.data.userCode' "$state_dir/start.json"
jq -r '.data.deviceCode' "$state_dir/start.json"

while :; do
  curl -fsS "$SJ_BASE/api/tools/poll_agent_connection" \
    -H 'Content-Type: application/json' \
    --data "{\"deviceCode\":\"$(jq -r '.data.deviceCode' "$state_dir/start.json")\"}" \
    > "$state_dir/poll.json"
  status="$(jq -r '.data.status' "$state_dir/poll.json")"
  test "$status" = approved && break
  if test "$status" != pending; then
    jq . "$state_dir/poll.json" >&2
    echo "Connection status is $status; start a new delegated approval request if you still need access." >&2
    exit 1
  fi
  sleep "$(jq -r '.data.interval // 2' "$state_dir/start.json")"
done

export SPOONJOY_TOKEN="$(jq -r '.data.token' "$state_dir/poll.json")"
```

The delegated approval files contain `deviceCode` and, once approved, a bearer token. Keep them in a private temp directory, delete them after export, and never commit them. Personal and delegated bearer tokens do not expire unless their returned `expiresAt` is non-null; rerun approval or create a new token when a stored token starts returning `401 invalid_token`.

## API v1 REST Response Shape

API v1 REST resources under `/api/v1/*` return this envelope except for raw OpenAPI documents:

```json
{
  "ok": true,
  "requestId": "req_example",
  "data": {}
}
```

API v1 REST errors include a stable code, message, HTTP status, and request id:

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

Other bootstrapping protocols intentionally use their own wire formats:

- OAuth endpoints use standard OAuth JSON errors and token responses, except rate limits: `429` returns Spoonjoy's generic `{ "error": "rate_limited", "message": "...", "retryAfterSeconds": N }` shape with `Retry-After`.
- Delegated approval helper endpoints under `/api/tools/*` return the legacy `{ "ok": true, "data": ... }` helper envelope and may omit `requestId`.
- `/mcp` is JSON-RPC over HTTP and returns JSON-RPC result/error objects.

## Authentication

Spoonjoy accepts the normal signed-in Spoonjoy session for same-origin browser requests. In the playground, leave auth on Session and private endpoints will treat the logged-in chef as the authenticated owner. There is no token to mint or paste for playground calls.

External clients that run outside the Spoonjoy browser session use bearer credentials through `Authorization: Bearer sj_...`. Public recipe and cookbook reads work without a token, but authenticated external requests can use scoped tokens to read private resources, mutate the owner shopping list, manage owner recipe covers, or manage token metadata.

Supported entry points:

- Native account settings: `GET /api/v1/me`, `PATCH /api/v1/me`, `POST /api/v1/me/photo`, `DELETE /api/v1/me/photo`, `GET /api/v1/me/notification-preferences`, `PATCH /api/v1/me/notification-preferences`, `GET /api/v1/me/connections`, and `DELETE /api/v1/me/connections/{connectionId}`
- Bearer credentials: `GET /api/v1/tokens`, `POST /api/v1/tokens`, and `DELETE /api/v1/tokens/{credentialId}`
- OAuth/DCR clients: `POST /oauth/register`, `GET /oauth/authorize`, `POST /oauth/token`, and `POST /oauth/revoke`
- Delegated agent connection: `POST /api/tools/start_agent_connection` and `POST /api/tools/poll_agent_connection`
- MCP clients: `POST /mcp`

OAuth access tokens are short-lived Spoonjoy API credentials. OAuth token responses also include a rotating `refresh_token`; each refresh-token grant rotates the presented token and rejects replay. Native apps, browser extensions, and other OAuth clients disconnect by revoking their stored refresh token with `POST /oauth/revoke`.

Signed-in chefs can also open Account settings to see active personal/delegated bearer credentials and OAuth app connections, then revoke or disconnect them without seeing token secrets again.

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
  "scopes": ["recipes:read", "cookbooks:read", "shopping_list:read", "shopping_list:write"]
}

Response:
{
  "ok": true,
  "requestId": "req_...",
  "data": {
    "token": "sj_...",
    "credential": {
      "id": "cred_...",
      "name": "Kitchen script",
      "tokenPrefix": "sj_abc123456",
      "scopes": ["recipes:read", "cookbooks:read", "shopping_list:read", "shopping_list:write"]
    }
  }
}
```

### Delegated token: OAuth/PKCE

For a third-party app, use OAuth/PKCE. The client registers with `POST /oauth/register`, redirects the chef to `GET /oauth/authorize`, then exchanges the authorization code with `POST /oauth/token`.

If the chef is not signed in, Spoonjoy redirects to `/login?redirectTo=...`. That full login surface supports password, passkeys, and any configured Google, GitHub, or Apple provider; each path returns to the original OAuth consent request. Those provider buttons are Spoonjoy sign-in methods, not external token grants. The client never handles the chef's password.

```text
POST /oauth/register
Response: { "client_id": "cm_client_id_from_register" }
GET /oauth/authorize?client_id=cm_client_id_from_register&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback&response_type=code&scope=shopping_list%3Aread+shopping_list%3Awrite&state=...&code_challenge=...&code_challenge_method=S256
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=...&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback&code=...&code_verifier=...
```

The token response contains `access_token: "sj_..."`, `token_type: "Bearer"`, `expires_in: 900`, `scope`, and a rotating `refresh_token`.

Registration can validate optional `scope` metadata, but it does not grant or remember that scope. Always send the requested scope on `/oauth/authorize`. Blank OAuth authorize scope defaults to kitchen:read.

### Delegated token: approval link

For agents, CLIs, appliances, or devices that cannot run a browser-based OAuth callback, use the delegated approval link. Call `POST /api/tools/start_agent_connection`, show the returned `authorizationUrl` and `userCode` to the chef, then poll `POST /api/tools/poll_agent_connection` with the returned `deviceCode` no faster than the returned `interval`.

Pass `scopes` to `start_agent_connection` for least privilege, for example `shopping_list:read shopping_list:write` for a tiny grocery sync client. Omitted delegated approval scopes default to shopping_list:read shopping_list:write, but production clients should still send explicit scopes so consent is predictable.

The device code expires after 10 minutes. Pending polls return `status: "pending"`. Approved polls return the `sj_...` token once plus credential metadata, including the credential `id`. Denied, expired, and already-claimed requests return those statuses. The token is a normal bearer credential. A least-privilege device can disconnect itself with `DELETE /api/v1/tokens/{credentialId}` when `{credentialId}` is its own returned credential id; revoking any other credential still requires `tokens:write`.

For a screenless device, speak or display the short `userCode` first and tell the chef to open the stable `verificationUri`, currently `https://spoonjoy.app/agent/connect`. Devices that can show or send a direct link can use `verificationUriComplete` or `authorizationUrl`; both include the request id and code. The current delegated approval link is custom Spoonjoy API, not the OAuth Device Authorization Grant; its machine-readable contract is in OpenAPI as `/api/tools/start_agent_connection` and `/api/tools/poll_agent_connection`.

```text
POST /api/tools/start_agent_connection -> verificationUri + verificationUriComplete + authorizationUrl + userCode + deviceCode + expiresIn: 600
POST /api/tools/poll_agent_connection -> status: pending | approved | denied | expired | claimed
Approved response -> token: sj_... + credential metadata, including scopes and expiresAt
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

Use OAuth/PKCE when a third-party app needs the chef to consent without embedding a long-lived secret. Register a public client with `token_endpoint_auth_method: none`; there is no client secret. Redirect URIs must be HTTPS, with HTTP allowed only for `localhost` and `127.0.0.1`. Redirect URIs with fragments, embedded credentials, wildcards, custom schemes, or plain remote HTTP are rejected. Spoonjoy accepts common RFC 7591/OIDC client metadata such as `client_uri`, `contacts`, `policy_uri`, `software_id`, and `software_version`, but only stores `client_name` and exact `redirect_uris` today.

OAuth accepts delegated `kitchen:read` and `kitchen:write` scopes plus least-privilege REST read/write scopes such as `account:read`, `account:write`, `shopping_list:read`, `shopping_list:write`, `recipes:read`, `cookbooks:read`, and `public:read`. Grocery-style apps should request `shopping_list:read shopping_list:write`, not broad kitchen scopes. Native Spoonjoy clients that manage recipe covers need `kitchen:write`; clients that manage profile, profile photo, or notification settings need explicit `account:*` scopes. Do not request `offline_access`; OAuth returns refresh tokens with the authorization-code flow. Blank OAuth authorize scope defaults to kitchen:read.

Generate a 43-128 character high-entropy `code_verifier` from unreserved PKCE characters, then send `code_challenge = BASE64URL(SHA256(code_verifier))` without padding and `code_challenge_method=S256`. The `plain` method is rejected. Always send and verify `state`.

Redirect the chef through consent, then exchange the single-use 60-second code with a form-encoded `POST /oauth/token` request. If the chef is not signed in, Spoonjoy routes them through `/login` first, where password, passkey, and configured Google, GitHub, or Apple sign-in all return to consent. Those provider buttons are Spoonjoy sign-in methods; external clients still use the `/oauth/*` endpoints.

```text
POST /oauth/register
Response: { "client_id": "cm_client_id_from_register" }
GET /oauth/authorize?client_id=cm_client_id_from_register&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback&response_type=code&scope=shopping_list%3Aread+shopping_list%3Awrite&state=...&code_challenge=...&code_challenge_method=S256
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=...&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback&code=...&code_verifier=...
```

The returned `access_token` is a normal `sj_...` Bearer credential that expires after 15 minutes (`expires_in: 900`). The returned refresh_token rotates on every refresh grant as an `ort_...` token, and a replayed refresh token is rejected. Refresh tokens are stored server-side only as hashes. Disconnect by revoking the stored refresh token with `POST /oauth/revoke`; Spoonjoy revokes live OAuth access credentials for that client/resource at the same time. OAuth never grants `tokens:read` or `tokens:write`; token management is for signed-in sessions or personal bearer credentials with explicit token scopes. OAuth kitchen scopes do not grant tokens:read or tokens:write.

`client_id` is recommended on `/oauth/revoke` and Spoonjoy checks it when present. Possession of the refresh token is sufficient to revoke it, so a client can still disconnect if its local `client_id` storage was lost.

Refresh with:

```text
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&client_id=...&refresh_token=ort_...

POST /oauth/revoke
Content-Type: application/x-www-form-urlencoded

token=ort_...&client_id=cm_client_id_from_register&token_type_hint=refresh_token
```

Browser clients may call `/oauth/register`, `/oauth/token`, and `/oauth/revoke` cross-origin; these endpoints answer `OPTIONS` with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`, and no `Access-Control-Allow-Credentials`. Cookie-authenticated API mutations are same-origin only and are protected by the Spoonjoy session boundary: use relative URLs, `credentials: "same-origin"`, JSON requests, and no copied cookies. CORS does not make a copied session cookie safe for an external client. OAuth consent form submissions are same-origin POSTs.

If an OAuth client sends the optional `resource` parameter, Spoonjoy currently accepts only the advertised MCP protected resource and binds the issued access credential to that audience. Use resource=https://spoonjoy.app/mcp only for MCP OAuth. Omit resource for REST OAuth apps; resource-bound MCP tokens are rejected by REST API v1. `POST /oauth/revoke` revokes the presented refresh token and live OAuth access credentials for that client/resource.

### Auth failures

Public recipe and cookbook endpoints can be called anonymously. If you send credentials to an optional public endpoint, Spoonjoy validates them and checks the matching read scope. Private endpoints require the authenticated chef plus the listed scopes.

Omit `Authorization` on public calls unless you require authenticated behavior. A stale bearer token on an optional public endpoint returns `401 invalid_token`; Spoonjoy does not silently ignore a bad credential and fall back to anonymous.

Treat `authentication_required` and `invalid_token` as `401` responses. Treat `insufficient_scope` as `403`. A malformed `Authorization` header returns `validation_error`. Send your own `X-Request-Id` when you have one, and log the response `requestId` so failures can be traced.

## OAuth And Delegated Flows

The OpenAPI document includes the REST v1 endpoints plus the auth entry points external clients need to bootstrap access: `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, `/api/tools/start_agent_connection`, `/api/tools/poll_agent_connection`, and `/mcp`.

### OAuth/PKCE delegated app

Use this for mobile apps, SaaS integrations, and browser extensions that can receive a redirect callback.

```text
POST /oauth/register
{ "client_name": "Example client", "redirect_uris": ["https://example.com/oauth/callback"], "token_endpoint_auth_method": "none" }

Response: { "client_id": "cm_client_id_from_register", "grant_types": ["authorization_code", "refresh_token"] }

GET /oauth/authorize?client_id=cm_client_id_from_register&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback&response_type=code&scope=shopping_list%3Aread+shopping_list%3Awrite&state=...&code_challenge=...&code_challenge_method=S256

POST /oauth/token
grant_type=authorization_code&client_id=...&redirect_uri=...&code=...&code_verifier=...
```

Redirect URIs must be HTTPS, with HTTP allowed only for `localhost` and `127.0.0.1`. Native apps should use HTTPS universal/app links or a localhost loopback during development; custom schemes are rejected.

iOS apps should use `ASWebAuthenticationSession` or AppAuth with an HTTPS universal-link redirect such as `https://example.com/spoonjoy/oauth/callback`, then configure Associated Domains for that host so the callback returns to the app. Store `access_token` and `refresh_token` in Keychain, keep the PKCE verifier only until the code exchange succeeds, and never embed a client secret.

Android apps should use Chrome Custom Tabs or AppAuth with an HTTPS App Link redirect such as `https://example.com/spoonjoy/oauth/callback`, then configure Digital Asset Links for that host. Store tokens in EncryptedSharedPreferences or another Android Keystore-backed store, keep the PKCE verifier only until the code exchange succeeds, and use localhost loopback only for development tooling.

### Delegated approval link

Use this for agents, CLIs, appliances, and devices that can show a chef an approval URL but cannot run an OAuth callback.

```bash
curl -fsS 'https://spoonjoy.app/api/tools/start_agent_connection' \
  -H 'Content-Type: application/json' \
  --data '{"agentName":"Kitchen display","scopes":"shopping_list:read shopping_list:write"}'

curl -fsS 'https://spoonjoy.app/api/tools/poll_agent_connection' \
  -H 'Content-Type: application/json' \
  --data '{"deviceCode":"sjdc_..."}'
```

Poll no faster than the returned `interval`. Never ask for a chef's Spoonjoy password; the chef signs into Spoonjoy directly on the approval page.

For screenless or voice clients, read the `userCode` as grouped characters and prefer a short phrase such as "Open Spoonjoy and enter code A B C D, two three four five." Public recipe text is user-generated; filter or sanitize instructions before text-to-speech when your product requires family-safe speech. Cooking-session state, timers, "next step", "repeat step", and "add all missing ingredients" are client-local in API v1 unless represented as shopping-list mutations.

### Remote MCP client

Use the remote MCP endpoint when an assistant runtime wants Spoonjoy tools:

```text
POST /mcp
Authorization: Bearer sj_...

{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```

Unauthenticated `/mcp` calls challenge with OAuth protected-resource metadata. MCP delegated scopes use raw `kitchen:read` and `kitchen:write` for the full MCP kitchen tool surface: `kitchen:read` covers read tools, and `kitchen:write` unlocks write tools such as recipe/cookbook/spoon mutations plus shopping-list writes. Least-privilege shopping-list-only delegated tokens can use `shopping_list:read shopping_list:write`, but those tokens will not unlock recipe/cookbook/spoon MCP writes. Token-management MCP tools require personal `tokens:read` or `tokens:write` scopes; OAuth kitchen scopes do not grant token management.

## OAuth Scope Mapping

OAuth/MCP consent can use broad `kitchen:read` and `kitchen:write` scopes or least-privilege REST scopes. Account identity settings are intentionally separate: `kitchen:*` does not unlock `account:*`. The API maps delegated credentials onto owner-scoped operations while preventing cross-owner access. OAuth credentials do not receive token-management scopes.

| OAuth scope | REST scopes unlocked |
| --- | --- |
| `account:read` | `account:read` |
| `account:write` | `account:write` |
| `kitchen:read` | `cookbooks:read`, `public:read`, `recipes:read`, `shopping_list:read` |
| `kitchen:write` | `kitchen:write`, `shopping_list:write` |
| `shopping_list:read` | `shopping_list:read` |
| `shopping_list:write` | `shopping_list:write` |
| `recipes:read` | `recipes:read` |
| `cookbooks:read` | `cookbooks:read` |
| `public:read` | public recipe and cookbook reads |

## Scopes

Fine-grained REST scopes are attached to bearer tokens and OAuth-issued API credentials. A signed-in Spoonjoy session already represents the current chef for same-origin playground requests.

| Scope | Purpose |
| --- | --- |
| `account:read` | Read the authenticated owner's account profile and notification preference settings. |
| `account:write` | Update the authenticated owner's profile, profile photo, and notification preference settings. |
| `kitchen:read` | Read the authenticated owner's broad kitchen state, including public recipes, public cookbooks, and shopping-list reads. |
| `kitchen:write` | Import recipes, manage owner recipe spoons and covers, and write the authenticated owner's shopping list when granted through OAuth kitchen consent. |
| `public:read` | Read public recipe and cookbook data with a bearer or OAuth credential. Anonymous reads do not need it. |
| `recipes:read` | Read public recipes and recipe detail. |
| `cookbooks:read` | Read public cookbook lists and cookbook detail. |
| `shopping_list:read` | Read the authenticated owner's active shopping list and sync feed. |
| `shopping_list:write` | Add, check, or remove items from the authenticated owner's shopping list. |
| `tokens:read` | List token metadata and OAuth app connection metadata for the authenticated owner. |
| `tokens:write` | Create or revoke scoped bearer credentials and disconnect OAuth app connections for the authenticated owner. |
| `offline_access` | Internal refresh-capable credential marker. Do not request it in OAuth authorize; OAuth returns refresh tokens from the code grant. |

## Rate Limiting

API v1 is rate limited by IP and credential before authentication work. Anonymous requests are keyed by IP; bearer requests pass through an IP guard and, when a bearer token is present, a credential-hash bucket. This prevents clients from rotating fake bearer strings to bypass IP limiting before auth rejects the token. Current production bindings are configured for 60 anonymous/IP requests per 60 seconds and 120 bearer-token requests per 60 seconds, but Cloudflare rate-limit bindings are enforced locally at the edge and should be treated as abuse protection, not a globally precise quota meter. Rate-limited responses return HTTP `429`, a `Retry-After` header, and an error envelope with code `rate_limited`; API v1 does not currently emit `RateLimit-*` remaining/reset counters.

## Endpoints

| Method | Path | Auth | Required scopes |
| --- | --- | --- | --- |
| `GET` | `/api/v1` | Optional | none |
| `GET` | `/api/v1/health` | Optional | none |
| `GET` | `/api/v1/openapi.json` | Optional | none |
| `GET` | `/api/v1/openapi.sdk.json` | Optional | none |
| `GET` | `/api/v1/openapi.connector.json` | Optional | none |
| `GET` | `/api/v1/search` | Optional | `shopping_list:read` only for private shopping-list results |
| `GET` | `/api/v1/recipes` | Optional | `recipes:read` when authenticated |
| `POST` | `/api/v1/recipes/import` | Authenticated chef | `kitchen:write` |
| `GET` | `/api/v1/recipes/{id}` | Optional | `recipes:read` when authenticated |
| `GET` | `/api/v1/recipes/{id}/spoons` | Optional | `recipes:read` when authenticated |
| `POST` | `/api/v1/recipes/{id}/spoons` | Authenticated chef | `kitchen:write` |
| `PATCH` | `/api/v1/recipes/{id}/spoons/{spoonId}` | Authenticated chef | `kitchen:write` |
| `DELETE` | `/api/v1/recipes/{id}/spoons/{spoonId}` | Authenticated chef | `kitchen:write` |
| `GET` | `/api/v1/recipes/{id}/covers` | Authenticated chef | `kitchen:write` |
| `PATCH` | `/api/v1/recipes/{id}/covers` | Authenticated chef | `kitchen:write` |
| `PATCH` | `/api/v1/recipes/{id}/covers/{coverId}` | Authenticated chef | `kitchen:write` |
| `DELETE` | `/api/v1/recipes/{id}/covers/{coverId}` | Authenticated chef | `kitchen:write` |
| `POST` | `/api/v1/recipes/{id}/covers/regenerate` | Authenticated chef | `kitchen:write` |
| `POST` | `/api/v1/recipes/{id}/covers/from-spoon/{spoonId}` | Authenticated chef | `kitchen:write` |
| `GET` | `/api/v1/cookbooks` | Optional | `cookbooks:read` when authenticated |
| `POST` | `/api/v1/cookbooks` | Authenticated chef | `kitchen:write` |
| `GET` | `/api/v1/cookbooks/{id}` | Optional | `cookbooks:read` when authenticated |
| `PATCH` | `/api/v1/cookbooks/{id}` | Authenticated chef | `kitchen:write` |
| `DELETE` | `/api/v1/cookbooks/{id}` | Authenticated chef | `kitchen:write` |
| `POST` | `/api/v1/cookbooks/{id}/recipes/{recipeId}` | Authenticated chef | `kitchen:write` |
| `DELETE` | `/api/v1/cookbooks/{id}/recipes/{recipeId}` | Authenticated chef | `kitchen:write` |
| `GET` | `/api/v1/me` | Authenticated chef | `account:read` |
| `PATCH` | `/api/v1/me` | Authenticated chef | `account:write` |
| `POST` | `/api/v1/me/photo` | Authenticated chef | `account:write` |
| `DELETE` | `/api/v1/me/photo` | Authenticated chef | `account:write` |
| `GET` | `/api/v1/me/notification-preferences` | Authenticated chef | `account:read` |
| `PATCH` | `/api/v1/me/notification-preferences` | Authenticated chef | `account:write` |
| `GET` | `/api/v1/me/connections` | Authenticated chef | `tokens:read` |
| `DELETE` | `/api/v1/me/connections/{connectionId}` | Authenticated chef | `tokens:write` |
| `GET` | `/api/v1/shopping-list` | Authenticated chef | `shopping_list:read` |
| `GET` | `/api/v1/shopping-list/sync` | Authenticated chef | `shopping_list:read` |
| `POST` | `/api/v1/shopping-list/items` | Authenticated chef | `shopping_list:write` |
| `PATCH` | `/api/v1/shopping-list/items/{itemId}` | Authenticated chef | `shopping_list:write` |
| `DELETE` | `/api/v1/shopping-list/items/{itemId}` | Authenticated chef | `shopping_list:write` |
| `POST` | `/api/v1/shopping-list/add-from-recipe` | Authenticated chef | `shopping_list:write` |
| `POST` | `/api/v1/shopping-list/clear-completed` | Authenticated chef | `shopping_list:write` |
| `POST` | `/api/v1/shopping-list/clear-all` | Authenticated chef | `shopping_list:write` |
| `GET` | `/api/v1/tokens` | Authenticated chef | `tokens:read` |
| `POST` | `/api/v1/tokens` | Authenticated chef | `tokens:write` |
| `DELETE` | `/api/v1/tokens/{credentialId}` | Authenticated chef | `tokens:write` |

## Sync And Mutations

`GET /api/v1/shopping-list/sync?cursor=...&limit=20` returns owner-scoped shopping-list changes after the supplied cursor. New clients should treat cursors as opaque strings and pass back the returned `nextCursor` unchanged; old ISO timestamp cursors are still accepted as a bootstrap convenience. Sync responses include active rows and tombstone records so offline or tiny-device clients can remove locally cached items after server-side deletion.

Store the returned `nextCursor` for a page only after applying every item in that response durably. Use `limit` from 1 to 50 for small payloads; `hasMore: true` means continue immediately with that checkpoint to drain the backlog. It is okay for crash-prone clients to checkpoint after each fully applied page, as long as local apply is idempotent and no cursor is persisted before all rows in that page are durable. Poll conservatively because webhooks, REST Hooks, SSE, and event subscriptions are not in v1 yet.

Idempotent owner mutations use `clientMutationId`. This applies to recipe import, cookbook writes, shopping-list writes, recipe spoon writes, and recipe-cover writes. The idempotency key is scoped to the chef, retained for 24 hours, and bound to method, path, and a canonicalized parsed JSON body. Persist the same request values for each mutation id before sending it; whitespace and object key order are ignored, while changed method, path, or body values return a conflict. A write retried after an OAuth access-token refresh still replays instead of duplicating because both credentials resolve to the same chef. Reusing the same mutation id with the same completed request body returns the recorded response with `mutation.replayed: true`; a concurrent retry can return `409 idempotency_in_progress` with `Retry-After: 2` and `error.details.retryAfterSeconds`. Wait at least that long, then retry the same request. Reusing a mutation id with a different method, path, or body returns `409 idempotency_conflict`.

Mutation responses return the changed item or changed items plus mutation metadata, not the entire shopping list. Fetch `/api/v1/shopping-list` or `/api/v1/shopping-list/sync` when you need the current list view.

Retry network timeouts, `429`, and `5xx` responses with the same mutation id. Refresh or reconnect on `401`. Do not retry validation, scope, or idempotency-conflict errors unchanged.

Recipe and cookbook list endpoints are public catalog search endpoints today. They accept `limit`, `cursor`, and `query`/`q`; when both query aliases are supplied, `query` wins. Responses include `cursor`, `nextCursor`, and `hasMore`, plus `coverImageUrl` on recipe summaries and `coverImageUrls` on cookbook summaries. They do not yet provide full owner export or deleted recipe/cookbook tombstones. Use shopping-list sync for incremental owner data until export APIs exist.

Cookbook write endpoints are owner-scoped native and automation surfaces. `POST /api/v1/cookbooks` creates an owned cookbook from `title`. `PATCH /api/v1/cookbooks/{id}` renames an owned cookbook. `DELETE /api/v1/cookbooks/{id}` deletes only the cookbook and its recipe links, never the recipes themselves. `POST /api/v1/cookbooks/{id}/recipes/{recipeId}` adds an active recipe to an owned cookbook and returns `added: false` as a successful no-op when the recipe is already present. `DELETE /api/v1/cookbooks/{id}/recipes/{recipeId}` removes the link and returns `removed: false` when the link is already absent. Delete endpoints accept `clientMutationId` in the JSON body, query string, or `X-Client-Mutation-Id` header.

`GET /api/v1/search` is the native/global search endpoint. It accepts `query` or `q`, `scope` (`all`, `recipes`, `cookbooks`, `chefs`, or `shopping-list`), and `limit` from 1 to 50. Anonymous callers receive public recipe, cookbook, and chef result rows. Authenticated callers with `shopping_list:read` can also receive owner-scoped shopping-list item rows; explicit `scope=shopping-list` requires authentication and that scope. Results return mixed rows with `type`, `id`, owner fields, display text, `href`, `canonicalUrl`, optional `imageUrl`, score, and type-specific `metadata`.

Public catalog cursors page by `createdAt` plus `id` for deterministic catalog walks. They are not repeatable snapshot guarantees, not `updatedAt` incremental feeds, and do not include deletion tombstones. New public records can appear during a long crawl. Restart a full crawl when you need to catch public recipe/cookbook edits or removals. Anonymous public recipe/cookbook responses expose `Cache-Control: public, max-age=60, stale-while-revalidate=300`; authenticated public reads are validated and returned with private/no-store cache headers. API v1 does not provide `ETag`, `Last-Modified`, or conditional request support yet.

Recipe import is an authenticated native app and automation surface. `POST /api/v1/recipes/import` requires `kitchen:write`, accepts a `clientMutationId`, and can import from a recipe URL, video URL, plain recipe text, or JSON-LD object. Native capture metadata is optional and currently records where a text import came from, such as camera OCR or photo-library OCR. Import responses include the created or existing recipe detail, `importCode`, `confidence`, normalized `source`, `coverPending`, optional `existingRecipeId`, and idempotency metadata. When the import provider is not configured, the endpoint returns `ok: true` with `data.recipe: null`, `importCode: "provider_secret_required"`, and a `blockers` entry so native clients can show a durable setup blocker instead of retrying in the background.

Recipe import is idempotent with `clientMutationId`. Persist and retry the exact same parsed JSON body for network timeouts, `429`, `502 upstream_error`, `504 upstream_timeout`, other `5xx`, and `idempotency_in_progress`. The import source is part of the conflict contract; changing source text, URL, JSON-LD, capture metadata, or `dryRun` while reusing the same mutation id returns `409 idempotency_conflict`.

Recipe ingredient quantities, units, servings, temperatures, and timers are original author data in API v1. Units are free-form display strings, not a canonical conversion model. API v1 does not expose a `/api/v1/units` registry, density tables, structured yields, locale-aware unit names, or volume-to-mass conversion rules; clients that convert measurements must treat unsupported ingredients or units as non-convertible and preserve the original text.

Recipe spoon endpoints expose first-class cook-event history for native clients. `GET /api/v1/recipes/{id}/spoons` is a public, auth-optional recipe read: anonymous callers can read recent non-deleted spoons, and authenticated callers must have `recipes:read` or `public:read`. Responses page by opaque `cursor` plus `limit`, ordered by `cookedAt` descending and `id` descending, and include native-friendly spoon fields: `id`, `chefId`, `recipeId`, `cookedAt`, `photoUrl`, `note`, `nextTime`, `deletedAt`, `createdAt`, `updatedAt`, and `chef`.

Recipe spoon mutations require `kitchen:write` and are idempotent with `clientMutationId`. `POST /api/v1/recipes/{id}/spoons` creates a cook event from `note`, `nextTime`, `cookedAt`, `photoUrl`, and `useAsRecipeCover`; it reuses Spoonjoy's web spoon creation rules and can create or activate a recipe cover from a spoon photo when the existing cover-decision logic allows it. `PATCH /api/v1/recipes/{id}/spoons/{spoonId}` updates owned spoon fields through the same owner-only domain service as the web product. `DELETE /api/v1/recipes/{id}/spoons/{spoonId}` soft-deletes an owned spoon and accepts the mutation id in the JSON body, query string, or `X-Client-Mutation-Id` header. Path recipe ids are validated so a spoon cannot be mutated through a different recipe URL.

Recipe cover management endpoints are owner-scoped native app surface, not public catalog writes. They require the authenticated chef to own the recipe and to have `kitchen:write`. `GET /api/v1/recipes/{id}/covers` returns cover candidates, the current `activeCover`, spoon photo sources in `spoonImages`, and offset pagination. Pass `includeArchived=true` only for management UIs that need archived candidates.

Recipe-cover mutations are idempotent with `clientMutationId` and return `activeCover`, `previousActiveCover`, optional `createdCover` or `archivedCover`, optional `generationStatus`, warnings, and replay metadata. `PATCH /api/v1/recipes/{id}/covers` sets an explicit no-cover state and requires `confirmNoCover: true`. `PATCH /api/v1/recipes/{id}/covers/{coverId}` activates an existing candidate variant. `DELETE /api/v1/recipes/{id}/covers/{coverId}` archives a candidate and can either promote a replacement variant or confirm that the recipe should have no active cover. `POST /api/v1/recipes/{id}/covers/regenerate` schedules a new editorial image for an existing candidate. `POST /api/v1/recipes/{id}/covers/from-spoon/{spoonId}` creates a candidate from one of the recipe's spoon photos and can request editorial generation.

The full OpenAPI document, SDK profile, and playground include cookbook write and recipe-cover operations. The no-code connector profile includes cookbook JSON actions but omits recipe-cover operations because owner-scoped visual management does not import cleanly into connector action builders.

```bash
curl -fsS -X POST 'https://spoonjoy.app/api/v1/shopping-list/items' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"device-uuid-1","name":"Eggs","quantity":12,"unit":"Each"}'

curl -fsS -X POST 'https://spoonjoy.app/api/v1/shopping-list/add-from-recipe' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"recipe-add:recipe_1:1","recipeId":"recipe_1","scaleFactor":1}'

curl -fsS -X POST 'https://spoonjoy.app/api/v1/shopping-list/clear-completed' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"clear-completed:2026-06-01"}'

curl -fsS -X POST 'https://spoonjoy.app/api/v1/cookbooks' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"cookbook:create:weeknight","title":"Weeknight Favorites"}'

curl -fsS -X POST 'https://spoonjoy.app/api/v1/cookbooks/cookbook_1/recipes/recipe_1' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"cookbook:add:recipe_1"}'

curl -fsS -X POST 'https://spoonjoy.app/api/v1/shopping-list/clear-all' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"clear-all:2026-06-01"}'

curl -fsS 'https://spoonjoy.app/api/v1/recipes/recipe_1/spoons?limit=20'

curl -fsS -X POST 'https://spoonjoy.app/api/v1/recipes/import' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"import:camera:2026-06-01T12:00:00Z","source":{"type":"text","text":"Grandma pasta\nServes 4\nIngredients:\n1 lb spaghetti\nInstructions:\nBoil pasta and toss with sauce.","capture":{"source":"camera","assetIdentifier":"local-capture-1"}}}'

curl -fsS -X POST 'https://spoonjoy.app/api/v1/recipes/recipe_1/spoons' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"spoon-create:recipe_1:2026-06-01","photoUrl":"/photos/spoons/chef_1/uploads/cover-raw.jpg","note":"Added more lemon","useAsRecipeCover":true}'

curl -fsS -X PATCH 'https://spoonjoy.app/api/v1/recipes/recipe_1/spoons/spoon_1' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"spoon-update:spoon_1:1","nextTime":"Less salt"}'

curl -fsS -X DELETE 'https://spoonjoy.app/api/v1/recipes/recipe_1/spoons/spoon_1?clientMutationId=spoon-delete%3Aspoon_1%3A1' \
  -H 'Authorization: Bearer sj_...'

curl -fsS 'https://spoonjoy.app/api/v1/recipes/recipe_1/covers' \
  -H 'Authorization: Bearer sj_...'

curl -fsS -X PATCH 'https://spoonjoy.app/api/v1/recipes/recipe_1/covers/cover_1' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"cover-active:recipe_1:cover_1:stylized","variant":"stylized"}'

curl -fsS -X PATCH 'https://spoonjoy.app/api/v1/recipes/recipe_1/covers' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"cover-none:recipe_1","confirmNoCover":true}'

curl -fsS -X DELETE 'https://spoonjoy.app/api/v1/recipes/recipe_1/covers/cover_1' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"cover-archive:recipe_1:cover_1","replacementCoverId":"cover_2","replacementVariant":"image"}'

curl -fsS -X POST 'https://spoonjoy.app/api/v1/recipes/recipe_1/covers/regenerate' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"cover-regenerate:recipe_1:cover_1","coverId":"cover_1","activateWhenReady":true}'

curl -fsS -X POST 'https://spoonjoy.app/api/v1/recipes/recipe_1/covers/from-spoon/spoon_1' \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"cover-from-spoon:recipe_1:spoon_1","activate":true,"generateEditorial":true}'
```

## External Client Guide

These starting points fit different client shapes without changing the underlying API:

- Tiny-device clients: use cursor sync, compact responses, and idempotent writes so a device can recover from interrupted network calls.
- Mobile apps: read the public Chef graph before sign-in, then request least-privilege shopping-list scopes or `kitchen:write` for recipe-cover management after the chef connects their account.
- CLI/script clients: use bearer credentials, curl, and the OpenAPI contract only when the script cannot share a Spoonjoy session.
- Browser clients: use same-origin Session only inside spoonjoy.app; extensions and third-party browser apps use OAuth/PKCE.
- Agent clients: use MCP with a bearer token, or delegated connection endpoints when a chef needs to approve an external runtime.
- Enterprise clients: API v1 is individual delegated access today; there are no tenant, admin, employee, or org-export APIs yet.

### Read the public Chef graph

Public recipe and cookbook reads work without credentials. Add bearer auth later only when a client needs private state. Anonymous public recipe and cookbook responses may be cached for 60 seconds and return `Cache-Control: public, max-age=60, stale-while-revalidate=300`. Store and follow `nextCursor` for catalog pagination.

```bash
curl 'https://spoonjoy.app/api/v1/recipes?query=pasta&limit=20'
curl 'https://spoonjoy.app/api/v1/cookbooks?limit=20'
curl 'https://spoonjoy.app/api/v1/recipes?cursor=v1.cursor_from_nextCursor&limit=20'
```

Public payloads include `href`, absolute `canonicalUrl`, `coverImageUrl` or `coverImageUrls`, and an `attribution` object. Use `attribution.creditText` with a link to `attribution.canonicalUrl` when displaying Spoonjoy content outside Spoonjoy.

### Public data rights and attribution

Public API data is public-by-default Spoonjoy chef content, not anonymous stock data. In API v1, public recipe and cookbook endpoints intentionally expose non-deleted public recipe/cookbook pages without requiring credentials. That means lightweight embeds, public catalog search, crawl-based internal analytics, and personal or operational uses are supported when they preserve attribution and respect removal. It does not grant permission to commercially republish complete recipes or datasets, copy or redistribute Spoonjoy/source-site photos as your own assets, bypass later removals, or ignore Spoonjoy terms and source-owner rights. See `https://spoonjoy.app/terms`.

Display only the fields returned by API v1, preserve `attribution.creditText`, and link it to `attribution.canonicalUrl` when you show a recipe or cookbook outside Spoonjoy. If `attribution.sourceUrl` or `attribution.sourceRecipe` is present, treat it as user-provided provenance: validate `sourceUrl` as `http` or `https` before linking, do not assume Spoonjoy has verified the external page, and handle `sourceRecipe.deleted: true` as unavailable source content.

Use `coverImageUrl` and `coverImageUrls` only for transient display in contexts where you can honor removals. API v1 does not provide image alt text, image ownership metadata, or a license to copy, store, transform, or redistribute photos outside Spoonjoy; write your own alt text if your embed needs it.

Never put authenticated shopping-list, bearer-token, OAuth, or MCP responses in public caches. Public recipe/cookbook responses can become unavailable if a chef removes them; hide or remove mirrored content when a later fetch returns `404 not_found`. Public catalog endpoints do not emit recipe/cookbook deletion tombstones in v1, so restart full crawls periodically when you need to catch edits or removals. Crawl politely: follow cursors, avoid aggressive parallelism, respect `Retry-After`, and account for the 60-second public cache window.

### Use your Spoonjoy session

Sign into Spoonjoy, open the playground, and leave auth on Session. There is no token to mint or paste for playground calls; the browser sends your normal Spoonjoy session cookie, and private endpoints treat that as the authenticated chef.

```text
https://spoonjoy.app/api/playground
```

### Use bearer only outside the session

Bearer mode is for clients that cannot use the logged-in Spoonjoy browser session. The generated `POST /api/v1/tokens` operation is available in the playground because it is part of API v1, not because private playground calls need a separate token.

```json
{
  "name": "External client",
  "scopes": ["recipes:read", "cookbooks:read", "shopping_list:read", "shopping_list:write"]
}
```

### Native mobile OAuth

iOS production apps should register an HTTPS universal-link redirect URI such as Spoonjoy Apple's `https://spoonjoy.app/oauth/callback`, enable Associated Domains for that host, and run the browser step with `ASWebAuthenticationSession` or AppAuth. Android apps should register the same HTTPS shape, add an intent filter for the exact callback path, publish Digital Asset Links (`assetlinks.json`) for the package name plus SHA-256 signing cert, and run the browser step with Chrome Custom Tabs or AppAuth. Local development can use `http://localhost` or `http://127.0.0.1` loopback; custom schemes are rejected.

```json
{
  "client_name": "Spoonjoy Apple",
  "redirect_uris": ["https://spoonjoy.app/oauth/callback"],
  "token_endpoint_auth_method": "none"
}
```

Generate a PKCE verifier in the app, store it only until the code exchange succeeds, and store `access_token` plus `refresh_token` in Keychain on iOS or Android Keystore-backed storage on Android. Refresh tokens rotate; replace the stored refresh token atomically after every successful refresh. If two requests hit `401` concurrently, run a single-flight refresh and have the other requests wait. Treat `invalid_grant` on refresh as a reconnect-required signal.

```text
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=cm_client_id_from_register&redirect_uri=https%3A%2F%2Fspoonjoy.app%2Foauth%2Fcallback&code=oac_...&code_verifier=pkce_verifier_...

POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&client_id=cm_client_id_from_register&refresh_token=ort_...

POST /oauth/revoke
token=ort_...&client_id=cm_client_id_from_register&token_type_hint=refresh_token
```

### Native iOS OAuth quickstart

Spoonjoy Apple native dogfood quickstart: register an OAuth client once per app install or app environment, then persist client_id in Keychain. Do not register on every launch; public registration is rate limited and redirect URIs are exact-match. If you ship separate development, staging, and production callbacks, register separate clients and store the matching `client_id` with that environment.

Use `ASWebAuthenticationSession.Callback.https(host: "spoonjoy.app", path: "/oauth/callback")` with the production redirect `https://spoonjoy.app/oauth/callback`, plus the Associated Domains entitlement `applinks:spoonjoy.app`. The custom URL scheme is for app navigation only, not OAuth. Localhost/127.0.0.1 loopback is development-only. Native clients persist access_token and refresh_token in Keychain, keep `code_verifier` and `state` only until the callback is exchanged, and clear state and code_verifier after a successful token exchange. Native clients must replace the stored refresh token atomically every time refresh succeeds, use single-flight refresh so concurrent `401` responses do not replay an old refresh token, and decode Spoonjoy REST envelopes before mutating cache state.

```swift
let redirectURI = URL(string: "https://spoonjoy.app/oauth/callback")!
let callback = ASWebAuthenticationSession.Callback.https(host: "spoonjoy.app", path: "/oauth/callback")

struct OAuthTokenResponse: Decodable {
  let access_token: String
  let refresh_token: String
  let expires_in: Int
}

func tokenRequestBody(code: String, verifier: String, clientId: String, redirectURI: String) -> Data {
  var form = URLComponents()
  form.queryItems = [
    URLQueryItem(name: "grant_type", value: "authorization_code"),
    URLQueryItem(name: "client_id", value: clientId),
    URLQueryItem(name: "redirect_uri", value: redirectURI),
    URLQueryItem(name: "code", value: code),
    URLQueryItem(name: "code_verifier", value: verifier),
  ]
  return Data((form.percentEncodedQuery ?? "").utf8)
}

func exchangeCode(code: String, verifier: String, clientId: String, redirectURI: String) async throws -> OAuthTokenResponse {
  var request = URLRequest(url: URL(string: "https://spoonjoy.app/oauth/token")!)
  request.httpMethod = "POST"
  request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
  request.httpBody = tokenRequestBody(code: code, verifier: verifier, clientId: clientId, redirectURI: redirectURI)
  let (data, _) = try await URLSession.shared.data(for: request)
  return try JSONDecoder().decode(OAuthTokenResponse.self, from: data)
}

struct SyncEnvelope: Decodable {
  struct DataBody: Decodable {
    let items: [ShoppingItem]
    let nextCursor: String?
    let hasMore: Bool
  }
  let ok: Bool
  let requestId: String
  let data: DataBody
}

func syncShoppingList(accessToken: String, cursor: String?) async throws -> String? {
  var components = URLComponents(string: "https://spoonjoy.app/api/v1/shopping-list/sync")!
  components.queryItems = [URLQueryItem(name: "limit", value: "50")]
  if let cursor { components.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
  var request = URLRequest(url: components.url!)
  request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
  let (data, _) = try await URLSession.shared.data(for: request)
  // Decode Spoonjoy REST envelopes before mutating cache state.
  let page = try JSONDecoder().decode(SyncEnvelope.self, from: data)
  applyItemsAndTombstones(page.data.items)
  return page.data.hasMore ? try await syncShoppingList(accessToken: accessToken, cursor: page.data.nextCursor) : page.data.nextCursor
}
```

### Profile photo upload/remove

Native settings dogfoods `POST /api/v1/me/photo` and `DELETE /api/v1/me/photo` with `account:write`. Uploads are `multipart/form-data`. Do not set the Content-Type header manually for multipart uploads because the client runtime must add the generated boundary. Queue profile photo upload/remove only after local media staging has succeeded, and keep the staged media until the direct request or queued drain has proven completion.

```bash
curl -fsS -X POST 'https://spoonjoy.app/api/v1/me/photo' \
  -H "Authorization: Bearer $SPOONJOY_TOKEN" \
  -F 'photo=@profile.jpg;type=image/jpeg'

curl -fsS -X DELETE 'https://spoonjoy.app/api/v1/me/photo' \
  -H "Authorization: Bearer $SPOONJOY_TOKEN"
```

### DELETE idempotency

X-Client-Mutation-Id is recommended for DELETE retries because many intermediaries and SDKs treat DELETE bodies inconsistently. API v1 also accepts JSON body clientMutationId where the endpoint declares a delete body, and shopping-list item DELETE accepts query string clientMutationId for clients that cannot send custom headers. Reuse the same id only with the same method, path, and body shape; conflicts return `409 idempotency_conflict`.

```bash
curl -fsS -X DELETE 'https://spoonjoy.app/api/v1/shopping-list/items/item_123' \
  -H "Authorization: Bearer $SPOONJOY_TOKEN" \
  -H 'X-Client-Mutation-Id: shopping-delete:item_123'

curl -fsS -X DELETE 'https://spoonjoy.app/api/v1/shopping-list/items/item_123?clientMutationId=shopping-delete%3Aitem_123' \
  -H "Authorization: Bearer $SPOONJOY_TOKEN"

curl -fsS -X DELETE 'https://spoonjoy.app/api/v1/recipes/recipe_123/spoons/spoon_123' \
  -H "Authorization: Bearer $SPOONJOY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"clientMutationId":"spoon-delete:spoon_123"}'

curl -fsS -X DELETE 'https://spoonjoy.app/api/v1/cookbooks/cookbook_123' \
  -H "Authorization: Bearer $SPOONJOY_TOKEN" \
  -H 'X-Client-Mutation-Id: cookbook-delete:cookbook_123'
```

DELETE examples to mirror in native request builders: DELETE /api/v1/shopping-list/items/{itemId}, DELETE /api/v1/recipes/{id}/spoons/{spoonId}, and DELETE /api/v1/cookbooks/{id}.

## Offline Product Contract

Native clients treat offline support as product behavior, not a cache optimization. Every cached record must carry accountId, environment, schemaVersion, fetchedAt, lastValidatedAt, sourceEndpoint, and a server revision marker when available, such as cursor, etag, updatedAt, deletedAt, or an endpoint-specific tombstone token. Cache keys must include the full private visibility boundary so one account, environment, query, or scope cannot restore another account's private rows.

Freshness thresholds are fixed for native cache and docs drift tests. Signed-in bootstrap, account, settings, and shopping data is fresh for 15 minutes after lastValidatedAt. Recipe detail, cookbook detail, spoon lists, profile/chef graph, and active cook-mode backing data is fresh for 6 hours. Catalog and search result pages are fresh for 24 hours. Local cook progress, capture/import drafts, queued mutations, and staged media are locally authoritative until synced, discarded, or conflicted.

Profile display-field updates, profile photo upload/remove after local media staging, and notification preference updates are queueable. API token create/revoke, OAuth connection disconnect, logout/session revoke, passkey/password/provider-link actions are online-only and must never be queued by native UI, Siri, or Shortcuts. APNs device registration can queue only after the system device token already exists; the permission prompt and device-token acquisition are online-only.

Queued mutations must include stable clientMutationId, endpoint path, method, idempotency key, payload schema version, created-at time, dependency ordering key, retry count, and last error. Queue replay is FIFO within an object dependency key and may run independent keys concurrently only after tests prove no ordering conflict. Retry with the same clientMutationId for timeouts, 429, and 5xx. Auth failure pauses the queue until reauth, validation conflict marks only that mutation conflicted, and server tombstones remove or conflict local records according to endpoint-specific tests.

Do not store bearer tokens, refresh tokens, one-time token values, provider secrets, passkey material, or raw credential values in general cache storage. Use Keychain or session-owned storage for auth material. Cached API responses must filter or purge private rows on logout, account switch, environment switch, cache deletion, and tombstone/delete replay before rendering, donating App Intents entities, or indexing Spotlight content.

Dismissal may hide only informational offline/stale states until connectivity, freshness, or account state changes. It must never hide queued work, sync failure, conflict, blocker, or destructive confirmation states. Feature-owned error states must distinguish true offline transport from backend/auth/application failures so a validation error or provider-secret blocker is not mislabeled as offline.

### Browser extension OAuth

Browser extensions should use OAuth/PKCE from the background script or service worker, store `client_id`, `state`, and `code_verifier` in extension storage until callback, verify `state` before exchanging the code, and request only the scopes needed for the feature. A full recipe clipper can request `kitchen:write` and call `/api/v1/recipes/import`; a "save ingredients" extension normally only needs `shopping_list:read shopping_list:write`; a public recipe overlay can stay anonymous. Chrome-style `chrome.identity.getRedirectURL()` / `launchWebAuthFlow` callbacks are HTTPS URLs and can be registered exactly; custom extension schemes are not accepted.

Use single-flight refresh in the background worker, atomically replace the stored refresh token after every refresh, then retry queued mutations with the same `clientMutationId`. On disconnect, call `/oauth/revoke` with the stored refresh token and clear extension storage.

Bearer calls from extension background code to `/api/v1` are CORS-enabled. Do not run bearer calls from a content script where page scripts can observe them; pass scraped data to the extension background and call Spoonjoy from there.

```js
const item = { sourceRowId: "row-42", name: "Eggs", quantity: 12, unit: "Each" };
await fetch("https://spoonjoy.app/api/v1/shopping-list/items", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    clientMutationId: `extension:${await sha256(recipeUrl)}:${item.sourceRowId}:${await sha256(JSON.stringify(item))}`,
    ...item,
  }),
});
```

There is no arbitrary batch import endpoint in v1. Post one ingredient per scraped row, or use `/api/v1/shopping-list/add-from-recipe` when the source is an existing Spoonjoy recipe. Spoonjoy normalizes names and units to the existing ingredient/unit references, restores matching deleted items, and adds quantity to an existing matching item instead of creating a duplicate. Preserve unknown quantity/unit strings in your own UI when Spoonjoy cannot represent them as positive numeric `quantity` plus display `unit`.

### Cron shopping-list export/import

Shopping-list sync requires `shopping_list:read`. Omit `cursor` on the first request, then pass back the returned opaque `nextCursor` exactly. Apply all rows, including rows with `deletedAt`, before persisting the cursor.

```bash
curl -fsS 'https://spoonjoy.app/api/v1/shopping-list/sync?limit=20' \
  -H "Authorization: Bearer $SPOONJOY_TOKEN"

state="$HOME/.spoonjoy-shopping-state.json"
umask 077
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/spoonjoy-sync.XXXXXX")"
lock_dir="$state.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "Another Spoonjoy sync is running" >&2
  exit 1
fi
trap 'rm -rf "$tmp_dir" "$lock_dir"' EXIT
cursor="$(jq -r '.cursor // empty' "$state" 2>/dev/null || true)"
url="https://spoonjoy.app/api/v1/shopping-list/sync?limit=20"
test -n "$cursor" && url="$url&cursor=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$cursor")"

next_cursor="$cursor"
while :; do
  url="https://spoonjoy.app/api/v1/shopping-list/sync?limit=20"
  test -n "$next_cursor" && url="$url&cursor=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$next_cursor")"
  curl -fsS "$url" -H "Authorization: Bearer $SPOONJOY_TOKEN" > "$tmp_dir/sync.json"
  # Apply both active rows and tombstones before advancing durable state.
  jq -r '.data.items[] | [.name, .quantity, .unit, .deletedAt] | @tsv' "$tmp_dir/sync.json"
  next_cursor="$(jq -r '.data.nextCursor' "$tmp_dir/sync.json")"
  test "$(jq -r '.data.hasMore' "$tmp_dir/sync.json")" = true || break
done
state_tmp="$tmp_dir/state.json"
jq -n --arg cursor "$next_cursor" '{cursor:$cursor}' > "$state_tmp"
mv "$state_tmp" "$state"
```

For imports, generate chef-wide deterministic `clientMutationId` values such as `shopping-import:<source-system>:<source-row-id>:<body-hash>`. Retry timeouts, `429`, and `5xx` with the same mutation id and body; honor `Retry-After` on 429. Do not retry validation, scope, or idempotency-conflict errors unchanged. Import is not a durable set-desired-state API: idempotency rows expire after 24 hours, and POST can add quantity to an existing matching item. PATCH and DELETE use server write order and do not accept client timestamps or version preconditions in v1.

```bash
curl -fsS -X PATCH 'https://spoonjoy.app/api/v1/shopping-list/items/item_123' \
  -H "Authorization: Bearer $SPOONJOY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"clientMutationId":"shopping-check:item_123:true","checked":true}'

curl -fsS -X DELETE 'https://spoonjoy.app/api/v1/shopping-list/items/item_123' \
  -H "Authorization: Bearer $SPOONJOY_TOKEN" \
  -H 'X-Client-Mutation-Id: shopping-delete:item_123'
```

### Cloudflare Worker sync bridge

For a Worker, store `access_token`, rotating `refresh_token`, and the shopping-list `nextCursor` behind a Durable Object, queue-level serializer, or D1 row lock. KV is useful for read-through state after the lock, but it is not a safe compare-and-set primitive for OAuth refresh-token rotation. Replace the stored refresh token atomically after every successful refresh before releasing the per-chef lock.

Do not store authenticated bearer responses in `caches.default`. Cache only anonymous public recipe/cookbook JSON, and only if your bridge can tolerate the public cache window. OAuth token endpoints are form-encoded and do not use bearer/session auth headers; API v1 calls use `Authorization: Bearer sj_...`.

```js
export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      const id = env.SPOONJOY_CHEF_SYNC.idFromName(message.body.chefId);
      await env.SPOONJOY_CHEF_SYNC.get(id).fetch("https://sync/run", {
        method: "POST",
        body: JSON.stringify(message.body),
      });
      message.ack();
    }
  },
};

export class SpoonjoyChefSync {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const job = await request.json();
    const state = await this.readState(job.chefId);
    const next = await this.syncShoppingList(state);
    await this.writeState(job.chefId, next);
    return new Response("ok");
  }

  async readState(chefId) {
    const state = await this.env.SPOONJOY_STATE.get(`chef:${chefId}`, "json");
    if (!state?.access_token || !state?.refresh_token) {
      throw new Error("Missing Spoonjoy OAuth token state; reconnect this chef.");
    }
    return state;
  }

  async writeState(chefId, state) {
    await this.env.SPOONJOY_STATE.put(`chef:${chefId}`, JSON.stringify(state));
  }

  async refresh(state) {
    const res = await fetch("https://spoonjoy.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.env.SPOONJOY_CLIENT_ID,
        refresh_token: state.refresh_token,
      }),
    });
    if (!res.ok) throw new Error(`Spoonjoy refresh failed: ${res.status}`);
    const tokens = await res.json();
    return { ...state, access_token: tokens.access_token, refresh_token: tokens.refresh_token };
  }

  async spoonjoyFetch(state, path, init = {}) {
    const request = (tokenState) => fetch(`https://spoonjoy.app${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${tokenState.access_token}`, ...(init.headers || {}) },
    });
    let res = await request(state);
    if (res.status === 401) {
      state = await this.refresh(state);
      res = await request(state);
    }
    return { res, state };
  }

  async syncShoppingList(state) {
    let nextCursor = state.cursor ?? "";
    while (true) {
      const cursor = nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : "";
      const { res, state: refreshedState } = await this.spoonjoyFetch(state, `/api/v1/shopping-list/sync?limit=50${cursor}`);
      state = refreshedState;
      if (res.status === 429) throw new Error(`Retry after ${res.headers.get("Retry-After") ?? "later"}`);
      if (!res.ok) throw new Error(`Spoonjoy sync failed: ${res.status}`);
      const body = await res.json();
      if (body.ok !== true) throw new Error(`Spoonjoy sync error: ${body.error?.code ?? "unknown"}`);
      await this.applyItems(body.data.items);
      nextCursor = body.data.nextCursor;
      state = { ...state, cursor: nextCursor };
      if (!body.data.hasMore) break;
    }
    return state;
  }

  async applyItems(items) {
    console.log(`Apply ${items.length} Spoonjoy shopping-list changes before saving the cursor.`);
  }
}
```

Bind `SPOONJOY_CHEF_SYNC` as a Durable Object. If you use D1 instead, hold a per-chef row lock across refresh, sync, cursor update, and queued mutation retry. KV alone is fine for read-through snapshots after the lock, but not for refresh-token rotation.

### No-code connector profile

Use `https://spoonjoy.app/api/v1/openapi.connector.json` for Zapier, Make, and other importers that expect an OpenAPI 3.0 REST action/search profile. The full `/api/v1/openapi.json` remains the richer source of truth for the playground and modern SDKs, but it intentionally includes OAuth redirect, delegated approval, and MCP operations that no-code importers should not expose as normal actions.

API v1 does not have webhooks, REST Hooks, SSE, or event subscriptions yet. The connector-ready trigger today is polling shopping-list sync:

Configure OAuth in no-code builders as a public client: no client secret, PKCE S256 required, authorization URL `https://spoonjoy.app/oauth/authorize`, token URL `https://spoonjoy.app/oauth/token`, refresh URL `https://spoonjoy.app/oauth/token`, revoke URL `https://spoonjoy.app/oauth/revoke`, and scopes such as `shopping_list:read shopping_list:write`. Register the callback URL supplied by the builder exactly with `POST /oauth/register`.

```text
Trigger: New, updated, or removed shopping-list item
1. GET /api/v1/shopping-list/sync?limit=50 with Authorization: Bearer sj_...
2. Sort returned items by updatedAt descending before handing them to Zapier/Make, and dedupe trigger events by `id:updatedAt` so later changes to the same item are not suppressed.
3. Include deletedAt rows as removals or filtered tombstones, depending on the platform.
4. Persist data.nextCursor only after the trigger run succeeds.
```

Public recipe/cookbook lists are usable as catalog searches and cursor walks, not instant triggers or owner export feeds. They do not emit private data, updatedAt deltas, repeatable snapshot guarantees, or deletion tombstones in v1.

### Public BI snapshot export

For BI/reporting over public catalog data, walk recipe and cookbook pages until `hasMore` is false. Treat the result as a best-effort crawl, not a repeatable snapshot or incremental export.

```bash
fetch_page() {
  url="$1"
  for attempt in 1 2 3; do
    status="$(curl -sS -w '%{http_code}' -D headers.txt "$url" -o page.json)"
    test "$status" = 200 && return 0
    test "$status" = 429 && sleep "$(awk 'tolower($1)==\"retry-after:\" {print $2+0}' headers.txt || echo 5)" && continue
    test "$status" -ge 500 && sleep "$attempt" && continue
    cat page.json >&2
    return 1
  done
  return 1
}

snapshot_resource() {
  path="$1"
  array_key="$2"
  out="$3"
  cursor=""
  : > "$out"
  while true; do
    url="https://spoonjoy.app/api/v1/$path?limit=50"
    test -n "$cursor" && url="$url&cursor=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$cursor")"
    fetch_page "$url"
    jq -c ".data.$array_key[]" page.json >> "$out"
    test "$(jq -r '.data.hasMore' page.json)" = true || break
    cursor="$(jq -r '.data.nextCursor' page.json)"
  done
}

snapshot_resource recipes recipes recipes.ndjson
snapshot_resource cookbooks cookbooks cookbooks.ndjson
```

Use shopping-list sync when you need owner-scoped incremental data. Full account export, recipe/cookbook update feeds, and recipe/cookbook deletion tombstones are not in API v1 yet.

Public data is still chef-controlled content. API availability is not a copyright, trademark, photo, or commercial-republishing license. Preserve `attribution.creditText` and `attribution.canonicalUrl`, link back to Spoonjoy, comply with Spoonjoy terms and the source owner's rights, and do not assume full recipe/photo republication is allowed just because JSON is readable. Keep authenticated shopping-list/OAuth data out of any public catalog cache, and remove or hide mirrored public content when a later fetch returns `404 not_found`.

Cookbook endpoints in API v1 expose public cookbook pages and their currently public, non-deleted recipe entries. They are not private library exports and do not provide cookbook deletion tombstones. When a recipe fork points back to a source recipe that has since been deleted, `attribution.sourceRecipe.deleted` is true and title/chef/link fields are redacted.

### REST-powered embeds only

Spoonjoy supports REST-powered embeds, not iframe embeds. Spoonjoy pages intentionally send frame-denial security headers; build your embed by fetching public JSON, rendering your own HTML, and linking back to `canonicalUrl`.

Treat recipe titles, descriptions, steps, ingredient names, units, and `attribution.sourceUrl` as user-provided content. Render text with DOM text APIs, validate `sourceUrl` before linking, and avoid copying Spoonjoy images or source-site URLs into contexts where you cannot honor removal requests.

Recipe detail responses return `steps` in ascending `stepNum` order. Each step includes the ingredients attached to that step in API order. Ingredient `unit` values are free-form display strings, `duration` is minutes when present, and API v1 does not expose ingredient display-text, image alt text, or unit conversion metadata.

```html
<article id="spoonjoy-recipe"></article>
<script type="module">
  const appendText = (parent, tag, text) => {
    if (!text) return null;
    const node = document.createElement(tag);
    node.textContent = text;
    parent.append(node);
    return node;
  };

  const res = await fetch("https://spoonjoy.app/api/v1/recipes/recipe_1");
  if (res.status === 404) {
    document.querySelector("#spoonjoy-recipe").hidden = true;
    throw new Error("Spoonjoy recipe is no longer public.");
  }
  if (!res.ok) throw new Error(`Spoonjoy recipe fetch failed: ${res.status}`);
  const body = await res.json();
  if (body.ok !== true) throw new Error(body.error?.code ?? "spoonjoy_error");

  const { data } = body;
  const recipe = data.recipe;
  const host = document.querySelector("#spoonjoy-recipe");
  host.replaceChildren();

  appendText(host, "h2", recipe.title);
  appendText(host, "p", recipe.servings ? `Serves ${recipe.servings}` : "");

  if (recipe.coverImageUrl) {
    const image = document.createElement("img");
    image.src = new URL(recipe.coverImageUrl).toString();
    image.alt = "";
    host.append(image);
  }

  const ingredients = document.createElement("ul");
  const seenIngredients = new Set();
  for (const step of recipe.steps) {
    for (const item of step.ingredients) {
      const key = item.id || `${item.quantity}:${item.unit}:${item.name}`;
      if (seenIngredients.has(key)) continue;
      seenIngredients.add(key);
      const row = document.createElement("li");
      row.textContent = [item.quantity, item.unit, item.name].filter(Boolean).join(" ");
      ingredients.append(row);
    }
  }
  if (ingredients.children.length) {
    appendText(host, "h3", "Ingredients");
    host.append(ingredients);
  }

  const steps = document.createElement("ol");
  for (const step of recipe.steps) {
    const row = document.createElement("li");
    appendText(row, "strong", step.stepTitle || `Step ${step.stepNum}`);
    appendText(row, "p", step.description);
    appendText(row, "small", step.duration == null ? "" : `${step.duration} min`);
    steps.append(row);
  }
  if (steps.children.length) {
    appendText(host, "h3", "Steps");
    host.append(steps);
  }

  const credit = document.createElement("a");
  credit.href = new URL(recipe.attribution.canonicalUrl).toString();
  credit.rel = "noopener";
  credit.textContent = recipe.attribution.creditText;
  host.append(credit);

  if (recipe.attribution.sourceUrl) {
    try {
      const sourceUrl = new URL(recipe.attribution.sourceUrl);
      if (sourceUrl.protocol === "http:" || sourceUrl.protocol === "https:") {
        const source = document.createElement("a");
        source.href = sourceUrl.toString();
        source.rel = "noopener nofollow";
        source.textContent = recipe.attribution.sourceHost || "Original source";
        host.append(source);
      }
    } catch {
      // Ignore malformed user-provided provenance URLs.
    }
  }
</script>
```

Display `attribution.creditText`, link it to `attribution.canonicalUrl`, and use `sourceUrl` or `sourceRecipe` attribution when present. Handle `404 not_found` by hiding or replacing the embed; public recipes and cookbooks can become unavailable if removed by their chef. CORS is enabled for public API JSON, but Spoonjoy does not provide an oEmbed or hosted widget endpoint in API v1.

### Start delegated agent auth

```bash
curl -fsS -X POST 'https://spoonjoy.app/api/tools/start_agent_connection' \
  -H 'Content-Type: application/json' \
  -d '{"agentName":"client","scopes":"shopping_list:read shopping_list:write"}'
```

Remote `/mcp` itself is bearer-only. Unauthenticated remote clients must start with `POST /api/tools/start_agent_connection` or OAuth/PKCE; only local stdio bridges can expose bootstrap helpers without an existing remote bearer token.

The legacy app-only `/api/*` routes still exist for the Spoonjoy application and existing integrations, but new external clients should target `/api/v1`, `/api`, `/api/playground`, and the OpenAPI document.
