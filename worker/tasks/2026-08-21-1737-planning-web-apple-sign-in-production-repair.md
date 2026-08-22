# Planning: Web Apple Sign-in Production Repair

**Status**: approved
**Created**: 2026-08-21 17:38

## Goal
Restore reliable production web OAuth initiation, including Sign in with Apple, and prove a real service-worker-controlled browser click reaches the intended provider without weakening Spoonjoy's CSP.

## Upstream Work Items
- None

## Scope

### In Scope
- Replace the falsified deployment-drift diagnosis with evidence from current `origin/main` and production.
- Reproduce the live OAuth-button failure and distinguish form navigation, CSP, service-worker, provider configuration, callback, and asset/version causes.
- Add a regression canary that exercises the rendered OAuth interaction in a real browser with an active Spoonjoy service worker, records `securitypolicyviolation` events before navigation, and includes a direct-document-navigation control.
- Make the smallest code change needed for OAuth initiation to survive both service-worker control and production `form-action 'self'` enforcement.
- Preserve `redirectTo` exactly across OAuth initiation.
- Cover login, signup, and shared OAuth-button rendering contracts for Google, GitHub, and Apple because they use the same component and failure mode.
- Merge the reviewed fix, deploy the exact merged SHA to production, and verify version provenance plus the live service-worker-controlled Apple handoff.
- Clean task-owned branches, worktrees, and temporary smoke artifacts after terminal verification.

### Out of Scope
- Native Apple authentication or any changes in the native repository.
- Entering Apple credentials, completing MFA/passkey challenges, or changing Apple Developer configuration without new evidence that provider configuration is faulty.
- Weakening Spoonjoy's CSP by broadening `form-action` to arbitrary provider origins.
- Unrelated authentication, shopping-list, PWA-install, or service-worker behavior.

## Completion Criteria
- [x] A recorded red browser reproduction shows the current rendered OAuth interaction remaining on `/login`, while direct `/auth/apple` navigation reaches Apple's authorization page.
- [x] The exact root cause is supported by a red browser probe that asserts an active service-worker controller, captures the blocked form's `securitypolicyviolation` naming `form-action`, binds the event to the rendered same-origin `/auth/apple` GET action, and pairs it with a same-session direct-document-navigation control that reaches Apple. Chromium reports the form action—not the redirect target—as `blockedURI`, so Apple origin is proven by the paired control rather than required from the event.
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

## Open Questions
- [x] Is production missing merged fix #297? No. `851d9566` contains `86c58120`.
- [x] Is the live service-worker asset stale? No. Production `/sw.js` is byte-identical to `public/sw.js` at `origin/main`.
- [x] Does Apple reject Spoonjoy's initiation configuration? No evidence of that: direct `/auth/apple` reaches Apple's accepted authorization screen with `client_id=app.spoonjoy.client` and the production callback.
- [x] Does Chromium expose Apple's origin as the `securitypolicyviolation.blockedURI`? No. The controlled rendered click emits `form-action` while staying on `/login`, but reports the same-origin `/auth/apple` action origin; paired direct navigation proves that action redirects to Apple with the accepted public parameters.
- [ ] Does replacing the GET form with a same-origin anchor forced through native full-document navigation (`reloadDocument` or a deliberately native `<a>`) eliminate the silent failure under active service-worker control while retaining `redirectTo`? The browser canary must answer this before the implementation is accepted.

## Decisions Made
- Keep the production CSP lockdown. A navigation primitive should not require expanding `form-action` to three external identity providers.
- Do not implement the fix as `Button href={...}` without an explicit full-document contract: `app/components/ui/button.tsx` delegates internal hrefs to `app/components/ui/link.tsx`, whose default is React Router client navigation. The implementation must use and test `reloadDocument` or a deliberately native anchor so the request is a browser navigation rather than a router data fetch.
- Treat Apple as the operator-visible symptom but fix and test the shared OAuth initiation component for all configured providers.
- Do not perform provider credential entry during smoke testing. Success for this repair is the authenticated Spoonjoy initiation redirect reaching Apple's authorization surface with the correct public parameters; token exchange is covered by existing callback tests unless evidence implicates it.
- Keep production deployment/version mutations inside the locked release workflow. Local production smoke may receive only the least-privilege D1 cleanup/read authority needed to delete and verify its own disposable user; tests must prove an import-safe runtime wrapper strips all Cloudflare authority from Chromium and supplies only normalized D1 authority to cleanup/read subprocesses on success and failure paths.
- Treat the rendered action path plus paired direct-navigation control as the redirect-target binding. Do not require `securitypolicyviolation.blockedURI` to reveal the eventual Apple redirect target; Chromium reports the submitted same-origin action.
- Use the dedicated `worker/web-apple-sign-in-production-repair` worktree and leave the dirty Clem worktree and PR #298 untouched.

## Context / References
- `/Users/arimendelow/desk/spoonjoy/web-apple-sign-in-production-repair/task.md`
- `app/components/ui/oauth.tsx`
- `app/components/ui/button.tsx`
- `app/components/ui/link.tsx`
- `app/routes/auth.apple.tsx`
- `app/lib/security-headers.server.ts`
- `public/sw.js`
- `test/components/ui/oauth.test.tsx`
- `test/routes/login.test.tsx`
- `test/routes/signup.test.tsx`
- `test/lib/service-worker.test.ts`
- CSP Level 3 navigation response checks: https://www.w3.org/TR/CSP/#directive-form-action
- Merged PR #297: `86c58120925c38ffef387aebbc85071696091f71`
- Production evidence at investigation start: Worker `61caff11-8e88-4337-ad14-39f610fa89fe`, source `851d9566c955d8db4bcead1b44300ed279b9d5f2`.

## Notes
The previous assumption that production predated PR #297 was incorrect. Current evidence instead isolates the failure to the rendered form-click path: the live form is GET and silently stays on `/login`, while direct navigation reaches Apple. Production also enforces `form-action 'self'`, making a forced full-document same-origin anchor the leading minimal fix. That causal attribution is not accepted until the red probe captures a `form-action` violation under an asserted service-worker controller and the paired control succeeds.

## Progress Log
- 2026-08-21 17:38 Created after live reproduction and source/deployment provenance checks
- 2026-08-21 17:39 Tinfoil-hat pass confirmed provider breadth, CSP non-regression, active-service-worker evidence, exact-SHA deployment, and cleanup requirements
- 2026-08-21 17:43 Addressed Round 1 reviewer findings by requiring direct CSP-violation evidence, an explicit service-worker control assertion/control case, and a forced full-document anchor contract
- 2026-08-21 17:45 Grounded the form-redirect hypothesis in the CSP Level 3 navigation response-check specification
- 2026-08-21 17:51 Approved after Round 2 cold reviewer convergence (`PASS`)
- 2026-08-21 18:49 Unit 0 falsified the Apple blocked-origin assumption; retained the causal `form-action` evidence and paired control, and returned the plan to review before implementation
