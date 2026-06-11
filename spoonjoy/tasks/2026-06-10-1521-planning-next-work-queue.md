# Next Work Queue

Status: `READY_FOR_PLANNING`
Created: 2026-06-10 15:21 America/Los_Angeles
Branch: `spoonjoy/next-work-queue`
Canonical backlog IDs: `SJ-043` through `SJ-049`, plus existing `SJ-036`, `SJ-037`, `SJ-040`, `SJ-038`, `SJ-035`

## Spark

Ari wants Spoonjoy to have a queued set of obvious next moves so future agents do not keep returning with "what's next?" The first item is a real QA/test environment where verification can create disposable data without cleanup anxiety.

## Observed Terrain

- `BACKLOG.md` is the canonical backlog, but its old next sequence predates the recent image provider, cover lifecycle, deploy-autopilot, Storybook, and MCP resilience work.
- `wrangler.json` currently has one production-shaped Worker, D1 binding, R2 bucket, and rate-limit namespace set.
- `pnpm cleanup:qa` is deliberately local-only.
- `pnpm smoke:live` creates disposable data and cleans its smoke account, but environment targeting and broad remote cleanup safety need to be explicit.
- Recent production verification relied on a manual sequence: PR checks, merge, main CI, Production Deploy, Storybook deploy, readiness, health, smoke, remote data counters, local cleanup.
- A Tinfoil Hat critique flagged that "QA environment" is fake unless it includes separate Cloudflare state, separate cleanup contracts, environment-aware preflight, and R2/database teardown.

## Queue Order

1. `SJ-043` - Dedicated QA/test environment. **Done 2026-06-11.**
   - Separate Worker/base URL, D1, R2, rate-limit namespaces, vars/secrets, preflight, seed, and origin-sensitive auth docs.
   - Done means live/manual/e2e verification can target QA without touching production user data.

2. `SJ-044` - Environment-aware smoke, cleanup, and preflight harness. **Partially advanced by `SJ-043`; broader QA cleanup harness still open.**
   - Shared resolver for `local`, `qa`, `production`.
   - Refuse ambiguous destructive remote cleanup.
   - Include database and R2 teardown for QA disposable data.

3. `SJ-045` - MCP/API image and cover e2e smokes.
   - Exercise the real image/cover MCP tools against QA.
   - Upload recipe images and spoon photos, create/list/swap/archive covers, browse spoon images, prove EXIF and GIF behavior.

4. `SJ-046` - Image provider canary and visual benchmark workbench.
   - Detect all-provider image failures before users do.
   - Benchmark Gemini/OpenAI and optional BFL/fal/Stability candidates with a controlled scorecard.

5. `SJ-047` - Resolve `feat/profile-photo-crop`. **Done 2026-06-11.**
   - Current `main` already contains the square profile-photo crop implementation with newer shared image allow-list handling, cropper UI, Storybook coverage, and account-settings route tests.
   - Focused proof passed with profile field, cropper, crop math, account-settings route, and Storybook-sync tests; the stale local branch was retired instead of merged.

6. `SJ-036` - Finish PostHog server-side error tracking.
   - Image-generation alerting exists; broader Worker/server error capture and verification still needs completion.

7. `SJ-037` - Rate-limit API/MCP bearer surfaces.
   - Should follow `SJ-036` so rate-limit hits are observable.

8. `SJ-048` - Autopilot release verifier.
   - Encode the post-merge verification loop so agents cannot leave PRs stale, main undeployed, or production unsmoked.

9. `SJ-049` - Cover provenance, cover library, and spoon image browsing polish.
   - Web + MCP/AX polish for provenance badges, verbatim vs editorialized vs purely AI covers, cover history, and spoon-image browsing.

10. `SJ-040` - Finish real claude.ai one-click connector verification.

11. `SJ-038` - PWA install prompt and offline fallback polish.

12. `SJ-035` - Resolve the fellow-chefs performance TODO.

## Scrutiny Notes

Tinfoil Hat findings that changed this queue:

- A QA environment is not meaningful unless Cloudflare state is genuinely separate: Worker, D1, R2, rate limits, secrets, and base URL.
- Cleanup has to include R2/generated image objects, not just database rows.
- Production deploy checks cannot be reused blindly for QA; QA needs its own preflight.
- Image provider canaries must be quota-aware and isolated from user-facing recipe feeds.
- Scripts should print the resolved environment and refuse ambiguous destructive cleanup.

Local Stranger With Candy pass:

- "Test environment" is the wrong shape if it only means a seed namespace in production D1.
- "Smoke cleanup" is unsafe if it becomes broad remote deletion instead of environment-scoped disposal.
- "Provider benchmark" should not become a default CI job; keep it optional or scheduled.
- "Autopilot verifier" should verify deploy and smoke state, not deploy by itself unless explicitly run as release automation.

## Thin Slice

`SJ-043` and `SJ-047` are complete. Next execution should start with `SJ-045`:

- use QA rather than production for live MCP/API image-cover smokes;
- include EXIF and unsupported GIF assertions;
- clean all created QA records and R2 keys in the same run;
- merge and verify production deploy because this repo auto-deploys all main changes.

## Non-Goals

- No custom email notification system.
- No broad production cleanup command.
- No expensive image benchmark in every CI run.
- No new image provider default until canary/benchmark evidence exists.

## Planner Handoff

Goal: Continue through the queue without asking "what's next" unless a task hits genuine human-judgment territory.

Likely files:

- `wrangler.json`
- `package.json`
- `.github/workflows/*.yml`
- `scripts/deployment-preflight.ts`
- `scripts/production-readiness.ts`
- `scripts/smoke-live.mjs`
- `scripts/cleanup-local-qa-data.mjs` or a new environment-aware cleanup script
- `docs/deployment.md`
- `README.md`
- `BACKLOG.md`

Acceptance signals:

- QA Cloudflare resources are separate from production.
- QA preflight passes and refuses production ambiguity.
- QA smoke creates and cleans disposable data.
- Production deploy and smoke remain green after the change.
- Durable docs point future agents to the queue and exact next action.
