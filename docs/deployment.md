# Cloudflare Deployment Checklist

Spoonjoy v2 deploys to Cloudflare Workers with D1 for data and R2 for uploaded profile/recipe photos. This checklist is intentionally explicit so agents can verify deploy readiness without relying on tribal memory.

## Required Bindings

`wrangler.json` must define these bindings:

| Binding | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 database | Prisma-backed application data |
| `COOK_SESSIONS` | Durable Object namespace | SQLite-backed cook-session lifecycle; bootstrap releases expose only the bounded verification probe |
| `PHOTOS` | R2 bucket | Profile and recipe image uploads served through `/photos/*` |

The top-level and QA `migrations` arrays must retain the `v1_cook_session` tag with `new_sqlite_classes: ["CookSession"]`. The bootstrap release enables its public probe only long enough to verify the new namespace; the immediately following product-activation release removes that public route while preserving the binding and migration. Bootstrap requests require an empty body, a Cloudflare client IP, and the configured auth IP rate limiter.

Create first-time production resources with the commands below. R2 must first be enabled in Cloudflare Dashboard > R2 Object Storage; if it is not enabled, Wrangler returns `10042: Please enable R2 through the Cloudflare Dashboard`.

```bash
wrangler d1 create spoonjoy
wrangler r2 bucket create spoonjoy-photos
wrangler r2 bucket list
```

After creating D1, copy the returned `database_id` into `wrangler.json` under the `DB` binding. Verify both D1 and R2 resources live in the same Cloudflare account used by `CLOUDFLARE_ACCOUNT_ID`/Wrangler deploy credentials.

## Dedicated QA Environment

Spoonjoy has a separate QA Worker and separate Cloudflare state for live/manual/e2e verification. Use QA for disposable smoke data, image upload checks, and agent-driven flows before trying anything risky in production.

QA resources:

- Worker URL: `https://spoonjoy-v2-qa.mendelow-studio.workers.dev`
- D1 database: `spoonjoy-qa`
- R2 bucket: `spoonjoy-photos-qa`
- Rate-limit namespaces: `2001`, `2002`, `2003`
- Disposable seed namespace: `codex-qa-seed-`
- Disposable smoke users: `codex-smoke-...@example.com`

First-time QA resource creation:

```bash
wrangler d1 create spoonjoy-qa
wrangler r2 bucket create spoonjoy-photos-qa
```

Set or verify QA runtime secrets separately from production:

```bash
wrangler secret list --env qa
wrangler secret put SESSION_SECRET --env qa
wrangler secret put VAPID_PUBLIC_KEY --env qa
wrangler secret put VAPID_PRIVATE_KEY --env qa
wrangler secret put VAPID_SUBJECT --env qa
```

Optional QA secrets and vars:

- Set `POSTHOG_DISABLED=true` in QA unless you are intentionally testing server telemetry and PostHog alerts.
- Use `IMAGE_PROVIDER_PRIMARY=gemini`, `IMAGE_PROVIDER_FALLBACKS=openai`, and `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image` when QA should exercise the same image-provider policy as production.
- Keep `SPOONJOY_CSP_MODE=enforce` in QA. QA is the proof environment for the blocking `Content-Security-Policy` header before the same exact source SHA is released to production.
- OAuth callback URLs must include the QA origin for Google/GitHub providers when those providers are enabled in QA. Apple OAuth callback verification remains production-only because the Apple Service ID is registered to the production return URL.
- WebAuthn uses the request origin as RP origin, so QA passkey testing must happen on `https://spoonjoy-v2-qa.mendelow-studio.workers.dev`.

QA verification flow:

```bash
pnpm run qa:preflight
pnpm run qa:migrate
pnpm run qa:seed
CLOUDFLARE_ENV=qa pnpm run build
SPOONJOY_QA_PREFLIGHT_EXPECT_BUILD_CONFIG=1 pnpm run qa:preflight
pnpm run deploy:qa
pnpm run smoke:qa
```

`pnpm run qa:seed` creates a per-run `codex-qa-seed-` user and tears it down by default. `pnpm run smoke:qa` passes `--target-env qa`, creates a `codex-smoke-` user, cleans it from QA D1 with `--env qa`, and verifies the user count returns to zero. Do not run broad production cleanup. Production smoke cleanup must stay narrow to the one disposable `codex-smoke-` account created by that smoke run.

