# Doing: Spoonjoy Audit Remediation

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-07-15 11:54
**Planning**: ./2026-07-15-1152-planning-audit-remediation.md
**Artifacts**: ./2026-07-15-1152-doing-audit-remediation/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts only when the user explicitly requested interactive per-unit approval; otherwise convert this to `spawn` or `direct` unless a hard exception is present
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default); selected, with fresh reviewers on every PR boundary and non-trivial visual surface

## Objective
Bring the shipped Recipe Photo Studio, OAuth, data hygiene, repository hygiene, performance, and release surfaces to done-quality across the web, native Apple, REST, and MCP clients. Close every actionable finding from the 2026-07-15 audit, ship the resulting changes, and verify the consuming production and TestFlight surfaces.

## Upstream Work Items
- 2026-07-15 shipped-work audit at `/tmp/spoonjoy-latest-model-audit/audit-report.md`

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

## TDD Requirements
**Strict TDD - no exceptions:**
1. **Tests first**: Write failing tests BEFORE any implementation
2. **Verify failure**: Run tests, confirm they FAIL (red)
3. **Minimal implementation**: Write just enough code to pass
4. **Verify pass**: Run tests, confirm they PASS (green)
5. **Refactor**: Clean up, keep tests green
6. **No skipping**: Never write implementation without failing test first

## Work Units

### Legend
Not started `[ ]` · In progress `[~]` · Done `[x]` · Blocked `[!]`

**CRITICAL: Every unit header starts with a status marker.**

### [ ] Unit 0: Rebaseline, Ownership, And Private Inventory
**What**: Fetch both remotes, compare current remote heads with audited SHAs, reconcile branch drift without discarding concurrent work, refresh the finding/file map, inspect worktree ownership, inventory every proposed artifact removal, privately scan tracked databases/environment backups/generated evidence without printing values, and instantiate the planning rollback matrix with current refs/builds.
**Output**: Evidence index entries for audited/current SHAs, branch/worktree classification, redacted scan result, removal manifests, callback/provider configuration baseline, known-good refs/build, compatibility constraints, and rollback commands/checks.
**Acceptance**: Both remediation branches contain current remote heads; every removal has `remove`, `preserve`, or `human-review` disposition; dirty/unmerged work is excluded; confirmed secrets are rotated before deletion or marked `BLOCKED_HUMAN`; no user data is printed; every rollback row has an executable trigger/mechanic/proof.

### [ ] Unit 1a: Web Release-Containment Tests
**What**: Add failing workflow/source-contract tests proving production deploy cannot run for a `main` SHA until required CI checks for that exact SHA succeed, manual dispatch validates an exact SHA, and deployment records that SHA.
**Output**: Focused workflow contract tests under `test/config/` or `test/scripts/`.
**Acceptance**: Exact focused test command fails against the current independent push-triggered deploy workflow.

### [ ] Unit 1b: Web Release-Containment Implementation
**What**: Gate `.github/workflows/production-deploy.yml` on successful CI for the exact source SHA, retain an exact-SHA validated manual recovery path, and make deployment/smoke evidence record that SHA.
**Output**: Workflow/script changes; atomic web PR W1.
**Acceptance**: Unit 1a passes; a simulated stale/failed/mismatched SHA is rejected; a green exact SHA is accepted; rollback is reverting W1 to the prior trigger.

### [ ] Unit 1c: Web Release-Containment Verification
**What**: Run focused workflow tests, typecheck scripts, full coverage, build, and a fresh security/release reviewer.
**Acceptance**: 100% changed-code coverage, zero warnings, reviewer PASS, W1 CI green, W1 merged, and its deployment SHA recorded before later web PRs.

### [ ] Unit 2a: Native TestFlight-Containment Tests
**What**: Add failing source-contract tests proving TestFlight publishes only an explicitly selected SHA with a successful required Native run, release notes match that SHA/build, and the distribution toolkit/actions use immutable revisions.
**Output**: `Tests/SpoonjoyCoreTests/TestFlightAutomationContractTests.swift` and focused workflow contract coverage.
**Acceptance**: Tests fail against automatic `main` publishing, mutable toolkit checkout, or stale note mapping.

