# Spoonjoy HTTP API

Spoonjoy exposes a normal JSON REST API for non-agent clients while sharing the same operation layer used by MCP. The REST route is intentionally thin: it authenticates the caller, maps HTTP resources to Spoonjoy operations, and returns JSON envelopes.

## Authentication

The API accepts either of these credentials:

- Browser session cookie, for same-origin UI flows.
- Bearer API token, for external clients: `Authorization: Bearer sj_...`.

Create an API token while signed in:

```bash
curl -X POST https://<host>/api/tokens \
  -H 'Content-Type: application/json' \
  -H 'Cookie: __session=...' \
  -d '{"name":"CLI recipe importer"}'
```

The raw token is returned once. Spoonjoy stores only a SHA-256 hash plus a short display prefix.

Owner-scoped write/read-private operations derive the owner from the authenticated principal. If a bearer-authenticated request includes a different `ownerEmail`, Spoonjoy rejects it with `403` instead of allowing cross-owner access.

## Rate Limiting

Every `/api/*` request runs through Cloudflare's native sliding-window rate limiter before authentication:

| Scope | Key | Window | Limit |
| --- | --- | --- | --- |
| Bearer token | SHA-256 of the token | 60 seconds | 120 requests |
| IP (anonymous) | `CF-Connecting-IP` | 60 seconds | 60 requests |

When a request exceeds the limit, the API returns:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{ "error": "rate_limited", "message": "Too many requests. Try again later.", "retryAfterSeconds": 60 }
```

The check runs before token validation so invalid-token requests cannot bypass the limit. CORS headers are preserved on the 429 response so browser clients can read it.

## Response Shape

Successful responses:

```json
{
  "ok": true,
  "data": {}
}
```

Errors:

```json
{
  "ok": false,
  "error": {
    "message": "Authentication required",
    "status": 401
  }
}
```

CORS is open for bearer-token clients with `Authorization` and `Content-Type` headers.

## Endpoints

| Method | Path | Operation | Auth |
| --- | --- | --- | --- |
| `GET` | `/api` | API discovery | Public |
| `GET` | `/api/health` | Health | Public |
| `GET` | `/api/tools` | Shared operation metadata | Public |
| `GET` | `/api/search?query=&scope=&limit=` | Unified search | Public, includes private shopping-list hits only when authenticated |
| `GET` | `/api/recipes?query=&chefEmail=&limit=` | Recipe search | Public |
| `POST` | `/api/recipes` | Create recipe | Auth required |
| `GET` | `/api/recipes/:id` | Get recipe | Public |
| `POST` | `/api/recipes/:id/shopping-list` | Add recipe ingredients to shopping list | Auth required |
| `GET` | `/api/cookbooks?query=&limit=` | List owner cookbooks | Auth required |
| `POST` | `/api/cookbooks` | Create cookbook | Auth required |
| `GET` | `/api/cookbooks/:id` | Get owner cookbook | Auth required |
| `POST` | `/api/cookbooks/:id/recipes` | Add recipe to cookbook | Auth required |
| `DELETE` | `/api/cookbooks/:id/recipes/:recipeId` | Remove recipe from cookbook | Auth required |
| `GET` | `/api/shopping-list` | Get shopping list | Auth required |
| `GET` | `/api/shopping-list/search?query=&limit=` | Search shopping list | Auth required |
| `POST` | `/api/shopping-list/items` | Add shopping-list item | Auth required |
| `PATCH` | `/api/shopping-list/items/:itemId` | Set item checked state | Auth required |
| `DELETE` | `/api/shopping-list/items/:itemId` | Remove shopping-list item | Auth required |
| `GET` | `/api/tokens` | List token metadata | Auth required |
| `POST` | `/api/tokens` | Create token | Auth required |
| `DELETE` | `/api/tokens/:credentialId` | Revoke token | Auth required |

## Examples

Search public recipes and chefs:

```bash
curl 'https://<host>/api/search?query=tomato&scope=all&limit=10'
```

Add a shopping-list item with a bearer token:

```bash
curl -X POST https://<host>/api/shopping-list/items \
  -H 'Authorization: Bearer sj_...' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Milk","quantity":1,"unit":"gallon","categoryKey":"dairy"}'
```

Revoke a token:

```bash
curl -X DELETE https://<host>/api/tokens/<credentialId> \
  -H 'Authorization: Bearer sj_...'
```
