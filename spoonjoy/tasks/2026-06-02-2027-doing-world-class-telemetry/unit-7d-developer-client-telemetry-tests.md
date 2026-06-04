# Unit 7d Developer Docs/Playground Client Telemetry Tests

Command:

```bash
pnpm exec vitest run test/lib/analytics.test.ts test/routes/developers.test.tsx test/routes/developers-playground.test.tsx
```

Red result:
- Failed as expected: 7 failures, 34 existing tests passed.

Expected missing pieces proven by failures:
- `responseStatusClass`, `latencyBucket`, `safeClientTelemetryProperties`, and `captureSafeClientEvent` are not implemented in `app/lib/analytics.ts`.
- `/api` docs do not yet emit `spoonjoy.developer.docs.viewed`.
- `/api/playground` does not yet emit safe view, surface selection, operation selection, auth-mode selection, sign-in handoff, request submitted, or response received telemetry.

Safety contract asserted by the new tests:
- Events use controlled `spoonjoy.developer.*` names.
- Playground metadata comes from generated operation ids/groups, methods, auth mode/status, operation kind/risk, and surface counts.
- Response status is reduced to a status class and latency bucket.
- Request metadata records body presence, not body contents.
- Telemetry must not contain bearer tokens, OAuth codes, code verifiers, state values, raw URLs, query strings, request bodies, response bodies, headers, request ids, free-text examples, or `clientMutationId`.