### [ ] Unit 2b: Native TestFlight-Containment Implementation
**What**: Convert TestFlight publishing to an exact-SHA release-candidate dispatch after Native checks, pin the distribution toolkit/actions to reviewed commits, and preserve a documented rollback dispatch.
**Output**: `.github/workflows/testflight.yml`, distribution scripts/config; atomic native PR N1.
**Acceptance**: Unit 2a passes; no interim native merge can publish; exact-SHA dispatch rejects absent/failed Native runs and accepts a green candidate.

### [ ] Unit 2c: Native TestFlight-Containment Verification
**What**: Run TestFlight contracts, Swift tests, scenario verifier, app-target builds, and fresh release/security review.
**Acceptance**: Zero warnings, reviewer PASS, N1 CI green and merged, with no unexpected build published.

### [ ] Unit 3a: Backward-Compatible OAuth Contract Tests
**What**: Add failing web tests for signed/validated `google|github` provider hints through first-party client validation, redirect preservation, consent, state, PKCE, linking, unknown hints, cancellation, bounded provider calls, timeout/upstream/missing-email taxonomy, dual Apple callback paths, and clean-start rollback.
**Output**: Focused auth route/lib tests covering outgoing provider URLs, parameters, headers, bodies, and timeout behavior.
**Acceptance**: Tests fail for absent provider hint, unbounded calls, misleading GitHub email errors, or legacy-only Apple starts.

### [ ] Unit 3b: Backward-Compatible OAuth Implementation
**What**: Implement validated provider routing through `/oauth/authorize`, bounded Google/GitHub exchanges and user-info calls, truthful error classification, dual Apple callback support, clean-start configuration, reconciled docs/environment examples, and legacy rollback.
**Output**: Web auth route/lib/docs/config changes; atomic web PR W2.
**Acceptance**: Unit 3a passes; existing clients without hints behave unchanged; invalid hints cannot alter redirect/client/state; legacy Apple callback remains functional.

### [ ] Unit 3c: OAuth Verification And Callback Registration
**What**: Run focused/full auth coverage, typecheck/build, fresh security reviewer, register the clean Apple callback through an authorized session, deploy W2, verify both callback paths, switch new starts, and run Google/GitHub/Apple live canaries.
**Acceptance**: W2 exact SHA is live; all provider starts/callbacks pass; timeout/error telemetry is truthful; clean callback is default with monitored legacy compatibility, or portal registration is durably `BLOCKED_HUMAN` without an unsafe switch.

### [ ] Unit 4a: Native Cover Image Normalization Tests
**What**: Add failing tests for real HEIC/HEIF/default-camera samples, orientation, corrupt input, JPEG/PNG/WebP, oversized input, 2048-pixel longest edge, adaptive JPEG quality, exact 5 MiB boundary, prior-stage preservation, immediate upload, offline durable staging, replay, and emitted filename/MIME/bytes.
**Output**: Cover transcoder tests plus cover surface, staging, API request, and sync replay contract updates.
**Acceptance**: Tests fail because raw HEIC and over-contract bytes can currently reach staging/transport.

### [ ] Unit 4b: Native Cover Image Normalization Implementation
**What**: Add a cover-specific ImageIO normalizer that applies orientation, bounds dimensions, emits JPEG, adaptively fits the 5 MiB contract, and leaves prior state untouched on failure; route both immediate and queued paths through it.
**Output**: Dedicated cover image normalization module and narrow caller changes; atomic native PR N2.
**Acceptance**: Unit 4a passes; no native cover request or queued replay emits HEIC/HEIF or bytes above the server ceiling.

### [ ] Unit 4c: Native Cover Image Verification
**What**: Run focused cover/cache/sync/API tests, Swift coverage, scenario verifier, app-target builds, and fresh implementation/performance review.
**Acceptance**: 100% new-code coverage, zero warnings, reviewer PASS, N2 CI green and merged.

### [ ] Unit 5a: Native Mutation Single-Flight Tests
**What**: Add failing executable tests for the all-cover-operation conflict matrix, synchronous double taps, stable IDs across same-payload retries/offline ownership/replay, payload change/cancel, dismissal, success/failure unlock, `idempotency_in_progress`, transient stage retention on error, and clearing only after server success or durable queue ownership.
**Output**: Pure mutation-state tests and route integration contracts.
**Acceptance**: Tests fail because actions currently spawn untracked concurrent tasks with fresh UUIDs.

