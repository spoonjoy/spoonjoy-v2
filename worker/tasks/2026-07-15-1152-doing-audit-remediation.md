# Doing: Spoonjoy Audit Remediation

**Status**: READY_FOR_EXECUTION
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
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

**CRITICAL: Every unit header starts with a status marker.**

### ✅ Unit 0: Rebaseline, Ownership, And Private Inventory
**What**: Fetch both remotes, compare current remote heads with audited SHAs, reconcile branch drift without discarding concurrent work, refresh the finding/file map, inspect worktree ownership, inventory every proposed artifact removal, privately scan tracked databases/environment backups/generated evidence without printing values, instantiate the planning rollback matrix with current refs/builds, and initiate all five human-only actions at their earliest available prerequisite while independent work continues.
**Output**: Evidence index entries for audited/current SHAs, branch/worktree classification, redacted scan result, removal manifests, callback/provider configuration baseline, known-good refs/build, compatibility constraints, and rollback commands/checks.
**Acceptance**: Both remediation branches contain current remote heads; every removal has `remove`, `preserve`, or `human-review` disposition; dirty/unmerged work is excluded; confirmed secrets are rotated before deletion or marked `BLOCKED_HUMAN`; no user data is printed; every rollback row has an executable trigger/mechanic/proof.

### ⬜ Unit 1a: Web Release-Containment Tests
**What**: Add failing workflow/source-contract tests proving production deploy cannot run for a `main` SHA until required CI checks for that exact SHA succeed, manual dispatch validates an exact SHA, deployment records that SHA, and every mutable action/tool revision in `.github/workflows/ci.yml` and `.github/workflows/production-deploy.yml` is pinned or covered by an explicit reviewed justification.
**Output**: Focused workflow contract tests under `test/config/` or `test/scripts/`.
**Acceptance**: Exact focused test command fails against the current independent push-triggered deploy workflow.

### ⬜ Unit 1b: Web Release-Containment Implementation
**What**: Gate `.github/workflows/production-deploy.yml` on successful CI for the exact source SHA, retain an exact-SHA validated manual recovery path, make deployment/smoke evidence record that SHA, and pin or document every remaining mutable CI/deploy action/tool revision.
**Output**: Workflow/script changes; atomic web PR W1.
**Acceptance**: Unit 1a passes; a simulated stale/failed/mismatched SHA is rejected; a green exact SHA is accepted; rollback is reverting W1 to the prior trigger.

### ⬜ Unit 1c: Web Release-Containment Verification
**What**: Run the focused workflow tests, `pnpm run typecheck`, `pnpm run typecheck:scripts`, `pnpm test:coverage`, and `pnpm build`; scan logs for warnings; run a fresh security/release reviewer.
**Acceptance**: 100% changed-code coverage, zero warnings, reviewer PASS, W1 CI green, W1 merged, and its deployment SHA recorded before later web PRs.

### ⬜ Unit 2a: Native TestFlight-Containment Tests
**What**: Add failing source-contract tests proving TestFlight publishes only an explicitly selected SHA with a successful required Native run, a non-stale SHA-keyed note artifact is present, and every mutable action/tool revision in `.github/workflows/native.yml` and `.github/workflows/testflight.yml` including the distribution toolkit is pinned or explicitly justified. Unit 2 checks note-to-SHA trust structure; Unit 17 checks final user-facing note freshness/content.
**Output**: `Tests/SpoonjoyCoreTests/TestFlightAutomationContractTests.swift` and focused workflow contract coverage.
**Acceptance**: Tests fail against automatic `main` publishing, mutable toolkit checkout, or stale note mapping.

### ⬜ Unit 2b: Native TestFlight-Containment Implementation
**What**: Convert TestFlight publishing to an exact-SHA release-candidate dispatch after Native checks, pin or justify all native/TestFlight workflow actions and the distribution toolkit, require a SHA-keyed note artifact without prescribing final Unit 17 content, and preserve a documented rollback dispatch.
**Output**: `.github/workflows/testflight.yml`, distribution scripts/config; atomic native PR N1.
**Acceptance**: Unit 2a passes; no interim native merge can publish; exact-SHA dispatch rejects absent/failed Native runs and accepts a green candidate.

### ⬜ Unit 2c: Native TestFlight-Containment Verification
**What**: Run TestFlight contracts; `swift test --enable-code-coverage --disable-xctest --parallel -Xswiftc -warnings-as-errors`; `ruby scripts/fail-on-warning.rb --log <swift-log>`; `ruby scripts/enforce-swift-coverage.rb --coverage-json "$(swift test --show-codecov-path)" --minimum 100 --include Sources/SpoonjoyCore`; `scripts/verify-native-scenarios.sh --stage final`; iOS/macOS `xcodebuild` with warnings as errors; and fresh release/security review.
**Acceptance**: 100% new/changed core coverage, zero warnings, reviewer PASS, N1 CI green and merged, with no unexpected build published.

### ⬜ Unit 3a: Provider-Hint Contract Tests
**What**: Add failing tests in `test/routes/oauth-authorize.test.tsx`, `test/lib/oauth-route.server.test.ts`, and related login/auth route tests for signed/validated `google|github` hints, first-party client validation, redirect preservation, consent, state, PKCE, linking, cancellation, and unknown hints; assert outgoing provider URLs/parameters.
**Acceptance**: Focused tests fail because `/oauth/authorize` cannot route a validated named provider.

### ⬜ Unit 3b: Provider-Hint Implementation
**What**: Implement only additive provider-hint routing in `app/routes/oauth.authorize.tsx`, `app/lib/oauth-route.server.ts`, and the existing login/provider start seams; clients without hints remain unchanged.
**Output**: Atomic web PR W2.
**Acceptance**: Unit 3a reruns green; invalid hints cannot alter client/redirect/state; `pnpm test:coverage`, both typechecks, and build pass with 100% changed-code coverage and zero warnings before the implementation commit.

### ⬜ Unit 3c: Provider-Hint Verification
**What**: Run focused auth tests, `pnpm run typecheck`, `pnpm run typecheck:scripts`, `pnpm test:coverage`, `pnpm build`, and fresh auth/security review; merge/deploy W2.
**Acceptance**: W2 exact SHA is live, provider-hint canaries pass, existing no-hint clients pass, and reviewer returns PASS.

