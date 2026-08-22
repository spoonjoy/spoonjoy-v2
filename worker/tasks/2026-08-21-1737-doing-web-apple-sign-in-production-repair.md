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
- [ ] Task-owned remote branch, local branch, worktree, and disposable smoke artifacts are removed after verification.

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
**What**: Run `node scripts/run-with-warning-policy.mjs -- pnpm exec vitest run test/components/ui/oauth.test.tsx test/components/ui/link.test.tsx test/routes/login.test.tsx test/routes/signup.test.tsx test/routes/auth-google.test.ts --coverage --coverage.include=app/components/ui/oauth.tsx --coverage.include=app/components/ui/link.tsx`, add only missing null/empty/query/encoding cases, refactor duplication without behavior changes, and rerun `pnpm run verify:clean:build`.
**Output**: `unit-1c-coverage.log`, `unit-1c-tests.log`, and `unit-1c-build.log`.
**Acceptance**: New/modified branches are 100% covered; every provider and redirect edge is green; build is green; all logs contain zero warnings.

### ⬜ Unit 2a: Service-worker OAuth Live Canary — Tests
**What**: Add failing behavioral tests in `test/scripts/smoke-live-helpers.test.ts` for a single provider-parameterized observable navigation canary and privacy-safe report serialization. Cover explicit app/provider/client/callback/response-mode inputs, missing controller, wrong controller script, wrong handoff values, unexpected scoped CSP violations, success, red-baseline evidence, and rejection of unsafe/ambiguous inputs through injected page/locator/navigation adapters. Add `test/scripts/smoke-live-oauth.test.ts` for an import-safe Apple smoke orchestrator: inject browser/context/canary adapters; assert it creates a fresh unauthenticated context, calls the shared canary with the exact Apple production contract, records only safe evidence, closes on success/failure, and propagates failures. `scripts/smoke-live.mjs` will call this module, but tests must import/invoke the module directly rather than inspect CLI source strings. In the same red commit, extend behavioral launcher assertions in `test/scripts/e2e-run-cleanup.test.ts`, add the fresh unauthenticated `oauth-navigation` project to existing `playwright.config.ts`, and add `e2e/flows/oauth-navigation.spec.ts` invoking the absent shared canary through the real `/auth/google` loader while intercepting only `https://accounts.google.com/**`. Do not create a second config/server stack. Run the focused Vitest and Playwright commands for red.
**Output**: `unit-2a-vitest-red.log` and `unit-2a-browser-red.log` proving the shared canary/launcher path is absent.
**Acceptance**: `node scripts/run-with-warning-policy.mjs -- pnpm exec vitest run test/scripts/smoke-live-helpers.test.ts test/scripts/smoke-live-oauth.test.ts test/scripts/e2e-run-cleanup.test.ts` and `node scripts/run-with-warning-policy.mjs -- pnpm exec playwright test e2e/flows/oauth-navigation.spec.ts --config=playwright.config.ts --project=oauth-navigation --reporter=list` fail only for intended absent canary/orchestrator/config/launcher behavior, with zero unrelated failures or warnings.

### ⬜ Unit 2b: Service-worker OAuth Live Canary — Implementation
**What**: Implement the minimal canary in `scripts/smoke-live-helpers.mjs`, the import-safe injected caller in `scripts/smoke-live-oauth.mjs`, extend existing `e2e/support/start-ephemeral-wrangler.mjs` to pass test-only Google env, and replace `scripts/smoke-live.mjs`'s request-only Apple guard with the orchestrator. The shared canary accepts provider label/link selector plus explicit app base URL and expected handoff host/client/callback/response-mode; the branch spec supplies Google/intercepted values while the Apple orchestrator pins `https://spoonjoy.app`, `appleid.apple.com`, `app.spoonjoy.client`, `https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithApple`, and `form_post`. It loads `/login`, registers CSP collection before navigation, establishes/reloads under live `/sw.js` control, clicks the provider link, observes the top-level document navigation, and validates public handoff parameters. CSP collection is limited to Spoonjoy-origin documents before handoff and serializes only directive, Spoonjoy document path, blocked origin, and phase; snapshot it at handoff and never inspect private provider DOM. Existing launcher/global teardown owns process/persist-state cleanup; the injected orchestrator owns fresh context lifecycle and closes in `finally` without altering the smoke user's session.
**Output**: Reusable exact interaction canary integrated into production `smoke:live` results.
**Acceptance**: Both exact Unit 2a commands pass unchanged; the canary has no credential entry or private artifact values; existing launcher cleanup remains green; `pnpm run verify:clean:build` passes with zero warnings.

### ⬜ Unit 2c: Service-worker OAuth Live Canary — Coverage & Refactor
**What**: Run `node scripts/run-with-warning-policy.mjs -- pnpm exec vitest run test/scripts/smoke-live-helpers.test.ts test/scripts/smoke-live-oauth.test.ts test/scripts/e2e-run-cleanup.test.ts --coverage --coverage.include=scripts/smoke-live-helpers.mjs --coverage.include=scripts/smoke-live-oauth.mjs --coverage.include=e2e/support/start-ephemeral-wrangler.mjs` for every new helper/orchestrator/launcher branch and error path, add missing edge cases, refactor while green, and rerun the exact Unit 2a browser command plus `pnpm run verify:clean:build`.
**Output**: `unit-2c-coverage.log`, `unit-2c-tests.log`, and `unit-2c-build.log`.
**Acceptance**: New helper code is 100% covered, all browser evidence validation paths are tested, build stays green, and logs contain zero warnings.

