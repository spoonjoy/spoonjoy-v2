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

## Required Secrets

Set production secrets with `wrangler secret put`:

```bash
wrangler secret put SESSION_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put APPLE_CLIENT_ID
wrangler secret put APPLE_TEAM_ID
wrangler secret put APPLE_KEY_ID
wrangler secret put APPLE_PRIVATE_KEY
wrangler secret put OPENAI_API_KEY
```

Notes:

- `SESSION_SECRET` protects auth sessions and must be high entropy in production.
- Google and Apple OAuth secrets are required for OAuth login/account linking.
- `OPENAI_API_KEY` enables ingredient parsing. Missing local keys fall back to deterministic parsing paths where supported, but production should set the secret before enabling AI-assisted flows.
- Optional ingredient parsing runtime knobs are `INGREDIENT_PARSE_PROVIDER`, `INGREDIENT_PARSE_MODEL`, `INGREDIENT_PARSE_TIMEOUT_MS`, and `INGREDIENT_PARSE_MAX_RETRIES`. The safe default is OpenAI with `gpt-4o-mini`, an 8000ms timeout, and 1 retry.

## Local `.dev.vars`

For local OAuth or AI testing, mirror the same names in `.dev.vars`:

```bash
SESSION_SECRET=local-dev-secret-change-me
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
APPLE_CLIENT_ID=your-apple-client-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
OPENAI_API_KEY=sk-...
INGREDIENT_PARSE_PROVIDER=openai
INGREDIENT_PARSE_MODEL=gpt-4o-mini
INGREDIENT_PARSE_TIMEOUT_MS=8000
INGREDIENT_PARSE_MAX_RETRIES=1
```

Basic local app development does not require these values. The app uses safe local fallbacks for sessions and stores uploaded images as data URLs when the `PHOTOS` binding is unavailable.

## Preflight

Run the machine-checkable preflight before production deploys:

```bash
pnpm deploy:preflight
```

The preflight verifies:

- `wrangler.json` has the Worker entry, `nodejs_compat`, D1 `DB`, and R2 `PHOTOS` bindings.
- `package.json` exposes the expected build, test, e2e, deploy, `deploy:auto`, and preflight scripts.
- `app/cloudflare-env.d.ts` types the Cloudflare bindings and documented secrets.
- README/deployment docs mention required bindings, secrets, and deploy commands.
- Numbered SQL migrations exist in `migrations/`.
- **Remote D1 migrations**: the preflight invokes `pnpm exec wrangler d1 migrations apply DB --remote --json` (read-only via `migrations list`) and FAILS if any migrations are pending against the remote database. This guards against deploying application code that depends on a schema the remote database has not yet applied (the failure mode that caused the 2026-05-10 `/search` 500 incident).

### Remote check outcomes

| State | Result |
| --- | --- |
| Remote D1 reports no pending migrations | PASS |
| Remote D1 reports one or more pending migrations | FAIL — names of pending migrations are printed |
| Wrangler exits with an auth-keyed stderr (missing login, missing API token, code 10000, etc.) | WARN — preflight does not fail the deploy on missing auth, but the operator must verify manually |
| Wrangler exits non-zero for any other reason | FAIL |
| Wrangler stdout is not valid JSON, or shape is unexpected | FAIL |
| Wrangler binary cannot be spawned (`ENOENT`, etc.) | FAIL |

### Skipping the remote check

Set `SPOONJOY_PREFLIGHT_SKIP_REMOTE=1` to skip the remote D1 migration check. The preflight will still emit a WARN line so the skip is visible in CI logs. Use this in:

- CI runs that do not have wrangler credentials.
- Local dev machines without `wrangler login`.
- Smoke runs of `pnpm deploy:preflight` from sandboxes.

Do not set this in production deploy workflows — the whole point of the check is to catch unapplied migrations before they reach users.

## Production Deploy Flow

The shortest path for a production release is `pnpm deploy:auto`, which chains:

```
pnpm deploy:preflight && pnpm build && pnpm exec wrangler d1 migrations apply DB --remote && pnpm exec wrangler deploy
```

In one command this:

1. Runs the full preflight (including the remote-migration check).
2. Builds the client bundle.
3. Applies any pending remote D1 migrations.
4. Deploys the Worker.

For full deploys with the longer test/typecheck gate:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm deploy:preflight
pnpm typecheck
pnpm test:coverage
pnpm test:e2e
pnpm deploy:auto
```

If you prefer the manual two-step (no auto-apply of migrations), use:

```bash
pnpm deploy:preflight
wrangler d1 migrations apply DB --remote
pnpm deploy
```

`pnpm deploy` now runs `pnpm deploy:preflight && pnpm build && pnpm exec wrangler deploy`; keep that chain so deploys never publish an unbuilt client bundle or skip the remote-migration check.

## Failure Modes

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| OAuth buttons redirect back with `oauthError` | Missing or mismatched OAuth secret/callback config | Re-check provider callback URLs and `wrangler secret put` values |
| Uploaded images work locally but not in production | Missing `PHOTOS` R2 bucket/binding or R2 is not enabled for the deploy account | Enable R2 in the Dashboard, create `spoonjoy-photos`, and verify `wrangler.json` binding |
| Ingredient parsing returns fallback/manual review | Missing or invalid `OPENAI_API_KEY` | Set the secret or keep deterministic fallback behavior |
| Production schema is stale | D1 migrations not applied remotely | Run `wrangler d1 migrations apply DB --remote` before deploy, or use `pnpm deploy:auto` to apply + deploy in one step |
| `pnpm deploy:preflight` fails with "Remote D1 has N pending migration(s)" | Local code references a schema change that has not been applied to remote D1 | Run `pnpm exec wrangler d1 migrations apply DB --remote` or `pnpm deploy:auto` (which applies pending migrations before deploying) |
| Sessions reset across deploys | Missing/rotating `SESSION_SECRET` | Set a stable high-entropy production secret |