### ⬜ Unit 3d: Provider Resilience Tests
**What**: Add failing tests in `test/lib/google-oauth.server.test.ts`, `test/lib/github-oauth.server.test.ts`, and callback tests for bounded exchanges/user-info calls, timeout versus upstream failure versus genuinely missing verified email, retry classification, and outgoing request details.
**Acceptance**: Focused tests fail on unbounded calls or misleading GitHub email classification.

### ⬜ Unit 3e: Provider Resilience Implementation
**What**: Add bounded provider calls and truthful error taxonomy in `app/lib/google-oauth.server.ts`, `app/lib/github-oauth.server.ts`, and their callback seams without changing successful linking behavior.
**Output**: Atomic web PR W3.
**Acceptance**: Unit 3d reruns green; `pnpm test:coverage`, both typechecks, and build pass with 100% changed-code coverage and zero warnings before the implementation commit.

### ⬜ Unit 3f: Provider Resilience Verification
**What**: Run focused/full web matrices and fresh security/resilience review; merge/deploy W3 and run Google/GitHub success/timeout/error canaries.
**Acceptance**: W3 exact SHA is live, reviewer PASS, and production error telemetry distinguishes timeout/upstream/missing email.

### ⬜ Unit 3g: Dual Apple Callback Support Tests
**What**: Add failing tests in `test/routes/auth-apple.test.ts`, `test/routes/redwood-functions-auth-oauth.test.ts`, `test/lib/apple-oauth.server.test.ts`, and `test/lib/oauth-route.server.test.ts` for both callback paths, legacy-default starts, configuration validation, documentation/environment parity, and rollback.
**Acceptance**: Tests fail because runtime/documented callback contracts drift and clean dual support is not explicit.

### ⬜ Unit 3h: Dual Apple Callback Support Implementation
**What**: Add backward-compatible support for both social Apple callbacks, reconcile `.env.example`, `DEPLOY.md`, `docs/production-cutover.md`, and runtime source, but keep the legacy Apple start as the default.
**Output**: Atomic web PR W4.
**Acceptance**: Unit 3g reruns green; `pnpm test:coverage`, both typechecks, and build pass with 100% changed-code coverage and zero warnings before commit; no generated `redirect_uri` selects an unregistered callback.

### ⬜ Unit 3i: Dual Apple Callback Verification
**What**: Run focused/full web matrices and fresh security/config review; merge/deploy W4; verify the legacy path and direct clean callback handler without switching starts.
**Acceptance**: W4 exact SHA is live, legacy production sign-in remains healthy, clean handler is deploy-ready, reviewer PASS.

### ⬜ Unit 3j: Clean Apple Callback Registration And Canary
**What**: Through an authorized Apple Developer browser session, add the clean callback without removing the legacy one, then canary both paths. If access is unavailable, preserve the exact `BLOCKED_HUMAN` action and continue all independent work.
**Acceptance**: Portal evidence and both canaries pass before any start switch; no source/config change selects the clean callback early.

### ⬜ Unit 3k: Clean Apple Start-Switch Tests
**What**: Add failing configuration tests proving clean starts are allowed only after a recorded successful registration/canary prerequisite and legacy rollback remains selectable.
**Acceptance**: Tests fail while the legacy default remains and detect a switch without prerequisite evidence.

### ⬜ Unit 3l: Clean Apple Start-Switch Implementation
**What**: Switch only new Apple social starts to the clean callback behind validated configuration after Unit 3j succeeds; retain legacy callback handling and one-commit/config rollback.
**Output**: Atomic web PR W5.
**Acceptance**: Unit 3k reruns green; full web coverage/typechecks/build pass with 100% changed-code coverage and zero warnings before commit.

### ⬜ Unit 3m: Clean Apple Start Verification
**What**: Merge/deploy W5, verify exact SHA, run clean/legacy Apple canaries and Google/GitHub regression canaries, and obtain fresh security review.
**Acceptance**: Clean callback is default only after registration; both paths remain functional; rollback proof passes; reviewer PASS. If Unit 3j is blocked, Units 3k-3m remain explicitly `BLOCKED_HUMAN` while later independent units continue.

### ⬜ Unit 4.0: Web Native-Upload Contract Matrix
**What**: Add a web test-only contract PR in `test/lib/recipe-image.test.ts` and `test/routes/api-v1-recipe-covers.test.ts` proving normalized native cover output is JPEG at or below 5 MiB, server acceptance succeeds, and raw HEIC/HEIF remains rejected. Record `app/lib/recipe-image.ts` as the authoritative boundary.
**Output**: Atomic test-only web PR W6 merged before native N2; no production behavior change.
**Acceptance**: Focused/full web coverage, both typechecks, and build pass with zero warnings; W6 exact SHA is live before Unit 4b.

### ⬜ Unit 4a: Native Cover Image Normalization Tests
**What**: Add failing tests for real HEIC/HEIF/default-camera samples, orientation, corrupt input, JPEG/PNG/WebP, oversized input, 2048-pixel longest edge, adaptive JPEG quality, exact 5 MiB boundary, prior-stage preservation, immediate upload, offline durable staging, replay, and emitted filename/MIME/bytes.
**Output**: Cover transcoder tests plus cover surface, staging, API request, and sync replay contract updates.
**Acceptance**: Tests fail because raw HEIC and over-contract bytes can currently reach staging/transport.

### ⬜ Unit 4b: Native Cover Image Normalization Implementation
**What**: Add a cover-specific ImageIO normalizer that applies orientation, bounds dimensions, emits JPEG, adaptively fits the 5 MiB contract, and leaves prior state untouched on failure; route both immediate and queued paths through it.
**Output**: Dedicated cover image normalization module and narrow caller changes; atomic native PR N2.
**Acceptance**: Unit 4a passes; no native cover request or queued replay emits HEIC/HEIF or bytes above the server ceiling.

