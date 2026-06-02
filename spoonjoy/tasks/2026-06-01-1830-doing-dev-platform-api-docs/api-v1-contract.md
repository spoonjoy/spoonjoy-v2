# Spoonjoy API v1 Contract

This artifact is normative for the first implementation slice. If a unit says "payload shape", "request schema", "response schema", "example", "scope requirement", or "live response shape", it means the shapes below unless the unit names a narrower assertion.

## Contract Source Of Truth

- Implementation creates `app/lib/api-v1-contract.server.ts`.
- `app/lib/api-v1-contract.server.ts` owns endpoint metadata, scope requirements, examples, error codes, and schema fragments.
- `app/lib/api-v1.server.ts`, `app/lib/api-v1-openapi.server.ts`, and `/developers` loader code may import the contract module.
- `app/routes/developers.tsx` must not import `.server.ts` modules in client-rendered component code. Its loader imports server-only contract/OpenAPI modules and returns serializable docs data for the component.
- `docs/api.md` is markdown, so it does not import the module; docs tests import `app/lib/api-v1-contract.server.ts` and read `docs/api.md` to assert the public endpoint list, scope list, and guide snippets stay aligned.

## Scopes

Valid first-slice scopes:

- `public:read`
- `recipes:read`
- `cookbooks:read`
- `shopping_list:read`
- `shopping_list:write`
- `tokens:read`
- `tokens:write`
- `offline_access`
- legacy `kitchen:read`
- legacy `kitchen:write`

`ApiCredential.scopes` is a required space-separated string with database default `'kitchen:read kitchen:write'`. The default preserves existing rows and delegated credentials.

Creation-time scope normalization:

- Omitted `scopes` for a new personal API token becomes `public:read recipes:read cookbooks:read shopping_list:read shopping_list:write tokens:read tokens:write`.
- Provided scopes may be a string or string array.
- Provided empty string or empty array means no scopes.
- Duplicate scopes are removed and stored in stable lexical order.
- Unknown scopes return `400 invalid_scope`.
- `offline_access` is valid for docs/OAuth consistency but no v1 endpoint requires it in this slice.

Runtime expansion:

- Empty stored scope string expands to no scopes.
- `kitchen:read` grants `public:read`, `recipes:read`, `cookbooks:read`, `shopping_list:read`, and `tokens:read`.
- `kitchen:write` grants `shopping_list:write` and `tokens:write`.
- Session principals are first-party authenticated users and are treated as having all first-slice scopes for their own resources.
- Bearer principals must satisfy the route's scope requirement after expansion.

## Idempotency Storage

`ApiIdempotencyKey` stores mutation replay state:

- `id String @id @default(cuid())`
- `userId String` relation to `User`, `onDelete: Cascade`
- `credentialId String?` relation to `ApiCredential`, `onDelete: SetNull`
- `clientKey String`, set to `credential:${credentialId}` for bearer calls and `session:${userId}` for session calls
- `key String`, the request `clientMutationId`
- `operation String`, one of `shopping_list.items.create`, `shopping_list.items.check`, `shopping_list.items.delete`
- `requestHash String`, a SHA-256 hex hash of canonical JSON containing `method`, `path`, and `body`; for `PATCH` and `DELETE`, `path` includes the concrete `itemId`
- `responseStatus Int?`
- `responseBody String?`, JSON string of the stored v1 envelope body
- `expiresAt DateTime`, set by the helper to 24 hours after reservation
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @default(now()) @updatedAt`

Indexes and constraints:

- Unique tuple: `@@unique([userId, clientKey, key])`
- `@@index([userId, createdAt])`
- `@@index([credentialId])`
- `@@index([expiresAt])`

Replay rules:

- First use reserves the row, runs the mutation, stores status and body, and returns that response.
- Exact replay for the same `userId`, `clientKey`, `key`, `operation`, and `requestHash` returns the stored status/body with `mutation.replayed: true`.
- Same key with different operation or request hash returns `409 idempotency_conflict`.
- Stored 4xx/5xx responses replay exactly.
- A replay does not require the original credential to remain active if the same client key can authenticate the current request; a revoked bearer token still fails auth before replay lookup.
- Replay responses use the current request's `requestId` in the response envelope and `X-Request-Id` header. The stored body is copied, then `requestId` is replaced with the current request id and `mutation.replayed` is set to `true`.
- Expired idempotency rows are ignored for replay/conflict. Before reserving a key, the helper deletes rows for the same `userId`, `clientKey`, and `key` whose `expiresAt` is less than or equal to the current time. After deletion, the key may be reused as a fresh first use.

## Envelope, Headers, And Errors

Every JSON v1 response uses one envelope.

Success:

```json
{
  "ok": true,
  "requestId": "req_abc123",
  "data": {}
}
```

Error:

```json
{
  "ok": false,
  "requestId": "req_abc123",
  "error": {
    "code": "validation_error",
    "message": "A human-readable message.",
    "status": 400,
    "details": {}
  }
}
```

`error.details` is omitted when empty. Unknown thrown values become `500 internal_error`.

Required headers on v1 responses:

- `Content-Type: application/json; charset=utf-8` for JSON responses
- `X-Request-Id`, using incoming `X-Request-Id` when present and nonblank, otherwise generated as `req_${crypto.randomUUID()}`
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: Authorization, Content-Type, X-Request-Id`
- `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`
- `Access-Control-Expose-Headers: X-Request-Id`

