# Planning: Spoonjoy Audit Remediation

**Status**: NEEDS_REVIEW
**Created**: 2026-07-15 11:54

## Goal
Bring the shipped Recipe Photo Studio, OAuth, data hygiene, repository hygiene, performance, and release surfaces to done-quality across the web, native Apple, REST, and MCP clients. Close every actionable finding from the 2026-07-15 audit, ship the resulting changes, and verify the consuming production and TestFlight surfaces.

## Upstream Work Items
- 2026-07-15 shipped-work audit at `/tmp/spoonjoy-latest-model-audit/audit-report.md`

## Scope

### In Scope
- Rebaseline both repositories against current remote heads, reconcile concurrent work, and refresh the finding-to-file map before implementation.
- Contain release automation first so production and TestFlight only consume exact SHAs that passed their required checks.
- Normalize native photo uploads to the server-supported food-image contract and prove cross-client compatibility.
- Prevent duplicate native Photo Studio mutations while preserving idempotent retry behavior and clear progress feedback.
- Add first-class native Google and GitHub sign-in controls through the existing secure OAuth authorization flow, and restore ordinary browser SSO reuse.
- Make native Photo Studio behavior and copy match product truth, including conditional Spoon metadata, cover direction, cooked-date input, outcome labels, automatic activation, processing, and failure states.
- Add direct web and native visual QA coverage for Photo Studio states and nearby responsive surfaces.
- Remove active Spoonjoy demo identities, credentials, and fixture assumptions from seeds, docs, and end-to-end workflows; require explicit local-only targets and teardown.
- Remove tracked generated task/QA output from current repository trees and add durable repository-size and artifact guardrails.
- Privately scan tracked databases, environment backups, and generated evidence for credentials; rotate any confirmed live secret before removal.
- Add bounded OAuth provider calls, truthful error classification, and migrate Apple callback starts to the clean callback while retaining compatibility during rollout.
- Make TestFlight release notes build-specific and validate them before publishing.
- Provide a supported local OAuth test-residue teardown path and leave disposable local data clean.
- Extract Photo Studio behavior from oversized web and native modules without changing public contracts.
- Enforce a production CSP after compatibility validation, move My Recipes search work into the database boundary, and expose following content below the public home hero.
- Restore dependency-advisory visibility with a supported CI scanner.
- Gate production deployment and TestFlight publishing on successful checks for the exact source SHA, and pin mutable release-tool dependencies where practical.
- Reconcile runtime environment examples and docs with every deployed OAuth/native-Apple flow.
- Merge, deploy, publish a new internal TestFlight build, run production/native smoke and visual QA, clean worktrees, and perform a durable continuation scan.
- Retire Clem's emergency password only after a non-password provider is linked and recovery is verified.

### Out of Scope
- Editing already-applied historical database migrations.
- Rewriting shared Git history or force-pushing repository branches without a separately proven need and explicit destructive-operation authorization.
- Removing Clem's only working credential before a replacement login method is verified.
- Deleting dirty, unmerged, active, or ambiguously owned worktrees or branches.

## Completion Criteria
- [ ] Native HEIC/default-camera selections upload successfully through a normalized bounded image contract.
- [ ] Native Photo Studio prevents conflicting duplicate mutations and reuses idempotency identity for retries.
- [ ] Native signed-out UI offers distinct Google and GitHub actions with secure provider routing and normal SSO reuse.
- [ ] Native Photo Studio has truthful minimum-click controls, processing/error states, and direct screenshot coverage on supported Apple form factors.
- [ ] Active seeds, guides, and end-to-end tests contain no fixed Spoonjoy demo identities or reusable demo credentials.
- [ ] Current web and native trees contain no generated task/QA artifact dumps, and CI rejects future artifact and PR-size regressions.
- [ ] Tracked databases and environment backups are removed after private secret triage, with any confirmed live credential rotated before cleanup.
- [ ] OAuth provider calls are bounded and classified accurately; clean Apple callbacks are the default start path with compatibility preserved.
- [ ] TestFlight release notes are current for the exact build and publishing rejects stale notes.
- [ ] Local disposable data and OAuth test residue cleanly tear down without touching non-disposable users.
- [ ] Photo Studio code is split into maintainable service/orchestration boundaries with unchanged REST, MCP, and native public behavior.
- [ ] Production CSP is enforced, My Recipes search is database-bounded, the home hero reveals following content, and dependency advisory CI is operational.
- [ ] The exact merged web SHA is recorded as the live Cloudflare deployment; authenticated production Photo Studio, provider-start/callback, MCP, REST, and public-page smokes pass and clean all disposable data.
- [ ] The exact merged native SHA is recorded in a new TestFlight build with build number, `IN_BETA_TESTING` status, `Spoonjoy Internal` group membership, current build-specific notes, and iOS/macOS smoke results from that build's source.
- [ ] Production deploy and TestFlight publishing require green validation for the exact source SHA and no longer rely on mutable release-tool revisions without a recorded reason.
- [ ] Clem personally links and verifies recovery through a non-password provider, then authorizes password retirement; otherwise the exact finding is durably marked `BLOCKED_HUMAN` after all independent work completes.
- [ ] Only clean, terminal task worktrees are removed; durable task documents and dirty, unmerged, or ambiguously owned work are preserved, and large-history disposition is recorded without an unauthorized rewrite.
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

