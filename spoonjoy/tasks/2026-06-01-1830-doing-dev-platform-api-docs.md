# Doing: Spoonjoy Developer Platform API And Docs

**Status**: READY_FOR_EXECUTION
**Execution Mode**: direct
**Created**: 2026-06-01 18:41
**Planning**: ./2026-06-01-1830-planning-dev-platform-api-docs.md
**Artifacts**: ./2026-06-01-1830-doing-dev-platform-api-docs/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (interactive)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Expose Spoonjoy as a developer-friendly platform layer on top of the existing public-by-default Chef graph, so external clients can safely read, mutate, sync, and document Spoonjoy data through stable contracts. Deliver a deployed API documentation surface that can be sent to an external developer, while keeping MCP, REST, OAuth, API tokens, and future client profiles aligned through one source of truth.

## Upstream Work Items
- None

## Completion Criteria
- [ ] Public developer docs are deployed and reachable at `https://spoonjoy.app/developers`.
- [ ] A versioned `/api/v1` contract exists for discovery/health, OpenAPI/spec, public recipe search/detail, public cookbook search/detail, authenticated shopping-list read/sync/item mutations, and authenticated personal API token list/create/revoke metadata; ordinary first-slice workflows do not require raw `/api/tools/:operation`.
- [ ] Machine-readable API reference exists for the supported developer surface, with request schemas, response schemas, examples, errors, auth requirements, and scope requirements.
- [ ] Docs clearly explain public-by-default Chef graph semantics and authenticated/private or mutating surfaces.
- [ ] Auth docs and implementation distinguish personal API tokens, OAuth/PKCE apps, MCP clients, and delegated/device-style authorization.
- [ ] Existing OAuth/API/MCP docs drift is resolved, including refresh-token behavior and any mismatch between REST coverage and operation-layer coverage.
- [ ] Fine-grained scopes `public:read`, `recipes:read`, `shopping_list:read`, `shopping_list:write`, `cookbooks:read`, `tokens:read`, `tokens:write`, and `offline_access` are represented in docs, stored on API credentials, backward-compatible with existing `kitchen:read` / `kitchen:write` grants, and enforced for the supported v1 surface.
- [ ] The supported `/api/v1` surface follows the explicit per-endpoint scope matrix from the planning doc, including anonymous access for public recipe/cookbook reads and authenticated-only access for shopping-list and token surfaces.
- [ ] Integration-safety primitives are implemented and documented for the proving slice: idempotent shopping-list add/check/remove mutations, machine-readable errors, request IDs, rate-limit guidance, shopping-list cursor/sync behavior, shopping-list item tombstones, and documented last-writer-wins semantics for shopping-list checked/delete state.
- [ ] At least one sample or guide demonstrates an external client using the docs to authenticate and operate against Spoonjoy.
- [ ] The implemented docs/spec do not drift from REST/MCP operation metadata for the supported surface.
- [ ] Deployed verification proves the docs URL and relevant API endpoints work after deployment.
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

Normative contract artifact: `./2026-06-01-1830-doing-dev-platform-api-docs/api-v1-contract.md`. Every unit that asserts v1 request fields, response fields, error codes, scope behavior, idempotency storage, docs/reference ownership, or live-smoke response shapes uses that artifact as the exact contract.

### ✅ Unit 0: Setup/Research
**What**: Confirm branch/task-doc state, verify route/deploy/test patterns, and capture the implementation baseline for API, OAuth, token, shopping-list, docs, and deployment work.
**Output**: Notes/logs in `./2026-06-01-1830-doing-dev-platform-api-docs/` with current branch, current route files, relevant test commands, deployment command choice, and confirmation that `api-v1-contract.md` is the exact v1 contract source for execution.
**Acceptance**: Artifacts exist; `api-v1-contract.md` is present; no code behavior changed; doing doc remains accurate after source inspection.

### ✅ Unit 1a: API Credential Scopes — Tests
**What**: Write failing tests for the credential-scope storage and parsing contract in `prisma/schema.prisma`, `migrations/0015_api_credential_scopes.sql`, `app/lib/api-auth.server.ts`, `app/lib/agent-connection.server.ts`, `app/lib/oauth-server.server.ts`, `test/setup.ts`, and `test/helpers/cleanup.ts`, using the exact scope/default/legacy expansion rules from `api-v1-contract.md`.
**Output**: `test/scripts/migration-0015-api-credential-scopes.test.ts` asserts the root migration adds `ApiCredential.scopes` as required text with database default `'kitchen:read kitchen:write'`; `test/lib/api-auth.server.test.ts` asserts default personal token scopes, scoped credential creation, principal scope exposure, empty stored scope string expands to no scopes, unknown-scope rejection, legacy expansion, and cleanup behavior; existing agent/OAuth tests assert delegated and connector tokens preserve requested legacy scopes instead of receiving personal-token defaults.
**Acceptance**: Focused tests FAIL because `ApiCredential.scopes`, scope normalization, legacy scope expansion, scoped credential creation, and principal scope exposure are absent.