`OPTIONS /api/v1/*` returns status `204` with the CORS and request-id headers.

Error code map:

- `invalid_json` -> 400
- `validation_error` -> 400
- `invalid_cursor` -> 400
- `invalid_scope` -> 400
- `authentication_required` -> 401
- `invalid_token` -> 401
- `insufficient_scope` -> 403
- `not_found` -> 404
- `method_not_allowed` -> 405
- `idempotency_conflict` -> 409
- `rate_limited` -> 429
- `internal_error` -> 500

Rate-limit guidance for docs:

- Public docs must say v1 endpoints are rate limited by IP and credential where applicable.
- Clients should treat `429 rate_limited` as retryable, use exponential backoff, and preserve the same `clientMutationId` when retrying idempotent shopping-list mutations.
- The first slice does not guarantee a `Retry-After` header. If a future implementation adds it, clients may honor it.
- The OpenAPI document includes `429` responses according to the status matrix but does not promise a numeric quota.

## Discovery And Health

`GET /api/v1` returns status `200`:

```json
{
  "ok": true,
  "requestId": "req_abc123",
  "data": {
    "app": "spoonjoy",
    "version": "v1",
    "status": "ok",
    "docsUrl": "https://spoonjoy.app/developers",
    "openapiUrl": "/api/v1/openapi.json",
    "resources": [
      { "name": "root", "path": "/api/v1", "methods": ["GET"], "auth": "optional", "scopes": [] },
      { "name": "health", "path": "/api/v1/health", "methods": ["GET"], "auth": "optional", "scopes": [] },
      { "name": "openapi", "path": "/api/v1/openapi.json", "methods": ["GET"], "auth": "optional", "scopes": [] },
      { "name": "recipes", "path": "/api/v1/recipes", "methods": ["GET"], "auth": "optional", "scopes": ["recipes:read"] },
      { "name": "recipe", "path": "/api/v1/recipes/{id}", "methods": ["GET"], "auth": "optional", "scopes": ["recipes:read"] },
      { "name": "cookbooks", "path": "/api/v1/cookbooks", "methods": ["GET"], "auth": "optional", "scopes": ["cookbooks:read"] },
      { "name": "cookbook", "path": "/api/v1/cookbooks/{id}", "methods": ["GET"], "auth": "optional", "scopes": ["cookbooks:read"] },
      { "name": "shopping-list", "path": "/api/v1/shopping-list", "methods": ["GET"], "auth": "bearer", "scopes": ["shopping_list:read"] },
      { "name": "shopping-list-sync", "path": "/api/v1/shopping-list/sync", "methods": ["GET"], "auth": "bearer", "scopes": ["shopping_list:read"] },
      { "name": "shopping-list-items", "path": "/api/v1/shopping-list/items", "methods": ["POST"], "auth": "bearer", "scopes": ["shopping_list:write"] },
      { "name": "shopping-list-item", "path": "/api/v1/shopping-list/items/{itemId}", "methods": ["PATCH", "DELETE"], "auth": "bearer", "scopes": ["shopping_list:write"] },
      { "name": "tokens", "path": "/api/v1/tokens", "methods": ["GET", "POST"], "auth": "bearer", "scopes": ["tokens:read", "tokens:write"] },
      { "name": "token", "path": "/api/v1/tokens/{credentialId}", "methods": ["DELETE"], "auth": "bearer", "scopes": ["tokens:write"] }
    ],
    "auth": {
      "type": "bearer",
      "tokenUrl": "/api/v1/tokens",
      "oauth": { "register": "/oauth/register", "authorize": "/oauth/authorize", "token": "/oauth/token" },
      "mcp": { "endpoint": "/mcp", "startAgentConnection": "/api/tools/start_agent_connection", "pollAgentConnection": "/api/tools/poll_agent_connection" }
    }
  }
}
```

