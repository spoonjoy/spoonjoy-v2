# Autopilot State

Updated: 2026-06-11 09:45 America/Los_Angeles
Branch: `spoonjoy/qa-environment`
Objective: Execute `SJ-043` dedicated QA/test environment, merge it, verify auto-deploy, smoke production, clean test data, and continue to the next obvious queued work.

## Current Gate

- Planning doc: `spoonjoy/tasks/2026-06-11-0923-planning-qa-environment.md`
- Planning status: `APPROVED`
- Reviewer gate: converged after QA seed, R2 round-trip, and smoke-cleanup criteria were added.
- Doing doc: `spoonjoy/tasks/2026-06-11-0923-doing-qa-environment.md`
- Doing status: `drafting`

## Next Action

Run doing-doc review gates, mark the doing doc `READY_FOR_EXECUTION` once converged, then execute Unit 0 and continue sequentially through implementation, QA deploy/smoke, merge, production deploy verification, production smoke, cleanup, Slugger notification, and branch/PR cleanup.

## Known External State

- Wrangler is logged in as `ari@mendelow.me` for Cloudflare account `Mendelow Studio`.
- QA D1 exists: `spoonjoy-qa` / `c6c99e80-bd51-4cf2-b7c7-b7a6e27d3f34`.
- QA R2 exists: `spoonjoy-photos-qa`.
- Cloudflare D1 `list` endpoint returned auth code `10000`, but direct `d1 info spoonjoy` and `d1 create spoonjoy-qa` worked.
