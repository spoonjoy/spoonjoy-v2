# Self-hosting Spoonjoy

Spoonjoy runs on your own server from one image, `ghcr.io/spoonjoy/spoonjoy`, for amd64 and arm64. It is the same build spoonjoy.app runs, served by Cloudflare's own runtime (workerd, through Miniflare) inside the container, so your server behaves like spoonjoy.app.

```sh
docker run -d --name spoonjoy -p 8080:8080 -v spoonjoy-data:/data ghcr.io/spoonjoy/spoonjoy:latest
```

Then open http://localhost:8080 and sign up.

With Docker Compose, save [`self-host/compose.yaml`](../self-host/compose.yaml) and run `docker compose up -d` beside it. It keeps the data in a named volume, restarts the server unless you stop it, and reads `SPOONJOY_BASE_URL` and `SPOONJOY_PORT` from your shell or a `.env` file beside it.

**For now, Compose builds Spoonjoy from source.** The published image isn't open to everyone yet: pulling `ghcr.io/spoonjoy/spoonjoy` without signing in to GitHub is refused, so the `docker run` line above works only for people who can sign in to the package. Until it opens, `self-host/compose.yaml` builds the image from Spoonjoy's public repository (the `main` branch, through [`self-host/Dockerfile.source`](../self-host/Dockerfile.source)) the first time it starts. That needs no sign-in and takes a few minutes; the `build from source` job in the Self-host Image workflow builds it on every change and reports its time and the memory it takes. Then it starts as fast as the published image. The published image's line is in the file, commented out, ready to take over from the `image:` line and the `build:` block below it.

While Compose builds from source, the `docker run` commands in this guide (running SQL, adding photos, backing up and restoring) need the image Compose built: type `spoonjoy-source` where they say `ghcr.io/spoonjoy/spoonjoy:latest`.

## What's in the box