`resources` order is exactly the order shown above. `auth: "optional"` means anonymous is allowed but bearer credentials are authenticated and checked when present; an optional-auth route with `scopes: []` requires no additional scope after authentication. `auth: "bearer"` means session or bearer authentication is required.

`GET /api/v1/health` returns status `200`:

```json
{
  "ok": true,
  "requestId": "req_abc123",
  "data": {
    "ok": true,
    "version": "v1",
    "authenticated": false,
    "principal": null,
    "scopes": []
  }
}
```

Authenticated health sets `authenticated: true`, `principal: { "id": "...", "username": "...", "source": "session|bearer|environment" }`, and expanded `scopes`.

## Public Recipe Reads

`GET /api/v1/recipes?query=pasta&limit=20`

- Query params: `query` optional string; `q` is accepted as an alias; `limit` optional integer 1-50, default 20.
- Anonymous callers are allowed.
- Bearer callers require `recipes:read` or legacy `kitchen:read`.

Response status `200`:

```json
{
  "ok": true,
  "requestId": "req_abc123",
  "data": {
    "query": "pasta",
    "limit": 20,
    "recipes": [
      {
        "id": "recipe_1",
        "title": "Pasta",
        "description": "Weeknight pasta",
        "servings": "4",
        "chef": { "id": "chef_1", "username": "ari" },
        "href": "/recipes/recipe_1",
        "createdAt": "2026-06-01T00:00:00.000Z",
        "updatedAt": "2026-06-01T00:00:00.000Z"
      }
    ]
  }
}
```

`GET /api/v1/recipes/:id` returns status `200` with `data.recipe`:

```json
{
  "id": "recipe_1",
  "title": "Pasta",
  "description": "Weeknight pasta",
  "servings": "4",
  "chef": { "id": "chef_1", "username": "ari" },
  "href": "/recipes/recipe_1",
  "createdAt": "2026-06-01T00:00:00.000Z",
  "updatedAt": "2026-06-01T00:00:00.000Z",
  "steps": [
    {
      "id": "step_1",
      "stepNum": 1,
      "stepTitle": null,
      "description": "Boil pasta.",
      "duration": null,
      "ingredients": [
        { "id": "ingredient_1", "name": "pasta", "quantity": 1, "unit": "lb" }
      ]
    }
  ],
  "cookbooks": [
    { "id": "cookbook_1", "title": "Weeknights", "href": "/cookbooks/cookbook_1" }
  ]
}
```

Deleted recipes return `404 not_found`.

## Public Cookbook Reads

`GET /api/v1/cookbooks?query=weeknight&limit=20`

- Query params: `query` optional string; `q` is accepted as an alias; `limit` optional integer 1-50, default 20.
- Anonymous callers are allowed.
- Bearer callers require `cookbooks:read` or legacy `kitchen:read`.

Response status `200`:

```json
{
  "ok": true,
  "requestId": "req_abc123",
  "data": {
    "query": "weeknight",
    "limit": 20,
    "cookbooks": [
      {
        "id": "cookbook_1",
        "title": "Weeknights",
        "chef": { "id": "chef_1", "username": "ari" },
        "recipeCount": 3,
        "href": "/cookbooks/cookbook_1",
        "createdAt": "2026-06-01T00:00:00.000Z",
        "updatedAt": "2026-06-01T00:00:00.000Z"
      }
    ]
  }
}
```

`GET /api/v1/cookbooks/:id` returns status `200` with `data.cookbook`:

```json
{
  "id": "cookbook_1",
  "title": "Weeknights",
  "chef": { "id": "chef_1", "username": "ari" },
  "recipeCount": 1,
  "href": "/cookbooks/cookbook_1",
  "createdAt": "2026-06-01T00:00:00.000Z",
  "updatedAt": "2026-06-01T00:00:00.000Z",
  "recipes": [
    {
      "id": "recipe_1",
      "title": "Pasta",
      "description": "Weeknight pasta",
      "servings": "4",
      "chef": { "id": "chef_1", "username": "ari" },
      "href": "/recipes/recipe_1",
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z"
    }
  ]
}
```

Cookbook detail excludes deleted recipes from `recipes` and `recipeCount`.

## Personal Token Metadata

Credential metadata shape:

```json
{
  "id": "cred_1",
  "name": "Tiny client",
  "tokenPrefix": "sj_abc123456",
  "scopes": ["public:read", "recipes:read"],
  "createdAt": "2026-06-01T00:00:00.000Z",
  "updatedAt": "2026-06-01T00:00:00.000Z",
  "lastUsedAt": null,
  "revokedAt": null,
  "expiresAt": null
}
```

`GET /api/v1/tokens`

- Session callers are allowed.
- Bearer callers require `tokens:read` or legacy `kitchen:read`.
- Response status `200`: `data: { "tokens": [credentialMetadata] }`.

`POST /api/v1/tokens`

- Body: `{ "name": "Tiny client", "scopes": ["recipes:read", "shopping_list:read"] }`
- `scopes` is optional; omitted uses default personal API token scopes.
- Session callers are allowed.
- Bearer callers require `tokens:write` or legacy `kitchen:write`.
- Session callers may create tokens with any valid first-slice scope except legacy `kitchen:*` unless those legacy scopes are explicitly provided for compatibility tests.
- Bearer callers may create only tokens whose requested scopes are a subset of the caller's expanded fine-grained scopes. Omitted `scopes` for bearer callers defaults to the caller's expanded fine-grained scopes, excluding `offline_access`.
- Bearer token creation with requested scopes outside the caller's expanded scope set returns `403 insufficient_scope`.
- Response status `201`: `data: { "token": "sj_secret", "credential": credentialMetadata }`.
- The `token` field is the only time the secret is returned.

`DELETE /api/v1/tokens/:credentialId`

- Session callers are allowed.
- Bearer callers require `tokens:write` or legacy `kitchen:write`.
- Response status `200`: `data: { "revoked": true, "credential": credentialMetadata }`.
- Self-revoke is allowed. The current request succeeds and the token is invalid for subsequent requests.

## Shopping List Read And Sync

Shopping item shape:

```json
{
  "id": "item_1",
  "name": "eggs",
  "quantity": 12,
  "unit": "each",
  "checked": false,
  "checkedAt": null,
  "deletedAt": null,
  "categoryKey": null,
  "iconKey": null,
  "sortIndex": 0,
  "updatedAt": "2026-06-01T00:00:00.000Z"
}
```

`GET /api/v1/shopping-list`

- Authenticated only.
- Bearer callers require `shopping_list:read` or legacy `kitchen:read`.
- Response status `200`: `data: { "shoppingList": { "id": "...", "chef": { "id": "...", "username": "..." }, "items": [activeShoppingItem], "updatedAt": "..." }, "nextCursor": "..." }`.
- `items` excludes tombstones where `deletedAt` is non-null.
- `nextCursor` is the greatest returned item `updatedAt`, or the list `updatedAt` if there are no items.

