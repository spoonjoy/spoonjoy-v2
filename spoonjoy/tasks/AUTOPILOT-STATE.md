# Autopilot State

Updated: 2026-06-11 11:58 America/Los_Angeles
Branch: `spoonjoy/profile-photo-crop-replay`
Objective: Continue the Spoonjoy next-work queue after completing the dedicated QA/test environment, verifying production deployment, cleaning disposable data, resolving the final CI flake, and retiring the stale profile-photo-crop branch.

## Current Gate

- Completed doing doc: `spoonjoy/tasks/2026-06-11-0923-doing-qa-environment.md`
- Merged PRs: #179 dedicated QA environment, #180 post-merge verification artifacts, #181 fellow-chefs deterministic test-user flake fix, #182 final QA verification state.
- Final verified main SHA: `1ac13795459267d06a69149452155aeea8c60aba`.
- Final gates for `1ac13795`: Production Deploy passed, Storybook passed, CI passed (`e2e`, `coverage`, `typecheck`, `build`), production health passed on both `spoonjoy-v2.mendelow-studio.workers.dev` and `spoonjoy.app`.
- Cleanup state: QA and production `codex-smoke-%` users are both `0`; local `pnpm cleanup:qa` dry run shows `0` active suspicious recipes, disposable users, disposable spoons, and e2e oauth clients.

## Next Action

Next queued work from `spoonjoy/tasks/2026-06-10-1521-planning-next-work-queue.md`:

1. `SJ-045` - MCP/API image and cover e2e smokes against QA.
2. `SJ-046` - Image provider canary and visual benchmark workbench.
3. `SJ-036` - Finish PostHog server-side error tracking and alert verification.

Current branch inventory:

- No open GitHub PRs before this documentation branch.
- `SJ-047` resolution: focused profile-photo proof passed on current `main` with `pnpm exec vitest run test/components/account/ProfilePhotoField.test.tsx test/components/account/ProfilePhotoCropper.test.tsx test/lib/image-crop.test.ts test/routes/account-settings.test.tsx test/storybook-sync.test.ts` (197 tests). The current main implementation already includes square crop behavior, so stale local branch `feat/profile-photo-crop` was deleted locally rather than merged.

## Known External State

- Wrangler is logged in as `ari@mendelow.me` for Cloudflare account `Mendelow Studio`.
- QA D1 exists: `spoonjoy-qa` / `c6c99e80-bd51-4cf2-b7c7-b7a6e27d3f34`.
- QA R2 exists: `spoonjoy-photos-qa`.
- QA Worker URL: `https://spoonjoy-v2-qa.mendelow-studio.workers.dev`.
- Production Worker URL: `https://spoonjoy-v2.mendelow-studio.workers.dev`.
- Production custom domain: `https://spoonjoy.app`.