## Cleanup Target Contract

Cleanup commands are dry-run unless their script name ends in `:apply`, and every command pins an explicit script target:

```bash
pnpm run cleanup:local
pnpm run cleanup:local:apply
pnpm run cleanup:remote:qa
pnpm run cleanup:remote:qa:apply
pnpm run cleanup:production
```

Target mapping:

| Command | Target | Mutation scope |
| --- | --- | --- |
| `pnpm run cleanup:local` | `--target-env local` | Read-only local D1 dry-run |
| `pnpm run cleanup:local:apply` | `--target-env local --apply` | Local disposable D1 rows only |
| `pnpm run cleanup:remote:qa` | `--target-env qa` | Read-only QA D1/R2 dry-run |
| `pnpm run cleanup:remote:qa:apply` | `--target-env qa --apply` | Exact validated disposable QA D1 rows and QA R2 objects, after blocker checks |
| `pnpm run cleanup:production` | `--target-env production` | Read-only broad production inspection |

The legacy `pnpm run cleanup:qa` script is a backwards-compatible local alias for `pnpm run cleanup:local`; it still passes `--target-env local`. Production broad cleanup is read-only and `--target-env production --apply` is refused. Production smoke cleanup must remain exact-run cleanup for the one `codex-smoke-` user created by that smoke run.

## Photo Storage

Spoonjoy v2 is hosted on Cloudflare Workers and stores recipe, spoon, and profile photos in the R2 bucket bound as `PHOTOS`. App-facing image URLs should be Spoonjoy `/photos/...` paths served by `app/routes/photos.$.tsx`.

New import, upload, and generated-cover flows must write directly to R2-backed `/photos/...` URLs. Do not add a recurring migration path for retired v1 image-host data; verify production image references with read-only D1 checks before any future cutover-style operation.

## Required Secrets

Set production secrets with `wrangler secret put`:

```bash
wrangler secret put SESSION_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put APPLE_CLIENT_ID
wrangler secret put APPLE_NATIVE_CLIENT_IDS
wrangler secret put APPLE_TEAM_ID
wrangler secret put APPLE_KEY_ID
wrangler secret put APPLE_PRIVATE_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put GOOGLE_API_KEY
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT
```

Notes:

- `SESSION_SECRET` protects auth sessions and must be high entropy in production.
- Google, GitHub, and Apple OAuth secrets are required for the corresponding OAuth login/account-linking provider. Native Sign in with Apple also needs `APPLE_NATIVE_CLIENT_IDS`, currently `app.spoonjoy,app.spoonjoy.mac,app.spoonjoy.Spoonjoy,app.spoonjoy.Spoonjoy.mac`, so the backend accepts iOS and macOS identity-token audiences after the Apple App IDs are registered. Keep the canonical bundle IDs first; the `.Spoonjoy` IDs are legacy internal-build aliases.
- `OPENAI_API_KEY` enables ingredient parsing and the OpenAI recipe-image provider. Missing local keys fall back to deterministic parsing paths where supported, but production should set the secret before enabling AI-assisted flows.
- `GOOGLE_API_KEY` or `GEMINI_API_KEY` enables Gemini recipe-image fallback. Prefer `GOOGLE_API_KEY` for production unless a provider-specific alias is needed.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` are required for `/api/push/public-key` and web-push subscription flows.
- `POSTHOG_KEY` is optional. When set, it enables server lifecycle telemetry for API v1, legacy API, MCP, OAuth, and Worker error capture. Leave it unset, or set `POSTHOG_DISABLED=true`, to keep server telemetry off.
- Client analytics is built into the Vite bundle only when `VITE_POSTHOG_KEY` is present during `pnpm run build`. Use `VITE_POSTHOG_HOST` for the ingestion host and `VITE_POSTHOG_DISABLED=true` for an explicit client kill switch. These `VITE_` values are public build-time configuration, not secrets.
- Optional ingredient parsing runtime knobs are `INGREDIENT_PARSE_PROVIDER`, `INGREDIENT_PARSE_MODEL`, `INGREDIENT_PARSE_TIMEOUT_MS`, and `INGREDIENT_PARSE_MAX_RETRIES`. The safe default is OpenAI with `gpt-4o-mini`, an 8000ms timeout, and 1 retry.
- Optional recipe-image provider runtime knobs are `IMAGE_PROVIDER_PRIMARY`, `IMAGE_PROVIDER_FALLBACKS`, `GEMINI_IMAGE_MODEL`, and `GEMINI_IMAGE_TIMEOUT_MS`. The safe default is configured providers in `openai,gemini` order with a 30000ms Gemini request timeout; set `IMAGE_PROVIDER_PRIMARY=gemini`, `IMAGE_PROVIDER_FALLBACKS=openai`, and `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image` to route image stylization through Gemini first.

### CSP Enforcement And Rollback

`SPOONJOY_CSP_MODE=enforce` emits the blocking `Content-Security-Policy` header. QA and production source config intentionally set that value so release owners can prove the exact SHA in QA first, then release the same SHA to production. The policy keeps required runtime sources for fonts, the configured HTTPS `VITE_POSTHOG_HOST` ingestion origin and matching PostHog assets origin, legacy/imported HTTPS images, `data:`/`blob:` images, and the `/csp-report` violation sink.

After deployment, verify public pages, authenticated Photo Studio, OAuth provider starts/callbacks, MCP, and API surfaces return `Content-Security-Policy`, `Reporting-Endpoints: csp-endpoint="/csp-report"`, and `X-Spoonjoy-Worker-Version` for the expected exact SHA. They should not return `Content-Security-Policy-Report-Only` during an enforcing release.

The one-commit rollback changes `SPOONJOY_CSP_MODE` from `enforce` to `report-only` in the affected `wrangler.json` environment. Ordinary push and pull-request CI intentionally remain fail-closed and do not receive break-glass state. An authorized operator must dispatch the CI workflow against the exact rollback branch head; GitHub records the actor, run ID, ref, SHA, and acknowledgement, and every CI job rejects a checkout that differs from that SHA. Dispatch jobs are named `report-only-coverage`, `report-only-workers-coverage`, `report-only-e2e`, and `report-only-advisory`, so they cannot satisfy canonical required checks:

```bash
ROLLBACK_REF=worker/report-only-csp
ROLLBACK_SHA="$(git rev-parse "$ROLLBACK_REF")"
gh workflow run ci.yml --ref "$ROLLBACK_REF" \
  -f source_sha="$ROLLBACK_SHA" \
  -f csp_report_only_break_glass=ACK_REPORT_ONLY_CSP_ROLLBACK
```

After the reviewed rollback commit reaches `main`, run the same exact-SHA authorization on `main`; this is the successful report-only CI run consumed by the production release validator:

```bash
ROLLBACK_SHA="$(git rev-parse origin/main)"
gh workflow run ci.yml --ref main \
  -f source_sha="$ROLLBACK_SHA" \
  -f csp_report_only_break_glass=ACK_REPORT_ONLY_CSP_ROLLBACK
```

Only after that run's `report-only-coverage`, `report-only-workers-coverage`, `report-only-e2e`, and `report-only-advisory` jobs and the exact-SHA Storybook run pass, dispatch the protected production workflow:

```bash
gh workflow run production-deploy.yml --ref main \
  -f source_sha="$ROLLBACK_SHA" \
  -f csp_report_only_break_glass=ACK_REPORT_ONLY_CSP_ROLLBACK
