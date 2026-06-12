# Planning: Environment-Aware Cleanup Harness

**Status**: approved
**Created**: 2026-06-12 04:46 America/Los_Angeles

## Goal
Make Spoonjoy smoke and cleanup scripts explicit about their target environment, safe by default for production, and useful enough for agents to clean QA disposable data including related image objects without ad hoc SQL/R2 commands.

## Upstream Work Items
- `BACKLOG.md` `SJ-044`: Environment-Aware Smoke, Cleanup, And Preflight Harness.
- `spoonjoy/tasks/2026-06-10-1521-planning-next-work-queue.md`: Next thin slice after `SJ-043`, `SJ-045`, and `SJ-047`.
- `spoonjoy/tasks/AUTOPILOT-STATE.md`: Current durable queue points to `SJ-044` as the active dogfood seed.

## Scope

### In Scope
- Add a shared script environment resolver for `local`, `qa`, and `production` targets with base URL, D1 target, R2 target, and destructive-operation scope metadata.
- Refactor live smoke argument parsing and QA preflight constants to use the shared resolver instead of duplicated environment facts.
- Make `scripts/smoke-api-live.mjs` target-explicit through the shared resolver because it is also exposed as a smoke command.
- Replace the local-only `cleanup:qa` behavior with an environment-aware cleanup harness that dry-runs by default, prints the resolved target before work, allows local mutation with `--apply`, allows broad remote mutation only for explicit `--target-env qa --apply`, and keeps production broad cleanup read-only/refused.
- Extend QA cleanup SQL to cover disposable users, recipes, spoons, OAuth clients/codes/tokens, API credentials/idempotency keys, generated covers, and related owned rows while preserving non-disposable data.
- Add pre-mutation dependency-blocker queries for non-disposable rows that reference the disposable cleanup target set. At minimum cover non-disposable recipe forks via `Recipe.sourceRecipeId`, non-disposable spoons on disposable recipes via `RecipeSpoon.recipeId`, non-disposable cookbook membership through `RecipeInCookbook.recipeId` / `addedById` / cookbook author ownership, and non-disposable recipes whose `activeCoverId` points at a disposable cover. QA apply must report those blockers and refuse broad D1/R2 mutation rather than mutating non-disposable user state or triggering FK failures.
- Handle disposable-to-disposable recipe fork chains explicitly after the blocker query succeeds: either topologically delete disposable fork leaves first or clear `sourceRecipeId` only for recipes inside the disposable cleanup target set. Tests must cover disposable-only fork chains and mixed chains with a non-disposable blocker.
- Add QA R2 cleanup planning and execution for disposable `/photos/` keys discovered from disposable users, recipes, spoons, and recipe covers; production must list potential keys only and refuse deletion.
- Ensure live smoke artifacts record environment metadata, git branch/commit, created record ids already available to the smoke, cleanup verification, and retained/deleted R2 keys when image-cover smoke runs.
- Update docs/package scripts/preflight checks so future agents use explicit local/QA/production cleanup commands and cannot reintroduce ambiguous destructive cleanup.
- Run local/unit validation, live QA cleanup dry-run/apply where safe, production read-only checks, full coverage/typecheck/build, merge, auto-deploy verification, production smoke, and final cleanup.

### Out of Scope
- Broad destructive production cleanup.
- New image provider canary or visual benchmark work; that remains `SJ-046`.
- Changing the Mendelow-style image redraw prompt or image generation provider defaults.
- Changing recipe/spoon/cover product UX.
- Building any custom email notification system.