### ✅ Unit 1b: API Credential Scopes — Implementation
**What**: Add `ApiCredential.scopes` to `prisma/schema.prisma` and `migrations/0015_api_credential_scopes.sql`; update `app/lib/api-auth.server.ts` so credentials store normalized scopes and authenticated principals expose expanded scopes; update `app/lib/agent-connection.server.ts` and `app/lib/oauth-server.server.ts` to pass delegated/OAuth scopes explicitly to `createApiCredential`.
**Output**: Updated schema, root migration, updated cleanup hooks in `test/setup.ts` and `test/helpers/cleanup.ts`, no tracked Prisma client artifacts, `pnpm prisma:generate` log saved to artifacts, `pnpm prisma:push` log saved to artifacts, and passing Unit 1a tests.
**Acceptance**: Unit 1a tests PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 1c: API Credential Scopes — Coverage & Refactor
**What**: Verify coverage for new credential-scope branches: omitted scopes, duplicate scopes, legacy `kitchen:read`, legacy `kitchen:write`, mixed legacy/fine-grained scopes, expired token with scopes, revoked token with scopes, and invalid scope input.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-1c-coverage.log`; any refactor stays in `app/lib/api-auth.server.ts` and related tests.
**Acceptance**: 100% coverage on new/changed API credential scope code; focused tests and build still PASS with no warnings.

### ✅ Unit 2a: API Idempotency Storage — Tests
**What**: Write failing tests for persistent idempotency-key storage in `prisma/schema.prisma`, `migrations/0016_api_idempotency_keys.sql`, and cleanup hooks, using the exact column names, nullable behavior, unique tuple, and index list from `api-v1-contract.md`.
**Output**: `test/scripts/migration-0016-api-idempotency-keys.test.ts` asserts the `ApiIdempotencyKey` table with `userId`, nullable `credentialId`, `clientKey`, `key`, `operation`, `requestHash`, nullable `responseStatus`, nullable `responseBody`, `expiresAt`, timestamps, unique `(userId, clientKey, key)`, and indexes on `(userId, createdAt)`, `credentialId`, and `expiresAt`; `test/lib/api-idempotency.server.test.ts` asserts missing helper exports.
**Acceptance**: Focused tests FAIL because `ApiIdempotencyKey` and `app/lib/api-idempotency.server.ts` do not exist.

### ✅ Unit 2b: API Idempotency Storage — Implementation
**What**: Add `ApiIdempotencyKey` to `prisma/schema.prisma` and `migrations/0016_api_idempotency_keys.sql`; create `app/lib/api-idempotency.server.ts` with helpers to reserve, replay, complete, and reject mismatched idempotency keys.
**Output**: Updated schema, root migration, updated cleanup hooks, no tracked Prisma client artifacts, `pnpm prisma:generate` log saved to artifacts, `pnpm prisma:push` log saved to artifacts, new idempotency helper, and passing Unit 2a tests.
**Acceptance**: Unit 2a tests PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 2c: API Idempotency Storage — Coverage & Refactor
**What**: Verify coverage for idempotency helper branches: first use, exact replay, mismatched operation, mismatched request body hash, failed stored response replay, missing credential id, revoked credential after stored replay, expired row deletion, and key reuse after expiry.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-2c-coverage.log`; any refactor stays in `app/lib/api-idempotency.server.ts` and tests.
**Acceptance**: 100% coverage on new/changed idempotency storage code; focused tests and build still PASS with no warnings.

### ✅ Unit 3a: `/api/v1` Shell, Errors, And Request IDs — Tests
**What**: Write failing tests for route registration and shared v1 response behavior in `app/routes.ts`, `app/routes/api.v1.$.ts`, `app/lib/api-v1.server.ts`, and the future `app/lib/api-v1-contract.server.ts`.
**Output**: `test/routes/api-v1-shell.test.ts` asserts the exact discovery document, health document, optional-auth behavior with no required scope for root/health/openapi, invalid bearer returning `401 invalid_token` for root/health/openapi, success envelope, error envelope, error code map, `OPTIONS /api/v1/*` status, unknown endpoints, malformed JSON, request ID generation/echo, and CORS headers from `api-v1-contract.md`; `test/build-output-hygiene.test.ts` or a new focused config test asserts `vitest.config.ts` coverage includes `app/routes/**/*.ts`.
**Acceptance**: Focused tests FAIL because `app/routes/api.v1.$.ts` and the v1 shell helpers are absent.

### ✅ Unit 3b: `/api/v1` Shell, Errors, And Request IDs — Implementation
**What**: Register `route("api/v1/*", "routes/api.v1.$.ts")`; create `app/routes/api.v1.$.ts`, `app/lib/api-v1.server.ts`, and `app/lib/api-v1-contract.server.ts` with discovery, health, OPTIONS, request IDs, CORS, JSON body parsing, and error-envelope helpers; update `vitest.config.ts` so coverage includes new `.ts` route files.
**Output**: Updated `app/routes.ts`, `vitest.config.ts`, new v1 route/helper/contract files, and passing Unit 3a tests.
**Acceptance**: Unit 3a tests PASS; legacy `/api/*` tests still PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 3c: `/api/v1` Shell, Errors, And Request IDs — Coverage & Refactor
**What**: Verify coverage for v1 shell branches: anonymous request, bearer request with invalid token, OPTIONS preflight, missing route path, JSON parse failure, thrown non-Error value, and request ID fallback.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-3c-coverage.log`; refactors stay inside the v1 shell files and tests.
**Acceptance**: 100% coverage on new/changed v1 shell code; focused tests and build still PASS with no warnings.

### ✅ Unit 4a: Public Recipe V1 Reads — Tests
**What**: Write failing tests for anonymous and scoped public recipe endpoints `GET /api/v1/recipes` and `GET /api/v1/recipes/:id`.
**Output**: `test/routes/api-v1-recipes.test.ts` asserts the exact query params, `limit` behavior, summary/detail fields, deleted recipe exclusion, missing recipe 404 envelope, anonymous success, `recipes:read` bearer success, and scoped bearer failure without `recipes:read` from `api-v1-contract.md`.
**Acceptance**: Focused tests FAIL because recipe reads are not implemented under `/api/v1`.

### ✅ Unit 4b: Public Recipe V1 Reads — Implementation
**What**: Implement `GET /api/v1/recipes` and `GET /api/v1/recipes/:id` in the v1 route/helper layer using existing recipe/search data access in `app/lib/spoonjoy-api.server.ts` and `app/lib/search.server.ts` without changing legacy `/api/recipes` behavior.
**Output**: Updated v1 route/helper files and passing Unit 4a tests.
**Acceptance**: Unit 4a tests PASS; legacy recipe API tests still PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 4c: Public Recipe V1 Reads — Coverage & Refactor
**What**: Verify coverage for recipe-read branches: blank query, `limit` boundary, malformed `limit`, deleted recipe, missing id, anonymous request with no Authorization header, and bearer token with insufficient scope.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-4c-coverage.log`; refactors stay in v1 recipe helpers and tests.
**Acceptance**: 100% coverage on new/changed recipe v1 code; focused tests and build still PASS with no warnings.