### [ ] Unit 5b: Native Mutation Single-Flight Implementation
**What**: Implement a testable cover mutation state machine, globally disable conflicting cover controls, show operation-specific progress, preserve retry identity, and clear UI staging at the correct ownership boundary.
**Output**: Cover mutation state/orchestration module and route wiring; atomic native PR N3.
**Acceptance**: Unit 5a passes; double taps cannot create two plans; failure remains retryable with the same identity and staged selection.

### [ ] Unit 5c: Native Mutation Verification
**What**: Run focused route/cover/sync tests, coverage, scenario verifier, app-target builds, and fresh concurrency/idempotency review.
**Acceptance**: 100% new-code coverage, zero warnings, reviewer PASS, N3 CI green and merged.

### [ ] Unit 6a: Native Provider-Specific Sign-In Tests
**What**: Add failing native tests for distinct Google/GitHub controls, provider-specific first-party authorization URLs, shared pending lock, state/PKCE continuity, cancellation, error recovery, accessibility identifiers, non-ephemeral default on iOS/macOS, and unchanged Apple/password paths.
**Output**: `NativeAuthSessionTests.swift`, `OAuthRequestTests.swift`, and signed-out surface contracts.
**Acceptance**: Tests fail against the generic button and forced ephemeral browser session.

### [ ] Unit 6b: Native Provider-Specific Sign-In Implementation
**What**: Add first-class Google and GitHub controls backed by the deployed provider-hint flow, share in-flight state, restore browser SSO reuse, and keep privacy mode out unless explicitly surfaced later.
**Output**: Native auth model/session and signed-out UI changes; atomic native PR N4.
**Acceptance**: Unit 6a passes; each button reaches only its named provider while preserving first-party authorize security.

### [ ] Unit 6c: Native Sign-In Coverage And Build
**What**: Run focused/full Swift tests, coverage, scenario verifier, iOS/macOS app-target builds, and fresh auth/security review.
**Acceptance**: 100% new-code coverage, zero warnings, reviewer PASS, N4 CI green and merged after W2 is live.

### [ ] Unit 6d: Native Signed-Out Visual QA Dogfood
**What**: Capture fresh iPhone, iPad, and macOS signed-out screenshots; inspect provider recognition, loading/disabled states, spacing, Dynamic Type, VoiceOver labels, and nearby password/Apple controls.
**Acceptance**: Evidence index points to external screenshots; absurdity ledger has no ready/reviewer-gated item; fresh visual reviewer PASS.

### [ ] Unit 7a: Native Photo Studio Product-Truth Tests
**What**: Add failing tests for Spoon-field gating/nil suppression, optional DatePicker ISO output, note/next-time prompts, multiline initial editorial direction, dynamic outcome labels, automatic activation from Spoon, cover/generation/action processing, failure recovery, and deterministic screenshot fixtures.
**Output**: Pure draft-to-request tests, cover surface tests, screenshot route contracts, accessibility proof contracts, and route-count updates.
**Acceptance**: Tests fail against unconditional Spoon copy/fields, raw cooked-at text, missing upload direction, `activate: false`, generic submit copy, or absent Photo Studio route.

### [ ] Unit 7b: Native Photo Studio Product-Truth Implementation
**What**: Split draft mapping/presentation from route orchestration, conditionally reveal Spoon metadata, add optional date and multiline direction, compute truthful outcomes, activate editorial/Spoon covers by default, and present loading-chip/progress/error states without layout shift.
**Output**: Native Photo Studio UI/model/harness changes; atomic native PR N5.
**Acceptance**: Unit 7a passes; default path is minimum-click Spoon plus editorial cover; Spoon-off and editorial-off requests omit irrelevant fields and say what will happen.

### [ ] Unit 7c: Native Photo Studio Coverage And Build
**What**: Run focused/full Swift coverage, scenario verifier, project contracts, iOS/macOS app-target builds, warning scan, and fresh implementation/accessibility review.
**Acceptance**: 100% new-code coverage, zero warnings, reviewer PASS, N5 CI green and merged.