### ⬜ Unit 4c: Native Cover Image Verification
**What**: Run focused cover/cache/sync/API tests, Swift coverage, scenario verifier, app-target builds, and fresh implementation/performance review.
**Acceptance**: 100% new-code coverage, zero warnings, reviewer PASS, N2 CI green and merged.

### ⬜ Unit 5a: Native Mutation Single-Flight Tests
**What**: Add failing executable tests for the all-cover-operation conflict matrix, synchronous double taps, stable IDs across same-payload retries/offline ownership/replay, payload change/cancel, dismissal, success/failure unlock, `idempotency_in_progress`, transient stage retention on error, and clearing only after server success or durable queue ownership.
**Output**: Pure mutation-state tests and route integration contracts.
**Acceptance**: Tests fail because actions currently spawn untracked concurrent tasks with fresh UUIDs.

### ⬜ Unit 5b: Native Mutation Single-Flight Implementation
**What**: Implement a testable cover mutation state machine, globally disable conflicting cover controls, show operation-specific progress, preserve retry identity, and clear UI staging at the correct ownership boundary.
**Output**: Cover mutation state/orchestration module and route wiring; atomic native PR N3.
**Acceptance**: Unit 5a passes; double taps cannot create two plans; failure remains retryable with the same identity and staged selection.

### ⬜ Unit 5c: Native Mutation Verification
**What**: Run focused route/cover/sync tests, coverage, scenario verifier, app-target builds, and fresh concurrency/idempotency review.
**Acceptance**: 100% new-code coverage, zero warnings, reviewer PASS, N3 CI green and merged.

### ⬜ Unit 6a: Native Provider-Specific Sign-In Tests
**What**: Add failing native tests for distinct Google/GitHub controls, provider-specific first-party authorization URLs, shared pending lock, state/PKCE continuity, cancellation, error recovery, accessibility identifiers, non-ephemeral default on iOS/macOS, and unchanged Apple/password paths.
**Output**: `NativeAuthSessionTests.swift`, `OAuthRequestTests.swift`, and signed-out surface contracts.
**Acceptance**: Tests fail against the generic button and forced ephemeral browser session.

### ⬜ Unit 6b: Native Provider-Specific Sign-In Implementation
**What**: Add first-class Google and GitHub controls backed by the deployed provider-hint flow, share in-flight state, restore browser SSO reuse, and keep privacy mode out unless explicitly surfaced later.
**Output**: Native auth model/session and signed-out UI changes; atomic native PR N4.
**Acceptance**: Unit 6a passes; each button reaches only its named provider while preserving first-party authorize security.

### ⬜ Unit 6c: Native Sign-In Coverage And Build
**What**: Run focused/full Swift tests, coverage, scenario verifier, iOS/macOS app-target builds, and fresh auth/security review.
**Acceptance**: 100% new-code coverage, zero warnings, reviewer PASS, N4 CI green and merged after W2 is live.

### ⬜ Unit 6d: Native Signed-Out Visual QA Dogfood
**What**: Capture fresh iPhone, iPad, and macOS signed-out screenshots; inspect provider recognition, loading/disabled states, spacing, Dynamic Type, VoiceOver labels, and nearby password/Apple controls.
**Acceptance**: Evidence index points to external screenshots; absurdity ledger has no ready/reviewer-gated item; fresh visual reviewer PASS.

### ⬜ Unit 7a: Native Photo Studio Product-Truth Tests
**What**: Add failing tests for Spoon-field gating/nil suppression, optional DatePicker ISO output, note/next-time prompts, multiline initial editorial direction, dynamic outcome labels, automatic activation from Spoon, cover/generation/action processing, failure recovery, and deterministic screenshot fixtures.
**Output**: Pure draft-to-request tests, cover surface tests, screenshot route contracts, accessibility proof contracts, and route-count updates.
**Acceptance**: Tests fail against unconditional Spoon copy/fields, raw cooked-at text, missing upload direction, `activate: false`, generic submit copy, or absent Photo Studio route.

### ⬜ Unit 7b: Native Photo Studio Product-Truth Implementation
**What**: Split draft mapping/presentation from route orchestration, conditionally reveal Spoon metadata, add optional date and multiline direction, compute truthful outcomes, activate editorial/Spoon covers by default, and present loading-chip/progress/error states without layout shift.
**Output**: Native Photo Studio UI/model/harness changes; atomic native PR N5.
**Acceptance**: Unit 7a passes; default path is minimum-click Spoon plus editorial cover; Spoon-off and editorial-off requests omit irrelevant fields and say what will happen.

### ⬜ Unit 7c: Native Photo Studio Coverage And Build
**What**: Run focused/full Swift coverage, scenario verifier, project contracts, iOS/macOS app-target builds, warning scan, and fresh implementation/accessibility review.
**Acceptance**: 100% new-code coverage, zero warnings, reviewer PASS, N5 CI green and merged.

### ⬜ Unit 7d: Photo Studio Visual QA Dogfood
**What**: Capture default, Spoon-off, editorial-off, processing, failure, empty/no-cover, and narrow/dense states on iPhone, iPad, and macOS; capture corresponding web Photo Studio mobile/desktop states; inspect actual images, controls, copy, overlap, and progress.
**Acceptance**: External screenshot evidence and accessibility proofs exist; all absurdity-ledger items are fixed/accepted with rationale; fresh native and web visual reviewers PASS.

### ⬜ Unit 8a: Demo-Source Policy Tests
**What**: Add failing source-policy, seed-target, generated-identity, and e2e lifecycle tests covering active seed code, CI seed calls, `GUIDE.md`, UI audit docs, feedback, e2e auth, teardown, and immutable historical-migration allowlists.
**Output**: Seed/e2e/source-policy tests and disposable identity factory contracts.
**Acceptance**: Tests fail on fixed Spoonjoy demo identities, reusable passwords, implicit seed target, or missing teardown.

### ⬜ Unit 8b: Demo-Source Eradication Implementation
**What**: Replace active fixed accounts/credentials with per-run disposable setup/teardown, require explicit `--target-env local` for development seeds, update CI/scripts/docs, and quarantine historical migration references without editing applied SQL.
**Output**: Seed/e2e/docs/CI changes; atomic web PR W7.
**Acceptance**: Unit 8a passes; CI creates and tears down disposable users; no active source teaches reusable demo credentials.