```

The production workflow independently checks the audited CI dispatch before release. Local preflight/deploy commands that inspect the same rollback commit must also run with `SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS=ACK_REPORT_ONLY_CSP_ROLLBACK`. This path restores `Content-Security-Policy-Report-Only` while preserving nonce behavior and violation telemetry. Remove the break-glass input/env and restore `SPOONJOY_CSP_MODE=enforce` in the follow-up commit.

### Optional PostHog Telemetry

To enable server lifecycle telemetry and error capture:

```bash
wrangler secret put POSTHOG_KEY
```

Configure image-generation email alerts in PostHog, not in Spoonjoy code. Recommended filters:

- `$exception` where `feature = recipe_image_generation`
- `$exception` where `feature = recipe_image_generation` and `provider`, `model`, `errorCode`, `requestId`, or `fallbackAttempted` match the provider failure you want to page on
- `spoonjoy.image_generation.provider_fallback` where `provider`, `model`, `errorCode`, `fallbackProvider`, or `fallbackModel` match recovered provider failures that should still alert
- `spoonjoy.image_generation.skipped` where `reason` is `missing_image_provider_config`, `missing_runner`, or `quota_exhausted`

To enable client analytics in the production bundle, provide these public build-time values to the deploy environment without committing the key:

```bash
VITE_POSTHOG_KEY=...
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_POSTHOG_DISABLED=
```

## Local `.dev.vars`

For local OAuth or AI testing, mirror the same names in `.dev.vars`:

```bash
SESSION_SECRET=local-dev-secret-change-me
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
APPLE_CLIENT_ID=your-apple-client-id
APPLE_NATIVE_CLIENT_IDS=app.spoonjoy,app.spoonjoy.mac,app.spoonjoy.Spoonjoy,app.spoonjoy.Spoonjoy.mac
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_IMAGE_TIMEOUT_MS=30000
IMAGE_PROVIDER_PRIMARY=gemini
IMAGE_PROVIDER_FALLBACKS=openai
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
POSTHOG_KEY=
POSTHOG_HOST=https://us.i.posthog.com
POSTHOG_DISABLED=
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_POSTHOG_DISABLED=
INGREDIENT_PARSE_PROVIDER=openai
INGREDIENT_PARSE_MODEL=gpt-4o-mini
INGREDIENT_PARSE_TIMEOUT_MS=8000
INGREDIENT_PARSE_MAX_RETRIES=1
```

Basic local app development does not require these values. The app uses safe local fallbacks for sessions and stores uploaded images as data URLs when the `PHOTOS` binding is unavailable.

## Preflight

Run the machine-checkable preflight before production deploys:

```bash
pnpm run deploy:preflight
```

The preflight verifies:

- `wrangler.json` has the Worker entry, `nodejs_compat`, D1 `DB`, and R2 `PHOTOS`.
- `package.json` exposes the expected build, test, e2e, deploy, `deploy:auto`, and preflight scripts.
- `package.json` exposes `smoke:api` for live third-party API/docs/playground drift checks.
- `app/cloudflare-env.d.ts` types the Cloudflare bindings and documented secrets.
- README/deployment docs mention required bindings, secrets, and deploy commands.
- README/deployment docs mention optional PostHog client setup, server lifecycle telemetry, `POSTHOG_KEY`, `POSTHOG_DISABLED`, `VITE_POSTHOG_KEY`, and `VITE_POSTHOG_DISABLED`.
- README/deployment docs mention `SPOONJOY_CSP_MODE`, `Content-Security-Policy-Report-Only`, the one-commit rollback, `SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS`, and `ACK_REPORT_ONLY_CSP_ROLLBACK`.
- Numbered SQL migrations exist in `migrations/`.
- **Remote D1 migrations**: the preflight invokes `pnpm exec wrangler d1 migrations list DB --remote` and FAILS if any migrations are pending against the remote database. This guards against deploying application code that depends on a schema the remote database has not yet applied (the failure mode that caused the 2026-05-10 `/search` 500 incident).

### Remote check outcomes

| State | Result |
| --- | --- |
| Remote D1 reports no pending migrations | PASS |
| Remote D1 reports one or more pending migrations | FAIL — names of pending migrations are printed |
| Wrangler exits with an auth-keyed stderr (missing login, missing API token, code 10000, etc.) | WARN — preflight does not fail the deploy on missing auth, but the operator must verify manually |
| Wrangler exits non-zero for any other reason | FAIL |
| Wrangler stdout is not parseable as migration status | FAIL |
| Wrangler binary cannot be spawned (`ENOENT`, etc.) | FAIL |

### Skipping the remote check

Set `SPOONJOY_PREFLIGHT_SKIP_REMOTE=1` to skip the remote D1 migration check. The preflight will still emit a WARN line so the skip is visible in CI logs. Use this in:

- CI runs that do not have wrangler credentials.
- Local dev machines without `wrangler login`.
- Smoke runs of `pnpm run deploy:preflight` from sandboxes.

Do not set this in production deploy workflows — the whole point of the check is to catch unapplied migrations before they reach users.

## Production Deploy Flow

`.github/workflows/production-deploy.yml` releases the exact SHA from a successful canonical `main` CI run and also supports an exact-SHA manual `workflow_dispatch`. GitHub Actions releases share one non-cancellable `production-deploy` concurrency group, so those workflow jobs do not mutate Worker traffic or D1 concurrently. Local `deploy:auto`, direct Wrangler, and dashboard operations are outside that lock and are unsupported for production. Main should never sit ahead of production; after merging, verify the GitHub Actions run for the exact merge commit and then smoke the production URL.

The release strategy is source controlled through exactly one top-level `SPOONJOY_RELEASE_MODE` value:

- `atomic-bootstrap` is the checked-in initial mode. It deploys the inert CookSession namespace atomically, verifies public convergence, and probes the bootstrap contract. It never creates a 0%/100% split and does not permit manual Worker rollback.
- `atomic-product-activation` is the one-way product activation step. It atomically deploys the product-enabled Worker and verifies convergence without the bootstrap probe. It also does not permit manual Worker rollback.
- `protocol-v1-canary` is available only after product activation introduces `workers/cook-session-protocol-v1-boundary` and a reviewed follow-up changes the mode. `SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA` must equal the first Git commit that introduced that marker, so the inert bootstrap Worker can never become a rollback target. This mode alone may stage a candidate at 0%, smoke the exact candidate, promote it to 100%, or restore another source-tagged protocol-v1 version.

Changing phase is a code review event, not a workflow input or shell override. Atomic modes require an empty protocol boundary. Canary mode derives the marker's unique introduction commit from Git history, requires the configured lowercase 40-character SHA to match it exactly, and verifies that both the release and active Worker descend from it before any deploy command runs.

The GitHub workflow requires repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account that owns D1 `spoonjoy`, R2 `spoonjoy-photos`, and Worker `spoonjoy-v2`.
- `CLOUDFLARE_D1_API_TOKEN`: a dashboard-created account token with only D1 write access. The orchestrator exposes it only to D1 migration, remote-preflight, and production smoke commands that create and remove disposable D1 state.
- `CLOUDFLARE_WORKERS_API_TOKEN`: a dashboard-created account token with only Workers Scripts write and Workers R2 Storage write access. The orchestrator exposes it only to Worker version commands.

Build, Playwright, and Git commands receive none of the Cloudflare credentials. Production smoke receives only the D1 token it needs for disposable smoke data; it never receives the Workers token. Do not use a local Wrangler OAuth token for either secret because it is interactive user-session auth, not durable CI auth.

Dispatch production with the exact 40-character lowercase source SHA:

```bash
gh workflow run production-deploy.yml --ref main -f source_sha="$(git rev-parse HEAD)"
```

The workflow runs `scripts/deploy-production-canary.ts` using its checked-in lifecycle environment. Across all modes it:

1. Verifies that `HEAD` is exactly `SOURCE_SHA`, the tracked tree is clean, and records the immutable Git tree hash.
2. Runs local deploy preflight checks while skipping only the remote-migration check, builds without Cloudflare credentials, and rejects tracked build-output changes.
3. Lists every pending remote D1 migration, reads the matching bytes from the immutable release Git tree, records their content hashes, and refuses destructive or non-additive statements.
4. Revalidates the exact pending-name set, tracked tree, and reviewed bytes immediately around apply, then submits all reviewed in-memory SQL values and their migration-ledger inserts as one ordered D1 batch transaction through the Cloudflare query API. Wrangler never reopens a worktree migration file for the mutation. If any statement fails, D1 rolls back the whole batch; an indeterminate network response is still classified as requiring forward repair. After apply, the release requires no pending migration before rerunning the full preflight.
5. Resolves the current production deployment UUID and uses exact `wrangler versions view <id> --json` lookups for source/version provenance before mutation. Recent-version listings are used only to identify the just-uploaded candidate.
6. In an atomic mode, deploys once, resolves the source-tagged candidate version, verifies 100% public convergence, and runs the bootstrap probe only for `atomic-bootstrap`.
7. In `protocol-v1-canary`, verifies both current and candidate versions descend from the protocol boundary, stages the candidate at 0%, and captures the new deployment UUID. It requires that exact UUID before smoke and promotion, then verifies the promoted deployment and public convergence.
8. Restores and verifies the prior version after a canary failure only while the failed deployment UUID is still owned by this release. A restore command error is reconciled against control-plane and public state before it is classified as failed. Atomic post-deploy failures require forward repair because the prior inert/pre-boundary Worker is not a valid rollback target.

The command writes a sanitized `production-release.json` under `mcp-oauth-canary-artifacts/` on success or failure. It records the release mode and strategy, Git tree, exact known Worker identities, reviewed migration names, migration-apply state, and the fact that database rollback is unsupported; it never contains environment values, command output, access tokens, or stack traces. The workflow validates the complete phase/status/provenance tuple before preserving the artifact. A missing, malformed, contradictory, or unexpected artifact is atomically replaced with a sanitized unknown-state artifact rather than being uploaded as evidence.

For an intentional Worker rollback in `protocol-v1-canary`, manually dispatch the production workflow with the historical `source_sha` and its exact source-tagged `rollback_version_id`. Current `main` tooling resolves both known IDs with exact version lookups, confirms that both sources descend from the protocol-v1 boundary, stages it at 0% beside the current version at 100%, and inspects the exact rollback candidate CSP through Cloudflare's version override before promotion. A valid enforcing CSP needs no break-glass acknowledgement. A report-only, absent, or weakened CSP requires the exact `ACK_REPORT_ONLY_CSP_ROLLBACK` workflow acknowledgement; unavailable or inconclusive inspection fails closed, restores the prior 100% deployment, and verifies convergence. The workflow never executes scripts from the historical commit, never crosses the protocol boundary, and does not attempt to roll D1 back. Rollback dispatches are rejected while either atomic mode is active, and the target must remain within Cloudflare's most recent 100 uploaded versions.

D1 migrations are not Worker-versioned and cannot be rolled back by a Worker traffic change. Automatic releases therefore accept only additive SQL that remains compatible with the prior Worker version. Destructive schema/data migrations require a separately reviewed maintenance plan and must not be sent through `deploy:auto`.

For full deploys with the longer test/typecheck gate:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm run deploy:preflight
pnpm typecheck
pnpm test:coverage
pnpm test:e2e
gh workflow run production-deploy.yml --ref main -f source_sha="$(git rev-parse HEAD)"
```