| Human-only action | Owner | Prerequisite | Exact action | Evidence | Fallback / closure effect |
| --- | --- | --- | --- | --- | --- |
| Clem credential retirement | Clem | A non-password provider can be linked and recovery tested. | Clem signs in, links the provider, verifies a fresh recovery/login, and authorizes password removal. | Production account shows linked provider, successful fresh login, and no password credential. | Mark finding `BLOCKED_HUMAN`; all independent work ships, but the audit task itself remains non-terminal. |
| Clean Apple social callback registration | Ari or an already authorized browser session | Dual callback support is deployed and the Apple Services ID is accessible. | Add `https://spoonjoy.app/auth/apple/callback` without removing the legacy callback. | Apple portal configuration plus live canaries through both callback paths. | Keep new starts on the legacy callback and mark callback switch `BLOCKED_HUMAN`; resilience work still ships. |
| Confirmed live-secret rotation | Ari or authorized secret-store session | Private scan proves a tracked value is a live secret. | Rotate the specific provider/deployment secret before deleting tracked evidence. | New secret works, old secret is revoked, redacted incident record exists. | Stop only the affected release path and mark `BLOCKED_HUMAN`; never print or remove the sole working secret first. |
| Authenticated production owner smoke | Ari or an existing signed-in browser session | Exact web SHA is deployed. | Exercise owner-only Photo Studio without preserving smoke content. | Screenshot/network evidence and post-run zero-residue check. | Mark only the owner-smoke criterion `BLOCKED_HUMAN` if no authorized session can be obtained; public/API/MCP smokes continue. |

Ordinary implementation and UX ambiguity remains delegated to reviewer gates. The four rows above are the only anticipated human-only boundaries.

## Decisions Made
- Normalize native picker output to orientation-correct JPEG before staging, with a 2048-pixel longest edge, initial quality 0.85, adaptive quality reduction, and a hard 5 MiB output ceiling derived from the server contract. Corrupt or still-oversized inputs fail without replacing the prior staged selection.
- Lock every cover-changing native operation against every other cover mutation. Create the mutation ID synchronously with user intent; reuse it for the same payload through immediate retry, offline ownership transfer, and replay; clear it only after terminal success or an intentional payload change/cancel. Clear transient staged UI state only after server success or confirmed durable queue ownership, and retain it on failure.
- Preserve secure OAuth state and PKCE while adding a validated provider hint to the first-party authorization flow.
- Treat cover editorialization as the default and keep the original image on a Spoon only when Spoon creation is enabled.
- Replace fixed demo accounts with per-run disposable identities and explicit teardown; keep historical applied migrations immutable.
- Remove generated evidence from current product trees and store future evidence outside tracked source; do not rewrite shared history as part of ordinary cleanup.
- Treat the legacy social Apple callback, first-party native OAuth callback, and native Apple identity-token exchange as distinct flows during migration and documentation.
- Land work in small atomic cross-repo changes, each reviewer-gated, before final deployment and TestFlight verification.
- Land in this dependency order: rebaseline; release containment; backward-compatible web contracts; native P0 image/mutation fixes; native auth and Photo Studio UX; demo/repository hygiene; behavior-preserving extraction; CSP/search/home/advisory hardening; exact-SHA release closure.
- Deploy backward-compatible web provider-hint and callback support before the native release-candidate SHA. Keep every native merge independently releasable with matching notes, then designate one final release-candidate SHA for TestFlight verification.
- Register and verify the clean Apple callback before switching new starts; retain monitored legacy compatibility and roll back new starts to the legacy route if the clean canary fails.
- Use a manifest for every artifact removal, preserving durable planning Markdown and legitimate image/code fixtures. Require a PR-body changed-file manifest above 200 changed files or 5 MiB of additions, and reject tracked databases, environment backups, logs, screenshots, and generated validation output outside explicit fixture allowlists.
- Stage CSP as compatibility tests, QA enforcement, production enforcement, and a one-commit report-only rollback. Stage search as semantics tests, database query/index work, parity/scale proof, and independently releasable rollout.

