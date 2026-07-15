# Planning: Spoonjoy Audit Remediation

**Status**: drafting
**Created**: pending initial commit

## Goal
Bring the shipped Recipe Photo Studio, OAuth, data hygiene, repository hygiene, performance, and release surfaces to done-quality across the web, native Apple, REST, and MCP clients. Close every actionable finding from the 2026-07-15 audit, ship the resulting changes, and verify the consuming production and TestFlight surfaces.

## Upstream Work Items
- 2026-07-15 shipped-work audit at `/tmp/spoonjoy-latest-model-audit/audit-report.md`

## Scope

### In Scope
- Normalize native photo uploads to the server-supported food-image contract and prove cross-client compatibility.
- Prevent duplicate native Photo Studio mutations while preserving idempotent retry behavior and clear progress feedback.
- Add first-class native Google and GitHub sign-in controls through the existing secure OAuth authorization flow, and restore ordinary browser SSO reuse.
- Make native Photo Studio behavior and copy match product truth, including conditional Spoon metadata, cover direction, cooked-date input, outcome labels, automatic activation, processing, and failure states.
- Add direct web and native visual QA coverage for Photo Studio states and nearby responsive surfaces.
- Remove active Spoonjoy demo identities, credentials, and fixture assumptions from seeds, docs, and end-to-end workflows; require explicit local-only targets and teardown.
- Remove tracked generated task/QA output from current repository trees and add durable repository-size and artifact guardrails.
- Add bounded OAuth provider calls, truthful error classification, and migrate Apple callback starts to the clean callback while retaining compatibility during rollout.
- Make TestFlight release notes build-specific and validate them before publishing.
- Provide a supported local OAuth test-residue teardown path and leave disposable local data clean.
- Extract Photo Studio behavior from oversized web and native modules without changing public contracts.
- Enforce a production CSP after compatibility validation, move My Recipes search work into the database boundary, and expose following content below the public home hero.
- Restore dependency-advisory visibility with a supported CI scanner.
- Merge, deploy, publish a new internal TestFlight build, run production/native smoke and visual QA, clean worktrees, and perform a durable continuation scan.
- Retire Clem's emergency password only after a non-password provider is linked and recovery is verified.

### Out of Scope
- Editing already-applied historical database migrations.
- Rewriting shared Git history or force-pushing repository branches without a separately proven need and explicit destructive-operation authorization.
- Removing Clem's only working credential before a replacement login method is verified.

## Completion Criteria
- [ ] Native HEIC/default-camera selections upload successfully through a normalized bounded image contract.
- [ ] Native Photo Studio prevents conflicting duplicate mutations and reuses idempotency identity for retries.
- [ ] Native signed-out UI offers distinct Google and GitHub actions with secure provider routing and normal SSO reuse.
- [ ] Native Photo Studio has truthful minimum-click controls, processing/error states, and direct screenshot coverage on supported Apple form factors.
- [ ] Active seeds, guides, and end-to-end tests contain no fixed Spoonjoy demo identities or reusable demo credentials.
- [ ] Current web and native trees contain no generated task/QA artifact dumps, and CI rejects future artifact and PR-size regressions.
- [ ] OAuth provider calls are bounded and classified accurately; clean Apple callbacks are the default start path with compatibility preserved.
- [ ] TestFlight release notes are current for the exact build and publishing rejects stale notes.
- [ ] Local disposable data and OAuth test residue cleanly tear down without touching non-disposable users.
- [ ] Photo Studio code is split into maintainable service/orchestration boundaries with unchanged REST, MCP, and native public behavior.
- [ ] Production CSP is enforced, My Recipes search is database-bounded, the home hero reveals following content, and dependency advisory CI is operational.
- [ ] Web changes are merged and deployed, native changes are merged and available to the internal TestFlight group, and consuming-surface smoke checks pass.
- [ ] Clem's emergency password is retired after replacement authentication is verified, or the exact remaining human-only action is durably recorded without blocking independent completion.
- [ ] All stale task worktrees from this effort and prior Spoonjoy agent runs are safely removed.
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
- None. The user delegated implementation and UX decisions; reviewer gates will resolve ordinary ambiguity while destructive shared-state actions remain protected.

## Decisions Made
- Normalize native picker output to bounded JPEG before staging so queued and immediate uploads share one server-compatible contract.
- Preserve secure OAuth state and PKCE while adding a validated provider hint to the first-party authorization flow.
- Treat cover editorialization as the default and keep the original image on a Spoon only when Spoon creation is enabled.
- Replace fixed demo accounts with per-run disposable identities and explicit teardown; keep historical applied migrations immutable.
- Remove generated evidence from current product trees and store future evidence outside tracked source; do not rewrite shared history as part of ordinary cleanup.
- Land work in small atomic cross-repo changes, each reviewer-gated, before final deployment and TestFlight verification.

## Context / References
- `/tmp/spoonjoy-latest-model-audit/audit-report.md`
- Web repository: `/Users/arimendelow/Projects/spoonjoy-v2-audit-remediation`
- Native repository: `/Users/arimendelow/Projects/spoonjoy-apple-audit-remediation`
- Project `AGENTS.md` files and Work Suite skills

## Notes
Repo-local `subagents/work-planner.md` and `subagents/work-doer.md` were unavailable, so the current installed Work Suite skills are the execution source.

## Progress Log
- pending initial commit Created