`GET /api/v1/shopping-list/sync?cursor=2026-06-01T00:00:00.000Z`

- Authenticated only.
- Bearer callers require `shopping_list:read` or legacy `kitchen:read`.
- `cursor` is optional ISO datetime. Invalid cursors return `400 invalid_cursor`.
- Response status `200`: `data: { "items": [shoppingItemIncludingTombstones], "nextCursor": "...", "hasMore": false }`.
- No cursor returns all rows for the caller's shopping list, including tombstones.
- With a cursor, returns rows with `updatedAt > cursor`, ordered by `updatedAt ASC`.
- `hasMore` is always `false` in the first slice because pagination is not split across pages yet.

## Shopping List Mutations

All mutation bodies include nonblank `clientMutationId`. Missing or blank values return `400 validation_error`.

`POST /api/v1/shopping-list/items`

Request body:

```json
{
  "clientMutationId": "device-uuid-1",
  "name": "Eggs",
  "quantity": 12,
  "unit": "Each",
  "categoryKey": null,
  "iconKey": null
}
```

Response status:

- `201` when a new row is created.
- `200` when an existing matching row is restored or merged.

Response data:

```json
{
  "created": true,
  "updated": false,
  "item": { "id": "item_1", "name": "eggs", "quantity": 12, "unit": "each", "checked": false, "checkedAt": null, "deletedAt": null, "categoryKey": null, "iconKey": null, "sortIndex": 0, "updatedAt": "2026-06-01T00:00:00.000Z" },
  "shoppingList": { "id": "list_1", "chef": { "id": "chef_1", "username": "ari" }, "items": [{ "id": "item_1", "name": "eggs", "quantity": 12, "unit": "each", "checked": false, "checkedAt": null, "deletedAt": null, "categoryKey": null, "iconKey": null, "sortIndex": 0, "updatedAt": "2026-06-01T00:00:00.000Z" }], "updatedAt": "2026-06-01T00:00:00.000Z" },
  "mutation": { "clientMutationId": "device-uuid-1", "replayed": false }
}
```

`item` is the full shopping item shape. `shoppingList` is the same object shape returned by `GET /api/v1/shopping-list` and contains the full current active list after the mutation.

`PATCH /api/v1/shopping-list/items/:itemId`

Request body:

```json
{ "clientMutationId": "device-uuid-2", "checked": true }
```

Response status `200`; response data:

```json
{
  "item": { "id": "item_1", "name": "eggs", "quantity": 12, "unit": "each", "checked": true, "checkedAt": "2026-06-01T00:00:00.000Z", "deletedAt": null, "categoryKey": null, "iconKey": null, "sortIndex": 1, "updatedAt": "2026-06-01T00:00:00.000Z" },
  "shoppingList": { "id": "list_1", "chef": { "id": "chef_1", "username": "ari" }, "items": [{ "id": "item_1", "name": "eggs", "quantity": 12, "unit": "each", "checked": true, "checkedAt": "2026-06-01T00:00:00.000Z", "deletedAt": null, "categoryKey": null, "iconKey": null, "sortIndex": 1, "updatedAt": "2026-06-01T00:00:00.000Z" }], "updatedAt": "2026-06-01T00:00:00.000Z" },
  "mutation": { "clientMutationId": "device-uuid-2", "replayed": false }
}
```

`item` is the full shopping item shape. `shoppingList` is the same object shape returned by `GET /api/v1/shopping-list` and contains the full current active list after the mutation.

`DELETE /api/v1/shopping-list/items/:itemId`

Request body:

```json
{ "clientMutationId": "device-uuid-3" }
```

Response status `200`; response data:

```json
{
  "removed": true,
  "item": { "id": "item_1", "name": "eggs", "quantity": 12, "unit": "each", "checked": true, "checkedAt": "2026-06-01T00:00:00.000Z", "deletedAt": "2026-06-01T00:00:00.000Z", "categoryKey": null, "iconKey": null, "sortIndex": 1, "updatedAt": "2026-06-01T00:00:00.000Z" },
  "shoppingList": { "id": "list_1", "chef": { "id": "chef_1", "username": "ari" }, "items": [], "updatedAt": "2026-06-01T00:00:00.000Z" },
  "mutation": { "clientMutationId": "device-uuid-3", "replayed": false }
}
```

