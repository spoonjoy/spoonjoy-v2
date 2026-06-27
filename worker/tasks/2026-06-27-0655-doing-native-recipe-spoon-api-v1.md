# Doing: Native Recipe Spoon API V1

**Status**: in-progress
**Execution Mode**: direct
**Created**: 2026-06-27 14:02
**Planning**: ./2026-06-27-0655-planning-native-recipe-spoon-api-v1.md
**Artifacts**: ./2026-06-27-0655-doing-native-recipe-spoon-api-v1/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (non-autopilot interactive mode only; autopilot must convert this to `spawn` or `direct` unless a hard exception is present)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Add first-class API v1 REST endpoints for recipe spoons so the native Apple app can list, create, update, and soft-delete spoon events using its existing request builders. The endpoints must reuse the existing recipe spoon domain logic, API v1 auth/idempotency patterns, and spoon photo cover activation rules.

## Upstream Work Items
- None

## Completion Criteria
- [ ] Spoon list returns non-deleted spoons for a non-deleted recipe in `cookedAt desc, id desc` order with `limit`, `cursor`, `nextCursor`, and `hasMore`.
- [ ] Spoon list is anonymous-public, validates authenticated credentials/scopes when provided, and rejects insufficient authenticated scopes like recipe list/detail.
- [ ] Spoon create requires `kitchen:write`, is idempotent by `clientMutationId`, calls `createSpoon`, returns native-shaped spoon data, and creates/activates a cover when existing spoon cover decision rules say to.
- [ ] Spoon update requires `kitchen:write`, is idempotent by `clientMutationId`, is owner-only through `updateSpoon`, checks the path recipe id, and supports `note`, `nextTime`, `cookedAt`, and `photoUrl`.
- [ ] Spoon delete requires `kitchen:write`, accepts `clientMutationId` from JSON body, query, or `X-Client-Mutation-Id`, is owner-only through `deleteSpoon`, checks the path recipe id, and soft-deletes.
- [ ] API v1 discovery, scope requirements, OpenAPI full/SDK profiles, generated playground, docs, and route coverage tests include the spoon endpoints.
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

### ✅ Unit 0: Setup/Research
**What**: Verify worktree, source files, route patterns, spoon services, cover decision helpers, API v1 OpenAPI/docs/playground generation, and test conventions.
**Output**: Confirmed implementation targets and branch/worktree state.
**Acceptance**: Worktree is on `worker/native-recipe-spoon-api-v1`; referenced files exist; no unresolved planning questions remain.

### ✅ Unit 1a: API V1 Spoon Endpoints — Tests
**What**: Add failing route/openapi/docs tests covering anonymous/authenticated spoon listing, cursor validation, create/update/delete auth/idempotency/ownership, cover activation, contract resources, and playground generation.
**Acceptance**: New tests fail because `/api/v1/recipes/{id}/spoons` and `/api/v1/recipes/{id}/spoons/{spoonId}` are not implemented or documented yet.

### ✅ Unit 1b: API V1 Spoon Endpoints — Implementation
**What**: Implement the spoon route handlers, payload formatter, spoon cursor parser, date/body validators, error mapping, contract/scope entries, telemetry/idempotency operation metadata, and OpenAPI schema/path metadata.
**Acceptance**: Unit 1a tests pass; implementation reuses `createSpoon`, `updateSpoon`, `deleteSpoon`, `decideSpoonCoverCreation`, `activateSpoonCoverForDecision`, `createCover`, and cover stylization queueing.

### ❌ Unit 1c: API V1 Spoon Endpoints — Coverage & Docs
**What**: Update `docs/api.md`, regenerate `app/lib/generated/api-v1-playground.ts`, run targeted tests, run typecheck/build, and run coverage gates for the touched API surface.
**Acceptance**: Coverage is 100% on new code, all selected and full required tests pass with no warnings, and generated files are in sync.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-27-0655-doing-native-recipe-spoon-api-v1/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-27 14:02 Created from planning doc
- 2026-06-27 14:04 Doing-doc review converged; execution started
- 2026-06-27 14:04 Unit 0 complete: verified worktree, branch, source files, route patterns, spoon services, cover decision helpers, OpenAPI/docs/playground generation, and test conventions
- 2026-06-27 07:12 Unit 1a complete: added route, scope, OpenAPI, and docs-marker coverage for API v1 recipe spoon endpoints. Red check: `pnpm exec vitest run test/routes/api-v1-recipe-spoons.test.ts` fails 5/5 because the new spoon routes still return 404.
- 2026-06-27 07:36 Unit 1b complete: implemented GET/POST/PATCH/DELETE API v1 recipe spoon endpoints with optional public read auth, `kitchen:write` mutations, cursor pagination, idempotency, path recipe validation, spoon domain service reuse, spoon-photo cover activation, telemetry operation names, contract/scope/OpenAPI metadata, docs, and generated playground updates.
- 2026-06-27 07:36 Unit 1c blocked only on broad-suite verification: focused API/docs/developer/telemetry tests pass 87/87; `pnpm run typecheck` passes; `pnpm run build` passes. `pnpm run test:coverage` was attempted twice and failed in unrelated existing suites plus Istanbul `coverage/.tmp/*.json` ENOENT after failures. Individual failed files passed when isolated under coverage, and a broad non-coverage run also showed unrelated order/shared-db failures in existing recipe route tests before being stopped.
