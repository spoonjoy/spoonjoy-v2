# Spoonjoy v2 Pre-Production Readiness Report

Date: 2026-05-25

This report tracks the final readiness campaign before switching the stable `spoonjoy.app` production surface to Spoonjoy v2.

## Current Position

Spoonjoy v2 has already passed broad application verification on the staging Worker and is deployed at:

`https://spoonjoy-v2.mendelow-studio.workers.dev`

The app is not yet ready for the stable production-domain swap because the final cutover checklist, final branch verification, provider-secret posture, and legacy data migration dependency still need to be closed out.

## Initial Findings

- Remote D1 migrations currently report no pending migrations.
- Remote `User` table includes `photoUrl`; the earlier missing-column concern is not present on the current remote database.
- Remote Worker currently has `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
- Remote Worker does not currently list Google OAuth, Apple OAuth, or OpenAI secrets.
- Local `.env` contains Google OAuth credentials but no Apple or OpenAI credentials.
- Keychain checks did not find `OPENAI_API_KEY` or `APPLE_PRIVATE_KEY`.
- UI static inventory reports no legacy Tailwind color classes, no copied Catalyst button shells, and no negative tracking classes.
- Remaining UI inventory flags are review-only cases: circular controls/avatars/dock affordances, token hex values, and raw button controls used for accessible row/toggle interactions.

## Execution Contract

The canonical backlog is `docs/pre-production-readiness-backlog.md`.

No backlog item should remain `open` before this campaign is considered complete. Acceptable terminal states are:

- `fixed`
- `deferred` with rationale
- `superseded`
- `in-progress` only when it is an explicit external dependency, such as Ari-provided data migration instructions or missing production credentials