## Context / References
- `/tmp/spoonjoy-latest-model-audit/audit-report.md`
- Web repository: `/Users/arimendelow/Projects/spoonjoy-v2-audit-remediation`
- Native repository: `/Users/arimendelow/Projects/spoonjoy-apple-audit-remediation`
- Project `AGENTS.md` files and Work Suite skills
- Desk task: `/Users/arimendelow/desk/spoonjoy/audit-remediation/task.md`

| Audit finding | Planned closure | Required evidence |
| --- | --- | --- |
| 1. Native HEIC mismatch | Normalize picker output before staging, enforce the server boundary, preserve prior staged state on failure, and clear successful staged uploads. | Native cover-surface and sync-engine tests for HEIC/HEIF, malformed input, exact 5 MiB boundaries, queue replay, preservation, and cleanup; web image-contract tests for every native-emitted type. |
| 2. Duplicate native mutations | Add single-flight mutation ownership with stable retry identity and operation-specific progress. | Executable state tests for repeated taps, conflicting actions, success/failure unlock, offline retry, stable mutation IDs, and `idempotency_in_progress`. |
| 3. Native provider controls | Add separate Google and GitHub controls through the validated first-party authorize flow and restore ordinary SSO reuse. | Web authorize/provider-hint security tests plus native auth-session tests for both controls, shared locking, PKCE/state continuity, invalid hints, and non-ephemeral default. |
| 4. Demo-source cleanup | Replace active fixed demo identities with disposable per-run setup/teardown and explicit local-only seeding. | Seed-target tests, e2e lifecycle tests, source-policy scan excluding immutable historical migrations, and zero fixed reusable credentials in active docs/source. |
| 5. Clem credential | Require account-owner provider linkage, recovery verification, and authorization before password retirement. | Provider-link verification plus owner authorization, or durable `BLOCKED_HUMAN` evidence with no premature credential removal. |
| 6. Native Photo Studio UX | Make Spoon fields conditional, use an optional date control, add initial direction, truthful outcomes, automatic activation, and complete progress/error states. | Fresh default, Spoon-off, editorial-off, processing, failure, empty, and narrow-layout screenshots on iPhone, iPad, and macOS, plus direct authenticated web desktop/mobile screenshots for every named state; accessibility proof and closed absurdity ledger. |
| 7. Repository failure | Remove only reviewed generated artifacts and tracked local databases/backups, preserve durable Markdown, and add artifact/size/manifest gates. | Private secret scan, changed-file manifest, hygiene/PR-size tests, clean tracked-file scan, and `git count-objects -vH` history assessment with recorded no-rewrite/rewrite disposition. |
| 8. OAuth drift/resilience | Bound provider calls, separate upstream failure from missing email, and make the clean Apple social callback the default while retaining compatibility. | Provider timeout/error tests, callback compatibility tests, production Google/GitHub/Apple start-and-callback checks, and reconciled environment/docs contracts. |
| 9. TestFlight notes | Bind release notes to the exact published source/build and reject stale metadata. | `TestFlightAutomationContractTests`, publish preflight failure tests, and App Store Connect evidence for exact build number, source SHA, notes, group, and status. |
| 10. Local cleanup | Add safe supported teardown for e2e OAuth clients and their disposable references. | Cleanup-script branch coverage and before/apply/after local runs ending with zero disposable users, clients, credentials, codes, tokens, recipes, and cookbooks. |
| 11. Oversized modules | Extract cover services, schemas/codecs, staging/transcoding, mutation orchestration, and presentation behind unchanged contracts. | Existing REST/MCP/native contract suites plus extraction-specific tests, 100% changed-code coverage, typecheck/build, and public-surface parity. |
| 12. Residual hardening | Enforce compatible CSP, database-bound My Recipes search, reveal following home content, and restore advisory visibility. | Enforced-header tests and production headers; query-bound search tests proving no full owner-corpus filtering; mobile/desktop hero screenshots; advisory CI that fails on scanner errors and actionable findings. |

- Final web matrix: `pnpm run typecheck`, `pnpm run typecheck:scripts`, `pnpm test:coverage`, `pnpm test:e2e`, `pnpm build`, and `pnpm build-storybook` with zero warnings and 100% changed-code coverage.
- Final native matrix: `swift test`, `scripts/verify-native-scenarios.sh`, `scripts/validate-native-local.sh`, iOS/macOS app-target builds, `scripts/capture-native-screenshot-matrix.sh`, `scripts/smoke-ios-simulator.sh`, and `scripts/smoke-macos.sh` with zero warnings and enforced core coverage.

