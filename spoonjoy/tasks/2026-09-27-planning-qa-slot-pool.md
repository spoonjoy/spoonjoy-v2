# Planning: run Journeys in parallel across three QA slots

Status: parked on 2026-09-27 before implementation. No code has changed yet, no workflow was dispatched, and no Cloudflare resource was created. This file records the design and the evidence gathered so the next session can start building straight away.

## Goal

Journeys runs stop queuing one at a time. A pool of three isolated QA slots lets up to three runs execute in parallel, and each run splits its Playwright suite across two shards.

## Slots

| Slot | Worker | D1 database | R2 bucket | Rate-limit namespace ids |
| --- | --- | --- | --- | --- |
| `qa` (exists) | `spoonjoy-v2-qa` | `spoonjoy-qa` (`c6c99e80-bd51-4cf2-b7c7-b7a6e27d3f34`) | `spoonjoy-photos-qa` | 2001, 2002, 2003 |
| `qa2` (to create) | `spoonjoy-v2-qa2` | `spoonjoy-qa2` (id from provisioning) | `spoonjoy-photos-qa2` | 2201, 2202, 2203 |
| `qa3` (to create) | `spoonjoy-v2-qa3` | `spoonjoy-qa3` (id from provisioning) | `spoonjoy-photos-qa3` | 2301, 2302, 2303 |

Each slot is a wrangler env in `wrangler.json` with the same Durable Object binding and migration, version metadata, rate limits (same limits) and vars as `env.qa`, except `SPOONJOY_BASE_URL` (`https://spoonjoy-v2-<slot>.mendelow-studio.workers.dev`). Separate rate-limit namespaces keep two slots' runs from sharing the 60-per-minute sign-in budget; namespaces are account-wide, so sharing ids would couple the slots.

The base URL follows one formula for all three slots, including `qa`.

## Slot-aware scripts

Put one slot table (`QA_SLOTS`, `isQaSlot`) in `scripts/script-environment.mjs` and derive everything from it. `TARGET_ENVS` becomes `local, qa, qa2, qa3, production`; `resolveScriptTarget` checks each slot's own origin and returns its `--env <slot>` D1 args and R2 bucket. Every script that accepts only `qa` today must accept exactly the three slots and still refuse production and anything else, with tests for both:

- `scripts/seed-qa-kitchen.mjs`: `parseSeedKitchenArgs` accepts a slot; the wrangler call uses `--env <slot>`.
- `scripts/cleanup-local-qa-data.mjs`: `defaultBaseUrlForTarget`, the QA branches (lines ~1156, 1197, 1200, 1271) and the R2 get/delete args (lines 108 and 112 use the `QA_R2_BUCKET` constant) become slot-aware.
- `scripts/qa-preflight.ts`: read the slot from `SPOONJOY_QA_SLOT` (default `qa`, refuse others); migration, secret and R2 args use the slot; `validateQaGeneratedBuildConfig` checks the slot's Worker name, base URL, D1 id, bucket, namespace ids and `clientMetadata.environment === <slot>` (the build writes `CLOUDFLARE_ENV` into that field through `scripts/posthog-build-metadata.ts`).
- New `scripts/deploy-qa-slot.mjs --target-env <slot>`: runs the same five steps as `deploy:qa` (skip-remote preflight, `CLOUDFLARE_ENV=<slot>` build, remote migrations, build-config preflight, `wrangler deploy --env <slot>`). Keep `deploy:qa` unchanged, because `scripts/deployment-preflight.ts` pins its exact text; a unit test asserts the `qa` step list matches it.
- Optional: `seed-qa.mjs`, `smoke-live-helpers.mjs` and `backfill-oauth-grants.mjs` also branch on `"qa"`; they are not used by Journeys.

Do not pass an unvalidated slot straight to wrangler. With an `--env` name that is missing from `wrangler.json`, wrangler falls back to the top-level config, so `d1 migrations apply DB --remote --env <bad>` would target the production database. Every entry point validates the slot first.

`scripts/deployment-preflight.ts` does not read `env.*` beyond `env.qa`, so extra slot envs do not affect it. Add a unit test that the `wrangler.json` slot envs match `QA_SLOTS` and mirror `env.qa`.

## Provisioning

