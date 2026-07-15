# Cloudflare Deployment Checklist

Spoonjoy v2 deploys to Cloudflare Workers with D1 for data and R2 for uploaded profile/recipe photos. This checklist is intentionally explicit so agents can verify deploy readiness without relying on tribal memory.

## Required Bindings

`wrangler.json` must define these bindings:

| Binding | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 database | Prisma-backed application data |
| `PHOTOS` | R2 bucket | Profile and recipe image uploads served through `/photos/*` |

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
- Disposable seed namespace: `sj-qa-demo`
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

`pnpm run smoke:qa` passes `--target-env qa`, creates a `codex-smoke-` user, cleans it from QA D1 with `--env qa`, and verifies the user count returns to zero. Do not run broad production cleanup. Production smoke cleanup must stay narrow to the one disposable `codex-smoke-` account created by that smoke run.

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

## Legacy Cloudinary Asset Migration

Spoonjoy v2 is hosted on Cloudflare Workers and stores new uploads in R2, but the May 2026 v1 import preserved legacy recipe-cover URLs. Those rows must not continue to point at Cloudinary because they consume the old account quota whenever recipes or search results render.

Audit without changing data:

```bash
pnpm run migrate:cloudinary-r2 -- --target-env production --dry-run
```

Apply the migration:

```bash
pnpm run migrate:cloudinary-r2 -- --target-env production --apply
```

The command captures a Time Travel bookmark plus row-level rollback files under `/tmp/spoonjoy-d1-backups/`. It attempts a full D1 export too, but Wrangler cannot export D1 databases that contain FTS5 virtual tables, so the row-level rollback is the authoritative backup for this URL-only migration. The command downloads each unique `https://res.cloudinary.com/...` image once, uploads it to `spoonjoy-photos` under `legacy-cloudinary/`, and updates guarded references in `RecipeCover`, `SearchDocument`, `User`, and `RecipeSpoon`. It is dry-run by default, writes a JSON report under `cloudinary-r2-migration-artifacts/`, and only updates rows whose current URL still matches the old Cloudinary URL.

If the asset-copy phase succeeds but the final D1 update fails, rerun with:

```bash
pnpm run migrate:cloudinary-r2 -- --target-env production --apply --resume-existing-r2
```

That mode probes R2 first and reuses existing `legacy-cloudinary/` objects before making any Cloudinary request.

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

`.github/workflows/production-deploy.yml` deploys every push to `main` and also supports manual `workflow_dispatch`. Main should never sit ahead of production; after merging, verify the GitHub Actions run for the exact merge commit and then smoke the production URL. If the workflow is absent, stale, failed, or still pending beyond the normal deploy window, run `pnpm deploy:auto` locally with authenticated Wrangler and record the deployed Worker version.

The GitHub workflow requires repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account that owns D1 `spoonjoy`, R2 `spoonjoy-photos`, and Worker `spoonjoy-v2`.
- `CLOUDFLARE_D1_API_TOKEN`: a dashboard-created account token with only D1 write access. The orchestrator exposes it only to D1 migration and remote-preflight commands.
- `CLOUDFLARE_WORKERS_API_TOKEN`: a dashboard-created account token with only Workers Scripts write and Workers R2 Storage write access. The orchestrator exposes it only to Worker version commands.

Build, Playwright, smoke, and Git commands receive none of the Cloudflare credentials. Do not use a local Wrangler OAuth token for either secret because it is interactive user-session auth, not durable CI auth.

The production release command requires the exact 40-character lowercase source SHA:

```bash
SOURCE_SHA="$(git rev-parse HEAD)" pnpm deploy:auto
```

`pnpm deploy:auto` runs `scripts/deploy-production-canary.ts`. In one command it:

1. Verifies that `HEAD` is exactly `SOURCE_SHA`, the tracked tree is clean, and records the immutable Git tree hash.
2. Runs local deploy preflight checks while skipping only the remote-migration check, builds without Cloudflare credentials, and rejects tracked build-output changes.
3. Lists every pending remote D1 migration, reads the matching local SQL, and refuses destructive or non-additive statements.
4. Applies the reviewed additive migrations and reruns the full preflight, including the remote-migration check.
5. Resolves the current single-version production deployment, uploads a Worker version tagged with `SOURCE_SHA`, and stages it at 0% traffic beside the prior version at 100%.
6. Runs the MCP OAuth smoke against the exact candidate Worker version.
7. Promotes the candidate to 100% only after the candidate smoke passes, then verifies both Cloudflare's active deployment and the public `X-Spoonjoy-Worker-Version` header.
8. Restores and verifies the prior version after any failure once staging has succeeded.

The command writes a sanitized `production-release.json` under `mcp-oauth-canary-artifacts/` on success or failure. It records the Git tree, reviewed migration names, migration-apply state, and the fact that database rollback is unsupported; it never contains environment values, command output, access tokens, or stack traces.

For an intentional Worker rollback, manually dispatch the production workflow with the historical `source_sha` and its exact source-tagged `rollback_version_id`. The workflow checks out current `main` tooling, confirms that the version ID is tagged with that SHA, deploys the known version directly, and verifies public convergence. It never executes scripts from the historical commit and does not attempt to roll D1 back.

D1 migrations are not Worker-versioned and cannot be rolled back by a Worker traffic change. Automatic releases therefore accept only additive SQL that remains compatible with the prior Worker version. Destructive schema/data migrations require a separately reviewed maintenance plan and must not be sent through `deploy:auto`.

For full deploys with the longer test/typecheck gate:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm run deploy:preflight
pnpm typecheck
pnpm test:coverage
pnpm test:e2e
SOURCE_SHA="$(git rev-parse HEAD)" pnpm deploy:auto
```

If you prefer the manual two-step (no auto-apply of migrations), use:

```bash
pnpm run deploy:preflight
wrangler d1 migrations apply DB --remote
pnpm run deploy
```

`pnpm run deploy` runs `pnpm run deploy:preflight && pnpm run build && pnpm exec wrangler deploy`; keep that chain so deploys never publish an unbuilt client bundle or skip the remote-migration check. Use `pnpm run deploy`; bare `pnpm deploy` is pnpm's workspace deploy command and will not run this package script.

## Failure Modes

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| OAuth buttons redirect back with `oauthError` | Missing or mismatched OAuth secret/callback config | Re-check provider callback URLs and `wrangler secret put` values |
| Uploaded images work locally but not in production | Missing `PHOTOS` R2 bucket/binding or R2 is not enabled for the deploy account | Enable R2 in the Dashboard, create `spoonjoy-photos`, and verify `wrangler.json` binding |
| Ingredient parsing returns fallback/manual review | Missing or invalid `OPENAI_API_KEY` | Set the secret or keep deterministic fallback behavior |
| Production schema is stale | D1 migrations not applied remotely | Review the pending SQL, then run `SOURCE_SHA="$(git rev-parse HEAD)" pnpm deploy:auto` for additive migrations |
| `pnpm run deploy:preflight` fails with "Remote D1 has N pending migration(s)" | Local code references a schema change that has not been applied to remote D1 | Use `deploy:auto` for additive migrations; use a separately reviewed maintenance plan for destructive migrations |
| `deploy:auto` rejects a migration as non-additive | Pending SQL could make the prior Worker incompatible, so automatic rollback would be unsafe | Stop the release and design a staged expand/migrate/contract sequence |
| Candidate smoke or promotion fails | The candidate did not pass the exact-version gate | Confirm `mcp-oauth-canary-artifacts/production-release.json` reports `rolled_back`, then inspect the MCP OAuth smoke artifacts |
| Intermittent 1102 / "Worker exceeded CPU time limit" on SSR routes | Worker Free CPU headroom is too close to React Router SSR + Prisma/D1 render cost | Reproduce with `wrangler tail`, then either reduce the hot route's server work or move the Worker to a paid plan before setting `limits.cpu_ms` |
| Sessions reset across deploys | Missing/rotating `SESSION_SECRET` | Set a stable high-entropy production secret |