### [ ] Unit 7d: Photo Studio Visual QA Dogfood
**What**: Capture default, Spoon-off, editorial-off, processing, failure, empty/no-cover, and narrow/dense states on iPhone, iPad, and macOS; capture corresponding web Photo Studio mobile/desktop states; inspect actual images, controls, copy, overlap, and progress.
**Acceptance**: External screenshot evidence and accessibility proofs exist; all absurdity-ledger items are fixed/accepted with rationale; fresh native and web visual reviewers PASS.

### [ ] Unit 8a: Demo-Source Policy Tests
**What**: Add failing source-policy, seed-target, generated-identity, and e2e lifecycle tests covering active seed code, CI seed calls, `GUIDE.md`, UI audit docs, feedback, e2e auth, teardown, and immutable historical-migration allowlists.
**Output**: Seed/e2e/source-policy tests and disposable identity factory contracts.
**Acceptance**: Tests fail on fixed Spoonjoy demo identities, reusable passwords, implicit seed target, or missing teardown.

### [ ] Unit 8b: Demo-Source Eradication Implementation
**What**: Replace active fixed accounts/credentials with per-run disposable setup/teardown, require explicit `--target-env local` for development seeds, update CI/scripts/docs, and quarantine historical migration references without editing applied SQL.
**Output**: Seed/e2e/docs/CI changes; atomic web PR W3.
**Acceptance**: Unit 8a passes; CI creates and tears down disposable users; no active source teaches reusable demo credentials.

### [ ] Unit 8c: Demo-Source Verification
**What**: Run source-policy, seed, e2e, cleanup dry-run/apply, full coverage/typecheck/build, and fresh data-safety reviewer.
**Acceptance**: Zero fixed active demo identities, zero disposable residue, 100% changed-code coverage, zero warnings, W3 CI green and merged.

### [ ] Unit 9a: Local OAuth Teardown Tests
**What**: Add failing cleanup tests for disposable e2e OAuth clients and dependent credentials/codes/tokens, dry-run/apply parity, manifest IDs, local snapshot metadata, transaction rollback, non-disposable ownership refusal, partial failures, reruns, recovery, and exact residue reporting.
**Output**: Cleanup helper/script tests.
**Acceptance**: Tests fail because supported teardown cannot currently remove the eight clients and fourteen dependent references safely.

### [ ] Unit 9b: Local OAuth Teardown Implementation
**What**: Add local-only dependency-aware teardown for generated e2e clients and disposable references, with explicit target checks, pre-apply private snapshot/manifest, one transaction, post-apply retained-owner checksums, recovery instructions, and hard refusal for non-disposable users outside the generated test contract.
**Output**: Cleanup script/helper changes; atomic web PR W4.
**Acceptance**: Unit 9a passes; local before/apply/after ends at zero disposable clients, credentials, codes, tokens, users, recipes, and cookbooks without touching retained users.

### [ ] Unit 9c: Local OAuth Teardown Verification
**What**: Run focused/full script coverage, typecheck scripts, local cleanup twice, and fresh safety reviewer.
**Acceptance**: Idempotent zero-residue result, 100% new-code coverage, zero warnings, W4 CI green and merged.

### [ ] Unit 10a: Repository Hygiene Guard Tests
**What**: Add failing web/native tests for tracked databases, environment backups, generated task extensions, screenshot/log/result dumps, legitimate fixture allowlists, durable Markdown preservation, PR size thresholds, required large-change manifest, and artifact evidence indexing outside source.
**Output**: Web repo-hygiene tests, native artifact-audit contracts, and removal manifests.
**Acceptance**: Tests fail on the current tracked artifact/database/backups and missing PR-size gates.

### [ ] Unit 10b: Current-Tree Artifact Cleanup And Guard Implementation
**What**: Privately scan then remove only manifest-approved generated artifacts from both current trees, preserve durable task docs and real fixtures, remove tracked local DB/backups, add pre-cleanup refs and ownership checks, add ignores/guards/manifests/recovery commands, and update validation scripts to emit raw evidence into ignored/external storage.
**Output**: Atomic web PR W5 and native PR N6, each with human-readable changed-file manifest.
**Acceptance**: Unit 10a passes; no unmanifested task-owned generated artifacts remain; no dirty/unmerged worktree is removed; any confirmed secret was rotated first.