### ✅ Unit 5a: Public Cookbook V1 Reads — Tests
**What**: Write failing tests for anonymous and scoped public cookbook endpoints `GET /api/v1/cookbooks` and `GET /api/v1/cookbooks/:id`.
**Output**: `test/routes/api-v1-cookbooks.test.ts` asserts the exact query params, `limit` behavior, summary/detail fields, active recipe counts, deleted recipe exclusion, missing cookbook 404 envelope, anonymous success, `cookbooks:read` bearer success, and scoped bearer failure without `cookbooks:read` from `api-v1-contract.md`.
**Acceptance**: Focused tests FAIL because cookbook reads are not implemented under `/api/v1`.

### ✅ Unit 5b: Public Cookbook V1 Reads — Implementation
**What**: Implement `GET /api/v1/cookbooks` and `GET /api/v1/cookbooks/:id` in the v1 route/helper layer using new public cookbook data access in `app/lib/api-v1.server.ts` plus search primitives from `app/lib/search.server.ts`; do not reuse legacy `list_cookbooks` / `get_cookbook` operations from `app/lib/spoonjoy-api.server.ts` because they are owner-scoped.
**Output**: Updated v1 route/helper files and passing Unit 5a tests.
**Acceptance**: Unit 5a tests PASS; legacy cookbook API tests still PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 5c: Public Cookbook V1 Reads — Coverage & Refactor
**What**: Verify coverage for cookbook-read branches: blank query, `limit` boundary, malformed `limit`, cookbook with zero active recipes, missing id, anonymous request with no Authorization header, and bearer token with insufficient scope.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-5c-coverage.log`; refactors stay in v1 cookbook helpers and tests.
**Acceptance**: 100% coverage on new/changed cookbook v1 code; focused tests and build still PASS with no warnings.

### ✅ Unit 6a: Personal API Token V1 Metadata — Tests
**What**: Write failing tests for authenticated personal API token metadata endpoints `GET /api/v1/tokens`, `POST /api/v1/tokens`, and `DELETE /api/v1/tokens/:credentialId`.
**Output**: `test/routes/api-v1-tokens.test.ts` asserts the exact credential metadata fields, `token` one-time secret field, requested scope normalization, default personal token scopes, bearer-created token scopes capped to the caller's expanded fine-grained scopes, bearer scope escalation returning `403 insufficient_scope`, unknown request body fields rejected with `400 validation_error`, revoke response fields, self-revoke succeeds for the current request and fails on later requests, missing auth 401, invalid JSON 400, and `tokens:read` / `tokens:write` enforcement from `api-v1-contract.md`.
**Acceptance**: Focused tests FAIL because token metadata endpoints are not implemented under `/api/v1`.

### ✅ Unit 6b: Personal API Token V1 Metadata — Implementation
**What**: Implement the three token metadata endpoints in the v1 route/helper layer using `createApiCredential` for creation and direct `db.apiCredential.findMany` / `findFirst` / `update` logic for list and revoke behavior; do not treat the `revoke_api_token` operation name in `app/lib/spoonjoy-api.server.ts` as an exported helper.
**Output**: Updated v1 route/helper files, token response formatting implemented in `app/lib/api-v1.server.ts`, and passing Unit 6a tests.
**Acceptance**: Unit 6a tests PASS; legacy `/api/tokens` tests still PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 6c: Personal API Token V1 Metadata — Coverage & Refactor
**What**: Verify coverage for token endpoint branches: no bearer token, invalid bearer token, revoked bearer token, missing scope, duplicate token name, blank token name, invalid requested scope, revoke missing credential id, and revoke credential owned by another chef.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-6c-coverage.log`; refactors stay in token helpers and tests.
**Acceptance**: 100% coverage on new/changed token v1 code; focused tests and build still PASS with no warnings.

### ✅ Unit 7a: Public And Token Scope Enforcement — Tests
**What**: Write failing tests for scope enforcement on the `/api/v1` endpoints implemented through Unit 6.
**Output**: `test/routes/api-v1-scopes-public-tokens.test.ts` asserts anonymous access for discovery/health/recipes/cookbooks; authenticated `recipes:read` and `cookbooks:read` success; authenticated public-read bearer failure without the relevant read scope; `tokens:read` and `tokens:write` enforcement for token metadata; legacy `kitchen:read` and `kitchen:write` compatibility for public-read and token endpoints; and no scope requirement for authenticated discovery.
**Acceptance**: Focused tests FAIL until v1 routes centralize and enforce the planning-doc scope rows for discovery, recipes, cookbooks, and token metadata.

### ✅ Unit 7b: Public And Token Scope Enforcement — Implementation
**What**: Add a v1 scope-matrix helper in `app/lib/api-v1.server.ts` and route discovery, recipe, cookbook, and token metadata endpoints through it before operation dispatch or database access.
**Output**: Updated v1 helper/route files and passing Unit 7a tests.
**Acceptance**: Unit 7a tests PASS; previously completed v1 route tests still PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 7c: Public And Token Scope Enforcement — Coverage & Refactor
**What**: Verify coverage for the discovery, recipe, cookbook, and token rows of the scope matrix, including both fine-grained and legacy-compatible scope paths.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-7c-coverage.log`; refactors stay in v1 auth/scope helpers and tests.
**Acceptance**: 100% coverage on new/changed public/token scope enforcement code; focused tests and build still PASS with no warnings.

### ✅ Unit 8a: Shopping-List Read, Sync, And Tombstones — Tests
**What**: Write failing tests for `GET /api/v1/shopping-list` and `GET /api/v1/shopping-list/sync`.
**Output**: `test/routes/api-v1-shopping-sync.test.ts` asserts the exact shopping item shape, list envelope, sync envelope, `nextCursor`, `hasMore: false`, cursor filtering by `updatedAt > cursor`, empty list, deleted-item tombstones from `ShoppingListItem.deletedAt`, invalid cursor error envelope, `shopping_list:read` success, and missing read scope failure from `api-v1-contract.md`.
**Acceptance**: Focused tests FAIL because shopping-list v1 read/sync payloads and tombstones are not implemented.

### ✅ Unit 8b: Shopping-List Read, Sync, And Tombstones — Implementation
**What**: Implement shopping-list list and sync endpoints in the v1 route/helper layer using existing `ShoppingListItem` fields `updatedAt`, `deletedAt`, `checked`, and `checkedAt`.
**Output**: Updated v1 route/helper files and passing Unit 8a tests.
**Acceptance**: Unit 8a tests PASS; legacy shopping-list API tests still PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 8c: Shopping-List Read, Sync, And Tombstones — Coverage & Refactor
**What**: Verify coverage for sync branches: no cursor, valid cursor, future cursor, invalid cursor, deleted-only page, checked item, unchecked item, and empty authenticated list.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-8c-coverage.log`; refactors stay in shopping sync helpers and tests.
**Acceptance**: 100% coverage on new/changed shopping-list read/sync code; focused tests and build still PASS with no warnings.