`item` is the full shopping item shape, including its tombstone `deletedAt`. `shoppingList` is the same object shape returned by `GET /api/v1/shopping-list` and contains the full current active list after the mutation, so the deleted item is absent from `shoppingList.items`.

Conflict semantics:

- Server write order wins for checked/delete state.
- DELETE after PATCH sets `deletedAt` and removes the item from active list responses.
- PATCH after DELETE clears `deletedAt`, sets `checked` from the request body, and returns the item to active list responses.
- Client-provided timestamps are ignored in this slice.
- Unknown item ids return `404 not_found`.

Idempotent replay changes the response envelope `requestId` to the current request id and changes `mutation.replayed` from `false` to `true`; the stored status and all other data fields are the original response.

## OpenAPI

`GET /api/v1/openapi.json` returns status `200` and an OpenAPI `3.1.0` document.

Required top-level fields:

- `openapi: "3.1.0"`
- `info.title: "Spoonjoy API"`
- `info.version: "v1"`
- `servers[0].url: "https://spoonjoy.app"`
- `paths` entry for every first-slice v1 route
- `components.securitySchemes.bearerAuth`
- reusable envelope/error schemas
- operation examples matching this artifact
- operation `x-scopes` arrays matching the scope matrix

Schema exactness rules:

- Use OpenAPI 3.1 JSON Schema dialect.
- Every object schema uses `additionalProperties: false` except `ErrorDetails`, which uses `additionalProperties: true`.
- Nullable fields use type arrays, for example `{ "type": ["string", "null"] }`.
- Datetimes are `{ "type": "string", "format": "date-time" }`.
- IDs are `{ "type": "string", "minLength": 1 }`.
- `limit` query parameter is `{ "type": "integer", "minimum": 1, "maximum": 50, "default": 20 }`.
- `query`, `q`, and `cursor` query parameters are optional strings.
- Path parameters `id`, `itemId`, and `credentialId` are required nonblank strings.
- Unknown request body fields are rejected by schema and route validation.
- Every route documents the exact non-2xx status codes in the status matrix below; every error response uses `ErrorEnvelope`.
- Every success envelope schema has required fields `ok`, `requestId`, and `data`, with `ok` const `true`.
- Every error envelope schema has required fields `ok`, `requestId`, and `error`, with `ok` const `false`.

Reusable schema required fields:

- `ChefSummary`: `id`, `username`; no nullable fields.
- `RecipeSummary`: `id`, `title`, `description`, `servings`, `chef`, `href`, `createdAt`, `updatedAt`; `description` and `servings` nullable strings.
- `RecipeIngredient`: `id`, `name`, `quantity`, `unit`; `unit` nullable string, `quantity` number.
- `RecipeStep`: `id`, `stepNum`, `stepTitle`, `description`, `duration`, `ingredients`; `stepNum` integer, `stepTitle` nullable string, `duration` nullable integer, `ingredients` array of `RecipeIngredient`.
- `RecipeDetail`: all `RecipeSummary` fields plus `steps` and `cookbooks`; `steps` array of `RecipeStep`; `cookbooks` array of `CookbookLink`.
- `CookbookLink`: `id`, `title`, `href`; no nullable fields.
- `CookbookSummary`: `id`, `title`, `chef`, `recipeCount`, `href`, `createdAt`, `updatedAt`; `recipeCount` integer.
- `CookbookDetail`: all `CookbookSummary` fields plus `recipes`; `recipes` array of `RecipeSummary`.
- `CredentialMetadata`: `id`, `name`, `tokenPrefix`, `scopes`, `createdAt`, `updatedAt`, `lastUsedAt`, `revokedAt`, `expiresAt`; `scopes` array of strings; date metadata fields except `createdAt` and `updatedAt` are nullable date-time strings.
- `ShoppingItem`: `id`, `name`, `quantity`, `unit`, `checked`, `checkedAt`, `deletedAt`, `categoryKey`, `iconKey`, `sortIndex`, `updatedAt`; `quantity` nullable number; `unit`, `checkedAt`, `deletedAt`, `categoryKey`, and `iconKey` nullable; `checked` boolean; `sortIndex` integer.
- `ShoppingList`: `id`, `chef`, `items`, `updatedAt`; `chef` is `ChefSummary`; `items` array of active `ShoppingItem` objects.
- `MutationMetadata`: `clientMutationId`, `replayed`; `clientMutationId` nonblank string; `replayed` boolean.
- `ErrorObject`: `code`, `message`, `status`, optional `details`; `code` enum is the error code map above; `status` integer.

