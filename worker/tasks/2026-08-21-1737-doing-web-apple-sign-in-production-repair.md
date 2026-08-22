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
**What**: Run a disposable Chromium probe against current production before code changes. Install a pre-navigation `securitypolicyviolation` listener, load `/login`, await service-worker readiness, reload, assert `navigator.serviceWorker.controller.scriptURL` is live `/sw.js`, click the rendered Apple GET form, and record URL/violation data. In the same browser context, directly navigate to `/auth/apple` as the control and record Apple's accepted public authorization parameters. Record current `/api/v1/health`, live `/sw.js` digest, source ancestry, and CSP header.
**Output**: `./2026-08-21-1737-doing-web-apple-sign-in-production-repair/unit-0-production-red.json` and `unit-0-production-red.md` containing privacy-safe causal evidence; no Apple credentials or private page values.
**Acceptance**: Evidence proves the page is service-worker controlled; the form click stays on `/login`; a `form-action` violation identifies the blocked Apple redirect; direct navigation reaches `appleid.apple.com/auth/authorize`; the freshly observed production source SHA is recorded and tested for ancestry of fix #297 (`86c58120`); live `/sw.js` is compared with the same observed source tree rather than a hard-coded deployment assumption.

### ⬜ Unit 1a: Full-document OAuth Initiation — Tests
**What**: Update `test/components/ui/oauth.test.tsx`, `test/components/ui/link.test.tsx`, `test/routes/login.test.tsx`, and `test/routes/signup.test.tsx` first. Require every OAuth provider control to render as a same-origin link rather than a form/button, require the shared link abstraction to preserve React Router's explicit `reloadDocument` contract, and assert absent/present `redirectTo` href construction including existing query strings and special characters.
**Output**: Focused failing tests whose failures specifically show the current GET forms and missing full-document-link contract.
**Acceptance**: Targeted test command fails for the intended semantic/href/reload-document assertions, with zero unrelated failures or warnings; red output saved as `unit-1a-red.log`.

### ⬜ Unit 1b: Full-document OAuth Initiation — Implementation
**What**: Minimally update `app/components/ui/link.tsx` so `reloadDocument` is a typed, internal-link-only React Router contract, and update `app/components/ui/oauth.tsx` to build the provider href and render the existing styled `Button` as an internal link with `reloadDocument`. Remove stale form/service-worker commentary and document why native full-document navigation avoids CSP form redirect checks and router data-fetch redirects.
**Output**: Shared OAuth controls are anchors that initiate a browser document request to `/auth/{provider}`; `redirectTo` is encoded into the href once.
**Acceptance**: Unit 1a tests pass without modifying their assertions; rendered links retain existing styling/accessibility; no form remains around OAuth controls; no CSP directive is broadened; targeted tests and `pnpm run verify:clean:build` pass with zero warnings.

### ⬜ Unit 1c: Full-document OAuth Initiation — Coverage & Refactor
**What**: Run focused coverage for the modified component/link files, add only missing null/empty/query/encoding cases, refactor duplication without behavior changes, and rerun targeted tests plus the clean build.
**Output**: `unit-1c-coverage.log`, `unit-1c-tests.log`, and `unit-1c-build.log`.
**Acceptance**: New/modified branches are 100% covered; every provider and redirect edge is green; build is green; all logs contain zero warnings.

### ⬜ Unit 2a: Service-worker OAuth Live Canary — Tests
**What**: Add failing tests in `test/scripts/smoke-live-helpers.test.ts` for privacy-safe OAuth browser evidence validation, report serialization, and explicit base-URL/controlled-handoff inputs. Cover missing controller, wrong controller script, wrong provider host/client/callback, unexpected CSP violations, success, red-baseline evidence, and rejection of unsafe/ambiguous fixture inputs. Add a source-contract test requiring the production smoke to create an isolated unauthenticated context, wait for service-worker readiness, assert active control, click the rendered Apple link, and validate the provider URL rather than using only request-context HTTP calls.
**Output**: Focused failing helper/source-contract tests that fail because the live smoke still bypasses the rendered interaction.
**Acceptance**: Red failures are caused by absent browser-flow validation contracts, not mocks or unrelated smoke behavior; output saved as `unit-2a-red.log`.