### ✅ Unit 9a: Idempotent Shopping-List Mutations — Tests
**What**: Write failing tests for `POST /api/v1/shopping-list/items`, `PATCH /api/v1/shopping-list/items/:itemId`, and `DELETE /api/v1/shopping-list/items/:itemId` with `clientMutationId` replay behavior.
**Output**: `test/routes/api-v1-shopping-mutations.test.ts` asserts exact request bodies, status codes, response data fields, add/check/remove success, unknown request body fields rejected with `400 validation_error`, exact replay returns the stored response with only `requestId` and `mutation.replayed` changed, duplicate key with different operation returns 409, duplicate key with different body returns 409, duplicate key with different `itemId` path target returns 409, missing `clientMutationId` returns 400, and `shopping_list:write` enforcement from `api-v1-contract.md`.
**Acceptance**: Focused tests FAIL because idempotent shopping-list mutations are not implemented.

### ✅ Unit 9b: Idempotent Shopping-List Mutations — Implementation
**What**: Implement add/check/remove mutation endpoints using `app/lib/api-idempotency.server.ts` for key reservation/replay and existing shopping-list operation behavior from `app/lib/spoonjoy-api.server.ts`.
**Output**: Updated v1 route/helper files and passing Unit 9a tests.
**Acceptance**: Unit 9a tests PASS; legacy shopping-list mutation tests still PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 9c: Idempotent Shopping-List Mutations — Coverage & Refactor
**What**: Verify coverage for mutation branches: add blank text, add duplicate ingredient text, patch checked true, patch checked false, delete existing item, delete already deleted item, replay with current request ID, replay with revoked token, replay with mismatched body hash, replay conflict for same key with different path `itemId`, and key reuse after idempotency expiry.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-9c-coverage.log`; refactors stay in shopping mutation/idempotency helpers and tests.
**Acceptance**: 100% coverage on new/changed idempotent mutation code; focused tests and build still PASS with no warnings.

### ✅ Unit 10a: Shopping-List Conflict And Error Semantics — Tests
**What**: Write failing tests for documented last-writer-wins checked/delete behavior and machine-readable shopping-list mutation errors.
**Output**: `test/routes/api-v1-shopping-conflicts.test.ts` asserts remove after check, check after remove restores the item and clears `deletedAt`, stale client timestamp ignored in favor of server write order, unknown item 404 envelope, invalid item id 404 envelope, and malformed mutation JSON 400 envelope from `api-v1-contract.md`.
**Acceptance**: Focused tests FAIL until shopping-list v1 mutations have explicit conflict/error semantics.

### ✅ Unit 10b: Shopping-List Conflict And Error Semantics — Implementation
**What**: Make v1 shopping-list mutation helpers consistently apply server-order last-writer-wins for checked/delete state and return stable error codes for missing item, invalid body, and conflict/idempotency mismatch cases.
**Output**: Updated v1 shopping mutation helpers and passing Unit 10a tests.
**Acceptance**: Unit 10a tests PASS; Unit 9 mutation replay tests still PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 10c: Shopping-List Conflict And Error Semantics — Coverage & Refactor
**What**: Verify coverage for all machine-readable shopping-list error codes and last-writer-wins branches.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-10c-coverage.log`; refactors stay in shopping mutation helpers and tests.
**Acceptance**: 100% coverage on new/changed conflict/error code; focused tests and build still PASS with no warnings.

### ✅ Unit 11a: OpenAPI Contract Metadata — Tests
**What**: Write failing tests for OpenAPI generation from supported v1 route metadata.
**Output**: `test/lib/api-v1-openapi.server.test.ts` asserts OpenAPI `3.1.0`, server URL, paths for every first-slice endpoint, request schemas, response schemas, examples, error schemas, auth requirements, and `x-scopes` requirements from `app/lib/api-v1-contract.server.ts`; `test/routes/api-v1-openapi.test.ts` asserts `GET /api/v1/openapi.json` serves the same document.
**Acceptance**: Focused tests FAIL because OpenAPI metadata and endpoint are absent or incomplete.

