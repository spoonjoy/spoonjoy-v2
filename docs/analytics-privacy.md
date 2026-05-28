# Analytics And Privacy

Spoonjoy uses optional PostHog analytics for product usage signals (client) and free-tier error tracking (client + server). All capture paths are disabled by default in local development and in any environment without the PostHog key configured.

## Configuration

### Client (public Vite build-time variables)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_POSTHOG_KEY` | No | Enables client PostHog when present and non-blank. Missing or blank values keep client analytics disabled. |
| `VITE_POSTHOG_HOST` | No | Overrides the PostHog ingestion host. Defaults to `https://us.i.posthog.com`. |
| `VITE_POSTHOG_DISABLED` | No | Force-disables client PostHog when set to `1`, `true`, `yes`, or `on`. Useful for privacy-sensitive previews and local smoke tests. |

These variables are public Vite client variables baked into the bundle at build time. Do not put secrets in them.

### Server (Cloudflare Worker runtime env)

| Variable | Required | Purpose |
| --- | --- | --- |
| `POSTHOG_KEY` | No | Enables server-side error capture when present and non-blank. Set via `wrangler secret put POSTHOG_KEY` in production, or in `.dev.vars` locally. |
| `POSTHOG_HOST` | No | Overrides the PostHog ingestion host. Defaults to `https://us.i.posthog.com`. |
| `POSTHOG_DISABLED` | No | Force-disables server PostHog when set to `1`, `true`, `yes`, or `on`. |

The PostHog project API key is safe to use for both client and server capture — it's a write-only ingestion key, not a personal API token. Use the same key value for `VITE_POSTHOG_KEY` and `POSTHOG_KEY`.

## Local And Preview Behavior

Basic local development does not need analytics configuration. If `VITE_POSTHOG_KEY` is absent, the app still renders normally and does not initialize PostHog.

Set `VITE_POSTHOG_DISABLED=true` when you need to verify a production-like environment while guaranteeing analytics and session recording stay off.

## Payload Review

Current analytics events are intentionally limited to product telemetry:

| Surface | Event data |
| --- | --- |
| Route changes | Page URL origin and pathname only; query strings and hashes are not sent. |
| Logged-in sessions | Internal Spoonjoy user id through PostHog `identify`; no email or username. |
| Recipe detail | Recipe id, chef id, step counts, owner status, time-on-page, scale factor, checklist ids/counts, share method/success, cookbook ids, and shopping-list source. |

User-entered free text, including recipe titles, cookbook titles, recipe descriptions, ingredient names, and shopping-list item names, should not be added to analytics payloads without a fresh privacy review.

## Error Tracking

Error tracking uses PostHog's free-tier `$exception` event type. Two capture paths are wired:

| Source | Trigger | Payload |
| --- | --- | --- |
| Client | `posthog-js` `capture_exceptions: true` auto-captures unhandled errors and unhandled promise rejections. | PostHog auto-collects error name/message/stack; PostHog distinct id is the visitor or `identify`-ed user. |
| Server (Worker) | `app/entry.server.tsx` `onError` and `workers/app.ts` outer try/catch call `captureException`. | `$exception_type`, `$exception_message`, `$exception_stack_trace_raw`, `route` (origin pathname), `method` (HTTP method), `distinct_id: "server"`. |

Server-side capture never includes request bodies, cookies, headers, query strings, or hash fragments. Capture failures (PostHog outage) are swallowed so they cannot affect the request response.

## Session Recording

When analytics is enabled, PostHog session recording is configured to mask all text and all form inputs:

- `maskTextSelector: "*"`
- `maskAllInputs: true`

This is a defense-in-depth measure, not permission to send sensitive content in explicit event payloads. Event payloads should still use ids, counts, booleans, and controlled enum-like values.
