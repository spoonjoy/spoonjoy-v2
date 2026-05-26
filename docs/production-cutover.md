# Spoonjoy v2 Production Cutover Runbook

This runbook is for switching the stable `spoonjoy.app` production surface from Spoonjoy v1 to Spoonjoy v2.

## Hard Gate

Do not point `spoonjoy.app` at v2 until:

- The v2 staging Worker has passed `pnpm production:readiness`.
- The final v2 branch has passed `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, and `pnpm test:e2e`.
- The final v2 Worker has passed live smoke tests on `https://spoonjoy-v2.mendelow-studio.workers.dev`.
- Ari has provided the data migration instructions for legacy Spoonjoy v1 data.
- The migration has been rehearsed or dry-run against a non-production target when possible.

## Pre-Cutover Inventory

Record these before touching DNS:

- Current v1 hosting target for `spoonjoy.app`.
- Current v2 Worker version ID.
- Current v2 D1 database ID.
- Current R2 bucket name for uploaded images.
- Current Cloudflare account and zone used for `spoonjoy.app`.
- Current OAuth redirect URLs configured in GitHub and Apple.

## Secrets

Required runtime secrets:

- `SESSION_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

Feature secrets:

- GitHub OAuth: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- Apple OAuth: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`
- AI features: `OPENAI_API_KEY`

If a feature secret group is missing, either set it before cutover or confirm the UI does not advertise that feature. OAuth buttons are environment-aware in v2 and should only show configured providers.

Google OAuth is intentionally disabled for the v1-to-v2 cutover: the Render v1 environment marks it `not yet enabled`, and the migrated v1 OAuth rows contain only Apple and GitHub accounts. Re-enable it only after creating real Google OAuth credentials and adding `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## Data Migration

Source:

- Spoonjoy v1 production data is in Neon project `spoonjoy`, database `sjdb`, branch `main`.
- Store the Neon connection string outside the repo, then expose it only for the migration command as `SPOONJOY_V1_DATABASE_URL`.
- The old Postgres-to-D1 gist is historical reference only. Do not use it directly for this repo because it deletes/recreates D1, regenerates migrations, and uses broad dump/sed conversion.

Target:

- Cloudflare D1 binding `DB`, database `spoonjoy`, database ID recorded in `wrangler.json`.
- Existing v2 demo/staging rows are replaced during the final production import. Always export the target first.

Dry-run/report:

```bash
SPOONJOY_V1_DATABASE_URL="<neon-postgres-url>" pnpm db:migrate:v1:report
```

Build final SQL and sidecar report:

```bash
mkdir -p /tmp/spoonjoy-v1-migration
SPOONJOY_V1_DATABASE_URL="<neon-postgres-url>" \
  pnpm db:migrate:v1:build-sql -- \
  --out /tmp/spoonjoy-v1-migration/import.sql \
  --report-out /tmp/spoonjoy-v1-migration/report.json \
  --replace-target
```

Current verified source report:

- Migrates 42 users, 20 passkeys, 8 OAuth rows, 289 recipes, 1,231 steps, 202 step-output links, 1,802 ingredients, 50 cookbooks, and 230 valid cookbook recipe links.
- Creates 286 `RecipeCover` rows from v1 non-default `Recipe.imageUrl` values with `sourceType='chef-upload'`.
- Skips 85 stale `RecipeInCookbook` rows whose cookbook no longer exists in v1.
- v1 has no shopping-list rows to migrate.
- Auth continuity: GitHub OAuth support preserves the two GitHub-only v1 users after `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set in Cloudflare.

Local isolated D1 rehearsal:

```bash
rm -rf /tmp/spoonjoy-v1-rehearsal-d1
pnpm exec wrangler d1 migrations apply DB --local --persist-to /tmp/spoonjoy-v1-rehearsal-d1
pnpm exec wrangler d1 execute DB --local --persist-to /tmp/spoonjoy-v1-rehearsal-d1 \
  --file /tmp/spoonjoy-v1-migration/import.sql --yes
```

Validation:

- Count all migrated tables and compare with `/tmp/spoonjoy-v1-migration/report.json`.
- Run `PRAGMA foreign_key_check;` and require zero rows.
- Rebuild search with `rebuildSearchIndex(db)` against the rehearsal database and run at least one query such as `tomato`.

Remote backup and import:

```bash
mkdir -p /tmp/spoonjoy-d1-backups
pnpm exec wrangler d1 export DB --remote --output /tmp/spoonjoy-d1-backups/pre-v1-import-$(date -u +%Y%m%dT%H%M%SZ).sql --yes
pnpm exec wrangler d1 execute DB --remote --file /tmp/spoonjoy-v1-migration/import.sql --yes
```

Rollback:

- If the import fails before DNS cutover, restore the pre-import export to D1 or use D1 Time Travel.
- If cutover fails after DNS switch, route `spoonjoy.app` back to v1 first, then restore or repair D1 before retrying.

## DNS And Custom Domain

1. Confirm `spoonjoy.app` is in the Cloudflare zone expected by Wrangler.
2. Add or update the Worker custom domain/route for `spoonjoy.app`.
3. Keep the staging Worker URL available during cutover.
4. Verify `https://spoonjoy.app/manifest.webmanifest`, `https://spoonjoy.app/sw.js`, and `/api/push/public-key`.
5. Verify TLS is active and no redirect loop exists.

## OAuth

Before DNS switch, update provider dashboards:

- Google authorized redirect URI: `https://spoonjoy.app/auth/google/callback`
- GitHub authorization callback URL: `https://spoonjoy.app/auth/github/callback`
- Apple redirect URI: `https://spoonjoy.app/auth/apple/callback`

After DNS switch, test OAuth start routes. If a provider is not configured, it should not appear on `/login` or `/signup`.

## Smoke Test

Run after deploy and again after DNS switch:

- `/` renders.
- `/login` renders and configured auth methods are accurate.
- `/signup` renders and configured auth methods are accurate.
- `/search?q=tomato&scope=all` returns results or an intentional empty state.
- `/users/demo_chef/fellow-chefs` renders.
- `/users/demo_chef/kitchen-visitors` renders.
- Authenticated `/shopping-list` renders and checkoff works.
- Authenticated recipe detail renders.
- Cook mode opens, persists progress across reload, and timers work on timed steps.
- Add-to-shopping-list works from recipe detail.
- Push public key endpoint returns a VAPID key.
- Slugger/Ouro MCP can search, create, update, delete, add to cookbook, list cookbooks, and read the shopping list.

## Rollback

If cutover fails:

1. Move `spoonjoy.app` route/DNS back to v1.
2. Leave the v2 staging Worker URL live for debugging.
3. Do not mutate migrated data further until the failure is understood.
4. If data corruption occurred, restore the pre-cutover D1 snapshot/export.
5. Record the failure, exact Worker version, and rollback time in the release notes.