### ✅ Unit 11b: OpenAPI Contract Metadata — Implementation
**What**: Create `app/lib/api-v1-openapi.server.ts` and connect `GET /api/v1/openapi.json` to it; use the same path/scope metadata constants consumed by the v1 route helper.
**Output**: New OpenAPI helper, updated v1 route/helper files, and passing Unit 11a tests.
**Acceptance**: Unit 11a tests PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 11c: OpenAPI Contract Metadata — Coverage & Refactor
**What**: Verify coverage for schema generation branches: public endpoint, bearer-protected endpoint, write-scope endpoint, path parameter endpoint, query parameter endpoint, and error response generation.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-11c-coverage.log`; refactors keep OpenAPI output stable.
**Acceptance**: 100% coverage on new/changed OpenAPI code; focused tests and build still PASS with no warnings.

### ✅ Unit 12a: Complete V1 Scope Matrix Audit — Tests
**What**: Write failing tests for the exact first-slice scope matrix from the planning doc across every supported `/api/v1` endpoint after shopping-list and OpenAPI endpoints exist.
**Output**: `test/routes/api-v1-scopes.test.ts` asserts anonymous access for `GET /api/v1`, `GET /api/v1/health`, `GET /api/v1/openapi.json`, `GET /api/v1/recipes`, `GET /api/v1/recipes/:id`, `GET /api/v1/cookbooks`, and `GET /api/v1/cookbooks/:id`; authenticated-only access for shopping-list and token endpoints; fine-grained scope requirements for every read/write route; and legacy `kitchen:read` / `kitchen:write` compatibility.
**Acceptance**: Focused tests FAIL until all supported v1 endpoints follow the full planning-doc scope matrix.

### ✅ Unit 12b: Complete V1 Scope Matrix Audit — Implementation
**What**: Update `app/lib/api-v1.server.ts` so the single scope-matrix helper covers every supported v1 endpoint, including OpenAPI and shopping-list read/sync/add/check/remove.
**Output**: Updated v1 scope helper/route files and passing Unit 12a tests.
**Acceptance**: Unit 12a tests PASS; Units 3-11 route tests still PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 12c: Complete V1 Scope Matrix Audit — Coverage & Refactor
**What**: Verify coverage for every scope-matrix row and for both fine-grained and legacy-compatible scope paths.
**Output**: Coverage log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-12c-coverage.log`; refactors stay in v1 auth/scope helpers and tests.
**Acceptance**: 100% coverage on new/changed full scope-matrix code; focused tests and build still PASS with no warnings.

### ✅ Unit 13a: `/developers` Route — Tests
**What**: Write failing tests for the deployed developer-docs page route, route metadata, and route registration.
**Output**: `test/routes/developers.test.tsx` asserts page title/meta, visible `/api/v1` endpoints, auth mode distinctions, public-by-default Chef graph language, scope list, idempotency/sync guidance, rate-limit guidance text, OpenAPI link, OAuth/DCR/MCP route references, and no Pebble-specific framing, with endpoint/scope/example data returned by the route loader from `app/lib/api-v1-contract.server.ts`.
**Acceptance**: Focused tests FAIL because `/developers` is not registered or rendered.

### ✅ Unit 13b: `/developers` Route — Implementation
**What**: Add `route("developers", "routes/developers.tsx")`; implement `app/routes/developers.tsx` using existing page primitives from `app/components/cookbook/page.tsx`; its loader imports server-only reference data from `app/lib/api-v1-contract.server.ts` or `app/lib/api-v1-openapi.server.ts` and returns serializable docs data, while the component imports no `.server.ts` modules.
**Output**: Updated `app/routes.ts`, new developers route, and passing Unit 13a tests.
**Acceptance**: Unit 13a tests PASS; `pnpm run build` succeeds with no warnings.

### ✅ Unit 13c: `/developers` Route — Coverage & Refactor
**What**: Verify route coverage and inspect the rendered page locally for layout/text issues on desktop and mobile widths.
**Output**: Coverage log and local render notes saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-13c-coverage.log` and `./2026-06-01-1830-doing-dev-platform-api-docs/unit-13c-render.log`; branch-coverage cleanup stayed in `app/routes/developers.tsx`.
**Acceptance**: 100% coverage on new/changed developers route code; focused tests and build still PASS with no warnings.

### ⬜ Unit 14a: Existing Docs Drift — Tests
**What**: Write failing docs assertions for `docs/api.md`, `docs/claude-connector.md`, `docs/ouroboros-mcp.md`, `app/lib/oauth-routes.server.ts`, and `app/lib/oauth-server.server.ts`.
**Output**: `test/docs/developer-platform-docs.test.ts` imports `app/lib/api-v1-contract.server.ts` and asserts `docs/api.md` contains the supported endpoint list, scope list, OpenAPI URL, and rate-limit guidance; it also asserts docs and OAuth server comments mention refresh-token rotation, OAuth/DCR routes, MCP `/mcp`, delegated `/api/tools/start_agent_connection` and `/api/tools/poll_agent_connection`, and do not claim remote MCP has no refresh tokens.
**Acceptance**: Focused tests FAIL because existing docs/comment drift remains.

### ⬜ Unit 14b: Existing Docs Drift — Implementation
**What**: Update `docs/api.md`, `docs/claude-connector.md`, `docs/ouroboros-mcp.md`, and the stale refresh-token comments in `app/lib/oauth-routes.server.ts` and `app/lib/oauth-server.server.ts` to match implemented REST/MCP/OAuth behavior and point developers to `/developers`.
**Output**: Updated docs/comment files and passing Unit 14a tests.
**Acceptance**: Unit 14a tests PASS; `pnpm run build` succeeds with no warnings.

### ⬜ Unit 14c: Existing Docs Drift — Coverage & Refactor
**What**: Verify docs assertions cover every drift item from the planning doc and record a no-drift checklist.
**Output**: Verification log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-14c-docs-drift.log`; docs wording changes remain limited to the files named in Unit 14b.
**Acceptance**: Docs-drift tests PASS; no stale no-refresh-token claim remains; build still PASS with no warnings.

### ⬜ Unit 15a: External Client Guide And Sample — Tests
**What**: Write failing docs assertions for a complete external-client guide that reads public recipes/cookbooks, creates a scoped personal token, syncs a private shopping list, and performs an idempotent shopping-list mutation.
**Output**: `test/docs/developer-platform-guide.test.ts` imports `app/lib/api-v1-contract.server.ts` and asserts sample curl commands and prose reference actual implemented paths, required scopes, `Authorization: Bearer`, `clientMutationId`, sync cursor, and OpenAPI URL from the contract module.
**Acceptance**: Focused tests FAIL until the guide/sample is added and aligned with implemented endpoints.