### ⬜ Unit 8c: Demo-Source Verification
**What**: Run source-policy, seed, e2e, cleanup dry-run/apply, full coverage/typecheck/build, and fresh data-safety reviewer.
**Acceptance**: Zero fixed active demo identities, zero disposable residue, 100% changed-code coverage, zero warnings, W7 CI green and merged.

### ⬜ Unit 9a: Local OAuth Teardown Tests
**What**: Add failing cleanup tests for disposable e2e OAuth clients and dependent credentials/codes/tokens, dry-run/apply parity, manifest IDs, local snapshot metadata, transaction rollback, non-disposable ownership refusal, partial failures, reruns, recovery, and exact residue reporting.
**Output**: Cleanup helper/script tests.
**Acceptance**: Tests fail because supported teardown cannot currently remove the eight clients and fourteen dependent references safely.

### ⬜ Unit 9b: Local OAuth Teardown Implementation
**What**: Add local-only dependency-aware teardown for generated e2e clients and disposable references, with explicit target checks, pre-apply private snapshot/manifest, one transaction, post-apply retained-owner checksums, recovery instructions, and hard refusal for non-disposable users outside the generated test contract.
**Output**: Cleanup script/helper changes; atomic web PR W8.
**Acceptance**: Unit 9a passes; local before/apply/after ends at zero disposable clients, credentials, codes, tokens, users, recipes, and cookbooks without touching retained users.

### ⬜ Unit 9c: Local OAuth Teardown Verification
**What**: Run focused/full script coverage, typecheck scripts, local cleanup twice, and fresh safety reviewer.
**Acceptance**: Idempotent zero-residue result, 100% new-code coverage, zero warnings, W8 CI green and merged.

### ⬜ Unit 10a: Web Repository Hygiene Guard Tests
**What**: Add failing tests in `test/repo-hygiene.test.ts` and focused script tests for tracked SQLite databases, generated task extensions, screenshot/log/result dumps, legitimate fixture allowlists, durable Markdown preservation, PR-size thresholds, required PR-body manifest, and external evidence indexing.
**Acceptance**: Focused tests fail on current tracked web artifacts/database and missing size/manifest gates.

### ⬜ Unit 10b: Web Artifact Cleanup And Guard Implementation
**What**: Privately scan then remove only web-manifest-approved generated artifacts and the tracked local DB, preserve durable docs/real fixtures, add pre-cleanup refs/ownership/recovery, and route future raw validation output outside tracked source.
**Output**: Atomic web PR W9 with human-readable changed-file manifest.
**Acceptance**: Unit 10a reruns green; `pnpm test:coverage`, both typechecks, and build pass with 100% changed-code coverage and zero warnings before commit.

### ⬜ Unit 10c: Web Repository Hygiene Verification
**What**: Run redacted secret scan, `pnpm run typecheck`, `pnpm run typecheck:scripts`, `pnpm test:coverage`, `pnpm build`, tracked-file/PR-size policy, `git count-objects -vH`, manifest recovery test, and fresh security/repository review.
**Acceptance**: W9 CI green and merged; web tree clean; reviewer PASS; no rewrite without separate authorization; raw evidence external.

### ⬜ Unit 10d: Native Repository Hygiene Guard Tests
**What**: Add failing Swift/Ruby contracts around `scripts/audit-native-validation-artifacts.rb` for tracked environment backups, logs, screenshots, generated JSON/patches, legitimate app/test image allowlists, durable Markdown preservation, PR-size thresholds, and external evidence paths.
**Acceptance**: Focused tests fail on current native artifact roots/backups and missing size/manifest gates.

### ⬜ Unit 10e: Native Artifact Cleanup And Guard Implementation
**What**: Privately scan then remove only native-manifest-approved generated artifacts/backups, preserve durable docs/app/test fixtures, add pre-cleanup refs/ownership/recovery, and route validation matrix output to ignored/external storage.
**Output**: Atomic native PR N6 with human-readable changed-file manifest.
**Acceptance**: Unit 10d reruns green; Swift coverage/warning matrix and app builds pass with 100% changed core coverage and zero warnings before commit.

### ⬜ Unit 10f: Native Repository Hygiene And History Verification
**What**: Run redacted secret scan; `swift test --enable-code-coverage --disable-xctest --parallel -Xswiftc -warnings-as-errors`; warning and 100% coverage enforcement scripts; scenario verifier; app builds; tracked-file/PR-size policy; `git count-objects -vH`; manifest recovery; fresh security/repository review.
**Acceptance**: N6 CI green and merged; native tree clean; reviewer PASS; no history rewrite without separate authorization; raw evidence external.

### ⬜ Unit 11.0: Web Cover Characterization Baseline
**What**: Run and, only where coverage is missing, add green public behavior characterization in `test/lib/recipe-cover.server.test.ts`, `test/routes/api-v1-recipe-covers.test.ts`, `test/lib/api-v1-openapi.server.test.ts`, and `test/lib/spoonjoy-api-spoons.test.ts` for REST/MCP/OpenAPI/idempotency/ownership/rollback and outgoing adapter calls.
**Acceptance**: Baseline is green before structural tests; characterization additions do not claim the extraction red phase.

### ⬜ Unit 11a: Shared Cover Service Structural Tests
**What**: Add failing architecture/delegation tests requiring shared cover schema/service ownership outside `app/lib/api-v1.server.ts` and `app/lib/spoonjoy-api.server.ts`, with no duplicate image/generation/activation logic.
**Acceptance**: Tests fail against current oversized ownership.

### ⬜ Unit 11b: Shared Cover Service Extraction
**What**: Extract schemas and shared image/upload/generation/activation orchestration from `app/lib/api-v1.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/recipe-cover.server.ts`, and `app/lib/recipe-image.ts` into cohesive server modules without changing public behavior.
**Output**: Atomic web PR W10.
**Acceptance**: Unit 11a reruns green; full web coverage/typechecks/build pass with 100% changed-code coverage and zero warnings before commit.

