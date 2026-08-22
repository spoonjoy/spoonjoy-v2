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
**What**: Update `test/components/ui/oauth.test.tsx`, `test/components/ui/link.test.tsx`, `test/routes/login.test.tsx`, `test/routes/signup.test.tsx`, and `test/routes/auth-google.test.ts` first. Require every OAuth provider control to render as a same-origin link rather than a form/button. Pin the href to `/auth/${provider}` when absent and `/auth/${provider}?redirectTo=${encodeURIComponent(redirectTo)}` when present, with no hidden input or second encoding; the Google loader test reads the signed start session and proves a query/special-character value is recovered exactly once as the original string. Require `reloadDocument?: boolean` on the shared link abstraction, pass it to internal `RouterLink`, cover true/false, and prove it is consumed and never emitted by external/special-protocol native anchors. In the same red commit, add task-owned `e2e/oauth-navigation.spec.ts`, `playwright.oauth-navigation.config.ts`, and `e2e/support/start-oauth-navigation-fixture.mjs`: the config builds/serves the real branch app with test-only Google env, the spec navigates the real same-origin `/auth/google` loader, and Playwright intercepts only `https://accounts.google.com/**` to fulfill a deterministic provider handoff page. It must not intercept or replace `/auth/google` or add a production-code seam. The fixture owns its ephemeral port/process/context/temp state and closes all of them in `finally`/Playwright teardown on success or failure.
**Output**: Focused failing component tests and a failing real-browser spec/config/harness whose failures specifically show the current GET forms and missing full-document-link contract.
**Acceptance**: `node scripts/run-with-warning-policy.mjs -- pnpm exec vitest run test/components/ui/oauth.test.tsx test/components/ui/link.test.tsx test/routes/login.test.tsx test/routes/signup.test.tsx test/routes/auth-google.test.ts` and `node scripts/run-with-warning-policy.mjs -- pnpm exec playwright test e2e/oauth-navigation.spec.ts --config=playwright.oauth-navigation.config.ts --project=chromium-oauth-navigation --reporter=list` fail for the intended semantic/navigation assertions, with zero unrelated failures or warnings; red outputs are saved as `unit-1a-vitest-red.log` and `unit-1a-browser-red.log`.

### ⬜ Unit 1b: Full-document OAuth Initiation — Implementation
**What**: Minimally update `app/components/ui/link.tsx` so `reloadDocument?: boolean` is destructured/consumed, passed only to internal `RouterLink`, and omitted from external/special-protocol native anchors, then update `app/components/ui/oauth.tsx` to build the exact Unit 1a provider href and render the existing styled `Button` as an internal link with `reloadDocument`. Remove stale form/service-worker commentary and document why native full-document navigation avoids CSP form redirect checks and router data-fetch redirects.
**Output**: Shared OAuth controls are anchors that initiate a browser document request to `/auth/{provider}`; `redirectTo` is encoded into the href once.
**Acceptance**: Unit 1a tests pass without modifying their assertions; rendered links retain existing styling/accessibility; no form remains around OAuth controls; no CSP directive is broadened; both exact Unit 1a commands and `pnpm run verify:clean:build` pass with zero warnings.

### ⬜ Unit 1c: Full-document OAuth Initiation — Coverage & Refactor
**What**: Run `node scripts/run-with-warning-policy.mjs -- pnpm exec vitest run test/components/ui/oauth.test.tsx test/components/ui/link.test.tsx test/routes/login.test.tsx test/routes/signup.test.tsx test/routes/auth-google.test.ts --coverage --coverage.include=app/components/ui/oauth.tsx --coverage.include=app/components/ui/link.tsx`, add only missing null/empty/query/encoding cases, refactor duplication without behavior changes, and rerun the exact Unit 1a browser command plus `pnpm run verify:clean:build`.
**Output**: `unit-1c-coverage.log`, `unit-1c-tests.log`, and `unit-1c-build.log`.
**Acceptance**: New/modified branches are 100% covered; every provider and redirect edge is green; build is green; all logs contain zero warnings.

