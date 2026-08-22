# Doing: Web Apple Sign-in Production Repair

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-08-21 17:52
**Planning**: ./2026-08-21-1737-planning-web-apple-sign-in-production-repair.md
**Artifacts**: ./2026-08-21-1737-doing-web-apple-sign-in-production-repair/

## Execution Mode

- **direct**: Execute units sequentially in this dedicated web worktree; use fresh sub-agents for required cold reviews and fixers.

## Objective
Restore reliable production web OAuth initiation, including Sign in with Apple, and prove a real service-worker-controlled browser click reaches the intended provider without weakening Spoonjoy's CSP.

## Upstream Work Items
- None

## Completion Criteria
- [ ] A recorded red browser reproduction shows the current rendered OAuth interaction remaining on `/login`, while direct `/auth/apple` navigation reaches Apple's authorization page.
- [ ] The exact root cause is supported by a red browser probe that asserts an active service-worker controller and captures the blocked form's `securitypolicyviolation`/CSP report naming `form-action`, plus a same-session direct-document-navigation control that reaches Apple.
- [ ] Login and signup expose provider initiation as navigation that is compatible with both `form-action 'self'` and the active service worker.
- [ ] `redirectTo` is URL-encoded once and preserved byte-for-byte through the initiation URL.
- [ ] Targeted unit/integration/browser tests cover every provider, absent/present `redirectTo`, the forced full-document navigation contract, and the active-service-worker navigation path.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings
- [ ] The reviewed merge SHA is the SHA deployed to production and reported by `/api/v1/health`.
- [ ] A fresh production browser profile is controlled by the live `/sw.js`, and clicking Continue with Apple reaches `appleid.apple.com/auth/authorize` with Spoonjoy's registered client ID and callback.
- [ ] The terminal SHA is the latest successful original-or-forward-repair merge, and every task-lineage remote branch, local branch, task/exact-merge worktree, and disposable smoke artifact is removed after verification.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## TDD Requirements
**Strict TDD — no exceptions:**
1. **Tests first**: Write failing tests BEFORE any implementation
2. **Verify failure**: Run tests, confirm they FAIL (red)
3. **Minimal implementation**: Write just enough code to pass
4. **Verify pass**: Run tests, confirm they PASS (green)
5. **Refactor**: Clean up, keep tests green
6. **No skipping**: Never write implementation without failing test first

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

### ⬜ Unit 0: Causal Production Baseline
**What**: Run a disposable Chromium probe against canonical browser origin `https://spoonjoy.app` before code changes. Install a pre-navigation `securitypolicyviolation` listener, load `/login`, await service-worker readiness, reload, assert `navigator.serviceWorker.controller.scriptURL` is live `/sw.js`, click the rendered Apple GET form, and record URL/violation data. Accept events only while `location.origin === "https://spoonjoy.app"` and before provider handoff; require `effectiveDirective` or `violatedDirective` to equal `form-action`, `documentURI` to be the Spoonjoy login document, and `blockedURI` to have Apple's origin, then serialize only directive, Spoonjoy document path, blocked origin, and phase=`pre-handoff`. Remove the listener/snapshot evidence before inspecting the provider page. In the same browser context, directly navigate to `/auth/apple` as the control and record only Apple's public authorization parameters. Record current `/api/v1/health`, live `/sw.js` digest, source ancestry, and CSP header. Health/provenance may additionally query the Worker origin `https://spoonjoy-v2.mendelow-studio.workers.dev`, but browser reproduction and handoff always use `https://spoonjoy.app`; require both health observations to report the same active Worker version/source.
**Output**: `./2026-08-21-1737-doing-web-apple-sign-in-production-repair/unit-0-production-red.json` and `unit-0-production-red.md` containing privacy-safe causal evidence; no Apple credentials or private page values.
**Acceptance**: Evidence proves the page is service-worker controlled; the form click stays on `/login`; a scoped `form-action` violation identifies the blocked Apple origin; direct navigation reaches `appleid.apple.com/auth/authorize` with `client_id=app.spoonjoy.client`, `redirect_uri=https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithApple`, and `response_mode=form_post`; the freshly observed production source SHA is recorded and tested for ancestry of fix #297 (`86c58120`); live `/sw.js` is compared with the same observed source tree rather than a hard-coded deployment assumption. If a controller cannot be established after one readiness/reload retry, the scoped violation is absent, or the direct-navigation control does not reach Apple with those parameters, stop before Unit 1: mark Unit 0 blocked/falsified, update the planning doc's Decisions/Open Questions with the evidence, and obtain a revised diagnosis/plan review rather than implementing this plan.