### ⬜ Unit 11c: Shared Cover Service Verification
**What**: Run characterization/structural tests, full web matrix, OpenAPI generation diff, and fresh architecture/API/security review.
**Acceptance**: Reviewer PASS, W10 CI green and merged, no public behavior drift.

### ⬜ Unit 11.1a: REST Cover Delegation Tests
**What**: Add failing structural tests requiring cover handlers in `app/lib/api-v1.server.ts` to delegate to the shared service/controller boundary while preserving exact envelopes/scopes/idempotency.
**Acceptance**: Tests fail while REST cover orchestration remains inline.

### ⬜ Unit 11.1b: REST Cover Delegation Implementation
**What**: Move REST cover controller logic behind the shared boundary and leave thin route dispatch in `app/lib/api-v1.server.ts`.
**Output**: Atomic web PR W11.
**Acceptance**: Unit 11.1a reruns green; full web coverage/typechecks/build pass with 100% changed-code coverage and zero warnings before commit.

### ⬜ Unit 11.1c: REST Cover Delegation Verification
**What**: Run REST/OpenAPI/idempotency/ownership suites, full web matrix, and fresh API/security review.
**Acceptance**: Reviewer PASS, W11 CI green and merged, no route/envelope/scope change.

### ⬜ Unit 11.2a: MCP Cover Delegation Tests
**What**: Add failing structural tests requiring cover tools in `app/lib/spoonjoy-api.server.ts` to delegate to shared cover services while preserving tool schemas, binary upload, next actions, ownership, and errors.
**Acceptance**: Tests fail while MCP cover orchestration remains inline.

### ⬜ Unit 11.2b: MCP Cover Delegation Implementation
**What**: Move MCP cover adapter logic behind shared services and leave thin tool registration/translation in `app/lib/spoonjoy-api.server.ts`.
**Output**: Atomic web PR W12.
**Acceptance**: Unit 11.2a reruns green; full web coverage/typechecks/build pass with 100% changed-code coverage and zero warnings before commit.

### ⬜ Unit 11.2c: MCP Cover Delegation Verification
**What**: Run MCP/REST parity, binary upload, idempotency, full web matrix, and fresh API/agent-surface review.
**Acceptance**: Reviewer PASS, W12 CI green and merged, no public tool behavior drift.

### ⬜ Unit 12.0: Native Cover Characterization Baseline
**What**: Run and fill only genuine gaps in `CoverControlSurfaceTests.swift`, `NativeAPIExpansionTests.swift`, and `NativeSyncEngineTests.swift` for staging, codec, queue factory, replay transport, mutation planning, and presentation behavior.
**Acceptance**: Baseline is green before structural red tests; Unit 4 owns staging/transcoding, Unit 5 mutation orchestration, and Unit 7 presentation extraction.

### ⬜ Unit 12a: Native Cover Codec Structural Tests
**What**: Add failing source/behavior tests requiring cover payload encode/decode ownership in a dedicated codec outside `NativeSyncEngine.swift`, with exact wire parity.
**Acceptance**: Tests fail while codec logic remains embedded.

### ⬜ Unit 12b: Native Cover Codec Extraction
**What**: Extract cover request/persisted payload codecs from `Sources/SpoonjoyCore/Sync/NativeSyncEngine.swift` into a narrow cover codec module without weakening unrelated visibility.
**Output**: Atomic native PR N7.
**Acceptance**: Unit 12a reruns green; native coverage/warning/scenario/app-build matrix passes with 100% changed core coverage and zero warnings before commit.

### ⬜ Unit 12c: Native Cover Codec Verification
**What**: Run focused/full native matrix and fresh architecture/API-compatibility review.
**Acceptance**: Reviewer PASS, N7 CI green and merged, exact wire parity retained.

### ⬜ Unit 12d: Native Cover Queue Transport Structural Tests
**What**: Add failing tests requiring cover queue factories/replay transport ownership outside the main sync engine while preserving retry, staged-media, and persisted-kind behavior.
**Acceptance**: Tests fail while queue transport remains embedded.

### ⬜ Unit 12e: Native Cover Queue Transport Extraction
**What**: Extract cover queue factories and replay transport from `NativeSyncEngine.swift` behind narrow internal interfaces.
**Output**: Atomic native PR N8.
**Acceptance**: Unit 12d reruns green; native coverage/warning/scenario/app-build matrix passes with 100% changed core coverage and zero warnings before commit.

### ⬜ Unit 12f: Native Cover Queue Transport Verification
**What**: Run focused/full native matrix, offline replay scenarios, and fresh architecture/concurrency review.
**Acceptance**: Reviewer PASS, N8 CI green and merged, queue/retry behavior unchanged.

### ⬜ Unit 13a: Database-Bounded My Recipes Search Tests
**What**: Add failing parity tests for owner scoping, title/description/ingredient matching, case/whitespace/special characters, pagination/order, empty/no-result states, large owner corpus, bounded rows/query count, and D1 variable limits.
**Output**: Search service/route tests plus query instrumentation.
**Acceptance**: Tests fail because the loader currently materializes and filters the entire owner corpus in application code.

### ⬜ Unit 13b: Database-Bounded My Recipes Search Implementation
**What**: Move matching and pagination into the D1 query boundary, add only justified indexes/migration, preserve route semantics, and keep query/result work bounded.
**Output**: Search service/route and optional migration changes; atomic web PR W13.
**Acceptance**: Unit 13a passes with stable result parity and bounded query/row assertions at scale.

### ⬜ Unit 13c: Search Verification
**What**: Run focused/full coverage, migration idempotency, typecheck/build, local D1 scale fixture, and fresh database/performance reviewer.
**Acceptance**: 100% changed-code coverage, zero warnings, no full-corpus application filtering, W13 CI green and merged.

### ⬜ Unit 14a: CSP Enforcement Tests
**What**: Add failing tests for enforced production CSP, nonce/script behavior, required image/style/connect sources, report-only QA comparison, violation telemetry, and one-commit rollback.
**Output**: Security-header/config/browser tests.
**Acceptance**: Tests fail because production only emits report-only CSP.