### ⬜ Unit 2a: Service-worker OAuth Live Canary — Tests
**What**: Add failing tests in `test/scripts/smoke-live-helpers.test.ts` for privacy-safe OAuth browser evidence validation, report serialization, and explicit base-URL/controlled-handoff inputs. Cover missing controller, wrong controller script, wrong provider host/client/callback, unexpected CSP violations, success, red-baseline evidence, and rejection of unsafe/ambiguous fixture inputs. Add a source-contract test requiring the production smoke to create an isolated unauthenticated context, wait for service-worker readiness, assert active control, click the rendered Apple link, and validate the provider URL rather than using only request-context HTTP calls. Run `node scripts/run-with-warning-policy.mjs -- pnpm exec vitest run test/scripts/smoke-live-helpers.test.ts` for red.
**Output**: Focused failing helper/source-contract tests that fail because the live smoke still bypasses the rendered interaction.
**Acceptance**: Red failures are caused by absent browser-flow validation contracts, not mocks or unrelated smoke behavior; output saved as `unit-2a-red.log`.

### ⬜ Unit 2b: Service-worker OAuth Live Canary — Implementation
**What**: Add minimal pure helpers to `scripts/smoke-live-helpers.mjs` and replace `scripts/smoke-live.mjs`'s request-only Apple guard with an isolated unauthenticated browser context. The canary must accept explicit app base URL and expected handoff contract inputs so Unit 3 can run the same code against the branch fixture while production pins app base `https://spoonjoy.app`, provider host `appleid.apple.com`, client ID `app.spoonjoy.client`, callback `https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithApple`, and response mode `form_post`. It must load `/login`, register its CSP listener before navigation, await `navigator.serviceWorker.ready`, reload, assert the live controller, click the unique Continue with Apple link, and assert those final public authorization values. CSP collection is limited to Spoonjoy-origin documents before handoff and serializes only directive, Spoonjoy document path, blocked origin, and phase; remove/snapshot it at handoff and never inspect private provider DOM. It must fail on any accepted CSP violation and close the isolated context without altering the smoke user's session.
**Output**: Reusable exact interaction canary integrated into production `smoke:live` results.
**Acceptance**: Unit 2a tests pass unchanged; the canary has no credential entry and no private values in artifacts; targeted tests and `pnpm run verify:clean:build` pass with zero warnings.

### ⬜ Unit 2c: Service-worker OAuth Live Canary — Coverage & Refactor
**What**: Run `node scripts/run-with-warning-policy.mjs -- pnpm exec vitest run test/scripts/smoke-live-helpers.test.ts --coverage --coverage.include=scripts/smoke-live-helpers.mjs` for every new helper branch and error path, add missing edge cases, refactor while green, and rerun the exact Unit 1a browser command plus `pnpm run verify:clean:build`.
**Output**: `unit-2c-coverage.log`, `unit-2c-tests.log`, and `unit-2c-build.log`.
**Acceptance**: New helper code is 100% covered, all browser evidence validation paths are tested, build stays green, and logs contain zero warnings.

### ⬜ Unit 3: Branch-build Service-worker Browser Proof
**What**: Execute the already-red/green Unit 1a Playwright harness against the built branch with `node scripts/run-with-warning-policy.mjs -- pnpm exec playwright test e2e/oauth-navigation.spec.ts --config=playwright.oauth-navigation.config.ts --project=chromium-oauth-navigation --reporter=list`. The config's `webServer` must run `pnpm run verify:clean:build` before starting its ephemeral server with test-only Google env; the spec uses a fresh Chromium context, awaits the actual branch `/sw.js`, reloads until `navigator.serviceWorker.controller` is active, then clicks the rendered Google OAuth link through the real app's same-origin `/auth/google` loader. Only the provider origin is intercepted by Playwright for deterministic handoff. The fixture asserts the `/auth/google` document request and serialized `redirectTo` without production credentials, and teardown proves no owned server/context/temp state remains; production Apple is covered separately by Units 2b and 9.
**Output**: `unit-3-branch-browser.log` and `unit-3-branch-browser.json` recording controller URL/state, document-request URL, redirectTo value, final controlled handoff URL, and CSP violations.
**Acceptance**: The test runs against the built branch (not jsdom/source inspection), proves active service-worker control, proves a document navigation rather than a router data request, preserves a special-character/query-bearing `redirectTo`, reaches the controlled cross-origin handoff, and records zero CSP violations.

