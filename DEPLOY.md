# Deploying Spoonjoy v2 to Cloudflare

Complete guide for deploying Spoonjoy v2 to Cloudflare Workers with D1 database.

> **Note**: This deploys as a Cloudflare Worker with static assets (not Pages). The Worker handles SSR and the assets directory serves static files.

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed (`npm install -g wrangler`)
- Node.js 20+
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
3. Enable "Google+ API" or "Google Identity"
4. Go to Credentials → Create Credentials → OAuth 2.0 Client ID
5. Application type: Web application
6. Add authorized redirect URI: `https://your-domain.com/auth/google/callback`
7. Copy Client ID and Client Secret

#### Apple OAuth

| Secret | Description | How to Get |
|--------|-------------|------------|
| `APPLE_CLIENT_ID` | Apple Services ID | [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list/serviceId) |
| `APPLE_TEAM_ID` | Apple Developer Team ID | Top right of Apple Developer Portal |
| `APPLE_KEY_ID` | Apple Sign-in Key ID | Create in Keys section |
| `APPLE_PRIVATE_KEY` | Apple private key (.p8 file contents) | Download when creating key |

```bash
wrangler secret put APPLE_CLIENT_ID
wrangler secret put APPLE_TEAM_ID
wrangler secret put APPLE_KEY_ID
wrangler secret put APPLE_PRIVATE_KEY
# For private key, paste the entire contents including BEGIN/END lines
```

**Apple OAuth Setup:**
1. Go to [Apple Developer Portal](https://developer.apple.com/)
2. Identifiers → Create App ID with "Sign in with Apple" capability
3. Identifiers → Create Services ID, configure domains and redirect URLs
4. Keys → Create key with "Sign in with Apple", download .p8 file
5. Note your Team ID (top right of portal)

### Optional Secrets

| Secret | Description | Required For |
|--------|-------------|--------------|
| `OPENAI_API_KEY` | OpenAI API key | AI-powered ingredient parsing |

```bash
wrangler secret put OPENAI_API_KEY
```

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

```bash
# Apply all migrations to production D1
wrangler d1 migrations apply spoonjoy --remote
```

If you need to seed initial data:
```bash
wrangler d1 execute spoonjoy --remote --file=./migrations/0002_seed.sql
```

## Step 6: Build and Deploy

There are two supported deploy paths:

### `pnpm deploy` — safe, manual migrations

`pnpm deploy` now runs the full preflight (including a remote D1 migration check) before building and deploying. It does **not** apply remote D1 migrations for you. If the preflight detects pending migrations, it fails and tells you which migrations are pending.

```bash
# Apply any pending migrations first
pnpm exec wrangler d1 migrations apply DB --remote

# Then deploy (preflight → build → wrangler deploy)
pnpm deploy
```

Use this path when you want to inspect migrations before applying them or when migrations require a manual review.

### `pnpm deploy:auto` — one-shot preflight + migrate + deploy

```bash
pnpm deploy:auto
```

This chains `pnpm deploy:preflight && pnpm build && pnpm exec wrangler d1 migrations apply DB --remote && pnpm exec wrangler deploy`. Use this when migrations are routine and you want a single command to fully push a release. This is the recommended path for the common case.

**Why this matters**: on 2026-05-10 a production deploy went out without applying remote D1 migrations, causing `/search` to 500 with `no such column: ...` errors. `pnpm deploy:auto` and the preflight remote-migration check exist to make that failure mode impossible going forward.

### Skipping the remote check in dev or unauthenticated CI

If you run `pnpm deploy:preflight` from an environment without wrangler credentials, set `SPOONJOY_PREFLIGHT_SKIP_REMOTE=1` to skip the remote check. The preflight will emit a WARN line so the skip is visible in logs.

```bash
SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm deploy:preflight
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
| `APPLE_CLIENT_ID` | If using Apple login | Apple OAuth |
| `APPLE_TEAM_ID` | If using Apple login | Apple OAuth |
| `APPLE_KEY_ID` | If using Apple login | Apple OAuth |
| `APPLE_PRIVATE_KEY` | If using Apple login | Apple OAuth |
| `OPENAI_API_KEY` | Optional | AI features |

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

# Deploy
pnpm deploy
```

Or set up automatic deployments via GitHub integration in Cloudflare Pages dashboard.
