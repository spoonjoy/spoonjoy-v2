# Planning: Web Apple Sign-in Production Repair

**Status**: NEEDS_REVIEW
**Created**: 2026-08-21 17:38

## Goal
Restore reliable production web OAuth initiation, including Sign in with Apple, and prove a real service-worker-controlled browser click reaches the intended provider without weakening Spoonjoy's CSP.

## Upstream Work Items
- None

## Scope

### In Scope
- Replace the falsified deployment-drift diagnosis with evidence from current `origin/main` and production.
- Reproduce the live OAuth-button failure and distinguish form navigation, CSP, service-worker, provider configuration, callback, and asset/version causes.
- Add a regression canary that exercises the rendered OAuth interaction in a real browser with an active Spoonjoy service worker.
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
- [ ] A recorded red browser reproduction shows the current rendered OAuth interaction remaining on `/login`, while direct `/auth/apple` navigation reaches Apple's authorization page.
- [ ] The exact root cause is supported by a red/green service-worker-controlled browser canary rather than inference alone.
- [ ] Login and signup expose provider initiation as navigation that is compatible with both `form-action 'self'` and the active service worker.
- [ ] `redirectTo` is URL-encoded once and preserved byte-for-byte through the initiation URL.
- [ ] Targeted unit/integration/browser tests cover every provider, absent/present `redirectTo`, and the active-service-worker navigation path.
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
- [ ] Does replacing the GET form with a real same-origin link eliminate the silent failure under active service-worker control while retaining `redirectTo`? The browser canary must answer this before the implementation is accepted.

## Decisions Made
- Keep the production CSP lockdown. A navigation primitive should not require expanding `form-action` to three external identity providers.
- Treat Apple as the operator-visible symptom but fix and test the shared OAuth initiation component for all configured providers.
- Do not perform provider credential entry during smoke testing. Success for this repair is the authenticated Spoonjoy initiation redirect reaching Apple's authorization surface with the correct public parameters; token exchange is covered by existing callback tests unless evidence implicates it.
- Use the dedicated `worker/web-apple-sign-in-production-repair` worktree and leave the dirty Clem worktree and PR #298 untouched.

## Context / References
- `/Users/arimendelow/desk/spoonjoy/web-apple-sign-in-production-repair/task.md`
- `app/components/ui/oauth.tsx`
- `app/components/ui/button.tsx`
- `app/routes/auth.apple.tsx`
- `app/lib/security-headers.server.ts`
- `public/sw.js`
- `test/components/ui/oauth.test.tsx`
- `test/routes/login.test.tsx`
- `test/routes/signup.test.tsx`
- `test/lib/service-worker.test.ts`
- Merged PR #297: `86c58120925c38ffef387aebbc85071696091f71`
- Production evidence at investigation start: Worker `61caff11-8e88-4337-ad14-39f610fa89fe`, source `851d9566c955d8db4bcead1b44300ed279b9d5f2`.

## Notes
The previous assumption that production predated PR #297 was incorrect. Current evidence instead isolates the failure to the rendered form-click path: the live form is GET and silently stays on `/login`, while direct navigation reaches Apple. Production also enforces `form-action 'self'`, making a same-origin link the leading minimal fix, subject to a real service-worker-controlled red/green canary.

## Progress Log
- 2026-08-21 17:38 Created after live reproduction and source/deployment provenance checks