### ⬜ Unit 4: Main Sync and Full Validation
**What**: Fetch `origin/main`, rebase the task branch safely, resolve only task-owned conflicts, then run exact repository lanes: `pnpm run verify:clean:typecheck`, `node scripts/run-with-warning-policy.mjs -- pnpm run typecheck:scripts`, `pnpm run verify:clean:generated-contract`, `pnpm run verify:clean:migrations`, `pnpm run verify:clean:migrations:qa`, `pnpm run verify:clean:test:coverage`, `pnpm run verify:clean:test:workers:coverage`, `pnpm run verify:clean:test:e2e`, the exact separate Unit 3 Playwright command/config, `pnpm run production:readiness`, `pnpm run deploy:preflight`, and `pnpm run verify:clean:build`.
**Output**: Rebase evidence and complete validation logs under the artifacts directory.
**Acceptance**: Branch is based on current `origin/main`; all named suites/checks pass with 100% new-code coverage and zero warnings; tree contains only intentional task files; rebased branch is pushed with lease.

### ⬜ Unit 5: Cold Branch Review
**What**: Dispatch a fresh cold reviewer over the exact rebased diff, Unit 0 causal evidence, Unit 3 branch-browser evidence, targeted/full tests, coverage, and build output. Address every BLOCKER/MAJOR finding through strict TDD and re-review to convergence.
**Output**: Reviewer verdicts, any fix commits, and final converged review record under the artifacts directory.
**Acceptance**: Cold review converges with no BLOCKER/MAJOR finding; any changed code is covered by new red/green evidence; branch remains fully green and pushed.

### ⬜ Unit 6: PR and Required Checks
**What**: Open a focused PR against current `main` with the falsified-diagnosis correction and causal red/green evidence. Monitor every required check to completion and audit review-thread state without merging.
**Output**: PR URL/number, exact reviewed head SHA, required-check matrix, and review-thread inventory recorded under artifacts.
**Acceptance**: Every required check is green for the exact reviewed head; no merge conflict exists; all review findings are classified; PR remains ready for the feedback/merge unit.

### ⬜ Unit 7: CI/Review Feedback and Merge
**What**: Resolve every actionable CI or review finding through strict TDD, rerun affected/full checks, obtain merge-readiness convergence on the final head, and merge using an enabled repository strategy.
**Output**: Final reviewed head, resolved-thread evidence, merge method, and merge SHA recorded under artifacts.
**Acceptance**: PR is merged rather than merely open; merge SHA is on `origin/main`; no unresolved review thread or failing required check remains.

### ⬜ Unit 8: Exact-SHA Workflow Deployment and Release-state Safety
**What**: Record canonical `https://spoonjoy.app/api/v1/health` plus Worker-origin `https://spoonjoy-v2.mendelow-studio.workers.dev/api/v1/health`, then run authoritative active-version command `pnpm exec wrangler deployments list --json` with the production Worker credentials/config and save the command/output together in `unit-8-predeploy-state.json`; require both health origins to agree with the selected 100% active Worker version/source. This snapshot is observational only: `production-release.json.previousVersionId` remains the sole rollback target authority. Run `pnpm run deploy:preflight`, read the merge SHA's `.github/workflows/production-deploy.yml` to record its source-controlled `SPOONJOY_RELEASE_MODE`, record an RFC3339 dispatch timestamp, and dispatch exactly `gh workflow run production-deploy.yml --ref main -f source_sha=<40-char-merge-sha>`. Query `gh run list --workflow production-deploy.yml --event workflow_dispatch --branch main --commit <merge-sha> --limit 20 --json databaseId,url,headSha,createdAt,status,conclusion`, require exactly one run at/after the dispatch timestamp, record its run ID/URL, then `gh run watch <run-id> --exit-status`. Always download artifact `mcp-oauth-canary-artifacts` with `gh run download <run-id> --name mcp-oauth-canary-artifacts --dir <unit-8-artifacts>` and apply a local `jq -e` contract mirroring the merge SHA's workflow validator to `production-release.json`: exact source SHA/release mode/strategy, allowed status/phase/migration fields, valid distinct Worker IDs when required, sanitized failures, and `/api/v1/health` provenance. For `protocol-v1-canary`, trust only the workflow artifact's staged promotion/automatic rollback outcome and, if an intentional rollback dispatch becomes necessary, use its recorded `previousVersionId`; for `atomic-bootstrap` or `atomic-product-activation`, do not attempt rollback (the workflow forbids it) and treat any non-`promoted` result as `forward_repair_required`, keeping the task active until a new exact-main repair SHA is deployed.
**Output**: `unit-8-predeploy-state.json`, dispatch timestamp, selected run metadata, downloaded `production-release.json`, validation log, and exact post-run health/provenance evidence.
**Acceptance**: The selected run is uniquely tied to the exact merge SHA; artifact validation passes; only `status=promoted`, `phase=complete`, matching release mode/strategy/SHA, and exact `/api/v1/health` provenance can advance to Unit 9. A protocol-canary automatic rollback is verified but remains non-terminal; an atomic failure is recorded as forward repair with no rollback attempt; cleanup never begins from either failure state.

