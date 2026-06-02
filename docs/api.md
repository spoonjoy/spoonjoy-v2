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

Spoonjoy accepts bearer credentials through `Authorization: Bearer sj_...`. Public recipe and cookbook reads work without a token, but authenticated requests can use scoped tokens to read private resources, mutate the owner shopping list, or manage token metadata.

Supported entry points:

- Personal API tokens: `GET /api/v1/tokens`, `POST /api/v1/tokens`, and `DELETE /api/v1/tokens/{credentialId}`
- OAuth/DCR clients: `POST /oauth/register`, `GET /oauth/authorize`, and `POST /oauth/token`
- Delegated agent connection: `POST /api/tools/start_agent_connection` and `POST /api/tools/poll_agent_connection`
- MCP clients: `POST /mcp`

OAuth access tokens are normal Spoonjoy API credentials. OAuth token responses also include a rotating `refresh_token`; each refresh-token grant rotates the presented token and rejects replay.

## Scopes

Scopes are attached to bearer tokens and OAuth-issued API credentials. Fine-grained REST scopes are:

| Scope | Purpose |
| --- | --- |
| `recipes:read` | Read public recipes and recipe detail. |
| `cookbooks:read` | Read public cookbook lists and cookbook detail. |
| `shopping_list:read` | Read the authenticated owner's active shopping list and sync feed. |
| `shopping_list:write` | Add, check, or remove items from the authenticated owner's shopping list. |
| `tokens:read` | List token metadata for the authenticated owner. |
| `tokens:write` | Create or revoke scoped personal tokens for the authenticated owner. |

OAuth/MCP consent uses broader `kitchen:read` and `kitchen:write` scopes. The API maps those delegated credentials onto the owner-scoped kitchen operations while preventing cross-owner access.

## Rate Limiting

API v1 is rate limited by IP and credential before authentication work. Anonymous requests are keyed by IP; bearer requests are keyed by the credential hash. Rate-limited responses return HTTP `429`, a `Retry-After` header, and an error envelope with code `rate_limited`.

## Endpoints

| Method | Path | Auth | Required scopes |
| --- | --- | --- | --- |
| `GET` | `/api/v1` | Optional | none |
| `GET` | `/api/v1/health` | Optional | none |
| `GET` | `/api/v1/openapi.json` | Optional | none |
| `GET` | `/api/v1/recipes` | Optional | `recipes:read` when bearer-authenticated |
| `GET` | `/api/v1/recipes/{id}` | Optional | `recipes:read` when bearer-authenticated |
| `GET` | `/api/v1/cookbooks` | Optional | `cookbooks:read` when bearer-authenticated |
| `GET` | `/api/v1/cookbooks/{id}` | Optional | `cookbooks:read` when bearer-authenticated |
| `GET` | `/api/v1/shopping-list` | Bearer | `shopping_list:read` |
| `GET` | `/api/v1/shopping-list/sync` | Bearer | `shopping_list:read` |
| `POST` | `/api/v1/shopping-list/items` | Bearer | `shopping_list:write` |
| `PATCH` | `/api/v1/shopping-list/items/{itemId}` | Bearer | `shopping_list:write` |
| `DELETE` | `/api/v1/shopping-list/items/{itemId}` | Bearer | `shopping_list:write` |
| `GET` | `/api/v1/tokens` | Bearer | `tokens:read` |
| `POST` | `/api/v1/tokens` | Bearer | `tokens:write` |
| `DELETE` | `/api/v1/tokens/{credentialId}` | Bearer | `tokens:write` |

## Sync And Mutations

`GET /api/v1/shopping-list/sync?cursor=...` returns owner-scoped shopping-list changes after the supplied ISO timestamp cursor. Sync responses include active rows and tombstone records so offline or tiny-device clients can remove locally cached items after server-side deletion.

Shopping-list writes accept a `clientMutationId`. Reusing the same mutation id with the same request body returns the recorded response as an idempotency replay; reusing it with a different body returns `409 idempotency_conflict`.

```bash
curl -X POST https://spoonjoy.app/api/v1/shopping-list/items \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"device-uuid-1","name":"Eggs","quantity":12,"unit":"Each"}'
```

## Examples

Read the public Chef graph without credentials:

```bash
curl 'https://spoonjoy.app/api/v1/recipes?query=pasta&limit=20'
curl 'https://spoonjoy.app/api/v1/cookbooks?limit=20'
```

Create a scoped token while signed in:

```bash
curl -X POST https://spoonjoy.app/api/v1/tokens \
  -H 'Authorization: Bearer sj_owner_token' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Tiny client","scopes":["recipes:read","shopping_list:read"]}'
```

Sync the private shopping list:

```bash
curl 'https://spoonjoy.app/api/v1/shopping-list/sync?cursor=2026-06-01T00:00:00.000Z' \
  -H 'Authorization: Bearer sj_...'
```

Start delegated agent auth:

```bash
curl -X POST https://spoonjoy.app/api/tools/start_agent_connection \
  -H 'Content-Type: application/json' \
  -d '{"agentName":"client","baseUrl":"https://spoonjoy.app"}'
```

The legacy `/api/*` routes still exist for the app and existing integrations, but new external clients should target `/api/v1`, `/developers`, and the OpenAPI document.
