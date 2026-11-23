# Self-hosting Spoonjoy

Spoonjoy runs on your own server from one image, `ghcr.io/spoonjoy/spoonjoy`, for amd64 and arm64. It is the same build spoonjoy.app runs, served by Cloudflare's own runtime (workerd, through Miniflare) inside the container, so your server behaves like spoonjoy.app.

```sh
docker run -d --name spoonjoy -p 8080:8080 -v spoonjoy-data:/data ghcr.io/spoonjoy/spoonjoy:latest
```

Then open http://localhost:8080 and sign up.

## What's in the box

- **One volume, `/data`.** The database, photos, cook sessions and the server's session secret live there. Back it up and you have backed up your kitchen.
- **One port, 8080.** Change it with `PORT`.
- **Migrations on start.** Each start brings the database up to date with the image, and records each migration in a `d1_migrations` table as spoonjoy.app does.
- **Analytics are off.** The image sends nothing anywhere. Set `POSTHOG_KEY` (and `POSTHOG_HOST`) only if you want your own PostHog project.
- **A health check.** Docker reports the container healthy once `/health/ready` reaches the database and the photo store.
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
| `SPOONJOY_MODERATOR_USERNAMES` | Comma-separated usernames who may review reports at `/moderation`. | none |
| `SPOONJOY_RATE_LIMIT_<NAME>` | Raises one of the per-minute limits (`AUTH_IP_RATE_LIMITER`, `API_IP_RATE_LIMITER`, `API_TOKEN_RATE_LIMITER`, `INGREDIENT_PARSE_RATE_LIMITER`), for a household that all reaches the server from one address. | spoonjoy.app's |
| `PHOTO_SWEEP_MODE` | `apply` lets the photo cleanup move unused photos aside; `off` stops it. | dry run |
| `POSTHOG_KEY`, `POSTHOG_HOST` | Your own PostHog project, if you want analytics. | off |

Sign in for now works on `http://localhost` or behind HTTPS (set `SPOONJOY_BASE_URL`); plain `http://` on another address is coming with the self-hosted sign-in work.

## Signing in

A new server needs no setup before you sign in:

- **Password.** Sign up at `/signup` with an email, a username and a password.
- **Passkeys.** Add one under Account settings, then sign in with it. Browsers only offer passkeys on an `https://` address or on `localhost`, so reach the server through a reverse proxy, Tailscale or Cloudflare Tunnel to use them from other devices.
- **Sign in with Apple from the Spoonjoy apps.** The server checks the app's Apple identity token against Apple's public keys and the app's bundle ID, so it needs no Apple secret.

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

## How it's checked

The `Self-host Image` workflow (`.github/workflows/self-host-image.yml`) builds the image on amd64 and arm64 runners, times `docker run` to the first page on an empty volume, waits for the health check, signs up, adds a passkey and signs back in on the empty server, checks Sign in with Apple is set up, seeds the QA kitchen through `server.mjs sql` and its sample cover photos through `server.mjs photos`, runs the Journeys sign-in and round-trip smoke set against the container with a screenshot of each test, and checks the kitchen is still there after `docker restart`. Pushes to main publish the image only after both arches pass. Its job summary reports the image size, boot time and memory.

After each green run on main, the `Self-host Pull` workflow (`.github/workflows/self-host-pull.yml`) pulls `ghcr.io/spoonjoy/spoonjoy:latest` with no login on amd64 and arm64, boots it on an empty volume and waits for its health check, the way a self-hoster would.

## Building it yourself

From a checkout, after `pnpm install` and `pnpm run build`:

```sh
docker build -f self-host/Dockerfile -t spoonjoy .
```

The image's Miniflare and workerd are pinned to the versions the app's wrangler uses (`self-host/package.json` and its lockfile; `test/self-host/pins.test.ts` fails when they drift). When wrangler is bumped, bump `self-host/package.json` to wrangler's Miniflare and run `npm install --package-lock-only` in `self-host/`.
