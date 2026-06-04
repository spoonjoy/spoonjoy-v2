# Unit 7f Developer Docs/Playground Client Telemetry Coverage

Commands:

```bash
pnpm exec vitest run test/lib/analytics.test.ts test/routes/developers.test.tsx test/routes/developers-playground.test.tsx
pnpm exec vitest run --coverage test/lib/analytics.test.ts test/routes/developers.test.tsx test/routes/developers-playground.test.tsx
pnpm run typecheck
pnpm run build
```

Results:
- Focused developer client telemetry tests passed: 3 files, 42 tests.
- Coverage command test execution passed, then exited 1 because the repository's global threshold includes unrelated app files outside the focused client telemetry suite.
- Typecheck passed after regenerating `app/lib/generated/api-v1-playground.ts`; generation produced no file diff.
- Production build passed with the app's existing Vite Environment API notice, empty server-route chunks, and local env-file notices.

Focused coverage evidence from the table:
- `app/lib/analytics.ts`: 100% statements, branches, functions, and lines.
- `app/lib/generated/api-v1-playground.ts`: 100% statements, branches, functions, and lines in this focused suite.
- `app/routes/developers.tsx`: 100% lines/functions; remaining branch gaps are in the broader docs route metadata/rendering surface, not the new one-shot telemetry call.
- `app/routes/developers.playground.tsx`: Focused tests cover the new developer telemetry lifecycle events while broader route UI branches remain below global 100% because this route contains the entire generated playground surface.

Refactor:
- Added narrow branch coverage for allowlisted unsafe client telemetry values and default-property capture.
- No application refactor was needed after Unit 7e.