### [ ] Unit 10c: Repository Hygiene And History Disposition
**What**: Run redacted secret scans, tracked-file policy, PR-size gates, full repo tests/builds, `git count-objects -vH`, reachability/worktree checks, and fresh security/repository reviewers.
**Acceptance**: W5/N6 CI green and merged; current trees are clean; manifest recovery is test-proven; large-history disposition records no rewrite unless separately authorized; raw evidence is external and durable indexes remain.

### [ ] Unit 11a: Web Cover Boundary Contract Tests
**What**: Add/strengthen public REST/MCP/OpenAPI/idempotency/ownership/rollback contract snapshots around recipe cover behavior before extraction, including outgoing request assertions.
**Output**: Focused contract tests around current API and MCP boundaries.
**Acceptance**: Baseline contracts pass before extraction and fail under deliberate temporary boundary perturbation.

### [ ] Unit 11b: Web Cover Service Extraction
**What**: Extract cover schemas, image/upload/generation/activation services, REST controllers, and MCP adapters from oversized modules behind unchanged public contracts.
**Output**: Cohesive cover modules with thin `api-v1.server.ts` and `spoonjoy-api.server.ts` delegation; atomic web PR W6.
**Acceptance**: Unit 11a remains green; no route, envelope, scope, ownership, idempotency, rollback, or MCP tool behavior changes.

### [ ] Unit 11c: Web Cover Extraction Verification
**What**: Run focused/full coverage, typecheck, build, OpenAPI generation diff, MCP tests, and fresh architecture/API/security review.
**Acceptance**: 100% changed-code coverage, zero warnings, reviewer PASS, W6 CI green and merged.

### [ ] Unit 12a: Native Cover Boundary Contract Tests
**What**: Pin cover staging, request codec, queue factory, replay transport, mutation planning, and presentation contracts before extraction.
**Output**: Focused native cover/sync/API contract tests.
**Acceptance**: Baseline contracts pass and detect deliberate temporary codec/planner perturbation.

### [ ] Unit 12b: Native Cover Boundary Extraction
**What**: Extract cover codecs/queue transport from `NativeSyncEngine.swift` and separate staging/transcoding, mutation orchestration, and presentation without broadly weakening visibility.
**Output**: Narrow internal cover modules; atomic native PR N7.
**Acceptance**: Unit 12a remains green; queued wire format, retry behavior, public API, and UI outcomes are unchanged.

### [ ] Unit 12c: Native Cover Extraction Verification
**What**: Run focused/full Swift coverage, scenario verifier, app-target builds, project generation contracts, warning scan, and fresh architecture/concurrency review.
**Acceptance**: 100% changed-code coverage, zero warnings, reviewer PASS, N7 CI green and merged.

### [ ] Unit 13a: Database-Bounded My Recipes Search Tests
**What**: Add failing parity tests for owner scoping, title/description/ingredient matching, case/whitespace/special characters, pagination/order, empty/no-result states, large owner corpus, bounded rows/query count, and D1 variable limits.
**Output**: Search service/route tests plus query instrumentation.
**Acceptance**: Tests fail because the loader currently materializes and filters the entire owner corpus in application code.

### [ ] Unit 13b: Database-Bounded My Recipes Search Implementation
**What**: Move matching and pagination into the D1 query boundary, add only justified indexes/migration, preserve route semantics, and keep query/result work bounded.
**Output**: Search service/route and optional migration changes; atomic web PR W7.
**Acceptance**: Unit 13a passes with stable result parity and bounded query/row assertions at scale.

### [ ] Unit 13c: Search Verification
**What**: Run focused/full coverage, migration idempotency, typecheck/build, local D1 scale fixture, and fresh database/performance reviewer.
**Acceptance**: 100% changed-code coverage, zero warnings, no full-corpus application filtering, W7 CI green and merged.

### [ ] Unit 14a: CSP Enforcement Tests
**What**: Add failing tests for enforced production CSP, nonce/script behavior, required image/style/connect sources, report-only QA comparison, violation telemetry, and one-commit rollback.
**Output**: Security-header/config/browser tests.
**Acceptance**: Tests fail because production only emits report-only CSP.