### ⬜ Unit 1a: Full-document OAuth Initiation — Tests
**What**: Update `test/components/ui/oauth.test.tsx`, `test/components/ui/link.test.tsx`, `test/routes/login.test.tsx`, `test/routes/signup.test.tsx`, and `test/routes/auth-google.test.ts` first. Require every OAuth provider control to render as a same-origin link rather than a form/button. Pin `redirectTo === undefined` and `redirectTo === ""` to the identical href `/auth/${provider}`; the real loader stores default `/recipes` for both absent and explicit-empty requests. Any non-empty value uses `/auth/${provider}?redirectTo=${encodeURIComponent(redirectTo)}` with no hidden input or second encoding; the Google loader test reads the signed start session and proves a query/special-character value is recovered exactly once as the original string. Keep the shared Link change conventional: accept/forward React Router's `reloadDocument` only for internal links, consume it for every native-anchor branch, and add regression coverage for external HTTP(S), protocol-relative, `mailto:`, `tel:`, and explicit/default `target`/`rel`.
**Output**: Focused failing component/route tests whose failures specifically show the current GET forms and missing full-document-link contract.
**Acceptance**: `node scripts/run-with-warning-policy.mjs -- pnpm exec vitest run test/components/ui/oauth.test.tsx test/components/ui/link.test.tsx test/routes/login.test.tsx test/routes/signup.test.tsx test/routes/auth-google.test.ts` fails for the intended semantic/navigation assertions, with zero unrelated failures or warnings; red output is saved as `unit-1a-vitest-red.log`.

### ⬜ Unit 1b: Full-document OAuth Initiation — Implementation
**What**: Minimally update `app/components/ui/link.tsx` so `reloadDocument?: boolean` is destructured/consumed, conventionally forwarded to internal `RouterLink`, and omitted from every native anchor without changing existing external/protocol-relative/`mailto:`/`tel:` or `target`/`rel` behavior; update `app/components/ui/oauth.tsx` to build the exact Unit 1a provider href and render the existing styled `Button` as an internal link with `reloadDocument`. Remove stale form/service-worker commentary and document why native full-document navigation avoids CSP form redirect checks and router data-fetch redirects.
**Output**: Shared OAuth controls are anchors that initiate a browser document request to `/auth/{provider}`; `redirectTo` is encoded into the href once.
**Acceptance**: Unit 1a tests pass without modifying their assertions; rendered links retain existing styling/accessibility; no form remains around OAuth controls; no CSP directive is broadened; the exact Unit 1a command and `pnpm run verify:clean:build` pass with zero warnings.

### ⬜ Unit 1c: Full-document OAuth Initiation — Coverage & Refactor
**What**: Run `node scripts/run-with-warning-policy.mjs -- pnpm exec vitest run test/components/ui/oauth.test.tsx test/components/ui/link.test.tsx test/routes/login.test.tsx test/routes/signup.test.tsx test/routes/auth-google.test.ts --coverage --coverage.include=app/components/ui/oauth.tsx --coverage.include=app/components/ui/link.tsx --coverage.thresholds.statements=100 --coverage.thresholds.branches=100 --coverage.thresholds.functions=100 --coverage.thresholds.lines=100`, add only missing null/empty/query/encoding cases, refactor duplication without behavior changes, and rerun `pnpm run verify:clean:build`.
**Output**: `unit-1c-coverage.log`, `unit-1c-tests.log`, and `unit-1c-build.log`.
**Acceptance**: New/modified branches are 100% covered; every provider and redirect edge is green; build is green; all logs contain zero warnings.

