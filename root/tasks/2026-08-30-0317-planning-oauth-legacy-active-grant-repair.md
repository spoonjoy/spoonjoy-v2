# Planning: Audit post-migration OAuth grant persistence

**Status**: NEEDS_REVIEW
**Created**: 2026-08-30 03:17

## Goal
Make the production audit distinguish supported pre-grant legacy credentials from any new credential that incorrectly lacks durable D1 grant authority.

## Upstream Work Items
- Unit 4.2 of service/client reliability hardening

## Scope

### In Scope
- Count unlinked active refresh/access credentials as failures only when created at or after D1 migration `0027_oauth_grants_and_lineage.sql` was applied.
- Fail closed if the migration ledger has no cutoff.
- Test pre-migration grandfathering, post-migration regression detection, missing-cutoff behavior, and the full production-shaped audit.
- Deploy and require a clean exact-SHA production D1 audit.

### Out of Scope
- Mutating or inventing grants/lineage for supported legacy credentials.
- Changing runtime token behavior or the later native atomic-transition work.
- Contacting the unsolicited reporter.

## Completion Criteria
- [ ] Pre-migration unlinked active credentials are ignored by the two grant-link regression invariants.
- [ ] Any unlinked active credential created at or after migration 0027 fails the audit.
- [ ] A missing migration-ledger cutoff fails closed.
- [ ] Production audit reports zero failures, including zero post-migration active refresh/access rows without grants, identity mismatches, and foreign-key violations.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- None.

## Decisions Made
- No production data repair: all six active unlinked credentials are persisted in D1 and predate migration 0027; none demonstrates memory-only state or a post-migration regression.
- Use D1's `d1_migrations.applied_at` as the native cutoff; do not add configuration or another table.
- Keep legacy runtime compatibility until natural reconnect/rotation replaces old credentials with grant-linked rows.

## Context / References
- Production migration 0027 applied at `2026-08-30 08:04:30`.
- Four active unlinked refresh rows range from `2026-07-06T15:08:46.801Z` through `2026-08-28T22:14:58.758Z`.
- Two active unlinked access rows range from `2026-07-06T15:08:46.646Z` through `2026-08-28T20:31:56.959Z`.
- `scripts/smoke-live-helpers.mjs`
- `test/scripts/smoke-live-helpers.test.ts`
- `.github/workflows/mcp-oauth-d1-audit.yml`

## Notes
This is the Ponytail path: one audit-boundary correction, no production mutation, and no synthetic history.

## Progress Log
- 2026-08-30 03:17 Created
- 2026-08-30 03:26 Rescoped after live D1 evidence proved all unlinked active rows predate grant authority.