### [ ] Unit 14b: CSP QA Enforcement Implementation
**What**: Tighten compatible sources, preserve nonce behavior, add violation reporting, enforce in QA, and keep a documented report-only rollback flag/commit.
**Output**: Security header/config/ops changes; atomic web PR W8 after QA proof.
**Acceptance**: QA browser/Photo Studio/OAuth/MCP/API surfaces load without CSP violations or blocked required assets; attacker-style inline/script probes are blocked.

### [ ] Unit 14c: CSP Production Verification
**What**: Run full coverage/build/e2e, fresh security review, merge W8, verify exact production headers and live surfaces, and watch violation telemetry before closing rollback readiness.
**Acceptance**: Production sends enforced CSP; core surfaces and provider starts remain healthy; rollback is tested and documented; W8 exact SHA is recorded.

### [ ] Unit 15a: Home Hero Viewport Tests
**What**: Add failing responsive tests proving the first viewport preserves brand/product signal while revealing following content on mobile, desktop, and wide desktop without overlap or font viewport scaling.
**Output**: Route/component responsive tests and visual fixture updates.
**Acceptance**: Tests fail against the current full-viewport desktop hero.

### [ ] Unit 15b: Home Hero Implementation
**What**: Adjust stable hero height/spacing so the next section is visibly discoverable while preserving the real food image, typography, and current product language.
**Output**: Narrow home route/style change; atomic web PR W9.
**Acceptance**: Unit 15a passes with no public copy/provenance regression.

### [ ] Unit 15c: Home Hero Coverage And Build
**What**: Run focused/full coverage, typecheck/build, accessibility checks, and fresh implementation review.
**Acceptance**: 100% changed-code coverage, zero warnings, reviewer PASS, W9 CI green and merged.

### [ ] Unit 15d: Home Visual QA Dogfood
**What**: Capture and inspect mobile, desktop, and wide-desktop public home screenshots with the next section visible.
**Acceptance**: External screenshots show no overlap, awkward crop, unreadable copy, or hidden continuation; absurdity ledger closed; fresh visual reviewer PASS.

### [ ] Unit 16a: Advisory-Pipeline Contract Tests
**What**: Add failing workflow/script tests for a version/SHA-pinned supported scanner, lockfile coverage, scanner/network failure, actionable vulnerability failure, explicit time-bounded allowlists, and Ruby dependency coverage.
**Output**: CI/security workflow contracts in both repos.
**Acceptance**: Tests fail because current CI has no supported advisory gate.

### [ ] Unit 16b: Advisory-Pipeline Implementation
**What**: Add pinned OSV-compatible dependency scanning for web lockfiles and pinned Ruby advisory scanning for native release tooling; fail closed on scanner errors and actionable findings.
**Output**: Atomic web PR W10 and native PR N8 with documented severity/allowlist policy.
**Acceptance**: Unit 16a passes; synthetic vulnerable and scanner-error fixtures fail; clean graphs pass.

### [ ] Unit 16c: Advisory Verification And Remediation
**What**: Run real scans, fix or time-bound-review every finding, run full repo validation, and obtain fresh security reviewer PASS.
**Acceptance**: W10/N8 CI green and merged; no unreviewed actionable advisory or silent scanner failure remains.

### [ ] Unit 17a: Build-Specific TestFlight Notes Tests
**What**: Add failing tests tying source SHA, build number, user-facing change manifest, and release-note freshness; require notes to mention current Photo Studio, image, mutation, and provider-sign-in changes.
**Output**: TestFlight automation contract tests and release metadata fixtures.
**Acceptance**: Tests fail against stale build-35 browser-auth-only notes.

### [ ] Unit 17b: Build-Specific TestFlight Notes Implementation
**What**: Make notes generated/validated from the designated release candidate and update exact user-facing copy for the new build.
**Output**: Distribution metadata/scripts/docs; atomic native PR N9.
**Acceptance**: Unit 17a passes; publishing refuses stale/mismatched notes and accepts exact candidate metadata.

### [ ] Unit 17c: TestFlight Metadata Verification
**What**: Run focused/full native validation and fresh release-copy/automation review.
**Acceptance**: 100% changed-code coverage, zero warnings, reviewer PASS, N9 CI green and merged without publishing before final candidate selection.

