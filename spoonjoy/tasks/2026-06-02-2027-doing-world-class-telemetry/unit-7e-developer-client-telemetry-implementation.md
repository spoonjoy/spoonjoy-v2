# Unit 7e Developer Docs/Playground Client Telemetry Implementation

Implementation files:
- `app/lib/analytics.ts`
- `app/routes/developers.tsx`
- `app/routes/developers.playground.tsx`

What changed:
- Added safe client telemetry helpers for controlled `spoonjoy.developer.*` events.
- Added status-class and latency-bucket helpers.
- Added allowlisted property filtering that drops unsafe keys and suspicious string values.
- Instrumented `/api` docs with a one-shot safe docs-view event using generated manifest counts.
- Instrumented `/api/playground` with safe view, surface selection, operation selection, auth-mode selection, sign-in handoff, request submitted, and response received events.
- Playground event metadata is derived from `API_V1_PLAYGROUND_MANIFEST` operations rather than duplicated by hand.

Verification:

```bash
pnpm exec vitest run test/lib/analytics.test.ts test/routes/developers.test.tsx test/routes/developers-playground.test.tsx
pnpm exec vitest run test/scripts/generate-api-playground.test.ts test/routes/developer-docs-redirects.test.ts test/docs/developer-platform-guide.test.ts
pnpm run typecheck
pnpm run build
```

Results:
- Focused developer telemetry tests passed: 3 files, 41 tests.
- Generated playground/docs regression tests passed: 3 files, 16 tests.
- Typecheck passed after regenerating `app/lib/generated/api-v1-playground.ts`; generation produced no file diff.
- Production build passed when rerun by itself. A prior parallel build invocation printed a transient `The build was canceled` line while exiting 0, so the build was rerun alone and passed cleanly.

Privacy contract:
- Events do not include bearer tokens, OAuth codes, code verifiers, state values, raw URLs, query strings, request bodies, response bodies, headers, request ids, free-text examples, or `clientMutationId`.