## Completion Criteria
- [ ] A shared resolver defines and validates `local`, `qa`, and `production` script targets and is consumed by smoke/preflight/cleanup code.
- [ ] Cleanup commands print resolved environment, base URL, D1 target, R2 target, and destructive-operation scope before any mutation.
- [ ] Cleanup refuses ambiguous remote mutation and refuses broad production mutation; production cleanup remains read-first and narrow.
- [ ] QA cleanup can remove disposable users, recipes, spoons, OAuth clients/codes/tokens, API credentials/idempotency keys, generated covers, and related QA R2 objects.
- [ ] QA cleanup reports and refuses mutation when any non-disposable row still references disposable cleanup targets.
- [ ] QA cleanup safely handles disposable recipe fork chains without mutating non-disposable fork attribution.
- [ ] Smoke artifacts include environment, base URL, branch/commit, created record ids, cleanup result, and retained/deleted R2 keys where available.
- [ ] Docs and preflight checks encode the explicit cleanup/smoke target contract.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings
- [ ] Work is merged to `main`, auto-deployment is verified, production smoke passes, and disposable local/QA/prod test data is clean.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values
- Cover local, QA, production, missing env, mismatched URL/env, remote mutation refusal, QA apply intent, production read-only/refusal, cross-boundary reference blockers, restrictive fork blockers, disposable fork chains, mixed fork chains, cascade/direct cleanup surfaces, R2 key extraction/validation, and artifact metadata branches.

## Open Questions
- None.

## Decisions Made
- Use `--target-env local|qa|production` consistently for cleanup and smoke; local may still be inferred only from localhost smoke URLs for the existing developer convenience path.
- Keep `pnpm cleanup:qa` as a backwards-compatible local dry-run alias only if retained; add explicit commands for local and remote QA cleanup so the script name no longer implies remote QA mutation.
- Treat `qa` as the only broad remote cleanup environment, and require both explicit `--target-env qa` and `--apply` before deleting remote QA D1/R2 state.
- Treat production cleanup as read-first: it may report disposable residue and exact smoke-created users, but this task will not add a broad production delete path.
- Do not use the test helper's whole-database deletion patterns in live cleanup. For live local/QA cleanup, cross-boundary references from non-disposable rows into the disposable target set are blockers: report them and refuse broad apply before D1/R2 deletion.
- Disposable recipes may reference each other through `sourceRecipeId`; after the non-disposable blocker count is zero, live cleanup may clear `sourceRecipeId` only where both referencing and referenced recipes are in the disposable target set, then delete disposable recipe rows. It must not clear `sourceRecipeId` on non-disposable recipes.
- Disposable recipe deletion may cascade through dependent rows only when the dependent rows are also inside the disposable target set. Non-disposable spoons, cookbook membership, cookbook author ownership, and active-cover pointers must be blocker-reported instead of silently deleted or nulled.
- A broad QA apply is destructive but staged and scoped to disposable QA state through explicit `--target-env qa --apply`. Broad production mutation remains a hard refusal in the shipped script.
- Discover R2 cleanup keys from persisted `/photos/` URLs in `User.photoUrl`, `RecipeSpoon.photoUrl`, and `RecipeCover.imageUrl` / `stylizedImageUrl` / `sourceImageUrl`; delete only keys that pass a disposable-owner profile/upload, browser recipe/spoon namespace, API upload namespace, or generated-cover safety check and have no surviving non-disposable DB/search references.
- Collect and persist the candidate R2 key list before deleting D1 rows so QA cleanup cannot erase the database evidence it needs to clean stored objects.
- Preserve the existing exact-run image-cover smoke cleanup; the broader harness complements it for leftover QA residue.