### ⬜ Unit 15b: External Client Guide And Sample — Implementation
**What**: Add the guide/sample to `/developers` and `docs/api.md`, framed for tiny-device, mobile, CLI/script, browser, and agent clients without naming Pebble as the primary target.
**Output**: Updated developer docs route/docs file and passing Unit 15a tests.
**Acceptance**: Unit 15a tests PASS; `pnpm run build` succeeds with no warnings.

### ⬜ Unit 15c: External Client Guide And Sample — Coverage & Refactor
**What**: Verify guide/sample coverage and polish wording for public-by-default Chef graph, private shopping list, scopes, sync, idempotency, and client profile breadth.
**Output**: Coverage/log output saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-15c-guide.log`; no unsupported endpoint claims remain in route or markdown docs.
**Acceptance**: Guide/sample assertions PASS; focused tests and build still PASS with no warnings.

### ⬜ Unit 16a: Full Verification Gate
**What**: Run the full required local verification gate before deployment.
**Output**: Logs saved to artifacts for `pnpm test:coverage`, `pnpm run typecheck` from `package.json`, `pnpm run build`, and a targeted v1/docs test run.
**Acceptance**: All verification commands PASS with no warnings.

### ⬜ Unit 17a: Production Deploy
**What**: Deploy to production using `pnpm run deploy:auto`.
**Output**: Deploy log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-17a-deploy.log`.
**Acceptance**: Production deploy succeeds with no warnings requiring code changes.

### ⬜ Unit 17b: Live API Docs Verification
**What**: Live-smoke production endpoints after deploy.
**Output**: Live verification log saved to `./2026-06-01-1830-doing-dev-platform-api-docs/unit-17b-live-smoke.log` covering `https://spoonjoy.app/developers`, `https://spoonjoy.app/api/v1`, `https://spoonjoy.app/api/v1/health`, `https://spoonjoy.app/api/v1/openapi.json`, `https://spoonjoy.app/api/v1/recipes`, `https://spoonjoy.app/api/v1/cookbooks`, unauthenticated `GET /api/v1/shopping-list`, unauthenticated `GET /api/v1/shopping-list/sync`, unauthenticated `POST /api/v1/shopping-list/items`, and unauthenticated `GET /api/v1/tokens`.
**Acceptance**: Deployed docs URL and v1 API endpoints return the exact status codes and response shapes listed in `api-v1-contract.md`.

