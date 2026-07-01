# Native Password Dogfood Doing

Status: IN_PROGRESS
Owner: assistant

## Unit 1: Backend Password Sign-In

- Add failing tests for `POST /api/v1/auth/password/native`.
- Cover success, invalid credentials, missing fields, unknown fields, wrong method, auth rate limit behavior, cache-control, token shape, and third-party policy docs.
- Implement the endpoint using existing password verification and native token issuance.
- Keep token response compatible with native Apple sign-in.
- Update API resource contract, operation telemetry, OpenAPI schemas/examples, and docs.
- Run focused web tests and type checks.

## Unit 2: Native Auth Core

- Add failing Swift tests for native password credential request building.
- Add repository injection and `handlePasswordSignInCredential`.
- Persist the returned session under a stable first-party native password client id.
- Ensure revoke/logout, restore, refresh, and binding reuse the existing session flow.
- Wire live default dependencies to call the new endpoint.
- Run focused Swift tests.

## Unit 3: Signed-Out UX

- Replace Apple-only signed-out panel with a first-class username/password form.
- Keep Sign in with Apple as an alternate provider with entitlement-aware messaging.
- Remove unexplained status copy, raw errors, false offline presentation, and unnecessary macOS scrolling.
- Preserve pending-route context and Settings/Disconnect behavior.
- Add source-contract tests for the new signed-out shell.

## Unit 4: Dogfood And Audit

- Start local web API and native app in a reproducible dogfood configuration.
- Create or reuse disposable local credentials.
- Sign in through the native password path.
- Exercise kitchen, recipes, recipe detail, cook mode, shopping list, search, capture/import, settings, offline restore, sync, and deep links.
- Capture macOS and iOS simulator screenshots.
- Score each surface for design quality, UX clarity, functional parity, accessibility, offline behavior, error handling, native affordances, and perceived performance.

## Unit 5: Fixes From Audit

- Fix all reachable issues discovered in Unit 4 unless blocked by a true human-only constraint.
- Prefer small commits/PRs split by surface or contract.
- Re-run dogfood after every meaningful UI/auth fix.

## Unit 6: Final Verification And Merge

- Run backend tests and relevant full checks.
- Run Swift package tests with warnings as errors.
- Run iOS and macOS xcodebuild validation.
- Run scenario/design validation scripts.
- Run harsh subagent reviewers.
- Update the `build-native-apple-app` skill with durable lessons.
- Create and merge PRs for web/API, Apple app, and skills.
- Notify Slugger when done.

