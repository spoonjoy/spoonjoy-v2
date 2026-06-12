# Planning: Environment-Aware Cleanup Harness

**Status**: drafting
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
- Replace the local-only `cleanup:qa` behavior with an environment-aware cleanup harness that dry-runs by default, prints the resolved target before work, allows local mutation with `--apply`, allows broad remote mutation only for explicit `--target-env qa --apply`, and keeps production broad cleanup read-only/refused.
- Extend QA cleanup SQL to cover disposable users, recipes, spoons, OAuth clients/codes/tokens, API credentials/idempotency keys, generated covers, and related owned rows while preserving non-disposable data.
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
- Cover local, QA, production, missing env, mismatched URL/env, remote mutation refusal, QA apply intent, production read-only/refusal, R2 key extraction/validation, and artifact metadata branches.

## Open Questions
- None. The user explicitly requested autopilot/no-human-gates for obvious continuation work; safety decisions here are reviewer-gated rather than human-gated.

## Decisions Made
- Use `--target-env local|qa|production` consistently for cleanup and smoke; local may still be inferred only from localhost smoke URLs for the existing developer convenience path.
- Keep `pnpm cleanup:qa` as a backwards-compatible local dry-run alias only if retained; add explicit commands for local and QA cleanup so the script name no longer implies remote QA mutation.
- Treat `qa` as the only broad remote cleanup environment, and require both explicit `--target-env qa` and `--apply` before deleting remote QA D1/R2 state.
- Treat production cleanup as read-first: it may report disposable residue and exact smoke-created users, but this task will not add a broad production delete path.
- Discover R2 cleanup keys from persisted `/photos/` URLs in `User.photoUrl`, `RecipeSpoon.photoUrl`, and `RecipeCover.imageUrl` / `stylizedImageUrl` / `sourceImageUrl`; delete only keys that pass a disposable-owner or generated-cover safety check.
- Preserve the existing exact-run image-cover smoke cleanup; the broader harness complements it for leftover QA residue.
- Use sub-agent reviewer convergence for planning, doing, implementation, and merge readiness under the active no-human-gates mandate.

## Context / References
- `BACKLOG.md` `SJ-044` names the remaining gap after `SJ-043`: broader environment-aware QA cleanup for disposable image objects and OAuth/API residue.
- `scripts/smoke-live-helpers.mjs` already validates smoke `--target-env`, QA/production base URLs, D1 cleanup args, and QA R2 get/delete args.
- `scripts/smoke-live.mjs` writes `smoke-results.json`, cleans the exact smoke user, and delegates flagged image-cover R2 cleanup to `scripts/smoke-image-cover-live.mjs`.
- `scripts/smoke-image-cover-live.mjs` validates `/photos/` keys, deletes exact QA upload/generated-cover keys, and records deleted/verified keys for one smoke run.
- `scripts/cleanup-local-qa-data.mjs` is local-only today, dry-runs by default, and already has SQL predicates for suspicious recipes, disposable users, disposable spoons, and E2E OAuth clients.
- `scripts/qa-preflight.ts` duplicates QA base URL/R2 constants and runs QA remote migration/secret/R2 checks.
- `prisma/schema.prisma` relevant tables: `User`, `ApiCredential`, `ApiIdempotencyKey`, `OAuth`, `OAuthClient`, `OAuthAuthCode`, `OAuthRefreshToken`, `Recipe`, `RecipeSpoon`, `RecipeCover`, `RecipeInCookbook`, `ShoppingList`, `ShoppingListItem`, `UserCredential`.
- `package.json` current scripts include `cleanup:qa`, `smoke:qa`, `smoke:qa:image-cover`, `qa:preflight`, and `deploy:preflight`.
- `docs/deployment.md` currently says broad production cleanup must not be run and production smoke cleanup must stay narrow.

## Notes
- The cleanup script should print target summaries in both dry-run and apply modes so CI logs/artifacts are self-describing.
- R2 deletes should be exact key deletes via Wrangler, never prefix-wide deletes.
- Production broad cleanup refusal is a feature, not a blocker.
- Keep implementation slices small enough to preserve the work-suite dogfood cadence and commit/push after each logical unit.

## Progress Log
- 2026-06-12 04:46 Created planning doc from `SJ-044`, prior QA/image-cover smoke docs, schema inspection, and current script behavior.
