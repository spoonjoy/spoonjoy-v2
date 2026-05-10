# Cloudflare Deployment Checklist

Spoonjoy v2 deploys to Cloudflare Workers with D1 for data and R2 for uploaded profile/recipe photos. This checklist is intentionally explicit so agents can verify deploy readiness without relying on tribal memory.

## Required Bindings

`wrangler.json` must define these bindings:

| Binding | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 database | Prisma-backed application data |
| `PHOTOS` | R2 bucket | Profile and recipe image uploads served through `/photos/*` |

Create first-time production resources with:

```bash
wrangler d1 create spoonjoy
wrangler r2 bucket create spoonjoy-photos
```

After creating D1, copy the returned `database_id` into `wrangler.json` under the `DB` binding.

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
- `package.json` exposes the expected build, test, e2e, deploy, and preflight scripts.
- `app/cloudflare-env.d.ts` types the Cloudflare bindings and documented secrets.
- README/deployment docs mention required bindings, secrets, and deploy commands.
- Numbered SQL migrations exist in `migrations/`.

## Production Deploy Flow

Use this order for production deploys:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm deploy:preflight
pnpm typecheck
pnpm test:coverage
pnpm test:e2e
wrangler d1 migrations apply DB --remote
pnpm deploy
```

`pnpm deploy` runs `pnpm build` before `wrangler deploy`; keep that order so deploys never publish an unbuilt client bundle.

## Failure Modes

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| OAuth buttons redirect back with `oauthError` | Missing or mismatched OAuth secret/callback config | Re-check provider callback URLs and `wrangler secret put` values |
| Uploaded images work locally but not in production | Missing `PHOTOS` R2 bucket/binding | Create `spoonjoy-photos` and verify `wrangler.json` binding |
| Ingredient parsing returns fallback/manual review | Missing or invalid `OPENAI_API_KEY` | Set the secret or keep deterministic fallback behavior |
| Production schema is stale | D1 migrations not applied remotely | Run `wrangler d1 migrations apply DB --remote` before deploy |
| Sessions reset across deploys | Missing/rotating `SESSION_SECRET` | Set a stable high-entropy production secret |
