# Self-hosting Spoonjoy

Spoonjoy runs on your own server from one image, `ghcr.io/spoonjoy/spoonjoy`, for amd64 and arm64. It is the same build spoonjoy.app runs, served by Cloudflare's own runtime (workerd, through Miniflare) inside the container, so your server behaves like spoonjoy.app.

```sh
docker run -d --name spoonjoy -p 8080:8080 -v spoonjoy-data:/data ghcr.io/spoonjoy/spoonjoy:latest
```

Then open http://localhost:8080 and sign up.

With Docker Compose, save [`self-host/compose.yaml`](../self-host/compose.yaml) and run `docker compose up -d` beside it. It keeps the data in a named volume, restarts the server unless you stop it, and reads `SPOONJOY_BASE_URL` and `SPOONJOY_PORT` from your shell or a `.env` file beside it.

## What's in the box

- **One volume, `/data`.** The database, photos, cook sessions and the server's session secret live there.
- **Backups every day.** The server backs up its database and photos to one file in `/data/backups` every day, and keeps the last seven. See [Backups](#backups).
- **One port, 8080.** Change it with `PORT`.
- **Migrations on start.** Each start brings the database up to date with the image, and records each migration in a `d1_migrations` table as spoonjoy.app does.
- **Analytics are off.** The image sends nothing anywhere. Set `POSTHOG_KEY` (and `POSTHOG_HOST`) only if you want your own PostHog project.
- **A health check.** Docker reports the container healthy once `/health/ready` reaches the database and the photo store.
- **Background jobs** (work that carries on after you close the page) run inside the server, one at a time. They wait in memory: one still waiting when the server stops is dropped, and can be started again a day later.
- **The scheduled photo cleanup** runs on its spoonjoy.app schedule (every six hours), as a dry run unless you set `PHOTO_SWEEP_MODE=apply`.
- **Tags.** `latest` follows main; each build also has a version tag, the commit's date and short hash (for example `2026.11.22-1a2b3c4`), for pinning.

The image runs as the unprivileged `node` user (uid 1000). A named volume needs nothing more; a folder on the host needs to be writable by uid 1000 (`chown 1000:1000 <folder>`).

## Settings

| Setting | What it does | Default |
| --- | --- | --- |
| `SPOONJOY_BASE_URL` | The address people use. Set it to your `https://` address behind a reverse proxy, so session cookies are marked Secure and links point at the right place. On a plain `http://` address, such as `http://192.168.1.20:8080` on a home network, set it to that address so password sign-in works there. | `http://localhost:8080` |
| `APPLE_NATIVE_CLIENT_IDS` | The app bundle IDs whose Sign in with Apple the server accepts. | `app.spoonjoy,app.spoonjoy.mac` |
| `PORT` | The port the server listens on inside the container. | `8080` |
| `SESSION_SECRET` | Signs sign-in cookies. Leave it unset and the server makes one and keeps it in `/data`. | generated |
| `OPENAI_API_KEY`, `GEMINI_API_KEY` | AI features (ingredient parsing, covers). Without one, ingredient parsing uses the built-in parser. | none |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push notifications in the browser. Leave the keys unset and the server makes its own pair and keeps it in `/data/push-keys.json`. The subject is your `https://` address, or `mailto:owner@<host>` on plain `http://`. A server restored into a new `/data` makes new keys, so browsers turn notifications on again there. | generated |
| `SPOONJOY_SIGNUPS` | `open` lets anyone who reaches the server sign up; `invite` lets only people with an invite link. Set, it overrides the switch in Server settings. | the switch, invite-only at first |
| `SPOONJOY_MODERATOR_USERNAMES` | Comma-separated usernames who may review reports at `/moderation`, besides the server's admin. | none |
| `SPOONJOY_RATE_LIMIT_<NAME>` | Raises one of the per-minute limits (`AUTH_IP_RATE_LIMITER`, `API_IP_RATE_LIMITER`, `API_TOKEN_RATE_LIMITER`, `INGREDIENT_PARSE_RATE_LIMITER`), for a household that all reaches the server from one address. | spoonjoy.app's |
| `SPOONJOY_BACKUP_SCHEDULE` | When the server backs itself up: a cron expression in UTC, or `off`. | `17 3 * * *` (03:17 every day) |
| `SPOONJOY_BACKUPS_KEPT` | How many scheduled backups to keep. Older ones are deleted; backups you make yourself are kept. | `7` |
| `SPOONJOY_BACKUP_DIR` | The folder backups go in. Point it at a second volume to keep them off the data disk. | `/data/backups` |
| `PHOTO_SWEEP_MODE` | `apply` lets the photo cleanup move unused photos aside; `off` stops it. | dry run |
| `POSTHOG_KEY`, `POSTHOG_HOST` | Your own PostHog project, if you want analytics. | off |

Sign in for now works on `http://localhost` or behind HTTPS (set `SPOONJOY_BASE_URL`); plain `http://` on another address is coming with the self-hosted sign-in work.

## Signing in

A new server needs no setup before you sign in:

- **Password.** Sign up at `/signup` with an email, a username and a password.
- **Passkeys.** Add one under Account settings, then sign in with it. Browsers only offer passkeys on an `https://` address or on `localhost`, so reach the server through a reverse proxy, Tailscale or Cloudflare Tunnel to use them from other devices.
- **Sign in with Apple from the Spoonjoy apps.** The server checks the app's Apple identity token against Apple's public keys and the app's bundle ID, so it needs no Apple secret.

## Signing in with your own identity provider

If you already run an OpenID Connect provider, such as Authentik, Authelia or Keycloak, people can sign in to Spoonjoy with it. Register Spoonjoy there as a confidential client with this redirect (callback) URL:

```
<SPOONJOY_BASE_URL>/auth/oidc/callback
```

For example `https://recipes.example.com/auth/oidc/callback`. Then give the container these settings:

| Setting | What it does | Default |
| --- | --- | --- |
| `SPOONJOY_OIDC_ISSUER` | The provider's issuer address. Spoonjoy reads `<issuer>/.well-known/openid-configuration` to find the rest. | none |
| `SPOONJOY_OIDC_CLIENT_ID` | The client ID the provider gave Spoonjoy. | none |
| `SPOONJOY_OIDC_CLIENT_SECRET` | The client secret the provider gave Spoonjoy. | none |
| `SPOONJOY_OIDC_NAME` | The sign-in button's label, such as `Sign in with Authentik`. | `Continue with single sign-on` |
| `SPOONJOY_OIDC_SCOPES` | The scopes Spoonjoy asks for, separated by spaces. `openid` is always added. | `openid email profile` |

With the first three set, the button shows on the sign-in and sign-up pages. Sign-in uses the authorization-code flow with PKCE, and Spoonjoy checks the ID token's signature against the provider's published keys, along with its issuer, audience, expiry and nonce.

The first time someone signs in, Spoonjoy makes them an account from the provider's email address. If an account with that email already exists, it is joined only when the provider says the email is verified and the account's owner has verified it in Spoonjoy too; otherwise they sign in the way they usually do. Accounts are linked to the issuer, so pointing `SPOONJOY_OIDC_ISSUER` at another provider later doesn't sign anyone in to an account made through the old one.

The provider's sign-in needs the server on an `https://` address or on `localhost`.

## Who can sign up

The first account made on a new server is its admin. After that the server is invite-only, so someone who finds it on the internet can't make an account.

- **Server settings.** The admin finds them under Account settings, at `/account/server`. **Open sign-ups** lets anyone sign up; **Make invite-only** turns that off again. People who already have an account always sign in.
- **Invite links.** **Make an invite link** shows a link to copy once. It signs up one account at `/signup?invite=…` and stops working after it's used, after seven days, or when the admin revokes it. Spoonjoy keeps only a hash of it. An invite signs up with a password or with any sign-in provider the server offers, including your own OpenID Connect provider; the invite page shows those buttons and passes the invite through the provider's sign-in.
- **Everything else is refused.** While the server is invite-only, a new account through a password, Google, GitHub, your OpenID Connect provider, or Apple on the web or in the apps is refused with "This server is invite-only. Ask its owner for an invite link."
- **Moderation.** The admin can review reports at `/moderation`.

If the admin's account is deleted, the oldest remaining account becomes admin.

## Running SQL

`server.mjs sql` runs a SQL file against the database, whole or not at all, after bringing it up to date. Stop the server first:

```sh
docker stop spoonjoy
docker run --rm -i -v spoonjoy-data:/data ghcr.io/spoonjoy/spoonjoy:latest node /app/self-host/server.mjs sql - < changes.sql
docker start spoonjoy
```

`server.mjs photos <folder> [prefix]` puts each JPEG, PNG or WebP image in a folder into the photo store, under the prefix you give. Stop the server for this too:

```sh
docker run --rm -v spoonjoy-data:/data -v "$PWD/photos:/photos:ro" ghcr.io/spoonjoy/spoonjoy:latest node /app/self-host/server.mjs photos /photos
```

## Backups

A backup is one `.tar.gz` file holding the whole database and every photo. It leaves out the search index, which the server rebuilds on the first search after a restore, cook sessions in progress, and the session secret, so a backup can't sign anyone in. Everyone signs in again after a restore onto a new server.

The server makes one on its schedule while it runs (`SPOONJOY_BACKUP_SCHEDULE`), named `spoonjoy-auto-<time>.tar.gz`, and keeps the last `SPOONJOY_BACKUPS_KEPT`. A backup in the data volume is lost with the disk, so copy the backups somewhere else, or mount a second volume and set `SPOONJOY_BACKUP_DIR` to it:

```sh
docker run -d --name spoonjoy -p 8080:8080 -v spoonjoy-data:/data -v /mnt/nas/spoonjoy:/backups -e SPOONJOY_BACKUP_DIR=/backups ghcr.io/spoonjoy/spoonjoy:latest
```

The admin sees the backups under **Server settings**, at `/account/server`: they can back up now, download any backup, and restore one. A restore asks first, saves what's there as a backup, then puts the server back as it was when that backup was made, while it keeps running.

To make one from the command line, stop the server and run `server.mjs backup`, which writes `spoonjoy-manual-<time>.tar.gz` in the backups folder, or to the file you name:

```sh
docker stop spoonjoy
docker run --rm -v spoonjoy-data:/data -v "$PWD:/out" ghcr.io/spoonjoy/spoonjoy:latest node /app/self-host/server.mjs backup /out/kitchen.tar.gz
docker start spoonjoy
```

`server.mjs restore <file>` replaces the kitchen with a backup's, then brings it up to date with the image, so a backup restores into the same version or a newer one. A backup from a newer image is refused until you update. If the server already has accounts, it first saves what's there as `spoonjoy-before-restore-<time>.tar.gz`. Stop the server first. To move a kitchen to a new server:

```sh
docker run --rm -v spoonjoy-data:/data -v "$PWD:/in:ro" ghcr.io/spoonjoy/spoonjoy:latest node /app/self-host/server.mjs restore /in/kitchen.tar.gz
docker run -d --name spoonjoy -p 8080:8080 -v spoonjoy-data:/data ghcr.io/spoonjoy/spoonjoy:latest
```

The container runs as uid 1000, so a host folder it writes a backup into needs to be writable by that user.

## How it's checked

The `Self-host Image` workflow (`.github/workflows/self-host-image.yml`) builds the image on amd64 and arm64 runners, times `docker run` to the first page on an empty volume, waits for the health check, signs up, adds a passkey and signs back in on the empty server, checks the first account is the admin, that a stranger is refused once sign-ups are off and that an invite link signs up one person and then stops working, checks Sign in with Apple is set up, signs in through a Dex OpenID Connect provider, seeds the QA kitchen through `server.mjs sql` and its sample cover photos through `server.mjs photos`, runs the Journeys sign-in and round-trip smoke set against the container with a screenshot of each test, checks the kitchen is still there after `docker restart`, and backs it up with `server.mjs backup`, restores the backup into a second, empty volume and checks the restored server shows a recipe and its photo, byte for byte, and makes its own scheduled backup. On the fresh server, the admin backs up from Server settings, downloads the backup, and restores it. Then a fresh server with move-in on moves a small kitchen in, which runs as jobs on the server's own queue, and the server's job records show those jobs done. Then it starts the image with `self-host/compose.yaml` and waits for Compose to report it healthy. Pushes to main publish the image only after both arches pass. Its job summary reports the image size, boot time and memory.

After each green run on main, the `Self-host Pull` workflow (`.github/workflows/self-host-pull.yml`) pulls `ghcr.io/spoonjoy/spoonjoy:latest` with no login on amd64 and arm64, boots it on an empty volume and waits for its health check, the way a self-hoster would.

## Building it yourself

From a checkout, after `pnpm install` and `pnpm run build`:

```sh
docker build -f self-host/Dockerfile -t spoonjoy .
```

The image's Miniflare and workerd are pinned to the versions the app's wrangler uses (`self-host/package.json` and its lockfile; `test/self-host/pins.test.ts` fails when they drift). When wrangler is bumped, bump `self-host/package.json` to wrangler's Miniflare and run `npm install --package-lock-only` in `self-host/`.