Request body schemas:

- `CreateTokenRequest`: required `name`; optional `scopes`; `name` nonblank string; `scopes` is either string or array of strings.
- `CreateShoppingItemRequest`: required `clientMutationId` and `name`; optional `quantity`, `unit`, `categoryKey`, `iconKey`; `clientMutationId` and `name` nonblank strings; `quantity` number greater than 0; optional string fields allow null.
- `CheckShoppingItemRequest`: required `clientMutationId` and `checked`; `clientMutationId` nonblank string; `checked` boolean.
- `DeleteShoppingItemRequest`: required `clientMutationId`; `clientMutationId` nonblank string.

Success data schemas by operation:

- `GET /api/v1`: `DiscoveryData`
- `GET /api/v1/health`: `HealthData`
- `GET /api/v1/recipes`: required `query`, `limit`, `recipes`; `query` nullable string; `limit` integer; `recipes` array of `RecipeSummary`.
- `GET /api/v1/recipes/{id}`: required `recipe`; `recipe` is `RecipeDetail`.
- `GET /api/v1/cookbooks`: required `query`, `limit`, `cookbooks`; `query` nullable string; `limit` integer; `cookbooks` array of `CookbookSummary`.
- `GET /api/v1/cookbooks/{id}`: required `cookbook`; `cookbook` is `CookbookDetail`.
- `GET /api/v1/tokens`: required `tokens`; `tokens` array of `CredentialMetadata`.
- `POST /api/v1/tokens`: required `token`, `credential`; `token` string; `credential` is `CredentialMetadata`.
- `DELETE /api/v1/tokens/{credentialId}`: required `revoked`, `credential`; `revoked` boolean; `credential` is `CredentialMetadata`.
- `GET /api/v1/shopping-list`: required `shoppingList`, `nextCursor`; `shoppingList` is `ShoppingList`; `nextCursor` date-time string.
- `GET /api/v1/shopping-list/sync`: required `items`, `nextCursor`, `hasMore`; `items` array of `ShoppingItem`, including tombstones; `nextCursor` date-time string; `hasMore` const `false`.
- `POST /api/v1/shopping-list/items`: required `created`, `updated`, `item`, `shoppingList`, `mutation`; `created` and `updated` booleans; `item` is `ShoppingItem`; `shoppingList` is `ShoppingList`; `mutation` is `MutationMetadata`.
- `PATCH /api/v1/shopping-list/items/{itemId}`: required `item`, `shoppingList`, `mutation`; `item` is `ShoppingItem`; `shoppingList` is `ShoppingList`; `mutation` is `MutationMetadata`.
- `DELETE /api/v1/shopping-list/items/{itemId}`: required `removed`, `item`, `shoppingList`, `mutation`; `removed` boolean; `item` is `ShoppingItem`; `shoppingList` is `ShoppingList`; `mutation` is `MutationMetadata`.

OpenAPI response status matrix:

- All routes: `429 rate_limited`, `500 internal_error`.
- All routes except `OPTIONS`: `405 method_not_allowed` for unsupported methods on the route path.
- `GET /api/v1`: `200`, `429`, `500`.
- `GET /api/v1/health`: `200`, `401 invalid_token`, `429`, `500`. Health has no `403` because it has no required scope.
- `GET /api/v1/openapi.json`: `200`, `401 invalid_token`, `429`, `500`. OpenAPI has no `403` because it has no required scope.
- `GET /api/v1/recipes`: `200`, `400 validation_error`, `401 invalid_token`, `403 insufficient_scope`, `429`, `500`.
- `GET /api/v1/recipes/{id}`: `200`, `401 invalid_token`, `403 insufficient_scope`, `404 not_found`, `429`, `500`.
- `GET /api/v1/cookbooks`: `200`, `400 validation_error`, `401 invalid_token`, `403 insufficient_scope`, `429`, `500`.
- `GET /api/v1/cookbooks/{id}`: `200`, `401 invalid_token`, `403 insufficient_scope`, `404 not_found`, `429`, `500`.
- `GET /api/v1/tokens`: `200`, `401 authentication_required`, `401 invalid_token`, `403 insufficient_scope`, `429`, `500`.
- `POST /api/v1/tokens`: `201`, `400 invalid_json`, `400 validation_error`, `400 invalid_scope`, `401 authentication_required`, `401 invalid_token`, `403 insufficient_scope`, `429`, `500`.
- `DELETE /api/v1/tokens/{credentialId}`: `200`, `401 authentication_required`, `401 invalid_token`, `403 insufficient_scope`, `404 not_found`, `429`, `500`.
- `GET /api/v1/shopping-list`: `200`, `401 authentication_required`, `401 invalid_token`, `403 insufficient_scope`, `429`, `500`.
- `GET /api/v1/shopping-list/sync`: `200`, `400 invalid_cursor`, `401 authentication_required`, `401 invalid_token`, `403 insufficient_scope`, `429`, `500`.
- `POST /api/v1/shopping-list/items`: `200`, `201`, `400 invalid_json`, `400 validation_error`, `401 authentication_required`, `401 invalid_token`, `403 insufficient_scope`, `409 idempotency_conflict`, `429`, `500`.
- `PATCH /api/v1/shopping-list/items/{itemId}`: `200`, `400 invalid_json`, `400 validation_error`, `401 authentication_required`, `401 invalid_token`, `403 insufficient_scope`, `404 not_found`, `409 idempotency_conflict`, `429`, `500`.
- `DELETE /api/v1/shopping-list/items/{itemId}`: `200`, `400 invalid_json`, `400 validation_error`, `401 authentication_required`, `401 invalid_token`, `403 insufficient_scope`, `404 not_found`, `409 idempotency_conflict`, `429`, `500`.
- `OPTIONS /api/v1/*`: `204`.

## Live Smoke Status Codes

After deploy, these checks must pass:

- `GET https://spoonjoy.app/developers` -> 200 HTML containing `Spoonjoy Developer Platform`
- `GET https://spoonjoy.app/api/v1` -> 200 JSON with `ok: true`, `data.version: "v1"`, and `data.openapiUrl: "/api/v1/openapi.json"`
- `GET https://spoonjoy.app/api/v1/health` -> 200 JSON with `ok: true`, `data.ok: true`
- `GET https://spoonjoy.app/api/v1/openapi.json` -> 200 JSON with `openapi: "3.1.0"`
- `GET https://spoonjoy.app/api/v1/recipes` -> 200 JSON with `ok: true` and `data.recipes` array
- `GET https://spoonjoy.app/api/v1/cookbooks` -> 200 JSON with `ok: true` and `data.cookbooks` array
- `GET https://spoonjoy.app/api/v1/shopping-list` without credentials -> 401 JSON with `ok: false`, `error.code: "authentication_required"`, and `X-Request-Id`
- `GET https://spoonjoy.app/api/v1/shopping-list/sync` without credentials -> 401 JSON with `ok: false`, `error.code: "authentication_required"`, and `X-Request-Id`
- `POST https://spoonjoy.app/api/v1/shopping-list/items` without credentials and with JSON body `{ "clientMutationId": "live-smoke", "name": "eggs" }` -> 401 JSON with `ok: false`, `error.code: "authentication_required"`, and `X-Request-Id`
- `GET https://spoonjoy.app/api/v1/tokens` without credentials -> 401 JSON with `ok: false`, `error.code: "authentication_required"`, and `X-Request-Id`
