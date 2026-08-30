# Planning: Repair active legacy OAuth grants

**Status**: drafting
**Created**: 2026-08-30 03:17

## Goal
Bring every currently active production OAuth connector credential under durable D1 grant authority without guessing historical lineage, and make the production audit prove the invariant remains clean.

## Upstream Work Items
- Unit 4.2 of service/client reliability hardening

## Scope

### In Scope
- Reproduce and characterize the production audit finding of four active refresh rows and two active access rows without grant links.
- Extend the dry-run repair planner to recognize only unambiguous currently active credential identity, while leaving revoked, orphaned, missing-key, or conflicting history untouched.
- Add deterministic, exact-digest-gated production repair and post-apply invariant verification.
- Prove Worker/process replacement does not affect connector authority because all authoritative state is committed to D1.
- Deploy, run the read-only plan, review only redacted evidence, apply only an exact unambiguous plan, and require a zero-failure production audit afterward.

### Out of Scope
- Fabricating historical issuance or refresh lineage from timestamps.
- Repairing revoked/orphaned historical rows that do not affect active authority.
- Native atomic token transition batching, which remains Unit 5.1.
- Contacting the unsolicited reporter.

## Completion Criteria
- [ ] The production repair dry run reports an exact, deterministic plan for every and only unambiguous active legacy connection, with no secret material.
- [ ] Ambiguous or conflicting active identity causes no mutation and a failing reviewable report.
- [ ] Exact-digest apply creates durable D1 grants and links active refresh/access rows idempotently.
- [ ] Production audit reports zero active refresh rows without grants, zero active access rows without grants, zero identity mismatches, and zero foreign-key violations.
- [ ] Worker/process restart tests prove the repaired connection remains authorized until an explicit durable disconnect/revoke.
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
- [ ] Can the six active legacy rows be partitioned into exact user/client/issuer/resource/canonical-scope/connection-key groups without relying on revoked history? Resolve from redacted production evidence before permitting apply.

## Decisions Made
- Active D1 token rows already survive Worker death; this repair closes the missing durable grant-authority invariant rather than treating the finding as memory loss.
- Historical ambiguity is not authority. Only exact active-row identity may seed a grant, and no issuance/lineage record will be fabricated.
- Production mutation remains protected by an exact reviewed SHA-256 plan digest and a post-apply audit.

## Context / References
- `/tmp/spoonjoy-d1-audit.nysGXx/mcp-oauth-d1-audit-artifacts/mcp-oauth-d1-audit-results.json`
- `/tmp/spoonjoy-d1-audit.nysGXx/oauth-grant-backfill-report/oauth-grant-backfill-report.json`
- `scripts/backfill-oauth-grants.mjs`
- `scripts/oauth-grant-backfill-helpers.mjs`
- `scripts/audit-mcp-oauth-d1.mjs`
- `.github/workflows/mcp-oauth-d1-audit.yml`

## Notes
Production audit run 33306023813 found four active refresh and two active access rows without grant links; all other failure invariants passed. The existing backfill correctly planned zero writes because its historical grouping reported 80 ambiguous legacy groups.

## Progress Log
- 2026-08-30 03:17 Created
