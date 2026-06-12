# Autopilot State

Updated: 2026-06-11 20:10 America/Los_Angeles
Branch: `spoonjoy/backlog-queue-state`
Objective: Keep the Spoonjoy autonomous queue durable and continue with the next ready work after the completed QA/image-cover smoke run.

## Current Gate

- Last completed planning doc: `spoonjoy/tasks/2026-06-11-1221-planning-mcp-image-cover-smokes.md`
- Last completed doing doc: `spoonjoy/tasks/2026-06-11-1221-doing-mcp-image-cover-smokes.md`
- Current bookkeeping branch: `spoonjoy/backlog-queue-state`
- Current bookkeeping goal: update `BACKLOG.md`, `spoonjoy/tasks/2026-06-10-1521-planning-next-work-queue.md`, and this state file so `SJ-043`, `SJ-045`, and `SJ-047` are not selected again as active next work.
- No human gates remain under the user's explicit no-human-gates mandate unless a true human-only credential/capability blocker or genuinely unrecoverable destructive shared-state action appears.

## Next Action

1. Merge the backlog/state bookkeeping branch and verify main/deploy as required by the repo.
2. Start `SJ-044`: environment-aware smoke, cleanup, and preflight harness. The next thin slice should focus on a broader QA cleanup harness for disposable users, recipes, spoons, OAuth clients/API credentials, generated covers, and related R2 objects, while keeping production cleanup read-first and narrow.

## Known External State

- Wrangler is logged in as `ari@mendelow.me` for Cloudflare account `Mendelow Studio`.
- QA D1 exists: `spoonjoy-qa` / `c6c99e80-bd51-4cf2-b7c7-b7a6e27d3f34`.
- QA R2 exists: `spoonjoy-photos-qa`.
- QA Worker URL: `https://spoonjoy-v2-qa.mendelow-studio.workers.dev`.
- QA image-cover smoke passed on version `11bb68e0-494e-4fd7-be4b-b780a0782edb` with Gemini/Google provider coverage and exact R2/D1 cleanup verified.
- Implementation review converged at branch head `6b877cf0` after workflow and cleanup hardening fixes.
- PR #184 merged as `85da85da1417e29c34f91e81ab8ace0f575bd111`; post-merge CI, Storybook, Production Deploy, and both production health endpoints passed.
- Follow-up evidence PR #185 merged as `8fd4968b4654afb640d4637443bea2a98f500fbc`; CI, Storybook, Production Deploy, and both production health endpoints passed for that commit.
- A stale remote branch `origin/spoonjoy/unit-6c-final-cleanup` remains from merged PR #186 because the PR was squash-merged; delete the remote branch after recording this state, unless GitHub branch protection or permissions block deletion.
- Final cleanup for `SJ-045` otherwise showed only local `main`, no open PRs, and no active local task branch.
- Final local QA cleanup shows zero active suspicious recipes, disposable users, disposable spoons, and e2e OAuth clients.
- Final remote QA and production D1 checks show zero Codex smoke users and no Codex/e2e recipe rows.
- Slugger was notified successfully.
- Production Worker URL: `https://spoonjoy-v2.mendelow-studio.workers.dev`.
- Production custom domain: `https://spoonjoy.app`.
