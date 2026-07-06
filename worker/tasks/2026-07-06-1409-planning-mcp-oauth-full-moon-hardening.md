# Planning: MCP OAuth Full-Moon Hardening

**Status**: complete
**Created**: 2026-07-06 14:09

## Goal
Make MCP/OAuth regressions impossible to miss, easy to diagnose, and hard to reintroduce after the baseline canary has landed.

## Upstream Work Items
- None

## Scope

### In Scope
- Add GitHub Actions failure/recovery issue automation for the MCP OAuth canary.
- Add human-readable GitHub job summaries for canary runs.
- Add artifact redaction guards so canary output cannot leak OAuth secrets.
- Add a readonly D1 invariant audit for MCP/OAuth connection health.
- Add scheduled/manual GitHub Actions wiring for the D1 audit with artifact upload.
- Add protocol/ops documentation for canary alerts, support references, D1 audits, and real-Claude manual verification.
- Add repo hygiene and helper tests for new scripts/workflow wiring.

### Out of Scope
- Automating a real logged-in Claude account.
- Changing OAuth token semantics beyond test/ops hardening.
- Adding a new external alerting vendor beyond GitHub issues and existing PostHog documentation.
- Destructive production cleanup outside exact canary disposable state.

## Completion Criteria
- [x] Canary workflows write useful GitHub step summaries.
- [x] Canary failures open/update a canonical GitHub issue and recovery closes/comments on it.
- [x] Canary artifacts are redaction-checked for OAuth tokens, codes, bearer headers, and raw callback query leaks.
- [x] A readonly MCP/OAuth D1 invariant audit runs locally and in scheduled/manual GitHub Actions.
- [x] Ops docs cover canary triage, support refs, D1 audit interpretation, and real-Claude manual smoke.
- [x] Repo hygiene tests pin the new workflow/script/doc wiring.
- [x] 100% test coverage on all new code
- [x] All tests pass
- [x] No warnings
- [x] If UI/rendering/layout changed: `visual-qa-dogfood` evidence captured, absurdity ledger closed, and automated visual metrics still pass

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- None.

## Decisions Made
- Use GitHub issues as the loud default failure channel because the repository already has GitHub Actions and does not require a new vendor secret.
- Keep D1 audit readonly; it reports invariant violations and disposable residue but does not mutate production data.
- Use GitHub job summaries for first-look diagnostics and artifacts for detailed evidence.
- Keep real-Claude verification as a documented manual smoke because CI cannot safely own a real Claude logged-in account.

## Context / References
- `.github/workflows/mcp-oauth-canary.yml`
- `.github/workflows/production-deploy.yml`
- `scripts/smoke-mcp-oauth-live.mjs`
- `scripts/smoke-live-helpers.mjs`
- `scripts/script-environment.mjs`
- `test/scripts/smoke-live-helpers.test.ts`
- `test/repo-hygiene.test.ts`
- `docs/analytics-privacy.md`
- `docs/deployment.md`
- `prisma/schema.prisma`

## Notes
The baseline canary already verifies consent, authorization-code exchange, refresh rotation/replay rejection, MCP initialize/tools, legacy refresh-token promotion, and cleanup. This task adds failure handling, diagnosis, and invariant monitoring around that baseline.

## Progress Log
- 2026-07-06 14:09 Created and approved from explicit user mandate.
- 2026-07-06 14:37 Implementation completed and local validation passed; see doing doc for command evidence.