### ⬜ Unit 14b: CSP QA Enforcement Implementation
**What**: Tighten compatible sources, preserve nonce behavior, add violation reporting, enforce in QA, and keep a documented report-only rollback flag/commit.
**Output**: Security header/config/ops changes; atomic web PR W14 after QA proof.
**Acceptance**: QA browser/Photo Studio/OAuth/MCP/API surfaces load without CSP violations or blocked required assets; attacker-style inline/script probes are blocked.

### ⬜ Unit 14c: CSP Production Verification
**What**: Run `pnpm run typecheck`, `pnpm run typecheck:scripts`, `pnpm test:coverage`, `pnpm test:e2e`, and `pnpm build`; require zero warnings and 100% changed-code coverage; run fresh security review; merge W14; verify exact production headers/live surfaces and violation telemetry.
**Acceptance**: Production sends enforced CSP; core surfaces/provider starts remain healthy; rollback tested/documented; reviewer PASS; W14 exact SHA recorded.

### ⬜ Unit 15a: Home Hero Viewport Tests
**What**: Add failing responsive tests proving the first viewport preserves brand/product signal while revealing following content on mobile, desktop, and wide desktop without overlap or font viewport scaling.
**Output**: Route/component responsive tests and visual fixture updates.
**Acceptance**: Tests fail against the current full-viewport desktop hero.

### ⬜ Unit 15b: Home Hero Implementation
**What**: Adjust stable hero height/spacing so the next section is visibly discoverable while preserving the real food image, typography, and current product language.
**Output**: Narrow home route/style change; atomic web PR W15.
**Acceptance**: Unit 15a passes with no public copy/provenance regression.

### ⬜ Unit 15c: Home Hero Coverage And Build
**What**: Run focused/full coverage, typecheck/build, accessibility checks, and fresh implementation review.
**Acceptance**: 100% changed-code coverage, zero warnings, reviewer PASS, W15 CI green and merged.

### ⬜ Unit 15d: Home Visual QA Dogfood
**What**: Capture and inspect mobile, desktop, and wide-desktop public home screenshots with the next section visible.
**Acceptance**: External screenshots show no overlap, awkward crop, unreadable copy, or hidden continuation; absurdity ledger closed; fresh visual reviewer PASS.

### ✅ Unit 16a: Web Advisory-Pipeline Contract Tests
**What**: Add failing web workflow/script tests for a version/SHA-pinned supported scanner, `pnpm-lock.yaml` coverage, scanner/network failure, actionable vulnerability failure, and explicit expiring allowlists.
**Acceptance**: Tests fail because web CI has no supported fail-closed advisory gate.

### ✅ Unit 16b: Web Advisory-Pipeline Implementation
**What**: Add pinned OSV-compatible scanning for the web lockfile with documented severity/allowlist policy and fail-closed scanner errors.
**Output**: Atomic web PR W16.
**Acceptance**: Unit 16a reruns green; synthetic vulnerability/error fixtures fail; `pnpm test:coverage`, both typechecks, and build pass with 100% changed-code coverage and zero warnings before commit.

### ✅ Unit 16c: Web Advisory Verification And Remediation
**What**: Run the real scanner plus `pnpm run typecheck`, `pnpm run typecheck:scripts`, `pnpm test:coverage`, and `pnpm build`; fix or time-bound-review every finding; obtain fresh security review.
**Acceptance**: Reviewer PASS, W16 CI green and merged, no unreviewed actionable advisory or silent scanner failure.

### ⬜ Unit 16d: Native Advisory-Pipeline Contract Tests
**What**: Add failing native workflow/Ruby contract tests for pinned `bundler-audit` or supported equivalent, `Gemfile.lock` coverage, scanner/network failure, actionable finding failure, and expiring allowlists.
**Acceptance**: Tests fail because native CI does not scan release-tool Ruby dependencies.

### ⬜ Unit 16e: Native Advisory-Pipeline Implementation
**What**: Add pinned fail-closed Ruby dependency scanning to native CI with documented policy.
**Output**: Atomic native PR N9.
**Acceptance**: Unit 16d reruns green; synthetic vulnerability/error fixtures fail; native coverage/warning/scenario/app-build matrix passes with 100% changed core coverage and zero warnings before commit.

### ⬜ Unit 16f: Native Advisory Verification And Remediation
**What**: Run real scan; Swift coverage with warnings as errors; `ruby scripts/fail-on-warning.rb`; 100% coverage enforcement; scenario verifier; app builds; fix or time-bound-review every finding; fresh security review.
**Acceptance**: Reviewer PASS, N9 CI green and merged, no unreviewed actionable advisory or silent scanner failure.

### ⬜ Unit 17a: Build-Specific TestFlight Notes Tests
**What**: Add failing tests tying source SHA, build number, user-facing change manifest, and release-note freshness; require notes to mention current Photo Studio, image, mutation, and provider-sign-in changes.
**Output**: TestFlight automation contract tests and release metadata fixtures.
**Acceptance**: Tests fail against stale build-35 browser-auth-only notes.

### ⬜ Unit 17b: Build-Specific TestFlight Notes Implementation
**What**: Make notes generated/validated from the designated release candidate and update exact user-facing copy for the new build.
**Output**: Distribution metadata/scripts/docs; atomic native PR N10.
**Acceptance**: Unit 17a passes; publishing refuses stale/mismatched notes and accepts exact candidate metadata.

### ⬜ Unit 17c: TestFlight Metadata Verification
**What**: Run focused/full native validation and fresh release-copy/automation review.
**Acceptance**: 100% changed-code coverage, zero warnings, reviewer PASS, N10 CI green and merged without publishing before final candidate selection.

### ⬜ Unit 18: Final Web Validation And Implementation Review
**What**: From clean current `origin/main`, run `pnpm cleanup:qa`, local migrations twice, API generation diff, typechecks, full 100% coverage, e2e, production build, Storybook build, repo/advisory gates, and fresh implementation/test/security/visual reviewers.
**Output**: Durable evidence index with CI/run URLs, SHAs, checksums, screenshot references, and zero-residue summary; raw logs remain ignored/external.
**Acceptance**: Every command/check exits zero with no warnings; all reviewer BLOCKER/MAJOR findings are fixed and the matrix rerun on the resulting exact SHA.

