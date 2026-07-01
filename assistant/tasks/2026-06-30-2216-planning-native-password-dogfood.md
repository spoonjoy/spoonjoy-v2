# Native Password Dogfood Planning

Status: APPROVED_FOR_AUTOPILOT_EXECUTION
Owner: assistant
Repos:
- `/Users/arimendelow/Projects/spoonjoy-v2-native-password-dogfood`
- `/Users/arimendelow/Projects/spoonjoy-apple-native-password-dogfood`

## Context

The native Apple app must justify being native, feel like Spoonjoy, and be dogfoodable on the local Mac without a paid Apple Developer signing setup. Sign in with Apple remains first-class, but unsigned local builds cannot use Apple's native entitlement path. The app therefore needs a first-party username/password sign-in path that issues the same scoped native tokens as Apple sign-in and restores the same offline/live app shell.

The web API already has hardened email/password verification and native Apple token exchange. The native app already persists `AuthSession` in the auth repository and Keychain/file-backed vault path. The plan is to add password auth by extending those existing paths instead of reintroducing the rejected web login handoff.

## Goals

- Add a first-party native username/password sign-in endpoint.
- Keep third-party OAuth clients barred from password handling.
- Add native request builders and repository support for password credentials.
- Redesign signed-out native UI around a clean Spoonjoy-native password form, with Apple as an alternate provider.
- Dogfood the app through the password path on macOS and iOS simulator where possible.
- Audit and fix app design, UX, accessibility, loading/error/offline states, and functional gaps discovered while dogfooding.
- Update API docs, OpenAPI, generated contract surfaces, tests, and the build-native-apple-app skill with lessons from this work.

## Non-Goals

- Do not invent new Spoonjoy product surfaces.
- Do not add recipe comments, messaging, or mail features.
- Do not require a paid Apple Developer subscription to validate the local desktop dogfood path.
- Do not loosen the third-party "no password grant" policy.

## Product And Security Decisions

- The endpoint is a Spoonjoy first-party native app sign-in endpoint, not OAuth `grant_type=password`.
- Password submission is online-only, never queued for offline replay, and never exposed through Siri, Shortcuts, third-party OAuth, MCP, or delegated agent flows.
- Auth failures must avoid account enumeration and should reuse the existing constant-time password verification.
- Token response shape should match the native Apple token exchange so the app can share session persistence, refresh, sync, and revoke behavior.
- Signed-out UI should communicate current state in context, not show unexplained offline chips or raw framework errors.

## Work Units

1. Baseline and planning docs.
2. Backend native password auth endpoint with tests.
3. API contract, OpenAPI, and documentation updates.
4. Native auth request/repository tests and implementation.
5. Signed-out native UI redesign with username/password primary flow.
6. Local dogfood path: seed or reuse a local account, sign in, exercise primary surfaces, capture screenshots.
7. Design/UX/quality audit fixes across signed-out, kitchen, recipe detail, shopping, search, capture, settings, offline, and empty/error states.
8. Verification: web tests, Swift tests, Xcode builds, simulator/macOS smoke, screenshot review, subagent review gates, PRs/merges.
9. Skill update for `build-native-apple-app`.

## Review Gates

Human gates are waived by project instruction. Review must still be harsh and independent:

- Auth/API reviewer: endpoint contract, rate limiting, token semantics, docs consistency.
- Native reviewer: Swift auth/session correctness and Apple platform expectations.
- Design/UX reviewer: visual quality, product-family fit, interaction state clarity, accessibility.
- Final integration reviewer: no deferred required work, no broken validation, no stale docs.

## Risks

- A password token endpoint can be misunderstood as public OAuth password grant. Mitigation: naming, docs, OpenAPI summaries, and tests must explicitly distinguish first-party native sign-in from third-party OAuth.
- Local dogfood may require credentials. Mitigation: use disposable local/test account data for local validation; only call out true blockers for production account credentials or paid signing.
- The signed-out screen can look native but bland. Mitigation: use the Spoonjoy "Kitchen Table" design language, native controls, real brand mark, focused spacing, and screenshot validation.
- Large UI audit scope can sprawl. Mitigation: use subagents and split fixes by surface while keeping product-model parity.

