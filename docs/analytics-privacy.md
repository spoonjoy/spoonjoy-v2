# Analytics And Privacy

Spoonjoy uses optional PostHog analytics for product usage signals, API lifecycle telemetry, developer docs/playground UX telemetry, and free-tier error tracking. All capture paths are disabled by default in local development and in any environment without the relevant PostHog key configured.

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
| `POSTHOG_KEY` | No | Enables server-side lifecycle telemetry and error capture when present and non-blank. Set via `wrangler secret put POSTHOG_KEY` in production, or in `.dev.vars` locally. |
| `POSTHOG_HOST` | No | Overrides the PostHog ingestion host. Defaults to `https://us.i.posthog.com`. |
| `POSTHOG_DISABLED` | No | Force-disables server PostHog when set to `1`, `true`, `yes`, or `on`. |

The PostHog project API key is safe to use for both client and server capture — it's a write-only ingestion key, not a personal API token. Use the same key value for `VITE_POSTHOG_KEY` and `POSTHOG_KEY`.

## Local And Preview Behavior

Basic local development does not need analytics configuration. If `VITE_POSTHOG_KEY` is absent, the app still renders normally and does not initialize PostHog.

Set `VITE_POSTHOG_DISABLED=true` when you need to verify a production-like environment while guaranteeing analytics and session recording stay off.

## Lifecycle Events

Current analytics events are intentionally limited to controlled product, API, OAuth, MCP, and developer-experience telemetry:

| Surface | Event names | Event data |
| --- | --- | --- |
| Route changes | `$pageview` | Page URL origin and pathname only; query strings and hashes are not sent. |
| Logged-in sessions | PostHog `identify` | Internal Spoonjoy user id only; no email or username. |
| Recipe detail | `spoonjoy.recipe.*` | Recipe id, chef id, step counts, owner status, time-on-page, scale factor, checklist ids/counts, share method/success, cookbook ids, and shopping-list source. |
| Public and authenticated API v1 | `spoonjoy.api_v1.request` | Route template, operation/resource names, method, status/error class, auth mode/source, principal id, credential id, OAuth client/resource ids, scopes, idempotency class, latency, request byte count, cache/privacy class, request id, origin/referrer host when safe, and coarse user-agent family. |
| Legacy API routes | `spoonjoy.legacy_api.request` | Controlled operation name, route template, method, status/error class, auth/source metadata when known, latency, request id when it matches the safe id shape, and safe request context. |
| MCP HTTP endpoint | `spoonjoy.mcp.request` | HTTP status/error, auth source, principal id, credential id, OAuth client/resource ids, JSON-RPC method, allowlisted tool name, notification flag, latency, and request byte count. |
| OAuth dynamic registration | `spoonjoy.oauth.register` | Status/error code, created client id when available, redirect URI count, scope metadata class, latency, method, and safe request context. |
| OAuth authorization | `spoonjoy.oauth.authorize` | Loader/action phase, decision/state class, status/error code, client id, scope/resource, principal id after consent is reached, and latency. |
| OAuth token and refresh | `spoonjoy.oauth.token` | Grant type, status/error code, client id when safely known, returned scope/resource classes, and latency. |
| OAuth revocation | `spoonjoy.oauth.revoke` | Status/error code, token type hint class when present, client id when safely known, and latency. |
| Developer docs | `spoonjoy.developer.docs.viewed` | Page id and generated API surface counts. |
| Developer playground | `spoonjoy.developer.playground.viewed`, `spoonjoy.developer.playground.surface_selected`, `spoonjoy.developer.playground.operation_selected`, `spoonjoy.developer.playground.auth_mode_selected`, `spoonjoy.developer.playground.sign_in_clicked`, `spoonjoy.developer.playground.request_submitted`, `spoonjoy.developer.playground.response_received` | Generated operation id/tag/kind/risk/auth/method, selected surface, auth mode/status, status class, latency bucket, and coarse outcome. |
| Recipe image generation | `spoonjoy.image_generation.skipped`, `spoonjoy.image_generation.provider_fallback`, `$exception` with `feature: "recipe_image_generation"` | User id, recipe id, cover id, operation (`placeholder_generate` or `cover_stylize`), source type (`ai-placeholder`, `chef-upload`, or `spoon`), quota kind, provider, model, controlled skip reason, normalized provider error status/code/type/request id, retryability, fallback metadata, and primary-provider metadata when fallback was attempted. |

## Payload Review

The telemetry contract answers who, why, when, and how much with ids, controlled enum-like values, counts, statuses, scopes, and latency buckets. It must not include request bodies, response bodies, cookies, authorization headers, arbitrary headers, bearer tokens, OAuth codes, OAuth code verifiers, refresh tokens, raw query strings, hash fragments, raw request URLs, raw form bodies, JSON-RPC params, stack traces in lifecycle events, IP-literal host values, or client-supplied free text.

User-entered free text, including recipe titles, cookbook titles, recipe descriptions, ingredient names, shopping-list item names, OAuth `state`, redirect URI queries, raw request ids outside the safe id shape, and playground request/response examples, should not be added to analytics payloads without a fresh privacy review.

## Error Tracking

Error tracking uses PostHog's free-tier `$exception` event type. Two capture paths are wired:

| Source | Trigger | Payload |
| --- | --- | --- |
| Client | `posthog-js` `capture_exceptions: true` auto-captures unhandled errors and unhandled promise rejections. | PostHog auto-collects error name/message/stack; PostHog distinct id is the visitor or `identify`-ed user. |
| Server (Worker) | `app/entry.server.tsx` `onError` and `workers/app.ts` outer try/catch call `captureException`. | `$exception_type`, `$exception_message`, `$exception_stack_trace_raw`, `route` (origin pathname), `method` (HTTP method), `distinct_id: "server"`. |
| Recipe image generation background tasks | AI placeholder generation and spoon/chef-upload cover stylization call `captureException` on generation, upload, source-validation, provider, or storage failures. Recovered provider fallback emits `spoonjoy.image_generation.provider_fallback`. | `$exception_*`, internal user id, recipe id, cover id, `feature: "recipe_image_generation"`, operation, source type, quota kind, provider, attempted model, normalized provider error status/code/type/request id, retryability, fallback metadata, and primary-provider metadata when fallback was attempted. |

Server-side capture never includes request bodies, response bodies, cookies, headers, query strings, or hash fragments. Lifecycle events use controlled error codes instead of stack traces; stack traces are limited to the existing `$exception` path. Capture failures (PostHog outage) are swallowed so they cannot affect the request response.

PostHog email notifications should be configured inside PostHog, for example by alerting on `$exception` where `feature = recipe_image_generation` and filtering by `provider`, `errorCode`, `requestId`, or `fallbackAttempted`; on `spoonjoy.image_generation.provider_fallback` where `provider`, `errorCode`, `fallbackProvider`, or `fallbackModel` indicates a recovered provider outage; and optionally on `spoonjoy.image_generation.skipped` where `reason` is `missing_image_provider_config`, `missing_runner`, or `quota_exhausted`. Spoonjoy does not implement a separate email notification service for image generation failures.

## Session Recording

When analytics is enabled, PostHog session recording is configured to mask all text and all form inputs:

- `maskTextSelector: "*"`
- `maskAllInputs: true`

This is a defense-in-depth measure, not permission to send sensitive content in explicit event payloads. Event payloads should still use ids, counts, booleans, and controlled enum-like values.