### ⬜ Unit 2a: Service-worker OAuth Live Canary — Tests
**What**: Add failing behavioral tests in `test/scripts/smoke-live-helpers.test.ts` for a single provider-parameterized observable navigation canary and an exact allowlisted evidence serializer. Persist only keys `provider`, `appOrigin`, `controllerPath`, `documentPath`, `providerHost`, `clientIdMatches`, `redirectUriMatches`, `responseModeMatches`, `redirectToPreserved`, `publicSignInMarkerPresent`, `publicErrorSentinelAbsent`, and `cspViolations`; each CSP item contains only `directive`, Spoonjoy `documentPath`, `blockedOrigin`, and `phase`. Tests must prove full provider/app URLs and query strings, OAuth `state`, PKCE/code challenge/verifier, nonce, cookies, provider DOM/text, and unexpected keys/values are never serialized. Cover explicit app/provider/client/callback/response-mode/public-marker/error-sentinel inputs, missing controller, wrong controller script, wrong handoff values, missing public sign-in marker/title, present public error sentinel, scoped CSP failures, success, and red baseline through injected adapters. Before credentials, require the provider page marker and absent sentinel; serialize booleans only, never provider text. Add `test/scripts/smoke-live-oauth.test.ts` for an import-safe Apple orchestrator: inject browser/context/canary adapters; assert a fresh unauthenticated context with locale `en-US` and header `Accept-Language: en-US,en;q=0.9`, exact Apple contract including marker `Sign in to Apple` and sentinel `invalid_request`, safe projection only, finally-close, and failure propagation. Add a failing full-coverage contract requiring `scripts/smoke-live-oauth.mjs` in `vitest.config.ts`'s repo-wide include and deployment-preflight coverage guard. `scripts/smoke-live.mjs` calls this module, but tests import/invoke it directly. In the same red commit, extend behavioral launcher assertions, add existing-config `oauth-navigation` with trace/video/screenshot all `off` so raw OAuth URLs cannot enter Playwright artifacts, and add `e2e/flows/oauth-navigation.spec.ts` through real `/auth/google`, intercepting only Google. Do not create a second config/server stack.
**Output**: `unit-2a-vitest-red.log` and `unit-2a-browser-red.log` proving the shared canary/launcher path is absent.
**Acceptance**: `node scripts/run-with-warning-policy.mjs -- pnpm exec vitest run test/scripts/smoke-live-helpers.test.ts test/scripts/smoke-live-oauth.test.ts test/scripts/e2e-run-cleanup.test.ts test/scripts/deployment-preflight.test.ts` and `node scripts/run-with-warning-policy.mjs -- pnpm exec playwright test e2e/flows/oauth-navigation.spec.ts --config=playwright.config.ts --project=oauth-navigation --reporter=list` fail only for intended absent canary/orchestrator/coverage-config/launcher behavior, with zero unrelated failures or warnings.

### ⬜ Unit 2b: Service-worker OAuth Live Canary — Implementation
**What**: Implement the minimal canary and exact allowlisted projection in `scripts/smoke-live-helpers.mjs`, the import-safe injected caller in `scripts/smoke-live-oauth.mjs`, add that module to `vitest.config.ts`'s full coverage include plus deployment-preflight required includes, extend existing launcher with test-only Google env, and replace the request-only Apple guard with the orchestrator. The shared canary accepts provider/link plus explicit app base and expected host/client/callback/response-mode/marker/sentinel; branch supplies deterministic Google values while Apple pins its production contract. It loads `/login`, collects only scoped CSP evidence, establishes live `/sw.js` control, clicks, validates the top-level handoff, and before credentials asserts marker/sentinel under pinned `en-US`/Accept-Language. Build the persisted report only through the allowlist serializer; retain raw URLs/query/DOM only ephemerally in memory and discard immediately after validation/projection, before any artifact/log write. Existing launcher/global teardown owns local cleanup; orchestrator owns fresh context and closes in `finally`.
**Output**: Reusable exact interaction canary integrated into production `smoke:live` results.
**Acceptance**: Both exact Unit 2a commands pass unchanged; the canary has no credential entry or private artifact values; existing launcher cleanup remains green; `pnpm run verify:clean:build` passes with zero warnings.