| Audit finding(s) | Rollback surface | Trigger | Known-good state | Compatibility requirement | Rollback mechanics | Post-rollback proof |
| --- | --- | --- | --- | --- | --- | --- |
| 7, 8, 9, 12 | Web release automation/deploy | Exact-SHA gate misroutes, deploy fails, or production smoke regresses. | Web `b22c5fec`. | Any migration in this run is additive/backward-compatible; no rollback may require destructive D1 reversal. | Revert the workflow/config commit; deploy the known-good SHA through the validated manual exact-SHA path. | Cloudflare reports the selected SHA; readiness/public/API/MCP/provider smokes pass; residue remains zero. |
| 3, 8 | Web OAuth/provider hints/Apple callback | Provider canary, state/PKCE, linking, callback, or timeout behavior regresses. | Legacy callback/start behavior at `b22c5fec`. | Existing clients without hints and both Apple callback paths remain supported through rollout. | Flip new Apple starts to legacy configuration or revert W2 while leaving provider registration additive. | Google/GitHub/Apple starts and callbacks, legacy clients, and account linking pass. |
| 1, 2, 3, 6 | Native app behavior | Crash, image corruption, duplicate mutation, auth, queue replay, or Photo Studio smoke regresses. | TestFlight build 35 from `bad81b49`. | Native queue/request formats remain backward-compatible with deployed web and prior staged data. | Stop candidate rollout and keep build 35 available; TestFlight uses a forward-fix build rather than removing installed binaries. | Build 35 remains installable; production APIs accept old/new clients; forward-fix candidate reruns the full native matrix. |
| 4, 10 | Demo/local OAuth cleanup | Dry-run ownership differs from apply set, non-disposable rows appear, or verification counts mismatch. | Pre-apply local DB snapshot and manifest. | Cleanup is local-only, ID/ownership-scoped, and transactional; production is never an apply target. | Roll back the transaction or restore the private local snapshot; fix matcher before retry. | Dry-run/apply IDs match, retained-user checksums match, and disposable residue is zero. |
| 5 | Clem emergency credential | Provider or recovery verification fails before or after password retirement. | Clem's currently working password credential remains active. | Never remove it until a fresh provider login and recovery path both succeed and Clem authorizes retirement. | Abort before mutation if prechecks fail. If replacement access later fails after removal, use the authorized account-recovery procedure to issue a new temporary credential; never restore the old shared password. | Fresh provider login and recovery succeed, and password login is rejected only after replacement access is verified. |
| 7 | Repository artifact cleanup | Manifest contains an ambiguous/legitimate fixture, secret triage is incomplete, or post-delete tests fail. | Pre-cleanup branch refs and reviewed removal manifest. | No history rewrite; durable Markdown and legitimate fixtures remain tracked. | Abort before commit or revert the cleanup commit; restore only manifest paths from the pre-cleanup ref. | Tracked-file policy passes, preserved-file checks pass, repository tests/builds are green. |
| 11, 12 | Cover module extraction/search | Public contract snapshot, parity, scale, or migration verification fails. | Last green pre-extraction/search commit. | Extraction is behavior-only; search migrations are additive and old code can run with them present. | Revert the code commit while leaving harmless additive schema/index state; fix forward before retry. | REST/MCP/native contracts and My Recipes parity/bounds pass. |
| 12 | CSP/home/advisory gates | Required asset blocked, visual regression, scanner false positive, or scanner outage. | Pre-change headers/layout/workflow; CSP report-only mode. | No data migration; scanner exceptions require explicit expiry and evidence. | Revert the independent commit or switch CSP to report-only; never silently bypass scanner failures. | Production headers/assets/screenshots pass; advisory job is healthy or a time-bounded reviewed exception is visible. |
| 9 | TestFlight metadata/publish | Notes/SHA/build/group mismatch or installed smoke fails. | Build 35 plus final pre-publish candidate metadata. | App Store Connect metadata changes do not mutate user data. | Stop tester notification/rollout; correct metadata or publish a forward-fix build from a newly green exact SHA. | Source SHA, build number, notes, internal group, tester count, status, and installed smoke all agree. |

## Notes
Repo-local `subagents/work-planner.md` and `subagents/work-doer.md` were unavailable, so the current installed Work Suite skills are the execution source.

## Progress Log
- 2026-07-15 11:54 Created
- 2026-07-15 12:02 Added cross-repo artifact, secret-triage, and exact-SHA release-gate findings from independent exploration.
- 2026-07-15 12:05 Added finding-level traceability, executable evidence matrices, exact release closure, safe cleanup boundaries, and human-only credential disposition after harsh review.
- 2026-07-15 12:16 Fresh planning review converged with PASS after release containment, human-only actions, rebaseline, numeric native contracts, OAuth rollout, and cleanup guardrails were made explicit.
- 2026-07-15 12:18 Reopened review to add a finding-level rollback matrix, transactional cleanup recovery, and direct web Photo Studio visual evidence after a second independent gate.
- 2026-07-15 12:20 Mapped every audit finding to rollback coverage and added the missing Clem credential recovery boundary.