### [ ] Unit 18: Final Web Validation And Implementation Review
**What**: From clean current `origin/main`, run `pnpm cleanup:qa`, local migrations twice, API generation diff, typechecks, full 100% coverage, e2e, production build, Storybook build, repo/advisory gates, and fresh implementation/test/security/visual reviewers.
**Output**: Durable evidence index with CI/run URLs, SHAs, checksums, screenshot references, and zero-residue summary; raw logs remain ignored/external.
**Acceptance**: Every command/check exits zero with no warnings; all reviewer BLOCKER/MAJOR findings are fixed and the matrix rerun on the resulting exact SHA.

### [ ] Unit 19: Web Exact-SHA Deploy And Production Dogfood
**What**: Verify release containment selects the final green web SHA, deploy it, record Cloudflare version/SHA, run production readiness, public/API/MCP/provider/callback smokes, authenticated owner Photo Studio upload/editorialize/Spoon/placeholder/regenerate/activate/archive flow, responsive screenshots, and finally cleanup.
**Output**: Deployment/run URLs and redacted evidence index entries.
**Acceptance**: Exact SHA is live; all smokes and visual review pass; production cleanup reports zero disposable residue; owner smoke is complete or explicitly `BLOCKED_HUMAN` without concealing it.

### [ ] Unit 20: Final Native Validation And Implementation Review
**What**: From clean current `origin/main`, run Swift tests, enforced coverage, scenario verifier, project/generator contracts, iOS/macOS app-target builds, full screenshot matrix, simulator/macOS smokes, repo/advisory gates, accessibility proof, and fresh implementation/test/security/visual reviewers.
**Output**: Durable evidence index with exact SHA, CI URLs, external screenshot references, design review, and zero-warning summary.
**Acceptance**: Every command/check exits zero; 100% changed-code coverage; all reviewer BLOCKER/MAJOR findings fixed and matrix rerun on the release-candidate SHA.

### [ ] Unit 21: Exact-SHA TestFlight Publish And Installed Dogfood
**What**: Dispatch TestFlight for Unit 20's exact SHA, wait through processing, verify build number/source SHA/current notes/`Spoonjoy Internal` attachment/nonzero testers/notification/`IN_BETA_TESTING`, then dogfood installed signed-out auth and Photo Studio flows against production.
**Output**: App Store Connect/build/group evidence and installed-build screenshots/smoke summary.
**Acceptance**: Exact candidate is available to internal testers with current notes; installed app passes provider, HEIC, mutation-lock, queue replay, Photo Studio, and cleanup checks.

### [ ] Unit 22: Human-Only Closure, Cleanup, And Durable Continuation Scan
**What**: Complete or durably classify the four planning-table human actions, preserve any blocked prerequisite, update planning/doing/Desk state, scan feedback/backlogs/PRs/CI/deploy/TestFlight/cleanup for ready work, remove only clean terminal remediation worktrees, prune only merged proven-stale branches, and notify Slugger.
**Output**: Terminal docs/Desk state, worktree/branch inventory, human-action dispositions, continuation scan, and `ouro msg --to slugger` result.
**Acceptance**: No ready in-scope work remains; independent work is shipped; audit task is `done` only if human-only closure is complete, otherwise remains `BLOCKED_HUMAN` with one exact required action and no hidden partial state.

## Execution
- **TDD strictly enforced**: tests -> red -> implement -> green -> refactor
- Commit after each phase (a, b, c)
- Push after each unit complete
- Run full test suite before marking unit done
- For UI/rendering/layout units, run `visual-qa-dogfood` before declaring the unit or task complete
- **All artifacts**: Keep only a durable evidence index in `./2026-07-15-1152-doing-audit-remediation/`; save raw logs, screenshots, data, and binaries to ignored local storage or CI artifacts so product repositories do not accumulate generated evidence
- **Fixes/blockers**: Spawn sub-agent immediately; do not ask unless the planning human-only table applies
- **Decisions made**: Update docs immediately, commit, and push
- PR boundaries W1-W10 and N1-N9 are independently releasable; web backward-compatible OAuth W2 must be live before native N4, and TestFlight publishes only Unit 20's selected SHA

## Progress Log
- 2026-07-15 12:16 Created from approved planning doc