### ⬜ Unit 2c: Service-worker OAuth Live Canary — Coverage & Refactor
**What**: Run `node scripts/run-with-warning-policy.mjs -- pnpm exec vitest run test/scripts/smoke-live-helpers.test.ts test/scripts/smoke-live-oauth.test.ts test/scripts/e2e-run-cleanup.test.ts test/scripts/deployment-preflight.test.ts --coverage --coverage.include=scripts/smoke-live-helpers.mjs --coverage.include=scripts/smoke-live-oauth.mjs --coverage.include=e2e/support/start-ephemeral-wrangler.mjs --coverage.thresholds.statements=100 --coverage.thresholds.branches=100 --coverage.thresholds.functions=100 --coverage.thresholds.lines=100` for every new helper/orchestrator/launcher branch/error path, add missing cases, refactor green, rerun the exact Unit 2a browser command and `pnpm run verify:clean:build`, then run `pnpm run verify:clean:test:coverage` to prove `smoke-live-oauth.mjs` remains in the full 100% gate.
**Output**: `unit-2c-coverage.log`, `unit-2c-tests.log`, and `unit-2c-build.log`.
**Acceptance**: New helper code is 100% covered, all browser evidence validation paths are tested, build stays green, and logs contain zero warnings.

### ⬜ Unit 3: Branch-build Service-worker Browser Proof
**What**: Execute the already-red/green shared-canary Playwright proof against the built branch with `node scripts/run-with-warning-policy.mjs -- pnpm exec playwright test e2e/flows/oauth-navigation.spec.ts --config=playwright.config.ts --project=oauth-navigation --reporter=list`. Existing config/launcher builds and starts with test-only Google env; the fresh unauthenticated `en-US` project calls the same canary as production, establishes branch `/sw.js` control, and clicks through real `/auth/google`. Only Google is intercepted. The proof asserts the document request and boolean `redirectToPreserved`; its saved JSON must equal the Unit 2a allowlisted projection and contain no full query/state/PKCE/DOM. Existing teardown proves no server/persist residue.
**Output**: `unit-3-branch-browser.log` and `unit-3-branch-browser.json` containing only the exact Unit 2a allowlisted projection; log output is sanitized by the same serializer and contains no raw/full URL, query, state, PKCE, cookie, nonce, or provider text/DOM.
**Acceptance**: The test runs against the built branch (not jsdom/source inspection), proves active service-worker control, proves a document navigation rather than a router data request, preserves a special-character/query-bearing `redirectTo`, reaches the controlled cross-origin handoff, and records zero CSP violations.

### ⬜ Unit 4: Main Sync and Full Validation
**What**: Fetch `origin/main`, rebase the task branch safely, resolve only task-owned conflicts, then run exact repository lanes: `pnpm run verify:clean:typecheck`, `node scripts/run-with-warning-policy.mjs -- pnpm run typecheck:scripts`, `pnpm run verify:clean:generated-contract`, `pnpm run verify:clean:migrations`, `pnpm run verify:clean:migrations:qa`, `pnpm run verify:clean:test:coverage`, `pnpm run verify:clean:test:workers:coverage`, `pnpm run verify:clean:test:e2e`, the exact separate Unit 3 Playwright command/config, `pnpm run production:readiness`, `pnpm run deploy:preflight`, and `pnpm run verify:clean:build`.
**Output**: Rebase evidence and complete validation logs under the artifacts directory.
**Acceptance**: Branch is based on current `origin/main`; all named suites/checks pass with 100% new-code coverage and zero warnings; tree contains only intentional task files; rebased branch is pushed with lease.