## Context / References
- `BACKLOG.md` `SJ-044` names the remaining gap after `SJ-043`: broader environment-aware QA cleanup for disposable image objects and OAuth/API residue.
- `scripts/smoke-live-helpers.mjs` already validates smoke `--target-env`, QA/production base URLs, D1 cleanup args, and QA R2 get/delete arg builders.
- `scripts/smoke-image-cover-live.mjs` contains the current `/photos/` key validation before one-run QA R2 deletion.
- `scripts/smoke-live.mjs` writes `smoke-results.json`, cleans the exact smoke user, and delegates flagged image-cover R2 cleanup to `scripts/smoke-image-cover-live.mjs`.
- `scripts/smoke-api-live.mjs` is a read-only smoke command and must still be target-explicit so future agents do not accidentally hit production while believing the smoke harness is environment-scoped.
- `scripts/smoke-image-cover-live.mjs` validates `/photos/` keys, deletes exact QA upload/generated-cover keys, and records deleted/verified keys for one smoke run.
- `scripts/cleanup-local-qa-data.mjs` is local-only today, dry-runs by default, and already has SQL predicates for suspicious recipes, disposable users, disposable spoons, and E2E OAuth clients.
- `scripts/qa-preflight.ts` duplicates QA base URL/R2 constants and runs QA remote migration/secret/R2 checks.
- `prisma/schema.prisma` relevant cleanup tables and relations: `User`, `ApiCredential`, `ApiIdempotencyKey`, `AgentConnectionRequest`, `OAuth`, `OAuthClient`, `OAuthAuthCode`, `OAuthRefreshToken`, `Recipe`, `RecipeSpoon`, `RecipeCover`, `RecipeInCookbook`, `Cookbook`, `ShoppingList`, `ShoppingListItem`, `UserCredential`, `ImageGenLedger`, `PushSubscription`, `NotificationEvent`, and `NotificationPreference`. The doing doc assigns concrete direct-delete, hard-delete, soft-delete, cascade-verified, search-delete, and pre-mutation-blocker behavior for each surface.
- `test/helpers/cleanup.ts` clears all fork attribution before deleting all recipes because it owns the entire local test DB; the live cleanup harness must not copy that broad pattern.
- SQLite FTS/search helper tables `SearchDocument` and `SearchIndexMetadata` are not Prisma models but appear in test cleanup; this task should either clear disposable search rows safely or document/count why the live harness does not manage them.
- `package.json` current scripts include `cleanup:qa`, `smoke:api`, `smoke:qa`, `smoke:qa:image-cover`, `qa:preflight`, and `deploy:preflight`.
- `docs/deployment.md` currently says broad production cleanup must not be run and production smoke cleanup must stay narrow.

## Notes
- The cleanup script should print target summaries in both dry-run and apply modes so CI logs/artifacts are self-describing.
- R2 deletes should be exact key deletes via Wrangler, never prefix-wide deletes.
- QA cleanup should report retained keys when a row matched disposable DB cleanup but an image URL failed key validation; those retained keys become evidence, not silently ignored state.
- QA cleanup should report dependency blockers as retained DB residue. A clean broad apply is allowed only after every blocker count is zero.
- Dependency blocker tests must include a disposable child/parent chain that succeeds, a non-disposable child recipe of a disposable parent that refuses mutation, a non-disposable spoon on a disposable recipe, non-disposable cookbook membership around a disposable recipe, and a non-disposable recipe active-cover pointer to a disposable cover.
- Production broad cleanup refusal is a feature, not a blocker.
- Keep implementation slices small enough to preserve the work-suite dogfood cadence and commit/push after each logical unit.

## Progress Log
- 2026-06-12 04:46 Created planning doc from `SJ-044`, prior QA/image-cover smoke docs, schema inspection, and current script behavior.
- 2026-06-12 04:46 Tinfoil pass tightened R2 cleanup ordering and retained-key reporting.
- 2026-06-12 04:48 Addressed planning reviewer findings: added restrictive `sourceRecipeId` blocker policy/tests and completed the cleanup-surface reference list.
- 2026-06-12 04:51 Addressed Round 2 reviewer findings: added disposable fork-chain cleanup policy/tests and clarified that broad production mutation remains refused.
- 2026-06-12 04:53 Addressed Round 3 reviewer findings: generalized cleanup blockers to all cross-boundary non-disposable references into disposable targets and set status to `NEEDS_REVIEW` during the reviewer gate.
- 2026-06-12 04:55 Addressed Round 4 reviewer finding by removing runtime gate-policy prose from the planning artifact.
- 2026-06-12 04:56 Addressed final narrow reviewer blocker by removing the remaining gate-policy sentence from Decisions Made.
- 2026-06-12 04:57 Planning reviewer gate converged; status set to approved.