### ⬜ Unit 19: Web Exact-SHA Deploy And Production Dogfood
**What**: Verify release containment selects the final green web SHA, deploy it, record Cloudflare version/SHA, run production readiness, public/API/MCP/provider/callback smokes, authenticated owner Photo Studio upload/editorialize/Spoon/placeholder/regenerate/activate/archive flow, responsive screenshots, and finally cleanup.
**Output**: Deployment/run URLs and redacted evidence index entries.
**Acceptance**: Exact SHA is live; all smokes and visual review pass; production cleanup reports zero disposable residue; owner smoke is complete or explicitly `BLOCKED_HUMAN` without concealing it.

### ⬜ Unit 20: Final Native Validation And Implementation Review
**What**: From clean current `origin/main`, run Swift tests, enforced coverage, scenario verifier, project/generator contracts, iOS/macOS app-target builds, full screenshot matrix, simulator/macOS smokes, repo/advisory gates, accessibility proof, and fresh implementation/test/security/visual reviewers.
**Output**: Durable evidence index with exact SHA, CI URLs, external screenshot references, design review, and zero-warning summary.
**Acceptance**: Every command/check exits zero; 100% changed-code coverage; all reviewer BLOCKER/MAJOR findings fixed and matrix rerun on the release-candidate SHA.

### ⬜ Unit 21: Exact-SHA TestFlight Publish And Installed Dogfood
**What**: Dispatch TestFlight for Unit 20's exact SHA, wait through processing, verify build number/source SHA/current notes/`Spoonjoy Internal` attachment/nonzero testers/notification/`IN_BETA_TESTING`, then dogfood installed signed-out auth and Photo Studio flows against production.
**Output**: App Store Connect/build/group evidence and installed-build screenshots/smoke summary.
**Acceptance**: Exact candidate is available to internal testers with current notes; installed app passes provider, HEIC, mutation-lock, queue replay, Photo Studio, and cleanup checks.
**Exclusive owner**: Codex task `019f2e25-2fc3-75b2-8ba3-335f3777115a`. This execution task must not dispatch or publish TestFlight, notify testers, expire or remove a build, or delete native worktrees.

### ⬜ Unit 22: Human-Only Closure, Cleanup, And Durable Continuation Scan
**What**: Complete or durably classify all five planning-table human actions, preserve every unresolved exact prerequisite/action, update planning/doing/Desk state, scan feedback/backlogs/PRs/CI/deploy/TestFlight/cleanup for ready work, remove only clean terminal remediation worktrees, prune only merged proven-stale branches, and notify Slugger.
**Output**: Terminal docs/Desk state, worktree/branch inventory, human-action dispositions, continuation scan, and `ouro msg --to slugger` result.
**Acceptance**: No ready in-scope work remains; independent work is shipped; audit task is `done` only if human-only closure is complete, otherwise remains `BLOCKED_HUMAN` with every unresolved exact required action and no hidden partial state.
**Split ownership**: The native/TestFlight portion, including installed iOS/macOS dogfood, TestFlight/ASC verification, tester notification, build retention or retirement, feedback health, and final native branch/worktree cleanup, is delegated exclusively to Codex task `019f2e25-2fc3-75b2-8ba3-335f3777115a`.
**Owner release gate**: This task retains the current serialized web merge/deploy train and native PR #52 through stable green merged state. It releases ownership only by sending that task the final web and native SHAs, merged PR list, exact CI/deploy evidence, and residual agent-owned work. After that handoff, this task must not start another web merge or deployment without coordinating with the exclusive owner.

#### Owner Release Checkpoint - 2026-07-21

- The signed owner-release handoff was delivered to exclusive owner task `019f2e25-2fc3-75b2-8ba3-335f3777115a` at `2026-07-21T01:55:51Z`; this task no longer owns a web merge, deployment, or cleanup lane and must coordinate there before taking any later web release action.
- Final web main is `bb3cdbe3bf00a28c79bb780c8921d84e181628d9` with tree `9ff89ae7eea5e8a2712ca64f98b7aa0a2919d2d3`. Exact-main CI run `29792949904` and Storybook run `29792949969` completed successfully.
- Production Deploy run `29793583588`, attempt 2, completed successfully for that exact SHA. The signed release artifact records `status=promoted`, `migrationApply=not_needed`, prior Worker `b0b29c75-ab4f-4b22-ab6b-90defa33bd85`, and promoted Worker `7d78e10e-0610-4d94-9dec-7079904a8eaa`.
- The first deployment attempt stopped at the intentional non-additive migration guard. Migration `0024_remove_legacy_demo_identities.sql` (SHA-256 `1ec961f1d012f020d84eaa27f0eab27a9a5bb3279661eb3e02ab938a5de29d3a`) was then applied through the reviewed maintenance path after a private D1 Time Travel bookmark and targeted backup. Before and after counts held at 43 total users and zero target identities, recipes, cookbooks, Spoons, covers, memberships, cross-owner forks, and cross-owner covers; the migration ledger now reports no pending migrations.
- Exact-version public proof passed for read and mutation readiness, health, REST, OpenAPI, CORS, cache behavior, MCP metadata/transport, the full MCP OAuth lifecycle, protected-route redirects, and CSP enforcement. GitHub and Google starts use clean callbacks; Apple intentionally remains on its registered legacy `form_post` start. Clean and legacy GitHub, Google, and Apple callbacks all returned controlled `302` responses on the promoted Worker.
- Production readiness passed every required secret, provider, asset, runbook, and schema check. The broad production cleanup remained read-only and reported zero across all eight disposable/residue categories.
- Relevant merged web PRs: #261, #262, #264, #266, #268, #270, #271, #272, #278, #280, and #281. Final PR #266 exact head `91013df79963dd21d41f08349467cfc3743668e9` passed protected CI `29792309391`, Storybook `29792309331`, 7,567 local tests at 100% coverage, both typechecks, build, local cleanup, and a fresh hostile `CONVERGED` verdict before squash merge.
- Final retained native repair PR #54 merged as `48a644f587fbc2ee36e4bb6ac6f003bd13956f85`; exact-main Native run `29537952711` succeeded after 612 Swift tests, 100% core coverage, the scenario verifier, 34-route matrix, app bundles, and fresh hostile review.
- Web cleanup removed seven clean terminal worktrees and their local branches: database-bounded search, demo-source eradication, home hero, provider hints, shared cover service, web advisory, and protobuf advisory. Eight exact merged remote branches were also pruned. The root checkout, this canonical ledger worktree, and the dirty separately owned Clem worktree were preserved.
- `zero_in_flight_web_merges: true`
- `zero_in_flight_web_deploys: true`
- `web_cleanup_owner: Codex task 019f2e25-2fc3-75b2-8ba3-335f3777115a after signed handoff; no terminal worktree from this release lane remains, and the canonical ledger plus dirty Clem lane are explicitly ineligible without their owners.`
- Residual agent-owned work is exclusively the receiving task's already-recorded Apple-start rollout decision, native watchdog/visual repair, exact-SHA TestFlight publish, App Store Connect verification, installed dogfood, feedback health, and native cleanup. This task performed no TestFlight publish, tester notification, build retirement, or native worktree deletion.