### ⬜ Unit 5: Cold Branch Review
**What**: Dispatch a fresh cold reviewer over the exact rebased diff, Unit 0 causal evidence, Unit 3 branch-browser evidence, targeted/full tests, coverage, and build output. Address every BLOCKER/MAJOR finding through strict TDD; resolve every actionable MINOR or record the cold reviewer's explicit acceptance/rationale, then re-review to convergence.
**Output**: Reviewer verdicts, any fix commits, and final converged review record under the artifacts directory.
**Acceptance**: Cold review converges with no BLOCKER/MAJOR and no unaddressed actionable MINOR; every accepted MINOR has reviewer-authored rationale; any changed code is covered by new red/green evidence; branch remains fully green and pushed.

### ⬜ Unit 6: PR and Required Checks
**What**: Open a focused PR against current `main` with the falsified-diagnosis correction and causal red/green evidence. Monitor every required check to completion and audit review-thread state without merging.
**Output**: PR URL/number, exact reviewed head SHA, required-check matrix, and review-thread inventory recorded under artifacts.
**Acceptance**: Every required check is green for the exact reviewed head; no merge conflict exists; all review findings are classified; PR remains ready for the feedback/merge unit.

### ⬜ Unit 7: CI/Review Feedback and Merge
**What**: Resolve every actionable CI/review finding through strict TDD, including actionable MINORs unless the cold reviewer explicitly accepts one with rationale; rerun affected/full checks and obtain convergence. Before merge, make the product planning/doing files immutable execution snapshots: record Units 0–7 evidence/status, retain doing status `in-progress`, and point all post-merge release/smoke/cleanup terminal truth to the Desk task/artifacts. Commit/push that final reviewed head, then merge using an enabled repository strategy; do not modify these product docs after merge except through a separate reviewed PR.
**Output**: Final reviewed head, resolved-thread evidence, merge method, and merge SHA recorded under artifacts.
**Acceptance**: PR is merged rather than merely open; merge SHA is on `origin/main`; no unresolved review thread or failing required check remains.

### ⬜ Unit 8: Exact-SHA Workflow Deployment and Release-state Safety
**What**: From the task worktree, create clean detached exact-merge worktree `/Users/arimendelow/Projects/spoonjoy-v2-web-apple-sign-in-production-repair-exact-merge` at `<merge-sha>`, assert exact HEAD/status, run `pnpm install --frozen-lockfile`, reassert tracked/untracked status clean, then run `pnpm run deploy:preflight`; all remaining source-controlled commands/smoke use that installed exact-merge worktree. Save public predeploy observations from canonical and Worker health; require agreement and record exact prior source SHA/Worker version. Local credentials are forbidden for deployment/version mutation; the only later local Cloudflare authority is the Unit 9 smoke process's least-privilege production-D1 cleanup token, scoped away from Workers Scripts/version deployment and removed from the browser environment. Save Units 8–10 evidence in Desk only. Initialize/update Desk `release-lineage.json` with ordered entries `{sourceSha,pr,branch,taskWorktree,exactMergeWorktree,releaseRun}` and `terminalSourceSha`; every forward-repair replacement appends its own resources and terminal SHA changes only after its production handoff passes. Read release mode and discover/watch the automatic exact-SHA `workflow_run` first with the Unit 8 `gh run list` workflow/event/branch/commit/timestamp uniqueness contract. After exact-SHA main CI succeeds, poll every 30 seconds up to 15 minutes; missing run enters forward repair, never manual dispatch. Manual dispatch is permitted only from a valid `status=failed_before_stage` artifact whose phase is `validate`, `provenance`, `initial_preflight`, `build`, `post_build_posthog`, `post_build_provenance`, `migration_list`, `migration_review`, `full_preflight`, `current_deployment`, `deployment_revalidation`, or `version_snapshot`; record proof/timestamp and select exactly one post-dispatch exact-SHA run. Always download the locked release artifact; locally assert only exact SHA/mode/promoted/complete, then verify public health SHA/candidate. Invalid/later failure enters forward repair; protocol rollback authority remains artifact `previousVersionId`; atomic never rolls back.
**Output**: Desk-owned `unit-8-predeploy-state.json`, run-selection/conditional-dispatch evidence, downloaded `production-release.json`, assertion log, and exact post-run health/provenance evidence.
**Acceptance**: Evidence shows automatic exact-SHA discovery was attempted first and any manual dispatch met the recorded conclusive pre-mutation-artifact exception; absence/timeout never causes a dispatch. The selected locked workflow run is unique for the exact merge SHA; its artifact has exact SHA/mode plus `status=promoted`/`phase=complete`; both public health origins report that SHA and candidate Worker before Unit 9. A protocol-canary automatic rollback is verified but remains non-terminal; any non-promoted or post-mutation failure enters forward repair; cleanup never begins from a failure state.

