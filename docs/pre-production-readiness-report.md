# Spoonjoy v2 Pre-Production Readiness Report

Date: 2026-05-25

This report tracks the final readiness campaign before switching the stable `spoonjoy.app` production surface to Spoonjoy v2.

## Current Position

Spoonjoy v2 has passed final local verification, final MCP verification, authenticated local/live UI crawls, and a fresh staging Worker deploy:

`https://spoonjoy-v2.mendelow-studio.workers.dev`

Deployed Worker version: `c173285b-a3be-4d7a-b69e-c4e465d150a7`

The app is ready for the final write-freeze/data-migration/DNS cutover decision before switching the stable `spoonjoy.app` surface. The only unresolved production-posture items are timing/ops choices, not branch work:

- Final v1 write freeze and rerun of the verified Neon-to-D1 import if v1 has accepted writes since the last snapshot.
- DNS/custom-domain switch for `spoonjoy.app`.
- Provider callback-domain confirmation for GitHub and Apple on the stable domain.
- Render shutdown after the stable-domain smoke passes.

## Initial Findings

- Remote D1 migrations report no pending migrations.
- Remote `User` table includes `photoUrl`; the earlier missing-column concern is not present on the current remote database.
- Remote Worker has `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, GitHub OAuth, Apple OAuth, and `OPENAI_API_KEY`.
- Google OAuth is intentionally disabled for cutover: Render v1 marks it `not yet enabled`, the migrated v1 OAuth rows are Apple/GitHub only, and direct Google start now fails closed with `oauth_unconfigured`.
- UI static inventory reports no legacy Tailwind color classes, no copied Catalyst button shells, and no negative tracking classes.
- Remaining UI inventory flags are review-only cases: circular controls/avatars/dock affordances, token hex values, and raw button controls used for accessible row/toggle interactions.

## Final Verification

- `pnpm typecheck` passed.
- `pnpm test:coverage` passed: 218 files, 4,699 tests, 100% statement/branch/function/line coverage.
- `pnpm build` passed.
- `pnpm test:e2e` passed: 34 Playwright tests.
- `pnpm production:readiness` passed all gates: required secrets, configured GitHub/Apple/OpenAI, intentionally disabled Google, PWA assets, runbook coverage, and remote `User.photoUrl`.
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