- **One volume, `/data`.** The database, photos, cook sessions and the server's session secret live there.
- **Backups every day.** The server backs up its database and photos to one file in `/data/backups` every day, and keeps the last seven. See [Backups](#backups).
- **One port, 8080.** Change it with `PORT`.
- **Migrations on start.** Each start brings the database up to date with the image, and records each migration in a `d1_migrations` table as spoonjoy.app does.
- **Analytics are off.** The image sends no analytics. Set `POSTHOG_KEY` (and `POSTHOG_HOST`) only if you want your own PostHog project.
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
| `OPENAI_API_KEY`, `GEMINI_API_KEY` | AI features (ingredient parsing, covers) until the admin picks AI under Server settings. Without one, ingredient parsing uses the built-in parser. | none |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push notifications in the browser. Leave the keys unset and the server makes its own pair and keeps it in `/data/push-keys.json`. The subject is your `https://` address, or `mailto:owner@<host>` on plain `http://`. A server restored into a new `/data` makes new keys, so browsers turn notifications on again there. | generated |
| `SPOONJOY_PUSH_RELAY_URL` | The push relay that sends notifications to the Spoonjoy iPhone, iPad and Mac app, or `off` to send to browsers only. See [Notifications on Apple devices](#notifications-on-apple-devices). | `https://spoonjoy-push-relay.mendelow-studio.workers.dev` |
| `SPOONJOY_PUSH_RELAY_KEY` | This server's key for that relay. Leave it unset and the server registers itself on its first start and keeps the key in `/data/push-relay.json`. | generated |
| `SPOONJOY_SIGNUPS` | `open` lets anyone who reaches the server sign up; `invite` lets only people with an invite link. Set, it overrides the switch in Server settings. | the switch, invite-only at first |
| `SPOONJOY_MODERATOR_USERNAMES` | Comma-separated usernames who may review reports at `/moderation`, besides the server's admin. | none |
| `SPOONJOY_RATE_LIMIT_<NAME>` | Raises one of the per-minute limits (`AUTH_IP_RATE_LIMITER`, `API_IP_RATE_LIMITER`, `API_TOKEN_RATE_LIMITER`, `INGREDIENT_PARSE_RATE_LIMITER`), for a household that all reaches the server from one address. | spoonjoy.app's |
| `SPOONJOY_BACKUP_SCHEDULE` | When the server backs itself up: a cron expression in UTC, or `off`. | `17 3 * * *` (03:17 every day) |
| `SPOONJOY_BACKUPS_KEPT` | How many scheduled backups to keep. Older ones are deleted; backups you make yourself are kept. | `7` |
| `SPOONJOY_BACKUP_DIR` | The folder backups go in. Point it at a second volume to keep them off the data disk. | `/data/backups` |
| `PHOTO_SWEEP_MODE` | `apply` lets the photo cleanup move unused photos aside; `off` stops it. | dry run |
| `POSTHOG_KEY`, `POSTHOG_HOST` | Your own PostHog project, if you want analytics. | off |

Set `SPOONJOY_BASE_URL` to the address people open, such as `http://192.168.1.20:8080` on a home network or `https://recipes.example.com` behind HTTPS. Sign-in works at that address over plain `http://` too. Passkeys need HTTPS or `localhost`, because browsers offer them nowhere else, so on a plain `http://` network address people sign in with a password.

## Notifications on Apple devices

Notifications on iPhone, iPad and Mac go through the Spoonjoy push relay at `https://spoonjoy-push-relay.mendelow-studio.workers.dev`. For each notification it sees the device's token, the notification's title, text and page, and your server's IP address; when the server registers, it sees the server's address, and logs its origin. It keeps no tokens or notifications ([what it sees and keeps](push-relay.md#what-it-sees-and-keeps)). Only the holder of Apple's push key for the Spoonjoy app can reach those devices, so your server hands each notification to the relay, which passes it to Apple and keeps nothing. How the relay works, and exactly what it sees: [Push relay](push-relay.md).

- On its first start the server registers itself with the relay and keeps its key in `/data/push-relay.json`, readable only by the server. If the relay can't be reached then, the server starts anyway and tries again on its next start; until it has a key, notifications go to browsers only.
- The start that registers logs `push-relay-registered` with the relay's address. `SPOONJOY_PUSH_RELAY_URL=off` keeps the server from contacting the relay at all. Browser notifications (web push) never go through it.
- The app registers each signed-in device's push token with your server, which keeps it encrypted under the server's session secret. Under a new `SESSION_SECRET` the server can't read the tokens it has: it drops each one the first time it tries it, and a device gets no notifications until notifications are turned on again in the app's Settings, which registers it again. A backup holds the encrypted tokens but not the session secret, so a server restored from one under a new secret drops them the same way.
- If the relay stops taking the server's key (it was revoked, or the relay's own secret changed), delete `/data/push-relay.json` and restart: the server registers again.

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

## Mail

Spoonjoy sends password resets, email address changes and household invites by email. Point the server at an SMTP server you can send through, such as your mail provider's or a relay on your network:

| Setting | What it does | Default |
| --- | --- | --- |
| `SPOONJOY_SMTP_HOST` | The SMTP server. Mail is off without it. | none |
| `SPOONJOY_SMTP_PORT` | Its port. | `587`, or `465` with `tls` |
| `SPOONJOY_SMTP_SECURITY` | `starttls` upgrades the connection to TLS and refuses to send without it; `tls` uses TLS from the start; `none` sends plain, for a relay on the same machine or network. | `starttls` |
| `SPOONJOY_SMTP_USERNAME`, `SPOONJOY_SMTP_PASSWORD` | The account to sign in with, if the SMTP server asks for one. Many providers want an app password here. | none |
| `SPOONJOY_EMAIL_FROM` | The From address, such as `Spoonjoy <kitchen@example.com>`. Required with `SPOONJOY_SMTP_HOST`; use one your SMTP server lets you send from. | none |

The server checks these when it starts and stops with a message naming the one to fix. The SMTP settings stay with the server around the app, so the app itself never sees the password. The server's log records `mail-sent` for each message, or `mail-failed` with the SMTP error's code (such as `EAUTH` for a wrong password), and never the address. Links in the mail point at `SPOONJOY_BASE_URL`, so set it to the address people use.

Without mail, **Forgot password** says reset by email isn't available, and people who forget their password sign in another way and set a new one under Account settings.

## AI

AI reads ingredients and imported recipes, and draws recipe covers. Under **Server settings**, the admin picks OpenAI or Gemini and pastes that provider's API key, or picks **No AI**. The pick wins over `OPENAI_API_KEY` and `GEMINI_API_KEY`, and takes effect on the next request. The key is kept in the server's database, so it's in its backups too. With no AI, ingredients are read by the built-in parser and recipes get no drawn covers.

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

## Moving your kitchen

A cook moves their recipes between spoonjoy.app and a self-hosted Spoonjoy, either way, on the Move in page (`/move-in`) of the Spoonjoy they're moving to. Each recipe comes over with its steps, ingredients, step times, which steps use another's output, tags, categories, tools and cover photo, and lands private. Nothing changes on the Spoonjoy they're leaving. Cookbooks, the shopping list and cooks stay behind.

1. On the Spoonjoy you're leaving, sign in and open **Account settings**. Under **API and app access**, choose **Moving my kitchen to another Spoonjoy** and select **Make token**. Copy the `sj_...` token it shows: it reads your account and kitchen, changes nothing, and works for 7 days.
2. On the Spoonjoy you're moving to, open `/move-in`, pick **Another Spoonjoy**, and paste the other Spoonjoy's address (`https://spoonjoy.app`, or your server's) and the token.

The move-in reads the other Spoonjoy's account export (`GET /api/v1/me/export`) and each recipe's photo, so that Spoonjoy has to open at an `https://` address from anywhere on the internet: a server that only opens at home can't be read from spoonjoy.app. Moving the same kitchen in again from the same Spoonjoy brings only what's new or changed there, since each recipe is known by its id on that Spoonjoy. A kitchen can also move back: each Spoonjoy's export says where its recipes moved in from, so a recipe that started on the Spoonjoy you're moving back to comes back as the recipe it started as, not a second copy. Its name, description, steps and ingredients change to the other Spoonjoy's version if you changed them only there, and stay as they are if you changed them on both; it keeps the cover photo it has here, and gains any tags, categories or tools it got there, losing none. A Spoonjoy knows itself by its `SPOONJOY_BASE_URL`, so on your own server set that to the address you gave the other Spoonjoy. Giving a Spoonjoy its own address, or a token for your own account on it, is refused, since your kitchen is already there. Delete the token on the old Spoonjoy once the move is done.

The Move in page is behind the `move_in` flag. On your own server, start it with `SPOONJOY_FLAGS=move_in` (or add `move_in` to the flags you already set). On spoonjoy.app it is not on for everyone yet.

## Updating

Your kitchen lives in the data volume, so updating swaps only the image. With Docker Compose, beside your `compose.yaml`, build it again from the newest source and start it:

```sh
docker compose build && docker compose up -d
```

Once the Compose file uses the published image again, updating is `docker compose pull && docker compose up -d`.

With `docker run`, pull the new image, then remove the container and start it again on the same volume:

```sh
docker pull ghcr.io/spoonjoy/spoonjoy:latest
docker rm -f spoonjoy
docker run -d --name spoonjoy -p 8080:8080 -v spoonjoy-data:/data ghcr.io/spoonjoy/spoonjoy:latest
```

The new image brings the database up to date when it starts, and its log's `ready` line says how many changes it applied (`migrationsRun`). Accounts, recipes, photos and Server settings stay as they were. Make a backup first (see Backups): going back to an older image means restoring that backup with it.

## How it's checked

The `Self-host Image` workflow (`.github/workflows/self-host-image.yml`) builds the image on amd64 and arm64 runners, times `docker run` to the first page on an empty volume, waits for the health check, signs up, adds a passkey and signs back in on the empty server, checks the first account is the admin, that a stranger is refused once sign-ups are off and that an invite link signs up one person and then stops working, checks Sign in with Apple is set up, signs in through a Dex OpenID Connect provider, seeds the QA kitchen through `server.mjs sql` and its sample cover photos through `server.mjs photos`, runs the Journeys sign-in and round-trip smoke set against the container with a screenshot of each test, checks the kitchen is still there after `docker restart`, and backs it up with `server.mjs backup`, restores the backup into a second, empty volume and checks the restored server shows a recipe and its photo, byte for byte, and makes its own scheduled backup. On the fresh server, the admin picks Gemini with a made-up key and then turns AI off, and backs up from Server settings, downloads the backup, and restores it. Then a fresh server with move-in on moves a small kitchen in, which runs as jobs on the server's own queue, and the server's job records show those jobs done. A fresh server sends a password reset through a Mailpit SMTP server, with its text and HTML parts as alternatives, and the cook follows the link in the caught mail and signs in with the new password. Then it starts the image with `self-host/compose.yaml` and waits for Compose to report it healthy. Then a cook starts moving a 500-recipe kitchen in and leaves, the server restarts in the middle of it, and the move-in finishes with no page open. Then a server declared at a plain `http://` network address, not `localhost`, is signed up to, signed out of and signed back in to there with a password, and stays signed in after a reload. Then it updates a server the way this guide does: Compose starts the last published image, its owner adds a recipe and opens sign-ups, Compose moves to the new image on the same volume, every migration is applied on start, and the owner signs back in to the same recipe and setting. Pushes to main publish the image only after both arches pass. Its job summary reports the image size, boot time and memory.

After each green run on main, the `Self-host Pull` workflow (`.github/workflows/self-host-pull.yml`) pulls `ghcr.io/spoonjoy/spoonjoy:latest` with no login on amd64 and arm64, boots it on an empty volume and waits for its health check, the way a self-hoster would.

## Building it yourself

From a checkout, after `pnpm install` and `pnpm run build`:

```sh
docker build -f self-host/Dockerfile -t spoonjoy .
```

The image's Miniflare and workerd are pinned to the versions the app's wrangler uses (`self-host/package.json` and its lockfile; `test/self-host/pins.test.ts` fails when they drift). When wrangler is bumped, bump `self-host/package.json` to wrangler's Miniflare and run `npm install --package-lock-only` in `self-host/`.