### ⬜ Unit 9: Production Service-worker Apple Handoff
**What**: From the installed clean exact-merge worktree, reassert exact HEAD/clean status and verify live `/sw.js`. Run the enhanced production smoke with `CLOUDFLARE_ACCOUNT_ID` plus a `CLOUDFLARE_D1_API_TOKEN` whose permissions are limited to the production D1 cleanup/read operations (no Workers Scripts/version mutation), passing `--out /Users/arimendelow/desk/spoonjoy/web-apple-sign-in-production-repair/artifacts/unit-9-production-smoke` explicitly; require cleanup verification to report zero remaining disposable users, and ensure `buildBrowserEnvironment` strips all Cloudflare authority from the browser. Independently repeat fresh-profile Apple. Both Apple checks use locale `en-US`, `Accept-Language: en-US,en;q=0.9`, validate public parameters plus marker/sentinel, and persist only the exact allowlisted OAuth projection/booleans. On protocol-v1 failure, validate promoted `previousVersionId` as recorded predeploy UUID, record the rollback dispatch timestamp, and dispatch rollback with predeploy source SHA + that UUID; query by workflow/event/source SHA and require exactly one matching run created strictly after that timestamp before selecting/watching/downloading it. Require `rollback_promoted`, predeploy `sourceSha`, and `candidateVersionId` equal rollback target, then exact prior public health. Keep nonterminal and append replacement resources to lineage. Atomic never rolls back.
**Output**: Smoke result and privacy-safe live handoff evidence saved under the Desk task artifacts and referenced from the Desk task card.
**Acceptance**: `/api/v1/health` reports the current lineage candidate SHA; service worker is active/current; the rendered Apple link reaches the expected Apple host with client/callback/response-mode matches, public marker present, error sentinel absent, and no CSP violation, while artifacts contain only the allowlisted projection; no credential entry occurs. On success this SHA becomes `terminalSourceSha`. A protocol-canary post-promotion failure is rolled back only through the validated prior artifact/source/version contract and verified as `rollback_promoted` with exact prior health, but remains nonterminal; atomic failure never rolls back. For either failure, do not mutate this merged doing snapshot: record it in Desk, create a new dated product planning/doing repair doc on a new task branch, obtain cold approval of its scoped TDD contract, implement/validate/open/merge a new PR for a new exact-main SHA, append its resources to lineage, then repeat release validation. Cleanup remains forbidden until production handoff passes.

