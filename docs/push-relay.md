# Push relay

Notifications on iPhone, iPad and Mac go through Apple's push service (APNs), and only the holder of Apple's push key for the Spoonjoy app can send them. The push relay, `spoonjoy-push-relay` at `https://spoonjoy-push-relay.mendelow-studio.workers.dev`, holds that key, so any Spoonjoy server can notify the Spoonjoy app without holding it: spoonjoy.app uses the relay too, so there is one way notifications reach Apple.

It moves to `https://push.spoonjoy.app` once the spoonjoy.app zone is in production's Cloudflare account: change `RELAY_URL` in [`workers/push-relay/index.ts`](../workers/push-relay/index.ts), add the custom domain route in its `wrangler.json` and keep `workers_dev: true` there (servers set up earlier keep reaching the relay at the old address), then fix the copies of the address the relay's tests point to (the deploy workflow's `RELAY_URL` and this page). Relay keys are signed with the relay's own secret, so servers keep the keys they have.

The code is [`workers/push-relay/index.ts`](../workers/push-relay/index.ts), a Cloudflare Worker, deployed by the [Push Relay Deploy](../.github/workflows/push-relay-deploy.yml) workflow on each change to it on main.

## What it sees and keeps

For each notification the relay sees the server's relay key, the device token and the notification itself (its title and text, and the page it opens). It passes them to Apple and keeps none of them. Its rate limits count by relay key, by a SHA-256 hash of the device token and by IP address, for a minute. Its log lines name the server's id, the environment and Apple's answer; they never hold a token or a payload, and the Worker keeps no invocation logs, which would hold request headers. When a server registers, the log records the server's id and the origin of the address it gave.

Anyone can register, and a relay key can send to any device token its server has. A server only learns a token when someone signs in to it from the Spoonjoy app, so the tokens a server holds are its own users' devices; the relay doesn't check that, and the per-device limit is what stops one server flooding a device.

## How Spoonjoy sends through it

When the Spoonjoy app registers a device (`POST /api/v1/me/apns-devices`), the server keeps the token's hash, as before, and the token itself sealed: encrypted with AES-GCM under a key derived from the server's `SESSION_SECRET`, and bound to that account, device, platform and environment ([`app/lib/native-push-token.server.ts`](../app/lib/native-push-token.server.ts)). Revoking the device drops the sealed token. A device registered before the server kept tokens, or whose token the server can no longer read, gets notifications once they are turned on again in the app's Settings. A notification goes to every live device of the person it's for, if their notification settings allow it, as web push does ([`app/lib/notification-dispatch.server.ts`](../app/lib/notification-dispatch.server.ts)), and a device the relay says to revoke is revoked. While the relay has no Apple push key it answers `503 not_configured`, so Apple gets nothing, and the server reports nothing, until it has one. The server still hands each notification to the relay meanwhile. [`test/lib/native-push-send-path.server.test.ts`](../test/lib/native-push-send-path.server.test.ts) runs this whole path, through the relay's own code to a stubbed Apple, in CI.

A server sends only with a relay key, set as `SPOONJOY_PUSH_RELAY_KEY`; `SPOONJOY_PUSH_RELAY_URL` names another relay, or `off`. Each notification trigger reads the web push (VAPID) settings first, so a server sends to Apple devices only when web push is set up too; spoonjoy.app and self-hosted servers always have it. The iPhone, iPad and Mac app share one bundle id, so every send goes to the relay's one topic.

- spoonjoy.app gets its key from the [Production Push Relay Key](../.github/workflows/production-push-relay-key.yml) workflow, which registers `https://spoonjoy.app` and stores the key as a Worker secret in a version tagged like production's own, so Production Deploy accepts it. It does nothing when production has the key already.
- A self-hosted server registers itself on its first start and keeps its key in `/data/push-relay.json` ([`self-host/push-relay.mjs`](../self-host/push-relay.mjs), [Self-hosting](self-hosting.md#notifications-on-apple-devices)).

## Endpoints

### `GET /health`

```json
{ "ok": true, "service": "spoonjoy-push-relay", "apns": "configured", "registration": "open" }
```

`apns` is `not configured` until Apple's key is set; `registration` is `not configured` until the relay's own key secret is.

### `POST /v1/servers`

A server registers once and keeps the key it gets back.

```json
{ "baseUrl": "https://recipes.example.com" }
```

answers `201` with `{ "serverId": "…", "relayKey": "sjr1.…" }`. Five registrations a minute per IP address. A relay key is the server's id signed with the relay's secret, so the relay stores nothing to check it.

### `POST /v1/send`

With `Authorization: Bearer <relay key>`:

```json
{
  "token": "<device token, hex>",
  "environment": "production",
  "payload": { "aps": { "alert": { "title": "Spoonjoy", "body": "@ada cooked your soup" } }, "url": "/recipes/abc" },
  "collapseId": "<at most 64 bytes, optional>",
  "pushType": "alert",
  "expiration": 1800000000
}
```

`environment` is `development` (Apple's sandbox, for apps built from Xcode) or `production` (TestFlight and the App Store). `pushType` is `alert` (the default) or `background`. The payload is at most 4096 bytes, Apple's limit. When Apple answers, the relay answers `200` with Apple's status:

```json
{ "status": 410, "reason": "Unregistered", "apnsId": "…", "revoke": true }
```

`revoke: true` means the token will never work for the app again (Apple's 410 `Unregistered`, or 400 `DeviceTokenNotForTopic`), so the server stops sending to that device. A 400 `BadDeviceToken` doesn't revoke: Apple gives it for a good token sent to the other environment too.

The relay's own refusals:

| Status | `error` | Why |
| --- | --- | --- |
| 400 | `invalid_request` | The body isn't one of the shapes above; `message` says which field. |
| 401 | `unauthorized` | No relay key, or one the relay didn't issue. |
| 403 | `revoked` | The server's id is in `REVOKED_SERVER_IDS`. |
| 429 | `rate_limited` | More than 600 sends a minute for one relay key, 30 a minute to one device, or 5 registrations a minute from one address. Cloudflare counts these at each of its locations separately, so they are limits per location, not exact totals. |
| 502 | `apns_unreachable` | Apple didn't answer within 10 seconds. |
| 503 | `not_configured` | The relay has no Apple key yet (sending), or no key secret (registering). |
| 503 | `misconfigured` | The relay's Apple key is set but can't be read as a P-256 key. |

## Settings

| Name | Kind | What it is |
| --- | --- | --- |
| `APNS_TOPIC` | var | The app's bundle id, `app.spoonjoy` (the iPhone, iPad and Mac app share it). |
| `APNS_TEAM_ID` | var | Apple developer team `743GT2AJ24`. |
| `APNS_KEY_P8` | secret | Apple's APNs auth key, the `.p8` file's text. |
| `APNS_KEY_ID` | secret | That key's id. |
| `RELAY_KEY_SECRET` | secret | Signs relay keys. The deploy workflow makes it once; changing it voids every relay key. |
| `REVOKED_SERVER_IDS` | var | Server ids, separated by commas, whose keys are refused. |

The relay signs Apple's provider token (ES256) with WebCrypto. Apple refuses a token older than an hour, and a key's tokens renewed more often than every 20 minutes, so every instance of the relay dates its token to the start of the same 30-minute window and reuses it until the window ends. A refusal of the relay's own token (`InvalidProviderToken`, `ExpiredProviderToken`, `TooManyProviderTokenUpdates`) is logged as `provider-token-refused`. A Worker's `fetch` reaches Apple's HTTP/2-only hosts: a probe Worker's request to both hosts with a made-up provider token got Apple's own `403 {"reason":"InvalidProviderToken"}` with an `apns-id` header ([run 45869319846](https://github.com/spoonjoy/spoonjoy-v2/actions/runs/45869319846)).

## Setting Apple's key

Store the key as GitHub production environment secrets, then run the deploy workflow, which copies them into the relay and checks that Apple takes the key (a send to a made-up token must come back `400 BadDeviceToken` from both of Apple's hosts):

```sh
gh secret set APNS_KEY_P8 --env production --repo spoonjoy/spoonjoy-v2 < AuthKey_XXXXXXXXXX.p8
gh secret set APNS_KEY_ID --env production --repo spoonjoy/spoonjoy-v2 --body XXXXXXXXXX
gh workflow run push-relay-deploy.yml --repo spoonjoy/spoonjoy-v2 --ref main
curl -s https://spoonjoy-push-relay.mendelow-studio.workers.dev/health   # "apns": "configured"
```

To revoke a server's key, add its id (from the relay's registration log) to `REVOKED_SERVER_IDS` in [`workers/push-relay/wrangler.json`](../workers/push-relay/wrangler.json) and merge.