### ⬜ Unit 18a: Final Documentation Sync And Completion
**What**: Mark completion criteria in doing/planning docs based on evidence, send the repo-required Slugger completion message, and prepare the final user-facing docs link.
**Output**: Updated task docs, final verification summary in artifacts, and `ouro msg --to slugger "Done: ..."` notification.
**Acceptance**: Doing doc status is `done`, planning criteria are synced, all commits are atomic, branch is pushed if a remote is configured, and the final response can give the deployed developer docs URL.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each unit phase (`Xa`, `Xb`, `Xc`) or single-step unit (`16a`, `17a`, `17b`, `18a`)
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-01-1830-doing-dev-platform-api-docs/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-01 18:41 Created from planning doc
- 2026-06-01 18:47 Addressed granularity reviewer findings by splitting schema, route, docs, verification, deploy, and completion work into smaller TDD units
- 2026-06-01 18:51 Addressed granularity Round 2 ordering finding by splitting early public/token scope enforcement from the final full scope-matrix audit
- 2026-06-01 18:52 Granularity reviewer converged after ordering fix
- 2026-06-01 18:54 Validation reviewer converged: cited current paths and source claims match HEAD
- 2026-06-01 19:00 Added exact v1 contract artifact and wired ambiguous unit assertions to it
- 2026-06-01 19:02 Closed remaining ambiguity findings by enumerating discovery resources and full shopping-list mutation item shapes
- 2026-06-01 19:04 Specified OpenAPI schema rules, required fields, nullable handling, and mutation list-content semantics
- 2026-06-01 19:05 Added exact OpenAPI per-route response status matrix
- 2026-06-01 19:06 Ambiguity reviewer converged after exact v1 contract and status-matrix fixes
- 2026-06-01 19:08 Quality reviewer converged: unit structure, TDD ordering, and contract artifact passed
- 2026-06-01 19:13 Addressed Tinfoil scrutiny findings: server/client docs boundary, Prisma generate/push, route coverage config, rate-limit guidance, unknown-field tests, and token revoke ownership
- 2026-06-01 19:16 Addressed Tinfoil Round 2 findings: live smoke now covers private auth boundaries and idempotent replay uses current request IDs
- 2026-06-01 19:19 Addressed Tinfoil Round 3 findings: bearer token creation cannot escalate scopes and expired idempotency keys can be reused after cleanup
- 2026-06-01 19:22 Tinfoil scrutiny converged after token-scope and idempotency-expiry fixes
- 2026-06-01 19:25 Addressed Stranger scrutiny findings: public cookbook reads use new public data access and OAuth refresh-token drift covers both server comments
- 2026-06-01 19:28 Addressed Stranger Round 2 finding: idempotency hashes include method, concrete path, and body so same-key/different-item conflicts are detected
- 2026-06-01 19:31 Stranger scrutiny converged after idempotency path-hash fix
- 2026-06-01 19:34 Addressed final Tinfoil finding by aligning discovery, health, and OpenAPI as optional-auth routes with no required scope
- 2026-06-01 19:35 Addressed final Tinfoil Round 2 finding by adding invalid-token behavior for optional-auth root discovery
- 2026-06-01 19:40 Final Tinfoil scrutiny converged after root optional-auth invalid-token alignment
- 2026-06-01 19:37 Review chain converged: granularity, validation, ambiguity, quality, Stranger scrutiny, and final Tinfoil scrutiny
- 2026-06-01 19:38 Unit 0 complete: captured branch, route, migration, script, deployment, and contract baseline in `unit-0-setup-research.log`
- 2026-06-01 19:41 Unit 1a complete: credential-scope migration/auth/delegated/OAuth tests are red for missing scopes implementation
- 2026-06-01 19:48 Unit 1b complete: added `ApiCredential.scopes`, normalized personal/delegated/OAuth scopes, preserved legacy expansion, and saved green focused-test/build/Prisma logs
- 2026-06-01 19:53 Addressed Unit 1b reviewer blocker by moving Cloudflare rate-limit bindings from deprecated `unsafe.bindings` to supported `ratelimits` config and refreshing warning-free build logs
- 2026-06-01 19:53 Unit 1c complete: added expansion boundary tests, verified 100% coverage on `app/lib/api-auth.server.ts`, and saved green focused-test/build logs
- 2026-06-01 19:56 Unit 2a complete: idempotency migration/helper tests are red for missing `0016_api_idempotency_keys.sql` and `app/lib/api-idempotency.server.ts`
- 2026-06-01 20:01 Addressed Unit 2a reviewer finding by adding cleanup-order assertions for `ApiIdempotencyKey` before credential cleanup
- 2026-06-01 20:01 Unit 2b complete: added `ApiIdempotencyKey`, migration, cleanup hooks, idempotency helper, Prisma logs, green focused tests, typecheck, and build
- 2026-06-01 20:04 Unit 2c complete: added idempotency helper behavior tests for hashing, first-use/replay/conflict, failed response replay, revoked-credential replay, expiry cleanup/reuse, and 100% helper coverage
- 2026-06-01 20:08 Unit 3a complete: v1 shell tests are red for missing `routes/api.v1.$`, missing v1 contract helper, and missing exact `.ts` route coverage glob
- 2026-06-01 20:11 Addressed Unit 3a reviewer finding by asserting full v1 CORS/request-id headers on error and preflight responses
- 2026-06-01 20:11 Unit 3b complete: registered `/api/v1/*`, added v1 contract/shell helpers, request IDs, CORS, envelopes, optional-auth invalid-token behavior, route coverage config, green legacy/v1 route tests, typecheck, and build
- 2026-06-01 20:17 Unit 3c complete: added v1 shell branch coverage for authenticated health, OpenAPI placeholder, no splat fallback, JSON parse branches, auth/internal error normalization, and 100% coverage on v1 shell files
- 2026-06-01 20:19 Unit 4a complete: public recipe v1 read tests are red for placeholder 404s on search/detail/list validation and scope checks
- 2026-06-01 20:23 Addressed Unit 4a reviewer finding by asserting v1 headers on recipe 404, validation, and insufficient-scope errors
- 2026-06-01 20:23 Unit 4b complete: implemented public recipe list/detail formatting, query/q and limit handling, deleted exclusion, bearer scope checks, green legacy/v1 route tests, typecheck, and build
- 2026-06-01 20:28 Unit 4c complete: added recipe branch coverage for blank/default limits, malformed limits, anonymous list access, deterministic step/ingredient ordering, verified 100% coverage on v1 shell/recipe files, and saved green build logs
- 2026-06-01 20:33 Addressed Unit 4c reviewer finding by suppressing only Rollup `EMPTY_BUNDLE` route-module diagnostics, adding a hygiene guard test, and regenerating warning-free build/typecheck/coverage evidence
- 2026-06-01 20:37 Addressed Unit 4c Round 2 reviewer finding by narrowing empty-bundle suppression to the known server-only route chunks and proving unknown empty bundles still log
- 2026-06-01 20:34 Unit 5a complete: added public cookbook list/detail tests for query/q, limits, active recipe counts, deleted recipe exclusion, missing cookbook errors, anonymous access, bearer success, and insufficient-scope failure; red run fails on unimplemented v1 cookbook routes returning shell 404s
- 2026-06-01 20:39 Addressed Unit 5a reviewer findings by adding canonical `query`, anonymous detail success, list deleted-recipe count exclusion, full v1 header assertions on cookbook errors, and non-brittle limit assertions; red run still fails on unimplemented v1 cookbook routes
- 2026-06-01 20:41 Unit 5b complete: implemented public cookbook list/detail routes, active recipe counts, deleted recipe exclusion, optional-auth scope checks, query/q and limit handling, with green v1/legacy route tests, typecheck, and warning-free build
- 2026-06-01 20:45 Addressed Unit 5a Round 2 reviewer findings by covering `cookbooks:read` bearer success on cookbook list and insufficient-scope bearer failure on cookbook detail; regenerated red evidence from the pre-implementation worktree and green Unit 5b logs
- 2026-06-01 20:48 Unit 5c complete: added cookbook branch coverage for blank/default limits, `limit=50`, zero active recipes, ordered active recipes, malformed limits, missing cookbooks, anonymous access, and bearer insufficient scope; simplified active recipe filtering and verified 100% coverage on v1 shell/recipe/cookbook files plus warning-free build
- 2026-06-01 20:51 Addressed Unit 5c reviewer finding by explicitly asserting malformed cookbook `limit=abc`, with regenerated 100% coverage and warning-free build logs
- 2026-06-01 20:52 Unit 6a complete: added v1 token metadata tests for session and bearer list/create/revoke, token secret one-time return, scope normalization/defaults/capping/escalation, self-revoke, auth failures, unknown body fields, invalid JSON, blank names, and invalid scopes; red run fails on unimplemented v1 token routes returning shell 404s
- 2026-06-01 20:54 Addressed Unit 6a reviewer findings by allowing nullable token metadata date fields and asserting insufficient-scope error envelopes for token list/create/delete paths; regenerated red evidence still fails on unimplemented v1 token routes
- 2026-06-01 20:57 Unit 6b complete: implemented authenticated token list/create/revoke metadata endpoints with one-time token secret return, bearer scope capping, self-revoke behavior, unknown-field validation, invalid-scope mapping, green v1/legacy token tests, typecheck, and warning-free build
- 2026-06-01 21:06 Addressed Unit 6b reviewer finding by enforcing token-create authentication and `tokens:write` scope before parsing JSON bodies; unauthenticated and under-scoped malformed bodies now return auth/scope errors before body validation
- 2026-06-01 21:07 Unit 6c complete: added token branch coverage for duplicate names, no/blank/primitive JSON bodies, invalid scope payloads, missing and cross-owner revokes, already-revoked credentials, 100% coverage on v1 token code, focused route tests, typecheck, and warning-free build
- 2026-06-01 21:09 Unit 7a complete: added public/token scope-matrix tests covering optional discovery routes, anonymous public reads, fine-grained and legacy scope success/failure, session token access, and a red structural assertion for missing `resolveApiV1ScopeRequirement`
- 2026-06-01 21:12 Addressed Unit 7a reviewer finding by adding explicit `recipes:read` and `cookbooks:read` bearer success assertions for public recipe/cookbook list and detail routes
- 2026-06-01 21:18 Unit 7b complete: added centralized v1 scope-matrix resolution and routed discovery, health, OpenAPI, recipe, cookbook, and token metadata endpoints through it; focused v1 route tests, 100% v1 coverage, typecheck, and warning-free build passed
- 2026-06-01 21:20 Unit 7c complete: verified 100% coverage on v1 scope enforcement and shell route files plus warning-free build; no additional refactor required
- 2026-06-01 21:23 Unit 8a complete: added v1 shopping-list read/sync tests for scope rows, authenticated active-list shape, empty-list creation, tombstone sync, cursor filtering, missing auth, insufficient scope, and invalid cursor; red run fails on unimplemented v1 shopping routes returning 404
- 2026-06-01 21:26 Addressed Unit 8a reviewer findings by asserting exact success envelope/data/list/item keys and adding `GET /api/v1/shopping-list/sync` insufficient-scope coverage
- 2026-06-01 22:13 Unit 12a complete: added full first-slice scope matrix audit coverage for public, shopping-list, and token endpoints; focused audit passed immediately because prior scope/OpenAPI fixes had already centralized the implementation
- 2026-06-01 22:14 Unit 12b complete: verified the shared v1 scope-matrix helper covers all supported endpoints with 50 passing v1 route tests and a clean production build; no code change required after prior centralization
- 2026-06-01 22:16 Unit 12c complete: covered the v1 scope fallback branch, verified 56 v1 route/OpenAPI tests, and confirmed 100% coverage for `api-v1.server.ts`, `api-v1-openapi.server.ts`, `api-v1-contract.server.ts`, and `api.v1.$.ts`; global coverage table still reports unrelated app files outside this unit
- 2026-06-01 22:18 Unit 13a complete: added route registration, loader/meta, and rendered developer-docs tests; red run fails because `~/routes/developers` is not implemented yet
- 2026-06-01 22:22 Unit 13b complete: registered `/developers`, added a contract-backed developer docs route, passed the focused route test, and completed a clean production build
- 2026-06-01 22:27 Unit 13c complete: removed the developers-route fallback branch after contract-backed scope labels made it unreachable; focused route tests, route coverage, local desktop/mobile render checks, and production build all passed
- 2026-06-01 21:27 Unit 8b complete: implemented v1 shopping-list read and sync endpoints with scope rows, active-list formatting, empty-list creation, tombstone-inclusive sync, cursor filtering, invalid cursor errors, focused route tests, typecheck, and warning-free build
- 2026-06-01 21:33 Unit 8c complete: added sync ordering/cursor fallback coverage, hardened cursor parsing to reject non-round-tripping JavaScript date inputs, and verified 100% v1 coverage plus typecheck and warning-free build
- 2026-06-01 21:37 Unit 9a complete: added red v1 shopping-list mutation tests for write scope rows, add/check/remove envelopes, restore/merge behavior, unknown fields, clientMutationId validation, idempotent replay/current request IDs, idempotency conflicts, and write-scope enforcement; red run fails on missing v1 mutation routes returning 404 and missing scope rows
- 2026-06-01 21:41 Addressed Unit 9a reviewer finding by asserting full `ShoppingItem` shape for active `shoppingList.items` in mutation responses and normalizing restore fixtures to the API's lowercased identity rules
- 2026-06-01 21:42 Unit 9b complete: implemented v1 shopping-list add/check/remove endpoints with write-scope rows, request validation, normalized item identity, idempotency reserve/replay/conflict handling, exact mutation envelopes, green v1 mutation tests, green legacy `/api` route tests, typecheck, and warning-free build
- 2026-06-01 21:46 Unit 9c complete: added mutation branch coverage for blank/invalid add inputs, duplicate item merge with present and null quantities, checked false, repeated delete, missing patch/delete items, session idempotency, and expired idempotency-key reuse; verified 100% coverage, typecheck, and warning-free build
- 2026-06-01 21:48 Unit 10a complete: added red conflict/error tests for server-order check/delete/restore semantics with ignored client timestamp fields, not-found item error details, invalid item ids, and malformed mutation JSON; red run fails on timestamp fields being treated as unknown and missing item details absent
- 2026-06-01 21:49 Unit 10b complete: accepted and ignored client timestamp fields for check/delete mutation bodies, added machine-readable missing item details, and verified conflict tests, mutation tests, typecheck, and warning-free build
- 2026-06-01 21:50 Unit 10c complete: verified machine-readable shopping-list error and last-writer-wins branches with 100% v1/idempotency coverage, typecheck, and warning-free build; no additional refactor required
- 2026-06-01 21:52 Unit 11a complete: added red OpenAPI helper and route tests for top-level metadata, every first-slice path, scopes/auth/security, request/response schemas, examples, error schemas, parameters, strict reusable schemas, and raw `/api/v1/openapi.json`; red run fails because `app/lib/api-v1-openapi.server.ts` does not exist
- 2026-06-01 21:56 Unit 11b complete: added `app/lib/api-v1-openapi.server.ts`, generated the first-slice OpenAPI 3.1 contract from v1 resource metadata, served `/api/v1/openapi.json` as the raw document, and verified focused OpenAPI tests, typecheck, and warning-free build
- 2026-06-01 21:58 Unit 11c complete: removed unreachable OpenAPI metadata guard, verified 100% coverage on OpenAPI/v1/idempotency helper files, and saved green typecheck/build logs
