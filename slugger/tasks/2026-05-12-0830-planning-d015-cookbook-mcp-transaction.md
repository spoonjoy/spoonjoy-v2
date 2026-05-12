# Planning: D-015 Cookbook MCP Transaction Fix

**Status**: approved
**Created**: 2026-05-12 08:30

## Goal
Fix the deployed-worker failure in the MCP/API `add_recipe_to_cookbook` operation by removing Prisma's unsupported interactive transaction form. Preserve cookbook behavior, notification behavior, and test coverage while adding a regression path that catches the D1 runtime shape.

## Upstream Work Items
- D-015

## Scope

### In Scope
- Add a failing regression test for `add_recipe_to_cookbook` that rejects use of `db.$transaction(async tx => ...)` for this operation.
- Refactor `addRecipeToCookbookTool` in `app/lib/spoonjoy-api.server.ts` to use top-level sequential writes with explicit invariant checks.
- Preserve idempotent add behavior, owner scoping, deleted-recipe rejection, cookbook reload payload shape, and `cookbook_save_of_mine` notification trigger semantics.
- Run targeted tests, build, and full coverage with zero warnings.

### Out of Scope
- Refactoring unrelated cookbook operations such as `create_cookbook` or `remove_recipe_from_cookbook`.
- Domain-splitting `app/lib/spoonjoy-api.server.ts`.
- Changing API routes, MCP operation names, cookbook schema, or notification preference behavior.
- Fixing D-010, D-002, D-008, D-014, or other follow-up backlog items.

## Completion Criteria
- [x] `add_recipe_to_cookbook` no longer calls interactive `$transaction(async tx => ...)`.
- [x] Regression coverage fails before the implementation change and passes after the refactor.
- [x] Existing cookbook MCP behavior remains covered and unchanged.
- [x] Notification trigger tests for `cookbook_save_of_mine` still pass.
- [x] 100% test coverage on all new code
- [x] All tests pass
- [x] No warnings

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- None.

## Decisions Made
- Use direct execution because the user explicitly instructed the agent to proceed without returning control.
- Keep the fix local to `addRecipeToCookbookTool`; other interactive transaction sites are out of scope for D-015 unless a test proves they block this specific operation.
- Use the existing `recipe-create.server.ts` and `recipe-fork.server.ts` sequential-write pattern for D1 compatibility.

## Context / References
- `app/lib/spoonjoy-api.server.ts` defines `addRecipeToCookbookTool` and currently uses `context.db.$transaction(async (tx) => ...)`.
- `app/lib/recipe-create.server.ts` documents the D1 incompatibility and sequences writes against the top-level client.
- `app/lib/recipe-fork.server.ts` uses the same sequential-write approach and relies on database constraints for race protection.
- `test/lib/mcp/spoonjoy-tools.server.test.ts` covers MCP cookbook add/remove behavior.
- `test/lib/spoonjoy-api-cookbook-notification.test.ts` covers `cookbook_save_of_mine` trigger wiring.
- `e2e/flows/create-recipe.spec.ts` is the D-013 model for a runtime regression caught outside better-sqlite3 unit coverage.

## Notes
The essential bug is the interactive transaction callback, not the cookbook semantics. The test should isolate this by making the add path fail when callback-style `$transaction` is invoked, then the implementation should satisfy the same behavior without using that form.

## Progress Log
- 2026-05-12 08:30 Created from D-015 handoff and current code inspection.
- 2026-05-12 08:46 Completion criteria verified by red test, targeted tests, full coverage, and production build.
