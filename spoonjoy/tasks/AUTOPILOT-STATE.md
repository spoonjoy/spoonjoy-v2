# Autopilot State

Updated: 2026-06-11 11:19 America/Los_Angeles
Branch: `main`
Objective: Continue the Spoonjoy next-work queue after completing the dedicated QA/test environment, verifying production deployment, cleaning disposable data, and resolving the final CI flake.

## Current Gate

- Completed doing doc: `spoonjoy/tasks/2026-06-11-0923-doing-qa-environment.md`
- Merged PRs: #179 dedicated QA environment, #180 post-merge verification artifacts, #181 fellow-chefs deterministic test-user flake fix.
- Final verified main SHA: `c6a6c58d258407e548c963539e20f28ff9d1c0de`.
- Final gates for `c6a6c58d`: Production Deploy passed, Storybook passed, CI passed (`e2e`, `coverage`, `typecheck`, `build`), production health passed on both `spoonjoy-v2.mendelow-studio.workers.dev` and `spoonjoy.app`.
- Cleanup state: QA and production `codex-smoke-%` users are both `0`; local `pnpm cleanup:qa` dry run shows `0` active suspicious recipes, disposable users, disposable spoons, and e2e oauth clients.

## Next Action

Next queued work from `spoonjoy/tasks/2026-06-10-1521-planning-next-work-queue.md`:

1. `SJ-045` - MCP/API image and cover e2e smokes against QA.
2. `SJ-046` - Image provider canary and visual benchmark workbench.
3. `SJ-047` - Resolve `feat/profile-photo-crop` by replaying or deleting its unique commit.

Current branch inventory:

- No open GitHub PRs.
- Local `feat/profile-photo-crop` is not mergeable as a branch: it is 48 commits behind `main` and would revert/delete large mainline work if merged. Its unique commit `3400c19a` remains valuable source material for square profile photo cropping and should be replayed onto fresh `main` or explicitly discarded with a durable note.

## Known External State

- Wrangler is logged in as `ari@mendelow.me` for Cloudflare account `Mendelow Studio`.
- QA D1 exists: `spoonjoy-qa` / `c6c99e80-bd51-4cf2-b7c7-b7a6e27d3f34`.
- QA R2 exists: `spoonjoy-photos-qa`.
- QA Worker URL: `https://spoonjoy-v2-qa.mendelow-studio.workers.dev`.
- Production Worker URL: `https://spoonjoy-v2.mendelow-studio.workers.dev`.
- Production custom domain: `https://spoonjoy.app`.
