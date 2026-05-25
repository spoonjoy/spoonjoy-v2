# Spoonjoy v2 Pre-Production Readiness Report

Date: 2026-05-25

This report tracks the final readiness campaign before switching the stable `spoonjoy.app` production surface to Spoonjoy v2.

## Current Position

Spoonjoy v2 has passed final local verification, final MCP verification, authenticated local/live UI crawls, and a fresh staging Worker deploy:

`https://spoonjoy-v2.mendelow-studio.workers.dev`

Deployed Worker version: `823c2650-096a-43d6-b8bb-6cf77882cf5e`

The app is ready for Ari's legacy data migration instructions before the stable `spoonjoy.app` cutover. The only unresolved production-posture items are external inputs, not branch work:

- Ari-provided legacy data migration plan/data.
- Apple OAuth credentials, if Apple login should be enabled at cutover.
- OpenAI API key, if AI import fallback, placeholder cover generation, and spoon-cover stylization should be enabled at cutover.

## Initial Findings

- Remote D1 migrations report no pending migrations.
- Remote `User` table includes `photoUrl`; the earlier missing-column concern is not present on the current remote database.
- Remote Worker has `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`.
- Remote Worker does not currently list Apple OAuth or OpenAI secrets.
- Keychain checks did not find `OPENAI_API_KEY` or `APPLE_PRIVATE_KEY`.
- UI static inventory reports no legacy Tailwind color classes, no copied Catalyst button shells, and no negative tracking classes.
- Remaining UI inventory flags are review-only cases: circular controls/avatars/dock affordances, token hex values, and raw button controls used for accessible row/toggle interactions.

## Final Verification

- `pnpm typecheck` passed.
- `pnpm test:coverage` passed: 213 files, 4,639 tests, 100% statement/branch/function/line coverage.
- `pnpm build` passed.
- `pnpm test:e2e` passed: 34 Playwright tests.
- `pnpm production:readiness` passed hard gates; it warns only for missing Apple OAuth and OpenAI feature secrets.
- `pnpm deploy:auto` passed preflight, build, remote migration apply, and Worker deploy.
- Authenticated local UI crawl: 54 route/viewport captures, 0 skips, 0 console/page errors, 0 overflow, 0 clipped text, 0 small touch-target findings.
- Authenticated live UI crawl: 54 route/viewport captures, 0 skips, 0 console/page errors, 0 overflow, 0 clipped text, 0 small touch-target findings.
- Live smoke passed for public home, login, signup, search, fellow chefs, kitchen visitors, authenticated login, recipes, cook mode, shopping list, account notifications, and push public key endpoint.
- Slugger/Ouro MCP smoke passed after schema refresh: first-class tools can health-check, search, create, update, delete, add to cookbook, add to shopping list, read shopping list, and remove cleanup artifacts.

## Execution Contract

The canonical backlog is `docs/pre-production-readiness-backlog.md`.

No backlog item should remain `open` before this campaign is considered complete. Acceptable terminal states are:

- `fixed`
- `deferred` with rationale
- `superseded`
- `in-progress` only when it is an explicit external dependency, such as Ari-provided data migration instructions or missing production credentials
