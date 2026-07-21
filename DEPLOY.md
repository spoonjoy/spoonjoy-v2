# Deploying Spoonjoy v2 to Cloudflare

Complete guide for deploying Spoonjoy v2 to Cloudflare Workers with D1 database.

> **Note**: This deploys as a Cloudflare Worker with static assets (not Pages). The Worker handles SSR and the assets directory serves static files.

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed (`npm install -g wrangler`)
- Node.js 22.x (`package.json` requires `>=22 <23`)
- Git

## Step 1: Authenticate with Cloudflare

```bash
wrangler login
```

This opens a browser to authenticate. After login, Wrangler stores credentials locally.

## Step 2: Create Cloudflare Resources

### D1 Database

```bash
# Create the production database
wrangler d1 create spoonjoy

# Output will show:
# [[d1_databases]]
# binding = "DB"
# database_name = "spoonjoy"
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy the `database_id`** — you'll need it for wrangler.json.

### Dedicated QA Resources

QA is a separate Cloudflare environment, not a seed namespace in production. It deploys to `spoonjoy-v2-qa.mendelow-studio.workers.dev`, uses D1 `spoonjoy-qa`, and stores images in R2 bucket `spoonjoy-photos-qa`.

```bash
wrangler d1 create spoonjoy-qa
wrangler r2 bucket create spoonjoy-photos-qa
wrangler secret list --env qa
wrangler secret put SESSION_SECRET --env qa
wrangler secret put VAPID_PUBLIC_KEY --env qa
wrangler secret put VAPID_PRIVATE_KEY --env qa
wrangler secret put VAPID_SUBJECT --env qa
```

Use `POSTHOG_DISABLED=true` for privacy-sensitive QA runs unless the point of the run is telemetry verification. Match image-provider policy with `IMAGE_PROVIDER_PRIMARY=gemini` and the same Gemini/OpenAI fallback variables used by production. QA OAuth callback configuration must include the QA origin for providers you enable there; WebAuthn passkey verification uses the QA request origin.

QA deploy and smoke flow:

```bash
pnpm run qa:preflight
pnpm run qa:migrate
pnpm run qa:seed
CLOUDFLARE_ENV=qa pnpm run build
SPOONJOY_QA_PREFLIGHT_EXPECT_BUILD_CONFIG=1 pnpm run qa:preflight
pnpm run deploy:qa
pnpm run smoke:qa
```

`pnpm run qa:seed` writes only `sj-qa-demo` data. `pnpm run smoke:qa` uses `--target-env qa`, creates `codex-smoke-` data, cleans it from QA D1, and verifies the cleanup. Do not run broad production cleanup.

### R2 Bucket (required for recipe images)

Recipe and profile image uploads are backed by Cloudflare R2 through the `PHOTOS` binding. Before the first bucket can be created, R2 must be enabled for the Cloudflare account in the Dashboard. Wrangler/API calls return `10042: Please enable R2 through the Cloudflare Dashboard` until that account-level R2 step is complete.

```bash
# First, enable R2 in Cloudflare Dashboard > R2 Object Storage.
# Then create and verify the bucket:
wrangler r2 bucket create spoonjoy-photos
wrangler r2 bucket list
```

## Step 3: Update wrangler.json

Update `wrangler.json` with your production values:

```json
{
  "name": "spoonjoy-v2",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "spoonjoy",
      "database_id": "YOUR_DATABASE_ID_HERE"
    }
  ],
  "r2_buckets": [
    {
      "binding": "PHOTOS",
      "bucket_name": "spoonjoy-photos"
    }
  ]
}
```

## Step 4: Set Secrets

Secrets are sensitive values that shouldn't be in code or config files.

### Required Secrets

| Secret | Description | How to Get |
|--------|-------------|------------|
| `SESSION_SECRET` | Cookie signing key | Generate: `openssl rand -hex 32` |

```bash
wrangler secret put SESSION_SECRET
# Paste your generated secret when prompted
```

### OAuth Secrets (if using social login)

#### Google OAuth

| Secret | Description | How to Get |
|--------|-------------|------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Same as above |

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

**Google OAuth Setup:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Configure the OAuth consent screen for Spoonjoy
4. Go to Credentials → Create Credentials → OAuth 2.0 Client ID
5. Application type: Web application
6. Add authorized redirect URI: `https://spoonjoy.app/auth/google/callback`
   - For QA, add `https://spoonjoy-v2-qa.mendelow-studio.workers.dev/auth/google/callback`