### ⬜ Unit 3: Branch-build Service-worker Browser Proof
**What**: Execute the already-red/green shared-canary Playwright proof against the built branch with `node scripts/run-with-warning-policy.mjs -- pnpm exec playwright test e2e/flows/oauth-navigation.spec.ts --config=playwright.config.ts --project=oauth-navigation --reporter=list`. Existing `playwright.config.ts`/`start-ephemeral-wrangler.mjs` build and start the app with test-only Google env; the fresh unauthenticated project calls the same provider-parameterized canary as production smoke, establishes actual branch `/sw.js` control, and clicks through the real `/auth/google` loader. Only `https://accounts.google.com/**` is intercepted for deterministic handoff. The proof asserts the `/auth/google` document request and serialized `redirectTo`, and existing global teardown proves no owned server/persist state remains; production Apple is covered by Units 2b and 9.
**Output**: `unit-3-branch-browser.log` and `unit-3-branch-browser.json` recording controller URL/state, document-request URL, redirectTo value, final controlled handoff URL, and CSP violations.
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
**What**: Save public predeploy observations from canonical `https://spoonjoy.app/api/v1/health` and Worker origin `https://spoonjoy-v2.mendelow-studio.workers.dev/api/v1/health`; require them to agree, but require no local Cloudflare/Wrangler credentials and treat the locked production workflow/artifact as deployment-state authority. Save all Unit 8–10 evidence beneath `/Users/arimendelow/desk/spoonjoy/web-apple-sign-in-production-repair/artifacts/`; product docs remain immutable. Run `pnpm run deploy:preflight`, read the merge SHA's workflow to record `SPOONJOY_RELEASE_MODE`, record merge/run-discovery timestamps, then discover the automatic exact-SHA `workflow_run` release first with `gh run list --workflow production-deploy.yml --event workflow_run --branch main --commit <merge-sha> --limit 20 --json databaseId,url,headSha,createdAt,status,conclusion,event`. After the exact-SHA main CI succeeds, poll every 30 seconds for up to 15 minutes, require exactly one eligible post-CI exact-SHA run, and watch it. A missing run after that window is release-pipeline failure and enters forward repair; timeout alone never authorizes manual dispatch. Manual `gh workflow run production-deploy.yml --ref main -f source_sha=<merge-sha>` is permitted only when the automatic artifact conclusively proves no mutation: `status=failed_before_stage` and phase is one of `validate`, `provenance`, `initial_preflight`, `build`, `post_build_posthog`, `post_build_provenance`, `migration_list`, `migration_review`, `full_preflight`, `current_deployment`, `deployment_revalidation`, or `version_snapshot`. Record that proof/timestamp, then select exactly one post-dispatch exact-SHA run. Always download `mcp-oauth-canary-artifacts/production-release.json`. Do not duplicate the workflow's large validator locally: rely on its locked run/check result and locally assert only exact `sourceSha`, recorded `releaseMode`, `status=promoted`, `phase=complete`, then verify both public health origins report the exact SHA and artifact candidate Worker. Absent/invalid failure artifact or any later/mutation phase requires forward repair. `production-release.json.previousVersionId` remains the sole protocol-canary rollback target authority; atomic modes never roll back.
**Output**: Desk-owned `unit-8-predeploy-state.json`, run-selection/conditional-dispatch evidence, downloaded `production-release.json`, assertion log, and exact post-run health/provenance evidence.
**Acceptance**: Evidence shows automatic exact-SHA discovery was attempted first and any manual dispatch met the recorded conclusive pre-mutation-artifact exception; absence/timeout never causes a dispatch. The selected locked workflow run is unique for the exact merge SHA; its artifact has exact SHA/mode plus `status=promoted`/`phase=complete`; both public health origins report that SHA and candidate Worker before Unit 9. A protocol-canary automatic rollback is verified but remains non-terminal; any non-promoted or post-mutation failure enters forward repair; cleanup never begins from a failure state.

### ⬜ Unit 9: Production Service-worker Apple Handoff
**What**: Against `https://spoonjoy.app` on the exact healthy merged deployment, verify live `/sw.js` bytes, run the enhanced production smoke, and independently repeat a fresh-profile service-worker-controlled Continue with Apple click through the browser surface.
**Output**: Smoke result and privacy-safe live handoff evidence saved under the Desk task artifacts and referenced from the Desk task card.
**Acceptance**: `/api/v1/health` still reports the exact merge SHA; service worker is active/current; the rendered Apple link reaches `appleid.apple.com/auth/authorize` with `client_id=app.spoonjoy.client`, `redirect_uri=https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithApple`, `response_mode=form_post`, and no CSP violation; no Apple credential entry is required. If Unit 8 or 9 fails, do not mutate this merged doing snapshot: record the failure in Desk, create a new dated product planning/doing repair doc on a new task branch, obtain cold approval of its scoped TDD contract, implement/validate/open/merge a new PR for a new exact-main SHA, then repeat release validation against that SHA. Cleanup remains forbidden until production handoff passes.

### ⬜ Unit 10: Cleanup and Durable Closure
**What**: Remove disposable smoke data that is not durable evidence; leave merged product planning/doing snapshots unchanged. Update the Desk task/checklist to terminal state with PR/deployment/smoke/cleanup evidence, commit/push Desk `main`, then remove the task-owned remote branch/local branch/worktree after confirming merge/deploy state and notify Slugger only after every terminal gate passes.
**Output**: Clean repositories and worktree inventory; immutable product execution snapshots plus accurately closed Desk task; completion notification sent.
**Acceptance**: Unit 8 ended with the exact merged SHA healthy (not merely rolled back) and Unit 9 passed before cleanup starts; no task-owned branch/worktree/temp residue remains; unrelated dirty Clem/PR #298 work is untouched; Desk and product remotes contain all durable evidence; task is not reported complete before production smoke passes.

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
