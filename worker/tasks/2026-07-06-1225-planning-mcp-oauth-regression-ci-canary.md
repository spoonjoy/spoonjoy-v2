# Planning: MCP OAuth Regression CI Canary

**Status**: approved
**Created**: 2026-07-06 12:25

## Goal
Protect the Spoonjoy MCP OAuth connection from regressions by making the critical Claude-style consent, token, refresh, MCP, and legacy-token paths run in CI and after deploy.

## Upstream Work Items
- None

## Scope

### In Scope
- Add local contract/e2e coverage for resource-bound OAuth consent, token exchange, refresh rotation, MCP calls, and consent-page interaction/layout checks.
- Add a production/QA-compatible live canary script that signs up a disposable user, drives the OAuth consent UI, exchanges and refreshes tokens, calls `/mcp`, verifies legacy Claude refresh-token promotion through exact disposable D1 state, and cleans up.
- Add GitHub Actions coverage for scheduled canary runs and post-production-deploy canary verification.
- Add tests for any new helper logic and workflow/script wiring.

### Out of Scope
- Browser automation against a real logged-in Claude account.
- Broad OAuth product redesign or new observability vendor integrations.
- Permanent canary accounts or non-disposable production data.

## Completion Criteria
- [ ] CI runs local OAuth/MCP contract and consent-page tests on PRs.
- [ ] GitHub Actions runs a post-deploy MCP OAuth canary after production deploy.
- [ ] GitHub Actions has a scheduled/manual MCP OAuth canary workflow with artifact upload.
- [ ] Live canary verifies auth-code exchange, refresh rotation, MCP `initialize`, MCP `tools/list`, and legacy Claude refresh promotion.
- [ ] Live canary cleans up exact disposable user/client/token state.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings
- [ ] If UI/rendering/layout changed: `visual-qa-dogfood` evidence captured, absurdity ledger closed, and automated visual metrics still pass

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- None.

## Decisions Made
- Use Playwright for the live canary so it catches the actual consent-page button and browser redirect behavior.
- Use exact disposable D1 rows only for the legacy Claude refresh-token promotion probe, because production cannot otherwise create a pre-resource-binding refresh token through public APIs.
- Use the exact Claude MCP redirect URI in the canary client registration to lock the compatibility fingerprint.

## Context / References
- `app/lib/oauth-routes.server.ts`
- `app/lib/oauth-server.server.ts`
- `app/lib/mcp/http-mcp.server.ts`
- `e2e/flows/oauth-authorize.spec.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/production-deploy.yml`
- `scripts/smoke-live.mjs`
- `scripts/smoke-live-helpers.mjs`

## Notes
The canary should fail loudly when the live integration breaks, but should still upload artifacts and report cleanup failures distinctly.

## Progress Log
- 2026-07-06 12:25 Created and approved by direct user mandate plus reviewer-shaped scope check in-session.