7. Copy Client ID and Client Secret

#### GitHub OAuth

| Secret | Description | How to Get |
|--------|-------------|------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID | [GitHub Developer Settings](https://github.com/settings/developers) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret | Same as above |

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

**GitHub OAuth Setup:**
1. Go to GitHub Developer Settings → OAuth Apps
2. Create or update the Spoonjoy OAuth app
3. Set Homepage URL to `https://your-domain.com`
4. Set Authorization callback URL to `https://your-domain.com/auth/github/callback`
5. Copy Client ID and Client Secret

#### Apple OAuth

| Secret | Description | How to Get |
|--------|-------------|------------|
| `APPLE_CLIENT_ID` | Apple Services ID | [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list/serviceId) |
| `APPLE_TEAM_ID` | Apple Developer Team ID | Top right of Apple Developer Portal |
| `APPLE_KEY_ID` | Apple Sign-in Key ID | Create in Keys section |
| `APPLE_PRIVATE_KEY` | Apple private key (.p8 file contents) | Download when creating key |
| `APPLE_OAUTH_CALLBACK_MODE` | Social callback selection: `legacy` or `clean` | Defaults to `legacy` when omitted |
| `APPLE_OAUTH_CLEAN_CALLBACK_REGISTERED` | Whether the clean social callback is registered with Apple | Defaults to `false` when omitted |

```bash
wrangler secret put APPLE_CLIENT_ID
wrangler secret put APPLE_TEAM_ID
wrangler secret put APPLE_KEY_ID
wrangler secret put APPLE_PRIVATE_KEY
# For private key, paste the entire contents including BEGIN/END lines
```

The two callback controls are non-sensitive runtime configuration. During this
backward-compatible stage, leave them omitted or set them to:

```bash
APPLE_OAUTH_CALLBACK_MODE=legacy
APPLE_OAUTH_CLEAN_CALLBACK_REGISTERED=false
```

The current Apple Service ID return URL for new login starts is
`https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithApple`.
Account linking uses the same legacy path with `method=linkAppleAccount`. The
clean handler at `https://spoonjoy.app/auth/apple/callback` is deployed in
parallel, but starts must not select it until that exact URL is registered in
the Apple Developer portal and both paths have passed canaries.

After registration, set `APPLE_OAUTH_CLEAN_CALLBACK_REGISTERED=true` first.
Switch `APPLE_OAUTH_CALLBACK_MODE=clean` only in the separately reviewed start
switch. To roll back new starts, set `APPLE_OAUTH_CALLBACK_MODE=legacy`; keep
both portal return URLs and both handlers in place for in-flight sessions.

**Apple OAuth Setup:**
1. Go to [Apple Developer Portal](https://developer.apple.com/)
2. Identifiers → Create App ID with "Sign in with Apple" capability
3. Identifiers → Create Services ID, configure domains and redirect URLs.
   Preserve the currently registered legacy return URL while adding
   `https://your-domain.com/auth/apple/callback`; do not switch starts until
   both callbacks have been canaried.
   Apple uses `response_mode=form_post`, so this callback is a cross-site POST
   from `appleid.apple.com`; keep that origin in `react-router.config.ts`.
4. Keys → Create key with "Sign in with Apple", download .p8 file
5. Note your Team ID (top right of portal)

### Optional Secrets

| Secret | Description | Required For |
|--------|-------------|--------------|
| `OPENAI_API_KEY` | OpenAI API key | AI-powered ingredient parsing |

```bash
wrangler secret put OPENAI_API_KEY
```

### Optional PostHog Telemetry

Spoonjoy can capture client product telemetry, developer docs/playground UX events, server lifecycle telemetry, and server/client error events through PostHog. See `docs/analytics-privacy.md` for the event names and privacy exclusions.

Server lifecycle telemetry for API v1, legacy API, MCP, OAuth, and Worker errors is enabled only when `POSTHOG_KEY` is present and `POSTHOG_DISABLED` is not true-ish:

```bash
wrangler secret put POSTHOG_KEY
```

Client analytics is baked into the Vite bundle at build time. Provide the public project key as a build environment variable, not in source:

```bash
VITE_POSTHOG_KEY=...
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_POSTHOG_DISABLED=
```

Use `POSTHOG_DISABLED=true` or `VITE_POSTHOG_DISABLED=true` to force a telemetry kill switch without removing configured keys. Never paste or print the key value in deploy logs, docs, or committed files.

### Web Push (VAPID) Secrets

Required for the in-app web push notification system (D-006). Without these the
`/api/push/public-key` endpoint will return 500 and the in-app "Enable
notifications" button will surface an error toast — the rest of the app works
normally.

| Secret | Description |
|--------|-------------|
| `VAPID_PUBLIC_KEY` | Base64url-encoded uncompressed P-256 public key (65 bytes). May also be set in `wrangler.json` `vars` since it is, by definition, public. |
| `VAPID_PRIVATE_KEY` | Base64url-encoded P-256 private key (32 bytes). MUST be a Wrangler secret. |
| `VAPID_SUBJECT` | `mailto:` URL or `https://` URL identifying the application owner (per RFC 8292 §2.1). |

Generate a fresh keypair (one-time, idempotent re-run is safe but produces new
keys):

```bash
tsx scripts/generate-vapid-keys.ts
```

The script prints a dotenv-style block to stdout. Set the production secrets:

```bash
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT
```

For local dev, copy the printed block into `.dev.vars` (gitignored).

## Step 5: Run Database Migrations

Production migrations are applied only by the exact-SHA GitHub production workflow after its additive-SQL review and ownership checks. Direct production D1 writes are unsupported.

## Step 6: Build and Deploy

Production has one supported release path:

```bash
gh workflow run production-deploy.yml --ref main -f source_sha="$(git rev-parse HEAD)"
```

The workflow runs the source-controlled release orchestrator with an exact 40-character lowercase source SHA. It proves the checked-out commit and clean Git tree, builds without Cloudflare credentials, reviews pending D1 bytes from the immutable Git tree, revalidates their hashes and exact remote pending set, and submits those reviewed in-memory bytes plus their migration-ledger inserts as one ordered D1 batch transaction through the Cloudflare query API. Wrangler never reopens a worktree migration file for the mutation. A statement failure rolls back the whole batch; an indeterminate network response still requires forward repair. The workflow then reruns the full preflight. Depending on the checked-in lifecycle phase, it either deploys atomically or stages a protocol-v1 candidate at 0%, smokes that exact candidate, promotes it, and verifies both the owned Cloudflare deployment UUID and the public version header. Canary restoration requires ownership of the failed deployment plus two consecutive control-plane and public-version matches.

The release result is written to `mcp-oauth-canary-artifacts/production-release.json` with sanitized Git provenance, reviewed migrations, D1 apply state, version IDs, phase, status, and redacted failure text. D1 is not Worker-versioned, so destructive migrations require a separately reviewed expand/migrate/contract rollout and are intentionally blocked from this command.

Intentional rollbacks are dispatched in GitHub with a historical `source_sha` and its exact source-tagged Worker `rollback_version_id`. Current `main` tooling resolves the ID with an exact version lookup and deploys that immutable version directly; historical scripts are never executed, and D1 is not rolled back. The protocol boundary is the unique commit that first introduces the product-activation marker, never the inert bootstrap release.

Direct production `pnpm run deploy`, `deploy:auto`, Wrangler deploy/migration commands, and dashboard traffic changes bypass the workflow lock and are unsupported. Cloudflare has no expected-current deployment CAS, so preventing those out-of-band writers is required; detected deployment-UUID replacement fails closed. `pnpm run deploy:qa` remains the supported direct QA path.

**Why this matters**: on 2026-05-10 a production deploy went out without applying remote D1 migrations, causing `/search` to 500 with `no such column: ...` errors. The exact-SHA workflow and remote-migration preflight exist to make that failure mode impossible going forward.

### Skipping the remote check in dev or unauthenticated CI

If you run `pnpm run deploy:preflight` from an environment without wrangler credentials, set `SPOONJOY_PREFLIGHT_SKIP_REMOTE=1` to skip the remote check. The preflight will emit a WARN line so the skip is visible in logs.

```bash
SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run deploy:preflight
```

Do **not** set this in a real production deploy — the check is what catches unapplied migrations.

The deploy output will show your Worker URL: `https://spoonjoy-v2.<account>.workers.dev`

## Step 7: Verify Deployment

1. **Check the deployment URL** in Wrangler output
2. **Test the app**: Visit `https://spoonjoy-v2.<account>.workers.dev` (or your custom domain)
3. **Check logs**: `wrangler tail spoonjoy-v2`
4. **Test authentication**: Try logging in with email/password and OAuth
5. **Test images**: Upload a recipe image and verify the returned URL is served through `/photos/...`

## Environment Variables Summary

### In wrangler.json (non-sensitive)

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Environment mode |

### Secrets (set via `wrangler secret put`)

| Secret | Required | Description |
|--------|----------|-------------|
| `SESSION_SECRET` | ✅ Yes | Cookie signing (generate with `openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID` | If using Google login | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | If using Google login | Google OAuth |
| `GITHUB_CLIENT_ID` | If using GitHub login | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | If using GitHub login | GitHub OAuth |
| `APPLE_CLIENT_ID` | If using Apple login | Apple OAuth |
| `APPLE_TEAM_ID` | If using Apple login | Apple OAuth |
| `APPLE_KEY_ID` | If using Apple login | Apple OAuth |
| `APPLE_PRIVATE_KEY` | If using Apple login | Apple OAuth |
| `APPLE_OAUTH_CALLBACK_MODE` | Optional | Apple social callback mode; defaults to `legacy` |
| `APPLE_OAUTH_CLEAN_CALLBACK_REGISTERED` | Optional | Clean-callback registration assertion; defaults to `false` |
| `OPENAI_API_KEY` | Optional | AI features |
| `VAPID_PUBLIC_KEY` | ✅ Yes | Web push public key |
| `VAPID_PRIVATE_KEY` | ✅ Yes | Web push private key |
| `VAPID_SUBJECT` | ✅ Yes | Web push contact subject |
| `POSTHOG_KEY` | Optional | Server lifecycle telemetry and error capture |

### Optional Worker telemetry variables

These are Worker runtime variables. They may be set as Wrangler vars or secrets depending on the deploy environment policy; do not print values in logs.

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTHOG_HOST` | Optional | PostHog ingestion host override |
| `POSTHOG_DISABLED` | Optional | Server telemetry kill switch |

### Public build-time variables

These values must be present in the environment that runs `pnpm run build`. They are public Vite build-time configuration, not Worker secrets.

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_POSTHOG_KEY` | Optional | Public build-time client analytics key |
| `VITE_POSTHOG_HOST` | Optional | Public build-time client ingestion host |
| `VITE_POSTHOG_DISABLED` | Optional | Client telemetry kill switch |

## Troubleshooting

### "Missing required environment variable"
- Ensure all secrets are set: `wrangler secret list`
- Re-set any missing secrets: `wrangler secret put SECRET_NAME`

### Database errors
- Verify migrations ran: `wrangler d1 migrations list spoonjoy --remote`
- Check database exists in the same Cloudflare account as `CLOUDFLARE_ACCOUNT_ID`: `wrangler d1 list`

### OAuth redirect errors
- Verify redirect URIs match your deployed domain in Google/Apple console
- Ensure secrets are set correctly (no extra whitespace)

### R2 errors
- `10042: Please enable R2 through the Cloudflare Dashboard` means the Cloudflare account has not enabled R2 yet. Enable R2 in the Dashboard, then rerun `wrangler r2 bucket create spoonjoy-photos`.
- Verify the bucket exists in the same account used for deploy: `wrangler r2 bucket list`.

### Build failures
- Run locally first: `pnpm build`
- Check Node.js version matches (22.x)

## Custom Domain (Optional)

1. Go to Cloudflare Dashboard → Pages → your project → Custom domains
2. Add your domain
3. Update DNS if needed
4. Update OAuth redirect URIs to use your custom domain

## Updating the Deployment

After making changes:

```bash
git add .
git commit -m "your changes"
git push

# Release the exact reviewed main SHA
gh workflow run production-deploy.yml --ref main -f source_sha="$(git rev-parse HEAD)"
```

Use the canonical production workflow rather than a separate dashboard integration so releases share the same non-cancellable lock and lifecycle checks.