## Execution
- **TDD strictly enforced**: tests -> red -> implement -> green -> refactor
- Green characterization baselines do not substitute for red structural/delegation tests in extraction units.
- Before any implementation (`b`/`e`) commit, rerun its focused red suite green and pass the repository matrix: web uses `pnpm run typecheck`, `pnpm run typecheck:scripts`, `pnpm test:coverage`, and `pnpm build`; native uses Swift coverage with `-warnings-as-errors`, `scripts/fail-on-warning.rb`, `scripts/enforce-swift-coverage.rb --minimum 100 --include Sources/SpoonjoyCore`, scenario verification, and iOS/macOS app builds with warnings as errors.
- Commit after each phase (a, b, c)
- Push after each unit complete
- Run full test suite before marking unit done
- For UI/rendering/layout units, run `visual-qa-dogfood` before declaring the unit or task complete
- **All artifacts**: Keep only a durable evidence index in `./2026-07-15-1152-doing-audit-remediation/`; save raw logs, screenshots, data, and binaries to ignored local storage or CI artifacts so product repositories do not accumulate generated evidence
- **Fixes/blockers**: Spawn sub-agent immediately; do not ask unless the planning human-only table applies
- **Decisions made**: Update docs immediately, commit, and push
- PR boundaries W1-W16 and N1-N10 are independently releasable. W2 provider hints must be live before N4. W4 dual Apple support must be live and Unit 3j registration/canary must pass before W5 switches starts. W6 web image-contract proof must merge before N2. TestFlight publishes only Unit 20's selected SHA.

## Progress Log
- 2026-07-21 01:55 Serialized owner-release train completed: final web SHA `bb3cdbe3bf00a28c79bb780c8921d84e181628d9` is live as Worker `7d78e10e-0610-4d94-9dec-7079904a8eaa`, exact-main CI/Storybook and Production Deploy attempt 2 are green, reviewed migration 0024 and zero-residue proofs are complete, native PR #54 is exact-main green at `48a644f587fbc2ee36e4bb6ac6f003bd13956f85`, terminal web worktrees were retired, and the signed handoff was delivered to exclusive owner `019f2e25-2fc3-75b2-8ba3-335f3777115a`.
- 2026-07-16 16:46 Ownership boundary made durable: Unit 21 and the native/TestFlight portion of Unit 22 are exclusively owned by Codex task `019f2e25-2fc3-75b2-8ba3-335f3777115a`; this task is prohibited from TestFlight publish/notify/build-retirement and native-worktree deletion, retains only the current web release train and native PR #52 through explicit evidence-backed owner release, and must coordinate before any later web merge/deploy.
- 2026-07-16 15:41 Durable task state transitioned from `drafting` to `processing`; active web/native PR queue and exact-SHA release sequence are recorded in Desk, with the task remaining in execution until every ready unit, production verification, TestFlight candidate, and cleanup item is complete.
- 2026-07-15 12:16 Created from approved planning doc
- 2026-07-15 12:29 Split OAuth, cross-repo contracts, repository cleanup, extraction, and advisory work into independent TDD PRs; made coverage/warning and release trust-chain gates concrete.
- 2026-07-15 12:34 Fresh doing-doc re-review passed; execution is ready.
- 2026-07-15 12:43 Unit 0 complete: remotes match audited heads, active concurrent work is excluded, redacted current-tree scans and removal manifests are recorded, rollback refs are instantiated, and all human-only actions have initial dispositions.
- 2026-07-15 20:23 Units 16a-16c complete: opened web W16 PR https://github.com/spoonjoy/spoonjoy-v2/pull/272 from `worker/web-advisory-pipeline` at `ce8f1729` with atomic commits `4cf21993`, `7fbbe22c`, `22ab7fdc`, `3c4e6622`, `99d26308`, and `ce8f1729`; OSV-Scanner `v2.3.8` is pinned to tag `408fcd6f8707999a29e7ba45e15809764cf24f67` and Linux amd64 SHA-256 `bc98e15319ed0d515e3f9235287ba53cdc5535d576d24fd573978ecfe9ab92dc`, CI verifies the tag and binary before `pnpm install --frozen-lockfile --ignore-scripts`, and production deploy requires successful `advisory`; real `pnpm-lock.yaml` scan found 135 OSV findings across 30 npm packages, all exactly allowlisted with expiry `2026-07-30` and 0 actionable after review; local validations passed `pnpm run typecheck`, `pnpm run typecheck:scripts`, `pnpm test:coverage` (358 files, 7,129 tests, 100%), `pnpm build`, `actionlint .github/workflows/*.yml`, `git diff --check`, real OSV scan, and `pnpm cleanup:qa`; fresh harsh supply-chain/security reviewer returned `VERDICT: CONVERGED`; PR CI/Storybook checks `advisory`, `coverage`, `e2e`, and `build-storybook` are green. W16 is intentionally not merged per operator direction because parent sequencing owns exact-SHA release order.