### ⬜ Unit 2b: Service-worker OAuth Live Canary — Implementation
**What**: Add minimal pure helpers to `scripts/smoke-live-helpers.mjs` and replace `scripts/smoke-live.mjs`'s request-only Apple guard with an isolated unauthenticated browser context. The canary must accept an explicit app base URL and expected handoff contract so Unit 3 can run the same code against the branch fixture while production uses Spoonjoy/Apple constants. It must load `/login`, await `navigator.serviceWorker.ready`, reload, assert the live controller, click the unique Continue with Apple link, assert the final public authorization host/client ID/callback/response mode, and record privacy-safe evidence. It must fail on any CSP violation and close the isolated context without altering the smoke user's session.
**Output**: Reusable exact interaction canary integrated into production `smoke:live` results.
**Acceptance**: Unit 2a tests pass unchanged; the canary has no credential entry and no private values in artifacts; targeted tests and `pnpm run verify:clean:build` pass with zero warnings.

### ⬜ Unit 2c: Service-worker OAuth Live Canary — Coverage & Refactor
**What**: Run focused coverage for every new helper branch and error path, add missing edge cases, refactor while green, and rerun targeted tests plus the clean build.
**Output**: `unit-2c-coverage.log`, `unit-2c-tests.log`, and `unit-2c-build.log`.
**Acceptance**: New helper code is 100% covered, all browser evidence validation paths are tested, build stays green, and logs contain zero warnings.

### ⬜ Unit 3: Branch-build Service-worker Browser Proof
**What**: Run the built branch through a production-shaped local/ephemeral server and a fresh Chromium context. Register and await the actual branch `/sw.js`, reload until `navigator.serviceWorker.controller` is active, then click the rendered OAuth link through its real full-document path. Use a deterministic same-origin initiation fixture/route response so the test can assert the outgoing `/auth/apple` document request and serialized `redirectTo` before a controlled cross-origin handoff without requiring production credentials.
**Output**: `unit-3-branch-browser.log` and `unit-3-branch-browser.json` recording controller URL/state, document-request URL, redirectTo value, final controlled handoff URL, and CSP violations.
**Acceptance**: The test runs against the built branch (not jsdom/source inspection), proves active service-worker control, proves a document navigation rather than a router data request, preserves a special-character/query-bearing `redirectTo`, reaches the controlled cross-origin handoff, and records zero CSP violations.

### ⬜ Unit 4: Main Sync and Full Validation
**What**: Fetch `origin/main`, rebase the task branch safely, resolve only task-owned conflicts, and run formatting/lint/type checks, complete Vitest and Workers coverage lanes, Playwright E2E including Unit 3, production-readiness/deployment preflight checks, and the clean build.
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

### ⬜ Unit 8: Deployment, Provenance, and Rollback Safety
**What**: Before deployment, record the current healthy production Worker version/source SHA as the explicit rollback target. Follow the repository production workflow for the exact merged `origin/main` SHA, then verify the release artifact and `/api/v1/health` provenance. If promotion or health verification fails, execute the documented rollback to the recorded version, verify rollback health/provenance, and keep the task active for forward repair.
**Output**: `unit-8-rollback-target.json`, production release artifact, and post-promotion or post-rollback health/provenance evidence.
**Acceptance**: Either the exact merged SHA is active and healthy, or the prior recorded version is verifiably restored and the task remains non-terminal; cleanup cannot begin from an unknown/unhealthy production state.

### ⬜ Unit 9: Production Service-worker Apple Handoff
**What**: Against the exact healthy merged deployment, verify live `/sw.js` bytes, run the enhanced production smoke, and independently repeat a fresh-profile service-worker-controlled Continue with Apple click through the browser surface.
**Output**: Smoke result and privacy-safe live handoff evidence saved under artifacts and referenced from the task card.
**Acceptance**: `/api/v1/health` still reports the exact merge SHA; service worker is active/current; the rendered Apple link reaches Apple's accepted authorization page with `client_id=app.spoonjoy.client`, the registered Spoonjoy callback, and no CSP violation; no Apple credential entry is required. If this fails, return to a TDD repair unit rather than proceeding to cleanup.

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

## Progress Log
- 2026-08-21 17:52 Created from approved planning doc
- 2026-08-21 17:54 Conversion audit made cleanup ordering executable: repository docs are pushed before their worktree is removed, then Desk state closes
- 2026-08-21 18:00 Addressed granularity review: added branch-build SW proof, split sync/review/PR/feedback/deploy/live-smoke units, made production observations fresh, and added explicit rollback safety
- 2026-08-21 18:01 Self-audit made the tested canary explicitly reusable against both the branch fixture and production, so Unit 3 adds no unplanned post-implementation test code