### ⬜ Unit 9: Production Service-worker Apple Handoff
**What**: Against `https://spoonjoy.app` on the exact healthy merged deployment, verify live `/sw.js` bytes, run the enhanced production smoke, and independently repeat a fresh-profile service-worker-controlled Continue with Apple click through the browser surface.
**Output**: Smoke result and privacy-safe live handoff evidence saved under artifacts and referenced from the task card.
**Acceptance**: `/api/v1/health` still reports the exact merge SHA; service worker is active/current; the rendered Apple link reaches `appleid.apple.com/auth/authorize` with `client_id=app.spoonjoy.client`, `redirect_uri=https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithApple`, `response_mode=form_post`, and no CSP violation; no Apple credential entry is required. If Unit 8 or 9 fails, do not proceed or mutate a reviewed unit: append a new numbered TDD repair unit to this doing doc, mark it in progress, obtain cold approval of its scoped red/green contract, implement and validate it, open/merge a new PR to obtain a new exact-main SHA, then repeat Units 4–9 against that SHA. Cleanup remains forbidden until the repeated Unit 9 passes.

### ⬜ Unit 10: Cleanup and Durable Closure
**What**: Remove disposable smoke data/artifacts that are not durable evidence; update and push the planning/doing checklists and statuses while the worktree still exists; then remove the task-owned remote branch/local branch/worktree after confirming merge/deploy state. Finally update the Desk task to terminal state with PR/deployment evidence, commit/push all durable Desk changes, and notify Slugger only after every terminal gate passes.
**Output**: Clean repositories and worktree inventory; planning/doing/task cards accurately closed; completion notification sent.
**Acceptance**: Unit 8 ended with the exact merged SHA healthy (not merely rolled back) and Unit 9 passed before cleanup starts; no task-owned branch/worktree/temp residue remains; unrelated dirty Clem/PR #298 work is untouched; Desk and product remotes contain all durable evidence; task is not reported complete before production smoke passes.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-08-21-1737-doing-web-apple-sign-in-production-repair/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away
- **Forward repair**: Any Unit 8/9 failure appends a reviewer-approved numbered TDD unit and produces a new PR/SHA; rerun Units 4–9 before cleanup

## Progress Log
- 2026-08-21 17:52 Created from approved planning doc
- 2026-08-21 17:54 Conversion audit made cleanup ordering executable: repository docs are pushed before their worktree is removed, then Desk state closes
- 2026-08-21 18:00 Addressed granularity review: added branch-build SW proof, split sync/review/PR/feedback/deploy/live-smoke units, made production observations fresh, and added explicit rollback safety
- 2026-08-21 18:01 Self-audit made the tested canary explicitly reusable against both the branch fixture and production, so Unit 3 adds no unplanned post-implementation test code
- 2026-08-21 18:07 Granularity Pass 2 converged (`PASS`)
- 2026-08-21 18:12 Addressed Validation Pass 3 source-fidelity findings: executable tests-first Playwright branch harness, exact coverage/validation commands, exact-SHA workflow dispatch/artifact validation, and release-mode-correct failure handling
- 2026-08-21 18:14 Validation self-audit made the separate OAuth Playwright lane explicit in full validation and pinned run selection to workflow/event/branch/commit/timestamp uniqueness
- 2026-08-21 18:24 Addressed ambiguity review: causal stop/replan gate, real-loader fixture ownership, canonical encoding/session contract, canonical-vs-Worker origins, privacy-scoped CSP capture, explicit forward-repair loop, internal-only `reloadDocument`, and authoritative predeploy version snapshot