### ⬜ Unit 10: Cleanup and Durable Closure
**What**: Leave merged product snapshots unchanged. Require public health/smoke for `release-lineage.json.terminalSourceSha`, then from persistent base iterate every lineage entry (original and all replacement PRs): preflight its exact-merge/task worktrees clean, remove exact-merge before task worktree, delete its local/remote branch, and remove disposable smoke data. Verify all listed paths/refs absent and unrelated Clem/PR #298 untouched. Only after cleanup succeeds, write the cleanup inventory/evidence and terminal SHA to Desk, mark the Desk task terminal, commit/push Desk `main`, then notify Slugger.
**Output**: Clean repositories and worktree inventory; immutable product execution snapshots plus accurately closed Desk task; completion notification sent.
**Acceptance**: The lineage terminal SHA—not a superseded original/repair SHA—is healthy and passed Unit 9 before cleanup; every lineage exact-merge/task worktree, local/remote ref, and temp residue is absent before Desk terminal state is written/pushed; unrelated dirty Clem/PR #298 is untouched; task is not reported complete before cleanup and production smoke pass.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- **Artifacts**: Units 0–7 use the product doing artifact directory and are merged; Units 8–10 use `/Users/arimendelow/desk/spoonjoy/web-apple-sign-in-production-repair/artifacts/` with committed/pushed Desk state
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away
- **Forward repair**: Any Unit 8/9 failure is recorded in Desk and starts a new reviewer-approved product planning/doing repair doc and PR/SHA; rerun release validation before cleanup

## Progress Log
- 2026-08-21 17:52 Created from approved planning doc
- 2026-08-21 17:54 Conversion audit made cleanup ordering executable: repository docs are pushed before their worktree is removed, then Desk state closes
- 2026-08-21 18:00 Addressed granularity review: added branch-build SW proof, split sync/review/PR/feedback/deploy/live-smoke units, made production observations fresh, and added explicit rollback safety
- 2026-08-21 18:01 Self-audit made the tested canary explicitly reusable against both the branch fixture and production, so Unit 3 adds no unplanned post-implementation test code
- 2026-08-21 18:07 Granularity Pass 2 converged (`PASS`)
- 2026-08-21 18:12 Addressed Validation Pass 3 source-fidelity findings: executable tests-first Playwright branch harness, exact coverage/validation commands, exact-SHA workflow dispatch/artifact validation, and release-mode-correct failure handling
- 2026-08-21 18:14 Validation self-audit made the separate OAuth Playwright lane explicit in full validation and pinned run selection to workflow/event/branch/commit/timestamp uniqueness
- 2026-08-21 18:24 Addressed ambiguity review: causal stop/replan gate, real-loader fixture ownership, canonical encoding/session contract, canonical-vs-Worker origins, privacy-scoped CSP capture, explicit forward-repair loop, internal-only `reloadDocument`, and authoritative predeploy version snapshot
- 2026-08-21 18:31 Addressed quality/scope review: automatic release discovery precedes conditional dispatch, locked workflow/public health replace local production credentials and duplicate validation, existing E2E launcher/project is extended, one observable provider canary is shared, and Link behavior remains a narrow conventional regression-tested change
- 2026-08-21 18:43 Addressed Scrutiny A: timeout cannot authorize duplicate release, post-merge evidence is Desk-owned, Apple smoke caller wiring is import-safe and behaviorally covered, empty redirect semantics are pinned, and actionable MINOR review findings require resolution or explicit reviewer acceptance
- 2026-08-21 18:51 Addressed Scrutiny B: provider acceptance marker/error booleans, verified protocol-canary rollback on post-promotion smoke failure, and clean detached exact-merge deploy preflight/cleanup
- 2026-08-21 19:06 Addressed Scrutiny C: explicit focused/full 100% coverage, installed clean exact-merge execution, strict privacy projection, replacement-release lineage cleanup, cleanup-before-terminal Desk ordering, and pinned English provider context
- 2026-08-21 19:26 Addressed final scrutiny: deployment mutations remain workflow-only while smoke receives D1-only cleanup authority, production smoke output is pinned to Desk, and rollback dispatch selection is timestamp-bounded and unique