Production release modes and protocol boundaries come only from the checked-in workflow environment; `deploy:auto` does not accept lifecycle arguments. Use the exact-SHA GitHub workflow for production release or rollback. Direct production D1 migration, `pnpm run deploy`, Wrangler deploy, and dashboard traffic changes bypass lifecycle checks and are unsupported. Cloudflare deployment creation has no expected-current compare-and-swap input, so an out-of-band traffic writer can race the supported workflow between an ownership check and mutation; detected UUID changes fail closed, but operationally preventing those writers is part of the release lock. `pnpm run deploy:qa` remains the supported direct QA path.

## Failure Modes

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| OAuth buttons redirect back with `oauthError` | Missing or mismatched OAuth secret/callback config | Re-check provider callback URLs and `wrangler secret put` values |
| Uploaded images work locally but not in production | Missing `PHOTOS` R2 bucket/binding or R2 is not enabled for the deploy account | Enable R2 in the Dashboard, create `spoonjoy-photos`, and verify `wrangler.json` binding |
| Ingredient parsing returns fallback/manual review | Missing or invalid `OPENAI_API_KEY` | Set the secret or keep deterministic fallback behavior |
| Production schema is stale | D1 migrations not applied remotely | Review the pending SQL, then dispatch the exact-SHA production workflow for additive migrations |
| `pnpm run deploy:preflight` fails with "Remote D1 has N pending migration(s)" | Local code references a schema change that has not been applied to remote D1 | Dispatch the exact-SHA production workflow for additive migrations; use a separately reviewed maintenance plan for destructive migrations |
| `deploy:auto` rejects a migration as non-additive | Pending SQL could make the prior Worker incompatible, so automatic rollback would be unsafe | Stop the release and design a staged expand/migrate/contract sequence |
| Candidate smoke or promotion fails | The candidate did not pass the exact-version gate | Confirm `mcp-oauth-canary-artifacts/production-release.json` reports `rolled_back`, then inspect the MCP OAuth smoke artifacts |
| Intermittent 1102 / "Worker exceeded CPU time limit" on SSR routes | Worker Free CPU headroom is too close to React Router SSR + Prisma/D1 render cost | Reproduce with `wrangler tail`, then either reduce the hot route's server work or move the Worker to a paid plan before setting `limits.cpu_ms` |
| Sessions reset across deploys | Missing/rotating `SESSION_SECRET` | Set a stable high-entropy production secret |