Workflow dispatch only works for a workflow file that already exists on `main`, so a new provisioning workflow cannot be dispatched from this branch before merge. Instead, add a `provision-qa-slots` choice to the existing `suite` input of `journeys.yml` and a `provision-qa-slots` job gated on that choice. Skip the allocation, shard and aggregate jobs on that choice, so a provisioning run never reports a `journeys` check.

`scripts/provision-qa-slots.mjs` (idempotent) does the following:

1. Runs `wrangler d1 list --json` and runs `wrangler d1 create spoonjoy-<slot>` for each missing database. Wrangler returns error 7502 if the name already exists.
2. Runs `wrangler r2 bucket list` and creates each missing bucket.
3. Compares each database id with `wrangler.json` and patches the runner's copy when they differ. Remote `d1 migrations apply` needs `database_id` in the config (wrangler's `getDatabaseInfoFromConfig`). The script prints the ids so they can be committed.
4. Applies D1 migrations to each slot.
5. Runs `wrangler secret list --env <slot>` and puts each missing required secret (`SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; see `REQUIRED_QA_SECRETS`). Values are generated on the runner and piped to wrangler on stdin, never printed: a random `SESSION_SECRET` and a fresh P-256 VAPID key pair. In CI, `wrangler secret put` on a Worker that does not exist yet creates a draft Worker; wrangler 4.90's `createDraftWorker` falls back to "yes" when it cannot prompt. The first slot deploy then applies the Durable Object migration and keeps the secrets.
6. Logs the secret names that `qa` has and a slot lacks (names only, for example OAuth or image-provider keys). No journey depends on them today.

If the token lacks D1, R2 or Workers-script create permission, stop and report the exact missing permission.

## Allocation

Replace `scripts/wait-for-qa-turn.mjs` with a slot allocator, `scripts/journeys-slots.mjs`, that has three modes: `allocate`, `verify` and `wait-for-shards`. The GitHub API is injected as `fetch` for tests.

- Holder: an active (queued or in-progress) Journeys run of this repository that has a job named `QA slot <slot>`. The job right after allocation carries that name (`name: QA slot ${{ needs.allocate.outputs.slot }}`), because job outputs are not visible in the REST API and a job cannot rename itself.
- Claim in flight: a run whose `wait for a QA slot` job succeeded but whose `QA slot` job is not listed yet. It holds an unknown slot, so the allocator waits one poll.
- Waiter: an active run whose allocation job has not finished, or that has no jobs yet.
- Rule: order runs as today (current attempt start, then run id). If k waiters are ahead of this run and F is the list of free slots in fixed order `qa, qa2, qa3`, this run takes `F[k]` when k < |F|; otherwise it waits. Runs that become eligible together therefore pick different slots. After 90 minutes it fails closed, as today.
- Legacy runs: while any run that still uses the old single-tenant queue is active (a job named `wait for QA`), treat `qa` as taken. This only matters during the switchover, because `pull_request` runs use the merged workflow.
- `verify` runs first in the prepare, shard and finalize jobs. It fails if an active run earlier in queue order claims the same slot. This covers API lag, and it also covers "re-run failed jobs", which would otherwise reuse a slot without allocating it again (the re-run gets a later start time, so it loses).

## Job graph (`journeys.yml`)

1. `fork-notice`: unchanged.
2. `allocate`, named `wait for a QA slot`: fork-gated, `actions: read`, 105-minute timeout. Outputs the slot and base URL.
3. `prepare`, named `QA slot <slot>`: verifies the slot, deploys with `deploy-qa-slot.mjs`, seeds with `--target-env <slot> --credentials-out`, masks the passwords, then seals the credentials file and uploads it as a ciphertext artifact.
4. `tail`, named `QA Worker tail`: runs `wrangler tail spoonjoy-v2-<slot>`, waits through `wait-for-shards` until every `journeys shard *` job of this run is complete, summarises with the existing jq allowlist, deletes the raw stream and uploads the summary. It is non-fatal. Residual gap: requests made before the tail connects are missed, because the tail job and the shards start together.
5. `shards`, a matrix named `journeys shard <n>`: runs `--shard=<n>/2` with the blob reporter for the journeys suite, and one shard with the existing reporters for explore (its custom summary reporter is not safe to merge). It verifies the slot, opens the credentials, masks them, runs the suite, deletes credentials and storage state, and seals its `blob-report/` and `test-results/` into a ciphertext artifact.
6. `finalize`: runs when `always() && needs.allocate.result == 'success'`. It verifies the slot, rotates passwords (`--rotate --target-env <slot>`), cleans up (`--target-env <slot> --apply`), then opens the shard results and tail summary, runs `playwright merge-reports --config playwright.journeys.config.ts` into `journeys-report/`, strips the traces and makes the same gated upload as today.
7. `journeys`: the required check, `!cancelled()` and fork-gated. It fails unless allocate, prepare, shards and finalize all succeeded, and it never skips on a pull request.

Why the handoff must be sealed: shard reports and traces hold live persona passwords and cookies until `finalize` rotates them, so they cannot be uploaded in the clear before rotation. Separate runners also need the seeded credentials, and job outputs drop masked values. The plan is `scripts/journeys-handoff.mjs seal|open` over stdin and stdout (tar in the workflow), using AES-256-GCM with a key derived by HKDF-SHA256 from `CLOUDFLARE_API_TOKEN`, with salt set to the repository, run id and attempt. A dedicated repository secret would be cleaner but needs the operator. Upload the handoff artifacts with `overwrite: true` and short retention.

Keep: per-PR concurrency that never cancels a run in progress, no runs for fork PRs, and rotate, cleanup and strip before any public upload.

## Sharding evidence

- Playwright 1.58.1 applies `--shard` only to top-level projects and then prepends dependency projects in full (`playwright/lib/runner/loadUtils.js`, around lines 159–181). The `personas` setup project therefore runs once in every shard.
- Concurrent sign-ins of the same persona are already normal: the suite runs 2 workers, and `sign-in.journey.ts` signs personas in while other tests use stored sessions. Sign-in does not revoke other sessions. Only "sign out everywhere" does, and that runs as scratch user 6 in one shard. The other shard's scratch-6 session is never used.
- Sign-in budget per run with 2 shards: 9 setup sign-ins × 2 + 12 journey sign-ins = 30. That is under 60 per minute even if both shards share one IP, and separate namespaces keep other slots out of it.
- Per-device scratch twins already allow a file's iPhone and desktop copies to run at the same time, so 2 shards × 2 workers adds concurrency of the same kind the suite already handles.
- Reporter: `playwright.journeys.config.ts` selects `[["list"], ["blob"]]` when `SPOONJOY_JOURNEYS_REPORTER=blob` (default file `report-<shard>.zip`). Otherwise it keeps list and html, and `merge-reports --config` reuses that html setting.
- Call Playwright directly with `--shard`, not through `pnpm run ... --`, so a passed-through `--` cannot turn the flag into a file filter.

## Policy tests to update

- `test/scripts/wait-for-qa-turn.test.ts` is replaced by tests for `journeys-slots.mjs`: allocation ranks, claims in flight, legacy runs, verify, wait-for-shards, pagination, API failures and the timeout. Update `vitest.config.ts` `coverageInclude` to match.
- `test/scripts/summarize-worker-tail.test.ts` "tail wiring" moves from `jobs.journeys` to the tail and finalize jobs.
- Workflow wiring tests: the required `journeys` check fails and never skips; nothing touches a slot before verify; uploads stay behind the rotate, cleanup and strip outcomes; handoff artifacts are ciphertext only; the provisioning choice skips the `journeys` job.
- Script tests: each slot is accepted, and production, `qa4`, an empty value and a missing value are refused (seed, cleanup, preflight, deploy-qa-slot, script-environment).
- AGENTS.md Validation: a few sentences on slots, allocation and sharding.

## Coordination

The `claude/dock-journey` branch adds `suite=update-snapshots` to `journeys.yml`. Merge it with the new `provision-qa-slots` choice and route snapshot updates through the shard job.

## Remaining risks

- The Cloudflare token's permission to create D1 databases, R2 buckets and Workers scripts is untested.
- The allocator can see slightly stale API data. `verify` turns a double claim into a failed later run instead of two runs sharing a slot.
- Keying the handoff to the Cloudflare token couples two secrets. A dedicated secret would remove that coupling.
- The tail can miss a few early requests.
- The job graph adds about two installs per run: roughly one more minute of runner time, traded for three runs in parallel.
